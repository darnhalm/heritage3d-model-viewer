/* eslint-disable no-await-in-loop */
import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { hdrFixture } from './hdr-fixtures.cjs';

const base = process.env.BENCH_URL ?? 'http://127.0.0.1:4173/';
const backend = process.env.BENCH_BACKEND ?? 'webgpu';
const duration = Number(process.env.BENCH_DURATION ?? 30000);
const runs = Number(process.env.BENCH_RUNS ?? 3);
const size = Number(process.env.BENCH_TEXTURE_SIZE ?? 4096);
const ktxPath = process.env.BENCH_KTX;
const fixture = hdrFixture(ktxPath ? 16 : size);
const modelPath = process.env.BENCH_MODEL_FILE;
if (modelPath) fixture.model = await readFile(modelPath);
if (ktxPath) {
    fixture.texture = await readFile(ktxPath);
    fixture.manifest = { ...fixture.manifest, format: 'uastc-hdr-ktx2',
        transcodeTarget: process.env.BENCH_TARGET ?? 'auto',
        textures: [{ material: 0, uri: 'texture.ktx2', width: size, height: size }] };
}
const browser = await chromium.launch({ headless: false, channel: process.env.BENCH_CHANNEL || undefined });
const results = [];
let environment;
const save = async () => {
    if (process.env.BENCH_OUTPUT) await writeFile(process.env.BENCH_OUTPUT, JSON.stringify({
        measuredAt: new Date().toISOString(), environment, textureSize: size,
        model: modelPath ?? 'synthetic cube', format: fixture.manifest.format, target: fixture.manifest.transcodeTarget, duration, runs, results
    }, null, 2));
};
const quantile = (values, p) => [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * p) - 1)] ?? null;
const mean = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.route('**/hdr-model.glb', route => route.fulfill({ body: fixture.model }));
    await page.route('**/test.surface.json', route => route.fulfill({ json: fixture.manifest }));
    await page.route('**/texture.*', route => route.fulfill({ body: fixture.texture }));
    await page.goto(`${base}?${backend}&load=hdr-model.glb`);
    await page.waitForFunction(() => window.viewer?.observer.get('scene.unlit') && !window.viewer.observer.get('ui.spinner'), null, { timeout: 120000 });
    await page.evaluate(async () => {
        const v = window.viewer;
        v.observer.set('camera.multisample', true); v.observer.set('camera.easu', true); v.observer.set('camera.sharpness', 1);
        await v.loadHdrSurface(new URL('test.surface.json', location.href).href);
    });
    environment = await page.evaluate(() => {
        const v = window.viewer, d = v.app.graphicsDevice;
        return { userAgent: navigator.userAgent, backend: d.deviceType, hdrCapable: matchMedia('(dynamic-range: high)').matches,
            hdrConfigured: d.isHdr, backbuffer: [d.width, d.height], devicePixelRatio,
            adapter: d.gpuAdapter?.info ? { vendor: d.gpuAdapter.info.vendor, architecture: d.gpuAdapter.info.architecture } : null };
    });
    await page.evaluate(() => {
        const v = window.viewer, profiler = v.app.graphicsDevice.gpuProfiler;
        v.app.autoRender = true;
        const focus = v.cameraControls.getFocus().clone(), position = v.cameraControls.getPosition().clone();
        const radius = position.distance(focus), height = position.y;
        let angle = 0;
        v.app.on('update', dt => {
            angle += dt * .35;
            position.set(focus.x + Math.sin(angle) * radius, height, focus.z + Math.cos(angle) * radius);
            v.cameraControls.reset(focus, position);
        });
        v.app.on('frameend', () => {
            const s = window.__hdrBench;
            if (!s) return;
            const now = performance.now();
            if (s.last) s.intervals.push(now - s.last);
            s.last = now;
        });
        if (profiler) {
            const report = profiler.report;
            profiler.enabled = true;
            profiler.report = function(version, timings, frameTime) {
                report.call(this, version, timings, frameTime);
                if (window.__hdrBench && timings?.length) {
                    const ms = frameTime ?? timings.reduce((a, b) => a + b, 0);
                    if (Number.isFinite(ms) && ms >= 0) window.__hdrBench.gpu.push(ms);
                }
            };
        }
    });
    for (let run = 0; run < runs; run++) {
        const modes = [
            { name: 'GLB / HD', source: false, hd: true, extended: false },
            { name: 'HDR texture -> SDR / HD', source: true, hd: true, extended: false },
            { name: 'GLB / SD', source: false, hd: false, extended: false },
            { name: 'HDR texture -> SDR / SD', source: true, hd: false, extended: false }
        ];
        if (environment.hdrConfigured && environment.hdrCapable) modes.push(
            { name: 'HDR output / HD', source: true, hd: true, extended: true },
            { name: 'HDR output / SD', source: true, hd: false, extended: true });
        if (run % 2) modes.reverse();
        for (const mode of modes) {
            const loadMs = await page.evaluate(async mode => {
                const v = window.viewer;
                v.clearHdrSurface();
                v.observer.set('camera.hq', mode.hd);
                const start = performance.now();
                if (mode.source) await v.loadHdrSurface(new URL('test.surface.json', location.href).href);
                v.observer.set('runtime.hdrRequested', mode.extended);
                return performance.now() - start;
            }, mode);
            await page.waitForTimeout(2500);
            await page.evaluate(() => { window.__hdrBench = { intervals: [], gpu: [], last: 0 }; });
            await page.waitForTimeout(duration);
            const sample = await page.evaluate(() => {
                const data = window.__hdrBench; window.__hdrBench = null;
                const v = window.viewer, rt = v.camera.camera.renderTarget;
                return { ...data, target: [rt.width, rt.height], targetFormat: rt.colorBuffer.format,
                    textureBytes: v.app.graphicsDevice._vram.tex, hdrBytes: v.observer.get('runtime.hdrTextureBytes') };
            });
            const ms = mean(sample.intervals);
            const result = { run: run + 1, mode: mode.name, fps: ms ? 1000 / ms : 0,
                medianMs: quantile(sample.intervals, .5), p95Ms: quantile(sample.intervals, .95),
                gpuMedianMs: quantile(sample.gpu, .5), gpuP95Ms: quantile(sample.gpu, .95), gpuSamples: sample.gpu.length,
                frames: sample.intervals.length, loadMs, target: sample.target, targetFormat: sample.targetFormat,
                textureBytes: sample.textureBytes, hdrBytes: sample.hdrBytes };
            results.push(result);
            await save();
            console.log(JSON.stringify(result));
        }
    }
} finally {
    await browser.close();
}
const report = { model: modelPath ?? 'synthetic cube', measuredAt: new Date().toISOString(), environment, textureSize: size, format: fixture.manifest.format, target: fixture.manifest.transcodeTarget, duration, runs,
    notes: [modelPath ? 'User-supplied model; see model path and derivative provenance.' : 'Synthetic Unlit cube; not a production photogrammetry scene.',
        'GLB fallback keeps its original texture; HDR derivative has the stated texture size.',
        'MSAA, EASU and RCAS enabled in both paths; TAA and SSAO disabled. HDR does not accumulate idle frames.',
        'GPU timings come from the engine timestamp profiler, not CPU clock intervals.',
        'Engine texture-byte counters estimate allocations, not physical system VRAM.',
        'Actual HDR output is skipped unless the real display capability and HDR canvas are both available.'], results };
if (process.env.BENCH_OUTPUT) await writeFile(process.env.BENCH_OUTPUT, `${JSON.stringify(report, null, 2)}\n`);
console.table(results.map(({ run, mode, fps, p95Ms, gpuMedianMs }) => ({ run, mode, fps, p95Ms, gpuMedianMs })));
