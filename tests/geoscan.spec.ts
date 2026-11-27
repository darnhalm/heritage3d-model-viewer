import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';

import { expect, test, type Page } from '@playwright/test';
import { TextReader, Uint8ArrayReader, Uint8ArrayWriter, ZipWriter } from '@zip.js/zip.js';

import { budget } from './budget';

const source = 'https://cloud.geoscan.ru/shared/projects/6ac432f9-21a7-4331-985b-0bf8af76df90';
const dataset = 'c081caf3-fe23-455e-8e38-e2df8ab97018';
const second = '74efa18d-a853-4099-a2a6-c5c76f6b58ed';
let archive: Uint8Array;

test.beforeAll(async () => {
    const writer = new ZipWriter(new Uint8ArrayWriter(), { useWebWorkers: false, dataDescriptor: false });
    await writer.add('tileset.json', new TextReader(JSON.stringify({
        asset: { version: '1.1' }, geometricError: 0,
        root: {
            boundingVolume: { box: [1000, 1000, 1000, 1024, 0, 0, 0, 1024, 0, 0, 0, 1024] },
            geometricError: 0,
            content: { uri: 'tile.glb', boundingVolume: { box: [0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0, 2] } }
        }
    })));
    await writer.add('tile.glb', new Uint8ArrayReader(await readFile(path.resolve('static/test-assets/BoxTextured.glb'))));
    await writer.add('padding.bin', new Uint8ArrayReader(new Uint8Array(512 * 1024)), { level: 0 });
    // A large legacy index forces a >512 KiB random-access read before the ZIP fallback.
    // The proxy must still receive only bounded requests, including during index parsing.
    await writer.add('@3dtilesIndex1@', new Uint8ArrayReader(new Uint8Array(24 * 60000)), { level: 0 });
    archive = await writer.close();
});

const mockGeoscan = async (page: Page, multiple = false, error?: string) => {
    const ranges: string[] = [];
    const requestedDatasets: string[] = [];
    let active = 0;
    let peak = 0;
    await page.route('**/api/geoscan?*', async (route) => {
        const req = route.request();
        const url = new URL(req.url());
        expect(url.searchParams.get('source')).toContain(source);
        if (url.searchParams.get('action') === 'resolve') {
            if (error) { await route.fulfill({ status: 403, json: { error } }); return; }
            await route.fulfill({ json: { name: 'Kizhi', source, datasets: [
                { id: dataset, name: 'Kizhi' }, ...(multiple ? [{ id: second, name: 'Church interior' }] : [])
            ] } });
            return;
        }
        requestedDatasets.push(url.searchParams.get('dataset'));
        const range = req.headers().range;
        expect(range).toBeTruthy();
        ranges.push(range);
        const suffix = /^bytes=-(\d+)$/.exec(range);
        const explicit = /^bytes=(\d+)-(\d+)$/.exec(range);
        const start = suffix ? Math.max(0, archive.length - Number(suffix[1])) : Number(explicit![1]);
        const end = suffix ? archive.length - 1 : Math.min(Number(explicit![2]), archive.length - 1);
        expect(end - start + 1).toBeLessThanOrEqual(512 * 1024);
        const body = Buffer.from(archive.subarray(start, end + 1));
        active++;
        peak = Math.max(peak, active);
        await new Promise(resolve => setTimeout(resolve, 35));
        await route.fulfill({ status: 206, body, headers: {
            'content-type': 'application/octet-stream', 'accept-ranges': 'bytes',
            'content-range': `bytes ${start}-${end}/${archive.length}`, 'content-length': String(body.length), etag: 'fixture-1'
        } });
        active--;
    });
    return { ranges, requestedDatasets, peak: () => peak };
};

const waitForTile = async (page: Page) => {
    await page.waitForFunction(() => (window as any).viewer?.getTileStats()?.ready > 0, { timeout: 30000 });
    expect(await page.evaluate(() => (window as any).viewer.observer.get('ui.error'))).toBeFalsy();
};

test('opens a public Geoscan project through bounded archive ranges and retains a stable share URL', async ({ page }) => {
    test.setTimeout(budget(120000));
    const { ranges, peak } = await mockGeoscan(page);
    const upstream: string[] = [];
    page.on('request', req => { if (req.url().startsWith('https://cloud.geoscan.ru/')) upstream.push(req.url()); });
    await page.goto(`/?webgl&lang=ru&load=${encodeURIComponent(source)}`);
    await waitForTile(page);
    const urls = await page.evaluate(() => (window as any).viewer.observer.get('scene.urls'));
    expect(new URL(urls[0]).searchParams.get('dataset')).toBe(dataset);
    expect(urls[0]).not.toContain('X-Amz');
    expect(ranges[0]).toBe('bytes=-65557');
    expect(upstream).toEqual([]);
    expect(peak()).toBeGreaterThan(1);
    expect(peak()).toBeLessThanOrEqual(4);
    const bounds = await page.evaluate(() => {
        const manager = (window as any).viewer.tileManager;
        return { frame: manager.bounds.halfExtents.toArray(), traversal: manager.rootTile.obb.halfAxes[0].length() };
    });
    bounds.frame.forEach((value: number) => expect(value).toBeCloseTo(2, 4));
    expect(bounds.traversal).toBeGreaterThan(1000);
});

test('URL input offers a dataset choice and opens the selected model', async ({ page }) => {
    test.setTimeout(budget(120000));
    const { requestedDatasets } = await mockGeoscan(page, true);
    await page.goto('/?webgl&lang=ru');
    const input = page.locator('#glb-url-input input');
    await input.fill(source);
    await input.press('End');
    await page.locator('#glb-url-button').click();
    const picker = page.locator('.geoscan-model-picker');
    await expect(picker).toBeVisible();
    await picker.locator('select').selectOption(second);
    await picker.getByRole('button', { name: 'Открыть модель', exact: true }).click();
    await waitForTile(page);
    expect(requestedDatasets.every(value => value === second)).toBe(true);
    expect(await page.evaluate(() => (window as any).viewer.observer.get('scene.filenames'))).toEqual(['Church interior.3tz']);
});

test('Geoscan uses baked colours by default and can restore the authored lighting', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('h3d.tour.v1.seen', '1'));
    await mockGeoscan(page);
    await page.goto(`/?webgl&lang=ru&load=${encodeURIComponent(source)}`);
    await page.waitForFunction(() => (window as any).viewer?.tileManager?.getVisibleMeshInstances().length > 0);
    await page.locator('#panel-toggle').click();
    await page.locator('.left-panel-tab-materials').click();
    await expect(page.locator('.tileset-lighting-control')).toContainText('Освещение модели');
    await expect(page.locator('.materials-layer-item-final-render')).toContainText('Unlit');
    const result = await page.evaluate(() => {
        const v = (window as any).viewer;
        const material = v.tileManager.getVisibleMeshInstances()[0].material;
        const automatic = { lit: material.useLighting, texture: !!material.emissiveMap, diffuse: !!material.diffuseMap };
        v.observer.set('camera.tilesetLighting', 'source');
        const sourceLit = material.useLighting;
        const texture = material.diffuseMap;
        material.diffuse.set(0.3, 0.6, 0.9);
        material.diffuseMapUv = 1;
        material.diffuseMapTiling.set(2, 3);
        material.diffuseMapOffset.set(0.1, 0.2);
        material.diffuseMapRotation = 20;
        material.opacity = 0.7;
        material.emissive.set(0.1, 0.2, 0.3);
        material.emissiveIntensity = 0.4;
        v.observer.set('camera.tilesetLighting', 'unlit');
        const baked = {
            lit: material.useLighting, sameTexture: material.emissiveMap === texture,
            colour: [material.emissive.r, material.emissive.g, material.emissive.b],
            uv: material.emissiveMapUv, tiling: material.emissiveMapTiling.toArray(),
            offset: material.emissiveMapOffset.toArray(), rotation: material.emissiveMapRotation, opacity: material.opacity
        };
        v.observer.set('camera.tilesetLighting', 'source');
        const restored = {
            lit: material.useLighting, sameTexture: material.diffuseMap === texture,
            colour: [material.diffuse.r, material.diffuse.g, material.diffuse.b],
            emission: [material.emissive.r, material.emissive.g, material.emissive.b],
            intensity: material.emissiveIntensity, opacity: material.opacity
        };
        // The box fixture has only TEXCOORD_0; inspect UV_1 synchronously without rendering it.
        material.diffuseMapUv = 0;
        v.observer.set('camera.tilesetLighting', 'auto');
        return { automatic, sourceLit, baked, restored, autoLit: material.useLighting, flag: v.observer.get('scene.tilesetLit') };
    });
    expect(result.automatic).toEqual({ lit: false, texture: true, diffuse: false });
    expect(result.sourceLit).toBe(true);
    expect(result.baked).toEqual({ lit: false, sameTexture: true, colour: [0.3, 0.6, 0.9], uv: 1, tiling: [2, 3], offset: [0.1, 0.2], rotation: 20, opacity: 0.7 });
    expect(result.restored).toEqual({ lit: true, sameTexture: true, colour: [0.3, 0.6, 0.9], emission: [0.1, 0.2, 0.3], intensity: 0.4, opacity: 0.7 });
    expect(result.autoLit).toBe(false);
    expect(result.flag).toBe(false);
});

test('closed access produces a localized error and stops the loading indicator', async ({ page }) => {
    test.setTimeout(budget(90000));
    await mockGeoscan(page, false, 'access_denied');
    await page.goto(`/?webgl&lang=ru&load=${encodeURIComponent(source)}`);
    await page.waitForFunction(() => !!(window as any).viewer?.observer.get('ui.error'));
    const state = await page.evaluate(() => ({
        error: (window as any).viewer.observer.get('ui.error'), spinner: (window as any).viewer.observer.get('ui.spinner')
    }));
    expect(state.error).toContain('доступ к проекту закрыт');
    expect(state.spinner).toBe(false);
});

test('switching scenes dismisses a pending dataset choice without loading the old archive', async ({ page }) => {
    test.setTimeout(budget(90000));
    const { requestedDatasets } = await mockGeoscan(page, true);
    await page.goto(`/?webgl&lang=ru&load=${encodeURIComponent(source)}`);
    await expect(page.locator('.geoscan-model-picker')).toBeVisible();
    await page.evaluate(() => (window as any).viewer.loadFiles([{ url: new URL('static/test-assets/BoxTextured.glb', location.href).href, filename: 'BoxTextured.glb' }], true));
    await expect(page.locator('.geoscan-model-picker')).toHaveCount(0);
    await page.waitForFunction(() => (window as any).viewer.meshInstances.length > 0 && !(window as any).viewer.observer.get('ui.spinner'));
    expect(requestedDatasets).toEqual([]);
    expect(await page.evaluate(() => (window as any).viewer.observer.get('ui.error'))).toBeFalsy();
});

test('opens a public project inside our player iframe on another origin', async ({ page }) => {
    test.setTimeout(budget(90000));
    await mockGeoscan(page);
    const url = new URL(String(test.info().project.use.baseURL ?? 'http://127.0.0.1:4173/'));
    url.searchParams.set('load', source);
    url.searchParams.set('embed', '1');
    url.searchParams.set('autoplay', '1');
    url.searchParams.set('webgl', '');
    // Use a real loopback parent on another port. A route.fulfill-only parent has no
    // remote address and Chrome treats its iframe as public → local network access.
    const parent = createServer((_req, res) => {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(`<iframe name="geoscan-embed" src="${url.href.replaceAll('&', '&amp;')}" width="1000" height="700"></iframe>`);
    });
    await new Promise<void>(resolve => parent.listen(0, '127.0.0.1', resolve));
    try {
        await page.goto(`http://127.0.0.1:${(parent.address() as AddressInfo).port}/`);
        const frame = page.frame({ name: 'geoscan-embed' })!;
        await frame.waitForFunction(() => (window as any).viewer?.tileManager?.getVisibleMeshInstances().length > 0, null, { timeout: 30000 });
        const state = await frame.evaluate(() => ({
            enabled: (window as any).viewer.observer.get('ui.embed.enabled'),
            urls: (window as any).viewer.observer.get('scene.urls'),
            error: (window as any).viewer.observer.get('ui.error')
        }));
        expect(state.enabled).toBe(true);
        expect(state.error).toBeFalsy();
        expect(state.urls[0]).toContain(source);
        expect(state.urls[0]).not.toContain('X-Amz');
    } finally {
        parent.closeAllConnections();
        await new Promise<void>(resolve => parent.close(() => resolve()));
    }
});
