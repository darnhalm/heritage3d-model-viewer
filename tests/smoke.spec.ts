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
        active: (window as any).viewer.observer.get('ui.active'),
        surfacePivot: (window as any).viewer.observer.get('camera.surfacePivot'),
        mouseButtonsInverted: (window as any).viewer.observer.get('camera.mouseButtonsInverted')
    }));

    expect(state.urls).toEqual([]);
    expect(state.active).toBe(null);
    expect(state.surfacePivot).toBe(true);
    expect(state.mouseButtonsInverted).toBe(true);
});

test('fly movement speed is configurable from the Controls menu and saved', async ({ page }) => {
    test.setTimeout(120000);
    await page.goto('/?webgl&load=static%2Ftest-assets%2FBoxTextured.glb');
    await waitForViewer(page);
    await page.waitForFunction(() => (window as any).viewer?.observer?.get('ui.spinner') === false);

    await page.locator('#info-button').click();
    await expect(page.locator('.info-tab').first()).toHaveCSS('display', 'flex');
    await expect(page.locator('.info-tab').first()).toHaveCSS('align-items', 'center');
    await expect(page.locator('.info-tab').first()).toHaveCSS('height', '32px');
    await expect(page.locator('.info-subtab').first()).toHaveCSS('display', 'flex');
    await expect(page.locator('.info-subtab').first()).toHaveCSS('align-items', 'center');
    await expect(page.locator('.info-subtab').first()).toHaveCSS('height', '30px');
    await expect(page.locator('.fly-speed-control')).toBeVisible();
    await expect(page.locator('.fly-speed-control')).toContainText('Movement speed');
    await expect(page.locator('.info-controls-content')).toContainText('Surface pivot');
    await expect(page.locator('.info-controls-content')).toContainText('Invert mouse buttons');
    const orbitControl = page.locator('.control-detail').filter({ hasText: 'Orbit' }).first();
    const panControl = page.locator('.control-detail').filter({ hasText: 'Pan' }).first();
    await expect(orbitControl).toContainText('Right Mouse');
    await expect(panControl).toContainText('Left Mouse');
    await expect(page.locator('.info-controls-content')).toContainText('Set Focus and Zoom One Step');

    await page.getByRole('button', { name: 'Touch', exact: true }).click();
    const touchOrbitControl = page.locator('.control-detail').filter({ hasText: 'Orbit' }).first();
    const touchPanControl = page.locator('.control-detail').filter({ hasText: 'Pan' }).first();
    await expect(touchOrbitControl).toContainText('Two Finger Drag');
    await expect(touchPanControl).toContainText('One Finger Drag');

    await page.evaluate(() => (window as any).viewer.observer.set('camera.mouseButtonsInverted', false));
    await expect(touchOrbitControl).toContainText('One Finger Drag');
    await expect(touchPanControl).toContainText('Two Finger Drag');

    await page.getByRole('button', { name: 'Desktop', exact: true }).click();
    await expect(orbitControl).toContainText('Left Mouse');
    await expect(panControl).toContainText('Right Mouse');

    const state = await page.evaluate(() => {
        const viewer = (window as any).viewer;
        viewer.observer.set('camera.flySpeed', 2.5);
        viewer.observer.set('camera.surfacePivot', false);
        viewer.observer.set('camera.mouseButtonsInverted', true);
        const settings = viewer.settingsService.getSettingsData();
        return {
            observerSpeed: viewer.observer.get('camera.flySpeed'),
            controllerSpeed: viewer.cameraControls.flySpeed,
            savedSpeed: settings.camera.flySpeed,
            savedSurfacePivot: settings.camera.surfacePivot,
            savedMouseButtonsInverted: settings.camera.mouseButtonsInverted,
            cookie: document.cookie
        };
    });

    expect(state).toEqual({
        observerSpeed: 2.5,
        controllerSpeed: 2.5,
        savedSpeed: 2.5,
        savedSurfacePivot: false,
        savedMouseButtonsInverted: true,
        cookie: expect.stringContaining('model-viewer-camera-navigation-v2=0.1')
    });
});

test('surface pivot uses one pick per drag, keeps the pivot fixed on screen, and cleans up', async ({ page }) => {
    test.setTimeout(180000);
    await page.goto('/?webgl&load=static%2Ftest-assets%2FBoxTextured.glb');
    await waitForViewer(page);
    await page.waitForFunction(() => (window as any).viewer?.meshInstances?.length > 0);
    await page.evaluate(() => {
        const viewer = (window as any).viewer;
        viewer.observer.set('camera.mouseButtonsInverted', false);
        const pivot = viewer.cameraControls.getFocus().clone().add(viewer.camera.right.clone().mulScalar(0.2));
        viewer.picker.pick = async () => pivot.clone();
    });

    const canvas = page.locator('#application-canvas');
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    const startX = box!.x + box!.width / 2;
    const startY = box!.y + box!.height / 2;

    // A click stays a click: the expensive depth pass starts only past the drag threshold.
    await page.mouse.click(startX, startY);
    expect(await page.evaluate(() => (window as any).viewer.surfacePivotController.getDebugState().pickCount)).toBe(0);

    await page.mouse.move(startX, startY);
    await page.mouse.down({ button: 'left' });
    await page.mouse.move(startX + 20, startY + 8);
    await expect(page.locator('.surface-pivot-marker')).toHaveClass(/visible/);

    const before = await page.evaluate(() => {
        const viewer = (window as any).viewer;
        const debug = viewer.surfacePivotController.getDebugState();
        const point = new (viewer.cameraControls.getPosition().constructor)(...debug.worldPoint);
        const screen = viewer.camera.camera.worldToScreen(point);
        const position = viewer.cameraControls.getPosition();
        return {
            screen: [screen.x, screen.y],
            position: [position.x, position.y, position.z]
        };
    });

    await page.mouse.move(startX + 130, startY + 65, { steps: 12 });
    await page.waitForTimeout(100);
    const active = await page.evaluate(() => {
        const viewer = (window as any).viewer;
        const debug = viewer.surfacePivotController.getDebugState();
        const point = new (viewer.cameraControls.getPosition().constructor)(...debug.worldPoint);
        const screen = viewer.camera.camera.worldToScreen(point);
        const position = viewer.cameraControls.getPosition();
        return {
            debug,
            screen: [screen.x, screen.y],
            position: [position.x, position.y, position.z]
        };
    });

    expect(active.debug.state).toBe('active');
    expect(active.debug.pickCount).toBe(1);
    expect(active.debug.lastPickLatencyMs).toBeLessThan(100);
    expect(Math.hypot(active.screen[0] - before.screen[0], active.screen[1] - before.screen[1])).toBeLessThan(2);
    expect(Math.hypot(...active.position.map((value: number, index: number) => value - before.position[index]))).toBeGreaterThan(0.05);

    await page.mouse.up({ button: 'left' });
    await expect(page.locator('.surface-pivot-marker')).not.toHaveClass(/visible/);
    expect(await page.evaluate(() => (window as any).viewer.surfacePivotController.getDebugState().state)).toBe('idle');
});

test('surface marker uses one pick during mouse pan without replacing pan movement', async ({ page }) => {
    test.setTimeout(180000);
    await page.goto('/?webgl&load=static%2Ftest-assets%2FBoxTextured.glb');
    await waitForViewer(page);
    await page.waitForFunction(() => (window as any).viewer?.meshInstances?.length > 0);
    await page.evaluate(() => {
        const viewer = (window as any).viewer;
        viewer.observer.set('camera.mouseButtonsInverted', false);
        const point = viewer.cameraControls.getFocus().clone().add(viewer.camera.right.clone().mulScalar(0.2));
        viewer.picker.pick = async () => point.clone();
    });

    const canvas = page.locator('#application-canvas');
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    const startX = box!.x + box!.width / 2;
    const startY = box!.y + box!.height / 2;
    const focusBefore = await page.evaluate(() => (window as any).viewer.cameraControls.getFocus().toArray());

    await page.mouse.move(startX, startY);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(startX + 20, startY + 8);
    await expect(page.locator('.surface-pivot-marker')).toHaveClass(/visible/);
    await page.mouse.move(startX + 120, startY + 60, { steps: 12 });
    await page.waitForTimeout(100);

    const active = await page.evaluate(() => ({
        debug: (window as any).viewer.surfacePivotController.getDebugState(),
        focus: (window as any).viewer.cameraControls.getFocus().toArray()
    }));
    expect(active.debug.state).toBe('active');
    expect(active.debug.gesture).toBe('pan');
    expect(active.debug.pickCount).toBe(1);
    expect(Math.hypot(...active.focus.map((value: number, index: number) => value - focusBefore[index]))).toBeGreaterThan(0.05);

    await page.mouse.up({ button: 'right' });
    await expect(page.locator('.surface-pivot-marker')).not.toHaveClass(/visible/);
    expect(await page.evaluate(() => (window as any).viewer.surfacePivotController.getDebugState().state)).toBe('idle');
});

test('mouse button inversion swaps orbit and pan and restores from the navigation cookie', async ({ page }) => {
    test.setTimeout(300000);
    await page.goto('/?webgl&load=static%2Ftest-assets%2FBoxTextured.glb');
    await waitForViewer(page);
    await page.waitForFunction(() => (window as any).viewer?.meshInstances?.length > 0);
    await page.evaluate(() => {
        const viewer = (window as any).viewer;
        viewer.observer.set('camera.mouseButtonsInverted', false);
        viewer.observer.set('camera.mouseButtonsInverted', true);
        localStorage.removeItem('model-viewer-uistate');
    });
    await page.reload();
    await waitForViewer(page);
    await page.waitForFunction(() => (window as any).viewer?.meshInstances?.length > 0);

    const restored = await page.evaluate(() => {
        const viewer = (window as any).viewer;
        viewer.settingsService.applyViewerSettings({
            camera: { surfacePivot: false, mouseButtonsInverted: false }
        });
        return {
            observer: viewer.observer.get('camera.mouseButtonsInverted'),
            controller: viewer.cameraControls.mouseButtonsInverted,
            surfacePivot: viewer.observer.get('camera.surfacePivot')
        };
    });
    expect(restored).toEqual({ observer: true, controller: true, surfacePivot: true });

    await page.evaluate(() => {
        const viewer = (window as any).viewer;
        const point = viewer.cameraControls.getFocus().clone().add(viewer.camera.right.clone().mulScalar(0.2));
        viewer.picker.pick = async () => point.clone();
    });
    const canvas = page.locator('#application-canvas');
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    const startX = box!.x + box!.width / 2;
    const startY = box!.y + box!.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(startX + 30, startY + 12);
    await expect(page.locator('.surface-pivot-marker')).toHaveClass(/visible/);
    expect(await page.evaluate(() => (window as any).viewer.surfacePivotController.getDebugState().gesture)).toBe('orbit');
    await page.mouse.up({ button: 'right' });

    await page.mouse.move(startX, startY);
    await page.mouse.down({ button: 'left' });
    await page.mouse.move(startX + 30, startY + 12);
    await expect(page.locator('.surface-pivot-marker')).toHaveClass(/visible/);
    expect(await page.evaluate(() => (window as any).viewer.surfacePivotController.getDebugState().gesture)).toBe('pan');
    await page.mouse.up({ button: 'left' });
});

test('double click performs a direct two-times dolly with two lightweight feedback rings', async ({ page }) => {
    test.setTimeout(120000);
    await page.goto('/?webgl&load=static%2Ftest-assets%2FBoxTextured.glb');
    await waitForViewer(page);
    await page.waitForFunction(() => (window as any).viewer?.meshInstances?.length > 0);

    await page.evaluate(() => {
        const viewer = (window as any).viewer;
        const target = viewer.cameraControls.getFocus().clone().add(viewer.camera.right.clone().mulScalar(0.35));
        viewer.picker.pick = async () => target.clone();
    });

    await page.locator('#application-canvas').dblclick({ position: { x: 500, y: 350 } });
    await expect(page.locator('.double-click-feedback')).toHaveCount(1);
    const mid = await page.evaluate(() => {
        const viewer = (window as any).viewer;
        const transition = viewer.doubleClickZoomTransition;
        const startPosition = transition.startPosition.clone();
        const endPosition = transition.startPosition.clone()
            .add(transition.zoomDirection.clone().mulScalar(transition.travelDistance));
        viewer.updateDoubleClickZoomTransition(0.125);
        const position = viewer.cameraControls.getPosition();
        const focus = viewer.cameraControls.getFocus();
        const traveled = position.clone().sub(startPosition);
        const fullTravel = endPosition.clone().sub(startPosition);
        return {
            duration: viewer.doubleClickZoomTransition?.duration ?? null,
            orbitDistance: position.distance(focus),
            startOrbitDistance: transition.startOrbitDistance,
            endOrbitDistance: transition.endOrbitDistance,
            lineAlignment: traveled.normalize().dot(fullTravel.normalize()),
            viewAlignment: focus.clone().sub(position).normalize().dot(transition.viewDirection),
            remainingDistance: position.distance(endPosition),
            fullDistance: startPosition.distance(endPosition)
        };
    });
    expect(mid.duration).toBeCloseTo(0.25, 4);
    expect(mid.orbitDistance).toBeLessThan(mid.startOrbitDistance);
    expect(mid.orbitDistance).toBeGreaterThan(mid.endOrbitDistance);
    expect(mid.lineAlignment).toBeCloseTo(1, 5);
    expect(mid.viewAlignment).toBeCloseTo(1, 5);
    expect(mid.remainingDistance).toBeLessThan(mid.fullDistance);
    await expect(page.locator('.ripple-element')).toHaveCount(0);

    const end = await page.evaluate(() => {
        const viewer = (window as any).viewer;
        const endDistance = viewer.doubleClickZoomTransition.endOrbitDistance;
        viewer.updateDoubleClickZoomTransition(0.2);
        return {
            distance: viewer.cameraControls.getPosition().distance(viewer.cameraControls.getFocus()),
            endDistance,
            transition: viewer.doubleClickZoomTransition,
            cameraFlyTransition: viewer.cameraFlyTransition
        };
    });
    expect(end.transition).toBeNull();
    expect(end.cameraFlyTransition).toBeNull();
    expect(end.distance).toBeCloseTo(end.endDistance, 2);
});

test('double click respects the same closest zoom limit as wheel navigation', async ({ page }) => {
    test.setTimeout(120000);
    await page.goto('/?webgl&load=static%2Ftest-assets%2FBoxTextured.glb');
    await waitForViewer(page);
    const clamped = await page.evaluate(async () => {
        const viewer = (window as any).viewer;
        const Vec3 = viewer.cameraControls.getPosition().constructor;
        const Vec2 = viewer.cameraControls.zoomRange.constructor;
        const position = new Vec3(0, 0, 0);
        const target = new Vec3(0, 0, -3);
        viewer.cameraControls.zoomRange = new Vec2(2, 100);
        viewer.cameraControls.reset(target, position);
        viewer.picker.pick = async () => target.clone();
        await viewer._pickAndCenterAt(100, 100);
        const result = {
            travelDistance: viewer.doubleClickZoomTransition?.travelDistance,
            endOrbitDistance: viewer.doubleClickZoomTransition?.endOrbitDistance
        };
        viewer.stopCameraFlyTransition();
        return result;
    });
    // Half of 3 would be 1.5, but the configured closest distance is 2.
    expect(clamped.travelDistance).toBeCloseTo(1, 5);
    expect(clamped.endOrbitDistance).toBeCloseTo(2, 5);
});

test('theme color drives accents, active tools, progress colors and settings export', async ({ page }) => {
    await page.goto('/?webgl');
    await waitForViewer(page);
    await expect(page.locator('#settings-panel')).toContainText('Theme color');
    const defaultTheme = await page.evaluate(() => ({
        color: (window as any).viewer.observer.get('theme.primaryColor'),
        backgroundColor: (window as any).viewer.observer.get('skybox.backgroundColor'),
        css: getComputedStyle(document.documentElement).getPropertyValue('--theme-primary').trim(),
        bright: getComputedStyle(document.documentElement).getPropertyValue('--theme-bright').trim(),
        glow: getComputedStyle(document.documentElement).getPropertyValue('--theme-glow').trim()
    }));
    expect(defaultTheme.color).toEqual({ r: 1, g: 51 / 255, b: 0 });
    expect(defaultTheme.backgroundColor).toEqual({ r: 128 / 255, g: 128 / 255, b: 128 / 255 });
    expect(defaultTheme.css).toBe('rgb(255 51 0)');
    expect(defaultTheme.bright).toBe('rgb(255 116 82)');
    expect(defaultTheme.glow).toBe('rgb(255 218 209)');

    const themed = await page.evaluate(() => {
        const viewer = (window as any).viewer;
        viewer.observer.set('theme.primaryColor', { r: 0.2, g: 0.4, b: 0.6 });

        const fixture = document.createElement('div');
        fixture.innerHTML = `
            <button class="measure-mode-btn active"></button>
            <div id="alignment-panel"><button class="alignment-icon-btn active"></button></div>
            <div class="twin-id-row"><button class="twin-id-copy"></button></div>
            <div class="selected-object-block"><button class="selected-object-copy"></button></div>
            <button class="left-panel-tour-button"></button>
            <button class="poi-list-secondary-button is-saved"></button>
            <div id="popup-buttons-parent"><button class="pcui-button popup-button pcui-focus"></button></div>
            <div class="pcui-progress"><div class="pcui-progress-inner"></div></div>
        `;
        document.body.appendChild(fixture);
        const measure = fixture.querySelector('.measure-mode-btn') as HTMLElement;
        const alignment = fixture.querySelector('.alignment-icon-btn') as HTMLElement;
        const twinIdCopy = fixture.querySelector('.twin-id-copy') as HTMLElement;
        const selectedObjectCopy = fixture.querySelector('.selected-object-copy') as HTMLElement;
        const tourButton = fixture.querySelector('.left-panel-tour-button') as HTMLElement;
        const savedPoiViewButton = fixture.querySelector('.poi-list-secondary-button.is-saved') as HTMLElement;
        const centralButton = fixture.querySelector('.popup-button') as HTMLElement;
        const progress = fixture.querySelector('.pcui-progress-inner') as HTMLElement;
        const result = {
            primary: getComputedStyle(document.documentElement).getPropertyValue('--theme-primary').trim(),
            bright: getComputedStyle(document.documentElement).getPropertyValue('--theme-bright').trim(),
            glow: getComputedStyle(document.documentElement).getPropertyValue('--theme-glow').trim(),
            measureBackground: getComputedStyle(measure).backgroundColor,
            alignmentBackground: getComputedStyle(alignment).backgroundColor,
            twinIdCopyColor: getComputedStyle(twinIdCopy).color,
            selectedObjectCopyColor: getComputedStyle(selectedObjectCopy).color,
            tourButtonBackground: getComputedStyle(tourButton).backgroundColor,
            savedPoiViewBackground: getComputedStyle(savedPoiViewButton).backgroundColor,
            savedPoiViewColor: getComputedStyle(savedPoiViewButton).color,
            centralButtonShadow: getComputedStyle(centralButton).boxShadow,
            progressBackground: getComputedStyle(progress).backgroundImage,
            savedColor: viewer.settingsService.getSettingsData().theme.primaryColor,
            localColor: JSON.parse(localStorage.getItem('model-viewer-uistate') || '{}').theme?.primaryColor
        };
        fixture.remove();
        return result;
    });

    expect(themed.primary).toBe('rgb(51 102 153)');
    expect(themed.bright).toBe('rgb(116 151 186)');
    expect(themed.glow).toBe('rgb(218 227 237)');
    expect(themed.measureBackground).toBe('rgb(116, 151, 186)');
    expect(themed.alignmentBackground).toBe('rgb(116, 151, 186)');
    expect(themed.twinIdCopyColor).toBe('rgb(51, 102, 153)');
    expect(themed.selectedObjectCopyColor).toBe('rgb(51, 102, 153)');
    expect(themed.tourButtonBackground).toBe('rgba(51, 102, 153, 0.15)');
    expect(themed.savedPoiViewBackground).toBe('rgba(51, 102, 153, 0.22)');
    expect(themed.savedPoiViewColor).toBe('rgb(116, 151, 186)');
    expect(themed.centralButtonShadow).toContain('rgba(218, 227, 237, 0.34)');
    expect(themed.centralButtonShadow).toContain('rgba(218, 227, 237, 0.24)');
    expect(themed.progressBackground).toContain('rgb(116, 151, 186)');
    expect(themed.progressBackground).toContain('rgb(51, 102, 153)');
    expect(themed.savedColor).toBe('#336699');
    expect(themed.localColor).toEqual({ r: 0.2, g: 0.4, b: 0.6 });
});

test('measurement JSON export is a compact icon in the panel footer', async ({ page }) => {
    test.setTimeout(60000);
    await page.goto('/?webgl&load=static%2Ftest-assets%2FBoxTextured.glb');
    await waitForViewer(page);
    await page.waitForFunction(() => {
        const filenames = (window as any).viewer?.observer?.get('scene.filenames');
        return Array.isArray(filenames) && filenames.includes('BoxTextured.glb');
    });
    await page.evaluate(() => (window as any).viewer.observer.set('ui.active', 'measurement'));

    const exportButton = page.getByRole('button', { name: 'Export measurements JSON' });
    await expect(exportButton).toBeVisible();
    await expect(exportButton).toHaveText('');
    await expect(exportButton).toHaveCSS('width', '24px');
    await expect(exportButton).toHaveCSS('height', '24px');
    await expect(exportButton.locator('.measure-export-icon')).toHaveCount(1);
    await expect(exportButton.locator('xpath=..')).toHaveClass(/measure-panel-footer/);
});

test('loads a model and auto-applies nearby settings safely', async ({ page }) => {
    const dialogs: string[] = [];
    page.on('dialog', async (dialog) => {
        dialogs.push(dialog.message());
        await dialog.dismiss();
    });

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

    await page.waitForFunction(() => (window as any).viewer?.observer?.get('ui.spinner') === false);

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
        graphicsBackend: (window as any).viewer.observer.get('graphicsBackend'),
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
    expect(state.graphicsBackend).toBe('auto');
    expect(dialogs).toEqual([]);
    expect(state.grid).toBe(true);
    expect(state.firstMaterial).not.toBeNull();
    expect(state.firstMaterial.metalness).toBeCloseTo(0.2, 3);
    expect(state.firstMaterial.roughness).toBeCloseTo(0.7, 3);
    expect(state.firstMaterial.opacity).toBeCloseTo(0.9, 3);
    expect(state.polluted).toBeUndefined();
});

test('looks for nearby settings by climbing versions, not by spraying requests', async ({ page }) => {
    const requested: string[] = [];
    page.on('request', (request) => {
        if (request.url().includes('model-viewer-settings')) requested.push(request.url());
    });
    // Бэкенд задан явно: на неудачном создании устройства вьюер перезагружает страницу с
    // `auto`, и в счётчик попали бы запросы двух загрузок вместо одной.
    // Рядом с BoxTextured лежит базовый файл настроек, нумерованных копий нет: лесенка
    // поднимается на одну ступень и упирается. Два запроса, ровно один промах.
    await page.goto('/?webgl&load=static%2Ftest-assets%2FBoxTextured.glb');
    await waitForViewer(page);
    await page.waitForFunction(() => (window as any).viewer?.observer?.get('camera.fov') === 150);
    await page.waitForFunction(() => (window as any).viewer?.observer?.get('ui.spinner') === false);

    expect(requested.filter(u => u.endsWith('BoxTextured.model-viewer-settings.json'))).toHaveLength(1);
    expect(requested.filter(u => u.includes('model-viewer-settings(1).json'))).toHaveLength(1);
    expect(requested).toHaveLength(2);

    // У MultiPrimitive настроек рядом нет вовсе — дальше базового файла спрашивать нечего.
    requested.length = 0;
    await page.goto('/?webgl&load=static%2Ftest-assets%2FMultiPrimitive.gltf');
    await waitForViewer(page);
    await page.waitForFunction(() => {
        const filenames = (window as any).viewer?.observer?.get('scene.filenames');
        return Array.isArray(filenames) && filenames.includes('MultiPrimitive.gltf');
    });
    await page.waitForFunction(() => (window as any).viewer?.observer?.get('ui.spinner') === false);

    expect(requested).toEqual([
        expect.stringContaining('MultiPrimitive.model-viewer-settings.json')
    ]);
});

test('приглашение «перетащите модель» не мигает, когда модель названа в адресе', async ({ page }) => {
    test.setTimeout(60000);
    await page.goto('/?webgl&load=static%2Ftest-assets%2FBoxTextured.glb');
    await waitForViewer(page);
    await page.waitForFunction(() => {
        const filenames = (window as any).viewer?.observer?.get('scene.filenames');
        return Array.isArray(filenames) && filenames.includes('BoxTextured.glb');
    });
    // Экрана нет в разметке вовсе. Раньше он рендерился и прятался классом уже после
    // старта загрузки — этот зазор и был видимым миганием.
    await expect(page.locator('.load-button-panel')).toHaveCount(0);

    // Пустому плееру приглашение по-прежнему нужно — ради него экран и существует.
    await page.goto('/?webgl');
    await waitForViewer(page);
    await expect(page.locator('.load-button-panel')).toBeVisible();
});

test('encodes model URLs in the embed generator', async ({ page }) => {
    test.setTimeout(60000);
    await page.goto('/?webgl&load=static%2Ftest-assets%2FBoxTextured.glb');
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
    await page.getByRole('button', { name: 'Show embed code' }).click();
    await page.getByRole('button', { name: 'Advanced' }).click();
    await expect(page.getByRole('button', { name: 'Advanced' })).toHaveCSS('color', 'rgb(255, 255, 255)');
    await expect(page.getByRole('button', { name: 'Hide embed code' })).toHaveCSS('color', 'rgb(255, 255, 255)');
    await expect(page.locator('.share-parent-origin-input')).toHaveClass(/pcui-text-input/);
    await expect(page.locator('.embed-code-input')).toHaveClass(/pcui-text-area-input/);
    // Печатаем, а не `fill()`: pcui слушает у поля `change` и `keyup`
    // (см. InputElement, опция `keyChange`), а `fill()` шлёт только `input` — его pcui
    // не видит, значение в состояние не попадает и в код встройки не приходит.
    const parentOriginInput = page.getByRole('textbox', { name: 'Parent origin' });
    await parentOriginInput.click();
    await parentOriginInput.pressSequentially('https://portal.example/path');

    const embedCode = page.locator('#embed-code-wrapper textarea');
    await expect(embedCode).toBeVisible();
    await expect(embedCode).toHaveValue(/load=https%3A%2F%2Fexample\.com%2Fmodel\.glb%3Fx%3D1%26y%3D2/);
    await expect(embedCode).toHaveValue(/embed=1/);
    await expect(embedCode).toHaveValue(/hd=1/);
    await expect(embedCode).toHaveValue(/share=1/);
    await expect(embedCode).toHaveValue(/cameraMode=1/);
    await expect(embedCode).toHaveValue(/fragment=1/);
    await expect(embedCode).toHaveValue(/animControls=1/);
    await expect(embedCode).toHaveValue(/parentOrigin=https%3A%2F%2Fportal\.example/);
    await expect(page.locator('.share-flag[aria-label^="HD / SD:"]')).toHaveCount(1);
    await expect(page.locator('.share-flag[aria-label^="View & share:"]')).toHaveCount(1);
    await expect(page.locator('.share-flag[aria-label^="Camera mode:"]')).toHaveCount(1);
    await expect(page.locator('.share-flag[aria-label^="Animation controls:"]')).toHaveCount(1);
    await expect(page.locator('.share-flag[aria-label^="Fragment view:"]')).toHaveCount(1);
    await expect(page.locator('.share-flag[aria-label^="Model info:"]')).toHaveCount(0);
    await expect(page.locator('.share-flag-label').first()).toHaveCSS('color', 'rgb(255, 255, 255)');
});

test('embed poster candidates are probed at once and never hold up the model', async ({ page }) => {
    test.setTimeout(60000);
    // Однопиксельный PNG: единственный кандидат, который «существует».
    const onePixelPng = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64'
    );
    const posterStarts: number[] = [];
    let modelStartedAt = 0;

    // Медленный хост: каждый кандидат отвечает через 800 мс. При переборе лесенкой четыре
    // кандидата растянулись бы на три секунды с лишним, и всё это время модель бы ждала.
    await page.route(/BoxTextured\.(jpg|jpeg|png|webp)$/, async (route) => {
        posterStarts.push(Date.now());
        await new Promise(resolve => setTimeout(resolve, 800));
        if (route.request().url().endsWith('.png')) {
            await route.fulfill({ contentType: 'image/png', body: onePixelPng });
        } else {
            await route.fulfill({ status: 404, contentType: 'text/plain', body: '' });
        }
    });
    page.on('request', (request) => {
        if (!modelStartedAt && request.url().endsWith('BoxTextured.glb')) modelStartedAt = Date.now();
    });

    await page.goto('/?webgl&embed=1&load=static%2Ftest-assets%2FBoxTextured.glb');
    await waitForViewer(page);
    await page.waitForFunction(() => {
        const filenames = (window as any).viewer?.observer?.get('scene.filenames');
        return Array.isArray(filenames) && filenames.includes('BoxTextured.glb');
    });

    expect(posterStarts.length).toBeGreaterThan(1);
    // Кандидаты уходят разом, а не по одному вслед за чужой ошибкой.
    expect(Math.max(...posterStarts) - Math.min(...posterStarts)).toBeLessThan(500);
    // Модель начинает качаться, не дожидаясь, пока кандидаты провалятся.
    expect(modelStartedAt - Math.min(...posterStarts)).toBeLessThan(700);
    // Приоритет расширений сохранён: jpg и jpeg не нашлись, победил png, а не webp.
    await expect.poll(() => page.evaluate(() => (window as any).viewer?.observer?.get('ui.embed.placeholderUrl')))
    .toMatch(/BoxTextured\.png$/);
});

test('none embed preset hides every configurable interface element', async ({ page }) => {
    test.setTimeout(60000);
    await page.goto('/?webgl&embed=1&ui=none');
    await waitForViewer(page);
    await expect(page.locator('#panel-left')).toHaveCount(0);
    await expect(page.locator('#popup-buttons-parent').locator('button')).toHaveCount(0);
    const embed = await page.evaluate(() => (window as any).viewer.observer.get('ui.embed'));
    expect(embed.preset).toBe('none');
    for (const key of ['panel', 'poi', 'tour', 'measure', 'info', 'fragment', 'controls', 'hd', 'share', 'cameraMode', 'fullscreen', 'fit', 'reset', 'animControls']) {
        expect(embed[key]).toBe(false);
    }
});

test('embed messaging accepts only the configured or referrer parent origin', async ({ page }) => {
    test.setTimeout(60000);
    // Use a passive same-origin document as the host so the parent itself does not
    // initialize the viewer or perform backend-recovery navigation.
    await page.goto('/static/icons/info-icon.svg');
    const viewerOrigin = new URL(page.url()).origin;
    await page.route(`${viewerOrigin}/security-host.html`, route => route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><html><body></body></html>'
    }));
    await page.goto(`${viewerOrigin}/security-host.html`);
    await page.evaluate(() => {
        (window as any).__viewerMessages = [];
        window.addEventListener('message', event => (window as any).__viewerMessages.push(event.data));
    });

    const mountViewer = async (query: string) => {
        await page.evaluate(({ origin, suffix }) => {
            document.body.innerHTML = `<iframe id="security-viewer" src="${origin}/?webgl&embed=1${suffix}"></iframe>`;
        }, { origin: viewerOrigin, suffix: query });
        const frame = page.frameLocator('#security-viewer');
        await frame.locator('body').waitFor();
        await expect.poll(async () => frame.locator('body').evaluate(() => {
            return typeof (window as any).viewer !== 'undefined';
        }), { timeout: 20000 }).toBe(true);
        return frame;
    };

    const allowedFrame = await mountViewer('');
    await page.evaluate((origin) => {
        const target = (document.getElementById('security-viewer') as HTMLIFrameElement).contentWindow;
        target?.postMessage({ type: 'helper:visibility', visible: true }, origin);
    }, viewerOrigin);
    await expect.poll(async () => allowedFrame.locator('body').evaluate(() => {
        return (window as any).viewer.observer.get('helpers.visible');
    })).toBe(true);
    await allowedFrame.locator('body').evaluate(() => {
        (window as any).viewer.observer.set('poi.activeId', 'allowed-poi');
    });
    await expect.poll(() => page.evaluate(() => {
        return (window as any).__viewerMessages.some((message: any) => message?.type === 'poi-selected' && message.id === 'allowed-poi');
    })).toBe(true);

    await page.evaluate(() => { (window as any).__viewerMessages = []; });
    const blockedFrame = await mountViewer('&parentOrigin=https%3A%2F%2Ftrusted.example');
    await page.evaluate((origin) => {
        const target = (document.getElementById('security-viewer') as HTMLIFrameElement).contentWindow;
        target?.postMessage({ type: 'helper:visibility', visible: true }, origin);
    }, viewerOrigin);
    await page.waitForTimeout(250);
    const blocked = await blockedFrame.locator('body').evaluate(() => {
        return (window as any).viewer.observer.get('helpers.visible');
    });
    expect(blocked).toBe(false);
    await blockedFrame.locator('body').evaluate(() => {
        (window as any).viewer.observer.set('poi.activeId', 'blocked-poi');
    });
    await page.waitForTimeout(250);
    const leaked = await page.evaluate(() => {
        return (window as any).__viewerMessages.some((message: any) => message?.id === 'blocked-poi');
    });
    expect(leaked).toBe(false);
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

test('completed measurements stay editable, area closes on double click, and JSON keeps control points', async ({ page }) => {
    test.setTimeout(60000);
    await page.goto('/?webgl&load=static%2Ftest-assets%2FMultiPrimitive.gltf');
    await waitForViewer(page);
    await page.waitForFunction(() => {
        const filenames = (window as any).viewer?.observer?.get('scene.filenames');
        return Array.isArray(filenames) && filenames.includes('MultiPrimitive.gltf');
    });

    const result = await page.evaluate(() => {
        const viewer = (window as any).viewer;
        const controller = viewer.measurementController as any;
        const Vec3 = viewer.camera.getPosition().constructor;
        viewer.observer.set('measure.enabled', true);
        viewer.observer.set('measure.unit', 'cm');
        viewer.observer.set('measure.unitScale', 0.01);
        controller.completedMeasurements = [
            { id: 1, mode: 'distance', points: [new Vec3(0.55, 0, 0), new Vec3(0.9, 0, 0)], distance: 0.0035 },
            { id: 2, mode: 'angle', points: [new Vec3(0.55, 0, 0), new Vec3(0.7, 0, 0), new Vec3(0.7, 0.15, 0)], angle: 90 },
            { id: 3, mode: 'area', points: [new Vec3(0.55, -0.1, 0), new Vec3(0.9, -0.1, 0), new Vec3(0.9, 0.1, 0)], area: 0.00035, areaPlanarity: 0 }
        ];
        controller.nextMeasurementId = 4;
        controller.updateOverlay((point: any) => viewer.camera.camera.worldToScreen(point));

        const handlesBefore = document.querySelectorAll('.measure-completed-handle').length;
        const firstHandle = document.querySelector('.measure-completed-handle') as SVGCircleElement;
        const targetScreen = viewer.camera.camera.worldToScreen(new Vec3(0.7, 0, 0));
        const rect = viewer.canvas.getBoundingClientRect();
        firstHandle.dispatchEvent(new PointerEvent('pointerdown', {
            bubbles: true,
            button: 0,
            pointerId: 7,
            clientX: rect.left + Number(firstHandle.getAttribute('cx')),
            clientY: rect.top + Number(firstHandle.getAttribute('cy'))
        }));
        document.dispatchEvent(new PointerEvent('pointermove', {
            bubbles: true,
            pointerId: 7,
            clientX: rect.left + targetScreen.x,
            clientY: rect.top + targetScreen.y
        }));
        document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 7 }));

        const movedX = controller.completedMeasurements[0].points[0].x;
        const exportData = controller.getMeasurementsExportData();

        viewer.observer.set('measure.mode', 'area');
        controller.points = [new Vec3(0.55, -0.1, 0), new Vec3(0.9, -0.1, 0), new Vec3(0.9, 0.1, 0)];
        viewer.observer.set('measure.pointCount', 3);
        const doubleClick = document.createEvent('MouseEvent');
        doubleClick.initMouseEvent('dblclick', true, true, window, 2, 0, 0, 0, 0, false, false, false, false, 0, null);
        viewer.canvas.dispatchEvent(doubleClick);

        return {
            handlesBefore,
            movedX,
            exportData,
            completedCount: controller.completedMeasurements.length,
            draftCount: controller.points.length,
            pointCount: viewer.observer.get('measure.pointCount')
        };
    });

    expect(result.handlesBefore).toBe(8);
    expect(result.movedX).toBeCloseTo(0.7, 1);
    expect(result.exportData.sceneUnits).toEqual({
        coordinateUnit: 'scene-unit',
        metersPerSceneUnit: 0.01,
        displayUnit: 'cm'
    });
    expect(result.exportData.measurements.map((entry: any) => entry.type)).toEqual(['distance', 'angle', 'area']);
    expect(result.exportData.measurements[0].controlPoints[0].index).toBe(1);
    expect(result.exportData.measurements[0].controlPoints[0].scene.x).toBeCloseTo(0.7, 1);
    expect(result.completedCount).toBe(4);
    expect(result.draftCount).toBe(0);
    expect(result.pointCount).toBe(0);
});

test('poi tab stays stable and edits persist to observer state', async ({ page }) => {
    test.setTimeout(60000);
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

    await expect(page.locator('.lang-switcher .left-panel-tour-button')).toBeVisible();
    await expect(page.locator('.left-panel-tab-slot')).toHaveCount(4);
    await expect(page.locator('.left-panel-tab-slot').first()).toHaveAttribute('title', 'Settings');
    await expect(page.locator('.left-panel-active-title')).toHaveText('Settings');
    await expect(page.locator('.left-panel-tab').first()).toHaveCSS('font-size', '0px');
    const tabWidths = await page.locator('.left-panel-tab').evaluateAll(tabs => tabs.map(tab => tab.getBoundingClientRect().width));
    const tabTops = await page.locator('.left-panel-tab').evaluateAll(tabs => tabs.map(tab => tab.getBoundingClientRect().top));
    expect(Math.max(...tabWidths) - Math.min(...tabWidths)).toBeLessThanOrEqual(1);
    expect(Math.max(...tabTops) - Math.min(...tabTops)).toBeLessThanOrEqual(1);

    await page.locator('.left-panel-tab-poi').click();
    // Рядом с моделью лежит файл настроек с `camera.fov: 150`: при таком угле коробка
    // занимает считанные пиксели в центре кадра, и клик по фиксированному смещению
    // приходился в пустоту — точка не ставилась. Возвращаем обычный угол и бьём в центр
    // холста, куда кадрирование и помещает модель.
    await page.evaluate(() => (window as any).viewer?.observer?.set('camera.fov', 45));
    await page.locator('#application-canvas').click();
    await expect(page.locator('.poi-list-item')).toHaveCount(1);
    const newPoiDefaults = await page.evaluate(() => {
        const raw = (window as any).viewer?.observer?.get('poi.list');
        const list = JSON.parse(String(raw ?? '[]'));
        return { duration: list[0]?.duration, holdTime: list[0]?.holdTime };
    });
    expect(newPoiDefaults).toEqual({ duration: 3, holdTime: 3 });

    await page.evaluate(() => {
        (window as any).viewer?.observer?.set('poi.list', JSON.stringify([{
            id: 'poi-smoke-1',
            number: 1,
            title: 'POI 1',
            description: '',
            color: '#123abc',
            duration: 0.8,
            camera: {},
            position: [0, 0, 0],
            normal: [0, 1, 0]
        }]));
    });

    await expect(page.locator('.left-panel-active-title')).toHaveText('POI');
    await expect(page.locator('#poi-panel')).toBeVisible();
    await expect(page.locator('.poi-list-item')).toHaveCount(1);
    await expect(page.locator('.left-panel-tab-poi')).toHaveClass(/pcui-button/);
    await expect(page.locator('.poi-list-description')).toHaveClass(/pcui-text-area-input/);
    await expect(page.locator('.poi-list-secondary-action')).toHaveCount(2);
    await expect(page.locator('.poi-list-secondary-action').first()).toHaveAttribute('title', 'Retake View');
    await expect(page.locator('.poi-list-secondary-action').last()).toHaveAttribute('title', 'Delete View');
    await expect(page.locator('.poi-list-secondary-button-retake-view')).toHaveClass(/pcui-button/);
    await expect(page.locator('.poi-list-secondary-button-delete-view')).toHaveClass(/pcui-button/);
    await expect(page.locator('.poi-list-secondary-button-retake-view')).toHaveCSS('font-size', '0px');
    await expect(page.locator('.poi-list-delete')).toHaveClass(/pcui-button/);

    // `.poi-list-description` — обёртка pcui, само поле лежит внутри неё.
    const poiDescription = page.locator('.poi-list-description textarea').first();
    await poiDescription.click();
    await poiDescription.pressSequentially('Smoke description');
    await poiDescription.blur();

    const poiState = await page.evaluate(() => {
        const raw = (window as any).viewer?.observer?.get('poi.list');
        return JSON.parse(String(raw ?? '[]'));
    });
    expect(Array.isArray(poiState)).toBe(true);
    expect(poiState[0]?.description).toBe('Smoke description');
    expect(poiState[0]?.color).toBe('#123abc');

    const focusedPoi = await page.evaluate(() => {
        const viewer = (window as any).viewer;
        viewer?.clearFocusedPoi?.();
        viewer?.focusPoi?.('poi-smoke-1');
        return viewer?.observer?.get('poi.activeId');
    });
    expect(focusedPoi).toBe('poi-smoke-1');
    expect(pageErrors).toEqual([]);
});

test('poi tour pauses immediately, resumes, stops, and ignores stale advances', async ({ page }) => {
    test.setTimeout(60000);
    // WebGL keeps this timing-sensitive state-machine test deterministic on software CI GPUs.
    await page.goto('/?webgl&load=static%2Ftest-assets%2FBoxTextured.glb');
    await waitForViewer(page);
    await page.waitForFunction(() => {
        const filenames = (window as any).viewer?.observer?.get('scene.filenames');
        return Array.isArray(filenames) && filenames.includes('BoxTextured.glb');
    });

    await page.evaluate(() => {
        const viewer = (window as any).viewer;
        const observer = viewer.observer;
        const position = viewer.cameraControls.getPosition();
        const focus = viewer.cameraControls.getFocus();
        const firstCamera = {
            position: [position.x, position.y, position.z],
            focus: [focus.x, focus.y, focus.z],
            fov: viewer.camera.camera.fov
        };
        const secondCamera = {
            position: [position.x + 10, position.y + 2, position.z],
            focus: [focus.x + 2, focus.y, focus.z],
            fov: viewer.camera.camera.fov
        };
        observer.set('poi.list', JSON.stringify([
            { id: 'tour-1', number: 1, title: 'Tour 1', duration: 5, holdTime: 0.2, camera: firstCamera },
            { id: 'tour-2', number: 2, title: 'Tour 2', duration: 5, holdTime: 0.2, camera: secondCamera },
            { id: 'tour-trigger', number: 3, title: 'Trigger', trigger: true, duration: 10, holdTime: 10 }
        ]));
        viewer.focusPoi('tour-1');

        (window as any).__tourTimeoutCallbacks = [];
        const originalSetTimeout = window.setTimeout.bind(window);
        window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: any[]) => {
            if (typeof handler === 'function' && Number(timeout) >= 5000) {
                (window as any).__tourTimeoutCallbacks.push(handler);
            }
            return originalSetTimeout(handler, timeout, ...args);
        }) as typeof window.setTimeout;
    });

    const playButton = page.locator('.poi-player-play-button');
    // Клик через `document.querySelector(...)?.click()` молча пропадал, если кнопки в этот
    // момент не было в разметке: optional chaining глотает промах, тест едет дальше и падает
    // на следующей проверке, обвиняя не то место. Теперь промах — это явная ошибка.
    const clickTourButton = async (selector: string) => page.evaluate((buttonSelector) => {
        const button = document.querySelector(buttonSelector) as HTMLButtonElement | null;
        if (!button) throw new Error(`Кнопка тура не найдена: ${buttonSelector}`);
        button.click();
    }, selector);
    await expect(page.locator('.poi-player-title')).toHaveText('Tour 1');

    // A fresh Play must restart from the first POI even when another POI is selected.
    await clickTourButton('#poi-player-overlay button[aria-label="Next POI"]');
    await expect(page.locator('.poi-player-title')).toHaveText('Tour 2');
    await clickTourButton('.poi-player-play-button');
    await expect(page.locator('.poi-player-title')).toHaveText('Tour 1');
    await clickTourButton('#poi-player-overlay button[aria-label="Next POI"]');
    await expect(page.locator('.poi-player-title')).toHaveText('Tour 2');
    await page.waitForTimeout(150);

    await clickTourButton('.poi-player-play-button');
    await expect(playButton).toHaveAttribute('aria-label', 'Play');

    // Полосу прогресса рисует отдельный rAF-цикл, а замереть ей велит обновление React.
    // Между коммитом React (по нему и ждали смену `aria-label`) и следующим тиком цикла в
    // полосе лежит значение последнего играющего кадра. Опорный снимок берём после того,
    // как цикл успел записать замершее значение, — иначе сравниваем с докадровым мусором и
    // видим дрейф в тысячные доли процента там, где время уже стоит.
    await page.evaluate(() => new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    }));

    const paused = await page.evaluate(() => {
        const viewer = (window as any).viewer;
        const position = viewer.cameraControls.getPosition();
        return {
            position: [position.x, position.y, position.z],
            progress: parseFloat(document.getElementById('poi-player-progress-fill')?.style.width || '0'),
            activeId: viewer.observer.get('poi.activeId')
        };
    });

    // Force callbacks captured from the pre-pause sessions: their tokens must reject them.
    await page.evaluate(() => {
        for (const callback of (window as any).__tourTimeoutCallbacks) callback();
    });
    await page.waitForTimeout(800);
    const stillPaused = await page.evaluate(() => {
        const viewer = (window as any).viewer;
        const position = viewer.cameraControls.getPosition();
        return {
            position: [position.x, position.y, position.z],
            progress: parseFloat(document.getElementById('poi-player-progress-fill')?.style.width || '0'),
            activeId: viewer.observer.get('poi.activeId')
        };
    });
    expect(stillPaused.activeId).toBe('tour-2');
    // Проверяем смысл, а не знаки после запятой. `pauseCameraFly` останавливает перелёт и
    // возвращает управление контроллеру камеры, а тот доводит себя затуханием — камера ещё
    // немного оседает. Замеры этого хвоста разнились от 3e-4 до 2.4e-2, так что подбирать
    // точность бессмысленно. Важно другое: соседние точки тура разнесены на 10 единиц, и
    // продолжившийся перелёт сместил бы камеру на порядки больше любого оседания.
    const pausedDrift = Math.hypot(...stillPaused.position.map((v: number, i: number) => v - paused.position[i]));
    expect(pausedDrift).toBeLessThan(0.1);
    expect(stillPaused.progress).toBeCloseTo(paused.progress, 3);
    expect(paused.progress).toBeGreaterThan(50);

    await clickTourButton('.poi-player-play-button');
    await expect(playButton).toHaveAttribute('aria-label', 'Pause');
    await page.waitForFunction((pausedPosition) => {
        const position = (window as any).viewer.cameraControls.getPosition();
        return Math.hypot(
            position.x - pausedPosition[0],
            position.y - pausedPosition[1],
            position.z - pausedPosition[2]
        ) > 0.001;
    }, paused.position);
    const resumedPosition = await page.evaluate(() => {
        const position = (window as any).viewer.cameraControls.getPosition();
        return [position.x, position.y, position.z];
    });
    const resumedDistance = Math.hypot(...resumedPosition.map((value, index) => value - paused.position[index]));
    expect(resumedDistance).toBeGreaterThan(0.001);

    await clickTourButton('#poi-player-overlay button[aria-label="Stop"]');
    await expect(page.locator('.poi-player-title')).toHaveText('Tour 1');
    await expect(playButton).toHaveAttribute('aria-label', 'Play');
    await expect(page.locator('#poi-player-progress-fill')).toHaveAttribute('style', /width:\s*0%/);

    const stoppedPosition = await page.evaluate(() => {
        const position = (window as any).viewer.cameraControls.getPosition();
        return [position.x, position.y, position.z];
    });
    await page.waitForTimeout(300);
    const stopped = await page.evaluate(() => {
        const viewer = (window as any).viewer;
        const position = viewer.cameraControls.getPosition();
        return {
            position: [position.x, position.y, position.z],
            activeId: viewer.observer.get('poi.activeId'),
            playing: viewer.observer.get('poi.playing')
        };
    });
    // Тот же затухающий хвост, что и на паузе: камера после Stop доводится контроллером.
    const stoppedDrift = Math.hypot(...stopped.position.map((v: number, i: number) => v - stoppedPosition[i]));
    expect(stoppedDrift).toBeLessThan(0.1);
    expect(stopped.activeId).toBe('tour-1');
    expect(stopped.playing).toBe(false);
});

test('полоса прогресса просыпается от команды извне, а не только от клика', async ({ page }) => {
    test.setTimeout(60000);
    await page.goto('/?webgl&load=static%2Ftest-assets%2FBoxTextured.glb');
    await waitForViewer(page);
    await page.waitForFunction(() => {
        const filenames = (window as any).viewer?.observer?.get('scene.filenames');
        return Array.isArray(filenames) && filenames.includes('BoxTextured.glb');
    });

    await page.evaluate(() => {
        const viewer = (window as any).viewer;
        const p = viewer.cameraControls.getPosition();
        const f = viewer.cameraControls.getFocus();
        const camera = { position: [p.x, p.y, p.z], focus: [f.x, f.y, f.z], fov: viewer.camera.camera.fov };
        viewer.observer.set('poi.list', JSON.stringify([
            { id: 'wake-1', number: 1, title: 'Wake 1', duration: 4, holdTime: 0.2, camera },
            { id: 'wake-2', number: 2, title: 'Wake 2', duration: 4, holdTime: 0.2, camera }
        ]));
        viewer.focusPoi('wake-1');
    });
    await expect(page.locator('.poi-player-title')).toHaveText('Wake 1');

    // Тур стоит — цикл прогресса спит: он останавливается, когда обновлять нечего.
    await page.waitForTimeout(600);
    const idle = await page.evaluate(() => parseFloat(
        (document.getElementById('poi-player-progress-fill') as HTMLElement)?.style.width || '0'));
    expect(idle).toBe(0);

    // Команда приходит не кликом, а прямо в observer — так же, как приезжает по API.
    await page.evaluate(() => (window as any).viewer.observer.set('poi.playing', true));

    // Полоса должна поехать: значит цикл проснулся.
    await expect.poll(() => page.evaluate(() => parseFloat(
        (document.getElementById('poi-player-progress-fill') as HTMLElement)?.style.width || '0')),
    { timeout: 10000 }).toBeGreaterThan(0);
});

test('alignment tab toggles alignment mode safely without runtime errors', async ({ page }) => {
    test.setTimeout(60000);
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => {
        pageErrors.push(error.message);
    });

    await page.goto('/?webgl&load=static%2Ftest-assets%2FBoxTextured.glb');
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
    const centerObjectButton = page.locator('.align-icon-object-center');
    await expect(centerObjectButton).toBeVisible();
    await centerObjectButton.click();
    const centerPivotButton = page.locator('.align-icon-pivot-center');
    await expect(centerPivotButton).toBeVisible();

    const pivotBefore = await page.evaluate(() => {
        const viewer = (window as any).viewer;
        viewer.sceneTransform.position = [3, 4, 5];
        viewer.setCenterScene(false);
        viewer.calcSceneBounds(viewer.sceneBounds);
        return {
            center: [viewer.sceneBounds.center.x, viewer.sceneBounds.center.y, viewer.sceneBounds.center.z],
            contentTransform: Array.from(viewer.sceneContentRoot.getWorldTransform().data)
        };
    });
    await centerPivotButton.click();
    const pivotAfter = await page.evaluate(() => {
        const viewer = (window as any).viewer;
        const pivot = viewer.sceneRoot.getPosition();
        return {
            pivot: [pivot.x, pivot.y, pivot.z],
            contentTransform: Array.from(viewer.sceneContentRoot.getWorldTransform().data)
        };
    });
    pivotAfter.pivot.forEach((value, index) => expect(value).toBeCloseTo(pivotBefore.center[index], 5));
    pivotAfter.contentTransform.forEach((value, index) => expect(value).toBeCloseTo(pivotBefore.contentTransform[index], 5));

    // Кнопки панели выравнивания давно строятся общим `toolBtn` и различаются классом
    // иконки (`alignment-icon-btn align-icon-*`); отдельного `.alignment-box-button` в
    // разметке нет с тех пор, как панель переехала на строки OBJECT/OPERATION/ACTIONS.
    await page.locator('.align-icon-box').click();
    const liveBox = await page.evaluate(() => {
        const viewer = (window as any).viewer;
        viewer.calcSceneBounds(viewer.dynamicSceneBounds);
        return {
            center: viewer.observer.get('dimensionBox.center'),
            size: viewer.observer.get('dimensionBox.size'),
            expectedCenter: [viewer.dynamicSceneBounds.center.x, viewer.dynamicSceneBounds.center.y, viewer.dynamicSceneBounds.center.z],
            expectedSize: [viewer.dynamicSceneBounds.halfExtents.x * 2, viewer.dynamicSceneBounds.halfExtents.y * 2, viewer.dynamicSceneBounds.halfExtents.z * 2]
        };
    });
    liveBox.center.forEach((value: number, index: number) => expect(value).toBeCloseTo(liveBox.expectedCenter[index], 5));
    liveBox.size.forEach((value: number, index: number) => expect(value).toBeCloseTo(liveBox.expectedSize[index], 5));

    await page.evaluate(() => {
        const viewer = (window as any).viewer;
        viewer?.observer?.set('debug.alignmentGizmoMode', 'move');
        viewer?.observer?.set('debug.alignmentGizmoMode', 'rotate');
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

test('materials by objects mode selects a real node and clears its scope when disabled', async ({ page }) => {
    test.setTimeout(60000);
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

    const selectedObject = await page.evaluate(() => {
        const viewer = (window as any).viewer;
        const path = viewer?.meshInstances?.[0]?.node?.path;
        if (!path) throw new Error('The test model has no selectable mesh node');
        viewer.observer.set('debug.withTextureOnly', true);
        viewer.observer.set('scene.selectedNode.path', path);
        return {
            path,
            name: viewer.observer.get('scene.selectedNode.name'),
            materials: JSON.parse(viewer.observer.get('scene.selectedMaterialNames'))
        };
    });

    await page.waitForFunction(() => {
        const observer = (window as any).viewer?.observer;
        return observer?.get('debug.withTextureOnly') === true &&
            !!observer?.get('scene.selectedNode.path');
    });

    expect(selectedObject.path).toBeTruthy();
    expect(selectedObject.name).toBeTruthy();
    expect(selectedObject.materials).toContain('Texture');
    await expect(page.locator('.selected-node-panel')).toBeVisible();
    await expect(page.locator('.selected-node-panel .panel-option').first()).toBeVisible();

    await page.evaluate(() => {
        (window as any).viewer.observer.set('debug.withTextureOnly', false);
    });

    await page.waitForFunction(() => {
        const viewer = (window as any).viewer;
        return viewer?.observer?.get('debug.withTextureOnly') === false &&
            viewer?.observer?.get('scene.selectedNode.path') === '' &&
            viewer?.selectedNode == null;
    });
    await expect(page.locator('.selected-node-panel')).toBeHidden();

    await page.evaluate((path) => {
        const viewer = (window as any).viewer;
        viewer.observer.set('debug.withTextureOnly', true);
        viewer.observer.set('scene.selectedNode.path', path);
        viewer.resetScene();
    }, selectedObject.path);
    await page.waitForFunction(() => {
        const viewer = (window as any).viewer;
        return viewer?.observer?.get('scene.selectedNode.path') === '' && viewer?.selectedNode == null;
    });
    expect(pageErrors).toEqual([]);
});

test('materials debug buttons toggle off on a second click', async ({ page }) => {
    // Каждое переключение отладочного режима перестраивает материалы и ждёт кадра, а кадр
    // на софтверном ANGLE/SwiftShader идёт неспешно. Четыре переключения подряд не влезают
    // в общие 30 секунд: прогон занимает около минуты, оставаясь при этом зелёным.
    test.setTimeout(90000);
    await page.goto('/?load=static%2Ftest-assets%2FBoxTextured.glb');
    await waitForViewer(page);
    await page.waitForFunction(() => {
        const filenames = (window as any).viewer?.observer?.get('scene.filenames');
        return Array.isArray(filenames) && filenames.includes('BoxTextured.glb');
    });

    await page.evaluate(() => {
        document.getElementById('panel-left')?.classList.add('expanded');
        const observer = (window as any).viewer?.observer;
        observer?.set('debug.wireframe', false);
        observer?.set('debug.normals', 0);
    });
    await page.locator('.left-panel-tab-materials').click();

    const wireframe = page.locator('.materials-layer-item-wireframe');
    await wireframe.click();
    await expect.poll(() => page.evaluate(() => (window as any).viewer.observer.get('debug.wireframe'))).toBe(true);
    await expect(wireframe).toHaveClass(/selected/);
    await wireframe.click();
    await expect.poll(() => page.evaluate(() => (window as any).viewer.observer.get('debug.wireframe'))).toBe(false);
    await expect(wireframe).not.toHaveClass(/selected/);

    const normals = page.locator('.materials-layer-item-vertex-normals');
    await normals.click();
    await expect.poll(() => page.evaluate(() => (window as any).viewer.observer.get('debug.normals'))).toBe(0.2);
    await expect(normals).toHaveClass(/selected/);
    await normals.click();
    await expect.poll(() => page.evaluate(() => (window as any).viewer.observer.get('debug.normals'))).toBe(0);
    await expect(normals).not.toHaveClass(/selected/);
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
