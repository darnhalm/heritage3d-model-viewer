import { expect, test } from '@playwright/test';
import { materialVariantsFixture } from '../scripts/hdr-fixtures.cjs';

test('KHR_materials_variants switches layers and restores the original material', async ({ page }) => {
    await page.route('**/variants.glb', route => route.fulfill({ body: materialVariantsFixture() }));
    await page.goto('/?webgl&load=variants.glb');
    await page.waitForFunction(() => (window as any).viewer?.observer?.get('scene.variants.list') === '["Infrared"]' &&
        !(window as any).viewer.observer.get('ui.spinner'));

    const initial = await page.evaluate(() => {
        const viewer = (window as any).viewer;
        (window as any).__originalVariantMaterial = viewer.meshInstances[0].material;
        return {
            selected: viewer.observer.get('scene.variant.selected'),
            name: viewer.meshInstances[0].material.name,
            unlit: viewer.observer.get('scene.unlit')
        };
    });
    expect(initial).toEqual({ selected: '', name: 'Texture', unlit: false });

    await page.locator('.left-panel-tab-materials').dispatchEvent('click');
    await expect(page.getByText('Texture Layers', { exact: false })).toHaveCount(1);
    const layerButtons = page.locator('.materials-layer-item-variant');
    await expect(layerButtons).toHaveCount(2);
    await layerButtons.filter({ hasText: 'Infrared' }).dispatchEvent('click');
    await page.waitForFunction(() => (window as any).viewer?.observer.get('scene.unlit') === true);
    expect(await page.evaluate(() => ({
        selected: (window as any).viewer.observer.get('scene.variant.selected'),
        name: (window as any).viewer.meshInstances[0].material.name
    }))).toEqual({ selected: 'Infrared', name: 'Infrared Unlit' });

    await layerButtons.filter({ hasText: 'Original material' }).dispatchEvent('click');
    await page.waitForFunction(() => (window as any).viewer?.observer.get('scene.unlit') === false);
    expect(await page.evaluate(() => {
        const viewer = (window as any).viewer;
        return viewer.meshInstances[0].material === (window as any).__originalVariantMaterial;
    })).toBe(true);
});

test('embedded HDR follows the active material variant', async ({ page }) => {
    await page.route('**/variants-hdr.glb', route => route.fulfill({ body: materialVariantsFixture(true) }));
    await page.goto('/?webgpu&load=variants-hdr.glb');
    await page.waitForFunction(() => (window as any).viewer?.observer?.get('scene.variants.list') === '["Infrared"]' &&
        !(window as any).viewer.observer.get('ui.spinner'));
    expect(await page.evaluate(() => (window as any).viewer.observer.get('runtime.hdrSource'))).toBe(false);

    await page.evaluate(() => (window as any).viewer.observer.set('scene.variant.selected', 'Infrared'));
    await page.waitForFunction(() => (window as any).viewer?.observer.get('runtime.hdrSource') === true);
    expect(await page.evaluate(() => ({
        unlit: (window as any).viewer.observer.get('scene.unlit'),
        textures: (window as any).viewer.hdrSurface.textures.length,
        material: (window as any).viewer.meshInstances[0].material.name
    }))).toEqual({ unlit: true, textures: 1, material: 'Infrared Unlit' });

    await page.evaluate(() => (window as any).viewer.observer.set('scene.variant.selected', ''));
    await page.waitForFunction(() => (window as any).viewer?.observer.get('runtime.hdrSource') === false);
    expect(await page.evaluate(() => (window as any).viewer.meshInstances[0].material.name)).toBe('Texture');
});
