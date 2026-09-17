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

test('variant-only embedded texture is decoded on first selection and then cached', async ({ page }) => {
    await page.route('**/variants-lazy.glb', route => route.fulfill({
        body: materialVariantsFixture(false, 'Infrared', true)
    }));
    await page.goto('/?webgl&load=variants-lazy.glb');
    await page.waitForFunction(() => (window as any).viewer?.observer?.get('scene.variants.list') === '["Infrared"]' &&
        !(window as any).viewer.observer.get('ui.spinner'));

    expect(await page.evaluate(() => {
        const resource = (window as any).viewer.entityAssets[0].asset.resource;
        return resource.materials[1].resource.emissiveMap.name;
    })).toContain('lazy-variant-image');

    await page.evaluate(() => (window as any).viewer.observer.set('scene.variant.selected', 'Infrared'));
    await page.waitForFunction(() => {
        const viewer = (window as any).viewer;
        return viewer.observer.get('scene.variants.loading') === '' &&
            viewer.meshInstances[0].material.name === 'Infrared Unlit';
    });
    const firstTextureName = await page.evaluate(() => (window as any).viewer.meshInstances[0].material.emissiveMap.name);
    expect(firstTextureName).not.toContain('lazy-variant-image');

    await page.evaluate(() => {
        const viewer = (window as any).viewer;
        viewer.observer.set('scene.variant.selected', '');
        viewer.observer.set('scene.variant.selected', 'Infrared');
    });
    await page.waitForFunction((name) => {
        const viewer = (window as any).viewer;
        return viewer.observer.get('scene.variants.loading') === '' &&
            viewer.meshInstances[0].material.emissiveMap.name === name;
    }, firstTextureName);
});

test('spectral and manually colored variants appear in the viewport quick switcher', async ({ page }) => {
    test.setTimeout(60000);
    await page.route('**/spectral-variants.glb', route => route.fulfill({ body: materialVariantsFixture(false, 'Study @IRR') }));
    await page.goto('/?webgl&load=spectral-variants.glb');
    await page.waitForFunction(() => (window as any).viewer?.observer?.get('scene.variants.list') === '["Study @IRR"]' &&
        !(window as any).viewer.observer.get('ui.spinner'));

    const spectralDot = page.locator('.spectral-variant-dot[title="Study @IRR"]');
    await expect(spectralDot).toBeVisible();
    await spectralDot.hover();
    await expect(page.getByRole('tooltip')).toHaveText('Study @IRR');
    await spectralDot.click();
    await expect.poll(() => page.evaluate(() => (window as any).viewer.observer.get('scene.variant.selected'))).toBe('Study @IRR');

    await page.locator('.left-panel-tab-materials').dispatchEvent('click');
    const fixedEditorColor = page.locator('.spectral-variant-color-fixed[title="IRR · Fixed"]');
    await expect(fixedEditorColor).toHaveCount(1);
    await expect(fixedEditorColor.locator('.spectral-variant-fixed-dot')).toHaveCSS('background-color', 'rgb(214, 54, 54)');
    await expect(fixedEditorColor.locator('.pcui-color-input')).toHaveCount(0);

    await page.evaluate(() => {
        (window as any).viewer.observer.set('scene.variants.colors', { __original__: '#abcdef' });
    });
    const originalDot = page.locator('.spectral-variant-custom-dot[title="Original material"]');
    await expect(originalDot).toBeVisible();
    await originalDot.hover();
    await expect(page.getByRole('tooltip')).toHaveText('Original material');
    await originalDot.click();
    await expect.poll(() => page.evaluate(() => (window as any).viewer.observer.get('scene.variant.selected'))).toBe('');
    expect(await page.evaluate(() => {
        const service = (window as any).viewer.settingsService;
        const settings = service.getSettingsData();
        (window as any).viewer.observer.set('scene.variants.colors', {});
        service.applyViewerSettings(settings);
        return {
            exported: settings.materialVariantColors,
            restored: (window as any).viewer.observer.get('scene.variants.colors')
        };
    })).toEqual({
        exported: { __original__: '#abcdef' },
        restored: { __original__: '#abcdef' }
    });

    await page.setViewportSize({ width: 600, height: 900 });
    await expect(page.locator('.spectral-variant-switcher')).toBeHidden();
});
