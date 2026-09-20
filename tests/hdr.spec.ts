import { expect, test, type Page } from '@playwright/test';
import { hdrFixture } from '../scripts/hdr-fixtures.cjs';

// Половина случаев здесь — под WebGPU, а на машине без видеокарты адаптера нет вовсе: вьюер
// перезагружается на `auto` и рисует через WebGL, после чего проверки про WebGPU падают не по
// делу. Спрашиваем адаптер и пропускаем такие случаи честно.
//
// Спрашивать надо на самой странице: на `about:blank` защищённого контекста нет, `navigator.gpu`
// там отсутствует даже там, где адаптер есть, и проба молча скашивала все случаи подряд.
let webgpuProbe: Promise<boolean> | null = null;
const webgpuAvailable = (page: Page): Promise<boolean> => {
    webgpuProbe ??= (async () => {
        await page.goto('/');
        return page.evaluate(async () => {
            const gpu = (navigator as unknown as { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu;
            if (!gpu) return false;
            try {
                return !!(await gpu.requestAdapter());
            } catch {
                return false;
            }
        });
    })();
    return webgpuProbe;
};

/**
 * Рисует ли эта машина программно.
 *
 * Тесты, сравнивающие пиксели, на SwiftShader расходятся с ожиданиями на порядок — проверено:
 * те же случаи на настоящей видеокарте проходят. Пропускаем их, а не подгоняем допуски: с
 * широким допуском они перестанут ловить то, ради чего написаны.
 *
 * @param page - Страница теста.
 * @returns `true`, если растеризатор программный.
 */
const softwareRenderer = (page: Page): Promise<boolean> => page.evaluate(() => {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    return /swiftshader|llvmpipe|software/i.test(String(renderer ?? ''));
});

test.beforeEach(async ({ page }, testInfo) => {
    if (!testInfo.title.includes('webgpu')) return;
    test.skip(!await webgpuAvailable(page), 'на этой машине нет адаптера WebGPU');
});

for (const backend of ['webgl', 'webgpu']) {
    test(`HDR surface keeps radiance until output and restores GLB (${backend})`, async ({ page }) => {
        const fixture = hdrFixture();
        const hdrRequests: string[] = [];
        page.on('request', request => { if (request.url().includes('/lib/ktx-hdr/')) hdrRequests.push(request.url()); });
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
        await page.route('**/hdr-model.glb', route => route.fulfill({ body: fixture.model }));
        await page.route('**/test.surface.json', route => route.fulfill({ json: fixture.manifest }));
        await page.route('**/texture.bin', route => route.fulfill({ body: fixture.texture }));
        await page.goto(`/?${backend}&load=hdr-model.glb`);
        await page.waitForFunction(() => (window as any).viewer?.observer.get('scene.unlit') && !(window as any).viewer.observer.get('ui.spinner'));
        await page.waitForTimeout(1500);
        const before = await page.evaluate(() => {
            const v = (window as any).viewer;
            (window as any).__hdrOriginalMaterial = v.meshInstances[0].material;
            return { format: v.camera.camera.renderTarget.colorBuffer.format, gamma: v.camera.camera.gammaCorrection };
        });
        await expect(page.locator('#hdr-button')).toHaveCount(0);
        expect(hdrRequests).toEqual([]);
        await page.evaluate(() => { const o = (window as any).viewer.observer; o.set('camera.multisample', false); o.set('camera.sharpness', 0); o.set('camera.easu', false); });
        await page.evaluate(() => (window as any).viewer.loadHdrSurface(new URL('test.surface.json', location.href).href));
        await page.waitForFunction(() => (window as any).viewer.camera.camera.renderTarget?.colorBuffer?.name === 'viewer-rt-texture' && (window as any).viewer.hdrCameraState.size > 0);
        const radiance = await page.evaluate(async () => {
            const v = (window as any).viewer;
            const rt = v.camera.camera.renderTarget;
            const data = await rt.colorBuffer.read(Math.floor(rt.width / 2), Math.floor(rt.height / 2), 1, 1, { renderTarget: rt, immediate: true });
            return { words: Array.from(data), type: data.constructor.name, gamma: v.camera.camera.gammaCorrection,
                format: rt.colorBuffer.format, bytes: v.observer.get('runtime.hdrTextureBytes'), post: !!v.postProcessingFrame };
        });
        expect(radiance.format).not.toBe(before.format);
        expect(radiance.gamma).toBe(0);
        expect(radiance.post).toBe(false);
        expect(radiance.bytes).toBe(fixture.texture.length);
        // WebGL implementations may return float32; WebGPU float16 reads return bit patterns.
        expect(radiance.words[0]).toBeCloseTo(radiance.type === 'Uint16Array' ? 0x4400 : 4, 1);
        await expect(page.locator('#hdr-button')).toBeVisible();
        const readDisplay = () => page.evaluate(async () => {
            const v = (window as any).viewer;
            const texture = v.camera.camera.renderTarget.colorBuffer;
            const pixels = await v.readDisplayPixels(texture);
            const bytes = new Uint8Array(pixels.buffer);
            return bytes[(Math.floor(texture.height / 2) * texture.width + Math.floor(texture.width / 2)) * 4];
        });
        await page.evaluate(() => (window as any).viewer.observer.set('runtime.hdrRequested', false));
        const bright = await readDisplay();
        await page.evaluate(() => (window as any).viewer.observer.set('camera.hdrExposure', -4));
        const dim = await readDisplay();
        // Reinhard(4) = .8 -> sRGB .906; Reinhard(4/16) = .2 -> sRGB .485.
        expect(bright).toBeGreaterThan(225); expect(bright).toBeLessThan(237);
        expect(dim).toBeGreaterThan(117); expect(dim).toBeLessThan(130);
        await page.screenshot({ path: `/tmp/model-viewer-hdr-${backend}.png` });
        await page.evaluate(() => (window as any).viewer.clearHdrSurface());
        await page.waitForFunction(format => (window as any).viewer.camera.camera.renderTarget?.colorBuffer.format === format, before.format);
        expect(await page.evaluate(() => (window as any).viewer.meshInstances[0].material === (window as any).__hdrOriginalMaterial)).toBe(true);
        await expect(page.locator('#hdr-button')).toHaveCount(0);
        expect(errors.filter(error => !error.includes('404'))).toEqual([]);
    });
}

test('HDR rejects invalid payload and preserves the standard GLB', async ({ page }) => {
    const fixture = hdrFixture();
    await page.route('**/hdr-model.glb', route => route.fulfill({ body: fixture.model }));
    await page.route('**/bad.surface.json', route => route.fulfill({ json: fixture.manifest }));
    const invalid = Buffer.from(fixture.texture); invalid.writeUInt16LE(0x7c00, 0);
    await page.route('**/texture.bin', route => route.fulfill({ body: invalid }));
    await page.goto('/?webgl&load=hdr-model.glb');
    await page.waitForFunction(() => (window as any).viewer?.observer.get('scene.unlit') && !(window as any).viewer.observer.get('ui.spinner'));
    const result = await page.evaluate(async () => {
        const v = (window as any).viewer;
        const material = v.meshInstances[0].material;
        let error = '';
        try { await v.loadHdrSurface(new URL('bad.surface.json', location.href).href); } catch (e) { error = String(e); }
        return { error, unchanged: material === v.meshInstances[0].material, active: v.observer.get('runtime.hdrSource') };
    });
    expect(result.error).toContain('invalid sample');
    expect(result.unchanged).toBe(true);
    expect(result.active).toBe(false);
});

test('HDR canvas and SDR toggle work with emulated display capability (webgpu)', async ({ page }) => {
    const fixture = hdrFixture();
    await page.addInitScript(() => {
        const original = window.matchMedia.bind(window);
        window.matchMedia = query => {
            const media = original(query);
            if (query === '(dynamic-range: high)') Object.defineProperty(media, 'matches', { get: () => true });
            return media;
        };
    });
    await page.route('**/hdr-model.glb', route => route.fulfill({ body: fixture.model }));
    await page.route('**/test.surface.json', route => route.fulfill({ json: fixture.manifest }));
    await page.route('**/texture.bin', route => route.fulfill({ body: fixture.texture }));
    await page.goto('/?webgpu&load=hdr-model.glb');
    await page.waitForFunction(() => (window as any).viewer?.observer.get('scene.unlit') && !(window as any).viewer.observer.get('ui.spinner'));
    await page.evaluate(() => { const o = (window as any).viewer.observer; o.set('camera.multisample', false); o.set('camera.sharpness', 0); o.set('camera.easu', false); });
        await page.evaluate(() => (window as any).viewer.loadHdrSurface(new URL('test.surface.json', location.href).href));
    await page.waitForFunction(() => (window as any).viewer?.observer.get('runtime.hdrSource') && (window as any).viewer.hdrCameraState.size > 0);
    expect(await page.evaluate(() => (window as any).viewer.app.graphicsDevice.deviceType)).toBe('webgpu');
    await expect(page.locator('#hdr-button')).toHaveClass(/hdr-active/);
    const value = await page.evaluate(async () => {
        const v = (window as any).viewer;
        const source = v.camera.camera.renderTarget.colorBuffer;
        const output = new source.constructor(v.app.graphicsDevice, { width: source.width, height: source.height, format: source.format, mipmaps: false });
        const rt = new v.camera.camera.renderTarget.constructor({ colorBuffer: output, depth: false });
        try {
            v.hdrOutput.render(source, 0, true, rt);
            const values = await output.read(Math.floor(output.width / 2), Math.floor(output.height / 2), 1, 1, { renderTarget: rt, immediate: true });
            const word = values[0];
            return values.constructor.name === 'Uint16Array' ? (1 + (word & 1023) / 1024) * 2 ** (((word >> 10) & 31) - 15) : word;
        } finally { rt.destroy(); output.destroy(); }
    });
    expect(value).toBeCloseTo(1.055 * 4 ** (1 / 2.4) - .055, 2);
    await page.locator('#hdr-button').click();
    await expect(page.locator('#hdr-button')).toHaveClass(/hdr-inactive/);
    expect(await page.evaluate(() => (window as any).viewer.observer.get('runtime.hdrSource'))).toBe(true);
    await page.locator('#hdr-button').click();
    await expect(page.locator('#hdr-button')).toHaveClass(/hdr-active/);
    await page.evaluate(() => (window as any).viewer.clearHdrSurface());
    const restored = await page.evaluate(() => {
        const device = (window as any).viewer.app.graphicsDevice;
        return { hdr: device.isHdr, format: device.gpuContext.getConfiguration().format };
    });
    expect(restored.hdr).toBe(false);
    expect(restored.format).not.toBe('rgba16float');
});

for (const backend of ['webgl', 'webgpu']) {
for (const codec of ['4x4', '6x6']) {
    for (const target of ['auto', 'rgba16f']) {
        test(`UASTC HDR ${codec} -> ${target} keeps values above one (${backend})`, async ({ page }) => {
            const fixture = hdrFixture(16);
            const manifest = { ...fixture.manifest, format: 'uastc-hdr-ktx2', transcodeTarget: target,
                textures: [{ material: 0, uri: `static/test-assets/hdr-uastc-${codec}.ktx2`, width: 16, height: 16 }] };
            const errors: string[] = [];
            page.on('pageerror', error => errors.push(error.message));
            await page.route('**/hdr-model.glb', route => route.fulfill({ body: fixture.model }));
            await page.route('**/ktx.surface.json', route => route.fulfill({ json: manifest }));
            await page.goto(`/?${backend}&load=hdr-model.glb`);
            await page.waitForFunction(() => (window as any).viewer?.observer.get('scene.unlit') && !(window as any).viewer.observer.get('ui.spinner'));
            await page.evaluate(() => { const o = (window as any).viewer.observer; o.set('camera.multisample', false); o.set('camera.sharpness', 0); o.set('camera.easu', false); });
        await page.evaluate(() => (window as any).viewer.loadHdrSurface(new URL('ktx.surface.json', location.href).href));
            await page.waitForFunction(() => (window as any).viewer.hdrCameraState.size > 0);
            const actual = await page.evaluate(async () => {
                const v = (window as any).viewer, rt = v.camera.camera.renderTarget;
                const samples = await rt.colorBuffer.read(Math.floor(rt.width / 2), Math.floor(rt.height / 2), 1, 1, { renderTarget: rt, immediate: true });
                const word = samples[0];
                return { radiance: samples.constructor.name === 'Uint16Array' ? (1 + (word & 1023) / 1024) * 2 ** (((word >> 10) & 31) - 15) : word,
                    bytes: v.observer.get('runtime.hdrTextureBytes'),
                    bc6: v.app.graphicsDevice.isWebGPU ? !!v.app.graphicsDevice.extCompressedTextureS3TC : !!v.app.graphicsDevice.extTextureCompressionBPTC,
                    encoding: v.hdrSurface.textures[0].encoding };
            });
            expect(actual.radiance).toBeCloseTo(4, 1);
            expect(actual.encoding).toBe('linear');
            expect(actual.bytes).toBe(target === 'auto' && actual.bc6 ? 368 : fixture.texture.length);
            expect(errors).toEqual([]);
        });
    }
}

}

test('HDR KTX rejects a mismatched manifest without changing GLB materials', async ({ page }) => {
    const fixture = hdrFixture(32);
    const manifest = { ...fixture.manifest, format: 'uastc-hdr-ktx2',
        textures: [{ material: 0, uri: 'static/test-assets/hdr-uastc-4x4.ktx2', width: 32, height: 32 }] };
    await page.route('**/hdr-model.glb', route => route.fulfill({ body: fixture.model }));
    await page.route('**/bad.surface.json', route => route.fulfill({ json: manifest }));
    await page.goto('/?webgpu&load=hdr-model.glb');
    await page.waitForFunction(() => (window as any).viewer?.observer.get('scene.unlit') && !(window as any).viewer.observer.get('ui.spinner'));
    const result = await page.evaluate(async () => {
        const v = (window as any).viewer, original = v.meshInstances[0].material;
        let error = '';
        try { await v.loadHdrSurface(new URL('bad.surface.json', location.href).href); } catch (e) { error = String(e); }
        return { error, unchanged: v.meshInstances[0].material === original, active: v.observer.get('runtime.hdrSource') };
    });
    expect(result.error).toContain('dimensions/mips');
    expect(result.unchanged).toBe(true);
    expect(result.active).toBe(false);
});

for (const backend of ['webgl', 'webgpu']) {
    test(`HDR SDR export preserves spatial placement (${backend})`, async ({ page }) => {
        const fixture = hdrFixture(64);
        let offset = 0;
        for (let size = 64;; size = Math.max(1, size >> 1)) {
            for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
                fixture.texture.writeUInt16LE(y < size / 2 ? 0x4400 : 0x3c00, offset);
                fixture.texture.writeUInt16LE(x < size / 2 ? 0x3c00 : 0x4000, offset + 2);
                fixture.texture.writeUInt16LE(y < size / 2 ? 0x3c00 : 0x4400, offset + 4);
                offset += 8;
            }
            if (size === 1) break;
        }
        await page.route('**/hdr-model.glb', route => route.fulfill({ body: fixture.model }));
        await page.route('**/test.surface.json', route => route.fulfill({ json: fixture.manifest }));
        await page.route('**/texture.bin', route => route.fulfill({ body: fixture.texture }));
        await page.goto(`/?${backend}&load=hdr-model.glb`);
        await page.waitForFunction(() => (window as any).viewer?.observer.get('scene.unlit') && !(window as any).viewer.observer.get('ui.spinner'));
        await page.evaluate(() => { const o = (window as any).viewer.observer; o.set('camera.multisample', false); o.set('camera.sharpness', 0); o.set('camera.easu', false); });
        await page.evaluate(() => (window as any).viewer.loadHdrSurface(new URL('test.surface.json', location.href).href));
        await page.waitForFunction(() => (window as any).viewer?.hdrCameraState.size > 0);
        const result = await page.evaluate(async () => {
            const v = (window as any).viewer, rt = v.camera.camera.renderTarget;
            const raw = await rt.colorBuffer.read(0, 0, rt.width, rt.height, { renderTarget: rt, immediate: true });
            const converted = await v.readDisplayPixels(rt.colorBuffer);
            const display = new Uint8Array(converted.buffer);
            const decode = (word: number) => raw.constructor.name === 'Uint16Array' ?
                ((word >> 10) & 31 ? 1 + (word & 1023) / 1024 : (word & 1023) / 1024) *
                2 ** (((word >> 10) & 31 ? (word >> 10) & 31 : 1) - 15) : word;
            let checked = 0, maxError = 0;
            for (let i = 0; i < raw.length; i += 4 * 137) {
                if (decode(raw[i + 3]) < .99) continue;
                const rgb = [decode(raw[i]), decode(raw[i + 1]), decode(raw[i + 2])];
                const lum = rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
                const mapped = rgb.map(c => c / (1 + lum));
                const peak = Math.max(1, ...mapped);
                for (let channel = 0; channel < 3; channel++) {
                    const c = mapped[channel] / peak;
                    const expected = 255 * (c <= .0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - .055);
                    maxError = Math.max(maxError, Math.abs(display[i + channel] - expected));
                }
                checked++;
            }
            v.observer.set('camera.sharpness', 1);
            const sharpened = new Uint8Array((await v.readDisplayPixels(rt.colorBuffer)).buffer);
            let difference = 0;
            for (let i = 0; i < display.length; i++) difference += Math.abs(sharpened[i] - display[i]);
            return { checked, maxError, spatialMeanError: difference / display.length };
        });
        expect(result.checked).toBeGreaterThan(100);
        expect(result.maxError).toBeLessThan(3);
        expect(result.spatialMeanError).toBeLessThan(2);
    });
}

for (const backend of ['webgl', 'webgpu']) {
    test(`Embedded HDR GLB loads without texture sidecars and labels Base Color (${backend})`, async ({ page }) => {
        const { embedHdrGlb } = require('../scripts/embed-hdr-glb.cjs');
        const { readFileSync } = require('node:fs');
        const fixture = hdrFixture(16);
        const model = embedHdrGlb(fixture.model, readFileSync('static/test-assets/hdr-uastc-4x4.ktx2'));
        const requests: string[] = [];
        const errors: string[] = [];
        page.on('request', request => requests.push(request.url()));
        page.on('pageerror', error => errors.push(error.message));
        await page.route('**/embedded.glb', route => route.fulfill({ body: model }));
        await page.route('**/ordinary.glb', route => route.fulfill({ body: fixture.model }));
        await page.goto(`/?${backend}&load=embedded.glb`);
        await page.waitForFunction(() => (window as any).viewer?.observer.get('runtime.hdrSource') && (window as any).viewer.hdrCameraState.size > 0);
        const state = await page.evaluate(async () => {
            const v = (window as any).viewer;
            const formats = JSON.parse(v.observer.get('scene.materialChannelFormats'));
            const rt = v.camera.camera.renderTarget;
            const data = await rt.colorBuffer.read(Math.floor(rt.width / 2), Math.floor(rt.height / 2), 1, 1, { renderTarget: rt, immediate: true });
            return { formats, sample: data[0], type: data.constructor.name, name: v.meshInstances[0].material.name,
                lit: v.meshInstances[0].material.useLighting };
        });
        expect(state.formats.albedo.hdr).toBe(true);
        expect(state.formats.albedo.container).toBe('KTX2');
        expect(state.formats.emission).toBeUndefined();
        expect(state.name).not.toContain('[HDR]');
        expect(state.lit).toBe(false);
        expect(state.sample).toBeGreaterThan(0);
        expect(requests.filter(url => /\.surface\.json|\.ktx2(?:$|\?)|\.bin(?:$|\?)/.test(url))).toEqual([]);
        await expect(page.locator('#hdr-button')).toHaveClass(/hdr-inactive/);
        expect(await page.locator('#hdr-button').evaluate(element => getComputedStyle(element).textDecorationLine)).toBe('line-through');
        await page.evaluate(() => (window as any).viewer.loadFiles([{ url: new URL('ordinary.glb', location.href).href, filename: 'ordinary.glb' }], true));
        await page.waitForFunction(() => !(window as any).viewer.observer.get('runtime.hdrSource'));
        expect(errors).toEqual([]);
    });
}

for (const backend of ['webgl', 'webgpu']) {
    test(`HDR post effects preserve highlights and SDR LUT is bypassed for HDR (${backend})`, async ({ page }) => {
        test.skip(await softwareRenderer(page), 'программный растеризатор: сравнение пикселей тут не показательно');
        const fixture = hdrFixture(64);
        await page.route('**/hdr-model.glb', route => route.fulfill({ body: fixture.model }));
        await page.route('**/test.surface.json', route => route.fulfill({ json: fixture.manifest }));
        await page.route('**/texture.bin', route => route.fulfill({ body: fixture.texture }));
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('console', msg => { if (msg.type() === 'error' && !msg.text().includes('404')) errors.push(msg.text()); });
        await page.goto(`/?${backend}&load=hdr-model.glb`);
        await page.waitForFunction(() => (window as any).viewer?.observer.get('scene.unlit') && !(window as any).viewer.observer.get('ui.spinner'));
        await page.evaluate(() => (window as any).viewer.loadHdrSurface(new URL('test.surface.json', location.href).href));
        for (const effect of ['camera.multisample', 'camera.taa', 'camera.ssao']) {
            await page.evaluate(effect => {
                const o = (window as any).viewer.observer;
                for (const key of ['camera.taa', 'camera.multisample', 'camera.ssao']) o.set(key, false);
                o.set(effect, true);
            }, effect);
            await page.waitForTimeout(500);
            const state = await page.evaluate(async () => {
                const v = (window as any).viewer, rt = v.camera.camera.renderTarget;
                const raw = await rt.colorBuffer.read(Math.floor(rt.width / 2), Math.floor(rt.height / 2), 1, 1, { renderTarget: rt, immediate: true });
                const word = raw[0];
                const encoded = raw.constructor.name === 'Uint16Array' ? (1 + (word & 1023) / 1024) * 2 ** (((word >> 10) & 31) - 15) : word;
                return { value: encoded ** 2.2, frame: !!v.postProcessingFrame, format: rt.colorBuffer.format };
            });
            expect(state.frame).toBe(true);
            expect(state.format).toBe(12);
            expect(state.value).toBeGreaterThan(3.5);
            expect(state.value).toBeLessThan(4.2);
        }
        const result = await page.evaluate(async () => {
            const v = (window as any).viewer;
            const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 16;
            const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, 256, 16);
            const blob = await new Promise<Blob>(resolve => canvas.toBlob(resolve));
            await v.loadColorLut(new File([blob], 'red-lut.png', { type: 'image/png' }));
            await new Promise(resolve => { v.app.once('postrender', resolve); v.renderNextFrame(); });
            const source = v.camera.camera.renderTarget.colorBuffer;
            const output = new source.constructor(v.app.graphicsDevice, { width: source.width, height: source.height, format: 12, mipmaps: false });
            const rt = new v.camera.camera.renderTarget.constructor({ colorBuffer: output, depth: false });
            const read = async (hdr: boolean, intensity: number) => {
                v.hdrOutput.render(source, 0, hdr, rt, true, v.colorLutTexture, intensity, { easu: true, sharpness: 1 });
                const raw = await output.read(Math.floor(output.width / 2), Math.floor(output.height / 2), 1, 1, { renderTarget: rt, immediate: true });
                return Array.from(raw).slice(0, 3).map((word: number) => raw.constructor.name === 'Uint16Array' ?
                    ((word >> 10) & 31 ? 1 + (word & 1023) / 1024 : (word & 1023) / 1024) * 2 ** (((word >> 10) & 31 ? (word >> 10) & 31 : 1) - 15) : word);
            };
            try { return { sdr: await read(false, 1), hdr: await read(true, 1), unchanged: await read(true, 0) }; }
            finally { rt.destroy(); output.destroy(); }
        });
        expect(result.sdr[0]).toBeCloseTo(1, 2);
        expect(result.sdr[1]).toBeLessThan(.01);
        expect(result.hdr[0]).toBeGreaterThan(1);
        expect(result.hdr).toEqual(result.unchanged);
        expect(errors).toEqual([]);
    });
}

test('HDR exposure starts at zero despite stale browser preferences and resets for a new model', async ({ page }) => {
    const fixture = hdrFixture();
    await page.addInitScript(() => localStorage.setItem('model-viewer-uistate', JSON.stringify({ camera: { hdrExposure: -12.93 } })));
    await page.route('**/exposure-model.glb', route => route.fulfill({ body: fixture.model }));
    await page.route('**/second-model.glb', route => route.fulfill({ body: fixture.model }));
    await page.goto('/?webgpu&load=exposure-model.glb');
    await page.waitForFunction(() => (window as any).viewer?.observer.get('scene.unlit') && !(window as any).viewer.observer.get('ui.spinner'));
    expect(await page.evaluate(() => (window as any).viewer.observer.get('camera.hdrExposure'))).toBe(0);
    await page.evaluate(() => {
        const v = (window as any).viewer;
        v.observer.set('camera.hdrExposure', -16);
        v.loadFiles([{ url: new URL('second-model.glb', location.href).href, filename: 'second-model.glb' }], true);
    });
    await page.waitForFunction(() => (window as any).viewer.observer.get('scene.filenames')?.[0] === 'second-model.glb' && !(window as any).viewer.observer.get('ui.spinner'));
    expect(await page.evaluate(() => (window as any).viewer.observer.get('camera.hdrExposure'))).toBe(0);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('model-viewer-uistate') || '{}').camera?.hdrExposure);
    expect(saved).toBeUndefined();
});

for (const backend of ['webgl', 'webgpu']) {
    test(`Embedded HDR preserves Lit PBR and responds to lighting (${backend})`, async ({ page }) => {
        test.skip(await softwareRenderer(page), 'программный растеризатор: сравнение пикселей тут не показательно');
        const { embedHdrGlb } = require('../scripts/embed-hdr-glb.cjs');
        const { readFileSync } = require('node:fs');
        // Original Khronos Lit fixture: no material-type conversion during preparation.
        const original = readFileSync('static/test-assets/BoxTextured.glb');
        const model = embedHdrGlb(original, readFileSync('static/test-assets/hdr-uastc-4x4.ktx2'));
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
        await page.route('**/lit-hdr.glb', route => route.fulfill({ body: model }));
        await page.goto(`/?${backend}&load=lit-hdr.glb`);
        await page.waitForFunction(() => (window as any).viewer?.observer.get('runtime.hdrSource'));
        const state = await page.evaluate(() => {
            const v = (window as any).viewer;
            const m = v.meshInstances[0].material;
            const original = v.entityAssets[0].asset.resource.materials[0].resource;
            const keys = ['useLighting', 'metalness', 'gloss', 'emissiveMap', 'normalMap', 'opacityMap', 'opacity', 'blendType', 'diffuseMapUv', 'diffuseMapRotation'];
            const preserved = keys.every(key => m[key] === original[key]) && m.diffuse.equals(original.diffuse) && m.diffuseMapTiling.equals(original.diffuseMapTiling) && m.diffuseMapOffset.equals(original.diffuseMapOffset);
            v.observer.set('camera.multisample', false);
            v.observer.set('camera.taa', false);
            v.observer.set('camera.ssao', false);
            v.observer.set('camera.sharpness', 0);
            v.observer.set('camera.easu', false);
            v.app.root.findComponents('light').forEach(light => { light.enabled = false; });
            v.app.scene.skyboxIntensity = 0;
            v.app.scene.ambientLight.set(0, 0, 0);
            v.renderNextFrame();
            return { lit: m.useLighting, preserved, replacement: m.diffuseMap !== original.diffuseMap,
                formats: JSON.parse(v.observer.get('scene.materialChannelFormats')) };
        });
        expect(state.lit).toBe(true);
        expect(state.preserved).toBe(true);
        expect(state.replacement).toBe(true);
        expect(state.formats.albedo.hdr).toBe(true);
        expect(state.formats.emission).toBeUndefined();
        const sample = async () => {
            await page.waitForTimeout(300);
            return page.evaluate(async () => {
                const v = (window as any).viewer;
                const t = v.camera.camera.renderTarget.colorBuffer;
                const pixels = await v.readDisplayPixels(t);
                return new Uint8Array(pixels.buffer)[(Math.floor(t.height / 2) * t.width + Math.floor(t.width / 2)) * 4];
            });
        };
        const dark = await sample();
        await page.evaluate(() => {
            const v = (window as any).viewer;
            v.light.light.enabled = true;
            v.light.light.intensity = 5;
            v.renderNextFrame();
        });
        const bright = await sample();
        expect(dark).toBeLessThan(5);
        expect(bright).toBeGreaterThan(dark + 100);
        await page.evaluate(() => (window as any).viewer.clearHdrSurface());
        expect(await page.evaluate(() => {
            const v = (window as any).viewer;
            return v.meshInstances[0].material === v.entityAssets[0].asset.resource.materials[0].resource && v.meshInstances[0].material.useLighting;
        })).toBe(true);
        expect(errors.filter(error => !error.includes('404'))).toEqual([]);
    });
}

for (const backend of ['webgl', 'webgpu']) {
    test(`HDR PNG orientation matches the visible canvas (${backend})`, async ({ page }) => {
        const fixture = hdrFixture(64);
        let offset = 0;
        for (let size = 64;; size = Math.max(1, size >> 1)) {
            for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
                fixture.texture.writeUInt16LE(y < size / 2 ? 0x4400 : 0, offset);
                fixture.texture.writeUInt16LE(0, offset + 2);
                fixture.texture.writeUInt16LE(y < size / 2 ? 0 : 0x4400, offset + 4);
                offset += 8;
            }
            if (size === 1) break;
        }
        await page.route('**/hdr-model.glb', route => route.fulfill({ body: fixture.model }));
        await page.route('**/test.surface.json', route => route.fulfill({ json: fixture.manifest }));
        await page.route('**/texture.bin', route => route.fulfill({ body: fixture.texture }));
        await page.goto(`/?${backend}&load=hdr-model.glb`);
        await page.waitForFunction(() => (window as any).viewer?.meshInstances.length && !(window as any).viewer.observer.get('ui.spinner'));
        await page.evaluate(() => (window as any).viewer.loadHdrSurface(new URL('test.surface.json', location.href).href));
        for (const sharpness of [0, 1]) {
            await page.evaluate(sharpness => {
                const o = (window as any).viewer.observer;
                o.set('runtime.hdrRequested', false);
                o.set('camera.taa', false); o.set('camera.ssao', false);
                o.set('camera.sharpness', sharpness); o.set('camera.easu', true);
            }, sharpness);
            await page.waitForTimeout(400);
            const visible = await page.screenshot();
            const match = await page.evaluate(async visible => {
                const exported = await (window as any).viewer.captureViewportImage();
                const decode = async (bytes: number[]) => {
                    const image = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
                    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
                    const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0); image.close();
                    return ctx.getImageData(0, 0, canvas.width, canvas.height);
                };
                const screen = await decode(visible), png = await decode(Array.from(exported));
                let error = 0, count = 0;
                for (let y = Math.floor(png.height * .2); y < png.height * .7; y++) {
                    for (let x = Math.floor(png.width * .25); x < png.width * .75; x++) {
                        const i = (y * png.width + x) * 4;
                        if (png.data[i + 3] < 250) continue;
                        for (let c = 0; c < 3; c++) { error += Math.abs(png.data[i + c] - screen.data[i + c]); count++; }
                    }
                }
                return { count, meanError: error / count };
            }, Array.from(visible));
            expect(match.count).toBeGreaterThan(10000);
            expect(match.meanError).toBeLessThan(2);
        }
    });
}
