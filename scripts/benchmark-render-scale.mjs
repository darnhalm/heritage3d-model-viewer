/* eslint-disable no-await-in-loop, no-undef */
// Замер стоимости кадра при разных camera.pixelScale.
// Живёт на той же схеме, что scripts/benchmark-navigation.mjs: настоящее окно Chromium
// (в headless-панели rAF душится и мерить нечего), орбита мышью как источник непрерывных
// кадров, интервалы снимаются по событию 'framerender'.

import { chromium } from '@playwright/test';

const baseUrl = process.env.BENCH_URL ?? 'http://127.0.0.1:4173/';
const model = process.env.BENCH_MODEL ?? 'models/JUMA_55000-lod/tiles/lod-meta.json';
const scales = (process.env.BENCH_SCALES ?? '1,2,4,4,2,1').split(',').map(Number);
const settleMs = Number(process.env.BENCH_SETTLE ?? 12000);

const median = (values) => {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return Number(sorted[Math.floor(sorted.length / 2)].toFixed(2));
};

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

await page.goto(`${baseUrl}?load=${encodeURIComponent(model)}`);
await page.waitForFunction(() => window.viewer?.entities?.length > 0, null, { timeout: 120000 });
// Сплаты тянутся уровнями: даём потоку успокоиться, иначе замер поймает загрузку.
await page.waitForTimeout(settleMs);

const canvas = page.locator('#application-canvas');
const box = await canvas.boundingBox();
const cx = box.x + box.width * 0.5;
const cy = box.y + box.height * 0.5;

const run = async (scale) => {
    await page.evaluate((s) => {
        window.viewer.observer.set('camera.pixelScale', s);
        window.viewer.renderNextFrame();
    }, scale);
    await page.waitForTimeout(700);

    await page.evaluate(() => {
        const samples = { intervals: [], last: 0 };
        window.__benchScale = samples;
        // Ссылку на обработчик держим: снимать его надо адресно. `app.off('framerender')`
        // без аргумента убирает ВСЕ обработчики события, включая собственный onFrameRender
        // вьюера — а он пересоздаёт цель рендера, и без него следующий масштаб не применится.
        samples.handler = () => {
            const now = performance.now();
            if (samples.last) samples.intervals.push(now - samples.last);
            samples.last = now;
        };
        window.viewer.app.on('framerender', samples.handler);
    });

    // Орбита: тот же рисунок движения, что в штатном стенде.
    await page.mouse.move(cx, cy);
    await page.mouse.down({ button: 'left' });
    for (let step = 1; step <= 120; step++) {
        const phase = step / 120;
        await page.mouse.move(
            cx + Math.sin(phase * Math.PI * 2) * 180,
            cy + Math.sin(phase * Math.PI * 4) * 90
        );
        await page.waitForTimeout(10);
    }
    await page.mouse.up({ button: 'left' });

    return page.evaluate(() => {
        const s = window.__benchScale;
        const rt = window.viewer.camera.camera.renderTarget;
        const d = window.viewer.app.graphicsDevice;
        window.viewer.app.off('framerender', s.handler);
        return {
            intervals: s.intervals,
            target: [rt.width, rt.height],
            backbuffer: [d.width, d.height],
            backend: window.viewer.graphicsBackend
        };
    });
};

const results = [];
for (const scale of scales) {
    const r = await run(scale);
    // Первые кадры после смены масштаба содержат пересоздание целей — отбрасываем.
    const usable = r.intervals.slice(5);
    results.push({
        scale,
        target: r.target.join('x'),
        backbuffer: r.backbuffer.join('x'),
        frames: usable.length,
        medianMs: median(usable),
        fps: usable.length ? Number((1000 / median(usable)).toFixed(1)) : 0
    });
    console.log(JSON.stringify(results[results.length - 1]));
}

console.log('\nbackend:', (await page.evaluate(() => window.viewer.graphicsBackend)));
console.table(results);

await browser.close();
