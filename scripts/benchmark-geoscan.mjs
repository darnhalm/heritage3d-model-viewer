/** Reproducible Geoscan startup / refinement timing; no signed storage URLs are recorded. */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { chromium } from 'playwright';

const source = process.env.GEOSCAN_SOURCE ?? 'https://cloud.geoscan.ru/shared/projects/6ac432f9-21a7-4331-985b-0bf8af76df90';
const base = process.env.BENCH_URL ?? 'http://127.0.0.1:43498/';
const label = process.env.BENCH_LABEL ?? 'current';
const runs = Math.max(1, Math.min(3, Number(process.env.BENCH_RUNS ?? 1)));
const browser = await chromium.launch({
    executablePath: process.env.BROWSER_EXECUTABLE ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    args: ['--use-gl=angle', `--use-angle=${process.platform === 'darwin' ? 'metal' : 'swiftshader'}`]
});
const results = [];
try {
    for (let run = 0; run < runs; run++) {
        const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
        let bytes = 0;
        let requests = 0;
        let hits = 0;
        let lastNetwork = performance.now();
        const pending = new Set();
        const samples = [];
        const started = new Map();
        page.on('request', req => {
            if (!req.url().includes('/api/geoscan?')) return;
            pending.add(req);
            started.set(req, performance.now());
            lastNetwork = performance.now();
        });
        const finished = req => { pending.delete(req); lastNetwork = performance.now(); };
        page.on('requestfinished', finished);
        page.on('requestfailed', finished);
        page.on('response', response => {
            if (!response.url().includes('/api/geoscan?') || response.status() !== 206) return;
            const headers = response.headers();
            bytes += Number(headers['content-length'] ?? 0);
            requests++;
            hits += Number(headers['x-geoscan-cache'] === 'HIT');
            samples.push(Math.round(performance.now() - started.get(response.request())));
        });
        const url = new URL(base);
        url.searchParams.set('load', source);
        url.searchParams.set('lang', 'ru');
        url.searchParams.set('webgl', '');
        const start = performance.now();
        await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await page.waitForFunction(() => window.viewer?.observer.get('ui.error') ||
            window.viewer?.tileManager?.getVisibleMeshInstances().length > 0, null, { timeout: 120000 });
        const error = await page.evaluate(() => window.viewer.observer.get('ui.error'));
        if (error) throw new Error(error);
        const firstGeometryMs = Math.round(performance.now() - start);
        const startupBytes = bytes;
        const startupRequests = requests;
        const zoomStart = performance.now();
        await page.evaluate(() => {
            const viewer = window.viewer;
            const bounds = viewer.tileManager.bounds;
            const position = bounds.center.clone();
            const distance = bounds.halfExtents.length() * 0.4;
            position.x += distance * 0.6;
            position.y += distance * 0.8;
            position.z += distance * 0.7;
            viewer.cameraControls.reset(bounds.center, position);
            viewer.renderNextFrame();
        });
        let settled = false;
        while (performance.now() - zoomStart < 45000) {
            // eslint-disable-next-line no-await-in-loop -- measure completion across real frames
            await page.waitForTimeout(250);
            // eslint-disable-next-line no-await-in-loop
            const idle = await page.evaluate(() => {
                const manager = window.viewer.tileManager;
                return manager.queue.running === 0 && manager.queue.pending === 0;
            });
            if (idle && pending.size === 0 && performance.now() - lastNetwork > 1000) { settled = true; break; }
        }
        const result = {
            label, run: run + 1, firstGeometryMs, startupBytes, startupRequests,
            zoomMs: Math.round(performance.now() - zoomStart), zoomSettled: settled,
            bytes, requests, serverCacheHits: hits,
            responseLatencyMs: samples,
            meshes: await page.evaluate(() => window.viewer.tileManager.getVisibleMeshInstances().length)
        };
        results.push(result);
        console.log(JSON.stringify(result));
        await page.close();
    }
    await mkdir('benchmark-results', { recursive: true });
    const output = path.join('benchmark-results', `geoscan-${label}-${Date.now()}.json`);
    await writeFile(output, JSON.stringify({ source, results }, null, 2));
    console.log(`Saved ${output}`);
} finally { await browser.close(); }
