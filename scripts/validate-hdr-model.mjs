import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
const assets = process.env.HDR_ASSETS ?? 'http://127.0.0.1:4179/';
const output = process.env.HDR_OUTPUT ?? '/Volumes/WORK/exr/viewer-preview';
const browser = await chromium.launch({ channel: 'chrome', headless: false });
try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:4178/?webgpu&load=${encodeURIComponent(assets+'Person003-preview.glb')}`);
    await page.waitForFunction(() => window.viewer?.observer.get('scene.unlit') && !window.viewer.observer.get('ui.spinner'), null, { timeout: 120000 });
    const report = [];
    for (const manifest of ['Person003-4k.surface.json', 'compressed.surface.json', 'compressed-float.surface.json']) {
        const stats = await page.evaluate(async ({ assets, manifest }) => {
            const v = window.viewer, start = performance.now();
            await v.loadHdrSurface(assets+manifest);
            await new Promise(resolve => { v.app.once('postrender', resolve); v.renderNextFrame(); });
            const pixels = new Uint8Array((await v.readDisplayPixels(v.camera.camera.renderTarget.colorBuffer)).buffer);
            let comparison = null;
            if (!window.__referencePixels) window.__referencePixels = pixels;
            else {
                const reference = window.__referencePixels;
                let sum = 0, max = 0, count = 0; const histogram = new Uint32Array(256);
                for (let i=0;i<pixels.length;i++) {
                    if(i%4===3 || reference[i-i%4+3]<250) continue;
                    const difference = Math.abs(pixels[i]-reference[i]);
                    sum += difference*difference; max = Math.max(max,difference); histogram[difference]++; count++;
                }
                let accumulated=0,p95=0;
                for(let i=0;i<256;i++){accumulated+=histogram[i];if(accumulated>=count*.95){p95=i;break;}}
                comparison={rmse8bit:Math.sqrt(sum/count),maxError8bit:max,p95Error8bit:p95,samples:count};
            }
            return { manifest, loadAndFirstReadMs:performance.now()-start, bytes:v.observer.get('runtime.hdrTextureBytes'),
                format:v.hdrSurface.textures[0].format, encoding:v.hdrSurface.textures[0].encoding, comparison };
        },{assets,manifest});
        console.log(JSON.stringify(stats)); report.push(stats);
        const png = await page.evaluate(async () => Array.from(await window.viewer.captureViewportImage()));
        await writeFile(`${output}/${manifest.replace('.surface.json','')}-viewport.png`,Buffer.from(png));
    }
    await writeFile(`${output}/viewer-validation.json`,JSON.stringify({date:new Date().toISOString(), errors, report,
        note:'Same view, same output mapping. Pixel errors compare SDR render of compressed texture against raw FP16; no monitor calibration.'},null,2));
    if(errors.length) throw new Error(errors.join('\n'));
} finally { await browser.close(); }
