/* eslint-disable no-await-in-loop */
// Measures the additional frame cost of the optional CameraFrame effects while
// the camera continuously orbits a loaded model. Run with a visible Chromium:
// headless rAF is throttled and is not representative for this viewer.

import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

const baseUrl = process.env.BENCH_URL ?? 'http://127.0.0.1:4173/';
const model = process.env.BENCH_MODEL ?? 'static/test-assets/BoxTextured.glb';
const settleMs = Number(process.env.BENCH_SETTLE ?? 2500);
const steps = Number(process.env.BENCH_STEPS ?? 120);
const backend = process.env.BENCH_BACKEND ?? 'webgl';
if (!['webgl', 'webgpu'].includes(backend)) throw new Error('BENCH_BACKEND must be webgl or webgpu');

const median = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

const browser = await chromium.launch({ headless: false, channel: process.env.BENCH_CHANNEL || undefined });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`${baseUrl}?${backend}&load=${encodeURIComponent(model)}`);
await page.waitForFunction(() => window.viewer?.entities?.length > 0, null, { timeout: 120000 });
await page.waitForTimeout(settleMs);
const environment = await page.evaluate(() => {
    const viewer = window.viewer;
    const device = viewer.app.graphicsDevice;
    return {
        userAgent: navigator.userAgent,
        backend: device.deviceType,
        hdrCapable: matchMedia('(dynamic-range: high)').matches,
        hdrConfigured: device.isHdr === true,
        backbuffer: [device.width, device.height],
        devicePixelRatio,
        hq: viewer.observer.get('camera.hq'),
        pixelScale: viewer.observer.get('camera.pixelScale')
    };
});

const canvas = page.locator('#application-canvas');
const box = await canvas.boundingBox();
const cx = box.x + box.width / 2;
const cy = box.y + box.height / 2;
const cases = [
    { name: 'Baseline', taa: false, ssao: false },
    { name: 'TAA', taa: true, ssao: false },
    { name: 'SSAO', taa: false, ssao: true },
    { name: 'TAA + SSAO', taa: true, ssao: true }
];

const results = [];
for (const effect of cases) {
    await page.evaluate((next) => {
        const observer = window.viewer.observer;
        observer.set('camera.ssao', next.ssao);
        observer.set('camera.taa', next.taa);
    }, effect);
    await page.waitForTimeout(1000);
    await page.evaluate(() => {
        const samples = { intervals: [], previous: 0 };
        window.__postProcessingBenchmark = samples;
        samples.handler = () => {
            const now = performance.now();
            if (samples.previous) samples.intervals.push(now - samples.previous);
            samples.previous = now;
        };
        window.viewer.app.on('framerender', samples.handler);
    });
    await page.mouse.move(cx, cy);
    await page.mouse.down({ button: 'left' });
    for (let step = 1; step <= steps; step++) {
        const phase = step / steps;
        await page.mouse.move(cx + Math.sin(phase * Math.PI * 2) * 160, cy + Math.sin(phase * Math.PI * 4) * 80);
        await page.waitForTimeout(10);
    }
    await page.mouse.up();
    const intervals = await page.evaluate(() => {
        const samples = window.__postProcessingBenchmark;
        window.viewer.app.off('framerender', samples.handler);
        return samples.intervals.slice(5);
    });
    const medianMs = median(intervals);
    const meanMs = intervals.length ? intervals.reduce((sum, value) => sum + value, 0) / intervals.length : 0;
    const sorted = [...intervals].sort((a, b) => a - b);
    const p95Ms = sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
    results.push({
        effect: effect.name,
        frames: intervals.length,
        medianMs: Number(medianMs.toFixed(2)),
        meanMs: Number(meanMs.toFixed(2)),
        p95Ms: Number(p95Ms.toFixed(2)),
        fps: meanMs ? Number((1000 / meanMs).toFixed(1)) : 0
    });
}

await browser.close();
console.log(environment);
console.table(results);
if (process.env.BENCH_OUTPUT) {
    await writeFile(process.env.BENCH_OUTPUT, `${JSON.stringify({
        measuredAt: new Date().toISOString(), model, requestedBackend: backend, steps,
        note: 'Wall-clock framerender intervals during scripted orbit; includes scheduling and vsync, not GPU duration. Existing SDR pipeline only; this does not measure the planned HDR surface renderer.',
        environment, results
    }, null, 2)}\n`);
}
