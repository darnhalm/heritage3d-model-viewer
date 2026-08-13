import { expect, test, type Page } from '@playwright/test';

const JUMA = 'models/JUMA_55000-lod/tiles/lod-meta.json';

test.describe.configure({ timeout: 180000 });

const pumpFrames = (page: Page, count: number) => page.evaluate(async (n) => {
    const app = (window as any).viewer.app;
    for (let i = 0; i < n; i++) {
        app.tick(performance.now());
        // Последовательное ожидание здесь намеренное: тест имитирует отдельные render frames.
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => {
            setTimeout(resolve, 16);
        });
    }
}, count);

test('GSplat spatial debug freezes the LOD camera and pauses loader dispatch', async ({ page }) => {
    test.skip(!(await page.request.get(JUMA)).ok(), 'Локальный JUMA spatial LOD отсутствует');

    await page.addInitScript(() => localStorage.setItem('h3d.tour.v1.seen', '1'));
    await page.goto(`/?load=${JUMA}`);
    await page.waitForFunction(() => !!(window as any).viewer?.observer);
    await page.waitForFunction(() => (window as any).viewer.observer.get('scene.hasGsplat') === true);
    await page.waitForFunction(() => (window as any).viewer.getGSplatManagers().size > 0);
    await pumpFrames(page, 20);

    const controls = page.locator('#scene-container');
    await page.locator('#panel-toggle').click();
    await controls.getByRole('button', { name: 'Materials' }).click();
    await expect(controls.getByRole('button', { name: 'Freeze LOD Camera' })).toBeVisible();
    await expect(controls.getByRole('button', { name: 'Pause Loading', exact: true })).toBeVisible();

    await page.evaluate(() => {
        const viewer = (window as any).viewer;
        viewer.observer.set('debug.gsplatNodeBounds', true);
        viewer.observer.set('debug.gsplatFreeze', true);
    });
    await pumpFrames(page, 10);

    const frozen = await page.evaluate(() => {
        const viewer = (window as any).viewer;
        const manager = viewer.getGSplatManagers().values().next().value;
        const loader = manager.world._octreeInstances.values().next().value.octree.assetLoader;
        return {
            frozen: viewer.gsplatFrozenLodCamera.position.toArray(),
            live: manager.cameraNode.getPosition().toArray(),
            worldLod: manager.world._lastLodCameraPos.toArray(),
            paused: viewer.observer.get('debug.gsplatPaused'),
            concurrency: loader.maxConcurrentLoads
        };
    });
    expect(frozen.paused).toBe(true);
    expect(frozen.concurrency).toBe(0);

    const canvas = page.locator('canvas').first();
    const canvasBox = await canvas.boundingBox();
    expect(canvasBox).not.toBeNull();
    const x = canvasBox!.x + canvasBox!.width * 0.55;
    const y = canvasBox!.y + canvasBox!.height * 0.5;
    await page.mouse.move(x, y);
    await page.mouse.down({ button: 'left' });
    await page.mouse.move(x + 260, y - 90, { steps: 12 });
    await page.mouse.up({ button: 'left' });
    await page.mouse.wheel(0, -1200);
    await pumpFrames(page, 30);

    const afterMove = await page.evaluate(() => {
        const viewer = (window as any).viewer;
        const manager = viewer.getGSplatManagers().values().next().value;
        return {
            live: manager.cameraNode.getPosition().toArray(),
            worldLod: manager.world._lastLodCameraPos.toArray()
        };
    });
    expect(afterMove.live).not.toEqual(frozen.live);
    expect(afterMove.worldLod).toEqual(frozen.worldLod);

    const queued = await page.evaluate(() => {
        const viewer = (window as any).viewer;
        const manager = viewer.getGSplatManagers().values().next().value;
        const inst = manager.world._octreeInstances.values().next().value;
        const loader = inst.octree.assetLoader;
        const file = inst.octree.files.find((_: unknown, index: number) => !inst.octree.getFileResource(index));
        if (file) loader.load(file.url);
        return { queue: loader._loadQueue.length, running: loader._currentlyLoading.size };
    });
    expect(queued.queue).toBeGreaterThan(0);

    await page.evaluate(() => (window as any).viewer.observer.set('debug.gsplatPaused', false));
    await pumpFrames(page, 5);
    const resumed = await page.evaluate(() => {
        const viewer = (window as any).viewer;
        const manager = viewer.getGSplatManagers().values().next().value;
        const loader = manager.world._octreeInstances.values().next().value.octree.assetLoader;
        return { concurrency: loader.maxConcurrentLoads, queue: loader._loadQueue.length, running: loader._currentlyLoading.size };
    });
    expect(resumed.concurrency).toBe(2);
    expect(resumed.running + resumed.queue).toBeGreaterThan(0);
});

test('GSplat material debug buttons switch off on a second click', async ({ page }) => {
    test.skip(!(await page.request.get(JUMA)).ok(), 'Локальный JUMA spatial LOD отсутствует');

    await page.addInitScript(() => localStorage.setItem('h3d.tour.v1.seen', '1'));
    await page.goto(`/?load=${JUMA}`);
    await page.waitForFunction(() => (window as any).viewer?.observer?.get('scene.hasGsplat') === true);
    await page.locator('#panel-toggle').click();
    await page.locator('.left-panel-tab-materials').click();

    const cases = [
        { label: 'Color Splats by LOD', path: 'debug.gsplatLodColor' },
        { label: 'Spatial Node Bounds', path: 'debug.gsplatNodeBounds' },
        { label: 'Freeze LOD Camera', path: 'debug.gsplatFreeze' },
        { label: 'Pause Loading', path: 'debug.gsplatPaused' }
    ];
    for (const item of cases) {
        await page.evaluate(({ path }) => (window as any).viewer.observer.set(path, false), item);
        const button = page.getByRole('button', { name: item.label, exact: true });
        await button.click();
        await expect.poll(() => page.evaluate(({ path }) => (window as any).viewer.observer.get(path), item)).toBe(true);
        await button.click();
        await expect.poll(() => page.evaluate(({ path }) => (window as any).viewer.observer.get(path), item)).toBe(false);
    }
});
