import { Observer } from '@playcanvas/observer';
import { version as pcuiVersion, revision as pcuiRevision } from '@playcanvas/pcui/react';
import {
    basisInitialize,
    createGraphicsDevice,
    DEVICETYPE_WEBGL2,
    DEVICETYPE_WEBGPU,
    Vec3,
    WasmModule,
    version as engineVersion,
    revision as engineRevision
} from 'playcanvas';

import { DummyWebGPU } from './dummy-webgpu';
import { isTrustedViewerMessage, postToViewerParent } from './embed-messaging';
import { resolveRequestedBackend, resolveEffectiveBackend, persistRequestedBackend } from './graphics-backend';
import { initMaterials } from './material';
import { warmPanelIcons } from './panel-icons';
import { applyThemeColor, DEFAULT_THEME_COLOR } from './theme';
import { ObserverData, File as ViewerFile } from './types';
import initializeUI from './ui';
import Viewer from './viewer';
import './style.scss';
import { version as modelViewerVersion } from '../package.json';
import { isMobileLayout, SD_PIXEL_SCALE } from './helpers';

// Google Material Icons — для иконок в лейблах хелперов (слушатель/микрофон).
// Подключаем рантаймом (в style.scss мешает порядок @use/@import).
if (typeof document !== 'undefined' && !document.getElementById('material-icons-font')) {
    const link = document.createElement('link');
    link.id = 'material-icons-font';
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/icon?family=Material+Icons';
    document.head.appendChild(link);
}

// Permit some additional properties to be set on the window
declare global {
    interface LaunchParams {
        readonly files: FileSystemFileHandle[];
    }
    interface Window {
        launchQueue: {
            setConsumer: (callback: (launchParams: LaunchParams) => void) => void;
        };
        pc: unknown;
        viewer: Viewer;
        startEmbedPlayback?: () => void;
        webkit?: {
            messageHandlers?: unknown;
        };
    }
}

const loadImage = (src: string) => {
    return new Promise<string>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(src);
        image.onerror = () => reject(new Error(`Failed to load image: ${src}`));
        image.src = src;
    });
};

const getEmbedPlaceholderCandidates = (file: { url: string, filename?: string }) => {
    const extensions = ['jpg', 'jpeg', 'png', 'webp'];
    const candidates = new Set<string>();
    const addCandidatesForUrl = (value?: string) => {
        if (!value) return;
        try {
            const parsed = new URL(value, window.location.href);
            const pathname = parsed.pathname;
            const dotIndex = pathname.lastIndexOf('.');
            if (dotIndex === -1) return;
            const basePath = pathname.slice(0, dotIndex);
            extensions.forEach((ext) => {
                const candidate = new URL(parsed.href);
                candidate.pathname = `${basePath}.${ext}`;
                candidate.search = '';
                candidate.hash = '';
                candidates.add(candidate.href);
            });
        } catch {
            // ignore invalid urls
        }
    };

    addCandidatesForUrl(file.url);
    addCandidatesForUrl(file.filename);

    return Array.from(candidates);
};

// Кандидаты проверяются разом, а ответ берётся по приоритету списка. Раньше здесь была
// лесенка: следующий `Image` создавался только после ошибки предыдущего, и на медленном
// хосте перебор восьми кандидатов (их строят и от `url`, и от `filename`) растягивался на
// секунды — а модель всё это время не начинала качаться. Порядок расширений сохранён:
// цепочка ниже отдаёт первого удачного кандидата и не ждёт тех, кто ниже по списку.
const findEmbedPlaceholder = (files: Array<{ url: string, filename?: string }>): Promise<string | null> => {
    const firstModel = files[0];
    if (!firstModel) return Promise.resolve(null);

    const attempts = getEmbedPlaceholderCandidates(firstModel)
    .map((candidate): Promise<string | null> => loadImage(candidate)
    .then((): string | null => candidate)
    .catch((): string | null => null));

    return attempts.reduce(
        (found, attempt) => found.then(url => url ?? attempt),
        Promise.resolve<string | null>(null)
    );
};

const skyboxes = [
    { label: 'Abandoned Tank Farm', url: './skybox/abandoned_tank_farm_01_2k.hdr' },
    { label: 'Adam\'s Place Bridge', url: './skybox/adams_place_bridge_2k.hdr' },
    { label: 'Artist Workshop', url: './skybox/artist_workshop_2k.hdr' },
    { label: 'Ballroom', url: './skybox/ballroom_2k.hdr' },
    { label: 'Circus Arena', url: './skybox/circus_arena_2k.hdr' },
    { label: 'Colorful Studio', url: './skybox/colorful_studio.hdr' },
    { label: 'Golf Course Sunrise', url: './skybox/golf_course_sunrise_2k.hdr' },
    { label: 'Helipad', url: './skybox/Helipad_equi.png' },
    { label: 'Kloppenheim', url: './skybox/kloppenheim_02_2k.hdr' },
    { label: 'Lebombo', url: './skybox/lebombo_2k.hdr' },
    { label: 'Outdoor Umbrellas', url: './skybox/outdoor_umbrellas_2k.hdr' },
    { label: 'Paul Lobe Haus', url: './skybox/paul_lobe_haus_2k.hdr' },
    { label: 'Reinforced Concrete', url: './skybox/reinforced_concrete_01_2k.hdr' },
    { label: 'Rural Asphalt Road', url: './skybox/rural_asphalt_road_2k.hdr' },
    { label: 'Spruit Sunrise', url: './skybox/spruit_sunrise_2k.hdr' },
    { label: 'Studio Small', url: './skybox/studio_small_03_2k.hdr' },
    { label: 'Venice Sunset', url: './skybox/venice_sunset_1k.hdr' },
    { label: 'Vignaioli Night', url: './skybox/vignaioli_night_2k.hdr' },
    { label: 'Wooden Motel', url: './skybox/wooden_motel_2k.hdr' }
];

const observerData: ObserverData = {
    theme: {
        primaryColor: { ...DEFAULT_THEME_COLOR }
    },
    ui: {
        fullscreen: false,
        active: null,
        spinner: false,
        loadProgress: 0,
        error: null,
        language: 'en',
        // Экран «перетащите модель». Нужен только пустому плееру: если модель уже
        // названа в адресе, показывать его нечего — см. ниже, где флаг снимают.
        cta: true,
        embed: {
            enabled: false,
            preset: 'full',
            autoplay: true,
            animAutoplay: true,
            animControls: true,
            waiting: false,
            placeholderUrl: null,
            panel: true,
            poi: true,
            tour: true,
            measure: true,
            info: true,
            fragment: true,
            controls: true,
            hd: true,
            share: true,
            cameraMode: true,
            fullscreen: true,
            fit: true,
            reset: true
        }
    },
    camera: {
        fov: 40,
        tonemapping: 'Linear',
        // Узкий экран стартует в SD: половинное разрешение и без накопления. Это единственная
        // настройка, которая на телефоне заметно влияет на плавность вращения.
        pixelScale: isMobileLayout() ? SD_PIXEL_SCALE : 1,
        multisampleSupported: true,
        multisample: true,
        // Выключено по умолчанию: при смене разрешения кадр вспыхивает — вместе с разрешением
        // меняется и способ вывода, и убрать это без переделки финального прохода не вышло.
        // Выигрыш на сплатах при этом настоящий, поэтому функция оставлена как экспериментальная.
        dynamicScale: false,
        // Порядок загрузки тайлов: 'default' — как раньше, 'foveated' — сперва центр кадра,
        // 'cursor' — сперва то, на что наведён указатель.
        tilePriority: 'foveated',
        distanceLimitsManual: false,
        distanceMin: 0.01,
        distanceMax: 0,
        hq: !isMobileLayout(),
        mode: 'orbit',
        flySpeed: 1,
        surfacePivot: true,
        mouseButtonsInverted: false,
        // По умолчанию мышь: автоопределение путает колесо со свайпом на части мышей, и
        // зум неожиданно превращался в поворот. Трекпадный режим включается явно.
        pointerDevice: 'mouse',
        position: null,
        focus: null,
        ortho: false,
        viewCube: false
    },
    skybox: {
        value: 'Paul Lobe Haus',
        options: JSON.stringify(['None'].concat(skyboxes.map(s => s.label)).map(l => ({ v: l, t: l }))),
        exposure: 0,
        rotation: 0,
        background: 'Solid Color',
        backgroundColor: { r: 128 / 255, g: 128 / 255, b: 128 / 255 },
        blur: 1,
        domeProjection: {
            domeRadius: 20,
            tripodOffset: 0.1
        }
    },
    light: {
        enabled: true,
        color: { r: 1, g: 1, b: 1 },
        intensity: 1,
        follow: false,
        shadow: true
    },
    shadowCatcher: {
        enabled: true,
        intensity: 0.4,
        heightOffset: 0
    },
    debug: {
        renderMode: 'default',
        stats: false,
        wireframe: false,
        wireframeColor: { r: 0, g: 0, b: 0 },
        bounds: false,
        skeleton: false,
        axes: false,
        grid: false,
        alignmentMode: false,
        alignmentGizmoMode: 'rotate',
        alignmentTarget: 'model',
        normals: 0,
        uvCheckerScale: 16,
        selectedUvSet: 0,
        withTextureOnly: false,
        texelDensityHeatmap: false,
        tileDebug: false,
        tileDebugMode: 'state',
        tileLineThickness: 2,
        tileLineStyle: 'checker',
        tileCheckerFill: false,
        tilePick: false,
        tileIsolatePick: false,
        tileFreeze: false,
        tilePaused: false,
        tileLodLock: false,
        tileLodLevel: 0,
        tileLodColor: false,
        gsplatLodColor: false,
        gsplatNodeBounds: false,
        gsplatDebugMode: 'state',
        gsplatFreeze: false,
        gsplatPaused: false
    },
    animation: {
        playing: false,
        speed: 1.0,
        transition: 0.1,
        loops: 1,
        list: '[]',
        progress: 0,
        selectedTrack: 'ALL_TRACKS'
    },
    scene: {
        urls: [],
        filenames: [],
        twinId: null,
        nodes: '[]',
        selectedNode: {
            path: '',
            name: null,
            position: {
                0: 0,
                1: 0,
                2: 0
            },
            rotation: {
                0: 0,
                1: 0,
                2: 0,
                3: 0
            },
            scale: {
                0: 0,
                1: 0,
                2: 0
            }
        },
        meshCount: null,
        materialCount: null,
        textureCount: null,
        vertexCount: null,
        primitiveCount: null,
        textureVRAM: null,
        meshVRAM: null,
        bounds: null,
        boundsCenter: null,
        materialChannelsWithTextures: '[]',
        materialChannelFilenames: '{}',
        selectedMaterialNames: '[]',
        selectedMaterialFactors: {
            metallicPercent: null,
            roughnessPercent: null,
            opacityPercent: null
        },
        selectedMaterialColor: null,
        selectedSpecularColor: null,
        availableUvSets: '[]',
        texelDensitySummary: '',
        texelDensityReport: '[]',
        variant: {
            selected: 0
        },
        variants: {
            list: '[]'
        },
        loadTime: null,
        cameras: '[]',
        selectedCamera: '',
        hasGsplat: false,
        unlit: false,
        isTileset: false,
        tilesetLit: null,
        tilesetMaxDepth: 0
    },
    runtime: {
        activeDeviceType: '',
        requestedBackend: 'auto',
        gsplatRenderer: '',
        viewportWidth: 0,
        viewportHeight: 0,
        cameraDistance: 0
    },
    poi: {
        enabled: false,
        activeId: '',
        list: '[]'
    },
    measure: {
        enabled: false,
        unit: 'm',
        referenceRuler: false,
        unitScale: 1,
        mode: 'distance',
        lastDistance: null,
        lastAngle: null,
        lastArea: null,
        areaPlanarity: null,
        pointCount: 0,
        knownDistance: 0,
        knownDistanceWarning: false
    },
    fragment: {
        enabled: false,
        selecting: false,
        invert: false,
        outline: false,
        outlineWidth: 2,
        editMode: 'move',
        center: [0, 0, 0],
        size: [1, 1, 1],
        rotation: [0, 0, 0],
        initialized: false
    },
    dimensionBox: {
        enabled: false,
        initialized: false,
        size: [1, 1, 1],
        center: [0, 0, 0],
        rotation: [0, 0, 0]
    },
    helpers: {
        visible: false,
        editable: false,
        group: 'all',
        activeId: ''
    },
    morphs: null,
    graphicsBackend: 'auto',
    centerScene: false,
    // Метаданные убраны из плеера (источник правды — портал). Остаётся только
    // невидимый идентификатор для связи файла с записью инструмента.
    metadata: {
        identifier: ''
    }
};

// Version the cookie when the shipped defaults change so an automatically persisted value from
// the previous rollout does not silently override the new layout.
const NAVIGATION_COOKIE = 'model-viewer-camera-navigation-v4';

// Версия поднята из-за устройства ввода. Первая сборка с этой настройкой умолчанием ставила
// «определять автоматически» и успела записать `auto` в куки всем, кто её открывал. Умолчанием
// стала мышь, но сохранённое значение перебивало бы её при каждой загрузке — а отличить
// «пользователь выбрал авто» от «так записалось само» в старой куке нечем.
//
// Из старой куки переносим только точку вращения и инверсию кнопок: их выбирали руками, терять
// их незачем. Устройство ввода из неё игнорируется и берётся из умолчаний.
const NAVIGATION_COOKIE_LEGACY = 'model-viewer-camera-navigation-v3';
const NAVIGATION_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
let lastNavigationCookieValue: string | null = null;

const saveNavigationCookie = (observer: Observer) => {
    try {
        const surfacePivot = observer.get('camera.surfacePivot') !== false ? '1' : '0';
        const mouseButtonsInverted = observer.get('camera.mouseButtonsInverted') === true ? '1' : '0';
        // Третий сегмент добавлен позже: куки из двух сегментов читаются как «auto».
        const pointerDevice = String(observer.get('camera.pointerDevice') ?? 'auto');
        const value = `${surfacePivot}.${mouseButtonsInverted}.${pointerDevice}`;
        // The global observer listener also receives render/runtime changes. Avoid rewriting the
        // same cookie on each of them; navigation preferences change only from explicit UI input.
        if (value === lastNavigationCookieValue) return;
        document.cookie = `${NAVIGATION_COOKIE}=${value}; Max-Age=${NAVIGATION_COOKIE_MAX_AGE}; Path=/; SameSite=Lax`;
        lastNavigationCookieValue = value;
    } catch { /* cookies unavailable */ }
};

const loadNavigationCookie = (observer: Observer) => {
    try {
        const read = (name: string) => {
            const prefix = `${name}=`;
            return document.cookie.split(';').map(part => part.trim())
            .find(part => part.startsWith(prefix))?.slice(prefix.length);
        };
        const current = read(NAVIGATION_COOKIE);
        // Из старой куки берём только два первых сегмента, устройство ввода из неё не переносим.
        const value = current ?? read(NAVIGATION_COOKIE_LEGACY)?.split('.').slice(0, 2).join('.');
        if (!value) return;
        if (current) lastNavigationCookieValue = value;
        const [surfacePivot, mouseButtonsInverted, pointerDevice] = value.split('.');
        if (surfacePivot === '0' || surfacePivot === '1') observer.set('camera.surfacePivot', surfacePivot === '1');
        if (mouseButtonsInverted === '0' || mouseButtonsInverted === '1') {
            observer.set('camera.mouseButtonsInverted', mouseButtonsInverted === '1');
        }
        if (pointerDevice === 'auto' || pointerDevice === 'mouse' || pointerDevice === 'trackpad') {
            observer.set('camera.pointerDevice', pointerDevice);
        }
    } catch { /* cookies unavailable */ }
};

const saveOptions = (observer: Observer, name: string) => {
    const options = observer.json() as Partial<ObserverData>;
    const debug = options.debug ? {
        ...options.debug,
        alignmentMode: false
    } : options.debug;
    // `ortho` и `viewCube` — состояние текущего сеанса, а не настройка: проекцию включает
    // сам пользователь в режиме выравнивания, а куб виден только в нём. Сохранять их нельзя —
    // при следующей загрузке подпись кнопки говорила бы «Орто» при перспективной камере.
    const camera = options.camera ? { ...options.camera } : options.camera;
    if (camera) {
        delete camera.ortho;
        delete camera.viewCube;
        // Navigation preferences have their own versioned, model-independent cookie.
        // Keeping another copy here would let stale defaults override a later rollout.
        delete camera.surfacePivot;
        delete camera.mouseButtonsInverted;
        // Пределы расстояния — свойство конкретной сцены, а не пользователя: расстояние в
        // единицах одной модели для другой бессмысленно. Их место — в файле настроек модели,
        // откуда они и приезжают; общее хранилище переносило бы их между всеми моделями.
        delete camera.distanceLimitsManual;
        delete camera.distanceMin;
        delete camera.distanceMax;
    }
    window.localStorage.setItem(`model-viewer-${name}`, JSON.stringify({
        camera,
        skybox: options.skybox,
        light: options.light,
        debug,
        shadowCatcher: options.shadowCatcher,
        measure: options.measure,
        dimensionBox: options.dimensionBox,
        theme: options.theme,
        metadata: options.metadata ?? {},
        ui: { language: options.ui?.language }
    }));
    saveNavigationCookie(observer);
};

const loadOptions = (observer: Observer, name: string, skyboxUrls: Map<string, string>) => {
    // The backend is a runtime capability, not a scene/user preference. Ignore both the old and
    // current persisted keys so stale storage can never override automatic device selection.
    const filter = ['skybox.options', 'debug.renderMode', 'debug.alignmentMode', 'enableWebGPU', 'graphicsBackend',
        // Ignore legacy model-local navigation values; the versioned cookie below is authoritative.
        'camera.surfacePivot', 'camera.mouseButtonsInverted',
        // Сеансовое состояние проекции и навигационного куба: в старом localStorage оно
        // могло сохраниться, поэтому отбрасываем и на загрузке.
        'camera.ortho', 'camera.viewCube',
        // Пределы расстояния привязаны к габаритам конкретной сцены. Сохранённые от прошлой
        // модели значения удерживали бы камеру там, где для новой модели нет никакого смысла.
        'camera.distanceLimitsManual', 'camera.distanceMin', 'camera.distanceMax',
        // Режим качества на узком экране — свойство устройства, а не сохранённый выбор.
        // Телефон, заходивший до появления мобильного умолчания, иначе навсегда остаётся в
        // HD: в localStorage лежит `hq: true`, и он побеждает дефолт при каждой загрузке.
        ...(isMobileLayout() ? ['camera.hq', 'camera.pixelScale', 'camera.multisample'] : [])];

    const loadRec = (path: string, value: unknown) => {
        if (filter.indexOf(path) !== -1) {
            return;
        }

        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
            Object.keys(value as Record<string, unknown>).forEach((k) => {
                loadRec(path ? `${path}.${k}` : k, (value as Record<string, unknown>)[k]);
            });
        } else {
            // null/undefined из сохранённого состояния не переносим: испорченное
            // значение (напр. skybox.backgroundColor=null) роняло вьюер на старте,
            // и localStorage «отравлял» все последующие загрузки. Дефолт надёжнее.
            if (value === null || value === undefined) {
                return;
            }
            if (path !== 'skybox.value' || value === 'None' || (typeof value === 'string' && skyboxUrls.has(value))) {
                observer.set(path, value);
            }
        }
    };

    const options = window.localStorage.getItem(`model-viewer-${name}`);
    if (options) {
        try {
            loadRec('', JSON.parse(options));
        } catch { }
    }
    // Navigation preferences are deliberately duplicated in a compact cookie so they survive
    // localStorage cleanup and are shared by every model URL on this viewer origin.
    loadNavigationCookie(observer);
};

// print out versions of dependent packages
console.log(`HERITAGE3D Viewer v${modelViewerVersion} | PCUI v${pcuiVersion} (${pcuiRevision}) | PlayCanvas Engine v${engineVersion} (${engineRevision})`);

/** Промежуток между кадрами, ниже которого считаем, что нас рисуют по-настоящему. */
const PAINT_CADENCE_MS = 120;

/** Сколько ждать кадров, прежде чем грузить всё равно. */
const PAINT_WAIT_TIMEOUT_MS = 120000;

/**
 * Отложить работу до момента, когда браузер действительно нас рисует.
 *
 * Зачем. Сторонняя встройка ниже сгиба не получает от браузера ни кадров, ни сети:
 * замерено на живой странице каталога — 24 секунды полной тишины, а в части прогонов и
 * за минуту ничего. Загрузка модели идёт с тика приложения, а тик — с
 * `requestAnimationFrame`, поэтому без кадров вьюер не делает ровно ничего. Полоса же
 * ползёт по обычному таймеру, доходит до своего потолка 96 и там стоит — снаружи это
 * выглядит намертво зависшим плеером. Отложив саму загрузку, мы вместо лживой полосы
 * оставляем заставку, а работу начинаем тогда, когда её кто-то увидит.
 *
 * Почему не `IntersectionObserver`. Внутри стороннего iframe он меряет пересечение с
 * СОБСТВЕННЫМ окном встройки, а не с окном страницы-хозяина, и для встройки за пределами
 * экрана честно отвечает «видно». Для этой задачи он бесполезен.
 *
 * Почему два кадра, а не один. Придушенной встройке может достаться редкий одиночный
 * тик; начав по нему, мы вернулись бы к ползущей полосе при стоящей работе. Два кадра
 * подряд с промежутком меньше `PAINT_CADENCE_MS` — это уже настоящая отрисовка.
 *
 * @param run - Что запустить, когда нас начнут рисовать.
 */
const whenPainted = (run: () => void) => {
    if (typeof requestAnimationFrame !== 'function') {
        run();
        return;
    }
    let done = false;
    let previous = 0;
    // Страховка: если кадров так и не случилось, грузим всё равно. Долгая загрузка
    // всё-таки лучше, чем плеер, который не начнёт работу никогда.
    let timer: ReturnType<typeof setTimeout> | null = null;
    const fire = () => {
        if (done) return;
        done = true;
        if (timer !== null) clearTimeout(timer);
        run();
    };
    timer = setTimeout(fire, PAINT_WAIT_TIMEOUT_MS);
    const tick = (now: number) => {
        if (done) return;
        if (previous && now - previous < PAINT_CADENCE_MS) {
            fire();
            return;
        }
        previous = now;
        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
};

const main = () => {
    // initialize the apps state
    const observer: Observer = new Observer(observerData);

    // global url
    const url = new URL(window.location.href);

    // Экран приглашения раньше прятался императивно (`clearCta`), и только когда загрузка
    // уже началась: до этого React успевал его показать, и на доли секунды мигал пустой
    // «перетащите модель» поверх открывающейся сцены. Модель, названная в адресе, известна
    // здесь — задолго до первого рендера, так что просто не показываем его вовсе.
    if (url.searchParams.has('load') || url.searchParams.has('assetUrl')) {
        observer.set('ui.cta', false);
    }
    const perfParam = url.searchParams.get('perf');
    const perfEnabled = perfParam !== null && perfParam.toLowerCase() !== '0' && perfParam.toLowerCase() !== 'false';

    const parseBool = (key: string, defaultValue: boolean) => {
        const value = url.searchParams.get(key);
        if (value === null) return defaultValue;
        return !['0', 'false', 'off', 'no'].includes(value.toLowerCase());
    };

    const embedEnabled = parseBool('embed', false);
    const embedPresetParam = url.searchParams.get('ui');
    const embedPreset = embedPresetParam === 'compact' || embedPresetParam === 'minimal' || embedPresetParam === 'full' || embedPresetParam === 'none' ?
        embedPresetParam :
        'full';
    const embedDefaults = {
        full: { panel: true, poi: true, tour: true, measure: true, info: true, fragment: true, controls: true, hd: true, share: true, cameraMode: true, fullscreen: true, fit: true, reset: true, animAutoplay: true, animControls: true },
        compact: { panel: false, poi: true, tour: true, measure: false, info: true, fragment: false, controls: true, hd: false, share: false, cameraMode: false, fullscreen: true, fit: true, reset: true, animAutoplay: true, animControls: true },
        minimal: { panel: false, poi: true, tour: true, measure: false, info: false, fragment: false, controls: false, hd: false, share: false, cameraMode: false, fullscreen: true, fit: false, reset: true, animAutoplay: true, animControls: false },
        none: { panel: false, poi: false, tour: false, measure: false, info: false, fragment: false, controls: false, hd: false, share: false, cameraMode: false, fullscreen: false, fit: false, reset: false, animAutoplay: true, animControls: false }
    } as const;
    const embedConfig: NonNullable<ObserverData['ui']['embed']> = {
        enabled: embedEnabled,
        preset: embedPreset,
        autoplay: parseBool('autoplay', true),
        // Автозапуск анимации при загрузке и показ контроллера анимации — отдельные
        // флаги встройки (по умолчанию включены, чтобы не менять текущее поведение).
        animAutoplay: parseBool('animAutoplay', embedDefaults[embedPreset].animAutoplay),
        animControls: parseBool('animControls', embedDefaults[embedPreset].animControls),
        waiting: false,
        placeholderUrl: null,
        parentOrigin: url.searchParams.get('parentOrigin'),
        panel: parseBool('panel', embedDefaults[embedPreset].panel),
        poi: parseBool('poi', embedDefaults[embedPreset].poi),
        tour: parseBool('tour', embedDefaults[embedPreset].tour),
        measure: parseBool('measure', embedDefaults[embedPreset].measure),
        info: parseBool('info', embedDefaults[embedPreset].info),
        fragment: parseBool('fragment', embedDefaults[embedPreset].fragment),
        controls: parseBool('controls', embedDefaults[embedPreset].controls),
        hd: parseBool('hd', embedDefaults[embedPreset].hd),
        share: parseBool('share', embedDefaults[embedPreset].share),
        cameraMode: parseBool('cameraMode', embedDefaults[embedPreset].cameraMode),
        fullscreen: parseBool('fullscreen', embedDefaults[embedPreset].fullscreen),
        fit: parseBool('fit', embedDefaults[embedPreset].fit),
        reset: parseBool('reset', embedDefaults[embedPreset].reset)
    };
    const reservedQueryParams = new Set([
        'embed',
        'ui',
        'panel',
        'autoplay',
        'animAutoplay',
        'animControls',
        'poi',
        'tour',
        'measure',
        'info',
        'modelInfo',
        'fragment',
        'controls',
        'hd',
        'share',
        'cameraMode',
        'fullscreen',
        'fit',
        'reset',
        'lang',
        'perf',
        'poster',
        'eager',
        'parentOrigin'
    ]);

    initMaterials();

    basisInitialize({
        glueUrl: 'static/lib/basis/basis.wasm.js',
        wasmUrl: 'static/lib/basis/basis.wasm.wasm',
        fallbackUrl: 'static/lib/basis/basis.js',
        lazyInit: true
    });

    WasmModule.setConfig('DracoDecoderModule', {
        glueUrl: 'static/lib/draco/draco.wasm.js',
        wasmUrl: 'static/lib/draco/draco.wasm.wasm',
        fallbackUrl: 'static/lib/draco/draco.js'
    });

    const skyboxUrls = new Map(skyboxes.map(s => [s.label, `static/${s.url}`]));

    if (!url.searchParams.has('default')) {
        // handle options
        loadOptions(observer, 'uistate', skyboxUrls);

        observer.on('*:set', () => {
            saveOptions(observer, 'uistate');
        });
    }

    // One-time migration for browsers that persisted an earlier default.
    // Deliberately chosen custom colors remain untouched.
    try {
        const migrationKey = 'mv:theme-default-ff3300-v1';
        if (!window.localStorage.getItem(migrationKey)) {
            const color = observer.get('theme.primaryColor') as { r?: number; g?: number; b?: number } | undefined;
            const legacy = [136 / 255, 188 / 255, 232 / 255];
            const previousDefault = [200 / 255, 200 / 255, 200 / 255];
            const orangeDefault = [221 / 255, 111 / 255, 0];
            const heritageOrangeDefault = [238 / 255, 75 / 255, 24 / 255];
            const channels = [Number(color?.r), Number(color?.g), Number(color?.b)];
            if ([legacy, previousDefault, orangeDefault, heritageOrangeDefault].some(candidate => channels.every((channel, index) => Math.abs(channel - candidate[index]) < 1e-6))) {
                observer.set('theme.primaryColor', { ...DEFAULT_THEME_COLOR });
            }
            window.localStorage.setItem(migrationKey, '1');
        }
    } catch { /* storage unavailable */ }

    applyThemeColor(observer.get('theme.primaryColor'));
    observer.on('theme.primaryColor:set', (color: unknown) => applyThemeColor(color));

    observer.set('ui.embed', embedConfig);

    // Подогреваем иконки панели только там, где панель показывают. Условие то же, по
    // которому её рендерит интерфейс (см. `showLeftPanel` в src/ui/index.tsx).
    if (!(embedConfig.enabled && !embedConfig.panel)) {
        warmPanelIcons();
    }
    if (embedConfig.enabled) {
        observer.set('ui.active', null);
        if (!embedConfig.measure) {
            observer.set('measure.enabled', false);
        }
        if (!embedConfig.poi) {
            observer.set('poi.enabled', false);
        }
    }

    const forcedLang = url.searchParams.get('lang');
    if (forcedLang === 'en' || forcedLang === 'ru' || forcedLang === 'zh') {
        observer.set('ui.language', forcedLang);
    }

    // Graphics backend selection. The requested backend is a device-local preference
    // (URL param > localStorage > 'auto'), never read from the model settings JSON.
    // Set it BEFORE initializeUI so the React state's initial snapshot reflects the real
    // preference (the UI's '*:set' bridge would otherwise miss a set fired mid-mount).
    // `createGraphicsDevice` appends its own WebGL2/null fallbacks to whatever we request,
    // so an unsupported or failing WebGPU device degrades to WebGL2 instead of rejecting.
    //
    // - 'auto' / 'webgpu' → request WebGPU first (WebGL2 fallback is automatic).
    // - 'webgl'           → force WebGL 2 (diagnostics / driver workarounds / render comparison).
    const requestedBackend = resolveRequestedBackend(url);
    observer.set('runtime.requestedBackend', requestedBackend);

    // create react ui
    initializeUI(observer);

    document.addEventListener('fullscreenchange', () => {
        observer.set('ui.fullscreen', !!document.fullscreenElement);
    });

    // create the canvas
    const canvas = document.getElementById('application-canvas') as HTMLCanvasElement;

    // В `runtime.requestedBackend` остаётся ВЫБОР пользователя — его показывает
    // переключатель. Здесь же решается, что просить у браузера на самом деле: в Firefox
    // «авто» означает WebGL 2, кроме сцен со сплатами (см. `resolveEffectiveBackend`).
    // Что в итоге стартовало, видно в `runtime.activeDeviceType`.
    const effectiveBackend = resolveEffectiveBackend(url, requestedBackend);
    const forceWebGL = effectiveBackend === 'webgl';

    // create the graphics device
    createGraphicsDevice(canvas, {
        deviceTypes: forceWebGL ? [DEVICETYPE_WEBGL2] : [DEVICETYPE_WEBGPU],
        antialias: false,
        depth: false,
        stencil: false,
        powerPreference: 'high-performance'
    }).then((device) => {
        observer.set('runtime.activeDeviceType', device.deviceType);
        // Device started fine — clear any prior fallback-recovery guard.
        try {
            window.sessionStorage?.removeItem('mv:backend-recovered');
        } catch { /* ignore */ }

        // create viewer instance
        const viewer = new Viewer(canvas, device, observer, skyboxUrls);

        // make available globally
        window.viewer = viewer;
        viewer.setPerfEnabled(perfEnabled);

        // one-time backend report (alongside the version banner above; never per frame)
        console.log(`Graphics backend: ${viewer.graphicsBackend === 'webgpu' ? 'WebGPU' : 'WebGL 2'} | GSplat renderer: ${observer.get('runtime.gsplatRenderer')}`);

        // save orbit camera position before unload so it can be restored on next load
        window.addEventListener('beforeunload', () => {
            if (viewer?.cameraControls?.mode === 'orbit') {
                const p = viewer.cameraControls.getPosition();
                const f = viewer.cameraControls.getFocus();
                observer.set('camera.position', [p.x, p.y, p.z]);
                observer.set('camera.focus', [f.x, f.y, f.z]);
            }
            viewer?.destroy?.();
        });

        window.addEventListener('message', (event: MessageEvent) => {
            if (!isTrustedViewerMessage(event)) return;
            const data = event.data;
            if (!data || typeof data !== 'object') return;

            function resolveTime(data: { time?: number; frame?: number; fps?: number }): number | null {
                if (typeof data.time === 'number') return data.time;
                if (typeof data.frame === 'number') {
                    const fps = typeof data.fps === 'number' && data.fps > 0 ? data.fps : 24;
                    return data.frame / fps;
                }
                return null;
            }

            const getActiveAnimationDuration = () => {
                let duration = 0;
                viewer.entities.forEach((e) => {
                    const d = e.anim?.baseLayer?.activeStateDuration;
                    if (d) duration = d;
                });
                return duration;
            };

            const setAnimationClip = (clip: unknown) => {
                if (typeof clip === 'string') {
                    observer.set('animation.selectedTrack', clip);
                }
            };

            const seekAnimationToTime = (time: number) => {
                const duration = getActiveAnimationDuration();
                if (duration > 0) {
                    viewer.setAnimationProgress(time / duration);
                    return true;
                }
                return false;
            };

            const parseHelper = (raw: unknown) => {
                if (!raw || typeof raw !== 'object') return null;
                const helper = raw as {
                    id?: unknown;
                    name?: unknown;
                    type?: unknown;
                    group?: unknown;
                    color?: unknown;
                    icon?: unknown;
                    editable?: unknown;
                    position?: { x?: unknown; y?: unknown; z?: unknown } | unknown;
                };
                const id = typeof helper.id === 'string' ? helper.id : '';
                if (!id) return null;
                const p = helper.position && typeof helper.position === 'object' ?
                    helper.position as { x?: unknown; y?: unknown; z?: unknown } :
                    null;
                if (!p) return null;
                const x = Number(p.x);
                const y = Number(p.y);
                const z = Number(p.z);
                if (![x, y, z].every(Number.isFinite)) return null;
                return {
                    id,
                    name: typeof helper.name === 'string' ? helper.name : id,
                    type: typeof helper.type === 'string' ? helper.type : undefined,
                    group: typeof helper.group === 'string' ? helper.group : undefined,
                    color: typeof helper.color === 'string' ? helper.color : undefined,
                    icon: typeof helper.icon === 'string' ? helper.icon : undefined,
                    editable: typeof helper.editable === 'boolean' ? helper.editable : undefined,
                    position: [x, y, z] as [number, number, number]
                };
            };

            switch (data.type) {
                case 'focus-poi':
                case 'open-poi': {
                    const id = typeof data.id === 'string' ? data.id : '';
                    const number = typeof data.number === 'number' ? data.number : null;
                    // Приоритет — навигация по НОМЕРУ тура (хост знает номер, но не
                    // внутренний id модели). Номер ищем среди обычных точек (триггеры
                    // в тур не входят). id — фолбэк, если номер не передан/не найден.
                    if (number !== null) {
                        try {
                            const list = JSON.parse(String(observer.get('poi.list') ?? '[]'));
                            const entry = Array.isArray(list) ?
                                list.find((p: { number?: number; trigger?: boolean }) => !p.trigger && p.number === number) :
                                null;
                            if (entry?.id) {
                                viewer.focusPoi(entry.id);
                                break;
                            }
                        } catch { /* ignore */ }
                    }
                    if (id) {
                        viewer.focusPoi(id);
                    }
                    break;
                }
                case 'clear-poi': {
                    viewer.clearFocusedPoi();
                    break;
                }
                case 'focus-system': {
                    // Реакция зоны-триггера на ноту: ПУЛЬС маркера по системному имени
                    // (напр. «C#4»), без перелёта камеры — чтобы зона «мигала» в такт игре.
                    const name = typeof data.systemName === 'string' ? data.systemName : '';
                    if (name) {
                        try {
                            const list = JSON.parse(String(observer.get('poi.list') ?? '[]'));
                            const entry = Array.isArray(list) ?
                                list.find((p: { systemName?: string }) => p.systemName === name) :
                                null;
                            if (entry?.id) viewer.pulsePoi(entry.id);
                        } catch { /* ignore */ }
                    }
                    break;
                }
                case 'set-trigger-note': {
                    // Хост (наша клавиатура/MIDI) прислал ноту → присваиваем её
                    // ВЫДЕЛЕННОЙ точке (poi.activeId) и делаем её триггером.
                    const note = typeof data.note === 'string' ? data.note.trim() : '';
                    const activeId = String(observer.get('poi.activeId') ?? '');
                    if (note && activeId) {
                        viewer.updatePoiSystemName(activeId, note);
                        viewer.updatePoiTrigger(activeId, true);
                        // Сообщаем хосту результат (для подсветки/подтверждения).
                        postToViewerParent({ type: 'trigger-note-set', id: activeId, note });
                    }
                    break;
                }
                case 'next-poi': {
                    viewer.focusNextPoi();
                    break;
                }
                case 'prev-poi': {
                    viewer.focusPrevPoi();
                    break;
                }
                case 'seek-animation': {
                    setAnimationClip(data.clip);
                    const time = resolveTime(data);
                    if (time === null) break;
                    const wasPlaying = !!observer.get('animation.playing');
                    if (seekAnimationToTime(time) && wasPlaying) {
                        viewer.play();
                    }
                    break;
                }
                case 'play-animation': {
                    setAnimationClip(data.clip);
                    const duration = getActiveAnimationDuration();
                    const time = resolveTime(data);
                    if (time !== null) {
                        seekAnimationToTime(time);
                    }
                    // Автостоп по кадру 'to' (в секунды через fps, по умолчанию 24).
                    // Зажимаем по длительности клипа: кадр за пределами клипа → стоп в конце.
                    let stopTime: number | null = null;
                    if (typeof data.to === 'number') {
                        const fps = typeof data.fps === 'number' && data.fps > 0 ? data.fps : 24;
                        stopTime = data.to / fps;
                        if (duration > 0) stopTime = Math.min(stopTime, duration);
                    }
                    viewer.play();
                    // Ставим ПОСЛЕ play()/seek: seek снимает автостоп, play() его не трогает.
                    viewer.setAnimationStopTime(stopTime);
                    break;
                }
                case 'pause-animation': {
                    viewer.stop();
                    break;
                }
                case 'freeze-animation': {
                    setAnimationClip(data.clip);
                    const time = resolveTime(data);
                    if (time === null) break;
                    seekAnimationToTime(time);
                    break;
                }
                case 'microphone:move': {
                    observer.set('helpers.visible', true);
                    observer.set('helpers.group', 'mic');
                    const id = typeof data.id === 'string' ? data.id : '';
                    const name = typeof data.name === 'string' ? data.name : '';
                    const position = data.position && typeof data.position === 'object' ?
                        { x: Number(data.position.x), y: Number(data.position.y), z: Number(data.position.z) } :
                        null;
                    if (id && position) {
                        viewer.moveMicrophone(id, name, position);
                    }
                    break;
                }
                case 'microphone:clear': {
                    viewer.clearMicrophones();
                    break;
                }
                case 'helper:set': {
                    const helper = parseHelper(data.helper ?? data);
                    if (helper) viewer.setHelper(helper);
                    break;
                }
                case 'helper:set-many': {
                    const helpers = Array.isArray(data.helpers) ?
                        data.helpers.map(parseHelper).filter(Boolean) :
                        [];
                    viewer.setHelpers(helpers);
                    break;
                }
                case 'helper:clear': {
                    viewer.clearHelpers(typeof data.group === 'string' ? data.group : undefined);
                    break;
                }
                case 'helper:visibility': {
                    observer.set('helpers.visible', !!data.visible);
                    if (typeof data.group === 'string') observer.set('helpers.group', data.group);
                    break;
                }
                case 'helper:editable': {
                    observer.set('helpers.editable', !!data.editable);
                    if (data.editable) {
                        observer.set('helpers.visible', true);
                        observer.set('debug.alignmentTarget', 'helper');
                        observer.set('debug.alignmentGizmoMode', 'move');
                    }
                    break;
                }
                default:
                    break;
            }
        });

        observer.on('poi.activeId:set', (activeId: string) => {
            const poiListRaw = observer.get('poi.list');
            let poiList: Array<{ id: string; number: number; title?: string; description?: string; color?: string; trigger?: boolean; systemName?: string }> = [];
            try {
                const parsed = JSON.parse(String(poiListRaw ?? '[]'));
                poiList = Array.isArray(parsed) ? parsed : [];
            } catch {
                poiList = [];
            }

            if (activeId) {
                const poi = poiList.find(entry => entry.id === activeId);
                // playing=true → переключение пришло от плеера тура. Хост по этому
                // флагу НЕ перематывает текст к точке (иначе тур постоянно уводит
                // страницу от окна модели), а только подсвечивает её.
                const tourPlaying = !!observer.get('poi.playing');
                postToViewerParent({
                    type: 'poi-selected',
                    id: activeId,
                    number: poi?.number ?? null,
                    title: poi?.title ?? null,
                    description: poi?.description ?? null,
                    color: poi?.color ?? null,
                    trigger: poi?.trigger ?? false,
                    systemName: poi?.systemName ?? null,
                    tour: tourPlaying
                });
            } else {
                postToViewerParent({
                    type: 'poi-cleared'
                });
            }
        });

        // Каждый клик по точке-триггеру (даже повторный по той же).
        observer.on('poi.triggerHit:set', (raw: string) => {
            try {
                const hit = JSON.parse(String(raw || '{}'));
                if (!hit || !hit.id) return;
                // Анимацию точки плеер играет САМ — диапазон пришёл в самом хите.
                // Не зависим от внешнего хоста: работает в редакторе и автономно.
                if (hit.animClip || hit.animFrom != null || hit.animTo != null) {
                    const msg: Record<string, unknown> = { type: 'play-animation' };
                    if (hit.animClip) msg.clip = hit.animClip;
                    if (hit.animFrom != null) msg.frame = hit.animFrom;
                    if (hit.animTo != null) msg.to = hit.animTo;
                    if (hit.animFps != null) msg.fps = hit.animFps;
                    window.postMessage(msg, window.location.origin);
                }
                // Хосту — только нота сэмплера (звук живёт на стороне сайта).
                // systemName необязателен: триггер может быть чисто анимационным.
                postToViewerParent({
                    type: 'poi-selected',
                    id: hit.id,
                    trigger: true,
                    systemName: hit.systemName || null
                });
            } catch { /* ignore */ }
        });

        observer.on('animation.progress:set', (progress: number) => {
            if (viewer.suppressAnimationProgressUpdate) return;
            let duration = 0;
            viewer.entities.forEach((e) => {
                const d = e.anim?.baseLayer?.activeStateDuration;
                if (d) duration = d;
            });
            const clip = observer.get('animation.selectedTrack') ?? null;
            const fps = 24;
            const time = progress * duration;
            postToViewerParent({
                type: 'animation-time',
                clip,
                time,
                frame: Math.round(time * fps),
                fps,
                duration,
                progress
            });
        });

        // get list of files, decode them
        const files: ViewerFile[] = [];

        // handle OS-based file association in PWA mode
        const promises: Promise<any>[] = [];
        if ('launchQueue' in window) {
            window.launchQueue.setConsumer((launchParams: LaunchParams) => {
                for (const fileHandle of launchParams.files) {
                    promises.push(
                        fileHandle.getFile().then((file) => {
                            files.push({ url: URL.createObjectURL(file), filename: file.name, sizeBytes: file.size });
                        })
                    );
                }
            });
        }

        // handle search params
        for (const [key, value] of url.searchParams) {
            switch (key) {
                case 'load':
                case 'assetUrl': {
                    const loadUrl = decodeURIComponent(value);
                    const absoluteUrl = loadUrl.startsWith('http') ? loadUrl : new URL(loadUrl, window.location.href).href;
                    files.push({ url: absoluteUrl, filename: loadUrl });
                    break;
                }
                case 'id':
                case 'efkId': {
                    // Невидимый идентификатор для связи файла с записью инструмента
                    // на портале. UI не показывает — метаданные живут на портале.
                    if (value) observer.set('metadata.identifier', value);
                    break;
                }
                case 'cameraPosition': {
                    const pos = value.split(',').map(Number);
                    if (pos.length === 3) {
                        viewer.initialCameraPosition = new Vec3(pos);
                    }
                    break;
                }
                case 'cameraFocus': {
                    const pos = value.split(',').map(Number);
                    if (pos.length === 3) {
                        viewer.initialCameraFocus = new Vec3(pos);
                    }
                    break;
                }
                case 'dummyWebGPU': {
                    const dummy = new DummyWebGPU(viewer.app);
                    break;
                }
                default: {
                    if (reservedQueryParams.has(key)) {
                        break;
                    }
                    if (observer.has(key)) {
                        switch (typeof observer.get(key)) {
                            case 'boolean':
                                observer.set(key, value.toLowerCase() === 'true');
                                break;
                            case 'number':
                                observer.set(key, Number(value));
                                break;
                            default:
                                observer.set(key, decodeURIComponent(value));
                                break;
                        }
                    }
                    break;
                }
            }
        }

        Promise.all(promises).then(async () => {
            if (files.length > 0) {
                // Заставка-заглушка: приоритет — явный ?poster= (ручной/авто URL с
                // хоста), иначе ищем по имени файла модели (model.png рядом).
                const posterParam = url.searchParams.get('poster'); // get() уже декодирует
                const placeholder: Promise<string | null> = posterParam ?
                    Promise.resolve(posterParam) :
                    (embedConfig.enabled ? findEmbedPlaceholder(files) : Promise.resolve(null));
                if (embedConfig.enabled && !embedConfig.autoplay) {
                    // Здесь заставка — это ровно то, что зритель видит до клика, поэтому её
                    // дожидаемся: иначе экран ожидания успеет мигнуть пустотой.
                    observer.set('ui.embed.placeholderUrl', await placeholder);
                    observer.set('ui.embed.waiting', true);
                    window.startEmbedPlayback = () => {
                        observer.set('ui.embed.waiting', false);
                        window.startEmbedPlayback = undefined;
                        viewer.loadFiles(files);
                    };
                } else {
                    // А здесь заставка — лишь подложка под индикатором загрузки, и держать
                    // ради неё скачивание модели незачем: ставим её, когда найдётся.
                    placeholder.then(found => observer.set('ui.embed.placeholderUrl', found))
                    .catch(() => observer.set('ui.embed.placeholderUrl', null));
                    // Ждать кадров имеет смысл только во встройке: полноэкранный вьюер
                    // виден всегда, и откладывать его загрузку в фоновой вкладке значило
                    // бы менять поведение без нужды. `?eager=1` снимает отсрочку — на
                    // случай, если хост показывает встройку способом, который мы не учли.
                    if (embedConfig.enabled && !url.searchParams.has('eager')) {
                        whenPainted(() => viewer.loadFiles(files));
                    } else {
                        viewer.loadFiles(files);
                    }
                }
            }
        });
    }).catch((err) => {
        // `createGraphicsDevice` normally degrades to WebGL2/null instead of rejecting, so a
        // rejection here means even the fallback failed. If a manual backend override was in
        // effect, drop it and reload once into Auto so the user is never left on a blank screen.
        // The sessionStorage guard prevents a reload loop if Auto also fails.
        console.error('Failed to create graphics device:', err);
        const alreadyRecovered = (() => {
            try {
                return window.sessionStorage?.getItem('mv:backend-recovered') === '1';
            } catch {
                return false;
            }
        })();
        if (requestedBackend !== 'auto' && !alreadyRecovered) {
            persistRequestedBackend('auto');
            try {
                window.sessionStorage?.setItem('mv:backend-recovered', '1');
            } catch { /* ignore */ }
            window.location.reload();
        }
    });
};

// start main
main();
