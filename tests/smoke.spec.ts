import { expect, test } from '@playwright/test';

const waitForViewer = async (page: import('@playwright/test').Page) => {
    await page.waitForFunction(() => typeof (window as any).viewer !== 'undefined' && !!(window as any).viewer?.observer);
};

test('boots the viewer shell', async ({ page }) => {
    await page.goto('/');
    await waitForViewer(page);

    await expect(page.locator('#drag-drop')).toBeVisible();
    await expect(page.locator('#panel-left')).toBeVisible();

    const state = await page.evaluate(() => ({
        urls: (window as any).viewer.observer.get('scene.urls'),
        active: (window as any).viewer.observer.get('ui.active')
    }));

    expect(state.urls).toEqual([]);
    expect(state.active).toBe(null);
});

test('loads a model and auto-applies nearby settings safely', async ({ page }) => {
    await page.goto('/?load=static%2Ftest-assets%2FBoxTextured.glb');
    await waitForViewer(page);

    await page.waitForFunction(() => {
        const observer = (window as any).viewer?.observer;
        const filenames = observer?.get('scene.filenames');
        return Array.isArray(filenames) && filenames.includes('BoxTextured.glb');
    });

    const state = await page.evaluate(() => ({
        filenames: (window as any).viewer.observer.get('scene.filenames'),
        materialCount: (window as any).viewer.observer.get('scene.materialCount'),
        fov: (window as any).viewer.observer.get('camera.fov'),
        exposure: (window as any).viewer.observer.get('skybox.exposure'),
        unitScale: (window as any).viewer.observer.get('measure.unitScale'),
        knownDistance: (window as any).viewer.observer.get('measure.knownDistance'),
        grid: (window as any).viewer.observer.get('debug.grid'),
        polluted: (Object.prototype as any).polluted
    }));

    expect(state.filenames).toContain('BoxTextured.glb');
    expect(Number(state.materialCount)).toBeGreaterThan(0);
    expect(state.fov).toBe(150);
    expect(state.exposure).toBe(6);
    expect(state.unitScale).toBe(0.01);
    expect(state.knownDistance).toBe(1.25);
    expect(state.grid).toBe(true);
    expect(state.polluted).toBeUndefined();
});

test('encodes model URLs in the share panel', async ({ page }) => {
    await page.goto('/?load=static%2Ftest-assets%2FBoxTextured.glb');
    await waitForViewer(page);

    await page.waitForFunction(() => {
        const observer = (window as any).viewer?.observer;
        const filenames = observer?.get('scene.filenames');
        return Array.isArray(filenames) && filenames.includes('BoxTextured.glb');
    });

    await page.evaluate(() => {
        (window as any).viewer.observer.set('scene.urls', ['https://example.com/model.glb?x=1&y=2']);
    });

    await page.locator('#view-button').click();

    const shareInput = page.locator('#view-panel input');
    await expect(shareInput).toBeVisible();
    await expect(shareInput).toHaveValue('http://127.0.0.1:4173/?load=https%3A%2F%2Fexample.com%2Fmodel.glb%3Fx%3D1%26y%3D2');
});
