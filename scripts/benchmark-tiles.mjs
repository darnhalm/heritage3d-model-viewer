/* eslint-disable no-await-in-loop, no-undef */
/**
 * Passive 3D Tiles / spatial GSplat benchmark.
 *
 * This is deliberately an external Playwright harness: it reads existing viewer state and
 * browser resource timing without enabling tile recording, pinning cache entries or shipping a
 * benchmark endpoint in the production bundle.
 */

import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { chromium } from '@playwright/test';

const root = process.cwd();
const config = JSON.parse(await readFile(path.join(root, 'benchmarks/tiles.config.json'), 'utf8'));
const baseUrl = new URL(process.env.BENCH_URL ?? 'http://127.0.0.1:4173/');
const suite = process.env.BENCH_TILE_SUITE ?? 'production';
const requestedScenes = new Set((process.env.BENCH_TILE_SCENES ?? '')
.split(',').map(value => value.trim()).filter(Boolean));
const passes = (process.env.BENCH_TILE_PASSES ?? 'cold,warm')
.split(',').map(value => value.trim()).filter(value => value === 'cold' || value === 'warm');
const runs = Math.max(1, Number(process.env.BENCH_RUNS ?? 1));
const stepMs = Math.max(250, Number(process.env.BENCH_STEP_MS ?? 2500));
const sampleMs = Math.max(50, Number(process.env.BENCH_SAMPLE_MS ?? 100));
const startupMs = Math.max(5000, Number(process.env.BENCH_STARTUP_MS ?? 90000));
const settleMs = Math.max(1000, Number(process.env.BENCH_SETTLE_MS ?? 10000));
const screenshots = !['0', 'false', 'no'].includes(String(process.env.BENCH_SCREENSHOTS ?? '1').toLowerCase());
const headless = !['0', 'false', 'no'].includes(String(process.env.BENCH_HEADLESS ?? '1').toLowerCase());
const networkName = process.env.BENCH_NETWORK ?? 'native';
const outputRoot = path.resolve(root, process.env.BENCH_OUTPUT ?? 'benchmark-results');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outputDir = path.join(outputRoot, stamp);

const NETWORK_PROFILES = {
    native: null,
    broadband: { latency: 20, downloadThroughput: 20 * 1024 * 1024 / 8, uploadThroughput: 5 * 1024 * 1024 / 8 },
    fast3g: { latency: 150, downloadThroughput: 1.6 * 1024 * 1024 / 8, uploadThroughput: 750 * 1024 / 8 }
};

if (!(networkName in NETWORK_PROFILES)) {
    throw new Error(`Unknown BENCH_NETWORK=${networkName}; expected ${Object.keys(NETWORK_PROFILES).join(', ')}`);
}
if (passes.length === 0) throw new Error('BENCH_TILE_PASSES must contain cold and optionally warm');
if (passes.includes('warm') && !passes.includes('cold')) {
    throw new Error('A warm pass requires a preceding cold pass in the same browser context');
}

const delay = ms => new Promise((resolve) => {
    setTimeout(resolve, ms);
});
const round = value => Number((Number(value) || 0).toFixed(2));
const quantile = (values, q) => {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * q))];
};
const csv = (value) => {
    const text = value === null || value === undefined ? '' : String(value);
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};
const safeName = value => value.replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '');
const publicBase = `${baseUrl.protocol}//${baseUrl.host}/`;

const canReach = async (url, timeout = 3000) => {
    try {
        const response = await fetch(url, { signal: AbortSignal.timeout(timeout) });
        return response.ok;
    } catch {
        return false;
    }
};

let server = null;
if (!await canReach(baseUrl)) {
    if (process.env.BENCH_URL) throw new Error(`BENCH_URL is not reachable: ${publicBase}`);
    server = spawn(process.execPath, ['node_modules/serve/build/main.js', '--cors', '--listen', '4173', 'dist'], {
        cwd: root,
        stdio: 'ignore'
    });
    for (let attempt = 0; attempt < 80 && !await canReach(baseUrl, 500); ++attempt) await delay(100);
    if (!await canReach(baseUrl)) throw new Error(`Unable to start benchmark server at ${publicBase}`);
}

await mkdir(outputDir, { recursive: true });
if (screenshots) await mkdir(path.join(outputDir, 'screenshots'), { recursive: true });

const scenes = config.scenes.filter(scene => (requestedScenes.size ?
    requestedScenes.has(scene.id) : scene.suites.includes(suite)));
if (scenes.length === 0) throw new Error(`No scenes selected for suite "${suite}"`);

const cases = scenes.flatMap(scene => scene.variants.map(variant => ({ scene, variant })));
const browser = await chromium.launch({
    headless,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
});
const results = [];
const skipped = [];

const modelUrl = scene => new URL(scene.path, baseUrl);
const scrubUrl = (raw) => {
    try {
        const url = new URL(raw);
        return `${url.origin}${url.pathname}`;
    } catch {
        return String(raw).split('?')[0];
    }
};

const applyNetwork = async (session) => {
    await session.send('Network.enable');
    const profile = NETWORK_PROFILES[networkName];
    if (profile) {
        await session.send('Network.emulateNetworkConditions', { offline: false, ...profile });
    }
};

const setRoutePoint = (page, point) => page.evaluate((routePoint) => {
    const viewer = window.viewer;
    const Vec3 = viewer.camera.getPosition().constructor;
    const bounds = viewer.sceneBounds;
    const focus = new Vec3(bounds.center.x, bounds.center.y, bounds.center.z);
    const radius = Math.max(0.01, bounds.halfExtents.length()) * routePoint.distance;
    const azimuth = routePoint.azimuth * Math.PI / 180;
    const elevation = routePoint.elevation * Math.PI / 180;
    const horizontal = Math.cos(elevation) * radius;
    const position = new Vec3(
        focus.x + Math.sin(azimuth) * horizontal,
        focus.y + Math.sin(elevation) * radius,
        focus.z + Math.cos(azimuth) * horizontal
    );
    viewer.cameraControls.reset(focus, position);
    viewer.fitCameraClipPlanes();
    viewer.renderNextFrame();
}, point);

const takeSample = (page, stage, tilePriority, routePoint) => page.evaluate(({ stageName, priority, focus }) => {
    const viewer = window.viewer;
    const canvas = viewer.canvas;
    const rect = canvas.getBoundingClientRect();
    const requestedFocus = Array.isArray(focus) ? focus : [0.5, 0.5];
    const primaryX = Math.max(0, Math.min(rect.width, requestedFocus[0] * rect.width));
    const primaryY = Math.max(0, Math.min(rect.height, requestedFocus[1] * rect.height));
    let focusSource = priority === 'default' ? 'legacy' : 'view';
    let focusX = 0.5;
    let focusY = 0.5;

    // Keep cursor-driven focus fresh exactly as real pointer movement does. Surface focus first
    // tries the scripted point, then moves halfway toward the centre and finally tries the centre;
    // this makes the route deterministic while avoiding a silent fallback when the first ray hits
    // the background rather than the model.
    if (priority === 'cursor' || priority === 'surface') {
        canvas.dispatchEvent(new PointerEvent('pointermove', {
            clientX: rect.left + primaryX,
            clientY: rect.top + primaryY,
            pointerType: 'mouse',
            bubbles: true
        }));
        focusSource = priority === 'surface' ? 'cursor-fallback' : 'cursor';
        focusX = primaryX / Math.max(1, rect.width);
        focusY = primaryY / Math.max(1, rect.height);
    }
    if (priority === 'surface') {
        const candidates = [
            [primaryX, primaryY],
            [(primaryX + rect.width * 0.5) / 2, (primaryY + rect.height * 0.5) / 2],
            [rect.width * 0.5, rect.height * 0.5]
        ];
        let hit = null;
        let hitScreen = null;
        for (const candidate of candidates) {
            hit = viewer.measurementController?.pickSurfacePoint(candidate[0], candidate[1]) ?? null;
            if (hit) {
                hitScreen = candidate;
                break;
            }
        }
        viewer.cameraControls.setSurfaceZoomTarget(hit);
        if (hit && hitScreen) {
            focusSource = 'surface';
            focusX = hitScreen[0] / Math.max(1, rect.width);
            focusY = hitScreen[1] / Math.max(1, rect.height);
        }
    }

    const started = performance.now();
    viewer.app.tick(started);
    const tickMs = performance.now() - started;
    const elapsed = performance.now() - window.__tileBenchmarkStart;
    const tileStats = viewer.getTileStats?.() ?? null;
    const selection = viewer.tileManager?.prevSelection ?? [];
    let gsplat = null;
    if (viewer.observer.get('scene.hasGsplat')) {
        try {
            gsplat = viewer.updateGSplatDebugBounds(false);
        } catch {
            gsplat = viewer.gsplatDebugStats ?? null;
        }
    }
    const tileDepths = selection.map(tile => Number(tile.depth) || 0);
    const gsplatLods = gsplat?.lodCounts ?? [];
    const gsplatMaxLod = gsplatLods.reduce((max, count, lod) => (count ? Math.max(max, lod) : max), 0);
    const heap = performance.memory?.usedJSHeapSize ?? 0;
    return {
        timeMs: elapsed,
        stage: stageName,
        focusSource,
        focusX,
        focusY,
        tickMs,
        kind: tileStats ? 'tiles' : (gsplat ? 'gsplat' : 'pending'),
        selected: tileStats?.selected ?? gsplat?.visibleNodes ?? 0,
        ready: tileStats?.ready ?? gsplat?.loadedFiles ?? 0,
        loading: tileStats?.loading ?? gsplat?.runningFiles ?? 0,
        queued: tileStats?.queued ?? gsplat?.queuedFiles ?? 0,
        pending: gsplat?.pendingFiles ?? 0,
        failed: tileStats?.failed ?? 0,
        bytes: tileStats?.bytes ?? 0,
        bytesBudget: tileStats?.bytesBudget ?? 0,
        errorTarget: tileStats?.errorTarget ?? 0,
        errorTargetScale: tileStats?.errorTargetScale ?? 1,
        maxDepth: tileDepths.length ? Math.max(...tileDepths) : gsplatMaxLod,
        depthCounts: tileStats?.depthCounts ?? gsplatLods,
        activeSplats: gsplat?.activeSplats ?? 0,
        splatBudget: gsplat?.budget ?? 0,
        transitioning: gsplat?.transitioningNodes ?? 0,
        loadCount: viewer.tileManager?.loadCounter ?? gsplat?.loadedFiles ?? 0,
        tileRecording: !!viewer.observer.get('debug.tileRecording'),
        pinnedTiles: viewer.tileManager?.recordedTiles?.size ?? 0,
        signature: tileStats ? selection.map(tile => tile.id).sort((a, b) => a - b).join(':') :
            (gsplat ? gsplatLods.map((count, lod) => `${lod}:${count || 0}`).join('|') : ''),
        heapBytes: heap
    };
}, { stageName: stage, priority: tilePriority, focus: routePoint?.focus });

const isReady = (sample, kind) => (kind === 'tiles' ? sample.selected > 0 : sample.activeSplats > 0);
const isSettled = sample => sample.loading === 0 && sample.queued === 0 && sample.pending === 0 &&
    sample.transitioning === 0;

const runPass = async ({ context, scene, variant, pass, run }) => {
    const page = await context.newPage();
    const session = await context.newCDPSession(page);
    await applyNetwork(session);
    const responses = [];
    const pageErrors = [];
    const prefix = new URL('.', modelUrl(scene)).pathname;
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('response', async (response) => {
        const url = new URL(response.url());
        if (url.origin !== baseUrl.origin || !url.pathname.startsWith(prefix)) return;
        const headers = await response.allHeaders().catch(() => ({}));
        responses.push({
            url: scrubUrl(response.url()),
            status: response.status(),
            bytes: Number(headers['content-length'] ?? 0),
            fromServiceWorker: response.fromServiceWorker()
        });
    });

    const viewerUrl = new URL(baseUrl);
    viewerUrl.searchParams.set('webgl', '');
    await page.goto(viewerUrl.href, { waitUntil: 'domcontentloaded', timeout: startupMs });
    await page.waitForFunction(() => window.viewer?.observer, null, { timeout: startupMs });
    await page.evaluate(({ priority, url, filename }) => {
        const viewer = window.viewer;
        viewer.observer.set('camera.tilePriority', priority ?? 'default');
        viewer.observer.set('debug.tileRecording', false);
        window.__tileBenchmarkStart = performance.now();
        viewer.loadFiles([{ url, filename }]);
    }, { priority: variant.tilePriority, url: modelUrl(scene).href, filename: scene.path });

    const samples = [];
    const startedAt = Date.now();
    while (Date.now() - startedAt < startupMs) {
        const sample = await takeSample(page, 'startup', variant.tilePriority, config.route[0]);
        samples.push(sample);
        if (isReady(sample, scene.kind)) break;
        await delay(sampleMs);
    }
    if (!samples.some(sample => isReady(sample, scene.kind))) {
        throw new Error(`${scene.label} did not become renderable within ${startupMs} ms`);
    }

    for (const point of config.route) {
        await setRoutePoint(page, point);
        const until = Date.now() + stepMs;
        while (Date.now() < until) {
            samples.push(await takeSample(page, point.id, variant.tilePriority, point));
            await delay(sampleMs);
        }
        if (screenshots) {
            const name = `${safeName(`${scene.id}-${variant.id}-${pass}-run${run}-${point.id}`)}.png`;
            await page.screenshot({ path: path.join(outputDir, 'screenshots', name) });
        }
    }

    let stable = 0;
    const settleUntil = Date.now() + settleMs;
    while (Date.now() < settleUntil && stable < 10) {
        const sample = await takeSample(page, 'settle', variant.tilePriority, config.route.at(-1));
        samples.push(sample);
        stable = isSettled(sample) ? stable + 1 : 0;
        await delay(sampleMs);
    }

    const resources = await page.evaluate(() => performance.getEntriesByType('resource').map(entry => ({
        url: entry.name,
        duration: entry.duration,
        transferSize: entry.transferSize,
        encodedBodySize: entry.encodedBodySize,
        decodedBodySize: entry.decodedBodySize,
        initiatorType: entry.initiatorType
    })));
    if (samples.some(sample => sample.tileRecording || sample.pinnedTiles > 0)) {
        throw new Error('Passive benchmark invariant failed: tile recording or cache pins became active');
    }
    if (variant.tilePriority === 'cursor' && !samples.some(sample => sample.focusSource === 'cursor')) {
        throw new Error('Cursor priority never received its scripted pointer focus');
    }
    if (variant.tilePriority === 'surface' && !samples.some(sample => sample.focusSource === 'surface')) {
        throw new Error('Surface priority never resolved its scripted point on the model');
    }
    await page.close();
    return { samples, responses, resources, pageErrors };
};

const summarize = ({ scene, variant, pass, run, samples, responses, resources, pageErrors }) => {
    const ready = samples.filter(sample => isReady(sample, scene.kind));
    const signatures = ready.filter(sample => sample.signature);
    let stateChanges = 0;
    let fallbackCount = 0;
    let previous = null;
    let lastStateChangeMs = ready[0]?.timeMs ?? 0;
    for (const sample of signatures) {
        if (previous && sample.signature !== previous.signature) {
            stateChanges++;
            lastStateChangeMs = sample.timeMs;
        }
        if (previous && sample.stage === previous.stage && sample.maxDepth < previous.maxDepth) fallbackCount++;
        previous = sample;
    }
    const initialDepth = ready[0]?.maxDepth ?? 0;
    const firstChanged = ready.find(sample => sample.signature !== ready[0]?.signature);
    const lastBusy = [...samples].reverse().find(sample => !isSettled(sample));
    const modelResources = resources.filter((resource) => {
        try {
            const url = new URL(resource.url);
            return url.origin === baseUrl.origin && url.pathname.startsWith(new URL('.', modelUrl(scene)).pathname);
        } catch {
            return false;
        }
    });
    const responseCounts = new Map();
    responses.forEach(response => responseCounts.set(response.url, (responseCounts.get(response.url) ?? 0) + 1));
    const duplicateRequests = [...responseCounts.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0);
    const responseBytes = responses.reduce((sum, response) => sum + response.bytes, 0);
    const timingBytes = modelResources.reduce((sum, resource) => sum + Number(resource.transferSize || resource.encodedBodySize || 0), 0);
    const sampleSpan = samples.length > 1 ? samples.at(-1).timeMs - samples[0].timeMs : 0;
    const blankSamples = samples.filter(sample => !isReady(sample, scene.kind)).length;
    return {
        id: `${scene.id}:${variant.id}:${pass}:${run}`,
        sceneId: scene.id,
        scene: scene.label,
        kind: scene.kind,
        comparisonGroup: scene.comparisonGroup ?? null,
        variantId: variant.id,
        variant: variant.label,
        tilePriority: variant.tilePriority ?? null,
        pass,
        run,
        network: networkName,
        backend: 'webgl',
        timeToFirstVisibleMs: round(ready[0]?.timeMs ?? 0),
        timeToFirstStateChangeMs: round(firstChanged?.timeMs ?? 0),
        timeToSettledMs: round(Math.max(lastBusy?.timeMs ?? 0, lastStateChangeMs)),
        initialDepth,
        deepestLod: Math.max(0, ...samples.map(sample => sample.maxDepth)),
        stateChanges,
        fallbackCount,
        blankTimeMs: round(blankSamples / Math.max(1, samples.length) * sampleSpan),
        requestCount: responses.length,
        uniqueRequestCount: responseCounts.size,
        duplicateRequests,
        transferredBytes: Math.max(responseBytes, timingBytes),
        peakCachedBytes: Math.max(0, ...samples.map(sample => sample.bytes)),
        peakHeapBytes: Math.max(0, ...samples.map(sample => sample.heapBytes)),
        peakQueued: Math.max(0, ...samples.map(sample => sample.queued + sample.pending)),
        peakLoading: Math.max(0, ...samples.map(sample => sample.loading)),
        peakReady: Math.max(0, ...samples.map(sample => sample.ready)),
        peakSelected: Math.max(0, ...samples.map(sample => sample.selected)),
        peakActiveSplats: Math.max(0, ...samples.map(sample => sample.activeSplats)),
        peakErrorScale: round(Math.max(1, ...samples.map(sample => sample.errorTargetScale))),
        exactFocusPercent: round(samples.filter((sample) => {
            if (variant.tilePriority === 'cursor') return sample.focusSource === 'cursor';
            if (variant.tilePriority === 'surface') return sample.focusSource === 'surface';
            return true;
        }).length / Math.max(1, samples.length) * 100),
        tickP50Ms: round(quantile(samples.map(sample => sample.tickMs), 0.5)),
        tickP95Ms: round(quantile(samples.map(sample => sample.tickMs), 0.95)),
        tickP99Ms: round(quantile(samples.map(sample => sample.tickMs), 0.99)),
        pageErrors,
        samples
    };
};

const persistPartial = () => writeFile(path.join(outputDir, 'results.partial.json'), JSON.stringify({
    generatedAt: new Date().toISOString(),
    baseUrl: publicBase,
    suite,
    network: networkName,
    results,
    skipped
}, null, 2));

try {
    for (const { scene, variant } of cases) {
        if (!await canReach(modelUrl(scene), 10000)) {
            skipped.push({ sceneId: scene.id, reason: 'model unavailable', path: scene.path });
            await persistPartial();
            continue;
        }
        for (let run = 1; run <= runs; ++run) {
            const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
            const cacheSessionPage = await context.newPage();
            const cacheSession = await context.newCDPSession(cacheSessionPage);
            await cacheSession.send('Network.enable');
            await cacheSession.send('Network.clearBrowserCache');
            await cacheSessionPage.close();
            try {
                for (const pass of passes) {
                    try {
                        const raw = await runPass({ context, scene, variant, pass, run });
                        results.push(summarize({ scene, variant, pass, run, ...raw }));
                    } catch (error) {
                        skipped.push({
                            sceneId: scene.id,
                            variantId: variant.id,
                            pass,
                            run,
                            reason: error instanceof Error ? error.message : String(error)
                        });
                    }
                    await persistPartial();
                }
            } finally {
                await context.close();
            }
        }
    }
} finally {
    await browser.close();
    server?.kill('SIGTERM');
}

const summaryColumns = [
    'sceneId', 'scene', 'kind', 'variantId', 'variant', 'tilePriority', 'pass', 'run', 'network',
    'timeToFirstVisibleMs', 'timeToFirstStateChangeMs', 'timeToSettledMs', 'deepestLod', 'stateChanges',
    'fallbackCount', 'blankTimeMs', 'requestCount', 'uniqueRequestCount', 'duplicateRequests',
    'transferredBytes', 'peakCachedBytes', 'peakHeapBytes', 'peakQueued', 'peakLoading', 'peakReady',
    'peakSelected', 'peakActiveSplats', 'peakErrorScale', 'exactFocusPercent', 'tickP50Ms', 'tickP95Ms', 'tickP99Ms'
];
const summaryRows = results.map(result => summaryColumns.map(column => csv(result[column])).join(','));
const summaryCsv = [summaryColumns.join(','), ...summaryRows].join('\n');
const sampleColumns = ['id', 'timeMs', 'stage', 'focusSource', 'focusX', 'focusY', 'tickMs', 'selected', 'ready', 'loading', 'queued', 'pending',
    'bytes', 'bytesBudget', 'errorTarget', 'errorTargetScale', 'maxDepth', 'activeSplats', 'splatBudget',
    'transitioning', 'loadCount', 'tileRecording', 'pinnedTiles', 'heapBytes', 'signature'];
const sampleRows = results.flatMap(result => result.samples.map((sample) => {
    return sampleColumns.map(column => csv(column === 'id' ? result.id : sample[column])).join(',');
}));
const samplesCsv = [sampleColumns.join(','), ...sampleRows].join('\n');

const formatBytes = value => (value ? `${(value / 1024 / 1024).toFixed(1)} MB` : '0 MB');
const aggregateGroups = new Map();
for (const result of results) {
    const key = `${result.sceneId}:${result.variantId}:${result.pass}`;
    const group = aggregateGroups.get(key) ?? [];
    group.push(result);
    aggregateGroups.set(key, group);
}
const aggregates = [...aggregateGroups.values()].map(group => ({
    sceneId: group[0].sceneId,
    scene: group[0].scene,
    variantId: group[0].variantId,
    variant: group[0].variant,
    pass: group[0].pass,
    runs: group.length,
    timeToFirstVisibleMs: round(quantile(group.map(item => item.timeToFirstVisibleMs), 0.5)),
    timeToSettledMs: round(quantile(group.map(item => item.timeToSettledMs), 0.5)),
    transferredBytes: round(quantile(group.map(item => item.transferredBytes), 0.5)),
    fallbackCount: round(quantile(group.map(item => item.fallbackCount), 0.5)),
    exactFocusPercent: round(quantile(group.map(item => item.exactFocusPercent), 0.5)),
    tickP95Ms: round(quantile(group.map(item => item.tickP95Ms), 0.5))
}));
const comparisonGroups = new Map();
for (const aggregate of aggregates) {
    const key = `${aggregate.sceneId}:${aggregate.pass}`;
    const group = comparisonGroups.get(key) ?? [];
    group.push(aggregate);
    comparisonGroups.set(key, group);
}
const comparisons = [...comparisonGroups.values()].filter(group => group.length > 1).map((group) => {
    const winner = field => [...group].sort((a, b) => a[field] - b[field])[0];
    return {
        sceneId: group[0].sceneId,
        scene: group[0].scene,
        pass: group[0].pass,
        firstVisible: winner('timeToFirstVisibleMs'),
        settled: winner('timeToSettledMs'),
        transfer: winner('transferredBytes'),
        fallbacks: winner('fallbackCount'),
        variants: group
    };
});
const comparisonLines = comparisons.flatMap(comparison => [
    `- **${comparison.scene} (${comparison.pass})**: first visible — ${comparison.firstVisible.variant} (${comparison.firstVisible.timeToFirstVisibleMs} ms); settled — ${comparison.settled.variant} (${comparison.settled.timeToSettledMs} ms); least transfer — ${comparison.transfer.variant} (${formatBytes(comparison.transfer.transferredBytes)}); fewest fallbacks — ${comparison.fallbacks.variant} (${comparison.fallbacks.fallbackCount}).`
]);
const markdown = [
    '# Tile streaming benchmark',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    `Target: \`${publicBase}\` · suite: \`${suite}\` · network: \`${networkName}\` · route step: ${stepMs} ms`,
    '',
    '> The harness is external and passive: tile recording is disabled, cache entries are not pinned, and no benchmark code is shipped in the viewer.',
    '',
    '| Scene | Variant | Cache | Focus active | First visible | Settled | Requests | Transfer | LOD changes | Fallbacks | Tick p95 |',
    '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
    ...results.map(result => `| ${result.scene} | ${result.variant} | ${result.pass} | ${result.exactFocusPercent}% | ${result.timeToFirstVisibleMs} ms | ${result.timeToSettledMs} ms | ${result.requestCount} | ${formatBytes(result.transferredBytes)} | ${result.stateChanges} | ${result.fallbackCount} | ${result.tickP95Ms} ms |`),
    ...(comparisonLines.length ? ['', '## Same-scene findings', '', ...comparisonLines] : []),
    '',
    '## Interpretation notes',
    '',
    '- Compare variants of the same scene directly. Cross-format rows with different source scenes are diagnostic, not a quality ranking.',
    '- `Focus active` verifies that cursor and surface modes received their scripted focus instead of silently falling back to the centre of view.',
    '- `Fallbacks` counts depth decreases within one fixed camera waypoint; route-driven coarsening is excluded.',
    '- Transfer size prefers response `Content-Length` and falls back to Resource Timing when available.',
    '- GPU time and decoded VRAM are not exposed reliably by browsers; tick CPU and source bytes are proxies.',
    ...(skipped.length ? ['', '## Skipped', '', ...skipped.map(item => `- ${item.sceneId}: ${item.reason}`)] : [])
].join('\n');

const escapeHtml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const chart = (result, field, color) => {
    const values = result.samples.map(sample => Number(sample[field]) || 0);
    const max = Math.max(1, ...values);
    const width = 620;
    const height = 120;
    const points = values.map((value, index) => {
        const x = values.length <= 1 ? 0 : index / (values.length - 1) * width;
        const y = height - value / max * (height - 8) - 4;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(field)}"><polyline fill="none" stroke="${color}" stroke-width="2" points="${points}"/></svg>`;
};
const html = `<!doctype html><html><head><meta charset="utf-8"><title>Tile benchmark</title><style>
body{margin:24px;background:#111;color:#eee;font:14px/1.45 system-ui,sans-serif}h1,h2{font-weight:600}.meta{color:#aaa}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(620px,1fr));gap:18px}.card{background:#1b1b1b;border:1px solid #333;border-radius:10px;padding:16px}.metrics{display:flex;flex-wrap:wrap;gap:12px}.metric{background:#242424;padding:7px 10px;border-radius:6px}.charts{display:grid;grid-template-columns:1fr 1fr;gap:8px}svg{width:100%;height:120px;background:#151515;border-radius:6px}table{border-collapse:collapse;width:100%}th,td{padding:7px;border-bottom:1px solid #333;text-align:right}th:first-child,td:first-child{text-align:left}.warn{color:#ffd84a}</style></head><body>
<h1>Tile streaming benchmark</h1><p class="meta">${escapeHtml(publicBase)} · ${escapeHtml(suite)} · ${escapeHtml(networkName)} · ${new Date().toISOString()}</p>
<p>The harness is external and passive. Compare variants of the same source scene directly; cross-format rows are diagnostic only.</p>
${comparisonLines.length ? `<section class="card"><h2>Same-scene findings</h2><ul>${comparisonLines.map(line => `<li>${escapeHtml(line.replace(/^- |\*\*/g, ''))}</li>`).join('')}</ul></section><br>` : ''}
<div class="grid">${results.map(result => `<section class="card"><h2>${escapeHtml(result.scene)} — ${escapeHtml(result.variant)} (${result.pass})</h2><div class="metrics">
<span class="metric">focus ${result.exactFocusPercent}%</span><span class="metric">first ${result.timeToFirstVisibleMs} ms</span><span class="metric">settled ${result.timeToSettledMs} ms</span><span class="metric">${result.requestCount} requests</span><span class="metric">${formatBytes(result.transferredBytes)}</span><span class="metric">${result.fallbackCount} fallbacks</span><span class="metric">tick p95 ${result.tickP95Ms} ms</span></div>
<div class="charts"><div><p>Selected tiles / nodes</p>${chart(result, 'selected', '#64d8ff')}</div><div><p>LOD depth</p>${chart(result, 'maxDepth', '#ffd84a')}</div><div><p>Queued + pending</p>${chart({ ...result, samples: result.samples.map(sample => ({ queue: sample.queued + sample.pending })) }, 'queue', '#ff8c69')}</div><div><p>Cached bytes</p>${chart(result, 'bytes', '#9fe870')}</div></div></section>`).join('')}</div>
${skipped.length ? `<h2>Skipped</h2><ul class="warn">${skipped.map(item => `<li>${escapeHtml(item.sceneId)}: ${escapeHtml(item.reason)}</li>`).join('')}</ul>` : ''}
</body></html>`;

const payload = {
    generatedAt: new Date().toISOString(),
    target: { origin: publicBase, suite, network: networkName, passes, runs, stepMs, sampleMs },
    git: { sha: process.env.GITHUB_SHA ?? null },
    aggregates,
    comparisons,
    results,
    skipped
};
await Promise.all([
    writeFile(path.join(outputDir, 'results.json'), JSON.stringify(payload, null, 2)),
    writeFile(path.join(outputDir, 'summary.csv'), `${summaryCsv}\n`),
    writeFile(path.join(outputDir, 'samples.csv'), `${samplesCsv}\n`),
    writeFile(path.join(outputDir, 'report.md'), `${markdown}\n`),
    writeFile(path.join(outputDir, 'report.html'), html)
]);

console.log(`Tile benchmark: ${results.length} completed, ${skipped.length} skipped`);
console.log(`Report: ${path.join(outputDir, 'report.html')}`);
if (results.length === 0) process.exitCode = 1;
