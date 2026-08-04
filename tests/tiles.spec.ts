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
