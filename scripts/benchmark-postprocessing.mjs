/* eslint-disable no-await-in-loop */
// Measures the additional frame cost of the optional CameraFrame effects while
// the camera continuously orbits a loaded model. Run with a visible Chromium:
// headless rAF is throttled and is not representative for this viewer.

import { chromium } from '@playwright/test';

const baseUrl = process.env.BENCH_URL ?? 'http://127.0.0.1:4173/';
const model = process.env.BENCH_MODEL ?? 'static/test-assets/BoxTextured.glb';
const settleMs = Number(process.env.BENCH_SETTLE ?? 2500);
const steps = Number(process.env.BENCH_STEPS ?? 120);

const median = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`${baseUrl}?webgl&load=${encodeURIComponent(model)}`);
await page.waitForFunction(() => window.viewer?.entities?.length > 0, null, { timeout: 120000 });
await page.waitForTimeout(settleMs);

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
    results.push({
        effect: effect.name,
        frames: intervals.length,
        medianMs: Number(medianMs.toFixed(2)),
        fps: medianMs ? Number((1000 / medianMs).toFixed(1)) : 0
    });
}

console.table(results);
await browser.close();
