import { chromium } from '@playwright/test';
const browser = await chromium.launch({ headless: false });   // с окном, без swiftshader
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
await page.goto('http://127.0.0.1:4173/?load=static/test-assets/BoxTextured.glb');
await page.waitForFunction(() => (window.viewer?.meshInstances || []).length > 0, null, { timeout: 60000 });
const info = await page.evaluate(async () => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
    const deltas = [];
    let prev = 0;
    await new Promise((res) => {
        const t0 = performance.now();
        const tick = (t) => { if (prev) deltas.push(t - prev); prev = t;
            if (performance.now() - t0 < 3000) requestAnimationFrame(tick); else res(); };
        requestAnimationFrame(tick);
    });
    deltas.sort((a, b) => a - b);
    const q = p => deltas[Math.floor(deltas.length * p)];
    return {
        рендерер: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'нет данных',
        бэкендВьюера: window.viewer.graphicsBackend,
        кадров: deltas.length,
        медианаМс: +q(.5).toFixed(2),
        p95: +q(.95).toFixed(2)
    };
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
