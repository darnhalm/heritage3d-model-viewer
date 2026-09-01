import { expect, test, type Page } from '@playwright/test';

// Палитра берётся из того же модуля, что и у приложения. Раньше здесь лежал её список
// копией, и когда вьюер перешёл на палитру движка (её задаёт PlayCanvas по `colorizeLod`
// и из приложения не поменять), копия осталась со старой пастельной гаммой — тест ждал
// `0xff44ffff` там, где вьюер честно рисовал синий `0xffff0000`.
import { lodColorAbgr } from '../src/lod-palette';

/**
 * Тайловый слой 3D Tiles на публичных сэмплах CesiumGS.
 *
 * Сэмплы не лежат в репозитории (16 МБ бинарников): их кладёт рядом с собранным вьюером
 * `scripts/fetch-3d-tiles-samples.sh`. Без них тесты пропускаются, а не падают.
 */

// Тайлы грузятся по сети и кадры крутятся вручную по 16 мс — стандартных 30 секунд мало.
test.describe.configure({ timeout: 90000 });

const METADATA_GRANULARITIES = 'models/3d-tiles/1.1/MetadataGranularities/tileset.json';
const DISCRETE_LOD = 'models/3d-tiles/1.0/TilesetWithDiscreteLOD/tileset.json';
// Тайлсет из Cesium ion с неявным деревом: в репозитории его нет, кладётся вручную.
const HRAM = 'models/3d-tiles/hram/tileset.json';

const waitForViewer = async (page: Page) => {
    await page.waitForFunction(() => typeof (window as any).viewer !== 'undefined' && !!(window as any).viewer?.observer);
};

const samplesAvailable = async (page: Page, path: string) => {
    const response = await page.request.get(path);
    return response.ok();
};

/**
 * Прокрутить N кадров приложения вручную.
 *
 * В headless-Chromium цикл вьюера сам по себе останавливается: `app.autoRender === false`,
 * страница ничего не перерисовывает, а `requestAnimationFrame` в headless привязан к
 * компоновщику и без изменений на экране просто перестаёт срабатывать. В обычном браузере
 * этого не происходит. Поэтому кадры здесь крутятся явно — иначе обход дерева тайлов не
 * увидит, что камера переехала.
 */
const pumpFrames = (page: Page, count: number) => page.evaluate(async (n) => {
    const app = (window as any).viewer.app;
    for (let i = 0; i < n; i++) {
        app.tick(performance.now());
        await new Promise(resolve => setTimeout(resolve, 16));
    }
}, count);

test('tile material debug buttons switch off on a second click', async ({ page }) => {
    test.skip(!(await samplesAvailable(page, DISCRETE_LOD)), 'Локальный tileset sample отсутствует');

    await page.addInitScript(() => localStorage.setItem('h3d.tour.v1.seen', '1'));
    await page.goto(`/?load=${DISCRETE_LOD}`);
    await waitForViewer(page);
    await page.waitForFunction(() => (window as any).viewer.observer.get('scene.isTileset') === true);
    await page.locator('#panel-toggle').click();
    await page.locator('.left-panel-tab-materials').click();

    const toggle = async (label: string, path: string) => {
        await page.evaluate(({ path }) => (window as any).viewer.observer.set(path, false), { path });
        const button = page.getByRole('button', { name: label, exact: true });
        await button.click();
        await expect.poll(() => page.evaluate(({ path }) => (window as any).viewer.observer.get(path), { path })).toBe(true);
        await button.click();
        await expect.poll(() => page.evaluate(({ path }) => (window as any).viewer.observer.get(path), { path })).toBe(false);
    };

    await toggle('Tile Bounds (OBB)', 'debug.tileDebug');
    await page.evaluate(() => {
        const observer = (window as any).viewer.observer;
        observer.set('debug.tileDebug', true);
        observer.set('debug.tileLineStyle', 'checker');
    });
    await toggle('Checker Fill', 'debug.tileCheckerFill');
    await toggle('Pick Tile', 'debug.tilePick');

    await page.evaluate(() => (window as any).viewer.observer.set('debug.tilePick', true));
    await toggle('Isolate Picked Tile', 'debug.tileIsolatePick');

    // Для истории загрузки вместо технических Freeze/Pause показан явный цикл записи.
    const startRecording = page.getByRole('button', { name: 'Start recording', exact: true });
    const stopRecording = page.getByRole('button', { name: 'Stop recording', exact: true });
    const exitTimeline = page.getByRole('button', { name: 'Exit timeline', exact: true });
    await expect(startRecording).toBeEnabled();
    await expect(stopRecording).toHaveCount(0);
    await expect(exitTimeline).toHaveCount(0);

    await startRecording.click();
    await expect.poll(() => page.evaluate(() => ({
        recording: (window as any).viewer.observer.get('debug.tileRecording'),
        frozen: (window as any).viewer.observer.get('debug.tileFreeze'),
        paused: (window as any).viewer.observer.get('debug.tilePaused')
    }))).toEqual({ recording: true, frozen: false, paused: false });
    await expect(startRecording).toBeDisabled();
    await expect(stopRecording).toBeEnabled();
    await expect(exitTimeline).toHaveCount(0);

    await stopRecording.click();
    await expect.poll(() => page.evaluate(() => ({
        recording: (window as any).viewer.observer.get('debug.tileRecording'),
        frozen: (window as any).viewer.observer.get('debug.tileFreeze'),
        paused: (window as any).viewer.observer.get('debug.tilePaused')
    }))).toEqual({ recording: false, frozen: true, paused: true });
    await expect(startRecording).toBeEnabled();
    await expect(stopRecording).toHaveCount(0);
    await expect(exitTimeline).toBeEnabled();

    await exitTimeline.click();
    await expect.poll(() => page.evaluate(() => ({
        recording: (window as any).viewer.observer.get('debug.tileRecording'),
        frozen: (window as any).viewer.observer.get('debug.tileFreeze'),
        paused: (window as any).viewer.observer.get('debug.tilePaused')
    }))).toEqual({ recording: false, frozen: false, paused: false });
    await expect(startRecording).toBeEnabled();
    await expect(stopRecording).toHaveCount(0);
    await expect(exitTimeline).toHaveCount(0);

    // Tile debugging belongs to Materials only: leaving the tab tears down every mode.
    await page.evaluate(() => (window as any).viewer.observer.set('debug.tileDebug', true));
    await startRecording.click();
    await page.locator('.left-panel-tab-scene').click();
    await expect.poll(() => page.evaluate(() => ({
        debug: (window as any).viewer.observer.get('debug.tileDebug'),
        recording: (window as any).viewer.observer.get('debug.tileRecording'),
        frozen: (window as any).viewer.observer.get('debug.tileFreeze'),
        paused: (window as any).viewer.observer.get('debug.tilePaused')
    }))).toEqual({ debug: false, recording: false, frozen: false, paused: false });
    await expect(page.locator('#timeline-panel')).toHaveCount(0);
});

/** Дождаться, пока обход выберет хотя бы один тайл с готовым контентом. */
const waitForTiles = async (page: Page, timeout = 20000) => {
    await page.waitForFunction(() => {
        const stats = (window as any).viewer?.getTileStats?.();
        return !!stats && stats.selected > 0;
    }, undefined, { timeout });
    // Первые кадры вьюер успевает отрисовать сам (загрузка и вызовы renderNextFrame
    // создают изменения на экране), но дальше цикл встаёт — см. pumpFrames.
    await pumpFrames(page, 30);
};

const getStats = (page: Page) => page.evaluate(() => (window as any).viewer.getTileStats());

/** Поставить камеру на заданное расстояние от центра сцены и дать обходу отработать. */
const placeCamera = async (page: Page, distance: number) => {
    await page.evaluate((d) => {
        const viewer = (window as any).viewer;
        const Vec3 = viewer.camera.getPosition().constructor;
        const focus = new Vec3(0, 0, 0);
        const dir = 1 / Math.sqrt(3);
        viewer.cameraControls.reset(focus, new Vec3(d * dir, d * dir, d * dir));
        viewer.fitCameraClipPlanes();
    }, distance);
    // Загрузка асинхронная: кадров нужно с запасом, чтобы успели прийти тайлы.
    await pumpFrames(page, 60);
};

/** Поставить камеру на заданном расстоянии от центра сцены (а не от начала координат). */
const placeCameraAtScene = async (page: Page, distance: number) => {
    await page.evaluate((d) => {
        const viewer = (window as any).viewer;
        const Vec3 = viewer.camera.getPosition().constructor;
        const b = viewer.sceneBounds;
        const focus = new Vec3(b.center.x, b.center.y, b.center.z);
        const k = d / Math.sqrt(3);
        viewer.cameraControls.reset(focus, new Vec3(focus.x + k, focus.y + k, focus.z + k));
        viewer.fitCameraClipPlanes();
    }, distance);
    await pumpFrames(page, 120);
};

test('автоматически применяет tileset.model-viewer-settings.json', async ({ page }) => {
    test.skip(!await samplesAvailable(page, DISCRETE_LOD),
        'Нет сэмплов: запустите scripts/fetch-3d-tiles-samples.sh');

    let settingsRequests = 0;
    await page.route('**/tileset.model-viewer-settings.json', async (route) => {
        settingsRequests++;
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({
                camera: {
                    fov: 57,
                    position: [2100, 2200, 2300],
                    focus: [10, 20, 30]
                },
                light: { intensity: 2.4 },
                shadowCatcher: { enabled: true },
                sceneTransform: {
                    position: [10, 20, 30],
                    rotation: [0, 15, 0],
                    scale: [1, 1, 1],
                    pivotOffset: [0, 0, 0]
                }
            })
        });
    });

    await page.goto(`/?load=${encodeURIComponent(DISCRETE_LOD)}`);
    await waitForViewer(page);
    await page.waitForFunction(() => {
        const viewer = (window as any).viewer;
        return viewer.observer.get('camera.fov') === 57 && viewer.sceneTransform.position[0] === 10;
    });

    const applied = await page.evaluate(() => {
        const viewer = (window as any).viewer;
        const position = viewer.cameraControls.getPosition();
        const focus = viewer.cameraControls.getFocus();
        return {
            fov: viewer.camera.camera.fov,
            lightIntensity: viewer.observer.get('light.intensity'),
            shadowCatcher: viewer.observer.get('shadowCatcher.enabled'),
            scenePosition: viewer.sceneTransform.position,
            position: [position.x, position.y, position.z],
            focus: [focus.x, focus.y, focus.z]
        };
    });

    expect(settingsRequests).toBeGreaterThan(0);
    expect(applied.fov).toBe(57);
    expect(applied.lightIntensity).toBe(2.4);
    expect(applied.shadowCatcher).toBe(true);
    expect(applied.scenePosition).toEqual([10, 20, 30]);
    applied.position.forEach((value, index) => expect(value).toBeCloseTo([2100, 2200, 2300][index], 5));
    applied.focus.forEach((value, index) => expect(value).toBeCloseTo([10, 20, 30][index], 5));
});

test('загружает тайлсет 1.1 с несколькими контентами на тайл', async ({ page }) => {
    test.skip(!await samplesAvailable(page, METADATA_GRANULARITIES),
        'Нет сэмплов: запустите scripts/fetch-3d-tiles-samples.sh');

    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));

    await page.goto(`/?load=${encodeURIComponent(METADATA_GRANULARITIES)}`);
    await waitForViewer(page);
    await waitForTiles(page);

    const stats = await getStats(page);

    // В наборе пять тайлов: корень без контента и четыре листа по пять GLB в каждом.
    expect(stats.tiles).toBe(5);
    expect(stats.failed).toBe(0);
    expect(stats.ready).toBeGreaterThan(0);
    expect(stats.bytes).toBeGreaterThan(0);
    expect(await page.evaluate(() => (window as any).viewer.observer.get('shadowCatcher.enabled'))).toBe(false);

    // Габариты берутся из корневого bounding volume, а не из загруженного, — они должны
    // быть осмысленными сразу.
    const bounds = await page.evaluate(() => {
        const b = (window as any).viewer.sceneBounds;
        return { x: b.halfExtents.x, y: b.halfExtents.y, z: b.halfExtents.z };
    });
    expect(bounds.x).toBeGreaterThan(1);
    expect(bounds.z).toBeGreaterThan(1);

    // Контент выбранных тайлов должен быть не просто «загружен», а включён в сцену: без
    // этого статистика показывала бы успех при пустом экране.
    const rendered = await page.evaluate(() => {
        const root = (window as any).viewer.sceneContentRoot.findByName('tilesRoot');
        const meshInstances = (root?.findComponents('render') ?? [])
        .flatMap((component: any) => component.meshInstances);
        const enabled = (root?.children ?? []).filter((child: any) => child.enabled).length;
        return { meshInstances: meshInstances.length, enabled };
    });
    expect(rendered.enabled).toBeGreaterThan(0);
    expect(rendered.meshInstances).toBeGreaterThan(0);

    // Lit/Unlit — термины про участие в освещении; PBR — освещаемый тип материала.
    await page.evaluate(() => document.getElementById('panel-left')?.classList.add('expanded'));
    await page.locator('.left-panel-tab-materials').click();
    await setFlag(page, 'scene.tilesetLit', true);
    await expect(page.locator('.materials-layer-item-final-render')).toContainText('Final Render — Lit (PBR)');
    await setFlag(page, 'scene.tilesetLit', false);
    await expect.poll(() => page.evaluate(() => (window as any).viewer.observer.get('scene.tilesetLit'))).toBe(false);
    await page.evaluate(() => new Promise<void>(resolve => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    }));
    await expect(page.locator('.materials-layer-item-final-render')).toContainText('Final Render — Unlit');

    // Изоляция оставляет включённой entity выбранного тайла и полностью восстанавливает
    // текущий LOD-срез после выключения.
    const isolation = await page.evaluate(() => {
        const manager = (window as any).viewer.tileManager;
        const enabledCount = () => [...manager.loaded].filter((tile: any) => tile.entity?.enabled).length;
        const before = enabledCount();
        const firstMesh = manager.getVisibleMeshInstances()[0];
        manager.setDebugPickedMeshInstance(firstMesh);
        manager.setDebugIsolatePicked(true);
        const isolated = enabledCount();
        manager.setDebugIsolatePicked(false);
        const restored = enabledCount();
        manager.setDebugPickedMeshInstance(null);
        return { before, isolated, restored };
    });
    expect(isolation.before).toBeGreaterThan(1);
    expect(isolation.isolated).toBe(1);
    expect(isolation.restored).toBe(isolation.before);

    expect(pageErrors).toEqual([]);
});

test('переключает уровни детализации по экранной ошибке (REPLACE, b3dm)', async ({ page }) => {
    test.skip(!await samplesAvailable(page, DISCRETE_LOD),
        'Нет сэмплов: запустите scripts/fetch-3d-tiles-samples.sh');

    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));

    await page.goto(`/?load=${encodeURIComponent(DISCRETE_LOD)}`);
    await waitForViewer(page);
    await waitForTiles(page);

    // Цепочка REPLACE из трёх уровней: dragon_low → dragon_medium → dragon_high.
    // Дистанции подобраны под этот набор: корневой `transform` масштабирует сцену в 100
    // раз, поэтому дракон занимает ~1.4 км, а геометрические ошибки уровней равны
    // 100 / 10 / 0 мировых единиц. При пороге 16 пикселей и вертикальном угле 40° на
    // высоте 720 px переключения приходятся примерно на 6200 и 620 единиц до габаритов.
    await placeCamera(page, 12000);
    const far = await getStats(page);

    await placeCamera(page, 3000);
    const middle = await getStats(page);

    await placeCamera(page, 900);
    const near = await getStats(page);

    expect(far.maxSelectedDepth).toBe(0);
    expect(middle.maxSelectedDepth).toBeGreaterThan(far.maxSelectedDepth);
    expect(near.maxSelectedDepth).toBeGreaterThan(middle.maxSelectedDepth);

    // REPLACE не показывает уровни одновременно.
    expect(near.selected).toBe(1);
    expect(near.failed).toBe(0);

    expect(pageErrors).toEqual([]);
});

test('держит последний доступный LOD и не заменяет его пустой веткой при приближении', async ({ page }) => {
    test.setTimeout(300000);
    const box = (centerX: number, halfSize: number) => [
        centerX, 0, 0,
        halfSize, 0, 0,
        0, halfSize, 0,
        0, 0, halfSize
    ];
    const content = { uri: '/static/test-assets/BoxTextured.glb' };

    await page.route('**/terminal-lod/tileset.json', route => route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
            asset: { version: '1.1' },
            geometricError: 200,
            root: {
                boundingVolume: { box: box(0, 10) },
                geometricError: 100,
                refine: 'REPLACE',
                content,
                children: [
                    // Structural leaf with the same non-zero error pattern as Syria depth 5.
                    {
                        boundingVolume: { box: box(-2, 2) },
                        geometricError: 25,
                        content
                    },
                    // This is the deepest renderable tile for the current view. Its only child is
                    // far outside the frustum, so replacing it would create an empty hole.
                    {
                        boundingVolume: { box: box(2, 2) },
                        geometricError: 50,
                        content,
                        children: [{
                            boundingVolume: { box: box(1000, 1) },
                            geometricError: 25,
                            content
                        }]
                    }
                ]
            }
        })
    }));

    await page.goto('/?webgl&load=models%2Ftest%2Fterminal-lod%2Ftileset.json');
    await waitForViewer(page);
    await page.waitForFunction(() => (window as any).viewer?.observer?.get('scene.isTileset') === true);
    await page.evaluate(() => {
        const viewer = (window as any).viewer;
        const Vec3 = viewer.camera.getPosition().constructor;
        viewer.cameraControls.reset(new Vec3(0, 0, 0), new Vec3(0, 0, 15));
        viewer.fitCameraClipPlanes();
    });
    await pumpFrames(page, 120);
    await page.waitForFunction(() => {
        const manager = (window as any).viewer?.tileManager;
        const [leaf, fallback] = manager?.rootTile?.children ?? [];
        return leaf?.state === 'ready' && fallback?.state === 'ready';
    }, undefined, { timeout: 120000 });
    await pumpFrames(page, 10);

    const lod = await page.evaluate(() => {
        const manager = (window as any).viewer.tileManager;
        const root = manager.rootTile;
        const [leaf, fallback] = root.children;
        const unavailableChild = fallback.children[0];
        return {
            rootSelected: root.selected,
            leafSelected: leaf.selected,
            leafGeometricError: leaf.geometricError,
            leafScreenSpaceError: leaf.error,
            fallbackSelected: fallback.selected,
            unavailableChildSelected: unavailableChild.selected,
            selectedDepth: manager.getStats().maxSelectedDepth
        };
    });

    expect(lod.rootSelected).toBe(false);
    expect(lod.leafSelected).toBe(true);
    expect(lod.leafGeometricError).toBe(25);
    expect(lod.leafScreenSpaceError).toBe(0);
    expect(lod.fallbackSelected).toBe(true);
    expect(lod.unavailableChildSelected).toBe(false);
    expect(lod.selectedDepth).toBe(1);
});

test('отбор LOD следует за pivot, переносом и поворотом тайлсета', async ({ page }) => {
    test.skip(!await samplesAvailable(page, DISCRETE_LOD),
        'Нет сэмплов: запустите scripts/fetch-3d-tiles-samples.sh');

    await page.goto(`/?load=${encodeURIComponent(DISCRETE_LOD)}`);
    await waitForViewer(page);
    await waitForTiles(page);

    const pivot = await page.evaluate(() => {
        const viewer = (window as any).viewer;
        const geometryBounds = new viewer.sceneBounds.constructor();
        const hasGeometry = viewer.tileManager.getGeometryBounds(geometryBounds);
        viewer.setObjectPivotToCenter();
        const pivot = viewer.sceneRoot.getPosition();
        const pivotPosition = [pivot.x, pivot.y, pivot.z];
        viewer.sceneTransform = {
            ...viewer.sceneTransform,
            position: [4200, 350, -2700],
            rotation: [12, 47, -8]
        };
        viewer.setCenterScene(false);
        return {
            hasGeometry,
            geometryCenter: [geometryBounds.center.x, geometryBounds.center.y, geometryBounds.center.z],
            pivotPosition
        };
    });
    await pumpFrames(page, 10);

    const transformed = await page.evaluate(() => {
        const viewer = (window as any).viewer;
        const manager = viewer.tileManager;
        const root = manager.rootTile;
        const center = manager.bounds.center;
        const Vec3 = viewer.camera.getPosition().constructor;
        const offset = 900 / Math.sqrt(3);
        viewer.cameraControls.reset(
            new Vec3(center.x, center.y, center.z),
            new Vec3(center.x + offset, center.y + offset, center.z + offset)
        );
        viewer.fitCameraClipPlanes();
        return {
            managerCenter: [center.x, center.y, center.z],
            rootObbCenter: [root.obb.center.x, root.obb.center.y, root.obb.center.z]
        };
    });
    await pumpFrames(page, 90);

    const stats = await getStats(page);
    const viewerBoundsCenter = await page.evaluate(() => {
        const raw = String((window as any).viewer.observer.get('scene.boundsCenter'));
        return (raw.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi) ?? []).slice(0, 3).map(Number);
    });
    expect(pivot.hasGeometry).toBe(true);
    pivot.pivotPosition.forEach((value, index) =>
        expect(value).toBeCloseTo(pivot.geometryCenter[index], 5));
    expect(transformed.managerCenter[0]).toBeGreaterThan(3000);
    transformed.rootObbCenter.forEach((value, index) =>
        expect(value).toBeCloseTo(transformed.managerCenter[index], 4));
    viewerBoundsCenter.forEach((value, index) =>
        expect(value).toBeCloseTo(transformed.managerCenter[index], 4));
    expect(stats.selected).toBeGreaterThan(0);
    expect(stats.maxSelectedDepth).toBeGreaterThan(0);
});

test('тайлы попадают в выбор и в измерения (глубинный picker)', async ({ page }) => {
    test.skip(!await samplesAvailable(page, DISCRETE_LOD),
        'Нет сэмплов: запустите scripts/fetch-3d-tiles-samples.sh');

    await page.goto(`/?load=${encodeURIComponent(DISCRETE_LOD)}`);
    await waitForViewer(page);
    await waitForTiles(page);

    // Инструменты вьюера (выделение, измерения, точки интереса) держатся на подмене
    // чанка `pickPS` — тайлы обязаны попадать в этот проход, иначе клики по ним
    // проваливаются сквозь модель.
    const result = await page.evaluate(() => {
        const viewer = (window as any).viewer;
        const device = viewer.app.graphicsDevice;
        const x = device.width / 2;
        const y = device.height / 2;
        return {
            selected: viewer.selectionController.selectNodeByRay(x, y),
            surface: viewer.measurementController.pickSurfacePoint(x, y) !== null
        };
    });

    expect(result.selected).toBe(true);
    expect(result.surface).toBe(true);
});

test('разворачивает неявное дерево (implicit tiling, Cesium ion)', async ({ page }) => {
    test.skip(!await samplesAvailable(page, HRAM),
        'Нет тайлсета: распакуйте архив из ion в dist/models/3d-tiles/hram');
    // Набор тяжелее сэмплов: 552 тайла и десятки мегабайт на подъезде к модели.
    test.setTimeout(300000);

    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));

    await page.goto(`/?load=${encodeURIComponent(HRAM)}`);
    await waitForViewer(page);
    // Набор тяжёлый: общих 20 секунд на первый выбранный тайл ему не хватает.
    await waitForTiles(page, 120000);

    // Октодерево: 5 уровней в корневом файле масок и вложенные поддеревья глубже. В JSON
    // тайлов нет вообще — если разбор масок сломается, дерево останется из одного узла.
    const initial = await getStats(page);
    expect(initial.tiles).toBeGreaterThan(300);
    expect(initial.failed).toBe(0);

    // Подъезжаем: должны прийти более глубокие уровни, в том числе из вложенных поддеревьев
    // (они начинаются с пятого — там, где заканчивается корневой файл масок).
    await placeCameraAtScene(page, 60);
    const far = await getStats(page);
    await placeCameraAtScene(page, 4);
    const near = await getStats(page);

    const pivot = await page.evaluate(() => {
        const viewer = (window as any).viewer;
        const geometryBounds = new viewer.sceneBounds.constructor();
        const hasGeometry = viewer.tileManager.getGeometryBounds(geometryBounds);
        viewer.setObjectPivotToCenter();
        const position = viewer.sceneRoot.getPosition();
        return {
            hasGeometry,
            geometryCenter: [geometryBounds.center.x, geometryBounds.center.y, geometryBounds.center.z],
            pivotPosition: [position.x, position.y, position.z]
        };
    });

    expect(near.maxSelectedDepth).toBeGreaterThan(far.maxSelectedDepth);
    expect(near.maxSelectedDepth).toBeGreaterThanOrEqual(5);
    // Разворачивание вложенных поддеревьев добавляет узлы в дерево на ходу.
    expect(near.tiles).toBeGreaterThan(initial.tiles);
    expect(near.failed).toBe(0);
    expect(pivot.hasGeometry).toBe(true);
    pivot.pivotPosition.forEach((value, index) =>
        expect(value).toBeCloseTo(pivot.geometryCenter[index], 4));
    expect(pageErrors).toEqual([]);
});

test('убирает тайлсет из сцены при её сбросе', async ({ page }) => {
    test.skip(!await samplesAvailable(page, DISCRETE_LOD),
        'Нет сэмплов: запустите scripts/fetch-3d-tiles-samples.sh');

    await page.goto(`/?load=${encodeURIComponent(DISCRETE_LOD)}`);
    await waitForViewer(page);
    await waitForTiles(page);

    const before = await page.evaluate(() => ({
        hasRoot: !!(window as any).viewer.sceneContentRoot.findByName('tilesRoot'),
        assets: (window as any).viewer.app.assets.list().length
    }));
    expect(before.hasRoot).toBe(true);

    await page.evaluate(() => (window as any).viewer.resetScene());

    const after = await page.evaluate(() => ({
        stats: (window as any).viewer.getTileStats(),
        hasRoot: !!(window as any).viewer.sceneContentRoot.findByName('tilesRoot'),
        assets: (window as any).viewer.app.assets.list().length
    }));

    expect(after.stats).toBeNull();
    expect(after.hasRoot).toBe(false);
    // Ассеты контента тоже должны уйти, иначе каждая новая сцена оставляла бы за собой
    // весь загруженный тайлсет.
    expect(after.assets).toBeLessThan(before.assets);
});

/** Состояние отладочного оверлея тайлов: OBB-контуры, ViewCube и HUD. */
const tileDebugState = (page: Page) => page.evaluate(() => {
    const viewer = (window as any).viewer;
    const dl = viewer.debugTiles;
    const solid = viewer.debugTilesSolid;
    const fill = viewer.debugTilesFill;
    const hud = document.getElementById('tile-debug-hud');
    return {
        visible: !!dl.meshInstances[0].visible,
        lineCount: dl.mesh.primitive[0].count,
        solidVisible: !!solid.meshInstance.visible,
        solidCount: solid.mesh.primitive[0].count,
        edgeColor: solid.colorData[3] >>> 0,
        fillVisible: !!fill.meshInstance.visible,
        fillCount: fill.mesh.primitive[0].count,
        fillColor: fill.colorData[3] >>> 0,
        ribbonWidth: Math.hypot(
            solid.vertexData[0] - solid.vertexData[20],
            solid.vertexData[1] - solid.vertexData[21],
            solid.vertexData[2] - solid.vertexData[22]
        ),
        viewCubeDisplay: viewer.viewCube ? getComputedStyle(viewer.viewCube.dom).display : 'absent',
        hudDisplay: hud ? getComputedStyle(hud).display : 'absent',
        hudText: hud?.textContent ?? ''
    };
});

test('отладочный оверлей тайлов: OBB активных тайлов + живой HUD', async ({ page }) => {
    test.skip(!await samplesAvailable(page, DISCRETE_LOD),
        'Нет сэмплов: запустите scripts/fetch-3d-tiles-samples.sh');

    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));

    await page.goto(`/?load=${encodeURIComponent(DISCRETE_LOD)}`);
    await waitForViewer(page);
    await waitForTiles(page);

    // Тайлсет распознан — под него и заведена категория UI.
    const isTileset = await page.evaluate(() => (window as any).viewer.observer.get('scene.isTileset'));
    expect(isTileset).toBe(true);

    // По умолчанию оверлей выключен: линий нет, HUD не создан.
    const off = await tileDebugState(page);
    expect(off.visible).toBe(false);
    expect(off.hudDisplay).toBe('absent');

    // Debug-инструмент не должен утекать в production из сохранённых настроек проекта.
    const productionDefaults = await page.evaluate(() => {
        const viewer = (window as any).viewer;
        viewer.applyViewerSettings({
            debug: {
                tileDebug: true,
                tileCheckerFill: true,
                tilePick: true,
                tileIsolatePick: true,
                tileFreeze: true,
                tileRecording: true,
                tilePaused: true,
                tileLodLock: true
            }
        });
        return {
            tileDebug: viewer.observer.get('debug.tileDebug'),
            tileCheckerFill: viewer.observer.get('debug.tileCheckerFill'),
            tilePick: viewer.observer.get('debug.tilePick'),
            tileIsolatePick: viewer.observer.get('debug.tileIsolatePick'),
            tileFreeze: viewer.observer.get('debug.tileFreeze'),
            tileRecording: viewer.observer.get('debug.tileRecording'),
            tilePaused: viewer.observer.get('debug.tilePaused'),
            tileLodLock: viewer.observer.get('debug.tileLodLock')
        };
    });
    expect(productionDefaults).toEqual({
        tileDebug: false,
        tileCheckerFill: false,
        tilePick: false,
        tileIsolatePick: false,
        tileFreeze: false,
        tileRecording: false,
        tilePaused: false,
        tileLodLock: false
    });

    // Вплотную — есть и выбранный уровень (заливка), и загруженные грубые уровни, не попавшие
    // в выбор (каркас-контекст): так проверяем обе части оверлея.
    await placeCamera(page, 900);

    // Включаем через observer (то же, что делает кнопка в панели), режим по умолчанию — state.
    await page.evaluate(() => (window as any).viewer.observer.set('debug.tileDebug', true));
    await pumpFrames(page, 5);

    const onState = await tileDebugState(page);
    // Контуры выбранных тайлов рисуются толстыми лентами в solid-буфере (треугольники).
    expect(onState.solidVisible).toBe(true);
    expect(onState.solidCount).toBeGreaterThan(0);
    expect(onState.fillVisible).toBe(false);
    // Навигационный куб доступен прямо в инструменте визуализации тайлов.
    expect(onState.viewCubeDisplay).not.toBe('none');
    expect(onState.hudDisplay).toBe('block');
    // HUD показывает счётчики: заголовок и число выбранных тайлов из getStats().
    expect(onState.hudText).toContain('TILES');
    const selected = (await getStats(page)).selected;
    expect(onState.hudText).toContain(`selected ${selected}`);

    // Переключение на LOD-раскраску: контуры по-прежнему рисуются, HUD помечает режим.
    await page.evaluate(() => (window as any).viewer.observer.set('debug.tileDebugMode', 'lod'));
    await pumpFrames(page, 5);
    const onLod = await tileDebugState(page);
    expect(onLod.solidVisible).toBe(true);
    expect(onLod.solidCount).toBeGreaterThan(0);
    expect(onLod.hudText).toContain('mode: lod');

    // Ползунок меняет геометрическую ширину ленты без изменения числа контуров.
    await page.evaluate(() => (window as any).viewer.observer.set('debug.tileLineThickness', 8));
    await pumpFrames(page, 5);
    const thick = await tileDebugState(page);
    expect(thick.solidCount).toBe(onLod.solidCount);
    expect(thick.ribbonWidth).toBeGreaterThan(onLod.ribbonWidth * 3);

    // Ровный каркас убирает шахматное затемнение, но сохраняет палитру выбранного LOD.
    await page.evaluate(() => (window as any).viewer.observer.set('debug.tileLineStyle', 'solid'));
    await pumpFrames(page, 5);
    const uniform = await tileDebugState(page);
    const uniformDepth = (await getStats(page)).maxSelectedDepth;
    expect(uniform.edgeColor).toBe(lodColorAbgr(uniformDepth));
    expect(uniform.fillVisible).toBe(false);

    // В шахматном режиме заливка включается отдельно и не влияет на число рёбер.
    await page.evaluate(() => {
        const observer = (window as any).viewer.observer;
        observer.set('debug.tileLineStyle', 'checker');
        observer.set('debug.tileCheckerFill', true);
    });
    await pumpFrames(page, 5);
    const checkerFilled = await tileDebugState(page);
    expect(checkerFilled.fillVisible).toBe(true);
    expect(checkerFilled.fillCount).toBeGreaterThan(0);
    expect(checkerFilled.fillColor).toBe(0x33000000);
    expect(checkerFilled.solidCount).toBe(uniform.solidCount);

    await page.evaluate(() => (window as any).viewer.observer.set('debug.tileCheckerFill', false));
    await pumpFrames(page, 5);
    expect((await tileDebugState(page)).fillVisible).toBe(false);

    // Режим инспекции взаимоисключающий с измерениями и выбирает тайл точным raycast'ом
    // по поверхности. Выбранный тайл получает усиленный белый OBB и карточку в HUD.
    const pickMode = await page.evaluate(() => {
        const viewer = (window as any).viewer;
        viewer.observer.set('measure.enabled', true);
        viewer.observer.set('debug.tilePick', true);
        return {
            measure: viewer.observer.get('measure.enabled'),
            cursor: viewer.canvas.style.cursor
        };
    });
    expect(pickMode.measure).toBe(false);
    expect(pickMode.cursor).toBe('crosshair');

    const canvas = page.locator('#application-canvas');
    const canvasBox = await canvas.boundingBox();
    expect(canvasBox).not.toBeNull();
    await page.mouse.click(canvasBox!.x + canvasBox!.width / 2, canvasBox!.y + canvasBox!.height / 2);
    await pumpFrames(page, 5);

    const picked = await page.evaluate(() => (window as any).viewer.getPickedTileInfo());
    expect(picked).not.toBeNull();
    expect(picked.depth).toBeGreaterThanOrEqual(0);
    expect(picked.screenSpaceError).toBeGreaterThanOrEqual(0);
    expect(picked.geometricError).toBeGreaterThanOrEqual(0);
    expect(picked.distance).toBeGreaterThanOrEqual(0);
    expect(picked.bytes).toBeGreaterThan(0);
    expect(picked.triangles).toBeGreaterThan(0);
    expect(picked.urls.length).toBeGreaterThan(0);

    const pickedOverlay = await tileDebugState(page);
    expect(pickedOverlay.ribbonWidth).toBeGreaterThan(thick.ribbonWidth * 1.5);
    expect(pickedOverlay.hudText).toContain('PICKED TILE');
    expect(pickedOverlay.hudText).toContain('triangles');

    // Выключение прячет контуры и HUD.
    await page.evaluate(() => (window as any).viewer.observer.set('debug.tileDebug', false));
    await pumpFrames(page, 5);
    const disabled = await tileDebugState(page);
    expect(disabled.solidVisible).toBe(false);
    expect(disabled.viewCubeDisplay).toBe('none');
    expect(disabled.hudDisplay).toBe('none');

    expect(pageErrors).toEqual([]);
});

test('production fragment box clips tile geometry exactly and restores materials', async ({ page }) => {
    test.skip(!await samplesAvailable(page, DISCRETE_LOD),
        'Нет сэмплов: запустите scripts/fetch-3d-tiles-samples.sh');

    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto(`/?webgl&load=${encodeURIComponent(DISCRETE_LOD)}`);
    await waitForViewer(page);
    await waitForTiles(page);
    await placeCamera(page, 900);

    await expect(page.locator('#fragment-button')).toBeVisible();
    await page.locator('#fragment-button').click();
    expect(await page.evaluate(() => (window as any).viewer.observer.get('fragment.selecting'))).toBe(true);
    const picked = await page.evaluate(() => {
        const viewer = (window as any).viewer;
        const canvas = document.querySelector('#application-canvas') as HTMLCanvasElement;
        const positions = [0.5, 0.35, 0.65, 0.25, 0.75];
        for (const y of positions) {
            for (const x of positions) {
                const clickX = canvas.clientWidth * x;
                const clickY = canvas.clientHeight * y;
                if (viewer.pickFragmentAt(clickX, clickY)) {
                    const screen = viewer.camera.camera.worldToScreen(viewer.fragmentBoxEntity.getPosition());
                    const device = viewer.app.graphicsDevice;
                    return {
                        click: [clickX, clickY],
                        center: [
                            screen.x * canvas.clientWidth / device.width,
                            screen.y * canvas.clientHeight / device.height
                        ]
                    };
                }
            }
        }
        return null;
    });
    expect(picked).not.toBeNull();
    expect(picked!.center[0]).toBeCloseTo(picked!.click[0], 1);
    expect(picked!.center[1]).toBeCloseTo(picked!.click[1], 1);
    await pumpFrames(page, 5);

    const initial = await page.evaluate(() => {
        const viewer = (window as any).viewer;
        const size = viewer.observer.get('fragment.size') as number[];
        return {
            enabled: viewer.observer.get('fragment.enabled'),
            initialized: viewer.observer.get('fragment.initialized'),
            size,
            overlayVertices: viewer.debugFragmentBoxSolid.mesh.primitive[0].count,
            panelVisible: !(document.querySelector('.fragment-panel')?.closest('.popup-panel-parent') as HTMLElement)?.hidden
        };
    });
    expect(initial.enabled).toBe(false);
    expect(initial.initialized).toBe(true);
    expect(initial.panelVisible).toBe(true);
    expect(initial.size.every(value => value > 0)).toBe(true);
    expect(initial.overlayVertices).toBeGreaterThan(72);
    await expect(page.locator('.fragment-primary-actions .pcui-button')).toHaveCount(2);
    await expect(page.locator('.fragment-mode-toolbar .pcui-button')).toHaveCount(3);
    await expect(page.getByText('FIT BOX TO MODEL', { exact: true })).toHaveCount(0);
    await expect(page.getByText('EXIT MODE', { exact: true })).toHaveCount(0);
    await expect(page.locator('.fragment-panel button:not(.pcui-button)')).toHaveCount(0);
    const initialRotation = await page.evaluate(() => (window as any).viewer.observer.get('fragment.rotation'));
    expect(initialRotation[0]).toBeCloseTo(0, 5);
    expect(initialRotation[2]).toBeCloseTo(0, 5);

    await page.evaluate(() => (window as any).viewer.observer.set('fragment.editMode', 'rotate'));
    await pumpFrames(page, 1);
    const rotateMode = await page.evaluate(() => {
        const viewer = (window as any).viewer;
        return {
            mode: viewer.observer.get('fragment.editMode'),
            rotateEnabled: viewer.fragmentRotateGizmo.enabled,
            moveEnabled: viewer.fragmentTranslateGizmo.enabled
        };
    });
    expect(rotateMode).toEqual({ mode: 'rotate', rotateEnabled: true, moveEnabled: false });

    await page.evaluate(() => (window as any).viewer.observer.set('fragment.editMode', 'move'));
    await pumpFrames(page, 1);
    const moveMode = await page.evaluate(() => {
        const viewer = (window as any).viewer;
        return {
            mode: viewer.observer.get('fragment.editMode'),
            coordSpace: viewer.fragmentTranslateGizmo.coordSpace,
            rotateEnabled: viewer.fragmentRotateGizmo.enabled,
            moveEnabled: viewer.fragmentTranslateGizmo.enabled
        };
    });
    expect(moveMode).toEqual({ mode: 'move', coordSpace: 'local', rotateEnabled: false, moveEnabled: true });

    // Вне изоляции F кадрирует всю сцену, а не бокс: бокс здесь ещё настраивают, и прыжок
    // камеры на него мешал бы. Внутри изоляции наоборот — кадрируется сам фрагмент.
    const focusDistanceToBox = () => page.evaluate(() => {
        const viewer = (window as any).viewer;
        return viewer.cameraControls.getFocus().distance(viewer.fragmentBoxEntity.getPosition());
    });

    await page.keyboard.press('f');
    await pumpFrames(page, 1);
    expect(await focusDistanceToBox()).toBeGreaterThan(0.0001);

    await page.locator('.fragment-isolate-button').click();
    await pumpFrames(page, 3);
    const isolatedOverlayVertices = await page.evaluate(() =>
        (window as any).viewer.debugFragmentBoxSolid.mesh.primitive[0].count);
    expect(isolatedOverlayVertices).toBe(72);

    await page.keyboard.press('f');
    await pumpFrames(page, 1);
    expect(await focusDistanceToBox()).toBeLessThan(0.0001);

    const clipped = await page.evaluate((initialSize) => {
        const viewer = (window as any).viewer;
        viewer.observer.set('fragment.size', [initialSize[0] * 0.45, initialSize[1] * 0.8, initialSize[2] * 0.8]);
        viewer.observer.set('fragment.rotation', [0, 37, 0]);
        viewer.app.tick(performance.now());
        const materials = viewer.tileManager.getVisibleMeshInstances().map((mi: any) => mi.material);
        return {
            rotation: viewer.fragmentBoxEntity.getEulerAngles().y,
            enabled: viewer.observer.get('fragment.enabled'),
            shaderInstalled: materials.some((material: any) =>
                material.shaderChunks.glsl.get('litUserMainStartPS')?.includes('clipBoxInside')),
            tileFilterEnabled: !!viewer.tileManager.clipBoxWorldToLocal
        };
    }, initial.size);
    expect(clipped.rotation).toBeCloseTo(37, 1);
    expect(clipped.enabled).toBe(true);
    expect(clipped.shaderInstalled).toBe(true);
    expect(clipped.tileFilterEnabled).toBe(true);

    await page.locator('.fragment-isolate-button').click();
    await pumpFrames(page, 3);
    const restored = await page.evaluate(() => {
        const viewer = (window as any).viewer;
        const materials = viewer.tileManager.getVisibleMeshInstances().map((mi: any) => mi.material);
        return {
            enabled: viewer.observer.get('fragment.enabled'),
            tileFilter: viewer.tileManager.clipBoxWorldToLocal,
            shaderStillInstalled: materials.some((material: any) =>
                material.shaderChunks.glsl.get('litUserMainStartPS')?.includes('clipBoxInside'))
        };
    });
    expect(restored.enabled).toBe(false);
    expect(restored.tileFilter).toBeNull();
    expect(restored.shaderStillInstalled).toBe(false);
    expect(pageErrors).toEqual([]);
});

const setFlag = (page: Page, key: string, value: unknown) =>
    page.evaluate(([k, v]) => (window as any).viewer.observer.set(k, v), [key, value] as const);

test('модуль таймлайна загружается только при первом входе в редактор', async ({ page }) => {
    test.skip(!await samplesAvailable(page, DISCRETE_LOD),
        'Нет сэмплов: запустите scripts/fetch-3d-tiles-samples.sh');

    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));

    await page.goto(`/?load=${encodeURIComponent(DISCRETE_LOD)}`);
    await waitForViewer(page);
    await waitForTiles(page);

    const initial = await page.evaluate(() => ({
        panelExists: !!document.querySelector('#timeline-panel'),
        timelineRequests: performance.getEntriesByType('resource')
        .filter(entry => entry.name.includes('tile-replay-timeline')).length
    }));
    expect(initial).toEqual({ panelExists: false, timelineRequests: 0 });

    await setFlag(page, 'debug.tileRecording', true);
    await page.waitForTimeout(120);
    const cachedSelectionEvent = await page.evaluate(() => {
        const manager = (window as any).viewer.tileManager;
        const cached = manager.prevSelection[0];
        if (!cached) return null;
        const before = manager.loadCounter;
        cached.loadSequence = 0;
        manager.prevSelection = [];
        manager.applySelection([cached]);
        return {
            counterAdvanced: manager.loadCounter > before,
            time: cached.loadTime
        };
    });
    expect(cachedSelectionEvent).not.toBeNull();
    expect(cachedSelectionEvent?.counterAdvanced).toBe(true);
    expect(cachedSelectionEvent?.time).toBeGreaterThan(0);
    await setFlag(page, 'debug.tileRecording', false);
    await pumpFrames(page, 2);
    await expect(page.locator('#timeline-panel')).toBeVisible();
    await expect.poll(() => page.evaluate(() => performance.getEntriesByType('resource')
    .filter(entry => entry.name.includes('tile-replay-timeline')).length)).toBe(1);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('Space');
    await expect.poll(() => page.evaluate(() => (window as any).viewer.tileReplayPlaying)).toBe(true);
    await page.keyboard.press('Space');
    await expect.poll(() => page.evaluate(() => (window as any).viewer.tileReplayPlaying)).toBe(false);

    const milestones = await page.evaluate(() => (window as any).viewer.tileManager.getLoadOrderMilestones());
    const externalTilesetMilestone = await page.evaluate(() => {
        const manager = (window as any).viewer.tileManager;
        const root = manager.rootTile;
        const externalRoot = root?.children?.[0];
        if (!root || !externalRoot) return null;
        const previousExternalRoot = root.externalRoot;
        const previousRootSequence = root.loadSequence;
        const previousSequence = externalRoot.loadSequence;
        const previousTime = externalRoot.loadTime;
        try {
            // External tilesets replace the wrapper's ordinary children at traversal time.
            // Their recorded tiles must still contribute LOD milestones to the timeline.
            root.externalRoot = externalRoot;
            root.loadSequence = 0;
            externalRoot.loadSequence = 1234;
            externalRoot.loadTime = 3.5;
            return manager.getLoadOrderMilestones().find((item: { sequence: number }) => item.sequence === 1234) ?? null;
        } finally {
            root.externalRoot = previousExternalRoot;
            root.loadSequence = previousRootSequence;
            externalRoot.loadSequence = previousSequence;
            externalRoot.loadTime = previousTime;
        }
    });
    expect(externalTilesetMilestone).toMatchObject({ sequence: 1234, time: 3.5 });
    const markers = await page.locator('.time-label.key[data-kind="first"]').evaluateAll(elements => elements.map((element) => ({
        kind: (element as HTMLElement).dataset.kind,
        depth: Number((element as HTMLElement).dataset.depth),
        sequence: Number((element as HTMLElement).dataset.sequence),
        title: element.getAttribute('title'),
        ariaLabel: element.getAttribute('aria-label')
    })));
    expect(markers.length).toBeGreaterThan(0);
    expect(markers.map(({ depth, sequence }) => ({ depth, sequence }))).toEqual(
        milestones.map(({ depth, sequence }: { depth: number, sequence: number }) => ({ depth, sequence }))
    );
    expect(new Set(markers.map(marker => marker.depth)).size).toBe(markers.length);
    markers.forEach(({ kind, depth, sequence, title, ariaLabel }) => {
        expect(kind).toBe('first');
        expect(title).toBe(`LOD ${depth} first appeared · frame ${sequence}`);
        expect(ariaLabel).toBe(title);
    });

    const lastMarkers = await page.locator('.time-label.key[data-kind="last"]').evaluateAll(elements => elements.map((element) => ({
        kind: (element as HTMLElement).dataset.kind,
        depth: Number((element as HTMLElement).dataset.depth),
        sequence: Number((element as HTMLElement).dataset.sequence),
        title: element.getAttribute('title'),
        ariaLabel: element.getAttribute('aria-label')
    })));
    expect(lastMarkers.length).toBe(milestones.length);
    expect(lastMarkers.map(({ depth, sequence }) => ({ depth, sequence }))).toEqual(
        milestones.map(({ depth, lastSequence }: { depth: number, lastSequence: number }) => ({ depth, sequence: lastSequence }))
    );
    lastMarkers.forEach(({ kind, depth, sequence, title, ariaLabel }) => {
        expect(kind).toBe('last');
        expect(title).toBe(`LOD ${depth} last load in recording · frame ${sequence}`);
        expect(ariaLabel).toBe(title);
    });

    const timecodeLabels = await page.locator('#ticks-area > .time-label:not(.key):not(.cursor)').allTextContents();
    await expect(page.locator('#tile-timeline-unit option')).toHaveCount(2);
    await page.locator('#tile-timeline-unit').selectOption('frames');
    await page.locator('#tile-timeline-fps').selectOption('60');
    await pumpFrames(page, 2);
    const frameLabels = await page.locator('#ticks-area > .time-label:not(.key):not(.cursor)').allTextContents();
    expect(frameLabels).not.toEqual(timecodeLabels);
    // Unit conversion is presentation-only: milestone source frames remain unchanged.
    const markersAfterUnitSwitch = await page.locator('.time-label.key[data-kind="first"]').evaluateAll(elements => elements.map(element => ({
        depth: Number((element as HTMLElement).dataset.depth),
        sequence: Number((element as HTMLElement).dataset.sequence)
    })));
    expect(markersAfterUnitSwitch).toEqual(markers.map(({ depth, sequence }) => ({ depth, sequence })));
    expect(pageErrors).toEqual([]);
});

test('таймлайн плавно интерполирует камеру между ключевыми кадрами', async ({ page }) => {
    test.skip(!await samplesAvailable(page, DISCRETE_LOD),
        'Нет сэмплов: запустите scripts/fetch-3d-tiles-samples.sh');

    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));

    await page.goto(`/?load=${encodeURIComponent(DISCRETE_LOD)}`);
    await waitForViewer(page);
    await waitForTiles(page);
    await setFlag(page, 'debug.tileRecording', true);
    await page.waitForTimeout(120);
    await setFlag(page, 'debug.tileRecording', false);

    const halfway = await page.evaluate(() => {
        const viewer = (window as any).viewer;
        const manager = viewer.tileManager;
        const template = manager.loadViews[0];
        if (!template) return null;

        // Два детерминированных ключа с одинаковым поворотом: середина дробной отметки
        // должна дать середину позиции, а не одну из двух ступеней.
        const firstWorld = template.world.clone().setFromEulerAngles(0, 0, 0);
        const secondWorld = template.world.clone().setFromEulerAngles(0, 90, 0);
        secondWorld.data[12] = 10;
        manager.loadViews.length = 0;
        manager.loadViews.push(
            { ...template, sequence: 1, time: 0, world: firstWorld },
            { ...template, sequence: 2, time: 1, world: secondWorld }
        );
        manager.loadCounter = 2;
        manager.recordingDuration = 1;

        viewer.observer.set('debug.tileReplay', 0.5);
        return {
            x: viewer.frozenTileCamera.world.data[12],
            yaw: viewer.frozenTileCamera.world.getEulerAngles().y,
            replayLimit: manager.replayLimit
        };
    });

    expect(halfway).not.toBeNull();
    expect(halfway?.x).toBeCloseTo(5, 4);
    expect(halfway?.yaw).toBeCloseTo(45, 3);
    expect(halfway?.replayLimit).toBeCloseTo(0.5, 6);
    expect(pageErrors).toEqual([]);
});

test('Фаза 2: заморозка фрустума фиксирует отбор при движении камеры', async ({ page }) => {
    test.skip(!await samplesAvailable(page, DISCRETE_LOD),
        'Нет сэмплов: запустите scripts/fetch-3d-tiles-samples.sh');

    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));

    await page.goto(`/?load=${encodeURIComponent(DISCRETE_LOD)}`);
    await waitForViewer(page);
    await waitForTiles(page);

    // Далеко — грубый уровень (глубина 0).
    await placeCamera(page, 12000);
    const far = await getStats(page);
    expect(far.maxSelectedDepth).toBe(0);

    // Замораживаем и подлетаем вплотную: отбор считается от «дальней» камеры, поэтому
    // уровень детализации не должен измениться, хотя камера уехала.
    await setFlag(page, 'debug.tileFreeze', true);
    await pumpFrames(page, 5);
    expect(await page.evaluate(() => (window as any).viewer.observer.get('debug.tilePaused'))).toBe(true);
    const automaticInspector = await page.evaluate(() => {
        const viewer = (window as any).viewer;
        const frozen = viewer.frozenTileCamera.world.data;
        const live = viewer.camera.getPosition();
        return Math.hypot(live.x - frozen[12], live.y - frozen[13], live.z - frozen[14]);
    });
    expect(automaticInspector).toBeGreaterThan(1000);
    await placeCamera(page, 900);
    const frozen = await getStats(page);
    expect(frozen.maxSelectedDepth).toBe(far.maxSelectedDepth);
    expect(frozen.selected).toBe(far.selected);
    const inspector = await page.evaluate(() => {
        const viewer = (window as any).viewer;
        const frozenWorld = viewer.frozenTileCamera?.world?.data;
        const live = viewer.camera.getPosition();
        return {
            lineVisible: viewer.debugTileCamera.meshInstances[0].visible,
            lineCount: viewer.debugTileCamera.mesh.primitive[0].count,
            solidVisible: viewer.debugTileCameraSolid.meshInstance.visible,
            solidCount: viewer.debugTileCameraSolid.mesh.primitive[0].count,
            frozenPosition: frozenWorld ? [frozenWorld[12], frozenWorld[13], frozenWorld[14]] : null,
            livePosition: [live.x, live.y, live.z]
        };
    });
    expect(inspector.lineVisible).toBe(true);
    expect(inspector.lineCount).toBeGreaterThan(20);
    expect(inspector.solidVisible).toBe(true);
    expect(inspector.solidCount).toBeGreaterThan(0);
    expect(inspector.frozenPosition).not.toBeNull();
    expect(Math.hypot(
        inspector.livePosition[0] - (inspector.frozenPosition?.[0] ?? 0),
        inspector.livePosition[1] - (inspector.frozenPosition?.[1] ?? 0),
        inspector.livePosition[2] - (inspector.frozenPosition?.[2] ?? 0)
    )).toBeGreaterThan(1000);
    // Разморозка возвращает рабочую камеру в сохранённую позу; после нового подлёта обход
    // снова считается от живой камеры и уровень углубляется.
    await setFlag(page, 'debug.tileFreeze', false);
    await pumpFrames(page, 10);
    // Freeze автоматически включает Pause, но не управляет ею при выключении.
    expect(await page.evaluate(() => (window as any).viewer.observer.get('debug.tilePaused'))).toBe(true);
    const restored = await getStats(page);
    expect(restored.maxSelectedDepth).toBe(frozen.maxSelectedDepth);
    const inspectorOff = await page.evaluate(() => {
        const viewer = (window as any).viewer;
        return {
            lineVisible: viewer.debugTileCamera.meshInstances[0].visible,
            solidVisible: viewer.debugTileCameraSolid.meshInstance.visible,
            snapshot: viewer.frozenTileCamera
        };
    });
    expect(inspectorOff.lineVisible).toBe(false);
    expect(inspectorOff.solidVisible).toBe(false);
    expect(inspectorOff.snapshot).toBeNull();

    await setFlag(page, 'debug.tilePaused', false);
    await placeCamera(page, 900);
    const live = await getStats(page);
    expect(live.maxSelectedDepth).toBeGreaterThan(frozen.maxSelectedDepth);

    expect(pageErrors).toEqual([]);
});

test('Фаза 2: пауза останавливает загрузку, снятие паузы продолжает её', async ({ page }) => {
    test.skip(!await samplesAvailable(page, DISCRETE_LOD),
        'Нет сэмплов: запустите scripts/fetch-3d-tiles-samples.sh');

    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));

    await page.goto(`/?load=${encodeURIComponent(DISCRETE_LOD)}`);
    await waitForViewer(page);
    await waitForTiles(page);

    // Устаканиваемся на грубом уровне, дальше грузиться нечему.
    await placeCamera(page, 12000);

    // Пауза, затем подлёт вплотную: нужны детальные тайлы — они встают в очередь, но не грузятся.
    await setFlag(page, 'debug.tilePaused', true);
    await placeCamera(page, 900);

    const paused = await getStats(page);
    expect(paused.queued).toBeGreaterThan(0);
    expect(paused.loading).toBe(0);

    // Пока на паузе — прогресса нет: лишние кадры не догружают ничего.
    await pumpFrames(page, 40);
    const stillPaused = await getStats(page);
    expect(stillPaused.ready).toBe(paused.ready);
    expect(stillPaused.loading).toBe(0);
    expect(stillPaused.queued).toBeGreaterThan(0);

    // Снятие паузы догоняет очередь до конца.
    await setFlag(page, 'debug.tilePaused', false);
    await pumpFrames(page, 80);
    const resumed = await getStats(page);
    expect(resumed.queued).toBe(0);

    expect(pageErrors).toEqual([]);
});

test('Фаза 2: ползунок LOD изолирует выбранный уровень', async ({ page }) => {
    test.skip(!await samplesAvailable(page, DISCRETE_LOD),
        'Нет сэмплов: запустите scripts/fetch-3d-tiles-samples.sh');

    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));

    await page.goto(`/?load=${encodeURIComponent(DISCRETE_LOD)}`);
    await waitForViewer(page);
    await waitForTiles(page);

    // Вплотную — полная детализация (у DISCRETE_LOD глубина доходит до 2).
    await placeCamera(page, 900);
    const full = await getStats(page);
    expect(full.maxSelectedDepth).toBeGreaterThan(0);

    // Верх ползунка — глубина дерева, известна панели.
    const treeDepth = await page.evaluate(() => (window as any).viewer.observer.get('scene.tilesetMaxDepth'));
    expect(treeDepth).toBeGreaterThanOrEqual(full.maxSelectedDepth);

    // Изоляция уровня 0 — виден только корень, как бы близко ни стояла камера.
    await setFlag(page, 'debug.tileLodLock', true);
    await setFlag(page, 'debug.tileLodLevel', 0);
    await pumpFrames(page, 20);
    const lod0 = await getStats(page);
    expect(lod0.maxSelectedDepth).toBe(0);
    expect(lod0.selected).toBe(1);

    // Изоляция уровня 1 — виден ровно этот уровень (не мельче, не крупнее).
    await setFlag(page, 'debug.tileLodLevel', 1);
    await pumpFrames(page, 20);
    const lod1 = await getStats(page);
    expect(lod1.maxSelectedDepth).toBe(1);
    // REPLACE: на уровне 1 показывается один тайл — родитель (уровень 0) уже скрыт.
    expect(lod1.selected).toBe(1);

    // Снятие изоляции — снова полная детализация.
    await setFlag(page, 'debug.tileLodLock', false);
    await pumpFrames(page, 60);
    const unlocked = await getStats(page);
    expect(unlocked.maxSelectedDepth).toBe(full.maxSelectedDepth);

    // Адаптивность: издалека, где экранная ошибка не требует глубокого уровня, изоляция
    // этого уровня не грузит всю сцену — показывать нечего (только видимые вблизи фрагменты).
    await placeCamera(page, 12000);
    await setFlag(page, 'debug.tileLodLock', true);
    await setFlag(page, 'debug.tileLodLevel', full.maxSelectedDepth);
    await pumpFrames(page, 30);
    const farDeep = await getStats(page);
    expect(farDeep.selected).toBe(0);

    expect(pageErrors).toEqual([]);
});
