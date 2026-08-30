/**
 * Менеджер тайлов 3D Tiles: обход дерева, выбор уровня детализации, загрузка и выгрузка.
 *
 * Один менеджер обслуживает один тайлсет. Он владеет корневой entity, под которую вешается
 * контент, и полностью отвечает за её содержимое: вьюер про отдельные тайлы не знает.
 *
 * Системы координат. Тайлсет живёт в системе Z-вверх (у больших наборов — ECEF, с
 * координатами порядка 6.4e6), контент внутри тайлов — обычный glTF, то есть Y-вверх, а
 * вьюер рисует в Y-вверх. Отсюда две разные поправки:
 *
 * - на корневой entity — поворот Z-вверх → Y-вверх и сдвиг, ставящий тайлсет к началу
 *   координат (без него ECEF-набор оказался бы за 6400 км от камеры, где float32 в
 *   вершинных данных и в матрицах уже не хватает);
 * - на каждом контенте — обратный поворот Y-вверх → Z-вверх, потому что трансформации
 *   тайлов заданы в системе тайлсета, а glTF под ними — нет.
 *
 * Для простого тайлсета без своих трансформаций две поправки схлопываются в единицу, и
 * контент рисуется ровно так, как его сделал автор.
 */

import {
    BoundingBox, Entity, Frustum, Mat4, Quat, Vec3,
    type AppBase, type CameraComponent, type MeshInstance, type RenderComponent
} from 'playcanvas';

import type { DebugLines, DebugSolid } from '../debug-lines';
import { lodColorAbgr } from '../lod-palette';
import { expandSubtree, loadSubtreeAt, readImplicitTiling } from './implicit-tiling';
import { destroyTileContent, gltfUpAxisTransform, loadTileContent, type TileContentResult } from './tile-content';
import { distanceToObb, makeWorldObb, screenSpaceError } from './tile-math';
import { TileRequestQueue, compareTilePriority } from './tile-request-queue';
import {
    TILE_FAILED, TILE_LOADING, TILE_QUEUED, TILE_READY, TILE_UNLOADED,
    type Tile, type TileStats
} from './tile-types';
import { buildTileTree, fetchTilesetJson, findTightBoundingBox, forEachTile, recomputeWorldVolumes } from './tileset-loader';

/** Режим раскраски отладочных OBB тайлов. */
export type TileDebugMode = 'state' | 'lod';

export type TileDebugStyle = {
    lineThickness: number;
    /** `true` — шахматное чередование яркости; `false` — ровный цвет текущего State/LOD. */
    checker: boolean;
    /** Полупрозрачная заливка OBB в шахматном режиме. */
    checkerFill: boolean;
};

/** Данные выбранного кликом тайла для HUD и внешних инструментов отладки. */
export type TileDebugInfo = {
    urls: string[];
    depth: number;
    geometricError: number;
    screenSpaceError: number;
    distance: number;
    state: string;
    bytes: number;
    contentCount: number;
    triangles: number;
    refine: 'ADD' | 'REPLACE';
    selected: boolean;
    inFrustum: boolean;
};

/** Цвета состояний тайла для отладки, формат 0xAABBGGRR. */
const STATE_COLORS: Record<string, number> = {
    [TILE_QUEUED]: 0xff00ffff, // жёлтый — в очереди
    [TILE_LOADING]: 0xff0080ff, // оранжевый — грузится
    [TILE_READY]: 0xff00ff00, // зелёный — готов
    [TILE_FAILED]: 0xff0000ff // красный — ошибка
};
/** Ярко-голубой — тайл выбран обходом для отрисовки (перекрывает цвет состояния). */
const SELECTED_COLOR = 0xffffff00;
/** Белый контур — тайл, выбранный кликом в инспекторе. */
const PICKED_COLOR = 0xffffffff;
/**
 * Цвет уровня детализации по глубине тайла. Палитра общая с гауссовыми сплатами
 * (`src/lod-palette.ts`), чтобы отладка тайлов и сплатов читалась одинаково и обходилась
 * одной легендой в HUD.
 *
 * @param depth - Глубина тайла в дереве.
 * @returns Цвет 0xAABBGGRR для DebugLines/DebugSolid.
 */
const lodColor = (depth: number) => lodColorAbgr(depth);

/** Единица полуширины контурных лент в долях расстояния до камеры. Значение UI 2 = прежние 0.002. */
const EDGE_WIDTH_UNIT = 0.001;

/**
 * Индекс тайла вдоль его полуоси в единицах полного размера бокса — для шахматной чётности.
 * Сосед, смещённый на целый бокс вдоль оси, меняет индекс ровно на 1.
 *
 * @param center - Центр бокса (мировые координаты).
 * @param axis - Полуось бокса.
 * @returns Дробный индекс вдоль оси (вызывающий округляет).
 */
function gridIndex(center: Vec3, axis: Vec3): number {
    const lenSq = axis.lengthSq();
    if (lenSq < 1e-12) {
        return 0;
    }
    return (center.x * axis.x + center.y * axis.y + center.z * axis.z) / (2 * lenSq);
}

/**
 * Затемнить RGB цвета 0xAABBGGRR, сохранив альфу — для шахматного чередования яркости
 * контуров у соседних блоков.
 *
 * @param clr - Исходный цвет.
 * @param factor - Множитель яркости (0..1).
 * @returns Затемнённый цвет.
 */
function dimColor(clr: number, factor: number): number {
    const r = Math.round((clr & 0xff) * factor);
    const g = Math.round(((clr >> 8) & 0xff) * factor);
    const b = Math.round(((clr >> 16) & 0xff) * factor);
    const a = (clr >>> 24) & 0xff;
    return ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
}

/**
 * Заменить альфа-канал цвета 0xAABBGGRR.
 *
 * @param clr - Исходный упакованный цвет.
 * @param alpha - Новый альфа-канал 0..255.
 * @returns Цвет с заменённой альфой.
 */
function withAlpha(clr: number, alpha: number): number {
    return (((alpha & 0xff) << 24) | (clr & 0x00ffffff)) >>> 0;
}

export type TileManagerOptions = {
    app: AppBase;
    /** Камера, по которой считаются расстояния и фрустум. */
    camera: Entity;
    /** Узел, под который вешается корень тайлсета (у нас — `sceneContentRoot`). */
    parent: Entity;
    /** Позвать, когда картинка изменилась: у вьюера `app.autoRender === false`. */
    onChange: (transformChanged?: boolean) => void;
    /** Порог экранной ошибки в пикселях. 16 — значение по умолчанию в 3DTilesRendererJS. */
    errorTarget?: number;
    /** Одновременных загрузок. */
    maxConcurrent?: number;
    /** Сколько готовых, но невидимых тайлов держать в памяти. */
    maxCachedTiles?: number;
    /**
     * Потолок кэша по байтам контента. По умолчанию считается от площади вьюпорта,
     * см. `cacheByteBudget`.
     */
    maxCachedBytes?: number;
    /** Куда писать предупреждения о неподдержанных частях формата. */
    onWarning?: (message: string) => void;
};

const UP_AXIS_ROTATION = -90;

/** Ширина зоны гистерезиса вокруг порога SSE, доля от порога. */
const HYSTERESIS = 0.15;

/**
 * Бюджет кэша тайлов: байт контента на пиксель вьюпорта.
 *
 * Тайлы отбираются по экранной ошибке в пикселях, поэтому рабочий набор растёт вместе с
 * разрешением — бюджет, привязанный к площади вьюпорта, держит одинаковый запас и на
 * телефоне, и на 4K, чего фиксированное число тайлов не даёт.
 *
 * Байты здесь — размер скачанных GLB, а не занятая видеопамять: точной цифры по VRAM у нас
 * нет, а сетевой объём ей примерно пропорционален (по docs/GLB-TILING-PLAYCANVAS.md
 * распаковка даёт 4–10×). 48 Б/px — это ~100 МБ GLB на 1920×1080.
 */
const CACHE_BYTES_PER_PIXEL = 48;

/** Нижняя граница бюджета: в маленьком окне кэш не должен схлопываться до бесполезного. */
const CACHE_BYTES_MIN = 64 * 1024 * 1024;

/** Верхняя граница: на 4K линейный рост упёрся бы в память раньше, чем принёс пользу. */
const CACHE_BYTES_MAX = 256 * 1024 * 1024;

/** Порог `navigator.deviceMemory` (ГБ), ниже которого бюджет делится пополам. */
const CACHE_LOW_MEMORY_GB = 4;

/**
 * Потолок бюджета для телефонов и планшетов.
 *
 * По числу пикселей телефон выглядит как настольный монитор (390×844 при dpr 3 — это почти
 * 3 Мпx), а по доступной памяти — нет. Формула «байт на пиксель» отвечает на вопрос
 * «сколько тайлов понадобится» и отвечает верно; отдельный потолок отвечает на «сколько
 * можно себе позволить». Одного `deviceMemory` для этого мало: его отдаёт только Chromium,
 * а в Safari на iPhone его нет.
 *
 * Почему именно 128 МБ. Потолок обязан срабатывать не всегда, иначе он просто константа:
 * при 64 МБ он совпал бы с `CACHE_BYTES_MIN`, и на телефоне бюджет был бы ровно 64 МБ при
 * любом экране, а расчёт по пикселям под ним не значил бы ничего. При 128 МБ он режет
 * только самые плотные экраны (от ~2.8 Мпx), а телефон попроще получает свой расчётный
 * бюджет. Устройства, где браузер честно признаётся в малой памяти, к этому моменту уже
 * поделены пополам и в потолок не упираются.
 *
 * Число всё равно остаётся гипотезой: коэффициент распаковки гуляет от ~1× (геометрия без
 * сжатия плюс текстуры в KTX2) до десятков крат (JPEG в текстуре разворачивается в RGBA),
 * а мобильный профиль в docs/GLB-TILING-PLAYCANVAS.md помечен как непроверенный. Уточнять
 * его нужно замером на реальном устройстве, а не подбором.
 */
const CACHE_BYTES_MOBILE_MAX = 128 * 1024 * 1024;

/**
 * Во сколько раз нехватка памяти может загрубить порог экранной ошибки.
 *
 * Одного вытеснения мало: видимые тайлы не выгружаются никогда, поэтому если в бюджет не
 * влезает уже сам видимый набор, вытеснять нечего — кэш вырождается в «видимое и ничего
 * сверх», и любое движение камеры перекачивает тайлы заново. Выход — не держать
 * недостижимую детализацию, а честно её понизить: порог ошибки растёт, дерево уточняется
 * мельче, набор становится легче. Так же поступает CesiumJS
 * (`memoryAdjustedScreenSpaceError` при выходе за `cacheBytes`).
 *
 * Потолок в 8× нужен, чтобы патологический тайлсет не сваливался в один корневой тайл:
 * лучше показать грубо и переполнить бюджет, чем показать пустоту.
 */
const MEMORY_ERROR_SCALE_MAX = 8;

/**
 * Шаг подъёма порога за кадр, доля.
 *
 * Мелкий намеренно: скачок порога — это одномоментная смена уровня по всему экрану. При 2%
 * за кадр удвоение занимает порядка трети секунды, что читается как плавное огрубление, а
 * не как рывок.
 */
const MEMORY_ERROR_SCALE_STEP = 0.02;

/**
 * Шаг возврата порога к базовому за кадр, доля.
 *
 * Возврат намеренно медленнее подъёма вчетверо, и это не эстетика. Подъём — реакция на то,
 * что памяти не хватает уже сейчас; возврат — всего лишь проба, не полегчало ли, и каждая
 * такая проба стоит повторной закачки тайлов. При равных скоростях система встаёт в
 * качели: сбросили детализацию — влезли в бюджет — тут же вернули — снова не влезли.
 * Асимметрия оставляет систему в безопасном состоянии и заставляет её лишь изредка
 * проверять, можно ли обратно.
 */
const MEMORY_ERROR_RELAX_STEP = 0.005;

/**
 * Доля бюджета, ниже которой порог начинает возвращаться к базовому.
 *
 * Зазор между «повышать» и «понижать» обязателен: без него порог начнёт колебаться вокруг
 * границы бюджета, потому что каждое его изменение само меняет объём набора.
 */
const MEMORY_RELEASE_FRACTION = 0.8;

const tmpMat = new Mat4();
const rotationMat = new Mat4();
const tmpQuat = new Quat();
const tmpVec = new Vec3();

const tmpVecCentral = new Vec3();

/**
 * Доля вертикального полуугла камеры, которую считаем «центром кадра».
 *
 * Половина: конус достаточно узкий, чтобы центр что-то значил, и достаточно широкий, чтобы под
 * него попадало не одно ядро кадра.
 */
const CENTRAL_CONE_FRACTION = 0.5;

/**
 * Разложить матрицу в позицию/поворот/масштаб и применить к entity.
 *
 * Своё разложение, а не `Quat.setFromMat4` напрямую: у тайлов бывает масштаб в
 * трансформации, а извлекать поворот из ненормированного базиса нельзя.
 *
 * @param entity - Куда применить.
 * @param m - Матрица в системе родителя.
 */
function setLocalFromMat4(entity: Entity, m: Mat4) {
    const d = m.data;
    const sx = Math.hypot(d[0], d[1], d[2]) || 1;
    const sy = Math.hypot(d[4], d[5], d[6]) || 1;
    const sz = Math.hypot(d[8], d[9], d[10]) || 1;

    // Позиция снимается до того, как построен базис поворота: вызывающая сторона обычно
    // передаёт сюда общий временный `Mat4`, и запись в него затёрла бы исходные данные.
    entity.setLocalPosition(d[12], d[13], d[14]);
    entity.setLocalScale(sx, sy, sz);

    rotationMat.set([
        d[0] / sx, d[1] / sx, d[2] / sx, 0,
        d[4] / sy, d[5] / sy, d[6] / sy, 0,
        d[8] / sz, d[9] / sz, d[10] / sz, 0,
        0, 0, 0, 1
    ]);
    entity.setLocalRotation(tmpQuat.setFromMat4(rotationMat));
}

/**
 * Ниже какого расстояния от начала координат тайлсет считается негеографическим.
 *
 * Земной радиус — 6.37e6, локальные наборы живут в единицах и сотнях. Промежуток между
 * этими масштабами такой, что порог можно ставить грубо.
 */
const GEOREFERENCED_DISTANCE = 1e6;

/**
 * Поворот из ECEF в локальную систему «восток-север-верх» в заданной точке.
 *
 * Нужен, чтобы у георефересованного тайлсета вверх смотрела **местная** вертикаль, а не
 * земная ось: иначе сцена оказывается завалена на угол, равный дополнению широты.
 *
 * @param ecefPosition - Точка привязки тайлсета в ECEF.
 * @returns Матрица поворота; единичная, если точка не похожа на ECEF.
 */
function ecefToEnuRotation(ecefPosition: Vec3): Mat4 {
    const rotation = new Mat4();
    if (ecefPosition.length() < GEOREFERENCED_DISTANCE) {
        return rotation;
    }

    const up = ecefPosition.clone().normalize();
    // Восток — перпендикуляр к плоскости «земная ось / местная вертикаль». На самих
    // полюсах он вырождается, там берём произвольное направление.
    const east = new Vec3().cross(Vec3.BACK, up);
    if (east.length() < 1e-6) {
        east.set(1, 0, 0);
    }
    east.normalize();
    const north = new Vec3().cross(up, east).normalize();

    // Строки матрицы — базис ENU, то есть это транспонирование (и обращение) поворота
    // «ENU → ECEF». Раскладка данных у Mat4 по столбцам.
    rotation.set([
        east.x, north.x, up.x, 0,
        east.y, north.y, up.y, 0,
        east.z, north.z, up.z, 0,
        0, 0, 0, 1
    ]);
    return rotation;
}

export class TileManager {
    private app: AppBase;

    private camera: Entity;

    private options: Required<Pick<TileManagerOptions, 'errorTarget' | 'maxConcurrent' | 'maxCachedTiles'>>;

    /** Явный потолок кэша в байтах; `null` — считать от вьюпорта. */
    private readonly maxCachedBytes: number | null;

    /** Во сколько раз порог экранной ошибки сейчас загрублен под нехватку памяти. */
    private errorTargetScale = 1;

    private onChange: (transformChanged?: boolean) => void;

    private onWarning: (message: string) => void;

    /** Корень тайлсета в сцене: несёт поворот осей и рецентровку. */
    readonly root: Entity;

    /** Корневой тайл. */
    private rootTile: Tile | null = null;

    /** Адрес tileset.json — база для шаблонов URI неявного дерева. */
    private baseUrl = '';

    private queue: TileRequestQueue;

    private frustum = new Frustum();

    /**
     * Заморозка отбора: пока `true`, фрустум и параметры камеры в `update` не
     * пересчитываются — LOD и выбор тайлов считаются от камеры на момент заморозки, а живую
     * можно свободно двигать и смотреть, что выбрала «первая» (Фаза 2 отладки).
     */
    private frozen = false;

    /**
     * Отладочная изоляция уровня LOD: если не `null`, показываются тайлы только этой глубины.
     * Обход уточняется по экранной ошибке, но не глубже неё, — далёкие фрагменты, до которых
     * SSE не дотягивает, не грузятся, а видны только достигнутые тайлы уровня.
     */
    private lodIsolate: number | null = null;

    /** Production clipping volume in world → unit-box local coordinates. */
    private clipBoxWorldToLocal: Mat4 | null = null;

    /** false: keep inside the box; true: keep outside it. */
    private clipBoxInvert = false;

    private readonly clipBoxCorner = new Vec3();

    private frame = 0;

    /** Матрица «система тайлсета → мир». */
    private tilesetToWorld = new Mat4();

    /** Мировая матрица родителя на момент последнего пересчёта габаритов. */
    private parentWorld = new Mat4();

    /** Тайлы с загруженным контентом — кандидаты на вытеснение. */
    private loaded = new Set<Tile>();

    /** Выбранные в прошлом кадре — чтобы понять, изменилась ли картинка. */
    private prevSelection: Tile[] = [];

    /** Обратная карта для точного клика по поверхности контента. */
    private meshToTile = new WeakMap<MeshInstance, Tile>();

    /** Тайл, выбранный кликом в режиме инспектора. */
    private debugPickedTile: Tile | null = null;

    /** Показывать только контент выбранного кликом тайла. */
    private debugIsolatePicked = false;

    /** Параметры камеры текущего кадра — обход читает их, а не таскает пятым аргументом. */
    private view = { cameraPos: new Vec3(), sseDenominator: 1, viewportHeight: 1 };

    /** Высота картинки без учёта понижения на время движения; задаётся вьюером. */
    stableRenderHeight = 0;

    /**
     * Сколько тайлов уже доехало за жизнь этого набора.
     *
     * Номер присваивается в момент готовности содержимого и больше не меняется: отладка
     * показывает историю загрузки, а не текущую очередь. Историю можно спокойно рассматривать,
     * остановив камеру, — очередь же перескакивала бы при каждом её движении.
     */
    private loadCounter = 0;

    /**
     * Направление, вокруг которого тайлы считаются центральными; задаётся вьюером.
     *
     * `null` — приоритет как раньше, без учёта экранного положения. Иначе это единичный вектор:
     * взгляд камеры (фовеальный режим) или луч через указатель (курсорный). Вьюер знает и о
     * настройке, и об указателе, поэтому решение принимает он, а обход только меряет угол.
     */
    focusDirection: Vec3 | null = null;

    private disposed = false;

    private stats: TileStats = {
        tiles: 0,
        ready: 0,
        loading: 0,
        queued: 0,
        failed: 0,
        selected: 0,
        bytes: 0,
        bytesBudget: 0,
        errorTarget: 0,
        errorTargetScale: 1,
        maxSelectedDepth: 0,
        depthCounts: []
    };

    /** Габариты всего тайлсета в мировых координатах — стабильные, не зависят от LOD. */
    readonly bounds = new BoundingBox();

    /**
     * «Плотные» габариты корня из метаданных, если тайлсет их сообщает.
     *
     * Кадрировать камеру по кубическому `boundingVolume` неявного дерева — значит увести
     * её в разы дальше самой модели: у храма из ion куб 115 × 95 × 119 м на постройку
     * вдвое меньше.
     */
    private tightRootBox: number[] | null = null;

    constructor(options: TileManagerOptions) {
        this.app = options.app;
        this.camera = options.camera;
        this.onChange = options.onChange;
        this.onWarning = options.onWarning ?? (() => {});
        this.options = {
            errorTarget: options.errorTarget ?? 16,
            maxConcurrent: options.maxConcurrent ?? 6,
            maxCachedTiles: options.maxCachedTiles ?? 128
        };
        this.maxCachedBytes = options.maxCachedBytes ?? null;

        this.root = new Entity('tilesRoot', this.app);
        options.parent.addChild(this.root);

        this.queue = new TileRequestQueue(this.options.maxConcurrent);
    }

    /**
     * Загрузить тайлсет и построить дерево.
     *
     * @param url - Адрес tileset.json.
     */
    async load(url: string) {
        const json = await fetchTilesetJson(url);
        if (this.disposed) {
            return;
        }

        const warnings: string[] = [];

        // Рецентровка считается по корневому тайлу ДО построения дерева: она входит в
        // матрицу «тайлсет → мир», по которой считаются габариты всех тайлов.
        this.setupRootTransform(json.root.transform, json.root.boundingVolume?.box, json.root.boundingVolume?.sphere);
        this.updateTilesetToWorld();

        this.baseUrl = url;
        this.rootTile = buildTileTree(json.root, {
            baseUrl: url,
            tilesetToWorld: this.tilesetToWorld,
            warnings
        });

        // Неявное дерево: тайлов в JSON нет, они разворачиваются из масок `.subtree`.
        // Корневое поддерево грузится сразу — без него на экране не будет вообще ничего.
        const implicit = readImplicitTiling(json.root, url, this.rootTile.refine);
        if (implicit) {
            this.rootTile.implicit = {
                info: implicit,
                coord: { level: 0, x: 0, y: 0, z: 0 },
                expanded: false,
                pending: false
            };
            // Шаблон контента корня — это шаблон, а не готовый URI: до масок неизвестно,
            // есть ли у корневого тайла контент вообще.
            this.rootTile.contentUris = [];
            await this.expandImplicit(this.rootTile);
        }

        this.tightRootBox = findTightBoundingBox(json, json.root);

        // Корневой геометрической ошибкой тайлсета (`json.geometricError`) считается ошибка
        // «ничего не загружено»; на выбор LOD внутри дерева она не влияет, поэтому её
        // достаточно запомнить для отладки.
        this.computeBounds();

        [...new Set(warnings)].forEach(w => this.onWarning(w));
        this.onChange();
    }

    /**
     * Поставить корневой entity поворот осей и сдвиг к началу координат.
     *
     * Итоговая матрица — `Rx(-90) * (ECEF → ENU) * T(-центр)`:
     *
     * 1. сдвиг ставит тайлсет в начало координат (иначе ECEF-координаты порядка 6.4e6 не
     *    переживут float32 в матрицах и вершинах);
     * 2. поворот ECEF → ENU ставит **локальную** вертикаль вверх. Без него «верхом» сцены
     *    становится земная ось, и модель оказывается завалена на угол, равный дополнению
     *    широты: у храма это 28°, и по наклонённому рельефу потом режет плоскость
     *    shadow catcher'а;
     * 3. `Rx(-90)` переводит Z-вверх (система тайлсета) в Y-вверх (система вьюера).
     *
     * У негеографических тайлсетов (координаты маленькие) шаг 2 пропускается.
     *
     * @param rootTransform - `transform` корневого тайла (16 чисел) или undefined.
     * @param box - `boundingVolume.box` корневого тайла.
     * @param sphere - `boundingVolume.sphere` корневого тайла.
     */
    private setupRootTransform(rootTransform: number[] | undefined, box?: number[], sphere?: number[]) {
        const transform = new Mat4();
        if (rootTransform?.length === 16) {
            transform.set(rootTransform);
        }

        // Центр тайлсета в его собственной системе.
        const center = new Vec3();
        if (box && box.length >= 12) {
            center.set(box[0], box[1], box[2]);
        } else if (sphere && sphere.length >= 4) {
            center.set(sphere[0], sphere[1], sphere[2]);
        }
        transform.transformPoint(center, center);

        const matrix = new Mat4().mul2(
            new Mat4().setFromAxisAngle(Vec3.RIGHT, UP_AXIS_ROTATION),
            ecefToEnuRotation(center)
        );
        matrix.mul2(matrix, new Mat4().setTranslate(-center.x, -center.y, -center.z));
        setLocalFromMat4(this.root, matrix);
    }

    /** Пересчитать матрицу «тайлсет → мир» из текущих трансформаций сцены. */
    private updateTilesetToWorld() {
        this.tilesetToWorld.copy(this.root.getWorldTransform());
    }

    /**
     * Синхронизировать мировые bounding volumes с текущей иерархией сцены.
     *
     * @returns `true`, если трансформ тайлсета изменился.
     */
    syncTransform(): boolean {
        if (!this.rootTile || this.disposed) {
            return false;
        }
        const rootWorld = this.root.getWorldTransform();
        if (matricesEqual(rootWorld, this.parentWorld)) {
            return false;
        }
        this.parentWorld.copy(rootWorld);
        this.updateTilesetToWorld();
        recomputeWorldVolumes(this.rootTile, this.tilesetToWorld);
        this.computeBounds();
        this.onChange(true);
        return true;
    }

    /** Габариты тайлсета по корневому тайлу — стабильны и не зависят от загруженного. */
    private computeBounds() {
        if (!this.rootTile?.obb) {
            this.bounds.center.set(0, 0, 0);
            this.bounds.halfExtents.set(1, 1, 1);
            return;
        }
        // Для кадрирования предпочитаем «плотные» габариты, если тайлсет их сообщил;
        // на выбор уровня детализации и отсечение это не влияет — там свой объём тайла.
        const worldMatrix = tmpMat.mul2(this.tilesetToWorld, this.rootTile.transform);
        const tight = this.tightRootBox && makeWorldObb({ box: this.tightRootBox }, worldMatrix);
        const obb = tight ?? this.rootTile.obb;
        // Осеориентированная оболочка OBB: полуразмер по каждой оси — сумма модулей
        // проекций полуосей.
        const he = new Vec3();
        obb.halfAxes.forEach((axis) => {
            he.x += Math.abs(axis.x);
            he.y += Math.abs(axis.y);
            he.z += Math.abs(axis.z);
        });
        this.bounds.center.copy(obb.center);
        this.bounds.halfExtents.copy(he);
    }

    /**
     * Кадровое обновление: обход дерева, выбор тайлов, заявки на загрузку, вытеснение.
     *
     * Вызывается вьюером каждый кадр (в том числе когда рендера не будет — обход дешёвый,
     * а решение «нужен ли кадр» принимается по изменению набора видимых тайлов).
     */
    update() {
        if (!this.rootTile || this.disposed) {
            return;
        }

        // Сцену можно двигать гизмо — тогда мировые габариты и ошибка устаревают.
        this.syncTransform();

        const cameraComponent = this.camera.camera;
        if (!cameraComponent) {
            return;
        }

        this.frame++;
        this.queue.setFrame(this.frame);

        // На заморозке держим фрустум и параметры камеры с момента заморозки: обход считает
        // ошибку и отбор от «первой» камеры, а живую можно свободно двигать.
        if (!this.frozen) {
            tmpMat.mul2(cameraComponent.projectionMatrix, cameraComponent.viewMatrix);
            this.frustum.setFromMat4(tmpMat);

            this.view.cameraPos.copy(this.camera.getPosition());
            this.view.viewportHeight = this.renderHeight();
            this.view.sseDenominator = 2 * Math.tan(0.5 * verticalFovRadians(cameraComponent));
        }

        // Память меряется до обхода: обход обязан идти уже с поправленным порогом, иначе
        // он успеет заказать то, что бюджет не переживёт. Обратная связь на кадр отстаёт —
        // это и нужно, мгновенная реакция дала бы колебания.
        const cachedBytes = this.cachedBytes();
        const byteBudget = this.cacheByteBudget();
        this.updateErrorTargetScale(cachedBytes, byteBudget);

        const selection: Tile[] = [];
        this.visit(this.rootTile, selection);

        this.applySelection(selection);
        this.evictStale(cachedBytes, byteBudget);
        this.queue.dispatch();
        this.updateStats(selection, byteBudget);
    }

    /**
     * Обойти тайл: посчитать метрики, заказать контент, выбрать что показывать.
     *
     * @param tile - Тайл.
     * @param selection - Куда складывать выбранные для отрисовки тайлы.
     * @returns `true`, если поддерево закрывает свою область (нечего показывать поверх).
     */
    private visit(tile: Tile, selection: Tile[]): boolean {
        // Exact pixels are clipped in the material shader. This conservative tree test
        // only avoids requesting branches that are definitely outside the kept volume.
        if (!this.intersectsClipBox(tile)) {
            return true;
        }
        // Тайл без поддержанных габаритов (`region`) считаем видимым и бесконечно грубым:
        // лучше показать лишнее, чем потерять геометрию.
        tile.inFrustum = !tile.obb || this.frustum.containsSphere(tile.obb.sphere) !== 0;
        if (!tile.inFrustum) {
            return true;
        }

        if (tile.externalTilesetUri && !tile.externalRoot && tile.state === TILE_UNLOADED) {
            this.requestExternalTileset(tile);
        }

        // Маски неявного узла грузятся по факту того, что обход до него дошёл, — а не по
        // его экранной ошибке. До масок про узел не известно вообще ничего: ни есть ли у
        // него контент, ни есть ли дети. При этом лишнего не качается: сюда попадают
        // только узлы, в которые родитель решил углубиться.
        if (tile.implicit && !tile.implicit.expanded) {
            this.expandImplicit(tile);
        }

        this.requestContent(tile);

        const children = tile.externalRoot ? [tile.externalRoot] : tile.children;
        // A JSON leaf with renderable content is the final available LOD even when the exporter
        // left a non-zero geometricError on it (the Syria set does this for every depth-5 leaf).
        // External and unexpanded implicit nodes are not leaves yet: their children are pending.
        const terminal = children.length === 0 && !tile.externalTilesetUri &&
            (!tile.implicit || tile.implicit.expanded);

        tile.lastUsedFrame = this.frame;
        tile.distance = tile.obb ? distanceToObb(tile.obb, this.view.cameraPos) : 0;
        tile.central = this.isCentral(tile);
        tile.error = terminal ? 0 : (tile.obb ?
            screenSpaceError(tile.geometricError, tile.distance, this.view.sseDenominator, this.view.viewportHeight) :
            Infinity);

        if (terminal) {
            tile.wasRefined = false;
            return this.selectSelf(tile, selection);
        }

        // Гистерезис: чтобы на границе порога уровень не мигал туда-сюда каждый кадр,
        // начинать уточнение дороже, чем его продолжать.
        const threshold = this.errorTarget() * (tile.wasRefined ? 1 - HYSTERESIS : 1 + HYSTERESIS);
        const needsDetail = tile.error > threshold;

        // Уточняем по экранной ошибке (near/крупные — раньше), но при изоляции не глубже
        // выбранного уровня. Так на больших сценах далёкие/мелкие фрагменты не грузятся
        // (SSE их не требует), а показываются только те тайлы уровня D, до которых обход
        // реально дошёл — то есть видимые вблизи фрагменты, а не весь уровень целиком.
        const refine = children.length > 0 && needsDetail &&
            (this.lodIsolate === null || tile.depth < this.lodIsolate);
        tile.wasRefined = refine;

        if (!refine) {
            return this.selectSelf(tile, selection);
        }

        if (tile.refine === 'ADD') {
            // ADD: родитель остаётся на экране, дети добавляются поверх.
            const selfCovered = this.selectSelf(tile, selection);
            children.forEach(child => this.visit(child, selection));
            return selfCovered;
        }

        // REPLACE: детей показываем только все разом. Иначе на месте недогруженного
        // ребёнка появится дыра — а родитель ещё на экране и закрывает её целиком.
        const sub: Tile[] = [];
        let covered = true;
        for (const child of children) {
            covered = this.visit(child, sub) && covered;
        }
        if (covered && sub.length > 0) {
            selection.push(...sub);
            return true;
        }
        // If refinement produced no visible/renderable child, keep the deepest ready ancestor.
        // Sparse trees and imperfect child bounds otherwise make a detailed tile disappear as
        // the camera approaches even though no finer content exists for the current view.
        if (tile.contentUris.length > 0 && this.selectSelf(tile, selection)) {
            return true;
        }
        if (covered) {
            return true;
        }
        // У тайлсетов с пустым корнем (Obj2Tiles умеет так — `--no-root-content`) закрывать
        // нечем, и ждать готовности всех детей значило бы держать пустой экран вместо
        // постепенного проявления сцены.
        // Ни дети, ни родитель не готовы — показываем то, что есть.
        selection.push(...sub);
        return false;
    }

    /**
     * Conservative OBB-vs-oriented-box test. Tile corners are transformed into the
     * clipping box's unit space. Their AABB can overestimate an intersection but can
     * never reject visible geometry, which is the safe choice for streaming.
     *
     * @param tile - Tile whose world OBB is tested.
     * @returns Whether the tile can contain geometry kept by the clipping mode.
     */
    private intersectsClipBox(tile: Tile): boolean {
        const matrix = this.clipBoxWorldToLocal;
        const obb = tile.obb;
        if (!matrix || !obb) return true;

        let minX = Infinity;
        let minY = Infinity;
        let minZ = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        let maxZ = -Infinity;
        for (let x = -1; x <= 1; x += 2) {
            for (let y = -1; y <= 1; y += 2) {
                for (let z = -1; z <= 1; z += 2) {
                    const corner = this.clipBoxCorner.copy(obb.center)
                    .addScaled(obb.halfAxes[0], x)
                    .addScaled(obb.halfAxes[1], y)
                    .addScaled(obb.halfAxes[2], z);
                    matrix.transformPoint(corner, corner);
                    minX = Math.min(minX, corner.x);
                    minY = Math.min(minY, corner.y);
                    minZ = Math.min(minZ, corner.z);
                    maxX = Math.max(maxX, corner.x);
                    maxY = Math.max(maxY, corner.y);
                    maxZ = Math.max(maxZ, corner.z);
                }
            }
        }

        if (this.clipBoxInvert) {
            // In outside mode only reject tiles proven fully contained by the box.
            return !(minX >= -0.5 && maxX <= 0.5 && minY >= -0.5 && maxY <= 0.5 && minZ >= -0.5 && maxZ <= 0.5);
        }
        return !(maxX < -0.5 || minX > 0.5 || maxY < -0.5 || minY > 0.5 || maxZ < -0.5 || minZ > 0.5);
    }

    /**
     * Попробовать выбрать контент самого тайла.
     *
     * @param tile - Тайл.
     * @param selection - Список выбранных для отрисовки.
     * @returns `true`, если тайл нечего ждать: контент готов, его нет вовсе или он упал.
     */
    private selectSelf(tile: Tile, selection: Tile[]): boolean {
        // Изоляция уровня: тайлы не своей глубины не выбираем и не считаем «закрывающими»
        // (false), чтобы уже готовые тайлы целевого уровня из `sub` не отбрасывались.
        if (this.lodIsolate !== null && tile.depth !== this.lodIsolate) {
            return false;
        }
        // Неявный узел без загруженных масок — это «пока не знаю»: считать его пустым и
        // закрывающим нельзя, иначе родитель снимет свой контент и на его месте до
        // прихода масок будет дыра.
        if (tile.implicit && !tile.implicit.expanded) {
            return false;
        }
        if (tile.contentUris.length === 0) {
            return true;
        }
        if (tile.state === TILE_READY) {
            selection.push(tile);
            return true;
        }
        // Упавший контент не ждём вечно — иначе родитель навсегда останется на экране.
        return tile.state === TILE_FAILED;
    }

    /**
     * Поставить контент тайла в очередь загрузки.
     *
     * @param tile - Тайл.
     */
    private requestContent(tile: Tile) {
        if (tile.contentUris.length === 0 || tile.state !== TILE_UNLOADED) {
            return;
        }

        tile.state = TILE_QUEUED;
        const token = { cancelled: false, controller: new AbortController() };
        tile.loadToken = token;

        this.queue.push({
            tile,
            run: async () => {
                if (token.cancelled) {
                    tile.state = TILE_UNLOADED;
                    return;
                }
                tile.state = TILE_LOADING;
                try {
                    const content = await loadTileContent(this.app, tile.contentUris, token);
                    this.attachContent(tile, content);
                } catch (err) {
                    // Отменённая загрузка — не ошибка: тайл просто снова «не загружен» и
                    // будет заказан заново, если понадобится.
                    tile.state = token.cancelled ? TILE_UNLOADED : TILE_FAILED;
                    if (!token.cancelled) {
                        console.warn(`Тайл не загрузился: ${tile.contentUris.join(', ')}`, err);
                    }
                }
            }
        });
    }

    /**
     * Привязать загруженный контент к сцене.
     *
     * Вынесено из асинхронной функции намеренно: все поля тайла меняются здесь, в одном
     * синхронном блоке, и между проверкой «контент ещё нужен» и его установкой ничего
     * произойти не может.
     *
     * @param tile - Тайл.
     * @param content - Результат загрузки или `null`, если её отменили.
     */
    private attachContent(tile: Tile, content: TileContentResult | null) {
        if (!content || this.disposed) {
            tile.state = TILE_UNLOADED;
            return;
        }

        tile.entity = content.entity;
        tile.assets = content.assets;
        tile.bytes = content.bytes;

        // Трансформация тайла задана в системе тайлсета (Z-вверх), а контент под ней —
        // glTF (Y-вверх), отсюда поправка справа.
        tmpMat.mul2(tile.transform, gltfUpAxisTransform());
        setLocalFromMat4(tile.entity, tmpMat);
        tile.entity.enabled = false;
        this.root.addChild(tile.entity);

        this.getTileMeshInstances(tile).forEach(meshInstance => this.meshToTile.set(meshInstance, tile));

        tile.state = TILE_READY;
        tile.loadSequence = ++this.loadCounter;
        this.loaded.add(tile);
        this.onChange();
    }

    /**
     * Развернуть неявное поддерево тайла: загрузить маски и создать по ним детей.
     *
     * Ленивость здесь принципиальна: у тайлсета из Cesium ion 185 файлов масок на 552
     * тайла, и грузить их разом значило бы 185 запросов до первой картинки.
     *
     * @param tile - Тайл, за которым стоит неявное поддерево.
     */
    private async expandImplicit(tile: Tile) {
        const implicit = tile.implicit;
        if (!implicit || implicit.expanded || implicit.pending) {
            return;
        }
        implicit.pending = true;

        try {
            const subtree = await loadSubtreeAt(implicit.info, implicit.coord);
            if (this.disposed || this.rootTile === null) {
                return;
            }

            const warnings: string[] = [];
            const deferred = expandSubtree(tile, implicit.coord, subtree, implicit.info, {
                tilesetToWorld: this.tilesetToWorld,
                parentTransform: tile.transform,
                baseUrl: this.baseUrl,
                warnings
            });

            // Заглушки на границе поддерева: их маски загрузятся, когда обход дойдёт.
            deferred.forEach(({ tile: child, coord }) => {
                child.implicit = { info: implicit.info, coord, expanded: false, pending: false };
            });

            implicit.expanded = true;
            [...new Set(warnings)].forEach(w => this.onWarning(w));
            this.onChange();
        } catch (err) {
            console.warn('Не удалось развернуть неявное поддерево', implicit.coord, err);
            // Больше не пробуем: иначе обход будет долбить один и тот же битый файл.
            this.finishImplicit(implicit, true);
            return;
        }
        this.finishImplicit(implicit, false);
    }

    /**
     * Снять пометку «маски грузятся» одним синхронным шагом.
     *
     * Вынесено из асинхронного метода намеренно — те же соображения, что и у
     * `attachContent`: между проверкой и записью полей не должно быть точки ожидания.
     *
     * @param implicit - Состояние неявного узла.
     * @param failed - Помечать ли узел развёрнутым из-за ошибки.
     */
    private finishImplicit(implicit: NonNullable<Tile['implicit']>, failed: boolean) {
        implicit.pending = false;
        if (failed) {
            implicit.expanded = true;
        }
    }

    /**
     * Подгрузить внешний тайлсет и подставить его корень вместо детей тайла.
     *
     * @param tile - Тайл, у которого контент — `tileset.json`.
     */
    private requestExternalTileset(tile: Tile) {
        const uri = tile.externalTilesetUri;
        tile.state = TILE_LOADING;
        fetchTilesetJson(uri)
        .then((json) => {
            if (this.disposed) {
                return;
            }
            const warnings: string[] = [];
            tile.externalRoot = buildTileTree(json.root, {
                baseUrl: uri,
                parentTransform: tile.transform,
                tilesetToWorld: this.tilesetToWorld,
                parent: tile,
                warnings
            });
            tile.state = TILE_READY;
            tile.loadSequence = ++this.loadCounter;
            [...new Set(warnings)].forEach(w => this.onWarning(w));
            this.onChange();
        })
        .catch((err) => {
            tile.state = TILE_FAILED;
            console.warn(`Внешний тайлсет не загрузился: ${uri}`, err);
        });
    }

    /**
     * Показать выбранные тайлы, спрятать остальные.
     *
     * Кадр запрашивается только если набор изменился: при `autoRender === false` лишний
     * `renderNextFrame` — это лишний кадр каждые 16 мс на неподвижной сцене.
     *
     * @param selection - Тайлы, выбранные обходом этого кадра.
     */
    private applySelection(selection: Tile[]) {
        const changed = selection.length !== this.prevSelection.length ||
            selection.some((tile, i) => this.prevSelection[i] !== tile);

        if (!changed) return;

        this.prevSelection.forEach((tile) => {
            tile.selected = false;
        });

        selection.forEach((tile) => {
            tile.selected = true;
        });

        this.prevSelection = selection.slice();
        this.applyDebugVisibility();
        this.onChange();
    }

    /** Применить обычный LOD-срез либо оставить только выбранный кликом тайл. */
    private applyDebugVisibility() {
        const isolated = this.debugIsolatePicked ? this.debugPickedTile : null;
        this.loaded.forEach((tile) => {
            if (tile.entity) {
                tile.entity.enabled = isolated ? tile === isolated : tile.selected;
            }
        });
    }

    /**
     * Высота картинки в пикселях — та, в которой сцена рисуется на самом деле.
     *
     * Это не размер бэкбуфера: при `camera.pixelScale > 1` сцена рисуется в цель поменьше, а
     * до экрана её растягивает финальный проход. Экранная ошибка обязана считаться от той
     * картинки, которая реально рисуется, иначе уменьшение разрешения не облегчит отбор.
     *
     * Временное понижение на время движения камеры сюда не входит: от него высота меняется
     * дважды за жест, и отбор успевал бы сбросить уровень детализации и заказать его обратно —
     * это видно как моргание. Поэтому вьюер сообщает устойчивую высоту, а к цели рендера мы
     * обращаемся только пока он молчит.
     *
     * @returns Высота картинки в пикселях, минимум 1.
     */
    /**
     * Попадает ли тайл в конус вокруг точки внимания.
     *
     * Конус берём вполовину от вертикального полуугла камеры: достаточно узкий, чтобы «центр»
     * что-то значил, и достаточно широкий, чтобы под него попадало не одно ядро кадра.
     *
     * @param tile - Тайл.
     * @returns `true`, если тайл центральный либо режим приоритета выключен.
     */
    private isCentral(tile: Tile): boolean {
        const dir = this.focusDirection;
        if (!dir || !tile.obb) return true;

        tmpVecCentral.sub2(tile.obb.center, this.view.cameraPos);
        const length = tmpVecCentral.length();
        // Камера внутри габаритов — тайл вокруг нас, направление бессмысленно.
        if (length <= 1e-6) return true;
        tmpVecCentral.mulScalar(1 / length);

        // `sseDenominator` это 2*tan(fovY/2), отсюда и полуугол.
        const halfFov = Math.atan(0.5 * this.view.sseDenominator);
        return tmpVecCentral.dot(dir) >= Math.cos(halfFov * CENTRAL_CONE_FRACTION);
    }

    private renderHeight(): number {
        if (this.stableRenderHeight) return Math.max(1, this.stableRenderHeight);
        const target = this.camera.camera?.renderTarget;
        return Math.max(1, target?.height ?? this.app.graphicsDevice.height);
    }

    /**
     * Порог экранной ошибки, действующий сейчас.
     *
     * @returns Порог в пикселях: базовый, загрублённый под нехватку памяти.
     */
    private errorTarget(): number {
        return this.options.errorTarget * this.errorTargetScale;
    }

    /**
     * Сколько байт контента сейчас в памяти.
     *
     * @returns Сумма по загруженным тайлам.
     */
    private cachedBytes(): number {
        let bytes = 0;
        this.loaded.forEach((tile) => {
            bytes += tile.bytes;
        });
        return bytes;
    }

    /**
     * Подтянуть порог экранной ошибки под текущее давление на память.
     *
     * Вверх — пока кэш не влезает в бюджет; вниз — только когда он опустился заметно ниже
     * (см. `MEMORY_RELEASE_FRACTION`), и вчетверо медленнее. Оба хода мелкими шагами:
     * порог виден на экране как уровень детализации.
     *
     * Полностью колебания это не убирает и убрать не может: тайл неделим, поэтому бюджет
     * меньше одного тайла не выполним в принципе, и система будет медленно ходить между
     * двумя уровнями. На осмысленных бюджетах (много тайлов) она сходится.
     *
     * @param cachedBytes - Сколько байт сейчас в памяти.
     * @param byteBudget - Текущий потолок.
     */
    private updateErrorTargetScale(cachedBytes: number, byteBudget: number) {
        if (cachedBytes > byteBudget) {
            this.errorTargetScale = Math.min(
                MEMORY_ERROR_SCALE_MAX,
                this.errorTargetScale * (1 + MEMORY_ERROR_SCALE_STEP)
            );
        } else if (cachedBytes < byteBudget * MEMORY_RELEASE_FRACTION) {
            this.errorTargetScale = Math.max(
                1,
                this.errorTargetScale / (1 + MEMORY_ERROR_RELAX_STEP)
            );
        }
    }

    /**
     * Потолок кэша в байтах контента.
     *
     * Считается на каждом вызове, а не запоминается: и размер окна, и `camera.pixelScale`
     * меняются на ходу, а вместе с ними меняется и то, сколько тайлов отбирается по
     * экранной ошибке.
     *
     * @returns Бюджет в байтах.
     */
    private cacheByteBudget(): number {
        if (this.maxCachedBytes !== null) {
            return this.maxCachedBytes;
        }

        const target = this.camera.camera?.renderTarget;
        const device = this.app.graphicsDevice;
        const pixels = Math.max(1, (target?.width ?? device.width) * (target?.height ?? device.height));
        const budget = Math.min(
            CACHE_BYTES_MAX,
            Math.max(CACHE_BYTES_MIN, pixels * CACHE_BYTES_PER_PIXEL)
        );

        // `deviceMemory` отдаёт только Chromium; где его нет, остаётся общий потолок.
        const memoryGb = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
        const lowMemory = typeof memoryGb === 'number' && memoryGb <= CACHE_LOW_MEMORY_GB;
        const scaled = lowMemory ? budget / 2 : budget;

        // Грубый указатель + тач — это телефон или планшет. Проверяются оба признака: у
        // сенсорного ноутбука тачскрин есть, но основной указатель всё равно мышь, и
        // резать ему кэш не за что.
        const coarsePointer = typeof matchMedia === 'function' &&
            matchMedia('(pointer: coarse)').matches &&
            navigator.maxTouchPoints > 0;

        return coarsePointer ? Math.min(scaled, CACHE_BYTES_MOBILE_MAX) : scaled;
    }

    /**
     * Вытеснить лишнее из памяти.
     *
     * Потолка два: по числу тайлов — он держит в узде количество entity и драв-коллов, и по
     * байтам контента — он держит память. Одного числа тайлов мало: 128 тайлов по 10 МБ и
     * 128 по 200 КБ отличаются на три порядка. Превышение любого запускает вытеснение.
     *
     * Порядок вытеснения — та же лестница приоритетов, что и у загрузки, только с конца:
     * первым уходит то, что грузилось бы последним. Видимый сейчас тайл не выгружается
     * никогда — а значит, когда в бюджет не влезает уже сам видимый набор, вытеснение
     * бессильно и память разгружает загрубление порога (`updateErrorTargetScale`).
     *
     * @param cachedBytes - Сколько байт сейчас в памяти.
     * @param byteBudget - Текущий потолок кэша.
     */
    private evictStale(cachedBytes: number, byteBudget: number) {
        let excessTiles = this.loaded.size - this.options.maxCachedTiles;
        let excessBytes = cachedBytes - byteBudget;
        if (excessTiles <= 0 && excessBytes <= 0) {
            return;
        }

        const candidates = [...this.loaded].filter(tile => tile !== this.debugPickedTile &&
            !tile.selected && tile.lastUsedFrame !== this.frame);
        candidates.sort((a, b) => compareTilePriority(b, a, this.frame));

        for (const tile of candidates) {
            if (excessTiles <= 0 && excessBytes <= 0) {
                break;
            }
            // `unloadTile` обнуляет `tile.bytes`, поэтому размер снимается до выгрузки.
            const bytes = tile.bytes;
            this.unloadTile(tile);
            excessTiles--;
            excessBytes -= bytes;
        }
    }

    private unloadTile(tile: Tile) {
        if (tile.loadToken) {
            tile.loadToken.cancelled = true;
            tile.loadToken.controller?.abort();
            tile.loadToken = null;
        }
        this.getTileMeshInstances(tile).forEach(meshInstance => this.meshToTile.delete(meshInstance));
        if (this.debugPickedTile === tile) {
            this.debugPickedTile = null;
        }
        destroyTileContent(this.app, tile.entity, tile.assets as never[]);
        tile.entity = null;
        tile.assets = [];
        tile.bytes = 0;
        tile.state = TILE_UNLOADED;
        tile.selected = false;
        this.loaded.delete(tile);
    }

    private updateStats(selection: Tile[], byteBudget: number) {
        const stats: TileStats = {
            tiles: 0,
            ready: 0,
            loading: 0,
            queued: 0,
            failed: 0,
            selected: selection.length,
            bytes: 0,
            bytesBudget: byteBudget,
            errorTarget: this.errorTarget(),
            errorTargetScale: this.errorTargetScale,
            maxSelectedDepth: 0,
            depthCounts: []
        };

        if (this.rootTile) {
            forEachTile(this.rootTile, (tile) => {
                stats.tiles++;
                stats.bytes += tile.bytes;
                if (tile.state === TILE_READY) stats.ready++;
                else if (tile.state === TILE_LOADING) stats.loading++;
                else if (tile.state === TILE_QUEUED) stats.queued++;
                else if (tile.state === TILE_FAILED) stats.failed++;
            });
        }
        selection.forEach((tile) => {
            stats.maxSelectedDepth = Math.max(stats.maxSelectedDepth, tile.depth);
            stats.depthCounts[tile.depth] = (stats.depthCounts[tile.depth] ?? 0) + 1;
        });

        this.stats = stats;
    }

    /**
     * Мешы видимых сейчас тайлов.
     *
     * Нужны инструментам вьюера (выделение, измерения, точки интереса): они работают по
     * списку `MeshInstance`, а не по графу сцены, и статический список, собранный при
     * загрузке модели, для тайлов не подходит — набор видимого меняется каждый кадр.
     *
     * @returns Меши выбранных обходом тайлов.
     */
    getVisibleMeshInstances(): MeshInstance[] {
        const result: MeshInstance[] = [];
        const visibleTiles = this.debugIsolatePicked && this.debugPickedTile ?
            [this.debugPickedTile] : this.prevSelection;
        visibleTiles.forEach((tile) => {
            if (!tile.entity?.enabled) {
                return;
            }
            result.push(...this.getTileMeshInstances(tile));
        });
        return result;
    }

    /**
     * Пройти по видимым сейчас тайлам вместе с их глубиной в дереве.
     *
     * Нужно раскраске блоков по LOD: цвет выбирается по глубине, а меши приходится брать
     * заново каждый кадр — набор видимого меняется при стриминге.
     *
     * @param callback - Вызывается для каждого видимого тайла: глубина и его меши.
     */
    forEachVisibleTile(callback: (depth: number, meshInstances: MeshInstance[]) => void) {
        const visibleTiles = this.debugIsolatePicked && this.debugPickedTile ?
            [this.debugPickedTile] : this.prevSelection;
        visibleTiles.forEach((tile) => {
            if (!tile.entity?.enabled) {
                return;
            }
            callback(tile.depth, this.getTileMeshInstances(tile));
        });
    }

    /**
     * Габариты реально загруженной геометрии, а не служебных tile bounding volumes.
     *
     * Кэшированные LOD могут дублировать одни и те же участки, но объединённый
     * AABB от этого не меняется. Эти габариты нужны для object pivot; для LOD по-прежнему
     * используются объёмы из tileset.json.
     *
     * @param result - BoundingBox, в который записать результат.
     * @returns `true`, если найден хотя бы один меш.
     */
    /**
     * Меши всей реально загруженной геометрии (по всем `loaded` тайлам, а не только
     * попавшим в кадр). Нужны для подгонки бокса по контуру модели.
     *
     * @returns Плоский список mesh instances загруженного контента.
     */
    getLoadedMeshInstances(): MeshInstance[] {
        const result: MeshInstance[] = [];
        this.loaded.forEach((tile) => {
            result.push(...this.getTileMeshInstances(tile));
        });
        return result;
    }

    getGeometryBounds(result: BoundingBox): boolean {
        let first = true;
        this.loaded.forEach((tile) => {
            this.getTileMeshInstances(tile).forEach((meshInstance) => {
                if (first) {
                    result.copy(meshInstance.aabb);
                    first = false;
                } else {
                    result.add(meshInstance.aabb);
                }
            });
        });
        return !first;
    }

    /**
     * Все меши контента одного тайла.
     *
     * @param tile - Тайл, меши которого нужны.
     * @returns Меши всех render-компонентов контента.
     */
    private getTileMeshInstances(tile: Tile): MeshInstance[] {
        if (!tile.entity) {
            return [];
        }
        return (tile.entity.findComponents('render') as RenderComponent[])
        .flatMap(component => component.meshInstances);
    }

    /**
     * Выбрать тайл по мешу, найденному raycast'ом; `null` очищает выбор.
     *
     * @param meshInstance - Меш выбранной поверхности или `null`.
     * @returns Данные выбранного тайла или `null`.
     */
    setDebugPickedMeshInstance(meshInstance: MeshInstance | null): TileDebugInfo | null {
        this.debugPickedTile = meshInstance ? (this.meshToTile.get(meshInstance) ?? null) : null;
        this.applyDebugVisibility();
        return this.getDebugPickedTileInfo();
    }

    /**
     * Изолировать выбранный кликом тайл. До первого выбора сохраняется обычный LOD-срез.
     *
     * @param value - Включить изоляцию.
     */
    setDebugIsolatePicked(value: boolean) {
        this.debugIsolatePicked = value;
        this.applyDebugVisibility();
        this.onChange();
    }

    /**
     * Set the production clipping box used to prune definitely invisible branches.
     * Pixel-accurate clipping itself is performed by the viewer's material shaders.
     *
     * @param worldToLocal - World-to-unit-box transform, or null to disable pruning.
     * @param invert - Keep geometry outside instead of inside the box.
     */
    setClipBox(worldToLocal: Mat4 | null, invert = false) {
        this.clipBoxWorldToLocal = worldToLocal ? worldToLocal.clone() : null;
        this.clipBoxInvert = invert;
        this.onChange();
    }

    /**
     * Актуальные данные выбранного кликом тайла.
     *
     * @returns Снимок данных тайла или `null`.
     */
    getDebugPickedTileInfo(): TileDebugInfo | null {
        const tile = this.debugPickedTile;
        if (!tile) {
            return null;
        }
        const triangles = this.getTileMeshInstances(tile).reduce((sum, meshInstance) => {
            const primitives = meshInstance.mesh?.primitive ?? [];
            return sum + primitives.reduce((primitiveSum, primitive) => primitiveSum +
                Math.floor((primitive.count ?? 0) / 3), 0);
        }, 0);
        return {
            urls: tile.contentUris.slice(),
            depth: tile.depth,
            geometricError: tile.geometricError,
            screenSpaceError: tile.error,
            distance: tile.distance,
            state: tile.state,
            bytes: tile.bytes,
            contentCount: tile.contentUris.length,
            triangles,
            refine: tile.refine,
            selected: tile.selected,
            inFrustum: tile.inFrustum
        };
    }

    /**
     * Текущая статистика — для отладочной панели и тестов.
     *
     * @returns Копия статистики; счётчик очереди дополняется ещё не выданными заявками.
     */
    getStats(): TileStats {
        return { ...this.stats, queued: this.stats.queued + this.queue.pending };
    }

    /**
     * Заморозить/разморозить отбор тайлов (Фаза 2 отладки). На заморозке фрустум и параметры
     * камеры фиксируются на текущем значении — обход продолжает выбирать то же, что «первая»
     * камера, пока живую двигают.
     *
     * @param value - Замораживать ли.
     */
    setFrozen(value: boolean) {
        // Снимок делаем непосредственно в момент нажатия, а не полагаемся на данные
        // предыдущего кадра: визуализируемая камера и источник LOD должны совпадать точно.
        if (value && !this.frozen) {
            const camera = this.camera.camera;
            if (camera) {
                tmpMat.mul2(camera.projectionMatrix, camera.viewMatrix);
                this.frustum.setFromMat4(tmpMat);
                this.view.cameraPos.copy(this.camera.getPosition());
                this.view.viewportHeight = this.renderHeight();
                this.view.sseDenominator = 2 * Math.tan(0.5 * verticalFovRadians(camera));
            }
        }
        this.frozen = value;
    }

    /**
     * Изолировать уровень LOD (Фаза 2 отладки): показывать тайлы только глубины `depth`,
     * прочие скрыть. Обход уточняется по экранной ошибке, но не глубже `depth`, поэтому на
     * больших сценах грузятся и показываются только видимые вблизи фрагменты уровня.
     *
     * @param depth - Глубина изолируемого уровня, или `null` — снять изоляцию.
     */
    setLodIsolate(depth: number | null) {
        this.lodIsolate = depth;
    }

    /**
     * Максимальная глубина в дереве тайлов (включая внешние тайлсеты). Нужна панели, чтобы
     * задать верх ползунка LOD.
     *
     * @returns Наибольшая `depth` среди всех узлов, либо 0.
     */
    getTreeDepth(): number {
        let max = 0;
        const walk = (tile: Tile) => {
            max = Math.max(max, tile.depth);
            const children = tile.externalRoot ? [tile.externalRoot] : tile.children;
            for (let i = 0; i < children.length; ++i) {
                walk(children[i]);
            }
        };
        if (this.rootTile) {
            walk(this.rootTile);
        }
        return max;
    }

    /**
     * Пауза загрузки: новые заявки не стартуют, идущие доигрывают. Снятие догоняет очередь.
     *
     * @param value - Ставить ли на паузу.
     */
    setPaused(value: boolean) {
        this.queue.setPaused(value);
    }

    /**
     * Нарисовать OBB активных тайлов в переданный буфер отладочных линий.
     *
     * «Активные» — те, у кого есть контент в работе или на экране (`state !== unloaded`)
     * либо выбранные обходом. Полностью выгруженные узлы не рисуются, иначе на большом
     * тайлсете дерево тонет в сетке пустых боксов.
     *
     * Обход идёт по тому же принципу, что и `visit`: у тайла с внешним тайлсетом детьми
     * считается его корень.
     *
     * @param lines - Буфер отладочных линий для рёбер (уже очищен вызывающим).
     * @param solid - Буфер полупрозрачной заливки граней (уже очищен вызывающим).
     * @param fill - Буфер опциональной полупрозрачной заливки.
     * @param mode - `state` — цвет по состоянию загрузки; `lod` — по глубине в дереве.
     * @param style - Толщина, цвет и шахматный режим.
     */
    /**
     * Собрать центры выбранных тайлов и их номера в истории загрузки.
     *
     * Возвращаем сырые данные, а не рисуем: текст `DebugLines` не умеет, его кладёт вьюер на
     * канвас поверх сцены. Тайлы без номера пропускаем — они ещё не догрузились.
     *
     * @param out - Массив, куда добавлять записи; переиспользуется между кадрами.
     */
    collectOrderLabels(out: Array<{ center: Vec3, order: number }>) {
        out.length = 0;
        if (!this.rootTile || this.disposed) return;
        const stack: Tile[] = [this.rootTile];
        while (stack.length > 0) {
            const tile = stack.pop() as Tile;
            const children = tile.externalRoot ? [tile.externalRoot] : tile.children;
            for (let i = 0; i < children.length; ++i) stack.push(children[i]);
            if (!tile.selected || !tile.obb || tile.loadSequence <= 0) continue;
            out.push({ center: tile.obb.center, order: tile.loadSequence });
        }
    }

    debugDraw(lines: DebugLines, solid: DebugSolid, fill: DebugSolid, mode: TileDebugMode, style: TileDebugStyle) {
        if (!this.rootTile || this.disposed) {
            return;
        }
        const cameraPos = this.camera.getPosition();
        const stack: Tile[] = [this.rootTile];
        while (stack.length > 0) {
            const tile = stack.pop() as Tile;
            const children = tile.externalRoot ? [tile.externalRoot] : tile.children;
            for (let i = 0; i < children.length; ++i) {
                stack.push(children[i]);
            }

            // Рисуем ТОЛЬКО выбранные тайлы — это текущий срез LOD, который выдаёт сам механизм
            // тайлизации (по мере приближения он углубляется). Родительские/грузящиеся боксы не
            // показываем: их наложение превращало оверлей в нечитаемую кашу линий.
            const picked = tile === this.debugPickedTile;
            if (this.debugIsolatePicked && this.debugPickedTile && !picked) {
                continue;
            }
            if (!tile.obb || (!tile.selected && !picked)) {
                continue;
            }
            const schemeColor = mode === 'lod' ? lodColor(tile.depth) : SELECTED_COLOR;
            const color = picked ? PICKED_COLOR : schemeColor;
            const { center, halfAxes } = tile.obb;

            // Контуры блока толстыми лентами (без заливки — она в ближнем приближении не
            // читалась). Соседние блоки чередуют яркость ребра — граница между «кубиками» видна;
            // чётность из индекса тайла в сетке по трём осям (сосед со сдвигом на бокс меняет её).
            const parity = (
                Math.round(gridIndex(center, halfAxes[0])) +
                Math.round(gridIndex(center, halfAxes[1])) +
                Math.round(gridIndex(center, halfAxes[2]))
            ) & 1;
            const edge = picked || !style.checker || parity ? color : dimColor(color, 0.55);
            const width = Math.min(8, Math.max(0.5, style.lineThickness)) * EDGE_WIDTH_UNIT * (picked ? 1.6 : 1);
            solid.obbEdgesThick(center, halfAxes[0], halfAxes[1], halfAxes[2], cameraPos, width, edge);
            // Шахматная заливка акцентирует только затемнённые клетки: чёрный с opacity 20%.
            // Светлые клетки остаются полностью без заливки, чтобы модель не мутнела целиком.
            if (style.checker && style.checkerFill && tile.selected && !parity) {
                fill.obbFaces(
                    center,
                    halfAxes[0],
                    halfAxes[1],
                    halfAxes[2],
                    withAlpha(0x00000000, 0x33)
                );
            }
        }
    }

    /** Снять тайлсет со сцены и освободить всё, что он занимал. */
    destroy() {
        this.disposed = true;
        this.debugPickedTile = null;
        this.debugIsolatePicked = false;
        this.queue.clear();
        if (this.rootTile) {
            forEachTile(this.rootTile, (tile) => {
                if (tile.state !== TILE_UNLOADED) {
                    this.unloadTile(tile);
                }
                if (tile.externalRoot) {
                    forEachTile(tile.externalRoot, child => this.unloadTile(child));
                }
            });
        }
        this.rootTile = null;
        this.loaded.clear();
        this.loadCounter = 0;
        this.prevSelection = [];
        this.root.destroy();
    }
}

/**
 * Вертикальный угол обзора камеры в радианах, с учётом режима `horizontalFov`.
 *
 * @param camera - Компонент камеры.
 * @returns Угол в радианах.
 */
function verticalFovRadians(camera: CameraComponent): number {
    const fov = camera.fov * Math.PI / 180;
    if (!camera.horizontalFov) {
        return fov;
    }
    // При горизонтальном FOV вертикальный получается через соотношение сторон.
    const aspect = camera.aspectRatio || 1;
    return 2 * Math.atan(Math.tan(fov * 0.5) / aspect);
}

/**
 * Совпадают ли матрицы с точностью до 1e-6.
 *
 * @param a - Первая.
 * @param b - Вторая.
 * @returns true, если различий нет.
 */
function matricesEqual(a: Mat4, b: Mat4): boolean {
    for (let i = 0; i < 16; ++i) {
        if (Math.abs(a.data[i] - b.data[i]) > 1e-6) {
            return false;
        }
    }
    return true;
}
