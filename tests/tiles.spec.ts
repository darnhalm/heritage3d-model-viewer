import { expect, test, type Page } from '@playwright/test';

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

/** Дождаться, пока обход выберет хотя бы один тайл с готовым контентом. */
const waitForTiles = async (page: Page) => {
    await page.waitForFunction(() => {
        const stats = (window as any).viewer?.getTileStats?.();
        return !!stats && stats.selected > 0;
    }, undefined, { timeout: 20000 });
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
    await waitForTiles(page);

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

    expect(near.maxSelectedDepth).toBeGreaterThan(far.maxSelectedDepth);
    expect(near.maxSelectedDepth).toBeGreaterThanOrEqual(5);
    // Разворачивание вложенных поддеревьев добавляет узлы в дерево на ходу.
    expect(near.tiles).toBeGreaterThan(initial.tiles);
    expect(near.failed).toBe(0);
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
    const hud = document.getElementById('tile-debug-hud');
    return {
        visible: !!dl.meshInstances[0].visible,
        lineCount: dl.mesh.primitive[0].count,
        solidVisible: !!solid.meshInstance.visible,
        solidCount: solid.mesh.primitive[0].count,
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

    // Выключение прячет контуры и HUD.
    await page.evaluate(() => (window as any).viewer.observer.set('debug.tileDebug', false));
    await pumpFrames(page, 5);
    const disabled = await tileDebugState(page);
    expect(disabled.solidVisible).toBe(false);
    expect(disabled.viewCubeDisplay).toBe('none');
    expect(disabled.hudDisplay).toBe('none');

    expect(pageErrors).toEqual([]);
});

const setFlag = (page: Page, key: string, value: unknown) =>
    page.evaluate(([k, v]) => (window as any).viewer.observer.set(k, v), [key, value] as const);

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
    await placeCamera(page, 900);
    const frozen = await getStats(page);
    expect(frozen.maxSelectedDepth).toBe(far.maxSelectedDepth);
    expect(frozen.selected).toBe(far.selected);

    // Разморозка — обход снова считает от живой (близкой) камеры, уровень углубляется.
    await setFlag(page, 'debug.tileFreeze', false);
    await pumpFrames(page, 120);
    const live = await getStats(page);
    expect(live.maxSelectedDepth).toBeGreaterThan(frozen.maxSelectedDepth);

    expect(pageErrors).toEqual([]);
});

test('Фаза 2: пауза останавливает загрузку, шаг запускает по одной', async ({ page }) => {
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

    // Три шага запускают ровно свои загрузки; после прокрутки кадров готовых становится больше.
    const readyBefore = stillPaused.ready;
    await page.evaluate(() => {
        const v = (window as any).viewer;
        for (let i = 0; i < 3; i++) v.stepTileLoading();
    });
    await pumpFrames(page, 60);
    const stepped = await getStats(page);
    expect(stepped.ready).toBeGreaterThan(readyBefore);

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
