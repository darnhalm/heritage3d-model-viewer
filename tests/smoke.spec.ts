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

    await page.waitForFunction(() => {
        const observer = (window as any).viewer?.observer;
        return observer?.get('camera.fov') === 150 &&
            observer?.get('skybox.exposure') === 6 &&
            observer?.get('measure.unitScale') === 0.01 &&
            observer?.get('measure.knownDistance') === 1.25;
    });

    await page.evaluate(() => {
        const viewer = (window as any).viewer;
        const firstMaterialName = viewer.meshInstances.find((mi: any) => mi?.material?.name)?.material?.name;
        if (!firstMaterialName) {
            throw new Error('Expected test model to expose a material name');
        }

        viewer.applyViewerSettings({
            materialOverrides: {
                [firstMaterialName]: {
                    metallicFactor: 0.2,
                    roughnessFactor: 0.7,
                    opacityFactor: 0.9
                }
            }
        });
    });

    const state = await page.evaluate(() => ({
        filenames: (window as any).viewer.observer.get('scene.filenames'),
        materialCount: (window as any).viewer.observer.get('scene.materialCount'),
        fov: (window as any).viewer.observer.get('camera.fov'),
        exposure: (window as any).viewer.observer.get('skybox.exposure'),
        unitScale: (window as any).viewer.observer.get('measure.unitScale'),
        knownDistance: (window as any).viewer.observer.get('measure.knownDistance'),
        grid: (window as any).viewer.observer.get('debug.grid'),
        materialFactors: (window as any).viewer.observer.get('scene.selectedMaterialFactors'),
        firstMaterial: (() => {
            const material = (window as any).viewer.meshInstances.find((mi: any) => mi?.material)?.material;
            return material ? {
                metalness: material.metalness,
                roughness: material.glossInvert ? material.gloss : (1 - material.gloss),
                opacity: material.opacity
            } : null;
        })(),
        polluted: (Object.prototype as any).polluted
    }));

    expect(state.filenames).toContain('BoxTextured.glb');
    expect(Number(state.materialCount)).toBeGreaterThan(0);
    expect(state.fov).toBe(150);
    expect(state.exposure).toBe(6);
    expect(state.unitScale).toBe(0.01);
    expect(state.knownDistance).toBe(1.25);
    expect(state.grid).toBe(true);
    expect(state.firstMaterial).not.toBeNull();
    expect(state.firstMaterial.metalness).toBeCloseTo(0.2, 3);
    expect(state.firstMaterial.roughness).toBeCloseTo(0.7, 3);
    expect(state.firstMaterial.opacity).toBeCloseTo(0.9, 3);
    expect(state.polluted).toBeUndefined();
});

test('encodes model URLs in the embed generator', async ({ page }) => {
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

    const embedCode = page.locator('#embed-code-wrapper textarea');
    await expect(embedCode).toBeVisible();
    await expect(embedCode).toHaveValue(/load=https%3A%2F%2Fexample\.com%2Fmodel\.glb%3Fx%3D1%26y%3D2/);
    await expect(embedCode).toHaveValue(/embed=1/);
});

test('raycast helpers hit secondary mesh primitives for selection and measurement', async ({ page }) => {
    await page.goto('/?load=static%2Ftest-assets%2FMultiPrimitive.gltf');
    await waitForViewer(page);

    await page.waitForFunction(() => {
        const observer = (window as any).viewer?.observer;
        const filenames = observer?.get('scene.filenames');
        return Array.isArray(filenames) && filenames.includes('MultiPrimitive.gltf');
    });

    const result = await page.evaluate(() => {
        const viewer = (window as any).viewer;
        const Vec3 = viewer.camera.getPosition().constructor;
        const point = viewer.camera.camera.worldToScreen(new Vec3(0.75, 0, 0));
        const hit = viewer.selectionController.selectNodeByRay(point.x, point.y);
        const surface = viewer.measurementController.pickSurfacePoint(point.x, point.y);
        return {
            hit,
            selectedPath: viewer.observer.get('scene.selectedNode.path'),
            surface: surface ? { x: surface.x, y: surface.y, z: surface.z } : null
        };
    });

    expect(result.hit).toBe(true);
    expect(result.selectedPath).toContain('MultiPrimitivePlane');
    expect(result.surface).not.toBeNull();
    expect(result.surface.x).toBeGreaterThan(0.5);
    expect(Math.abs(result.surface.y)).toBeLessThan(0.1);
    expect(Math.abs(result.surface.z)).toBeLessThan(0.1);
});

test('metadata and poi tabs stay stable and poi edits persist to observer state', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => {
        pageErrors.push(error.message);
    });

    await page.goto('/?load=static%2Ftest-assets%2FBoxTextured.glb');
    await waitForViewer(page);

    await page.waitForFunction(() => {
        const observer = (window as any).viewer?.observer;
        const filenames = observer?.get('scene.filenames');
        return Array.isArray(filenames) && filenames.includes('BoxTextured.glb');
    });

    await page.evaluate(() => {
        document.getElementById('panel-left')?.classList.add('expanded');
    });

    await page.locator('.left-panel-tab-metadata').click();
    await expect(page.locator('#metadata-panel')).toBeVisible();

    const metadataTitleInput = page.locator('#metadata-panel input').first();
    await metadataTitleInput.fill('Smoke Metadata Title');
    await metadataTitleInput.blur();

    const metadataTitle = await page.evaluate(() => {
        const metadata = (window as any).viewer?.observer?.get('metadata');
        return metadata?.title ?? '';
    });
    expect(metadataTitle).toBe('Smoke Metadata Title');

    await page.evaluate(() => {
        (window as any).viewer?.observer?.set('poi.list', JSON.stringify([{
            id: 'poi-smoke-1',
            number: 1,
            title: 'POI 1',
            description: '',
            color: '#000000',
            duration: 0.8,
            position: [0, 0, 0],
            normal: [0, 1, 0]
        }]));
    });

    await page.locator('.left-panel-tab-poi').click();
    await expect(page.locator('#poi-panel')).toBeVisible();
    await expect(page.locator('.poi-list-item')).toHaveCount(1);

    const poiDescription = page.locator('.poi-list-description').first();
    await poiDescription.fill('Smoke description');
    await poiDescription.blur();

    const poiState = await page.evaluate(() => {
        const raw = (window as any).viewer?.observer?.get('poi.list');
        return JSON.parse(String(raw ?? '[]'));
    });
    expect(Array.isArray(poiState)).toBe(true);
    expect(poiState[0]?.description).toBe('Smoke description');
    expect(pageErrors).toEqual([]);
});

test('alignment tab toggles alignment mode safely without runtime errors', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => {
        pageErrors.push(error.message);
    });

    await page.goto('/?load=static%2Ftest-assets%2FBoxTextured.glb');
    await waitForViewer(page);

    await page.waitForFunction(() => {
        const observer = (window as any).viewer?.observer;
        const filenames = observer?.get('scene.filenames');
        return Array.isArray(filenames) && filenames.includes('BoxTextured.glb');
    });

    const initialState = await page.evaluate(() => ({
        axes: (window as any).viewer?.observer?.get('debug.axes'),
        grid: (window as any).viewer?.observer?.get('debug.grid')
    }));

    await page.evaluate(() => {
        document.getElementById('panel-left')?.classList.add('expanded');
    });

    await page.locator('.left-panel-tab-alignment').click();
    await expect(page.locator('#alignment-panel')).toBeVisible();

    await page.evaluate(() => {
        const viewer = (window as any).viewer;
        viewer?.observer?.set('debug.alignmentGizmoMode', 'move');
        viewer?.observer?.set('debug.alignmentGizmoMode', 'rotate');
        viewer?.setObjectPivotToCenter?.();
        viewer?.resetObjectTransform?.();
        viewer?.frameScene?.();
    });

    const activeState = await page.evaluate(() => ({
        alignmentMode: (window as any).viewer?.observer?.get('debug.alignmentMode'),
        alignmentGizmoMode: (window as any).viewer?.observer?.get('debug.alignmentGizmoMode'),
        axes: (window as any).viewer?.observer?.get('debug.axes'),
        grid: (window as any).viewer?.observer?.get('debug.grid')
    }));
    expect(activeState.alignmentMode).toBe(true);
    expect(activeState.alignmentGizmoMode).toBe('rotate');
    expect(activeState.axes).toBe(true);
    expect(activeState.grid).toBe(true);

    await page.locator('.left-panel-tab-scene').click({ force: true });

    const afterExitState = await page.evaluate(() => ({
        alignmentMode: (window as any).viewer?.observer?.get('debug.alignmentMode'),
        axes: (window as any).viewer?.observer?.get('debug.axes'),
        grid: (window as any).viewer?.observer?.get('debug.grid')
    }));
    expect(afterExitState.alignmentMode).toBe(false);
    expect(afterExitState.axes).toBe(initialState.axes);
    expect(afterExitState.grid).toBe(initialState.grid);
    expect(pageErrors).toEqual([]);
});

test('materials by objects mode shows selected-node panel and stays stable', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => {
        pageErrors.push(error.message);
    });

    await page.goto('/?load=static%2Ftest-assets%2FBoxTextured.glb');
    await waitForViewer(page);

    await page.waitForFunction(() => {
        const observer = (window as any).viewer?.observer;
        const filenames = observer?.get('scene.filenames');
        return Array.isArray(filenames) && filenames.includes('BoxTextured.glb');
    });

    await page.evaluate(() => {
        document.getElementById('panel-left')?.classList.add('expanded');
    });

    await page.locator('.left-panel-tab-materials').click();
    await expect(page.locator('#materials-panel')).toBeVisible();

    await page.evaluate(() => {
        const viewer = (window as any).viewer;
        viewer?.observer?.set('debug.withTextureOnly', true);
        // Stabilize test rendering path for right-side object panel.
        viewer?.observer?.set('scene.nodes', JSON.stringify([{ name: 'SmokeNode', path: 'SmokeNode' }]));
        viewer?.observer?.set('scene.selectedNode.path', 'SmokeNode');
        viewer?.observer?.set('scene.selectedNode.name', 'SmokeNode');
    });

    await page.waitForFunction(() => {
        const observer = (window as any).viewer?.observer;
        return observer?.get('debug.withTextureOnly') === true &&
            !!observer?.get('scene.selectedNode.path');
    });

    await expect(page.locator('.selected-node-panel')).toBeVisible();
    await expect(page.locator('.selected-node-panel .panel-option').first()).toBeVisible();
    expect(pageErrors).toEqual([]);
});

test('rejects oversized model and settings files by size limits', async ({ page }) => {
    await page.goto('/');
    await waitForViewer(page);

    const result = await page.evaluate(() => {
        const viewer = (window as any).viewer;
        const accepted = viewer.loadFiles([
            {
                url: 'http://example.com/too-big.glb',
                filename: 'too-big.glb',
                sizeBytes: 1024 * 1024 * 1024 + 1
            },
            {
                url: 'http://example.com/test.model-viewer-settings.json',
                filename: 'test.model-viewer-settings.json',
                sizeBytes: 10 * 1024 * 1024 + 1
            }
        ], true);

        const warnings = viewer.observer.get('ui.warnings') || [];
        const error = viewer.observer.get('ui.error');
        return { accepted, warnings, error };
    });

    expect(result.accepted).toBe(false);
    expect(Array.isArray(result.warnings)).toBe(true);
    expect(result.warnings.length).toBe(2);
    expect(String(result.error)).toContain('exceeds model limit of 1 GB');
    expect(String(result.error)).toContain('exceeds settings limit of 10 MB');
});
