/* eslint-disable no-await-in-loop, no-undef, indent, arrow-parens */
import { spawn } from 'node:child_process';

import { chromium } from '@playwright/test';

const baseUrl = process.env.BENCH_URL ?? 'http://127.0.0.1:4173/';
const runs = Math.max(1, Number(process.env.BENCH_RUNS ?? 3));
const backends = (process.env.BENCH_BACKENDS ?? 'webgpu,webgl')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);

const quantile = (values, q) => {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
};

const round = value => Number(value.toFixed(2));

const canReachViewer = async () => {
    try {
        const response = await fetch(baseUrl, { signal: AbortSignal.timeout(1000) });
        return response.ok;
    } catch {
        return false;
    }
};

let server = null;
if (!await canReachViewer()) {
    if (process.env.BENCH_URL) throw new Error(`BENCH_URL is not reachable: ${baseUrl}`);
    server = spawn(process.execPath, ['node_modules/serve/build/main.js', '--cors', '--listen', '4173', 'dist'], {
        cwd: process.cwd(),
        stdio: 'ignore'
    });
    for (let attempt = 0; attempt < 50 && !await canReachViewer(); attempt++) {
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!await canReachViewer()) throw new Error(`Unable to start benchmark server at ${baseUrl}`);
}

const browser = await chromium.launch({ headless: false });
const results = [];

try {
    for (const backend of backends) {
        for (let run = 1; run <= runs; run++) {
            const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
            const params = new URLSearchParams({ load: 'static/test-assets/BoxTextured.glb' });
            if (backend === 'webgl') params.set('webgl', '');
            await page.goto(`${baseUrl}?${params.toString()}`);
            await page.waitForFunction(
                () => window.viewer?.meshInstances?.length > 0 && !window.viewer.observer.get('ui.spinner'),
                null,
                { timeout: 60000 }
            );
            await page.waitForTimeout(1000);

            await page.evaluate(() => {
                const viewer = window.viewer;
                const samples = {
                    frameIntervalsMs: [],
                    renderCpuMs: [],
                    longTasksMs: [],
                    pickCalls: 0,
                    pickLatencyMs: [],
                    lastFrameAt: 0,
                    renderStartedAt: 0
                };
                window.__navigationBenchmark = samples;

                viewer.app.on('framerender', () => {
                    const now = performance.now();
                    if (samples.lastFrameAt) samples.frameIntervalsMs.push(now - samples.lastFrameAt);
                    samples.lastFrameAt = now;
                });
                viewer.app.on('prerender', () => {
                    samples.renderStartedAt = performance.now();
                });
                viewer.app.on('postrender', () => {
                    if (samples.renderStartedAt) {
                        samples.renderCpuMs.push(performance.now() - samples.renderStartedAt);
                    }
                });

                const originalPick = viewer.picker.pick.bind(viewer.picker);
                viewer.picker.pick = async (...args) => {
                    const startedAt = performance.now();
                    samples.pickCalls++;
                    try {
                        return await originalPick(...args);
                    } finally {
                        samples.pickLatencyMs.push(performance.now() - startedAt);
                    }
                };

                if ('PerformanceObserver' in window) {
                    try {
                        const observer = new PerformanceObserver(list => {
                            list.getEntries().forEach(entry => samples.longTasksMs.push(entry.duration));
                        });
                        observer.observe({ type: 'longtask' });
                    } catch {
                        // Long Tasks API is not present in every Chromium configuration.
                    }
                }
            });

            const canvas = page.locator('#application-canvas');
            const box = await canvas.boundingBox();
            if (!box) throw new Error('Canvas is not visible');
            const startX = box.x + box.width * 0.5;
            const startY = box.y + box.height * 0.5;

            await page.mouse.move(startX, startY);
            await page.mouse.down({ button: 'left' });
            for (let step = 1; step <= 120; step++) {
                const phase = step / 120;
                await page.mouse.move(
                    startX + Math.sin(phase * Math.PI * 2) * Math.min(180, box.width * 0.22),
                    startY + Math.sin(phase * Math.PI * 4) * Math.min(90, box.height * 0.14)
                );
                await page.waitForTimeout(10);
            }
            await page.mouse.up({ button: 'left' });
            await page.waitForTimeout(750);

            const sample = await page.evaluate(({ backend, run }) => {
                const data = window.__navigationBenchmark;
                return {
                    backend,
                    actualBackend: window.viewer.graphicsBackend,
                    run,
                    frameIntervalsMs: data.frameIntervalsMs,
                    renderCpuMs: data.renderCpuMs,
                    longTasksMs: data.longTasksMs,
                    pickCalls: data.pickCalls,
                    pickLatencyMs: data.pickLatencyMs
                };
            }, { backend, run });
            results.push(sample);
            await page.close();
        }
    }
} finally {
    await browser.close();
    server?.kill('SIGTERM');
}

const summary = backends.map((backend) => {
    const samples = results.filter(result => result.backend === backend);
    const runMetrics = samples.map(sample => ({
        frameP50: quantile(sample.frameIntervalsMs, 0.5),
        frameP95: quantile(sample.frameIntervalsMs, 0.95),
        renderCpuP50: quantile(sample.renderCpuMs, 0.5),
        renderCpuP95: quantile(sample.renderCpuMs, 0.95)
    }));
    const pickLatencies = samples.flatMap(sample => sample.pickLatencyMs);
    const longTasks = samples.flatMap(sample => sample.longTasksMs);
    return {
        requestedBackend: backend,
        actualBackends: [...new Set(samples.map(sample => sample.actualBackend))],
        runs: samples.length,
        frameP50Ms: round(quantile(runMetrics.map(metric => metric.frameP50), 0.5)),
        frameP95Ms: round(quantile(runMetrics.map(metric => metric.frameP95), 0.5)),
        renderCpuP50Ms: round(quantile(runMetrics.map(metric => metric.renderCpuP50), 0.5)),
        renderCpuP95Ms: round(quantile(runMetrics.map(metric => metric.renderCpuP95), 0.5)),
        pickCallsPerGesture: samples.map(sample => sample.pickCalls),
        pickLatencyMs: samples.map(sample => sample.pickLatencyMs.map(round)),
        pickLatencyP50Ms: round(quantile(pickLatencies, 0.5)),
        pickLatencyP95Ms: round(quantile(pickLatencies, 0.95)),
        longTaskCount: longTasks.length,
        longestTaskMs: round(Math.max(0, ...longTasks))
    };
});

console.log(JSON.stringify({ runs, summary }, null, 2));
