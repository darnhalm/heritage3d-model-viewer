import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

for (const backend of ['webgl', 'webgpu']) {
    for (const type of ['lit', 'unlit']) {
        test(`Blender exported ${type} HDR loads in ${backend}`, async ({ page }) => {
            const directory = process.env.HDR_ADDON_FIXTURES;
            if (!directory) throw new Error('Set HDR_ADDON_FIXTURES to the Blender integration test output directory');
            const errors: string[] = [];
            page.on('pageerror', error => errors.push(error.message));
            await page.route('**/addon.glb', route => route.fulfill({ body: readFileSync(join(directory, `${type}.glb`)) }));
            await page.goto(`/?${backend}&load=addon.glb`);
            await page.waitForFunction(() => (window as any).viewer?.observer.get('runtime.hdrSource'));
            const state = await page.evaluate(() => {
                const v = (window as any).viewer;
                for (const key of ['multisample', 'taa', 'ssao', 'easu']) v.observer.set(`camera.${key}`, false);
                v.observer.set('camera.sharpness', 0);
                return { lit: v.meshInstances[0].material.useLighting,
                    name: v.meshInstances[0].material.name,
                    formats: JSON.parse(v.observer.get('scene.materialChannelFormats')) };
            });
            expect(state.lit).toBe(type === 'lit');
            expect(state.name).toBe(type === 'lit' ? 'Original Lit' : 'Original Unlit');
            expect(state.formats.albedo.hdr).toBe(true);
            expect(state.formats.albedo.container).toBe('KTX2');
            if (type === 'unlit') {
                await page.waitForTimeout(400);
                const maxima = await page.evaluate(async () => {
                    const v = (window as any).viewer;
                    const rt = v.camera.camera.renderTarget;
                    const data = await rt.colorBuffer.read(0, 0, rt.width, rt.height, { renderTarget: rt, immediate: true });
                    const half = (n: number) => {
                        const e = (n >> 10) & 31, f = n & 1023;
                        return (n & 32768 ? -1 : 1) * (e ? Math.pow(2, e - 15) * (1 + f / 1024) : Math.pow(2, -14) * f / 1024);
                    };
                    let r = 0, b = 0;
                    for (let i = 0; i < data.length; i += 4) {
                        r = Math.max(r, data instanceof Uint16Array ? half(data[i]) : data[i]);
                        b = Math.max(b, data instanceof Uint16Array ? half(data[i + 2]) : data[i + 2]);
                    }
                    return { r, b };
                });
                expect(maxima.r).toBeGreaterThan(3.8); expect(maxima.r).toBeLessThan(4.2);
                expect(maxima.b).toBeGreaterThan(1.8); expect(maxima.b).toBeLessThan(2.2);
            }
            expect(errors).toEqual([]);
        });
    }
}

for (const backend of ['webgl', 'webgpu']) {
    test(`Combined HDR Base Color and KTX normal load in ${backend}`, async ({ page }) => {
        const directory = process.env.HDR_ADDON_FIXTURES;
        if (!directory) throw new Error('Set HDR_ADDON_FIXTURES');
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route('**/mixed.glb', route => route.fulfill({ body: readFileSync(join(directory, 'mixed.glb')) }));
        await page.goto(`/?${backend}&load=mixed.glb`);
        await page.waitForFunction(() => (window as any).viewer?.observer.get('runtime.hdrSource'));
        const state = await page.evaluate(() => {
            const v = (window as any).viewer;
            const m = v.meshInstances[0].material;
            return { lit: m.useLighting, normal: !!m.normalMap, normalWidth: m.normalMap?.width,
                formats: JSON.parse(v.observer.get('scene.materialChannelFormats')) };
        });
        expect(state.lit).toBe(true);
        expect(state.normal).toBe(true);
        expect(state.normalWidth).toBe(16);
        expect(state.formats.albedo.hdr).toBe(true);
        expect(errors).toEqual([]);
    });
}
