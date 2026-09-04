import type { SpzModule } from '@adobe/spz';
import { Observer } from '@playcanvas/observer';
import {
    ADDRESS_CLAMP_TO_EDGE,
    ADDRESS_REPEAT,
    BLENDMODE_ONE,
    BLEND_NONE,
    BLEND_NORMAL,
    BLENDMODE_ZERO,
    BLENDEQUATION_ADD,
    EVENT_KEYDOWN,
    EVENT_KEYUP,
    FILTER_LINEAR,
    FILTER_NEAREST,
    KEY_CONTROL,
    KEY_ESCAPE,
    KEY_F,
    KEY_R,
    KEY_SPACE,
    LAYERID_DEPTH,
    LAYERID_SKYBOX,
    PIXELFORMAT_DEPTH,
    PIXELFORMAT_RGBA8,
    PRIMITIVE_POINTS,
    PRIMITIVE_LINELOOP,
    PRIMITIVE_LINES,
    PRIMITIVE_LINESTRIP,
    PRIMITIVE_TRIANGLES,
    PRIMITIVE_TRISTRIP,
    PRIMITIVE_TRIFAN,
    SKYTYPE_BOX,
    SKYTYPE_DOME,
    SKYTYPE_INFINITE,
    SORTMODE_BACK2FRONT,
    TEXTURETYPE_DEFAULT,
    TEXTURETYPE_RGBM,
    TONEMAP_NONE,
    TONEMAP_LINEAR,
    TONEMAP_NEUTRAL,
    TONEMAP_FILMIC,
    TONEMAP_HEJL,
    TONEMAP_ACES,
    TONEMAP_ACES2,
    math,
    path,
    ShaderChunks,
    AnimEvents,
    AnimTrack,
    Asset,
    BlendState,
    BoundingBox,
    Color,
    ContainerResource,
    Entity,
    EnvLighting,
    GraphicsDevice,
    GraphNode,
    Gizmo,
    DEVICETYPE_WEBGPU,
    GSPLAT_RENDERER_COMPUTE,
    GSPLAT_RENDERER_RASTER_CPU_SORT,
    GSPLAT_RENDERER_RASTER_GPU_SORT,
    GIZMOSPACE_LOCAL,
    GSplatComponent,
    GSplatComponentSystem,
    GSplatData,
    GSplatResource,
    GSplatResourceBase,
    Keyboard,
    Mat4,
    Mesh,
    MeshInstance,
    MorphInstance,
    MorphTarget,
    Mouse,
    Layer,
    MiniStats,
    OutlineRenderer,
    Quat,
    RotateGizmo,
    ScaleGizmo,
    RenderComponent,
    RenderTarget,
    SEMANTIC_POSITION,
    SEMANTIC_TEXCOORD0,
    ShaderMaterial,
    StandardMaterial,
    StandardMaterialOptions,
    Texture,
    TouchDevice,
    TranslateGizmo,
    Vec3,
    Vec2,
    Vec4,
    ViewCube,
    CameraComponent,
    CameraFrame,
    SSAOTYPE_COMBINE,
    SSAOTYPE_NONE,
    platform,
    isCompressedPixelFormat,
    pixelFormatInfo
} from 'playcanvas';
import { serializeCompressedPly } from 'spz-js';

import { App } from './app';
import { CameraControls, type CameraMode, type WalkSurfaceHit } from './camera-controls';
import { ClipBoxMaterials } from './clip-box';
import { DebugLines, DebugSolid } from './debug-lines';
import { CreateDropBlocker, CreateDropHandler } from './drop-handler';
import { isTrustedViewerMessage, postToViewerParent, replyToViewerMessage } from './embed-messaging';
import { SD_PIXEL_SCALE } from './helpers';
import { t } from './i18n/translations';
import { lodColorAbgr, lodColorCss, lodColorRgb } from './lod-palette';
import { Multiframe } from './multiframe';
import { Picker } from './picker';
import { PngExporter } from './png-exporter';
import { RESOLUTION_LOG_RANGE, resolutionColorCss, resolutionColorRgb } from './resolution-palette';
import { ShadowCatcher } from './shadow-catcher';
import { normalizeThemeColor } from './theme';
import { TileResolutionTint } from './tile-resolution-tint';
import { dimColor, EDGE_WIDTH_UNIT, gridIndex, TileManager, type TileDebugInfo, type TileDebugMode, type TileDebugStyle } from './tiles/tile-manager';
import { File, HierarchyNode, MorphTargetData, ObserverData, SceneCamera } from './types';
import type { TileReplayTimeline, TimelineState as TileReplayTimelineState } from './ui/tile-replay-timeline';
import type { TimelineUnit } from './ui/timeline-units';
import { MeasurementController, PoiController, SelectionController, MicrophoneController, SurfacePivotController, type SceneHelperEntry } from './viewer/controllers';
import { CachedMeshGeometry, getCachedMeshGeometry, intersectMeshTriangles, intersectMeshTrianglesDetailed } from './viewer/controllers/mesh-raycast';
import { SettingsService } from './viewer/settings-service';
/**
 * Во сколько раз мельче рисуется сцена, пока камера движется.
 *
 * 1.5 — из замеров `npm run benchmark:render-scale`: пикселей остаётся 44%, а на сплатовой
 * сцене это 37 -> 51 кадр. Шаг на 2 дал бы больше, но мыло в движении уже заметно.
 */
const MOTION_PIXEL_SCALE = 1.5;

/**
 * Сколько камера должна простоять, прежде чем вернуть полное разрешение, мс.
 *
 * Короче — картинка дёргается на паузах внутри жеста; длиннее — заметна задержка резкости
 * после остановки.
 */
const MOTION_SETTLE_MS = 180;

/**
 * Сколько камера должна двигаться, прежде чем понижать разрешение, мс.
 *
 * Переход виден: меняется не только разрешение, но и способ вывода — на неподвижной камере
 * кадр копируется из накопления, в движении растягивается с резкостью. Без задержки это
 * происходило на каждом касании мыши, включая короткие поправки, где выигрыш всё равно
 * незаметен. Со ста миллисекундами короткие движения идут в полном разрешении, а понижение
 * включается там, где оно и нужно, — на долгом облёте.
 */
const MOTION_ONSET_MS = 100;

const TOGGLE_POI_TIMELINE_PLAYBACK_EVENT = 'model-viewer:toggle-poi-timeline-playback';

type MeshoptDecoderModule = typeof import('../lib/meshopt_decoder.module.js')['MeshoptDecoder'];

// Декодер meshopt заводит свой wasm прямо при импорте модуля: браузер компилирует и
// инстанцирует его на каждой загрузке страницы, даже когда модель не сжата — а
// EXT_meshopt_compression встречается заметно реже, чем не встречается. Статический
// импорт делал эту работу всегда и заодно оставлял в главном бандле wasm-блоб.
// Теперь тянем по требованию, из processBufferView, куда движок и так заходит
// асинхронно. Промис общий на все буферы модели: wasm заводится ровно один раз.
let meshoptDecoderPromise: Promise<MeshoptDecoderModule> | null = null;
const loadMeshoptDecoder = (): Promise<MeshoptDecoderModule> => {
    meshoptDecoderPromise ??= import('../lib/meshopt_decoder.module.js')
    .then(async ({ MeshoptDecoder }) => {
        await MeshoptDecoder.ready;
        return MeshoptDecoder;
    });
    return meshoptDecoderPromise;
};

/** Обёрнутый на время freeze метод `GSplatWorld.update` — сигнатуру движок не раскрывает. */
type GSplatWorldUpdate = (...args: any[]) => any;
type GSplatDebugColorGetter = () => number[][] | undefined;
type GSplatBudgetEnforcer = (budget: number, camera: any) => void;

type SurfaceNavigationEvent = {
    type: 'orbit' | 'pan' | 'zoom';
    time: number;
    point: Vec3;
};

// model filename extensions
const modelExtensions = ['gltf', 'glb', 'vox'];
const defaultSceneBounds = new BoundingBox(new Vec3(0, 1, 0), new Vec3(1, 1, 1));
const UV_SEMANTICS = ['TEXCOORD0', 'TEXCOORD1', 'TEXCOORD2', 'TEXCOORD3', 'TEXCOORD4', 'TEXCOORD5', 'TEXCOORD6', 'TEXCOORD7'] as const;

const vec = new Vec3();
const bbox = new BoundingBox();
// Скретч для проверки попадания луча в бокс фрагмента — переиспользуется между вызовами.
const fragmentHitMat = new Mat4();
/** Временный вектор для проекции номеров тайлов в экранные координаты. */
const tileLabelScreen = new Vec3();

/** Точка в системе координат камеры — для глубины, не зависящей от типа проекции. */
const tileLabelView = new Vec3();

/** Обратная матрица камеры; пересчитывается раз в кадр. */
const tileLabelViewInv = new Mat4();

const fragmentHitOrigin = new Vec3();
const fragmentHitDir = new Vec3();

const FOCUS_FOV = 75;
const ZOOM_SCALE_MIN = 0.01;

/**
 * Автоматический предел отдаления, в радиусах описанной сферы сцены.
 *
 * Пятнадцать: десяти хватало, чтобы увидеть модель целиком, но на практике упиралось раньше,
 * чем хотелось. Дальше начинается пустота, где модель — точка, и вернуться можно только
 * клавишей F, поэтому предел остаётся.
 */
const AUTO_DISTANCE_MAX_RADII = 15;

/** Как часто обновлять показанное расстояние до точки вращения, мс. */
const DISTANCE_PUBLISH_INTERVAL_MS = 200;

/**
 * Сколько указатель считается свежим для курсорного приоритета загрузки, мс.
 *
 * Брошенный в углу курсор — не признак внимания: он там оказался случайно и остался. По истечении
 * этого срока приоритет откатывается к центру кадра.
 */
const CURSOR_FOCUS_STALE_MS = 3000;
const MIC_HELPER_NODE_RE = /^mic(?:[_-]|$)/i;
const MIC_CAMEL_HELPER_NODE_RE = /^mic[A-Z0-9]/;

const doubleTapDelay = 400;

/** Границы толщины подсветки контура сечения (пиксели): тоньше — теряется, толще — «жирнит». */
const FRAGMENT_OUTLINE_WIDTH_MIN_PX = 0.5;
const FRAGMENT_OUTLINE_WIDTH_MAX_PX = 8;
const doubleTapRadius = 45;
const DOUBLE_CLICK_ZOOM_DURATION_SECONDS = 0.25;
const DOUBLE_CLICK_ZOOM_FACTOR = 2;
const DOUBLE_CLICK_FEEDBACK_MS = 450;

type FrozenTileCamera = {
    world: Mat4;
    focus: Vec3;
    fov: number;
    horizontalFov: boolean;
    aspect: number;
    nearClip: number;
    farClip: number;
    orthographic: boolean;
    orthoHeight: number;
};

type PoiCameraView = {
    position: [number, number, number];
    focus: [number, number, number];
    fov?: number;
};

type PoiObserverView = {
    position: Vec3;
    focus: Vec3;
    fov: number;
};

type PoiObserverTransition = {
    elapsed: number;
    duration: number;
    startPosition: Vec3;
    startFocus: Vec3;
    startFov: number;
    endPosition: Vec3;
    endFocus: Vec3;
    endFov: number;
};

type GSplatDebugStats = {
    nodes: number;
    visibleNodes: number;
    transitioningNodes: number;
    pendingFiles: number;
    queuedFiles: number;
    runningFiles: number;
    loadedFiles: number;
    activeSplats: number;
    budget: number;
    awaitingLodUpdate: boolean;
    lodCounts: number[];
    /** Наибольший raw LOD в spatial-наборе; у GSplat он самый грубый. */
    maxLod: number;
};

type GSplatFrozenLodCamera = {
    position: Vec3;
    forward: Vec3;
    camera: {
        fov: number;
        horizontalFov: boolean;
        aspectRatio: number;
    };
    getPosition: () => Vec3;
};
type TextureAssetFile = { filename?: string };
/** Формат текстуры канала: имя, сжатость для GPU и размер в пикселях. */
type ChannelFormat = { container: string; gpu: string; compressed: boolean; width: number; height: number } | undefined;
type TextureLike = {
    name?: string;
};
type MaterialLike = {
    name?: string;
    diffuseMap?: TextureLike | null;
    metalnessMap?: TextureLike | null;
    glossMap?: TextureLike | null;
    normalMap?: TextureLike | null;
    specularMap?: TextureLike | null;
    emissiveMap?: TextureLike | null;
    aoMap?: TextureLike | null;
    opacityMap?: TextureLike | null;
};
type RenderResourceLike = {
    meshes?: Mesh[];
};
type ContainerResourceLike = {
    materials?: Asset[];
    renders?: Asset[];
    textures?: Asset[];
    animations?: Array<{ resource: AnimTrack }>;
    getMaterialVariants?: () => string[];
    instantiateRenderEntity?: () => Entity;
};
type MeshoptCompressionExt = {
    buffer: number;
    byteOffset?: number;
    byteLength?: number;
    count: number;
    byteStride: number;
    mode: string;
    filter: string;
};
type GltfBufferLike = {
    uri?: string;
    extensions?: {
        EXT_meshopt_compression?: MeshoptCompressionExt;
    };
};
type GltfImageLike = {
    uri?: string;
};
type GltfTextureLike = object;
type AssetProcessContinuation = (err: string | null, result: unknown) => void;
type AssetLoadProcessOptions = Record<string, unknown>;

/** Engine input devices keep their DOM move handler private; the viewer wraps it (see constructor). */
type MoveHandlerHost<E extends Event> = { _moveHandler: (event: E) => void };

// override global pick to pack depth instead of meshInstance id
const pickDepthGlsl = /* glsl */ `
vec4 packFloat(float depth) {
    uvec4 u = (uvec4(floatBitsToUint(depth)) >> uvec4(0u, 8u, 16u, 24u)) & 0xffu;
    return vec4(u) / 255.0;
}
vec4 getPickOutput() {
    return packFloat(gl_FragCoord.z);
}
`;

const pickDepthWgsl = /* wgsl */ `
    fn packFloat(depth: f32) -> vec4f {
        let u: vec4<u32> = (vec4<u32>(bitcast<u32>(depth)) >> vec4<u32>(0u, 8u, 16u, 24u)) & vec4<u32>(0xffu);
        return vec4f(u) / 255.0;
    }

    fn getPickOutput() -> vec4f {
        return packFloat(pcPosition.z);
    }
`;


const uvCheckerVertexGLSL = /* glsl */ `
attribute vec3 vertex_position;
attribute vec2 vertex_texCoord0;
uniform mat4 matrix_model;
uniform mat4 matrix_viewProjection;
varying vec2 vUv0;
void main(void) {
    vUv0 = vertex_texCoord0;
    gl_Position = matrix_viewProjection * matrix_model * vec4(vertex_position, 1.0);
}
`;

const uvCheckerFragmentGLSL = /* glsl */ `
precision highp float;
varying vec2 vUv0;
uniform float uScale;
void main(void) {
    vec2 uv = fract(vUv0 * uScale);
    float c = step(0.5, uv.x) + step(0.5, uv.y);
    float checker = mod(c, 2.0);
    vec3 dark = vec3(0.12, 0.12, 0.12);
    vec3 light = vec3(0.92, 0.92, 0.92);
    vec3 base = mix(light, dark, checker);
    float seamDist = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
    float seam = 1.0 - step(0.03, seamDist);
    vec3 seamColor = vec3(0.09, 0.95, 0.28);
    gl_FragColor = vec4(mix(base, seamColor, seam), 1.0);
}
`;

const uvCheckerVertexWGSL = /* wgsl */ `
attribute vertex_position: vec3f;
attribute vertex_texCoord0: vec2f;
uniform matrix_model: mat4x4f;
uniform matrix_viewProjection: mat4x4f;
varying vUv0: vec2f;
@vertex
fn vertexMain(input: VertexInput) -> VertexOutput {
    var output: VertexOutput;
    output.vUv0 = input.vertex_texCoord0;
    output.position = uniform.matrix_viewProjection * uniform.matrix_model * vec4(input.vertex_position, 1.0);
    return output;
}
`;

const uvCheckerFragmentWGSL = /* wgsl */ `
varying vUv0: vec2f;
uniform uScale: f32;
@fragment
fn fragmentMain(input: FragmentInput) -> FragmentOutput {
    var output: FragmentOutput;
    let uv = fract(input.vUv0 * uniform.uScale);
    let c = select(0.0, 1.0, uv.x >= 0.5) + select(0.0, 1.0, uv.y >= 0.5);
    let checker = c - 2.0 * floor(c * 0.5);
    let dark = vec3f(0.12, 0.12, 0.12);
    let light = vec3f(0.92, 0.92, 0.92);
    let base = mix(light, dark, checker);
    let seamDist = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
    let seam = 1.0 - select(0.0, 1.0, seamDist >= 0.03);
    let seamColor = vec3f(0.09, 0.95, 0.28);
    output.color = vec4f(mix(base, seamColor, seam), 1.0);
    return output;
}
`;

const createUvMapCheckerCanvas = (size = 1024, grid = 8): HTMLCanvasElement => {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return canvas;

    const tile = size / grid;
    const palette = ['#0F6D8A', '#61D1C6', '#E9DFA7', '#F78D73', '#D12A70', '#252525', '#8C8C8C', '#BDBDBD'];

    const luminance = (hex: string) => {
        const n = parseInt(hex.slice(1), 16);
        const r = (n >> 16) & 0xff;
        const g = (n >> 8) & 0xff;
        const b = n & 0xff;
        return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    };

    for (let row = 0; row < grid; row++) {
        for (let col = 0; col < grid; col++) {
            const color = palette[(col - row + palette.length * 16) % palette.length];
            const x = col * tile;
            const y = row * tile;

            ctx.fillStyle = color;
            ctx.fillRect(x, y, tile, tile);

            const textColor = luminance(color) > 0.6 ? '#101010' : '#f6f6f6';
            const label = `${String.fromCharCode(65 + row)}${col}`;
            ctx.textAlign = 'center';
            ctx.fillStyle = textColor;
            ctx.font = `500 ${Math.round(tile * 0.23)}px "Arial"`;
            ctx.fillText(label, x + tile * 0.5, y + tile * 0.35);
            ctx.font = `${Math.round(tile * 0.28)}px "Arial"`;
            ctx.fillText('↑', x + tile * 0.5, y + tile * 0.72);
        }
    }

    // Fine grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    const minorStep = tile / 8;
    for (let i = 0; i <= grid * 8; i++) {
        const p = i * minorStep;
        ctx.beginPath();
        ctx.moveTo(p, 0);
        ctx.lineTo(p, size);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, p);
        ctx.lineTo(size, p);
        ctx.stroke();
    }

    // Major tile borders
    ctx.strokeStyle = 'rgba(255,255,255,0.34)';
    ctx.lineWidth = 2;
    for (let i = 0; i <= grid; i++) {
        const p = i * tile;
        ctx.beginPath();
        ctx.moveTo(p, 0);
        ctx.lineTo(p, size);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, p);
        ctx.lineTo(size, p);
        ctx.stroke();
    }

    return canvas;
};

const createUvColorCanvas = (size = 1024): HTMLCanvasElement => {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return canvas;

    const gradient = ctx.createLinearGradient(0, 0, size, 0);
    gradient.addColorStop(0, '#000000');
    gradient.addColorStop(1, '#ff0000');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);

    const vertical = ctx.createLinearGradient(0, size, 0, 0);
    vertical.addColorStop(0, 'rgba(0,0,0,0)');
    vertical.addColorStop(1, 'rgba(0,255,0,1)');
    ctx.fillStyle = vertical;
    ctx.fillRect(0, 0, size, size);

    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 2;
    for (let i = 0; i <= 8; i++) {
        const p = (i / 8) * size;
        ctx.beginPath();
        ctx.moveTo(p, 0);
        ctx.lineTo(p, size);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, p);
        ctx.lineTo(size, p);
        ctx.stroke();
    }

    return canvas;
};

/**
 * A load failure whose message is already written for the user, so the failure-path diagnostics
 * leave it alone instead of replacing it with a guess about the server.
 */
class FormattedLoadError extends Error {}

/** Цвет обводки выделенного объекта — тот же зелёный, что был у прежнего каркаса. */
const SELECTION_OUTLINE_COLOR = new Color(0.224, 1.0, 0.078);

class Viewer {
    private static readonly MODEL_FILE_SIZE_LIMIT_BYTES = 1024 * 1024 * 1024; // 1 GB

    private static readonly SETTINGS_FILE_SIZE_LIMIT_BYTES = 10 * 1024 * 1024; // 10 MB

    private static readonly SKYBOX_FILE_SIZE_LIMIT_BYTES = 50 * 1024 * 1024; // 50 MB

    private static readonly REMOTE_HEAD_TIMEOUT_MS = 5000;

    /**
     * Сколько ждать байтов, прежде чем считать закачку зависшей.
     *
     * Загрузчик движка сообщает только `load` и `error`: если соединение живо, но данные
     * перестали идти, не приходит ни то, ни другое — промис не оседает никогда, и индикатор
     * остаётся на месте до перезагрузки страницы. Порог заведомо больше любой сетевой паузы:
     * пока байты идут хотя бы по чуть-чуть, счётчик сбрасывается.
     */
    private static readonly MODEL_DOWNLOAD_STALL_MS = 45000;

    // Рубежи шкалы загрузки. Раньше вся работа после скачивания жила в одном отрезке 90..98,
    // и три её этапа — разбор glTF, заливка в видеопамять, сборка сцены — не были видны вовсе.
    // Показать их «изнутри» нельзя: они держат главный поток, а пока он занят, браузер не
    // рисует. Поэтому у каждого этапа свой рубеж, выставляемый ПЕРЕД работой: полоса называет
    // то, на чём стоит, вместо выдуманных 98.
    private static readonly STAGE_DOWNLOAD = 85;   // скачано, начинается разбор glTF

    private static readonly STAGE_PARSED = 88;     // разбор позади, пошла распаковка картинок

    private static readonly STAGE_TEXTURES = 96;   // картинки распакованы, идёт заливка в GPU

    private static readonly STAGE_ASSEMBLY = 99;   // сцена собрана, ждём первый кадр

    // Через сколько сказать хосту «готов», если первого кадра всё нет. Кадр — честный
    // признак готовности, но он приходит только когда браузер соглашается рисовать, а
    // сторонней встройке ниже сгиба Firefox не даёт ни кадров, ни сети по полминуты и
    // дольше (замерено на живой странице каталога). Хост при этом ждёт сигнала вечно.
    // Полосу по этому таймеру НЕ гасим: за ней пустой холст, и погасить её значило бы
    // подменить честное «идёт работа» на пустоту.
    private static readonly VIEWER_READY_FALLBACK_MS = 10000;

    // Какую долю незавершённого отрезка разрешено занять ползунку-таймеру. Он нужен, чтобы
    // полоса не замирала там, где настоящего прогресса нет, но обгонять реальные события
    // ему нельзя: обогнав, он показывает почти готово и создаёт впечатление зависания.
    private static readonly LOAD_CREEP_SHARE = 0.45;

    canvas: HTMLCanvasElement;

    app: App;

    skyboxUrls: Map<string, string>;

    controlEventKeys: string[] = null;

    pngExporter: PngExporter = null;

    // Последняя загруженная модель (для экспорта байтов на хост через мост).
    lastModelFile: File = null;

    // Если true — родные кнопки экспорта шлют данные на хост, а не скачивают файл.
    saveToParent = false;

    // Утилита: PNG-байты → base64 (для отправки на хост).
    static bytesToBase64(bytes: Uint8Array): string {
        let binary = '';
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk) as unknown as number[]);
        }
        return btoa(binary);
    }

    prevCameraMat: Mat4;

    camera: Entity;

    initialCameraPosition: Vec3 | null;

    initialCameraFocus: Vec3 | null;

    light: Entity;

    sceneRoot: Entity;

    sceneContentRoot: Entity;

    /**
     * Активный слой 3D Tiles. Живёт отдельно от `entities`: тайлы появляются и исчезают
     * каждый кадр, и складывать их в общий список сцены нельзя — от него зависят габариты,
     * статистика и все инструменты, которые ждут статичного набора мешей.
     */
    tileManager: TileManager | null;

    /** User-adjustable reference bounds used for reliable scene framing. */
    private dimensionBoxEntity: Entity;

    /** Exact production clipping box and its reversible material shader injection. */
    private readonly fragmentClipMaterials = new ClipBoxMaterials();

    private readonly tileResolutionTint = new TileResolutionTint();

    private fragmentBoxEntity: Entity;

    private fragmentTranslateGizmo: TranslateGizmo;

    private fragmentScaleGizmo: ScaleGizmo;

    private fragmentRotateGizmo: RotateGizmo;

    private readonly fragmentWorldToLocal = new Mat4();

    private fragmentHandleLayer: HTMLDivElement;

    private fragmentHandleDrag: {
        axis: 0 | 1 | 2,
        sign: -1 | 1,
        startClientX: number,
        startClientY: number,
        screenAxisX: number,
        screenAxisY: number,
        pixelsPerWorld: number,
        worldAxis: Vec3,
        startCenter: Vec3,
        startSize: [number, number, number]
    } | null = null;

    sceneTransform: { position: [number, number, number]; rotation: [number, number, number]; scale: [number, number, number]; pivotOffset: [number, number, number] };

    rotateGizmo: RotateGizmo | null;

    translateGizmo: TranslateGizmo | null;

    private dimensionBoxScaleGizmo: ScaleGizmo;

    lastAlignmentContentTransform: Mat4 | null;

    // World position the geometry must keep while the pivot itself is being dragged.
    private pivotDragContentPosition: Vec3 | null = null;

    helperEntities: Map<string, Entity>;

    activeHelperId: string | null;

    debugRoot: Entity;

    entities: Array<Entity>;

    entityAssets: Array<{ entity: Entity; asset: Asset }>;

    assets: Array<Asset>;

    meshInstances: Array<MeshInstance>;

    wireframeMeshInstances: Array<MeshInstance>;

    wireframeMaterial: StandardMaterial;

    /** Обводка выделенного объекта. */
    private outlineRenderer: OutlineRenderer | null = null;

    /** Слой, в который обводка рисует себя; камера сцены его не видит. */
    private outlineLayer: Layer | null = null;

    /** Узел, чьи меши сейчас обведены, — чтобы снять обводку адресно. */
    private outlinedEntity: Entity | null = null;

    texelDensityHeatmapMeshInstances: Array<MeshInstance>;

    texelDensityHeatmapMaterials: Array<StandardMaterial>;

    uvColorMeshInstances: Array<MeshInstance>;

    uvCheckerMeshInstances: Array<MeshInstance>;

    uvCheckerMaterial: StandardMaterial;

    uvColorMaterial: StandardMaterial;

    uvDebugMode: 'uv0' | 'uv_checker' | null = null;

    uvCheckerEnabled = false;

    uvCheckerOriginalVisibility = new Map<number, boolean>();

    meshGeometryCache = new WeakMap<object, CachedMeshGeometry | null>();

    materialFactorOverrides: Record<string, {
        diffuseColor?: {
            r: number,
            g: number,
            b: number
        },
        specularColor?: {
            r: number,
            g: number,
            b: number
        },
        metallicFactor?: number,
        roughnessFactor?: number,
        opacityFactor?: number
    }> = {};


    animTracks: Array<AnimTrack>;

    animationMap: Record<string, string>;

    firstFrame: boolean;

    /** Сигнал `viewer-ready` уже отправлен — второй раз хосту слать нечего. */
    private viewerReadySent = false;

    /** Страховка сигнала готовности на случай, если первого кадра так и не будет. */
    private viewerReadyTimer: ReturnType<typeof setTimeout> | null = null;

    // Таймер «ползущего» прогресса загрузки; гасится на первом кадре модели.
    loadCreepTimer: ReturnType<typeof setInterval> | null = null;

    skyboxLoaded: boolean;

    animSpeed: number;

    animTransition: number;

    animLoops: number;

    showWireframe: boolean;

    showBounds: boolean;

    showSkeleton: boolean;

    showAxes: boolean;

    showGrid: boolean;

    normalLength: number;

    dirtyWireframe: boolean;

    dirtySelectionHighlight: boolean;

    dirtyTexelDensityHeatmap: boolean;

    dirtyBounds: boolean;

    dirtySkeleton: boolean;

    dirtyGrid: boolean;

    /** Цель рендера другого размера, придержанная для обратного переключения. */
    spareRenderTarget: RenderTarget | null;

    /** Матрица камеры на прошлом кадре — по ней узнаём о движении. */
    lastCameraTransform: Float32Array;

    /** Когда камера двигалась в последний раз, мс. */
    cameraMovedAt: number;

    /** Габариты, от которых считался автоматический предел расстояния. */
    distanceLimitSceneSize: number;

    /** Когда в последний раз публиковали расстояние до точки вращения, мс. */
    distancePublishedAt: number;

    /** Когда началось нынешнее непрерывное движение камеры, мс. */
    cameraMotionStartedAt: number;

    /** Положение указателя над канвасом в CSS-пикселях и время последнего движения. */
    pointerFocus: { x: number, y: number, at: number, over: boolean };

    /** Двигалась ли камера на прошлом кадре — по этому обрывается серия. */
    cameraMoving: boolean;

    /** Включено ли понижение сейчас; держится до полной остановки. */
    motionScaleEngaged: boolean;

    dirtyNormals: boolean;

    sceneBounds: BoundingBox;

    dynamicSceneBounds: BoundingBox;

    debugBounds: DebugLines;

    debugSkeleton: DebugLines;

    debugGrid: DebugLines;

    debugNormals: DebugLines;

    debugMeasure: DebugLines;

    debugRuler: DebugLines;

    /** Отладочные OBB тайлов — рёбра (Фаза 1 визуализации тайлового слоя). */
    debugTiles: DebugLines;

    /** Толстые контуры OBB выбранных тайлов. */
    debugTilesSolid: DebugSolid;

    /** Опциональная полупрозрачная шахматная заливка OBB. */
    debugTilesFill: DebugSolid;

    /** Каркас, оси и сетка замороженной камеры отбора тайлов. */
    debugTileCamera: DebugLines;

    /** Surface point used by a recorded orbit, pan or double-click zoom event. */
    debugSurfaceCursor: DebugLines;

    /** Полупрозрачный объём FOV замороженной камеры. */
    debugTileCameraSolid: DebugSolid;

    /** Каркас, направление и путь виртуальной камеры POI во внешнем режиме просмотра. */
    debugPoiObserverCamera: DebugLines;

    /** Полупрозрачный объём FOV виртуальной камеры POI. */
    debugPoiObserverCameraSolid: DebugSolid;

    /** Visible contour of the production clipping volume. */
    debugFragmentBox: DebugLines;

    /** Translucent red fill of the production clipping volume. */
    debugFragmentBoxSolid: DebugSolid;

    private frozenTileCamera: FrozenTileCamera | null = null;

    /** Положение камеры на момент нажатия заморозки: к нему возвращаемся, когда снята перемотка. */
    private frozenTileCameraAtFreeze: Mat4 | null = null;

    /** DOM-оверлей со статистикой тайлов; создаётся лениво при первом включении. */
    private tileHud: HTMLDivElement | null = null;

    /** Текстовая часть HUD; рядом с ней живёт легенда LOD, поэтому это отдельный узел. */
    private tileHudText: HTMLDivElement | null = null;

    private tileHudLegend: HTMLDivElement | null = null;

    /** Полоска долей уровней детализации над отладочным окном тайлов. */
    private tileHudBar: HTMLDivElement | null = null;

    /** Канвас с номерами порядка загрузки поверх сцены. */
    private tileOrderCanvas: HTMLCanvasElement | null = null;

    /** Ленивый UI таймлайна: его JS-чанк загружается только при первом входе в редактор. */
    private tileReplayTimeline: TileReplayTimeline | null = null;

    private tileReplayTimelineLoading: Promise<void> | null = null;

    /** Prevent Stop from reopening Freeze while the Materials tab is being left. */
    private closingTileDebugMode = false;

    /** Идёт ли проигрывание истории. */
    private tileReplayPlaying = false;

    /** Зацикливать ли проигрывание. */
    private tileReplayLoop = false;

    /** Real-time playback multiplier. */
    private tileReplaySpeed = 1;

    /** Universal display mode; canonical recording data is always seconds. */
    private tileReplayDisplayUnit: TimelineUnit = 'timecode';

    /** Независим от скорости проигрывания и используется только для перевода кадры ↔ время. */
    private tileReplayFps = 30;

    /** Дробный остаток отметки: скорость редко кратна частоте кадров. */
    private tileReplayCursorValue = 0;

    /** Navigation gestures captured during the current tile-debug recording. */
    private readonly surfaceNavigationEvents: SurfaceNavigationEvent[] = [];

    private readonly surfaceCursorA = new Vec3();

    private readonly surfaceCursorB = new Vec3();

    private readonly surfaceCursorCenter = new Vec3();

    private readonly surfaceCursorRight = new Vec3();

    private readonly surfaceCursorUp = new Vec3();

    /** Центры и номера выбранных тайлов; массив переиспользуется между кадрами. */
    private readonly tileOrderLabels: Array<{ center: Vec3, order: number, lodOrder: number, name: string, depth: number }> = [];

    /**
     * Меши, которым проставлен цвет LOD, и глубина, под которую он посчитан. Цвет живёт в
     * параметрах mesh instance, а не в материале: параметр перекрывает материал только для
     * своего меша, поэтому общий материал тайла остаётся нетронутым.
     */
    private tileLodTinted = new Map<MeshInstance, number>();

    /**
     * Слепок содержимого легенды: DOM пересобирается только когда состав уровней изменился.
     * `null` — легенда скрыта и не отрисована, поэтому отличается от пустого состава.
     */
    private tileHudLegendKey: string | null = null;

    /** Последний read-only снимок spatial LOD; обновляется только при включённой диагностике. */
    private gsplatDebugStats: GSplatDebugStats | null = null;

    /** Снимок камеры, используемый только для расчёта spatial LOD. */
    private gsplatFrozenLodCamera: GSplatFrozenLodCamera | null = null;

    /** Оригинальные методы GSplatWorld.update, временно обёрнутые при freeze. */
    private readonly gsplatWorldUpdates = new WeakMap<object, GSplatWorldUpdate>();

    /** Штатные getter-ы палитры; мы меняем только направление шкалы LOD-отладки. */
    private readonly gsplatWorldDebugColorGetters = new WeakMap<object, GSplatDebugColorGetter>();

    /** Штатные budget-enforcer-ы; обёртка превращает целевой бюджет в строгий потолок. */
    private readonly gsplatWorldBudgetEnforcers = new WeakMap<object, GSplatBudgetEnforcer>();

    private readonly gsplatDebugColorsByMaxLod = new Map<number, number[][]>();

    /** Штатный лимит каждого загрузчика, восстанавливаемый после pause. */
    private readonly gsplatLoaderConcurrency = new WeakMap<object, number>();

    private tilePickDown: { clientX: number; clientY: number; canvasX: number; canvasY: number } | null = null;

    private tilePickIsClick = false;

    private readonly onTilePickMouseDown = (event: MouseEvent) => {
        const picking = this.observer.get('debug.tilePick') || this.observer.get('fragment.selecting');
        if (event.button !== 0 || event.target !== this.canvas || !picking) return;
        const rect = this.canvas.getBoundingClientRect();
        this.tilePickDown = {
            clientX: event.clientX,
            clientY: event.clientY,
            canvasX: event.clientX - rect.left,
            canvasY: event.clientY - rect.top
        };
        this.tilePickIsClick = true;
    };

    private readonly onTilePickMouseMove = (event: MouseEvent) => {
        if (!this.tilePickIsClick || !this.tilePickDown) return;
        if (Math.hypot(event.clientX - this.tilePickDown.clientX, event.clientY - this.tilePickDown.clientY) > 5) {
            this.tilePickIsClick = false;
        }
    };

    private readonly onTilePickMouseUp = (event: MouseEvent) => {
        if (event.button === 0 && this.tilePickIsClick && this.tilePickDown) {
            if (this.observer.get('fragment.selecting')) {
                this.pickFragmentAt(this.tilePickDown.canvasX, this.tilePickDown.canvasY);
            } else if (this.observer.get('debug.tilePick')) {
                this.pickDebugTileAt(this.tilePickDown.canvasX, this.tilePickDown.canvasY);
            }
        }
        this.tilePickDown = null;
        this.tilePickIsClick = false;
    };

    private readonly onFragmentHandlePointerDown = (event: PointerEvent) => {
        const target = event.currentTarget as HTMLButtonElement;
        const axis = Number(target.dataset.axis) as 0 | 1 | 2;
        const sign = Number(target.dataset.sign) as -1 | 1;
        if (!this.observer.get('fragment.initialized') || ![0, 1, 2].includes(axis) || (sign !== -1 && sign !== 1)) return;

        event.preventDefault();
        event.stopPropagation();
        const localAxis = new Vec3(axis === 0 ? 1 : 0, axis === 1 ? 1 : 0, axis === 2 ? 1 : 0);
        const worldAxis = this.fragmentBoxEntity.getRotation().transformVector(localAxis).normalize();
        const faceLocal = localAxis.clone().mulScalar(sign * 0.5);
        const faceWorld = this.fragmentBoxEntity.getWorldTransform().transformPoint(faceLocal);
        const unitWorld = faceWorld.clone().add(worldAxis);
        const faceScreen = this.fragmentWorldToCssScreen(faceWorld);
        const unitScreen = this.fragmentWorldToCssScreen(unitWorld);
        const dx = unitScreen.x - faceScreen.x;
        const dy = unitScreen.y - faceScreen.y;
        const pixelsPerWorld = Math.max(0.0001, Math.hypot(dx, dy));
        this.fragmentHandleDrag = {
            axis,
            sign,
            startClientX: event.clientX,
            startClientY: event.clientY,
            screenAxisX: dx / pixelsPerWorld,
            screenAxisY: dy / pixelsPerWorld,
            pixelsPerWorld,
            worldAxis,
            startCenter: this.fragmentBoxEntity.getPosition().clone(),
            startSize: this.observer.get('fragment.shape') === 'sphere' ?
                (() => {
                    const d = Math.max(0.00002, Math.abs(Number(this.observer.get('fragment.radius')) || 1) * 2);
                    return [d, d, d] as [number, number, number];
                })() :
                this.fragmentTuple('fragment.size', [1, 1, 1])
        };
        this.cameraControls.enabled = false;
    };

    private readonly onFragmentHandlePointerMove = (event: PointerEvent) => {
        const drag = this.fragmentHandleDrag;
        if (!drag) return;
        const pointerX = event.clientX - drag.startClientX;
        const pointerY = event.clientY - drag.startClientY;
        const deltaWorld = (pointerX * drag.screenAxisX + pointerY * drag.screenAxisY) / drag.pixelsPerWorld;
        const minSize = Math.max(0.00001, this.sceneBounds.halfExtents.length() * 0.0001);
        const nextSize = [...drag.startSize] as [number, number, number];
        if (this.observer.get('fragment.shape') === 'sphere') {
            // У сферы одна величина: любая ручка тянет радиус, а центр остаётся на месте —
            // сдвигать его, как грань бокса, было бы неверно, сфера растёт во все стороны.
            const startRadius = Math.max(0.00001, drag.startSize[drag.axis] / 2);
            this.observer.set('fragment.radius', Math.max(minSize / 2, startRadius + drag.sign * deltaWorld));
            this.syncFragmentEntityFromObserver();
            this.renderNextFrame();
            return;
        }
        nextSize[drag.axis] = Math.max(minSize, drag.startSize[drag.axis] + drag.sign * deltaWorld);
        const actualFaceDelta = drag.sign * (nextSize[drag.axis] - drag.startSize[drag.axis]);
        const center = drag.startCenter.clone().add(drag.worldAxis.clone().mulScalar(actualFaceDelta * 0.5));
        this.observer.set('fragment.center', [center.x, center.y, center.z]);
        this.observer.set('fragment.size', nextSize);
        this.renderNextFrame();
    };

    private readonly onFragmentHandlePointerUp = () => {
        if (!this.fragmentHandleDrag) return;
        this.fragmentHandleDrag = null;
        this.cameraControls.enabled = true;
        this.renderNextFrame();
    };

    // Навигационный куб (как в 3ds Max) + иконка орто/перспектива для выравнивания и Tiles Debug.
    private viewCube: ViewCube | null = null;


    miniStats: MiniStats;

    observer: Observer;

    measurementController: MeasurementController;

    poiController: PoiController;

    selectionController: SelectionController;

    surfacePivotController: SurfacePivotController;

    microphoneController: MicrophoneController;

    settingsService: SettingsService;

    suppressAnimationProgressUpdate: boolean;

    // Целевое время (сек) автостопа анимации для проигрывания ограниченного
    // диапазона (триггерные POI). null — играть без ограничения.
    animStopTime: number | null = null;

    selectedNode: GraphNode | null;

    multiframe: Multiframe | null;

    multiframeBusy = false;

    /** CameraFrame exists only while at least one of TAA, SSAO or Color LUT is active. */
    private postProcessingFrame: CameraFrame | null = null;

    private postProcessingCamera: CameraComponent | null = null;

    private postProcessingTarget: RenderTarget | null = null;

    private postProcessingOriginalClearColor: Color | null = null;

    private colorLutAsset: Asset | null = null;

    private colorLutTexture: Texture | null = null;

    private colorLutObjectUrl: string | null = null;

    /** Lazily created SPZ codec (see getSpzCodec). */
    private static spzCodec: Promise<SpzModule> | null = null;

    private isCapturingCoverImage = false;

    // Отдельный флаг для топ-даун-захвата: cover/topdown идут последовательно в
    // export-project, и async-cleanup cover'а (.finally) гасит isCapturingCoverImage
    // уже ПОСЛЕ старта topdown — из-за чего rebuildRenderTargets подменял наш RT.
    private isCapturingTopDown = false;

    picker: Picker = null;

    cursorWorld = new Vec3();

    private tmpBoundsSize = new Vec3();

    private tmpGridV0 = new Vec3();

    private tmpGridV1 = new Vec3();

    private tmpRulerV0 = new Vec3();

    private tmpRulerV1 = new Vec3();

    captureFlashEl: HTMLDivElement | null = null;

    lastTapTime = 0;

    lastTapX = 0;

    lastTapY = 0;

    loadTimestamp?: number = null;

    shadowCatcher: ShadowCatcher = null;

    canvasResize = true;

    cameraControls: CameraControls;

    sceneCameras: Array<CameraComponent> = [];

    activeSceneCamera: CameraComponent | null = null;

    private perfEnabled = false;

    private perfWindowStartMs = 0;

    private perfWindowDurationMs = 5000;

    private perfFrames = 0;

    private perfFrameDeltasMs: number[] = [];

    private perfLastFrameStartMs = 0;

    private perfOnFrameRenderTotalMs = 0;

    private perfOnPrerenderTotalMs = 0;

    private perfOnPostrenderTotalMs = 0;

    private cameraFlyTransition: {
        elapsed: number;
        duration: number;
        startPosition: Vec3;
        startFocus: Vec3;
        startFov: number;
        endPosition: Vec3;
        endFocus: Vec3;
        endFov: number;
    } | null = null;

    /** Внешний просмотр POI не захватывает рабочую камеру пользователя. */
    private poiObserverMode = false;

    private poiObserverView: PoiObserverView | null = null;

    private poiObserverTransition: PoiObserverTransition | null = null;

    private pausedPoiObserverFly: {
        position: [number, number, number];
        focus: [number, number, number];
        fov: number;
        remaining: number;
    } | null = null;

    private doubleClickZoomTransition: {
        elapsed: number;
        duration: number;
        startPosition: Vec3;
        zoomDirection: Vec3;
        viewDirection: Vec3;
        travelDistance: number;
        startOrbitDistance: number;
        endOrbitDistance: number;
    } | null = null;

    private readonly doubleClickZoomPosition = new Vec3();

    private readonly doubleClickZoomFocus = new Vec3();

    // Прерванный паузой тура перелёт камеры: сохраняем цель и остаток времени,
    // чтобы Play продолжил движение к той же точке за оставшуюся длительность, а
    // не начинал карточку заново.
    private pausedCameraFly: {
        position: [number, number, number];
        focus: [number, number, number];
        fov: number;
        remaining: number;
    } | null = null;

    private destroyed = false;

    constructor(
        canvas: HTMLCanvasElement,
        graphicsDevice: GraphicsDevice,
        observer: Observer,
        skyboxUrls: Map<string, string>
    ) {
        this.canvas = canvas;

        // create the application
        const app = new App(canvas, {
            mouse: new Mouse(canvas),
            touch: new TouchDevice(canvas),
            keyboard: new Keyboard(window),
            graphicsDevice: graphicsDevice
        });
        this.app = app;
        this.skyboxUrls = skyboxUrls;

        // global override depth
        ShaderChunks.get(this.app.graphicsDevice, 'glsl').set('pickPS', pickDepthGlsl);
        ShaderChunks.get(this.app.graphicsDevice, 'wgsl').set('pickPS', pickDepthWgsl);

        // clustered not needed and has faster startup on windows
        this.app.scene.clusteredLightingEnabled = false;

        // monkeypatch the mouse and touch input devices to ignore touch events
        // when they don't originate from the canvas.
        // `_moveHandler` is declared private by the engine (since 2.20), so go through a narrow
        // structural cast rather than weakening the typing of the whole device.
        const mouseHost = app.mouse as unknown as MoveHandlerHost<MouseEvent>;
        const origMouseHandler = mouseHost._moveHandler;
        app.mouse.detach();
        mouseHost._moveHandler = (event: MouseEvent) => {
            if (event.target === canvas) {
                origMouseHandler(event);
            }
        };
        app.mouse.attach(canvas);

        const touchHost = app.touch as unknown as MoveHandlerHost<TouchEvent>;
        const origTouchHandler = touchHost._moveHandler;
        app.touch.detach();
        touchHost._moveHandler = (event: TouchEvent) => {
            if (event.target === canvas) {
                origTouchHandler(event);
            }
        };
        app.touch.attach(canvas);

        const graphicsDeviceWithSamples = app.graphicsDevice as GraphicsDevice & { maxSamples?: number };
        const multisampleSupported = Number(graphicsDeviceWithSamples.maxSamples ?? 1) > 1;
        observer.set('camera.multisampleSupported', multisampleSupported);
        observer.set('camera.multisample', multisampleSupported && observer.get('camera.multisample'));

        // in embed mode block browser drop navigation, but do not allow loading models by drag & drop
        const appElement = document.getElementById('app');
        if (observer.get('ui.embed.enabled')) {
            CreateDropBlocker(appElement);
        } else {
            CreateDropHandler(appElement, (files: Array<File>, resetScene: boolean) => {
                this.loadFiles(files, resetScene);
            });
        }

        // ── Мост экспорта на хост-страницу (etnophonica «Сохранить в проект») ──
        // saveToParent=1 — родные кнопки «экспорт настроек» и «обложка» вместо
        // скачивания шлют данные на родительскую страницу (она сохраняет в проект).
        this.saveToParent = new URL(window.location.href).searchParams.get('saveToParent') === '1';
        // Принимает postMessage и отдаёт текущие настройки и/или обложку.
        const bytesToBase64 = (bytes: Uint8Array): string => {
            let binary = '';
            const chunk = 0x8000;
            for (let i = 0; i < bytes.length; i += chunk) {
                binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk) as unknown as number[]);
            }
            return btoa(binary);
        };
        window.addEventListener('message', async (e: MessageEvent) => {
            if (!isTrustedViewerMessage(e)) return;
            const d = e.data;
            if (!d || typeof d !== 'object') return;
            const reply = (msg: Record<string, unknown>) => {
                replyToViewerMessage(e, { ...msg, requestId: d.requestId });
            };
            // Достаёт байты последней загруженной модели (если есть).
            const getModelExport = async (): Promise<{ glb: string; filename: string } | null> => {
                const mf = this.lastModelFile;
                if (!mf || !mf.url) return null;
                try {
                    const res = await fetch(mf.url);
                    const buf = new Uint8Array(await res.arrayBuffer());
                    return { glb: bytesToBase64(buf), filename: mf.filename ?? 'model.glb' };
                } catch {
                    return null;
                }
            };
            try {
                if (d.type === 'export-settings') {
                    reply({ type: 'export-settings-result', settings: this.settingsService.getSettingsData() });
                } else if (d.type === 'export-cover') {
                    const png = await this.captureCoverImage();
                    reply({ type: 'export-cover-result', cover: png ? bytesToBase64(png) : null });
                } else if (d.type === 'export-project') {
                    const settings = this.settingsService.getSettingsData();
                    // Три снимка: вытянутый вьюпорт (заставка-заглушка), квадрат (обложка) и вид сверху (ортогональный, для калибровки).
                    const splash = await this.captureViewportImage();
                    const cover = await this.captureCoverImage();
                    // Барьер: даём async-cleanup'у cover'а (.finally восстанавливает
                    // camera.renderTarget на канвас-RT) полностью отработать ДО topdown,
                    // иначе он перетирает наш квадратный RT уже после его установки.
                    await new Promise<void>((r) => {
                        requestAnimationFrame(() => r());
                    });
                    const topdown = await this.captureTopDownImage();
                    const model = d.includeModel ? await getModelExport() : null;
                    reply({
                        type: 'export-project-result',
                        settings,
                        cover: cover ? bytesToBase64(cover) : null,
                        splash: splash ? bytesToBase64(splash) : null,
                        topdown: topdown ? bytesToBase64(topdown.png) : null,
                        spatial_calibration: topdown ? {
                            centerX: topdown.centerX,
                            centerY: topdown.centerY,
                            centerZ: topdown.centerZ,
                            orthoHeight: topdown.orthoHeight,
                            boxX: topdown.boxX,
                            boxY: topdown.boxY,
                            boxZ: topdown.boxZ,
                            boxCenterX: topdown.boxCenterX,
                            boxCenterZ: topdown.boxCenterZ
                        } : null,
                        model
                    });
                }
            } catch (err) {
                reply({ type: 'export-error', message: String(err) });
            }
        });

        // observe canvas size changes
        new ResizeObserver(() => {
            this.canvasResize = true;
            this.renderNextFrame();
        }).observe(window.document.getElementById('canvas-wrapper'));

        // Depth layer is where the framebuffer is copied to a texture to be used in the following layers.
        // Move the depth layer to take place after World and Skydome layers, to capture both of them.
        const depthLayer = app.scene.layers.getLayerById(LAYERID_DEPTH);
        app.scene.layers.remove(depthLayer);
        app.scene.layers.insertOpaque(depthLayer, 2);

        // create the camera
        const camera = new Entity('Camera');
        camera.setPosition(0, 1, 10);
        this.app.root.addChild(camera);
        camera.addComponent('camera', {
            fov: 75,
            frustumCulling: true,
            clearColor: new Color(0, 0, 0, 0)
        });
        this.cameraControls = new CameraControls(
            app,
            camera.camera,
            observer,
            (origin, direction, maxDistance) => this.probeWalkSurface(origin, direction, maxDistance)
        );
        this.cameraControls.zoomRange = new Vec2(ZOOM_SCALE_MIN, Infinity);

        camera.camera.requestSceneColorMap(true);

        app.keyboard.on(EVENT_KEYDOWN, (event) => {
            const el = document.activeElement as HTMLElement | null;
            if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) {
                return;
            }
            switch (event.key) {
                case KEY_ESCAPE: {
                    if (this.observer.get('fragment.selecting') ||
                        this.observer.get('fragment.initialized') ||
                        this.observer.get('fragment.enabled')) {
                        this.resetFragmentView();
                        if (this.observer.get('ui.active') === 'fragment') {
                            this.observer.set('ui.active', null);
                        }
                    }
                    break;
                }
                case KEY_F: {
                    this.frameScene();
                    break;
                }
                case KEY_R: {
                    this.resetCamera();
                    break;
                }
                case KEY_SPACE: {
                    // Let focused controls keep their native Space behavior and ignore key
                    // repeat so one long press cannot rapidly flip playback several times.
                    if (el && (el.tagName === 'BUTTON' || el.tagName === 'A')) break;
                    if (event.event?.repeat) break;
                    if (this.toggleActiveTimelinePlayback()) {
                        event.event?.preventDefault();
                    }
                    break;
                }
            }
        });
        // create the light
        const light = new Entity();
        light.addComponent('light', {
            type: 'directional',
            shadowBias: 0.2,
            shadowResolution: 2048
        });
        app.root.addChild(light);

        // disable autorender
        app.autoRender = false;
        this.prevCameraMat = new Mat4();
        app.on('update', this.update, this);
        app.on('framerender', this.onFrameRender, this);
        app.on('prerender', this.onPrerender, this);
        app.on('postrender', this.onPostrender, this);
        app.on('frameend', this.onFrameend, this);

        // create the scene and debug root nodes
        const sceneRoot = new Entity('sceneRoot', app);
        app.root.addChild(sceneRoot);
        const sceneContentRoot = new Entity('sceneContentRoot', app);
        sceneRoot.addChild(sceneContentRoot);

        const debugRoot = new Entity('debugRoot', app);
        app.root.addChild(debugRoot);

        // store app things
        this.camera = camera;
        this.initialCameraPosition = null;
        this.initialCameraFocus = null;
        // Куб ориентации — после того как this.camera назначен (нужен isOrthographic()).
        this.initViewCube();
        this.light = light;
        this.sceneRoot = sceneRoot;
        this.sceneContentRoot = sceneContentRoot;
        this.sceneTransform = {
            position: [0, 0, 0],
            rotation: [0, 0, 0],
            scale: [1, 1, 1],
            pivotOffset: [0, 0, 0]
        };
        this.rotateGizmo = null;
        this.translateGizmo = null;
        this.lastAlignmentContentTransform = null;
        this.helperEntities = new Map();
        this.activeHelperId = null;
        this.debugRoot = debugRoot;
        this.tileManager = null;
        this.entities = [];
        this.entityAssets = [];
        this.assets = [];
        this.meshInstances = [];
        this.wireframeMeshInstances = [];
        this.texelDensityHeatmapMeshInstances = [];
        this.texelDensityHeatmapMaterials = [];
        this.uvColorMeshInstances = [];
        this.uvCheckerMeshInstances = [];

        const material = new StandardMaterial();
        material.blendState = new BlendState(
            true,
            BLENDEQUATION_ADD,
            BLENDMODE_ONE,
            BLENDMODE_ZERO,
            BLENDEQUATION_ADD,
            BLENDMODE_ZERO,
            BLENDMODE_ONE
        );
        material.useLighting = false;
        material.useSkybox = false;
        material.ambient = new Color(0, 0, 0);
        material.diffuse = new Color(0, 0, 0);
        material.specular = new Color(0, 0, 0);
        material.emissive = new Color(1, 1, 1);
        material.update();
        this.wireframeMaterial = material;

        const uvCheckerCanvas = createUvMapCheckerCanvas(1024, 8);
        const uvCheckerTexture = new Texture(this.app.graphicsDevice, {
            name: 'uv-map-checker',
            width: uvCheckerCanvas.width,
            height: uvCheckerCanvas.height,
            format: PIXELFORMAT_RGBA8,
            mipmaps: true,
            minFilter: FILTER_NEAREST,
            magFilter: FILTER_NEAREST,
            addressU: ADDRESS_REPEAT,
            addressV: ADDRESS_REPEAT
        });
        uvCheckerTexture.setSource(uvCheckerCanvas);

        const uvCheckerMat = new StandardMaterial();
        uvCheckerMat.useLighting = false;
        uvCheckerMat.useSkybox = false;
        uvCheckerMat.diffuse = new Color(1, 1, 1);
        uvCheckerMat.emissive = new Color(1, 1, 1);
        uvCheckerMat.diffuseMap = uvCheckerTexture;
        uvCheckerMat.emissiveMap = uvCheckerTexture;
        const uvCheckerScale = Math.max(1, Math.min(64, Number(observer.get('debug.uvCheckerScale') ?? 16)));
        uvCheckerMat.diffuseMapTiling.set(uvCheckerScale, uvCheckerScale);
        uvCheckerMat.emissiveMapTiling.set(uvCheckerScale, uvCheckerScale);
        const selectedUvSet = Math.max(0, Math.min(UV_SEMANTICS.length - 1, Number(observer.get('debug.selectedUvSet') ?? 0) | 0));
        uvCheckerMat.diffuseMapUv = selectedUvSet;
        uvCheckerMat.emissiveMapUv = selectedUvSet;
        uvCheckerMat.update();
        this.uvCheckerMaterial = uvCheckerMat;

        const uvColorCanvas = createUvColorCanvas(1024);
        const uvColorTexture = new Texture(this.app.graphicsDevice, {
            name: 'uv-color-map',
            width: uvColorCanvas.width,
            height: uvColorCanvas.height,
            format: PIXELFORMAT_RGBA8,
            mipmaps: true,
            minFilter: FILTER_NEAREST,
            magFilter: FILTER_NEAREST,
            addressU: ADDRESS_REPEAT,
            addressV: ADDRESS_REPEAT
        });
        uvColorTexture.setSource(uvColorCanvas);

        const uvColorMat = new StandardMaterial();
        uvColorMat.useLighting = false;
        uvColorMat.useSkybox = false;
        uvColorMat.diffuse = new Color(1, 1, 1);
        uvColorMat.emissive = new Color(1, 1, 1);
        uvColorMat.diffuseMap = uvColorTexture;
        uvColorMat.emissiveMap = uvColorTexture;
        uvColorMat.diffuseMapUv = selectedUvSet;
        uvColorMat.emissiveMapUv = selectedUvSet;
        uvColorMat.update();
        this.uvColorMaterial = uvColorMat;

        this.animTracks = [];
        this.animationMap = {};
        this.firstFrame = false;
        this.skyboxLoaded = false;

        this.animSpeed = observer.get('animation.speed');
        this.animTransition = observer.get('animation.transition');
        this.animLoops = observer.get('animation.loops');
        this.showWireframe = observer.get('debug.wireframe');
        this.showBounds = observer.get('debug.bounds');
        this.showSkeleton = observer.get('debug.skeleton');
        this.showAxes = observer.get('debug.axes');
        this.normalLength = observer.get('debug.normals');
        this.setTonemapping(observer.get('camera.tonemapping'));
        this.setBackgroundColor(observer.get('skybox.backgroundColor'));
        this.setLightColor(observer.get('light.color'));
        this.setWireframeColor(observer.get('debug.wireframeColor'));

        this.dirtyWireframe = false;
        this.dirtySelectionHighlight = false;
        this.dirtyTexelDensityHeatmap = false;
        this.dirtyBounds = false;
        this.dirtySkeleton = false;
        this.dirtyGrid = false;
        this.spareRenderTarget = null;
        this.lastCameraTransform = new Float32Array(16);
        this.cameraMovedAt = 0;
        this.distanceLimitSceneSize = 1;
        this.distancePublishedAt = 0;
        this.cameraMotionStartedAt = 0;
        this.pointerFocus = { x: 0, y: 0, at: 0, over: false };
        this.cameraMoving = false;
        this.motionScaleEngaged = false;
        this.dirtyNormals = false;

        this.sceneBounds = new BoundingBox();
        this.dynamicSceneBounds = new BoundingBox();

        this.debugBounds = new DebugLines(app, camera);
        this.debugSkeleton = new DebugLines(app, camera);
        this.debugGrid = new DebugLines(app, camera, false);
        this.debugNormals = new DebugLines(app, camera, false);
        this.debugMeasure = new DebugLines(app, camera, false);
        this.debugRuler = new DebugLines(app, camera, false);
        // Задний слой включён: боксы тайлов за геометрией видны приглушённо.
        this.debugTiles = new DebugLines(app, camera);
        // Заливку регистрируем раньше контуров: в общем прозрачном debug-слое контуры
        // должны рисоваться последними и оставаться чёткими.
        this.debugTilesFill = new DebugSolid(app, camera, false);
        this.debugTilesSolid = new DebugSolid(app, camera);
        this.debugTileCamera = new DebugLines(app, camera);
        this.debugTileCameraSolid = new DebugSolid(app, camera);
        this.debugSurfaceCursor = new DebugLines(app, camera, false);
        this.debugPoiObserverCamera = new DebugLines(app, camera);
        this.debugPoiObserverCameraSolid = new DebugSolid(app, camera);
        // false → обычный тест глубины: рёбра бокса скрываются за геометрией, и видно, где
        // именно бокс входит в модель. С overlay-режимом бокс лежал поверх модели целиком.
        this.debugFragmentBoxSolid = new DebugSolid(app, camera, false);
        this.debugFragmentBox = new DebugLines(app, camera);

        // construct ministats, default off
        this.miniStats = new MiniStats(app);
        this.miniStats.enabled = observer.get('debug.stats');

        this.observer = observer;

        this.observer.set('debug.texelDensityHeatmap', false);
        this.settingsService = new SettingsService({
            observer: this.observer,
            skyboxUrls: this.skyboxUrls,
            cameraControls: this.cameraControls,
            isModelFilename: this.isModelFilename.bind(this),
            isGSplatFilename: this.isGSplatFilename.bind(this),
            setBackgroundColor: this.setBackgroundColor.bind(this),
            setSkyboxBackground: this.setSkyboxBackground.bind(this),
            setLightColor: this.setLightColor.bind(this),
            onMeasurementReset: () => {
                this.measurementController?.reset();
            },
            getMaterialOverrides: this.getMaterialOverrides.bind(this),
            applyMaterialOverrides: this.applyMaterialOverrides.bind(this),
            resetMaterialOverrides: this.resetMaterialOverrides.bind(this),
            getSceneTransform: this.getSceneTransform.bind(this),
            applySceneTransform: this.applySceneTransform.bind(this),
            resetSceneTransform: this.resetSceneTransform.bind(this)
        });

        const gizmoLayer = Gizmo.createLayer(app, 'RotateGizmo');
        this.rotateGizmo = new RotateGizmo(this.camera.camera, gizmoLayer);
        this.rotateGizmo.enabled = false;
        this.rotateGizmo.on('transform:start', () => {
            this.cameraControls.enabled = false;
            this.lastAlignmentContentTransform = this.getAlignmentTarget() === 'model' ?
                this.captureSceneContentTransform() : null;
        });
        this.rotateGizmo.on('transform:move', () => {
            if (this.getAlignmentTarget() === 'box') {
                this.syncDimensionBoxObserverFromEntity();
                return;
            }
            this.applyPoiTransformFromLastAlignmentState();
            const eulers = this.sceneRoot.getLocalEulerAngles();
            this.sceneTransform = {
                ...this.sceneTransform,
                rotation: [eulers.x, eulers.y, eulers.z]
            };
            this.renderNextFrame();
        });
        this.rotateGizmo.on('transform:end', () => {
            if (this.getAlignmentTarget() === 'box') {
                this.syncDimensionBoxObserverFromEntity();
                this.cameraControls.enabled = true;
                postToViewerParent({ type: 'dimensionbox-changed' });
                return;
            }
            this.applyPoiTransformFromLastAlignmentState();
            const eulers = this.sceneRoot.getLocalEulerAngles();
            this.sceneTransform = {
                ...this.sceneTransform,
                rotation: [eulers.x, eulers.y, eulers.z]
            };
            this.cameraControls.enabled = true;
            this.lastAlignmentContentTransform = null;
            this.renderNextFrame();
        });
        this.translateGizmo = new TranslateGizmo(this.camera.camera, gizmoLayer);
        this.translateGizmo.enabled = false;
        this.translateGizmo.on('transform:start', () => {
            this.cameraControls.enabled = false;
            this.lastAlignmentContentTransform = this.getAlignmentTarget() === 'model' ?
                this.captureSceneContentTransform() : null;
            // Pivot drag moves sceneRoot, which would drag the geometry along as its child.
            // Remember where the geometry sits so every frame can put it back.
            this.pivotDragContentPosition = this.getAlignmentTarget() === 'pivot' ?
                this.sceneContentRoot.getPosition().clone() : null;
        });
        this.translateGizmo.on('transform:move', () => {
            if (this.getAlignmentTarget() === 'pivot') {
                if (this.pivotDragContentPosition) {
                    this.sceneContentRoot.setPosition(this.pivotDragContentPosition);
                }
                this.renderNextFrame();
                return;
            }
            if (this.getAlignmentTarget() === 'box') {
                this.syncDimensionBoxObserverFromEntity();
                return;
            }
            if (this.getAlignmentTarget() === 'helper') {
                // emit=true → шлём helper:moved прямо во время драга (живое обновление
                // позиции/высоты слушателя на хосте). Круг 3D→u,v,Z→3D у хоста
                // тождественный, поэтому эхо helper:set не дёргает гизмо.
                this.syncActiveHelperFromEntity(true);
                this.renderNextFrame();
                return;
            }
            this.applyPoiTransformFromLastAlignmentState();
            const position = this.sceneRoot.getLocalPosition();
            const centered = this.observer.get('centerScene');
            const boundsCenter = this.sceneBounds.center;
            const boundsMinY = this.sceneBounds.getMin().y;
            this.sceneTransform = {
                ...this.sceneTransform,
                position: centered ?
                    [position.x + boundsCenter.x, position.y + boundsMinY, position.z + boundsCenter.z] :
                    [position.x, position.y, position.z]
            };
            this.renderNextFrame();
        });
        this.translateGizmo.on('transform:end', () => {
            if (this.getAlignmentTarget() === 'pivot') {
                if (this.pivotDragContentPosition) {
                    this.sceneContentRoot.setPosition(this.pivotDragContentPosition);
                    this.pivotDragContentPosition = null;
                }
                // Geometry never moved, so POIs and the dimension box need no compensation.
                this.commitPivotTransformFromEntities();
                this.cameraControls.enabled = true;
                this.renderNextFrame();
                return;
            }
            if (this.getAlignmentTarget() === 'box') {
                this.syncDimensionBoxObserverFromEntity();
                this.cameraControls.enabled = true;
                postToViewerParent({ type: 'dimensionbox-changed' });
                return;
            }
            if (this.getAlignmentTarget() === 'helper') {
                this.syncActiveHelperFromEntity(true);
                this.cameraControls.enabled = true;
                this.renderNextFrame();
                return;
            }
            this.applyPoiTransformFromLastAlignmentState();
            const position = this.sceneRoot.getLocalPosition();
            const centered = this.observer.get('centerScene');
            const boundsCenter = this.sceneBounds.center;
            const boundsMinY = this.sceneBounds.getMin().y;
            this.sceneTransform = {
                ...this.sceneTransform,
                position: centered ?
                    [position.x + boundsCenter.x, position.y + boundsMinY, position.z + boundsCenter.z] :
                    [position.x, position.y, position.z]
            };
            this.cameraControls.enabled = true;
            this.lastAlignmentContentTransform = null;
            this.setCenterScene(centered);
        });

        this.dimensionBoxEntity = new Entity('DimensionBoxTransform');
        this.app.root.addChild(this.dimensionBoxEntity);
        this.syncDimensionBoxEntityFromObserver();
        this.dimensionBoxScaleGizmo = new ScaleGizmo(this.camera.camera, gizmoLayer);
        this.dimensionBoxScaleGizmo.lowerBoundScale.set(0.000001, 0.000001, 0.000001);
        this.dimensionBoxScaleGizmo.enabled = false;
        this.dimensionBoxScaleGizmo.on('transform:start', () => {
            this.cameraControls.enabled = false;
        });
        this.dimensionBoxScaleGizmo.on('transform:move', () => {
            this.syncDimensionBoxObserverFromEntity();
        });
        this.dimensionBoxScaleGizmo.on('transform:end', () => {
            this.syncDimensionBoxObserverFromEntity();
            this.cameraControls.enabled = true;
            postToViewerParent({ type: 'dimensionbox-changed' });
        });

        // Production clipping volume. It is a transform-only entity: the contour is
        // drawn by DebugLines and the same world transform is consumed by the shaders.
        this.fragmentBoxEntity = new Entity('FragmentClipBox');
        this.fragmentBoxEntity.setLocalScale(1, 1, 1);
        this.app.root.addChild(this.fragmentBoxEntity);
        const fragmentGizmoLayer = Gizmo.createLayer(app, 'FragmentClipBoxGizmo');
        this.fragmentTranslateGizmo = new TranslateGizmo(this.camera.camera, fragmentGizmoLayer);
        this.fragmentTranslateGizmo.coordSpace = GIZMOSPACE_LOCAL;
        this.fragmentScaleGizmo = new ScaleGizmo(this.camera.camera, fragmentGizmoLayer);
        this.fragmentScaleGizmo.lowerBoundScale.set(0.00001, 0.00001, 0.00001);
        this.fragmentRotateGizmo = new RotateGizmo(this.camera.camera, fragmentGizmoLayer);
        const fragmentTransformStart = () => {
            this.cameraControls.enabled = false;
        };
        const fragmentTransformMove = () => {
            this.syncFragmentObserverFromEntity();
            this.syncFragmentClipping();
        };
        const fragmentTransformEnd = () => {
            this.syncFragmentObserverFromEntity();
            this.syncFragmentClipping();
            this.cameraControls.enabled = true;
        };
        [this.fragmentTranslateGizmo, this.fragmentScaleGizmo, this.fragmentRotateGizmo].forEach((gizmo) => {
            gizmo.enabled = false;
            gizmo.on('transform:start', fragmentTransformStart);
            gizmo.on('transform:move', fragmentTransformMove);
            gizmo.on('transform:end', fragmentTransformEnd);
        });
        this.fragmentHandleLayer = document.createElement('div');
        this.fragmentHandleLayer.id = 'fragment-box-handles';
        this.fragmentHandleLayer.style.display = 'none';
        (this.canvas.parentElement ?? document.body).appendChild(this.fragmentHandleLayer);
        ([0, 1, 2] as const).forEach((axis) => {
            ([-1, 1] as const).forEach((sign) => {
                const handle = document.createElement('button');
                handle.type = 'button';
                handle.className = `fragment-face-handle axis-${axis} sign-${sign}`;
                handle.dataset.axis = String(axis);
                handle.dataset.sign = String(sign);
                handle.title = 'Resize clipping box';
                handle.setAttribute('aria-label', 'Resize clipping box');
                handle.addEventListener('pointerdown', this.onFragmentHandlePointerDown);
                this.fragmentHandleLayer.appendChild(handle);
            });
        });
        document.addEventListener('pointermove', this.onFragmentHandlePointerMove);
        document.addEventListener('pointerup', this.onFragmentHandlePointerUp);
        document.addEventListener('pointercancel', this.onFragmentHandlePointerUp);

        const device = this.app.graphicsDevice;

        // render frame after device restored
        device.on('devicerestored', () => {
            this.renderNextFrame();
        });

        // multiframe
        this.multiframe = new Multiframe(device, this.camera.camera);

        // dynamic shadow catcher
        this.shadowCatcher = new ShadowCatcher(app, this.camera.camera, this.debugRoot, this.sceneRoot);

        // gaussian splat pipeline
        this.initGSplat();

        // initialize control events
        this.bindControlEvents();

        // load initial settings
        this.reloadSettings();

        // construct the depth reader
        this.picker = new Picker(app, camera);
        this.cursorWorld = new Vec3();
        this.surfacePivotController = new SurfacePivotController({
            canvas: this.canvas,
            picker: this.picker,
            cameraControls: this.cameraControls,
            canStart: () => this.canUseSurfacePivot(),
            mouseButtonsInverted: () => this.cameraControls.mouseButtonsInverted,
            worldToScreen: point => this.fragmentWorldToCssScreen(point),
            renderNextFrame: this.renderNextFrame.bind(this),
            // Ленивая ссылка: контроллер измерений создаётся следом, а зовётся это уже в рантайме.
            pickSurfaceSync: (x, y) => this.measurementController?.pickSurfacePoint(x, y) ?? null,
            onSurfaceGesture: (gesture, point) => this.recordSurfaceNavigationEvent(gesture, point)
        });
        this.measurementController = new MeasurementController({
            canvas: this.canvas,
            observer: this.observer,
            picker: this.picker,
            getMeshInstances: () => this.getPickableMeshInstances(),
            getPickRay: this.getPickRay.bind(this),
            renderNextFrame: this.renderNextFrame.bind(this)
        });
        this.poiController = new PoiController({
            canvas: this.canvas,
            observer: this.observer,
            picker: this.picker,
            getMeshInstances: () => this.getPickableMeshInstances(),
            getPickRay: this.getPickRay.bind(this),
            getCameraView: () => ({
                position: (() => {
                    const p = this.cameraControls.getPosition();
                    return [p.x, p.y, p.z] as [number, number, number];
                })(),
                focus: (() => {
                    const f = this.cameraControls.getFocus();
                    return [f.x, f.y, f.z] as [number, number, number];
                })(),
                fov: this.camera.camera.fov
            }),
            applyCameraView: (view, duration) => this.applyPoiCameraView(view, duration),
            renderNextFrame: this.renderNextFrame.bind(this)
        });
        this.microphoneController = new MicrophoneController({
            canvas: this.canvas,
            observer: this.observer,
            onSelect: id => this.selectHelper(id)
        });
        this.selectionController = new SelectionController({
            canvas: this.canvas,
            observer: this.observer,
            picker: this.picker,
            getMeshInstances: () => this.getPickableMeshInstances(),
            getCameraPosition: () => this.camera.getPosition(),
            getPickRay: this.getPickRay.bind(this),
            getSelectedNode: () => this.selectedNode,
            setSelectedNodePath: (path: string) => this.setSelectedNode(path),
            renderNextFrame: this.renderNextFrame.bind(this)
        });
        this.canvas.addEventListener('mousedown', this.onTilePickMouseDown);

        // Указатель нужен курсорному приоритету загрузки тайлов. Слушаем пассивно и только
        // запоминаем координаты: работы на кадр это не добавляет, решение принимается позже.
        this.canvas.addEventListener('pointermove', (event: PointerEvent) => {
            const rect = this.canvas.getBoundingClientRect();
            this.pointerFocus.x = event.clientX - rect.left;
            this.pointerFocus.y = event.clientY - rect.top;
            this.pointerFocus.at = performance.now();
            this.pointerFocus.over = true;
        }, { passive: true });
        this.canvas.addEventListener('pointerleave', () => {
            this.pointerFocus.over = false;
        }, { passive: true });
        document.addEventListener('mousemove', this.onTilePickMouseMove);
        document.addEventListener('mouseup', this.onTilePickMouseUp);

        const wrapper = this.canvas.parentElement;
        if (wrapper) {
            this.captureFlashEl = document.createElement('div');
            this.captureFlashEl.className = 'capture-flash';
            this.captureFlashEl.addEventListener('animationend', () => {
                this.captureFlashEl?.classList.remove('active');
            });
            wrapper.appendChild(this.captureFlashEl);
        }

        // Double click: one depth pick followed by the same short 2x zoom-to-point as NASA-AMMOS.
        canvas.addEventListener('dblclick', (event: MouseEvent) => {
            if (this.observer.get('measure.enabled') || this.observer.get('debug.tilePick')) return;
            if (this.reopenFragmentPanelAt(event.offsetX, event.offsetY)) return;
            this._pickAndCenterAt(event.offsetX, event.offsetY);
        });

        // double tap (mobile): same as dblclick when second tap within delay and radius
        canvas.addEventListener('touchend', (event: TouchEvent) => {
            if (this.observer.get('measure.enabled') || this.observer.get('debug.tilePick')) return;
            if (event.changedTouches.length !== 1) return;
            const touch = event.changedTouches[0];
            const rect = canvas.getBoundingClientRect();
            const x = touch.clientX - rect.left;
            const y = touch.clientY - rect.top;
            const now = Date.now();
            if (now - this.lastTapTime < doubleTapDelay &&
                Math.hypot(x - this.lastTapX, y - this.lastTapY) <= doubleTapRadius) {
                if (!this.reopenFragmentPanelAt(x, y)) {
                    this._pickAndCenterAt(x, y);
                }
                this.lastTapTime = 0;
            } else {
                this.lastTapTime = now;
                this.lastTapX = x;
                this.lastTapY = y;
            }
        });

        this.app.scene.layers.getLayerByName('World').transparentSortMode = SORTMODE_BACK2FRONT;

        // start the application
        app.start();
    }

    setPerfEnabled(enabled: boolean) {
        this.perfEnabled = enabled;
        this.perfWindowStartMs = 0;
        this.perfFrames = 0;
        this.perfFrameDeltasMs.length = 0;
        this.perfLastFrameStartMs = 0;
        this.perfOnFrameRenderTotalMs = 0;
        this.perfOnPrerenderTotalMs = 0;
        this.perfOnPostrenderTotalMs = 0;
        if (enabled) {
            console.log('[perf] enabled (window=5s)');
        }
    }

    /**
     * Configure the engine's unified gsplat pipeline. Called once from the constructor.
     *
     * The viewer runs with `app.autoRender === false`, so splat streaming and sorting must be able
     * to ask for a frame: 'frame:request' fires when streaming produced new data or a sort result is
     * ready to be applied. This replaces the legacy per-component `instance.sorter.on('updated')`,
     * which only existed on the non-unified (CPU-sorted) path.
     */
    private initGSplat() {
        const gsplatSystem = this.app.systems.gsplat as GSplatComponentSystem;
        const gsplatParams = this.app.scene.gsplat;

        gsplatSystem.on('frame:request', () => {
            this.renderNextFrame();
        });

        // Global splat budget. Only caps octree (LOD/streamed) scenes — plain PLY/SOG are unaffected.
        // PlayCanvas штатно использует это значение как цель и повышает детализацию, чтобы заполнить
        // свободный бюджет. Ниже syncGSplatBudgetCeilings меняет семантику на «только потолок»:
        // естественный выбор по расстоянию сохраняется, а дальние узлы огрубляются лишь при превышении.
        gsplatParams.splatBudget = platform.mobile ? 1500000 : 3000000;

        // Let detail drop behind the camera. The engine picks a LOD per octree node from its
        // distance to the camera, and only applies a direction penalty when lodBehindPenalty > 1 —
        // the default of 1 means the back of the scene streams in at the same detail as the part
        // you are looking at. That is expensive here because the engine's loader is a plain FIFO
        // with two concurrent requests and no distance priority (GSplatAssetLoader), so tiles
        // behind you can occupy the queue ahead of the ones in view.
        //
        // lodUpdateAngle is needed alongside it: rotation-triggered LOD re-evaluation is off by
        // default (0), so after turning around the tiles now in front would keep their coarse LOD
        // until the camera also moved. Values match supersplat-viewer; both are safe to tune.
        gsplatParams.lodBehindPenalty = 5;
        gsplatParams.lodUpdateAngle = 90;

        // Prefer an already available coarser representation while the camera-optimal LOD is
        // still loading. Streamed SOG has no single renderable root proxy like a REPLACE GLB
        // tileset, so without underfill individual leaf blocks appear at their final LOD as their
        // files arrive. A deliberately high limit means "allow the coarsest available level";
        // the engine clamps it to the actual number of LODs in each scene.
        gsplatParams.lodUnderfillLimit = 32;

        // Sorting pipeline, chosen explicitly per backend as supersplat-viewer does, rather than
        // leaving GSPLAT_RENDERER_AUTO implicit: same resolution (WebGPU → GPU sort, WebGL → CPU
        // sort), but the choice is visible in code and easy to override.
        // GSPLAT_RENDERER_COMPUTE also exists in this engine version; supersplat-viewer does not use
        // it as its production renderer yet, so we don't either — switching means one line here.
        gsplatParams.renderer = this.graphicsBackend === 'webgpu' ?
            GSPLAT_RENDERER_RASTER_GPU_SORT :
            GSPLAT_RENDERER_RASTER_CPU_SORT;

        // Report what the engine actually resolved to (it falls back on its own if a mode needs
        // WebGPU on a WebGL device), not what we asked for.
        const rendererLabels: Record<number, string> = {
            [GSPLAT_RENDERER_RASTER_CPU_SORT]: 'CPU sort',
            [GSPLAT_RENDERER_RASTER_GPU_SORT]: 'GPU sort',
            [GSPLAT_RENDERER_COMPUTE]: 'compute'
        };
        const resolved = gsplatParams.currentRenderer;
        this.observer.set('runtime.gsplatRenderer', rendererLabels[resolved] ?? `unknown (${resolved})`);
    }

    /**
     * Graphics backend actually in use, after the engine's WebGPU → WebGL2 fallback.
     *
     * @returns 'webgpu' or 'webgl'.
     */
    get graphicsBackend(): 'webgpu' | 'webgl' {
        return this.app.graphicsDevice.deviceType === DEVICETYPE_WEBGPU ? 'webgpu' : 'webgl';
    }

    private async _pickAndCenterAt(x: number, y: number) {
        this.showDoubleClickFeedback(x, y);
        const result = await this.picker.pick(x, y);
        if (!result) return;
        this.recordSurfaceNavigationEvent('zoom', result);
        const startPosition = this.cameraControls.getPosition();
        const startFocus = this.cameraControls.getFocus();
        const zoomDirection = result.clone().sub(startPosition);
        const hitDistance = zoomDirection.length();
        const viewDirection = startFocus.clone().sub(startPosition);
        const startOrbitDistance = viewDirection.length();
        if (hitDistance <= 1e-6 || startOrbitDistance <= 1e-6) return;

        // The scripted transition must obey the same closest-zoom limit as the wheel controls.
        // Repeated double clicks used to halve the distance indefinitely because `reset()` does
        // not apply OrbitController.zoomRange by itself.
        const minDistance = Math.max(ZOOM_SCALE_MIN, this.cameraControls.zoomRange.x);
        const endHitDistance = Math.max(minDistance, hitDistance / DOUBLE_CLICK_ZOOM_FACTOR);
        const travelDistance = hitDistance - endHitDistance;
        if (travelDistance <= 1e-6) return;

        // NASA EnvironmentControls keeps the view direction fixed and moves the camera directly
        // along the picked ray. Keeping this separate from camera-fly avoids curved-looking motion
        // and the per-frame Vec3 allocations of the general position/focus interpolation.
        this.stopCameraFlyTransition();
        this.doubleClickZoomTransition = {
            elapsed: 0,
            duration: DOUBLE_CLICK_ZOOM_DURATION_SECONDS,
            startPosition,
            zoomDirection: zoomDirection.mulScalar(1 / hitDistance),
            viewDirection: viewDirection.mulScalar(1 / startOrbitDistance),
            travelDistance,
            startOrbitDistance,
            endOrbitDistance: Math.max(minDistance, startOrbitDistance / DOUBLE_CLICK_ZOOM_FACTOR)
        };
        this.cameraControls.enabled = false;
        this.renderNextFrame();
    }

    private showDoubleClickFeedback(x: number, y: number) {
        const wrapper = this.canvas.parentElement;
        if (!wrapper) return;
        const feedback = document.createElement('div');
        feedback.className = 'double-click-feedback';
        feedback.style.left = `${x}px`;
        feedback.style.top = `${y}px`;
        feedback.setAttribute('aria-hidden', 'true');
        wrapper.appendChild(feedback);
        setTimeout(() => feedback.remove(), DOUBLE_CLICK_FEEDBACK_MS);
    }

    private canUseSurfacePivot() {
        return (this.observer.get('camera.surfacePivot') ?? true) &&
            this.cameraControls.enabled &&
            this.cameraControls.mode === 'orbit' &&
            !this.activeSceneCamera &&
            !this.cameraFlyTransition &&
            !this.doubleClickZoomTransition &&
            !this.observer.get('measure.enabled') &&
            !this.observer.get('poi.enabled') &&
            !this.observer.get('debug.tilePick') &&
            !this.observer.get('fragment.selecting') &&
            !this.fragmentHandleDrag;
    }

    private getPickRay(x: number, y: number) {
        // Координаты идут в `screenToWorld` как есть, без пересчёта: движок меряет экран
        // через `device.clientRect`, а это `getBoundingClientRect()` канваса, то есть те же
        // CSS-пиксели, в которых приходит мышь. Любой пересчёт — в пиксели устройства или
        // цели рендера — уводит луч ровно во столько раз, каков масштаб; это и сбивало
        // привязку кружка к поверхности при `camera.pixelScale` больше единицы.
        const origin = this.camera.camera.screenToWorld(x, y, this.camera.camera.nearClip);
        const end = this.camera.camera.screenToWorld(x, y, this.camera.camera.farClip);
        const direction = end.sub(origin).normalize();
        return { origin, direction };
    }

    /** Enter cursor mode for choosing the center of a new fragment box. */
    beginFragmentSelection() {
        this.observer.set('fragment.enabled', false);
        this.observer.set('fragment.initialized', false);
        this.observer.set('fragment.selecting', true);
        this.observer.set('ui.active', 'fragment');
    }

    /** Toggle fragment picking, removing a pending green box when cancelled. */
    toggleFragmentSelection() {
        const selectionActive = this.observer.get('fragment.selecting') ||
            (this.observer.get('fragment.initialized') && !this.observer.get('fragment.enabled'));
        if (selectionActive) {
            this.resetFragmentView();
            this.observer.set('ui.active', null);
        } else {
            this.beginFragmentSelection();
        }
    }

    /** Remove the fragment box and restore the complete model. */
    resetFragmentView() {
        this.observer.set('fragment.enabled', false);
        this.observer.set('fragment.selecting', false);
        this.observer.set('fragment.initialized', false);
        this.updateFragmentGizmo();
        this.renderNextFrame();
    }

    /**
     * Toggle isolation using the live observer value at click time. Exiting isolation
     * only turns clipping off and KEEPS the box, so the user can tweak it or re-isolate;
     * dropping the box entirely is done via the SELECT FRAGMENT toggle (resetFragmentView).
     */
    toggleFragmentIsolation() {
        if (!this.observer.get('fragment.initialized')) return;
        if (this.observer.get('fragment.enabled')) {
            this.observer.set('fragment.enabled', false);
            this.updateFragmentGizmo();
            this.renderNextFrame();
        } else {
            this.observer.set('fragment.enabled', true);
        }
    }

    // Soft translucent fill for the fragment box, tinted with the active theme accent.
    //  DebugSolid packs colors as 0xAABBGGRR, so bytes are laid out A,B,G,R.
    private fragmentFillColor(): number {
        const color = normalizeThemeColor(this.observer.get('theme.primaryColor'));
        const r = Math.round(color.r * 255) & 0xff;
        const g = Math.round(color.g * 255) & 0xff;
        const b = Math.round(color.b * 255) & 0xff;
        const alpha = 0x30;
        return ((alpha << 24) | (b << 16) | (g << 8) | r) >>> 0;
    }

    /**
     * Place a camera-aligned medium box around the surface point under the cursor.
     * Its world size is derived from a stable fraction of the current viewport, so
     * the initial box feels similar at any zoom level.
     *
     * @param x - Horizontal coordinate inside the canvas.
     * @param y - Vertical coordinate inside the canvas.
     * @returns Whether a model surface was hit.
     */
    pickFragmentAt(x: number, y: number): boolean {
        const manager = this.tileManager;
        if (!manager) return false;
        const { origin, direction } = this.getPickRay(x, y);
        let bestDistance = Number.POSITIVE_INFINITY;
        manager.getVisibleMeshInstances().forEach((meshInstance) => {
            const distance = intersectMeshTriangles(
                meshInstance,
                origin,
                direction,
                bestDistance,
                this.meshGeometryCache
            );
            if (distance !== null && distance < bestDistance) bestDistance = distance;
        });
        if (!Number.isFinite(bestDistance)) return false;

        const hit = origin.clone().add(direction.clone().mulScalar(bestDistance));
        const rect = this.canvas.getBoundingClientRect();
        const camera = this.camera.camera;
        const aspect = Math.max(0.001, rect.width / Math.max(1, rect.height));
        const fovRadians = camera.fov * Math.PI / 180;
        const verticalFov = camera.horizontalFov ? 2 * Math.atan(Math.tan(fovRadians * 0.5) / aspect) : fovRadians;
        const cameraDistance = Math.max(camera.nearClip, hit.distance(this.camera.getPosition()));
        const worldPerPixel = 2 * cameraDistance * Math.tan(verticalFov * 0.5) / Math.max(1, rect.height);
        const screenSpan = Math.min(rect.width, rect.height) * 0.34;
        const minimumSize = Math.max(0.00001, this.sceneBounds.halfExtents.length() * 0.03);
        const size = Math.max(minimumSize, worldPerPixel * screenSpan);
        const cameraRotation = this.camera.getEulerAngles();

        this.observer.set('fragment.enabled', false);
        this.observer.set('fragment.center', [hit.x, hit.y, hit.z]);
        this.observer.set('fragment.size', [size, size, size * 0.8]);
        // Радиус сферы задаём тут же: размеры у форм свои, но появиться разумной должна и та,
        // которую пока не выбрали. Половина стороны бокса — сфера, вписанная в него.
        this.observer.set('fragment.radius', size / 2);
        // Keep the box upright: its horizontal faces stay parallel to the scene
        // ground while the heading still follows the current view.
        this.observer.set('fragment.rotation', [0, cameraRotation.y, 0]);
        this.observer.set('fragment.editMode', 'move');
        this.observer.set('fragment.initialized', true);
        this.observer.set('fragment.selecting', false);
        this.syncFragmentEntityFromObserver();
        this.updateFragmentGizmo();
        this.renderNextFrame();
        return true;
    }

    /**
     * Точный клик по видимой геометрии тайлов; координаты заданы в CSS-пикселях canvas.
     *
     * @param x - Горизонтальная координата внутри canvas.
     * @param y - Вертикальная координата внутри canvas.
     * @returns Данные выбранного тайла или `null`.
     */
    pickDebugTileAt(x: number, y: number): TileDebugInfo | null {
        const manager = this.tileManager;
        if (!manager) {
            return null;
        }
        const { origin, direction } = this.getPickRay(x, y);
        let bestMesh: MeshInstance | null = null;
        let bestDistance = Number.POSITIVE_INFINITY;
        manager.getVisibleMeshInstances().forEach((meshInstance) => {
            const distance = intersectMeshTriangles(
                meshInstance,
                origin,
                direction,
                bestDistance,
                this.meshGeometryCache
            );
            if (distance !== null && distance < bestDistance) {
                bestDistance = distance;
                bestMesh = meshInstance;
            }
        });
        const info = manager.setDebugPickedMeshInstance(bestMesh);
        this.renderNextFrame();
        return info;
    }

    /**
     * Capture only navigation gestures that resolved to an actual model surface.
     *
     * @param type - Orbit, pan or double-click zoom.
     * @param point - Resolved world-space point on the visible surface.
     */
    private recordSurfaceNavigationEvent(type: SurfaceNavigationEvent['type'], point: Vec3) {
        const manager = this.tileManager;
        if (!manager || !this.observer.get('debug.tileRecording')) return;
        const time = manager.getRecordingDuration();
        this.surfaceNavigationEvents.push({ type, time, point: point.clone() });
        this.tileReplayTimeline?.invalidate();
        this.renderNextFrame();
    }

    private activeSurfaceNavigationEvent(): SurfaceNavigationEvent | null {
        if (this.surfaceNavigationEvents.length === 0) return null;
        const replay = Number(this.observer.get('debug.tileReplay') ?? -1);
        // Recording captures the point but deliberately shows no overlay on the model.
        // Surface markers belong to replay, where the recorded camera and event time exist.
        if (this.observer.get('debug.tileRecording') || !this.observer.get('debug.tileFreeze') || replay < 0) return null;
        for (let i = this.surfaceNavigationEvents.length - 1; i >= 0; --i) {
            if (this.surfaceNavigationEvents[i].time <= replay) return this.surfaceNavigationEvents[i];
        }
        return null;
    }

    /** Draw a camera-facing circle at the surface point of the current replay event. */
    private drawSurfaceNavigationCursor() {
        const event = this.activeSurfaceNavigationEvent();
        if (!event) return;
        const point = event.point;
        const cameraWorld = this.camera.getWorldTransform();
        cameraWorld.getX(this.surfaceCursorRight).normalize();
        cameraWorld.getY(this.surfaceCursorUp).normalize();
        const height = Math.max(1, this.canvas.clientHeight);
        const distance = Math.max(this.camera.camera.nearClip, point.distance(this.camera.getPosition()));
        const radius = Math.max(
            this.sceneBounds.halfExtents.length() * 0.0005,
            distance * Math.tan(this.camera.camera.fov * Math.PI / 360) * 18 / height
        );
        // Lift the target a fraction towards the camera so it cannot z-fight with the picked surface.
        const center = this.surfaceCursorCenter.copy(this.camera.getPosition())
        .sub(point)
        .normalize()
        .mulScalar(radius * 0.08)
        .add(point);
        const color = event.type === 'pan' ? 0xff00d7ff : 0xffffffff;
        const outlineColor = 0xff101010;
        const baseRings = event.type === 'zoom' ? [1, 1.55] : [1];
        // Debug lines are one pixel wide. Closely spaced rings form a thicker colored band,
        // while the dark inner/outer edges keep white and yellow visible on light geometry.
        const rings = baseRings.flatMap(scale => [
            { scale: scale - 0.1, color: outlineColor },
            { scale: scale - 0.045, color },
            { scale, color },
            { scale: scale + 0.045, color },
            { scale: scale + 0.1, color: outlineColor }
        ]);
        rings.forEach((ring) => {
            const { scale } = ring;
            let previousX = 1;
            let previousY = 0;
            for (let i = 1; i <= 20; ++i) {
                const angle = i / 20 * Math.PI * 2;
                const x = Math.cos(angle);
                const y = Math.sin(angle);
                const previousRadiusX = previousX * radius * scale;
                const previousRadiusY = previousY * radius * scale;
                const radiusX = x * radius * scale;
                const radiusY = y * radius * scale;
                this.surfaceCursorA.set(
                    center.x + this.surfaceCursorRight.x * previousRadiusX + this.surfaceCursorUp.x * previousRadiusY,
                    center.y + this.surfaceCursorRight.y * previousRadiusX + this.surfaceCursorUp.y * previousRadiusY,
                    center.z + this.surfaceCursorRight.z * previousRadiusX + this.surfaceCursorUp.z * previousRadiusY
                );
                this.surfaceCursorB.set(
                    center.x + this.surfaceCursorRight.x * radiusX + this.surfaceCursorUp.x * radiusY,
                    center.y + this.surfaceCursorRight.y * radiusX + this.surfaceCursorUp.y * radiusY,
                    center.z + this.surfaceCursorRight.z * radiusX + this.surfaceCursorUp.z * radiusY
                );
                this.debugSurfaceCursor.line(this.surfaceCursorA, this.surfaceCursorB, ring.color);
                previousX = x;
                previousY = y;
            }
        });
    }

    /**
     * Информация о выбранном кликом тайле для консоли, HUD и автотестов.
     *
     * @returns Актуальные данные выбранного тайла или `null`.
     */
    getPickedTileInfo(): TileDebugInfo | null {
        return this.tileManager?.getDebugPickedTileInfo() ?? null;
    }

    clearMeasurement() {
        if (this.measurementController) {
            this.measurementController.clearMeasurement();
            return;
        }
        this.observer.set('measure.pointCount', 0);
        this.observer.set('measure.lastDistance', null);
        this.observer.set('measure.knownDistanceWarning', false);
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this.tileReplayTimeline?.destroy();
        this.tileReplayTimeline = null;
        this.fragmentClipMaterials.clear();
        this.fragmentTranslateGizmo?.destroy();
        this.fragmentScaleGizmo?.destroy();
        this.fragmentRotateGizmo?.destroy();
        this.dimensionBoxScaleGizmo?.destroy();
        this.fragmentBoxEntity?.destroy();
        this.dimensionBoxEntity?.destroy();
        this.fragmentHandleLayer?.querySelectorAll<HTMLButtonElement>('.fragment-face-handle').forEach((handle) => {
            handle.removeEventListener('pointerdown', this.onFragmentHandlePointerDown);
        });
        this.fragmentHandleLayer?.remove();
        document.removeEventListener('pointermove', this.onFragmentHandlePointerMove);
        document.removeEventListener('pointerup', this.onFragmentHandlePointerUp);
        document.removeEventListener('pointercancel', this.onFragmentHandlePointerUp);
        this.measurementController?.dispose?.();
        this.poiController?.dispose?.();
        this.selectionController?.dispose?.();
        this.surfacePivotController?.dispose?.();
        this.microphoneController?.dispose?.();
        this.canvas.removeEventListener('mousedown', this.onTilePickMouseDown);
        document.removeEventListener('mousemove', this.onTilePickMouseMove);
        document.removeEventListener('mouseup', this.onTilePickMouseUp);
    }

    /**
     * Camera that actually draws the viewport (glTF scene camera or viewer camera).
     *
     * @returns Активная камера кадра.
     */
    private getRenderingCamera(): CameraComponent {
        return this.activeSceneCamera ?? this.camera.camera;
    }

    /** Multiframe jitters the camera that actually draws, so it must follow camera switches. */
    private syncMultiframeCamera(): void {
        if (this.multiframe) {
            this.multiframe.camera = this.getRenderingCamera();
        }
    }

    /**
     * True only when CameraFrame needs to exist; the legacy path stays allocation-free.
     *
     * @returns Whether an effect backed by CameraFrame is active.
     */
    private isPostProcessingRequested(): boolean {
        return this.observer.get('camera.taa') === true ||
            this.observer.get('camera.ssao') === true ||
            this.colorLutTexture !== null;
    }

    private destroyPostProcessingFrame(): void {
        if (this.postProcessingCamera && this.postProcessingOriginalClearColor) {
            this.postProcessingCamera.clearColor = this.postProcessingOriginalClearColor;
        }
        this.postProcessingFrame?.destroy();
        this.postProcessingFrame = null;
        this.postProcessingCamera = null;
        this.postProcessingTarget = null;
        this.postProcessingOriginalClearColor = null;
    }

    /**
     * Keep the optional PlayCanvas CameraFrame attached to the camera that actually renders.
     * CameraFrame captures the destination render target while it is constructed, so a camera
     * switch or target resize requires a fresh instance. Property-only changes use update().
     */
    private syncPostProcessingFrame(): void {
        if (!this.isPostProcessingRequested()) {
            this.destroyPostProcessingFrame();
            return;
        }

        const camera = this.getRenderingCamera();
        const target = camera.renderTarget;
        if (!target) return;

        if (!this.postProcessingFrame || this.postProcessingCamera !== camera || this.postProcessingTarget !== target) {
            this.destroyPostProcessingFrame();
            this.postProcessingOriginalClearColor = camera.clearColor.clone();
            this.postProcessingFrame = new CameraFrame(this.app, camera);
            this.postProcessingCamera = camera;
            this.postProcessingTarget = target;
        }

        const frame = this.postProcessingFrame;
        // CameraFrame's compose pass writes an opaque result. Our normal path leaves the canvas
        // transparent and shows the solid background through CSS, so feed that color into the
        // scene clear while CameraFrame is active instead of allowing an opaque black background.
        if (this.observer.get('skybox.background') === 'Solid Color') {
            const background = Viewer.sanitizeRgb(this.observer.get('skybox.backgroundColor'), { r: 0.5, g: 0.5, b: 0.5 });
            camera.clearColor = new Color(background.r, background.g, background.b, 1);
        }
        const taa = this.observer.get('camera.taa') === true;
        const maxSamples = Number((this.app.graphicsDevice as GraphicsDevice & { maxSamples?: number }).maxSamples ?? 1);
        frame.rendering.samples = !taa && this.observer.get('camera.multisample') ? maxSamples : 1;
        frame.rendering.toneMapping = camera.toneMapping;
        // RCAS remains our final, existing sharpening pass. Running both sharpeners would create halos.
        frame.rendering.sharpness = 0;
        frame.taa.enabled = taa;
        frame.ssao.type = this.observer.get('camera.ssao') === true ? SSAOTYPE_COMBINE : SSAOTYPE_NONE;
        frame.ssao.intensity = Math.max(0, Math.min(1, Number(this.observer.get('camera.ssaoIntensity')) || 0));
        frame.ssao.radius = Math.max(1, Math.min(100, Number(this.observer.get('camera.ssaoRadius')) || 30));
        frame.colorLUT.texture = this.colorLutTexture;
        frame.colorLUT.intensity = Math.max(0, Math.min(1, Number(this.observer.get('camera.colorLutIntensity')) || 0));
        frame.update();
    }

    removePoi(id: string) {
        this.poiController?.removePoi(id);
    }

    updatePoiTitle(id: string, title: string) {
        this.poiController?.updatePoiTitle(id, title);
    }

    updatePoiDescription(id: string, description: string) {
        this.poiController?.updatePoiDescription(id, description);
    }

    updatePoiColor(id: string, color: string) {
        this.poiController?.updatePoiColor(id, color);
    }

    updatePoiDuration(id: string, duration: number) {
        this.poiController?.updatePoiDuration(id, duration);
    }

    updatePoiHoldTime(id: string, holdTime: number) {
        this.poiController?.updatePoiHoldTime(id, holdTime);
    }

    updatePoiTrigger(id: string, trigger: boolean) {
        this.poiController?.updatePoiTrigger(id, trigger);
    }

    updatePoiSystemName(id: string, systemName: string) {
        this.poiController?.updatePoiSystemName(id, systemName);
    }

    updatePoiAnimClip(id: string, value: string) {
        this.poiController?.updatePoiAnimClip(id, value);
    }

    updatePoiAnimFrom(id: string, value: number | null) {
        this.poiController?.updatePoiAnimFrom(id, value);
    }

    updatePoiAnimTo(id: string, value: number | null) {
        this.poiController?.updatePoiAnimTo(id, value);
    }

    updatePoiAnimFps(id: string, value: number | null) {
        this.poiController?.updatePoiAnimFps(id, value);
    }

    capturePoiCameraView(id: string) {
        this.poiController?.capturePoiCameraView(id);
        this.poiController?.pulsePoi(id);
        this.flashCaptureView();
    }

    clearPoiCameraView(id: string) {
        this.poiController?.clearPoiCameraView(id);
    }

    focusPoi(id: string) {
        this.poiController?.focusPoi(id);
    }

    clearFocusedPoi() {
        this.poiController?.clearFocusedPoi();
    }

    focusNextPoi() {
        this.poiController?.focusNextPoi();
    }

    focusPrevPoi() {
        this.poiController?.focusPrevPoi();
    }

    reorderPoi(sourceId: string, targetId: string) {
        this.poiController?.reorderPoi(sourceId, targetId);
    }

    pulsePois() {
        this.poiController?.pulseMarkers();
    }

    /**
     * Пульснуть конкретный маркер (напр. реакция зоны-триггера на ноту).
     *
     * @param id - Идентификатор точки интереса.
     */
    pulsePoi(id: string) {
        this.poiController?.pulsePoi(id);
    }

    clearPois() {
        this.poiController?.clearPois();
    }

    private flashCaptureView() {
        if (!this.captureFlashEl) {
            return;
        }
        this.captureFlashEl.classList.remove('active');
        const { offsetWidth } = this.captureFlashEl;
        if (offsetWidth < 0) return;
        this.captureFlashEl.classList.add('active');
    }

    /** Recalibrate unitScale: user measured two points and knows the real-world distance. Sets unitScale so that lastDistance matches knownDistance. */
    recalculateSceneSize() {
        this.measurementController?.recalculateSceneSize();
    }

    private getSelectedMeshInstances() {
        return this.selectedNode ? this.collectMeshInstances(this.selectedNode as Entity) : this.meshInstances;
    }

    // collects all mesh instances from entity hierarchy
    private collectMeshInstances(entity: Entity) {
        const meshInstances: Array<MeshInstance> = [];
        if (entity) {
            const components = entity.findComponents('render');
            for (let i = 0; i < components.length; i++) {
                const render = components[i] as RenderComponent;
                if (render.meshInstances) {
                    for (let m = 0; m < render.meshInstances.length; m++) {
                        const meshInstance = render.meshInstances[m];
                        meshInstances.push(meshInstance);
                    }
                }
            }

            // Unified gsplat components render through the engine's gsplat director and expose no
            // MeshInstance, so they never appear in this list. Splat bounds come from
            // GSplatComponent#customAabb instead (see calcSceneBounds).
        }
        return meshInstances;
    }

    // calculate the bounding box of the given mesh
    private static calcMeshBoundingBox(result: BoundingBox, meshInstances: Array<MeshInstance>) {
        if (meshInstances.length > 0) {
            result.copy(meshInstances[0].aabb);
            for (let i = 1; i < meshInstances.length; ++i) {
                result.add(meshInstances[i].aabb);
            }
        }
    }

    // calculate the bounding box of the graph-node hierarchy
    private static calcHierBoundingBox(result: BoundingBox, rootNode: Entity) {
        const position = rootNode.getPosition();
        let min_x = position.x;
        let min_y = position.y;
        let min_z = position.z;
        let max_x = position.x;
        let max_y = position.y;
        let max_z = position.z;

        const recurse = (node: GraphNode) => {
            const p = node.getPosition();
            min_x = Math.min(min_x, p.x);
            min_y = Math.min(min_y, p.y);
            min_z = Math.min(min_z, p.z);

            max_x = Math.max(max_x, p.x);
            max_y = Math.max(max_y, p.y);
            max_z = Math.max(max_z, p.z);

            for (let i = 0; i < node.children.length; ++i) {
                recurse(node.children[i]);
            }
        };
        recurse(rootNode);

        result.setMinMax(new Vec3(min_x, min_y, min_z), new Vec3(max_x, max_y, max_z));
    }

    // construct the controls interface and initialize controls
    private bindControlEvents() {
        const controlEvents: Record<string, (...args: unknown[]) => void> = {
            'ui.active': (active: string | null) => {
                if (active !== 'fragment' && this.observer.get('fragment.selecting')) {
                    this.observer.set('fragment.selecting', false);
                }
                this.updateFragmentGizmo();
                // Куб и переключатель проекции живут вместе с панелью изолированного просмотра.
                this.updateViewCubeVisibility();
            },
            // camera
            'camera.fov': this.setFov.bind(this),
            'camera.tonemapping': this.setTonemapping.bind(this),
            'camera.pixelScale': () => {
                this.canvasResize = true;
                this.renderNextFrame();
            },
            'camera.easu': (enabled: boolean) => {
                this.multiframe.easu = enabled !== false;
                this.renderNextFrame();
            },
            'camera.sharpness': (value: number) => {
                // RCAS сам ограничивает силу фильтра, поэтому проверять диапазон незачем —
                // достаточно не пустить отрицательное, которое означало бы размытие.
                this.multiframe.sharpness = Math.max(0, Number(value) || 0);
                this.renderNextFrame();
            },
            'camera.taa': (enabled: boolean) => {
                // TAA and MSAA are alternative AA paths here. Keeping both only pays twice.
                if (enabled && this.observer.get('camera.multisample')) {
                    this.observer.set('camera.multisample', false);
                }
                this.multiframe.enabled = this.observer.get('camera.hq') && !enabled;
                this.destroyRenderTargets();
                this.renderNextFrame();
            },
            'camera.ssao': () => {
                this.destroyRenderTargets();
                this.renderNextFrame();
            },
            'camera.ssaoIntensity': () => {
                this.renderNextFrame();
            },
            'camera.ssaoRadius': () => {
                this.renderNextFrame();
            },
            'camera.colorLutIntensity': () => {
                this.renderNextFrame();
            },
            'camera.colorLutName': (name: string) => {
                // Settings files cannot embed a local image. Clearing/resetting the name releases
                // the current texture; a non-empty imported name alone never pretends to load one.
                if (!name && this.colorLutTexture) {
                    this.releaseColorLut();
                    this.destroyRenderTargets();
                }
                this.renderNextFrame();
            },
            'camera.multisample': (enabled: boolean) => {
                if (enabled && this.observer.get('camera.taa')) {
                    this.observer.set('camera.taa', false);
                }
                this.destroyRenderTargets();
                this.renderNextFrame();
            },
            'camera.distanceLimitsManual': () => {
                this.applyDistanceLimits(this.distanceLimitSceneSize);
                this.renderNextFrame();
            },
            'camera.distanceMin': () => {
                if (this.observer.get('camera.distanceLimitsManual') !== true) return;
                this.applyDistanceLimits(this.distanceLimitSceneSize);
                this.renderNextFrame();
            },
            'camera.distanceMax': () => {
                if (this.observer.get('camera.distanceLimitsManual') !== true) return;
                this.applyDistanceLimits(this.distanceLimitSceneSize);
                this.renderNextFrame();
            },
            'camera.hq': (enabled: boolean) => {
                this.multiframe.enabled = enabled && this.observer.get('camera.taa') !== true;
                // SD — это не только выключенное накопление. Мультифрейм работает лишь на
                // неподвижной камере, поэтому сам по себе он не влияет на плавность
                // вращения; кадры на телефоне даёт именно половинное разрешение сцены.
                // Ручной выбор в «Масштабе пикселя» этим переключателем сбрасывается — HD и
                // SD задают режим целиком, иначе две настройки противоречили бы друг другу.
                this.observer.set('camera.pixelScale', enabled ? 1 : SD_PIXEL_SCALE);
                // Сглаживание по сэмплам — тоже часть цены кадра, и в SD ему делать нечего.
                if (this.observer.get('camera.multisampleSupported')) {
                    this.observer.set('camera.multisample', enabled);
                }
                this.renderNextFrame();
            },
            'camera.mode': (mode: CameraMode) => {
                this.cameraControls.mode = mode;
            },
            'camera.flySpeed': (speed: number) => {
                this.cameraControls.flySpeed = Math.max(0.1, Math.min(5, Number(speed) || 1));
            },
            'camera.mouseButtonsInverted': (inverted: boolean) => {
                this.surfacePivotController?.reset();
                this.cameraControls.mouseButtonsInverted = inverted;
            },

            // skybox
            'skybox.value': (value: string) => {
                if (this.skyboxUrls.has(value)) {
                    const url = this.skyboxUrls.get(value);
                    this.loadFiles([{ url, filename: url }]);
                } else if (value === 'None') {
                    this.clearSkybox();
                } else {
                    this.loadFiles([{ url: value, filename: value }]);
                }
            },
            'skybox.blur': this.setSkyboxBlur.bind(this),
            'skybox.exposure': this.setSkyboxExposure.bind(this),
            'skybox.rotation': this.setSkyboxRotation.bind(this),
            'skybox.background': this.setSkyboxBackground.bind(this),
            'skybox.backgroundColor': this.setBackgroundColor.bind(this),
            'skybox.domeProjection.domeRadius': this.setSkyboxDomeRadius.bind(this),
            'skybox.domeProjection.tripodOffset': this.setSkyboxTripodOffset.bind(this),

            // light
            'light.enabled': this.setLightEnabled.bind(this),
            'light.intensity': this.setLightIntensity.bind(this),
            'light.color': this.setLightColor.bind(this),
            'light.follow': this.setLightFollow.bind(this),
            'light.shadow': this.setLightShadow.bind(this),

            // shadow catcher
            'shadowCatcher.enabled': this.setShadowCatcherEnabled.bind(this),
            'shadowCatcher.intensity': this.setShadowCatcherIntensity.bind(this),
            'shadowCatcher.heightOffset': this.setShadowCatcherHeightOffset.bind(this),

            // Exact temporary fragment clipping box.
            'fragment.enabled': (enabled: boolean) => {
                if (enabled) {
                    if (this.observer.get('fragment.selecting')) this.observer.set('fragment.selecting', false);
                    if (!this.observer.get('fragment.initialized')) this.resetFragmentBox();
                    if (this.observer.get('measure.enabled')) this.observer.set('measure.enabled', false);
                    if (this.observer.get('poi.enabled')) this.observer.set('poi.enabled', false);
                    if (this.observer.get('debug.tilePick')) this.observer.set('debug.tilePick', false);
                    if (this.observer.get('debug.alignmentMode')) this.observer.set('debug.alignmentMode', false);
                    this.syncFragmentEntityFromObserver();
                    this.syncFragmentClipping();
                } else {
                    this.fragmentClipMaterials.clear();
                    this.tileManager?.setClipBox(null);
                }
                this.updateFragmentGizmo();
                this.renderNextFrame();
            },
            'fragment.selecting': (selecting: boolean) => {
                if (selecting) {
                    if (this.observer.get('fragment.enabled')) this.observer.set('fragment.enabled', false);
                    if (this.observer.get('measure.enabled')) this.observer.set('measure.enabled', false);
                    if (this.observer.get('poi.enabled')) this.observer.set('poi.enabled', false);
                    if (this.observer.get('debug.tilePick')) this.observer.set('debug.tilePick', false);
                }
                this.updatePickCursor();
                this.updateFragmentGizmo();
                this.renderNextFrame();
            },
            'fragment.invert': () => this.syncFragmentClipping(),
            // Подсветка контура живёт в параметрах материалов, которые обновляются в кадре:
            // без запроса кадра переключатель не дал бы видимого эффекта.
            'fragment.outline': () => this.renderNextFrame(),
            'fragment.outlineWidth': () => this.renderNextFrame(),
            'fragment.center': () => {
                this.syncFragmentEntityFromObserver();
                this.syncFragmentClipping();
            },
            'fragment.size': () => {
                this.syncFragmentEntityFromObserver();
                this.syncFragmentClipping();
            },
            'fragment.shape': () => {
                this.syncFragmentEntityFromObserver();
                this.syncFragmentClipping();
                this.renderNextFrame();
            },
            'fragment.radius': () => {
                this.syncFragmentEntityFromObserver();
                this.syncFragmentClipping();
                this.renderNextFrame();
            },
            'fragment.rotation': () => {
                this.syncFragmentEntityFromObserver();
                this.syncFragmentClipping();
            },
            'fragment.editMode': () => {
                this.updateFragmentGizmo();
                this.renderNextFrame();
            },
            'fragment.initialized': () => {
                this.updateFragmentGizmo();
                this.renderNextFrame();
            },

            // debug
            'debug.stats': this.setDebugStats.bind(this),
            'debug.wireframe': this.setDebugWireframe.bind(this),
            'debug.wireframeColor': this.setWireframeColor.bind(this),
            'debug.bounds': this.setDebugBounds.bind(this),
            'debug.skeleton': this.setDebugSkeleton.bind(this),
            'debug.axes': this.setDebugAxes.bind(this),
            'debug.grid': this.setDebugGrid.bind(this),
            'debug.alignmentMode': this.setAlignmentMode.bind(this),
            'debug.alignmentGizmoMode': this.setAlignmentGizmoMode.bind(this),
            'debug.alignmentTarget': () => this.setAlignmentGizmoMode(this.observer.get('debug.alignmentGizmoMode') ?? 'rotate'),
            'debug.normals': this.setNormalLength.bind(this),
            'debug.uvCheckerScale': this.setUvCheckerScale.bind(this),
            'debug.selectedUvSet': this.setSelectedUvSet.bind(this),
            'debug.withTextureOnly': () => {
                const enabled = !!this.observer.get('debug.withTextureOnly');
                // `By objects` is a scoped inspection mode. Keeping the old node after
                // leaving it made material names/channels continue to come from that node,
                // and could leave the same stale path selected after another model load.
                if (!enabled && (this.selectedNode || this.observer.get('scene.selectedNode.path'))) {
                    this.observer.set('scene.selectedNode.path', '');
                }
                this.dirtySelectionHighlight = true;
                this.dirtyTexelDensityHeatmap = true;
                this.renderNextFrame();
            },
            'debug.texelDensityHeatmap': () => {
                this.dirtyTexelDensityHeatmap = true;
                this.renderNextFrame();
            },
            'debug.renderMode': this.setRenderMode.bind(this),
            'debug.gsplatLodColor': (enabled: boolean) => {
                // Движок нумерует GSplat от тонкого L0 к грубому Lmax, а 3D Tiles —
                // наоборот. Патчим getter до того, как dirty-флаг перекрасит work buffer.
                this.syncGSplatLodDebugPalette();
                this.app.scene.gsplat.colorizeLod = enabled;
                this.renderNextFrame();
            },
            'debug.tileLodColor': () => this.renderNextFrame(),
            // Подписи рисует оверлей поверх кадра, а кадр рисуется по требованию. Без этих
            // трёх строк включённые подписи не появлялись, пока не тронешь камеру.
            'debug.tileReplay': () => this.applyTileReplay(),
            'debug.tileOrderLabels': () => this.renderNextFrame(),
            'debug.tileIdLabels': () => this.renderNextFrame(),
            'debug.tileOrderPerLod': () => this.renderNextFrame(),
            'debug.gsplatNodeBounds': () => this.renderNextFrame(),
            'debug.gsplatDebugMode': () => this.renderNextFrame(),
            'debug.gsplatFreeze': (enabled: boolean) => {
                if (enabled) {
                    if (!this.observer.get('debug.gsplatPaused')) {
                        this.observer.set('debug.gsplatPaused', true);
                    }
                    this.captureGSplatLodCamera();
                    this.captureFrozenTileCamera(true, false);
                    this.enterFrozenTileCameraInspector();
                } else {
                    this.restoreFrozenTileCameraView();
                    this.captureFrozenTileCamera(false, false);
                    this.gsplatFrozenLodCamera = null;
                    this.syncGSplatStreamingDebugControls();
                }
                this.renderNextFrame();
            },
            'debug.gsplatPaused': () => {
                this.syncGSplatStreamingDebugControls();
                this.renderNextFrame();
            },
            // Отладка тайлов: отрисовка не gated dirty-флагом (onPrerender читает флаги живьём),
            // поэтому достаточно попросить кадр — там оверлей либо нарисуется, либо очистится.
            'debug.tileDebug': (enabled: boolean) => {
                if (!enabled && this.observer.get('debug.tilePick')) {
                    this.observer.set('debug.tilePick', false);
                }
                this.updateViewCubeVisibility();
                this.renderNextFrame();
            },
            'debug.tileDebugMode': () => this.renderNextFrame(),
            'debug.tileLineThickness': () => this.renderNextFrame(),
            'debug.tileLineStyle': () => this.renderNextFrame(),
            'debug.tileCheckerFill': () => this.renderNextFrame(),
            'debug.tilePick': (enabled: boolean) => {
                if (enabled) {
                    if (this.observer.get('measure.enabled')) this.observer.set('measure.enabled', false);
                    if (this.observer.get('poi.enabled')) this.observer.set('poi.enabled', false);
                    if (this.observer.get('debug.withTextureOnly')) this.observer.set('debug.withTextureOnly', false);
                } else {
                    if (this.observer.get('debug.tileIsolatePick')) {
                        this.observer.set('debug.tileIsolatePick', false);
                    }
                    this.tileManager?.setDebugPickedMeshInstance(null);
                }
                this.updatePickCursor();
                this.renderNextFrame();
            },
            'debug.tileIsolatePick': (enabled: boolean) => {
                this.tileManager?.setDebugIsolatePicked(enabled);
                this.renderNextFrame();
            },
            // Запись — пользовательское состояние поверх прежнего механизма заморозки:
            // Start очищает эпизод и возвращает живой стриминг, Stop фиксирует его и
            // открывает таймлайн. Сам tileFreeze остаётся внутренним режимом просмотра.
            'debug.tileRecording': (recording: boolean) => {
                if (this.closingTileDebugMode) return;
                if (recording) {
                    this.startTileReplayRecording();
                } else {
                    this.stopTileReplayRecording();
                }
                this.renderNextFrame();
            },
            'debug.tileFreeze': (value: boolean) => {
                if (value) {
                    // Заморозка извне тоже означает конец записи. При штатном Stop флаг уже
                    // снят, поэтому повторного перехода не будет.
                    if (this.observer.get('debug.tileRecording')) {
                        this.observer.set('debug.tileRecording', false);
                    }
                    // Freeze is intended as an inspectable snapshot: stop dispatching new
                    // tile requests by default. Pause remains independent afterwards, so
                    // the user can resume loading while keeping the frozen camera.
                    if (!this.observer.get('debug.tilePaused')) {
                        this.observer.set('debug.tilePaused', true);
                    }
                    this.captureFrozenTileCamera(true);
                    this.tileManager?.setFrozen(true);
                    this.enterFrozenTileCameraInspector();
                } else {
                    // Перемотка живёт только внутри заморозки: без неё история растёт под
                    // рукой, и у шкалы нет ни начала, ни конца. Снимаем её вместе с
                    // заморозкой — иначе сцена осталась бы отмотанной, а ползунка, которым это
                    // было сделано, на панели уже нет.
                    this.observer.set('debug.tileReplay', -1);
                    this.restoreFrozenTileCameraView();
                    this.tileManager?.setFrozen(false);
                    this.captureFrozenTileCamera(false);
                }
                this.updateViewCubeVisibility();
                this.renderNextFrame();
            },
            'debug.tilePaused': (value: boolean) => {
                this.tileManager?.setPaused(value);
                this.renderNextFrame();
            },
            'debug.tileLodLock': () => this.applyTileLodIsolate(),
            'debug.tileLodLevel': () => this.applyTileLodIsolate(),

            // animation
            'animation.playing': (playing: boolean) => {
                if (playing) {
                    // Ручной play не ограничен диапазоном POI-триггера.
                    this.animStopTime = null;
                    this.play();
                } else {
                    this.stop();
                }
            },
            'animation.selectedTrack': this.setSelectedTrack.bind(this),
            'animation.speed': this.setSpeed.bind(this),
            'animation.transition': this.setTransition.bind(this),
            'animation.loops': this.setLoops.bind(this),
            'animation.progress': this.setAnimationProgress.bind(this),

            'scene.selectedNode.path': this.setSelectedNode.bind(this),
            'scene.variant.selected': this.setSelectedVariant.bind(this),
            'scene.selectedCamera': this.setSelectedCamera.bind(this),

            centerScene: this.setCenterScene.bind(this),

            // measurements
            'measure.enabled': (enabled: boolean) => {
                this.canvas.style.cursor = enabled ? 'crosshair' : '';
                this.renderNextFrame();
            },
            'measure.mode': () => {
                // Switching tools resets only the in-progress draft; completed measurements stay visible.
                this.measurementController?.cancelDraft();
            },
            'poi.enabled': (enabled: boolean) => {
                if (enabled) {
                    if (this.observer.get('measure.enabled')) {
                        this.observer.set('measure.enabled', false);
                    }
                    if (this.observer.get('debug.withTextureOnly')) {
                        this.observer.set('debug.withTextureOnly', false);
                    }
                } else if (this.poiObserverMode) {
                    this.setPoiObserverMode(false);
                }
                this.canvas.style.cursor = enabled ? 'crosshair' : '';
                this.renderNextFrame();
            },
            'measure.unit': () => {
                this.updateTexelDensityStats();
                this.renderNextFrame();
            },
            'measure.unitScale': () => {
                this.configureWalkScale();
                this.updateTexelDensityStats();
                this.renderNextFrame();
            },
            'measure.knownDistance': () => {
                this.measurementController?.limitToLatestKnownDistanceSegment();
            },
            'dimensionBox.enabled': () => {
                this.dirtyBounds = true;
                this.setAlignmentGizmoMode(this.observer.get('debug.alignmentGizmoMode') ?? 'rotate');
                this.renderNextFrame();
            },
            'dimensionBox.size': () => {
                this.syncDimensionBoxEntityFromObserver();
                this.dirtyBounds = true;
                this.renderNextFrame();
            },
            'dimensionBox.center': () => {
                this.syncDimensionBoxEntityFromObserver();
                this.dirtyBounds = true;
                this.renderNextFrame();
            },
            'dimensionBox.rotation': () => {
                this.syncDimensionBoxEntityFromObserver();
                this.dirtyBounds = true;
                this.renderNextFrame();
            },
            'helpers.visible': () => {
                this.renderNextFrame();
            },
            'helpers.editable': () => {
                this.setAlignmentGizmoMode(this.observer.get('debug.alignmentGizmoMode') ?? 'rotate');
                this.renderNextFrame();
            },
            'helpers.group': () => {
                this.renderNextFrame();
            },
            'helpers.activeId': (id: string) => {
                this.selectHelper(id || null);
            }
        };

        // store control event keys
        this.controlEventKeys = Object.keys(controlEvents);

        // register control events
        this.controlEventKeys.forEach((e) => {
            this.observer.on(`${e}:set`, controlEvents[e]);
        });
    }

    private reloadSettings() {
        this.controlEventKeys.forEach((e) => {
            this.observer.set(e, this.observer.get(e), false, false, true);
        });
        this.syncMultiframeCamera();
        this.renderNextFrame();
    }

    private clearSkybox() {
        this.app.scene.envAtlas = null;
        this.app.scene.setSkybox(null);
        this.renderNextFrame();
        this.skyboxLoaded = false;
    }

    // initialize the faces and prefiltered lighting data from the given
    // skybox texture, which is either a cubemap or equirect texture.
    private initSkybox(source: Texture) {
        const skybox = EnvLighting.generateSkyboxCubemap(source);
        const lighting = EnvLighting.generateLightingSource(source);
        // The second options parameter should not be necessary but the TS declarations require it for now
        const envAtlas = EnvLighting.generateAtlas(lighting, {});
        lighting.destroy();
        this.app.scene.envAtlas = envAtlas;
        this.app.scene.skybox = skybox;

        this.renderNextFrame();
    }

    // load the image files into the skybox. this function supports loading a single equirectangular
    // skybox image or 6 cubemap faces.
    private loadSkybox(files: Array<File>) {
        const app = this.app;

        if (files.length !== 6) {
            // load equirectangular skybox
            const textureAsset = new Asset('skybox_equi', 'texture', {
                url: files[0].url,
                filename: files[0].filename
            });
            textureAsset.ready(() => {
                const texture = textureAsset.resource as Texture;
                if (texture.type === TEXTURETYPE_DEFAULT && texture.format === PIXELFORMAT_RGBA8) {
                    // assume RGBA data (pngs) are RGBM
                    texture.type = TEXTURETYPE_RGBM;
                }
                this.initSkybox(texture);

                // if we don't unload the texture asset and user selects it a second time, the
                // brightness is completely wrong.
                textureAsset.unload();
                app.assets.remove(textureAsset);
            });
            app.assets.add(textureAsset);
            app.assets.load(textureAsset);
        } else {
            // sort files into the correct order based on filename
            const names = [
                ['posx', 'negx', 'posy', 'negy', 'posz', 'negz'],
                ['px', 'nx', 'py', 'ny', 'pz', 'nz'],
                ['right', 'left', 'up', 'down', 'front', 'back'],
                ['right', 'left', 'top', 'bottom', 'forward', 'backward'],
                ['0', '1', '2', '3', '4', '5']
            ];

            const getOrder = (filename: string) => {
                const fn = filename.toLowerCase();
                for (let i = 0; i < names.length; ++i) {
                    const nameList = names[i];
                    for (let j = 0; j < nameList.length; ++j) {
                        if (fn.indexOf(`${nameList[j]}.`) !== -1) {
                            return j;
                        }
                    }
                }
                return 0;
            };

            const sortPred = (first: File, second: File) => {
                const firstOrder = getOrder(first.filename);
                const secondOrder = getOrder(second.filename);
                return firstOrder < secondOrder ? -1 : secondOrder < firstOrder ? 1 : 0;
            };

            files.sort(sortPred);

            // construct an asset for each cubemap face
            const faceAssets = files.map((file, index) => {
                const faceAsset = new Asset(`skybox_face${index}`, 'texture', file);
                app.assets.add(faceAsset);
                app.assets.load(faceAsset);
                return faceAsset;
            });

            // construct the cubemap asset
            const cubemapAsset = new Asset('skybox_cubemap', 'cubemap', null, {
                textures: faceAssets.map(faceAsset => faceAsset.id)
            });
            cubemapAsset.loadFaces = true;
            cubemapAsset.on('load', () => {
                this.initSkybox(cubemapAsset.resource as Texture);
            });
            app.assets.add(cubemapAsset);
            app.assets.load(cubemapAsset);
        }
        this.skyboxLoaded = true;
    }

    private getCanvasSize() {
        const s = this.canvas.getBoundingClientRect();
        return {
            width: s.width,
            height: s.height
        };
    }

    private calcFocalPoint(bbox: BoundingBox) {
        const point = new Vec3();
        if (this.initialCameraFocus) {
            point.copy(this.initialCameraFocus);
            this.initialCameraFocus = null;
        } else {
            const entityAsset = this.entityAssets[0];
            const splatData = (entityAsset?.asset?.resource as GSplatResource)?.gsplatData as GSplatData;
            if (splatData) {
                splatData.calcFocalPoint(point, () => true);
                entityAsset.entity.getWorldTransform().transformPoint(point, point);
            } else {
                point.copy(bbox.center);
            }
        }
        return point;
    }

    private calcZoom(sceneSize: number, forceAspectRatio?: number) {
        const camera = this.camera.camera;
        const d1 = Math.tan(0.5 * FOCUS_FOV * math.DEG_TO_RAD);
        const d2 = Math.tan(0.5 * camera.fov * math.DEG_TO_RAD);
        const aspect = forceAspectRatio ?? camera.aspectRatio;

        const scale = (d1 / d2) * (1 / aspect);
        return scale * sceneSize + sceneSize;
    }

    private focus(init: boolean, forceAspectRatio?: number) {
        // restore saved orbit camera position when loading
        if (init) {
            const toVec3 = (v: unknown): Vec3 | null => {
                if (!v || typeof v !== 'object') return null;
                const obj = v as Record<string, unknown>;
                const a = Array.isArray(v) ? v : ('0' in obj && '1' in obj && '2' in obj ? [obj[0], obj[1], obj[2]] : null);
                if (!a || a.length !== 3 || !a.every(Number.isFinite)) return null;
                return new Vec3(a[0], a[1], a[2]);
            };
            const pos = toVec3(this.observer.get('camera.position'));
            const f = toVec3(this.observer.get('camera.focus'));
            if (pos && f) {
                this.initialCameraPosition = pos;
                this.initialCameraFocus = f;
            }
        }

        // calculate scene bounding box
        // Для тайлсета кадрируем по реальной загруженной геометрии, а не по корневому
        // bounding volume: у 3D Tiles корневой объём обычно заметно больше и смещён
        // относительно самой модели, из-за чего «вписать в экран» загоняло геометрию
        // в угол. Явное кадрирование (F) — разовое действие, поэтому «прыганья» камеры
        // при стриминге LOD, ради которого calcSceneBounds берёт корневой объём, здесь нет.
        this.tileManager?.syncTransform();
        if (!(!this.selectedNode && this.tileManager?.getGeometryBounds(bbox))) {
            this.calcSceneBounds(bbox, this.selectedNode as Entity);
        }

        // calculate scene size
        const sceneSize = bbox.halfExtents.length();
        this.cameraControls.moveSpeed = sceneSize * 2.5;
        this.configureWalkScale(sceneSize);
        this.applyDistanceLimits(sceneSize);

        // calculate the camera focal point
        const focus = this.calcFocalPoint(bbox);

        // calculate zoom
        const zoom = this.calcZoom(sceneSize, forceAspectRatio);

        // check for initial camera position
        if (this.initialCameraPosition) {
            const start = this.initialCameraPosition.clone();
            this.initialCameraPosition = null;

            this.cameraControls.reset(focus, start);
            return;
        }

        // focus the camera
        const forward = init ? Vec3.FORWARD : this.camera.forward;
        const start = forward.clone().mulScalar(-zoom).add(focus);
        this.cameraControls.reset(focus, start);
    }

    /**
     * Назначить цель рендера обеим камерам.
     *
     * @param rt - Цель рендера или `null`.
     */
    private assignRenderTarget(rt: RenderTarget | null) {
        this.camera.camera.renderTarget = rt;
        if (this.activeSceneCamera) {
            this.activeSceneCamera.renderTarget = rt;
        }
    }

    destroyRenderTargets() {
        // CameraFrame owns passes that point at the current target. Release them before the target.
        this.destroyPostProcessingFrame();
        // Придержанная цель другого размера живёт ровно до этого момента: её зовут при смене
        // мультисэмплинга и при сбросе, после которых запас всё равно не подошёл бы.
        if (this.spareRenderTarget) {
            this.spareRenderTarget.colorBuffer?.destroy();
            this.spareRenderTarget.depthBuffer?.destroy();
            this.spareRenderTarget.destroy();
            this.spareRenderTarget = null;
        }
        const rt = this.camera.camera.renderTarget;
        if (rt && this.activeSceneCamera && this.activeSceneCamera.renderTarget === rt) {
            this.activeSceneCamera.renderTarget = null;
        }
        if (rt) {
            rt.colorBuffer?.destroy();
            rt.depthBuffer?.destroy();
            rt.destroy();
            this.camera.camera.renderTarget = null;
        }
    }

    /**
     * Разрешение, в котором рисуется сцена.
     *
     * Отличается от разрешения бэкбуфера на `camera.pixelScale`: сцена рисуется мельче, а до
     * экрана её растягивает финальный проход `Multiframe`. Всё, что рассуждает о «пикселях
     * картинки» — экранная ошибка тайлов, пересчёт координат мыши в пиксели цели рендера —
     * должно спрашивать это, а не размер устройства.
     *
     * @returns Ширина и высота цели рендера в пикселях.
     */
    /**
     * Сообщить менеджеру тайлов, вокруг какого направления считать тайлы центральными.
     *
     * Режим выбирает пользователь. «Как раньше» — направления нет вовсе, порядок загрузки прежний.
     * Фовеальный — взгляд камеры. Курсорный — луч через указатель, но только пока указатель над
     * канвасом и недавно двигался; иначе откат к взгляду, потому что брошенный курсор не признак
     * внимания, а на сенсорном экране его нет вовсе.
     */
    private updateTileFocus() {
        if (!this.tileManager) return;

        const mode = String(this.observer.get('camera.tilePriority') ?? 'foveated');
        if (mode === 'default') {
            this.tileManager.focusDirection = null;
            return;
        }

        const pointer = this.pointerFocus;
        const pointerFresh = pointer.over && performance.now() - pointer.at < CURSOR_FOCUS_STALE_MS;

        // Опорная точка — то, вокруг чего вращают: сигнал внимания сильнее луча, но живёт он
        // только пока точка найдена. Нет её — откатываемся к лучу, а затем ко взгляду.
        if (mode === 'surface') {
            const point = this.cameraControls.surfaceZoomTarget;
            if (point) {
                const dir = point.clone().sub(this.camera.getPosition());
                if (dir.length() > 1e-6) {
                    this.tileManager.focusDirection = dir.normalize();
                    return;
                }
            }
        }

        if ((mode === 'cursor' || mode === 'surface') && pointerFresh) {
            this.tileManager.focusDirection = this.getPickRay(pointer.x, pointer.y).direction;
            return;
        }

        this.tileManager.focusDirection = this.camera.forward.clone();
    }

    /**
     * Отметить движение камеры, сравнив её положение с предыдущим кадром.
     *
     * Сравниваем именно матрицу, а не причину перерисовки: `renderNextFrame` зовут и правки
     * интерфейса, и мини-статистика, и от них ронять разрешение незачем.
     */
    private updateCameraMotion() {
        const m = this.camera.getWorldTransform().data;
        const prev = this.lastCameraTransform;
        let moved = false;
        for (let i = 0; i < 16; i++) {
            if (prev[i] !== m[i]) {
                moved = true;
                break;
            }
        }
        const now = performance.now();
        if (moved) {
            // Серия обрывается кадром без движения, а не паузой в миллисекундах: на тяжёлой
            // сцене кадр сам по себе длиннее любого разумного порога, и отсчёт по времени
            // не начинался бы вовсе — то есть понижение не включалось бы там, где оно нужнее.
            if (!this.cameraMoving) {
                this.cameraMoving = true;
                this.cameraMotionStartedAt = now;
            }
            prev.set(m);
            this.cameraMovedAt = now;
        } else {
            this.cameraMoving = false;
        }

        // Текущее расстояние показываем в панели: пределы задаются числами, а на глаз число
        // не подобрать — нужно видеть, чему отвечает текущий вид. Обновляем редко: наблюдатель
        // рассылает событие в React, и делать это каждый кадр значило бы платить перерисовкой
        // ровно в движении, ради плавности которого всё и затевалось.
        if (now - this.distancePublishedAt > DISTANCE_PUBLISH_INTERVAL_MS) {
            this.distancePublishedAt = now;
            const distance = this.cameraControls.getPosition().distance(this.cameraControls.getFocus());
            this.observer.set('runtime.cameraDistance', Math.round(distance * 1000) / 1000);
        }
    }

    /**
     * Во сколько раз мельче рисовать сцену прямо сейчас.
     *
     * @returns Множитель к `camera.pixelScale`: больше единицы, пока камера движется.
     */
    private motionScale(): number {
        if (this.observer.get('camera.dynamicScale') === false) return 1;
        // Пока идёт съёмка обложки или вида сверху, разрешение трогать нельзя: кадр уйдёт в файл.
        if (this.isCapturingCoverImage || this.isCapturingTopDown) return 1;

        const now = performance.now();
        if (now - this.cameraMovedAt >= MOTION_SETTLE_MS) {
            this.motionScaleEngaged = false;
            return 1;
        }
        // Движение должно продлиться: короткие поправки проходят в полном разрешении, и переход
        // не мелькает на каждом касании мыши. Раз включившись, понижение держится до полной
        // остановки — иначе короткая пауза посреди жеста возвращала бы полное разрешение,
        // и мельканий стало бы больше, а не меньше.
        if (!this.motionScaleEngaged && now - this.cameraMotionStartedAt >= MOTION_ONSET_MS) {
            this.motionScaleEngaged = true;
        }
        return this.motionScaleEngaged ? MOTION_PIXEL_SCALE : 1;
    }

    renderResolution(): { width: number; height: number } {
        return this.resolutionForScale(this.motionScale());
    }

    /**
     * Разрешение без временного понижения на время движения.
     *
     * От него считают всё, что должно быть устойчивым между кадрами: экранная ошибка тайлов и
     * подпись «Вьюпорт». Иначе за один жест величина меняется дважды, отбор успевает сбросить
     * уровень детализации и заказать его обратно, и это видно как моргание.
     *
     * @returns Ширина и высота в пикселях.
     */
    stableRenderResolution(): { width: number; height: number } {
        return this.resolutionForScale(1);
    }

    /**
     * @param motion - Множитель понижения: 1 — без него.
     * @returns Ширина и высота в пикселях.
     */
    private resolutionForScale(motion: number): { width: number; height: number } {
        const device = this.app.graphicsDevice;
        const scale = Math.max(1, Number(this.observer.get('camera.pixelScale')) || 1) * motion;
        return {
            width: Math.max(1, Math.floor(device.width / scale)),
            height: Math.max(1, Math.floor(device.height / scale))
        };
    }

    rebuildRenderTargets() {
        const device = this.app.graphicsDevice;

        const { width: widthPixels, height: heightPixels } = this.renderResolution();

        // Наружу сообщаем устойчивое разрешение, а не то, в котором рисуем прямо сейчас:
        // подпись «Вьюпорт» иначе прыгала бы на каждом жесте, а отбор тайлов — сбрасывал
        // уровень детализации и заказывал его обратно.
        // «Окно просмотра» показывает настоящий размер, включая понижение при движении: по нему
        // и видно, работает ли оно, отдельного поля для этого не нужно.
        this.observer.set('runtime.viewportWidth', widthPixels);
        this.observer.set('runtime.viewportHeight', heightPixels);

        // Отбору тайлов, наоборот, нужна устойчивая величина: от скачков разрешения он сбрасывал
        // бы уровень детализации и заказывал его обратно дважды за жест.
        if (this.tileManager) {
            this.tileManager.stableRenderHeight = this.stableRenderResolution().height;
        }

        const old = this.camera.camera.renderTarget;
        if (this.isCapturingCoverImage || this.isCapturingTopDown || (old && old.width === widthPixels && old.height === heightPixels)) {
            return;
        }

        const maxSamplesEarly = Number((device as GraphicsDevice & { maxSamples?: number }).maxSamples ?? 1);
        // CameraFrame performs MSAA in its internal scene target. Its outer destination must stay
        // single-sampled; multisampling a fullscreen compose pass adds cost without improving edges.
        const wantSamples = this.isPostProcessingRequested() ? 1 :
            (this.observer.get('camera.multisample') ? maxSamplesEarly : 1);

        // Понижение на время движения — это переключение между двумя размерами, туда и обратно
        // по нескольку раз в секунду. Прошлую цель поэтому не уничтожаем, а придерживаем:
        // выделение двух текстур посреди жеста стоит дороже, чем экономит меньшее разрешение,
        // и рывок пришёлся бы ровно на начало движения.
        // Пикер на время съёмки подменяет цель у камеры и возвращает прежнюю. Если обмен
        // придётся на этот промежуток, запас и текущая цель окажутся одним объектом — и мы
        // уничтожим ту, в которую рисуем. Проверяем и разрываем совпадение.
        if (this.spareRenderTarget && this.spareRenderTarget === old) {
            this.spareRenderTarget = null;
        }

        const spare = this.spareRenderTarget;
        if (spare && spare.width === widthPixels && spare.height === heightPixels && spare.samples === wantSamples) {
            this.spareRenderTarget = old ?? null;
            this.assignRenderTarget(spare);
            this.syncMultiframeCamera();
            return;
        }

        // out with the old
        if (old && old.samples === wantSamples) {
            // Размер не подошёл, но цель ещё пригодится при обратном переключении.
            if (this.spareRenderTarget) {
                this.spareRenderTarget.colorBuffer?.destroy();
                this.spareRenderTarget.depthBuffer?.destroy();
                this.spareRenderTarget.destroy();
            }
            this.spareRenderTarget = old;
            this.assignRenderTarget(null);
        } else {
            this.destroyRenderTargets();
        }

        // Цвет фильтруется линейно: при `pixelScale > 1` эту цель растягивает финальный
        // проход, и точечная выборка дала бы ровно ту же лесенку, ради ухода от которой всё
        // и затевалось. При масштабе 1 выборка попадает в центры текселей, и линейная
        // фильтрация неотличима от точечной.
        const createTexture = (width: number, height: number, format: number, filter: number) => {
            return new Texture(device, {
                name: 'viewer-rt-texture',
                width: width,
                height: height,
                format: format,
                mipmaps: false,
                minFilter: filter,
                magFilter: filter,
                addressU: ADDRESS_CLAMP_TO_EDGE,
                addressV: ADDRESS_CLAMP_TO_EDGE
            });
        };

        const maxSamples = Number((device as GraphicsDevice & { maxSamples?: number }).maxSamples ?? 1);

        // in with the new
        const colorBuffer = createTexture(widthPixels, heightPixels, PIXELFORMAT_RGBA8, FILTER_LINEAR);
        const depthBuffer = createTexture(widthPixels, heightPixels, PIXELFORMAT_DEPTH, FILTER_NEAREST);
        const renderTarget = new RenderTarget({
            name: 'viewer-rt',
            colorBuffer: colorBuffer,
            depthBuffer: depthBuffer,
            flipY: false,
            samples: this.isPostProcessingRequested() ? 1 :
                (this.observer.get('camera.multisample') ? maxSamples : 1),
            autoResolve: false
        });
        this.assignRenderTarget(renderTarget);
        this.syncMultiframeCamera();
    }

    // reset the viewer, unloading resources
    resetScene() {
        const app = this.app;

        this.surfacePivotController?.reset();

        // Раскраска по LOD висит на мешах тайлов: при сбросе сцены они уничтожаются,
        // поэтому карту нужно очистить, иначе она удержит мёртвые ссылки.
        this.clearTileLodColors();

        this.fragmentClipMaterials.clear();
        this.observer.set('fragment.enabled', false);
        this.observer.set('fragment.selecting', false);
        this.observer.set('fragment.initialized', false);
        this.clearHelpers();

        // reset camera state first - switch back to viewer camera before destroying entities
        if (this.activeSceneCamera) {
            this.activeSceneCamera.enabled = false;
            this.activeSceneCamera = null;
            this.camera.camera.enabled = true;
            this.cameraControls.enabled = true;
        }
        this.sceneCameras = [];

        this.destroyTileManager();

        this.entities.forEach((entity) => {
            this.sceneContentRoot.removeChild(entity);
            this.shadowCatcher.onEntityRemoved(entity);
            entity.destroy();
        });
        this.entities = [];

        this.assets.forEach((asset) => {
            app.assets.remove(asset);
            asset.unload();
        });
        this.assets = [];

        this.meshInstances = [];
        // A selected GraphNode belongs to the model being destroyed. Clear both the
        // runtime reference and observer state so a subsequently loaded model with the
        // same node path can still emit a fresh selection change.
        this.selectedNode = null;
        this.observer.set('scene.selectedNode', {
            name: '',
            path: '',
            position: '',
            rotation: '',
            scale: ''
        });
        this.selectionController.reset();
        this.resetWireframeMeshes();
        this.clearSelectionOutline();
        this.resetTexelDensityHeatmapMeshes();
        this.resetUvColorMeshes();
        this.resetUvCheckerMeshes();
        this.uvCheckerOriginalVisibility.clear();
        this.uvCheckerEnabled = false;
        this.uvDebugMode = null;
        this.resetMaterialOverrides();
        this.clearMeasurement();

        // Бокс размеров — сессионный инструмент: гасим при сбросе сцены и чистим
        // отрисовку, чтобы он не «висел» поверх новой/перезагружаемой модели.
        this.observer.set('dimensionBox.enabled', false);
        this.observer.set('dimensionBox.initialized', false);
        this.observer.set('dimensionBox.rotation', [0, 0, 0]);
        this.debugBounds.clear();
        this.debugBounds.update();
        this.dirtyBounds = true;

        // reset animation state
        this.animTracks = [];
        this.animationMap = {};

        this.observer.set('scene.materialChannelsWithTextures', '[]');
        this.observer.set('scene.materialChannelFilenames', '{}');
        this.observer.set('scene.selectedMaterialNames', '[]');
        this.observer.set('scene.selectedMaterialFactors', {
            metallicPercent: null,
            roughnessPercent: null,
            opacityPercent: null
        });
        this.observer.set('scene.selectedMaterialColor', null);
        this.observer.set('scene.selectedSpecularColor', null);
        this.observer.set('scene.availableUvSets', '[]');
        this.observer.set('scene.texelDensitySummary', '');
        this.observer.set('scene.texelDensityReport', '[]');
        this.observer.set('scene.hasGsplat', false);
        this.observer.set('scene.unlit', false);
        this.observer.set('scene.isTileset', false);
        this.updateViewCubeVisibility();
        this.observer.set('scene.tilesetLit', null);
        // Пустая иерархия снова прячет нижний ряд экранных кнопок (`#popup.empty`). Для
        // обычной модели её тут же перезапишет `postSceneLoad`; для тайлсета — свой узел
        // ставит `loadTileset`. Без сброса узел удалённого тайлсета остался бы висеть.
        this.observer.set('scene.nodes', '[]');
    }

    private updateMaterialChannelInfo() {
        const channelsWithTextures = new Set<string>();
        const channelFilenames: Record<string, string> = {};
        const channelFormats: Record<string, ChannelFormat> = {};
        const materialNames = new Set<string>();

        const getTextureFilename = (tex: TextureLike | null | undefined): string | undefined => {
            if (!tex) return undefined;
            const texAssets = this.app.assets.filter((a: Asset) => a.type === 'texture');
            const texAsset = texAssets.find((a: Asset) => a.resource === tex);
            const file = texAsset?.file as TextureAssetFile | undefined;
            return file?.filename;
        };

        // Формат текстуры — единственный способ увидеть в плеере, что конвертация в KTX2
        // действительно применилась: сжатые форматы (BC, ASTC, ETC) видеокарта читает как
        // есть, обычные PNG и JPEG разворачиваются в сырые пиксели. Раньше панель об этом
        // молчала, и проверить конвертацию было нечем.
        const getTextureFormat = (tex: TextureLike | null | undefined): ChannelFormat | undefined => {
            const texture = tex as unknown as { format?: number; width?: number; height?: number } | null | undefined;
            if (typeof texture?.format !== 'number') return undefined;
            // Показываем формат ФАЙЛА, а не формат в видеопамяти: вопрос, на который отвечает
            // значок, — «применилась ли конвертация», а это про то, что лежит в glTF. Разбор
            // glTF даёт картинке имя с расширением по её mime, отсюда и берём.
            const ext = (getTextureFilename(tex) ?? '').split('.').pop()?.toLowerCase() ?? '';
            const container = ({ ktx2: 'KTX2', ktx: 'KTX', basis: 'BASIS', dds: 'DDS', png: 'PNG', jpg: 'JPEG', jpeg: 'JPEG', webp: 'WEBP' })[ext];
            return {
                container: container ?? '—',
                gpu: pixelFormatInfo.get(texture.format)?.name ?? `формат ${texture.format}`,
                compressed: isCompressedPixelFormat(texture.format),
                width: texture.width ?? 0,
                height: texture.height ?? 0
            };
        };

        const collectFromMaterial = (mat: MaterialLike | null | undefined) => {
            if (!mat) return;
            if (typeof mat.name === 'string' && mat.name.trim()) {
                materialNames.add(mat.name.trim());
            }
            if (mat.diffuseMap) {
                channelsWithTextures.add('albedo');
                if (!channelFilenames.albedo) channelFilenames.albedo = getTextureFilename(mat.diffuseMap) ?? '';
                if (!channelFormats.albedo) channelFormats.albedo = getTextureFormat(mat.diffuseMap);
            }
            if (mat.metalnessMap) {
                channelsWithTextures.add('metalness');
                if (!channelFilenames.metalness) channelFilenames.metalness = getTextureFilename(mat.metalnessMap) ?? '';
                if (!channelFormats.metalness) channelFormats.metalness = getTextureFormat(mat.metalnessMap);
            }
            if (mat.glossMap) {
                channelsWithTextures.add('gloss');
                if (!channelFilenames.gloss) channelFilenames.gloss = getTextureFilename(mat.glossMap) ?? '';
                if (!channelFormats.gloss) channelFormats.gloss = getTextureFormat(mat.glossMap);
            }
            if (mat.normalMap) {
                channelsWithTextures.add('world_normal');
                if (!channelFilenames.world_normal) channelFilenames.world_normal = getTextureFilename(mat.normalMap) ?? '';
                if (!channelFormats.world_normal) channelFormats.world_normal = getTextureFormat(mat.normalMap);
            }
            if (mat.specularMap) {
                channelsWithTextures.add('specularity');
                if (!channelFilenames.specularity) channelFilenames.specularity = getTextureFilename(mat.specularMap) ?? '';
                if (!channelFormats.specularity) channelFormats.specularity = getTextureFormat(mat.specularMap);
            }
            if (mat.emissiveMap) {
                channelsWithTextures.add('emission');
                if (!channelFilenames.emission) channelFilenames.emission = getTextureFilename(mat.emissiveMap) ?? '';
                if (!channelFormats.emission) channelFormats.emission = getTextureFormat(mat.emissiveMap);
            }
            if (mat.aoMap) {
                channelsWithTextures.add('ao');
                if (!channelFilenames.ao) channelFilenames.ao = getTextureFilename(mat.aoMap) ?? '';
                if (!channelFormats.ao) channelFormats.ao = getTextureFormat(mat.aoMap);
            }
            if (mat.opacityMap) {
                channelsWithTextures.add('opacity');
                if (!channelFilenames.opacity) channelFilenames.opacity = getTextureFilename(mat.opacityMap) ?? '';
                if (!channelFormats.opacity) channelFormats.opacity = getTextureFormat(mat.opacityMap);
            }
        };

        if (this.selectedNode) {
            const selectedEntity = this.selectedNode as Entity;
            selectedEntity.findComponents('render').forEach((renderComponent) => {
                const meshes = (renderComponent as RenderComponent)?.meshInstances ?? [];
                meshes.forEach((mi: MeshInstance) => collectFromMaterial(mi.material));
            });
        } else {
            this.assets.forEach((asset) => {
                if (asset.type === 'gsplat') return;
                const resource = asset.resource as ContainerResourceLike | null;
                (resource?.materials ?? []).forEach((matAsset: Asset) => collectFromMaterial(matAsset?.resource as MaterialLike | null | undefined));
            });
        }

        this.observer.set('scene.materialChannelsWithTextures', JSON.stringify([...channelsWithTextures]));
        this.observer.set('scene.materialChannelFilenames', JSON.stringify(channelFilenames));
        this.observer.set('scene.materialChannelFormats', JSON.stringify(channelFormats));
        this.observer.set('scene.selectedMaterialNames', JSON.stringify([...materialNames]));
    }

    private getSelectedObjectMaterials() {
        if (!this.selectedNode) {
            return [];
        }

        const materials: StandardMaterial[] = [];
        const seen = new Set<StandardMaterial>();
        const selectedMeshes = this.collectMeshInstances(this.selectedNode as Entity);

        selectedMeshes.forEach((meshInstance) => {
            const material = meshInstance.material as StandardMaterial | undefined;
            if (!material || typeof material.update !== 'function' || typeof material.opacity !== 'number' || typeof material.gloss !== 'number') {
                return;
            }
            if (!seen.has(material)) {
                seen.add(material);
                materials.push(material);
            }
        });

        return materials;
    }

    private cloneSelectedNodeMaterialsForEditing() {
        if (!this.selectedNode) {
            return [];
        }

        type EditableMaterial = StandardMaterial & {
            __viewerObjectMaterialClone?: boolean,
            __viewerOriginalBlendType?: number,
            __viewerOriginalDepthWrite?: boolean
        };

        const clones = new Map<StandardMaterial, EditableMaterial>();
        const materials: StandardMaterial[] = [];
        const seen = new Set<StandardMaterial>();
        const selectedMeshes = this.collectMeshInstances(this.selectedNode as Entity);

        selectedMeshes.forEach((meshInstance) => {
            const material = meshInstance.material as StandardMaterial | undefined;
            if (!material || typeof material.clone !== 'function' || typeof material.update !== 'function' || typeof material.opacity !== 'number' || typeof material.gloss !== 'number') {
                return;
            }

            let editableMaterial = material as EditableMaterial;

            if (!editableMaterial.__viewerObjectMaterialClone) {
                let clonedMaterial = clones.get(material);
                if (!clonedMaterial) {
                    clonedMaterial = material.clone() as EditableMaterial;
                    clonedMaterial.name = material.name;
                    clonedMaterial.__viewerObjectMaterialClone = true;
                    clonedMaterial.__viewerOriginalBlendType = material.blendType;
                    clonedMaterial.__viewerOriginalDepthWrite = material.depthWrite;
                    clones.set(material, clonedMaterial);
                }
                meshInstance.material = clonedMaterial;
                editableMaterial = clonedMaterial;
            }

            if (!seen.has(editableMaterial)) {
                seen.add(editableMaterial);
                materials.push(editableMaterial);
            }
        });

        return materials;
    }

    private getMaterialFactorSnapshot(material: StandardMaterial) {
        const roughness = material.glossInvert ? material.gloss : (1 - material.gloss);
        return {
            metallicPercent: Math.round(math.clamp((material.useMetalness ? material.metalness : 0) * 100, 0, 100)),
            roughnessPercent: Math.round(math.clamp(roughness * 100, 0, 100)),
            opacityPercent: Math.round(math.clamp(material.opacity * 100, 0, 100))
        };
    }

    private updateSelectedMaterialFactors() {
        const materials = this.getSelectedObjectMaterials();
        if (materials.length === 0) {
            this.observer.set('scene.selectedMaterialFactors', {
                metallicPercent: null,
                roughnessPercent: null,
                opacityPercent: null
            });
            return;
        }

        const totals = materials.reduce((acc, material) => {
            const snapshot = this.getMaterialFactorSnapshot(material);
            acc.metallicPercent += snapshot.metallicPercent;
            acc.roughnessPercent += snapshot.roughnessPercent;
            acc.opacityPercent += snapshot.opacityPercent;
            return acc;
        }, { metallicPercent: 0, roughnessPercent: 0, opacityPercent: 0 });

        this.observer.set('scene.selectedMaterialFactors', {
            metallicPercent: Math.round(totals.metallicPercent / materials.length),
            roughnessPercent: Math.round(totals.roughnessPercent / materials.length),
            opacityPercent: Math.round(totals.opacityPercent / materials.length)
        });
    }

    private updateSelectedMaterialColor() {
        const materials = this.getSelectedObjectMaterials();
        if (materials.length === 0) {
            this.observer.set('scene.selectedMaterialColor', null);
            return;
        }

        const totals = materials.reduce((acc, material) => {
            acc.r += material.diffuse?.r ?? 1;
            acc.g += material.diffuse?.g ?? 1;
            acc.b += material.diffuse?.b ?? 1;
            return acc;
        }, { r: 0, g: 0, b: 0 });

        this.observer.set('scene.selectedMaterialColor', {
            r: totals.r / materials.length,
            g: totals.g / materials.length,
            b: totals.b / materials.length
        });
    }

    private updateSelectedSpecularColor() {
        const materials = this.getSelectedObjectMaterials();
        if (materials.length === 0) {
            this.observer.set('scene.selectedSpecularColor', null);
            return;
        }

        const totals = materials.reduce((acc, material) => {
            acc.r += material.specular?.r ?? 1;
            acc.g += material.specular?.g ?? 1;
            acc.b += material.specular?.b ?? 1;
            return acc;
        }, { r: 0, g: 0, b: 0 });

        this.observer.set('scene.selectedSpecularColor', {
            r: totals.r / materials.length,
            g: totals.g / materials.length,
            b: totals.b / materials.length
        });
    }

    getMaterialOverrides() {
        return JSON.parse(JSON.stringify(this.materialFactorOverrides));
    }

    resetMaterialOverrides() {
        this.materialFactorOverrides = {};
    }

    applyMaterialOverrides(overrides: Record<string, unknown>) {
        const nextOverrides: Record<string, {
            diffuseColor?: {
                r: number,
                g: number,
                b: number
            },
            specularColor?: {
                r: number,
                g: number,
                b: number
            },
            metallicFactor?: number,
            roughnessFactor?: number,
            opacityFactor?: number
        }> = {};
        const materials = this.meshInstances
        .map(meshInstance => meshInstance.material as StandardMaterial | undefined)
        .filter((material): material is StandardMaterial => !!material && typeof material.update === 'function' && typeof material.opacity === 'number' && typeof material.gloss === 'number');

        Object.entries(overrides).forEach(([materialName, overrideValue]) => {
            if (!materialName || !overrideValue || typeof overrideValue !== 'object' || Array.isArray(overrideValue)) {
                return;
            }

            const override = overrideValue as Record<string, unknown>;
            const diffuseColor = override.diffuseColor;
            const specularColor = override.specularColor;
            const metallicFactor = Number(override.metallicFactor);
            const roughnessFactor = Number(override.roughnessFactor);
            const opacityFactor = Number(override.opacityFactor);
            const sanitized = {
                diffuseColor: diffuseColor && typeof diffuseColor === 'object' && !Array.isArray(diffuseColor) ? {
                    r: math.clamp(Number((diffuseColor as Record<string, unknown>).r), 0, 1),
                    g: math.clamp(Number((diffuseColor as Record<string, unknown>).g), 0, 1),
                    b: math.clamp(Number((diffuseColor as Record<string, unknown>).b), 0, 1)
                } : undefined,
                specularColor: specularColor && typeof specularColor === 'object' && !Array.isArray(specularColor) ? {
                    r: math.clamp(Number((specularColor as Record<string, unknown>).r), 0, 1),
                    g: math.clamp(Number((specularColor as Record<string, unknown>).g), 0, 1),
                    b: math.clamp(Number((specularColor as Record<string, unknown>).b), 0, 1)
                } : undefined,
                metallicFactor: Number.isFinite(metallicFactor) ? math.clamp(metallicFactor, 0, 1) : undefined,
                roughnessFactor: Number.isFinite(roughnessFactor) ? math.clamp(roughnessFactor, 0, 1) : undefined,
                opacityFactor: Number.isFinite(opacityFactor) ? math.clamp(opacityFactor, 0, 1) : undefined
            };

            const matches = materials.filter(material => material.name === materialName);
            if (matches.length === 0) {
                return;
            }

            matches.forEach((material) => {
                if (sanitized.diffuseColor !== undefined) {
                    (material as any).diffuseTint = true;
                    material.diffuse.set(sanitized.diffuseColor.r, sanitized.diffuseColor.g, sanitized.diffuseColor.b);
                }
                if (sanitized.specularColor !== undefined) {
                    material.specular.set(sanitized.specularColor.r, sanitized.specularColor.g, sanitized.specularColor.b);
                }
                if (sanitized.metallicFactor !== undefined) {
                    material.useMetalness = true;
                    material.metalness = sanitized.metallicFactor;
                }
                if (sanitized.roughnessFactor !== undefined) {
                    material.gloss = material.glossInvert ? sanitized.roughnessFactor : (1 - sanitized.roughnessFactor);
                }
                if (sanitized.opacityFactor !== undefined) {
                    material.opacity = sanitized.opacityFactor;
                    if (sanitized.opacityFactor < 0.999) {
                        material.blendType = BLEND_NORMAL;
                        material.depthWrite = false;
                    } else {
                        material.blendType = BLEND_NONE;
                        material.depthWrite = true;
                    }
                }
                material.update();
            });

            nextOverrides[materialName] = sanitized;
        });

        this.materialFactorOverrides = nextOverrides;
        this.updateMaterialChannelInfo();
        this.updateSelectedMaterialFactors();
        this.updateSelectedMaterialColor();
        this.updateSelectedSpecularColor();
        this.updateTexelDensityStats();
        this.dirtyWireframe = true;
        this.dirtySelectionHighlight = true;
        this.renderNextFrame();
    }

    setSelectedDiffuseColor(color: { r: number, g: number, b: number }) {
        const materials = this.cloneSelectedNodeMaterialsForEditing();
        if (materials.length === 0) {
            return;
        }

        const diffuseColor = {
            r: math.clamp(Number(color.r), 0, 1),
            g: math.clamp(Number(color.g), 0, 1),
            b: math.clamp(Number(color.b), 0, 1)
        };

        materials.forEach((material) => {
            (material as any).diffuseTint = true;
            material.diffuse.set(diffuseColor.r, diffuseColor.g, diffuseColor.b);
            material.update();
            if (material.name) {
                this.materialFactorOverrides[material.name] = {
                    ...this.materialFactorOverrides[material.name],
                    diffuseColor
                };
            }
        });

        this.updateMaterialChannelInfo();
        this.updateSelectedMaterialColor();
        this.renderNextFrame();
    }

    setSelectedSpecularColor(color: { r: number, g: number, b: number }) {
        const materials = this.cloneSelectedNodeMaterialsForEditing();
        if (materials.length === 0) {
            return;
        }

        const specularColor = {
            r: math.clamp(Number(color.r), 0, 1),
            g: math.clamp(Number(color.g), 0, 1),
            b: math.clamp(Number(color.b), 0, 1)
        };

        materials.forEach((material) => {
            material.specular.set(specularColor.r, specularColor.g, specularColor.b);
            material.update();
            if (material.name) {
                this.materialFactorOverrides[material.name] = {
                    ...this.materialFactorOverrides[material.name],
                    specularColor
                };
            }
        });

        this.updateMaterialChannelInfo();
        this.updateSelectedSpecularColor();
        this.renderNextFrame();
    }

    setSelectedMaterialFactor(channel: 'metallic' | 'roughness' | 'opacity', percent: number) {
        const materials = this.cloneSelectedNodeMaterialsForEditing();
        if (materials.length === 0) {
            return;
        }

        const normalized = math.clamp(Number(percent) / 100, 0, 1);
        materials.forEach((material) => {
            if (channel === 'metallic') {
                material.useMetalness = true;
                material.metalness = normalized;
            } else if (channel === 'roughness') {
                material.gloss = material.glossInvert ? normalized : (1 - normalized);
            } else if (channel === 'opacity') {
                material.opacity = normalized;
                if (normalized < 0.999) {
                    material.blendType = BLEND_NORMAL;
                    material.depthWrite = false;
                } else {
                    const editableMaterial = material as StandardMaterial & {
                        __viewerOriginalBlendType?: number,
                        __viewerOriginalDepthWrite?: boolean
                    };
                    material.blendType = editableMaterial.__viewerOriginalBlendType ?? BLEND_NONE;
                    material.depthWrite = editableMaterial.__viewerOriginalDepthWrite ?? true;
                }
            }
            material.update();
            if (material.name) {
                this.materialFactorOverrides[material.name] = {
                    ...this.materialFactorOverrides[material.name],
                    metallicFactor: material.useMetalness ? math.clamp(material.metalness, 0, 1) : 0,
                    roughnessFactor: math.clamp(material.glossInvert ? material.gloss : (1 - material.gloss), 0, 1),
                    opacityFactor: math.clamp(material.opacity, 0, 1)
                };
            }
        });

        this.updateMaterialChannelInfo();
        this.updateSelectedMaterialFactors();
        this.updateSelectedMaterialColor();
        this.updateSelectedSpecularColor();
        this.updateTexelDensityStats();
        this.dirtyWireframe = true;
        this.dirtySelectionHighlight = true;
        this.renderNextFrame();
    }

    private getSelectedUvSet() {
        const value = Number(this.observer.get('debug.selectedUvSet') ?? 0);
        return Math.max(0, Math.min(UV_SEMANTICS.length - 1, Number.isFinite(value) ? (value | 0) : 0));
    }

    private getUvSemantic(index: number) {
        return UV_SEMANTICS[Math.max(0, Math.min(UV_SEMANTICS.length - 1, index | 0))];
    }

    private getAvailableUvSets(meshes: MeshInstance[]) {
        const available = new Set<number>();
        meshes.forEach((mi) => {
            const elements = (mi.mesh as any)?.vertexBuffer?.format?.elements ?? [];
            elements.forEach((element: { semantic?: string }) => {
                const semantic = String(element?.semantic ?? '');
                const uvIndex = UV_SEMANTICS.indexOf(semantic as (typeof UV_SEMANTICS)[number]);
                if (uvIndex !== -1) {
                    available.add(uvIndex);
                }
            });
        });
        return [...available].sort((a, b) => a - b);
    }

    private updateSelectedUvSets() {
        const meshes = this.selectedNode ? this.collectMeshInstances(this.selectedNode as Entity) : [];
        const available = this.getAvailableUvSets(meshes);
        this.observer.set('scene.availableUvSets', JSON.stringify(available));
        const current = this.getSelectedUvSet();
        const next = available.includes(current) ? current : (available[0] ?? 0);
        if (next !== current) {
            this.observer.set('debug.selectedUvSet', next);
            return;
        }
        this.setSelectedUvSet(next);
    }

    private getTexelDensityTextureMeta(material: any) {
        const mapCandidates = ['diffuseMap', 'emissiveMap', 'opacityMap', 'normalMap', 'aoMap', 'metalnessMap', 'specularMap', 'glossMap'] as const;
        for (let i = 0; i < mapCandidates.length; i++) {
            const key = mapCandidates[i];
            const tex = material?.[key];
            if (tex && Number.isFinite(tex.width) && Number.isFinite(tex.height) && tex.width > 0 && tex.height > 0) {
                const keyBase = key.replace('Map', '');
                const tilingKey = `${keyBase}MapTiling`;
                const tiling = material?.[tilingKey];
                return {
                    channel: keyBase,
                    tex,
                    tilingX: Math.max(0.000001, Math.abs(Number(tiling?.x ?? 1))),
                    tilingY: Math.max(0.000001, Math.abs(Number(tiling?.y ?? 1)))
                };
            }
        }
        return null;
    }

    private calculateMeshInstanceTexelDensity(mi: MeshInstance, safeUnitScale: number) {
        type TdEntry = {
            node: string;
            material: string;
            texture: string;
            channel: string;
            resolution: string;
            td: number;
            triangles: number;
            worldAreaM2: number;
        };

        const mesh = mi.mesh;
        const textureMeta = this.getTexelDensityTextureMeta(mi.material);
        if (!mesh || !textureMeta) {
            return null;
        }

        const geometry = getCachedMeshGeometry(mi, this.meshGeometryCache);
        if (!geometry) {
            return null;
        }

        const positions = geometry.positions;
        const vertexCount = geometry.vertexCount;
        const uvs = new Float32Array(vertexCount * 2);
        if (mesh.getVertexStream(this.getUvSemantic(this.getSelectedUvSet()), uvs) <= 0) {
            return null;
        }

        const worldMat = mi.node?.getWorldTransform();
        if (!worldMat) {
            return null;
        }

        const p0 = new Vec3();
        const p1 = new Vec3();
        const p2 = new Vec3();
        const edge0 = new Vec3();
        const edge1 = new Vec3();
        const cross = new Vec3();

        let worldAreaUnits2 = 0;
        let texelCount = 0;
        let triangleCount = 0;

        geometry.primitives.forEach((primitive) => {
            if (primitive.indexed && !geometry.indices) return;
            for (let i = primitive.base; i + 2 < primitive.base + primitive.count; i += 3) {
                const i0 = ((primitive.indexed ? geometry.indices?.[i] : i) ?? i) + primitive.baseVertex;
                const i1 = ((primitive.indexed ? geometry.indices?.[i + 1] : i + 1) ?? (i + 1)) + primitive.baseVertex;
                const i2 = ((primitive.indexed ? geometry.indices?.[i + 2] : i + 2) ?? (i + 2)) + primitive.baseVertex;

                if (i0 < 0 || i1 < 0 || i2 < 0 || i0 >= vertexCount || i1 >= vertexCount || i2 >= vertexCount) {
                    continue;
                }

                p0.set(positions[i0 * 3], positions[i0 * 3 + 1], positions[i0 * 3 + 2]);
                p1.set(positions[i1 * 3], positions[i1 * 3 + 1], positions[i1 * 3 + 2]);
                p2.set(positions[i2 * 3], positions[i2 * 3 + 1], positions[i2 * 3 + 2]);
                worldMat.transformPoint(p0, p0);
                worldMat.transformPoint(p1, p1);
                worldMat.transformPoint(p2, p2);

                edge0.sub2(p1, p0);
                edge1.sub2(p2, p0);
                cross.cross(edge0, edge1);
                const triAreaWorldUnits2 = 0.5 * cross.length();
                if (!Number.isFinite(triAreaWorldUnits2) || triAreaWorldUnits2 <= 1e-12) {
                    continue;
                }

                const u0 = uvs[i0 * 2];
                const v0 = uvs[i0 * 2 + 1];
                const u1 = uvs[i1 * 2];
                const v1 = uvs[i1 * 2 + 1];
                const u2 = uvs[i2 * 2];
                const v2 = uvs[i2 * 2 + 1];
                const triAreaUv = 0.5 * Math.abs(((u1 - u0) * (v2 - v0)) - ((v1 - v0) * (u2 - u0))) * textureMeta.tilingX * textureMeta.tilingY;
                if (!Number.isFinite(triAreaUv) || triAreaUv <= 1e-12) {
                    continue;
                }

                worldAreaUnits2 += triAreaWorldUnits2;
                texelCount += triAreaUv * textureMeta.tex.width * textureMeta.tex.height;
                triangleCount++;
            }
        });

        const worldAreaM2 = worldAreaUnits2 * safeUnitScale * safeUnitScale;
        if (!Number.isFinite(worldAreaM2) || worldAreaM2 <= 1e-12 || !Number.isFinite(texelCount) || texelCount <= 0 || triangleCount === 0) {
            return null;
        }

        const td = Math.sqrt(texelCount / worldAreaM2);
        if (!Number.isFinite(td) || td <= 0) {
            return null;
        }

        return {
            node: mi.node?.path || mi.node?.name || '-',
            material: (mi.material as any)?.name || '-',
            texture: textureMeta.tex.name || '-',
            channel: textureMeta.channel,
            resolution: `${textureMeta.tex.width}x${textureMeta.tex.height}`,
            td,
            triangles: triangleCount,
            worldAreaM2
        } satisfies TdEntry;
    }

    private updateTexelDensityStats() {
        type TdEntry = {
            node: string;
            material: string;
            texture: string;
            channel: string;
            resolution: string;
            td: number;
            triangles: number;
            worldAreaM2: number;
        };

        const selectedPath = this.observer.get('scene.selectedNode.path') as string;
        if (!this.selectedNode || !selectedPath) {
            this.observer.set('scene.texelDensitySummary', 'n/a');
            this.observer.set('scene.texelDensityReport', '[]');
            return;
        }

        const unitScale = Number(this.observer.get('measure.unitScale') ?? 1);
        const safeUnitScale = Number.isFinite(unitScale) && unitScale > 0 ? unitScale : 1;
        const selectedMeshes = this.collectMeshInstances(this.selectedNode as Entity);
        const entries: TdEntry[] = [];
        let totalWorldAreaM2 = 0;
        let totalTexelCount = 0;
        let totalTriangles = 0;

        selectedMeshes.forEach((mi) => {
            const entry = this.calculateMeshInstanceTexelDensity(mi, safeUnitScale);
            if (!entry) return;
            entries.push(entry);
            totalWorldAreaM2 += entry.worldAreaM2;
            totalTexelCount += entry.td * entry.td * entry.worldAreaM2;
            totalTriangles += entry.triangles;
        });

        if (entries.length === 0 || totalWorldAreaM2 <= 0 || totalTexelCount <= 0) {
            this.observer.set('scene.texelDensitySummary', 'n/a');
            this.observer.set('scene.texelDensityReport', '[]');
            return;
        }

        entries.sort((a, b) => b.worldAreaM2 - a.worldAreaM2);
        const td = Math.sqrt(totalTexelCount / totalWorldAreaM2);
        const unit = String(this.observer.get('measure.unit') ?? 'm');
        const tdDivisor = unit === 'mm' ? 1000 : (unit === 'cm' ? 100 : 1);
        const tdUnit = unit === 'mm' ? 'px/mm' : (unit === 'cm' ? 'px/cm' : 'px/m');
        const areaFactor = unit === 'mm' ? 1000000 : (unit === 'cm' ? 10000 : 1);
        const areaUnit = unit === 'mm' ? 'mm²' : (unit === 'cm' ? 'cm²' : 'm²');
        const displayTd = td / tdDivisor;
        const displayArea = totalWorldAreaM2 * areaFactor;
        const tdPrecision = unit === 'm' ? 0 : 2;
        const areaPrecision = unit === 'm' ? 2 : 0;
        const summary = `${displayTd.toFixed(tdPrecision)} ${tdUnit} | ${entries.length} mats | ${totalTriangles} tris | ${displayArea.toFixed(areaPrecision)} ${areaUnit}`;
        this.observer.set('scene.texelDensitySummary', summary);
        this.observer.set('scene.texelDensityReport', JSON.stringify(entries.slice(0, 32).map(e => ({
            ...e,
            td: Math.round(e.td),
            worldAreaM2: Number(e.worldAreaM2.toFixed(4))
        }))));
    }

    updateSceneStats() {
        let meshCount = 0;
        let meshVRAM = 0;
        let vertexCount = 0;
        let primitiveCount = 0;
        let materialCount = 0;
        // Материалы с KHR_materials_unlit приходят с useLighting === false. Считаем их
        // отдельно: сцена целиком unlit → свет на картинку не влияет.
        let litMaterialCount = 0;
        let textureCount = 0;
        let textureVRAM = 0;
        let variants: string[] = [];

        // update mesh stats
        this.assets.forEach((asset) => {
            if (asset.type === 'gsplat') {
                const resource = asset.resource;

                if (resource instanceof GSplatResource) {
                    meshCount++;
                    materialCount++;
                    primitiveCount += resource.gsplatData.numSplats;
                    vertexCount += resource.gsplatData.numSplats * 4;
                }
            } else {
                // ContainerResource type isn't picked up correctly for some reason
                const resource = asset.resource as ContainerResourceLike | null;

                variants = variants.concat(resource?.getMaterialVariants?.() ?? []);

                (resource?.renders ?? []).forEach((renderAsset: Asset) => {
                    const res = renderAsset.resource as RenderResourceLike | null;
                    const meshes = res?.meshes ?? [];
                    meshCount += meshes.length;
                    meshes.forEach((mesh: Mesh) => {
                        vertexCount += mesh.vertexBuffer.getNumVertices();

                        (mesh.primitive ?? []).forEach((prim: { type?: number; count?: number }) => {
                            const count = Math.max(0, Number(prim?.count ?? 0));
                            switch (prim?.type) {
                                case PRIMITIVE_POINTS:
                                    primitiveCount += count;
                                    break;
                                case PRIMITIVE_LINES:
                                    primitiveCount += count / 2;
                                    break;
                                case PRIMITIVE_LINELOOP:
                                    primitiveCount += count;
                                    break;
                                case PRIMITIVE_LINESTRIP:
                                    primitiveCount += Math.max(0, count - 1);
                                    break;
                                case PRIMITIVE_TRIANGLES:
                                    primitiveCount += count / 3;
                                    break;
                                case PRIMITIVE_TRISTRIP:
                                case PRIMITIVE_TRIFAN:
                                    primitiveCount += Math.max(0, count - 2);
                                    break;
                            }
                        });
                        meshVRAM += mesh.vertexBuffer.numBytes + (mesh.indexBuffer?.[0]?.numBytes ?? 0);
                    });
                });

                materialCount += resource.materials.length ?? 0;
                (resource.materials ?? []).forEach((materialAsset: Asset) => {
                    const material = materialAsset?.resource as { useLighting?: boolean } | null;
                    if (material && material.useLighting !== false) {
                        litMaterialCount++;
                    }
                });
                textureCount += resource.textures.length ?? 0;
                (resource.textures ?? []).forEach((texture: Asset) => {
                    textureVRAM += (texture.resource as Texture).gpuSize;
                });
            }
        });

        this.updateMaterialChannelInfo();
        this.updateTexelDensityStats();

        const mapChildren = function (node: GraphNode): Array<HierarchyNode> {
            return node.children.map((child: GraphNode) => ({
                name: child.name,
                path: child.path,
                children: mapChildren(child)
            }));
        };

        const graph: Array<HierarchyNode> = this.entities.map((entity) => {
            return {
                name: entity.name,
                path: entity.path,
                children: mapChildren(entity)
            };
        });

        // hierarchy
        this.observer.set('scene.nodes', JSON.stringify(graph));
        this.importHelpersFromScene();

        // mesh stats
        this.observer.set('scene.meshCount', meshCount);
        this.observer.set('scene.materialCount', materialCount);
        this.observer.set('scene.textureCount', textureCount);
        this.observer.set('scene.vertexCount', vertexCount);
        this.observer.set('scene.primitiveCount', primitiveCount);
        this.observer.set('scene.textureVRAM', textureVRAM);
        this.observer.set('scene.meshVRAM', meshVRAM);
        this.observer.set('scene.hasGsplat', this.entities.some(entity => entity.findComponents('gsplat').length > 0));
        // Считаем по исходным материалам контейнера, а не по mesh instances: отладочные
        // режимы (UV checker, texel density) подменяют материалы своими, тоже unlit.
        this.observer.set('scene.unlit', materialCount > 0 && litMaterialCount === 0);
        this.applyUnlitShadowCatcherDefault();

        // variant stats
        this.observer.set('scene.variants.list', JSON.stringify(variants));
        this.observer.set('scene.variant.selected', variants[0]);

        // detect cameras in the loaded scene
        const cameras: Array<SceneCamera> = [];

        this.entities.forEach((entity) => {
            const cameraComponents = entity.findComponents('camera') as CameraComponent[];
            cameraComponents.forEach((cameraComponent) => {
                cameras.push({
                    name: cameraComponent.entity.name || `Camera ${cameras.length + 1}`,
                    path: cameraComponent.entity.path
                });
            });
        });

        this.observer.set('scene.cameras', JSON.stringify(cameras));
        this.observer.set('scene.selectedCamera', '');
    }

    downloadPngScreenshot() {
        // construct exporter on demand
        if (!this.pngExporter) {
            this.pngExporter = new PngExporter();
        }

        // derive filename from loaded model, fallback to 'model-viewer'
        const filenames = this.observer.get('scene.filenames') as string[];
        let filename = 'model-viewer';
        if (filenames && filenames.length > 0) {
            // remove extension from the first loaded model's filename
            const baseName = filenames[0].replace(/\.[^/.]+$/, '');
            // ensure we have a valid filename after removing extension
            if (baseName) {
                filename = baseName;
            }
        }

        // request a frame render and wait for it to complete (including resolve for MSAA)
        // before reading the texture
        this.renderNextFrame();
        this.app.once('postrender', () => {
            const texture = this.camera.camera.renderTarget.colorBuffer;
            texture.read(0, 0, texture.width, texture.height).then((typedArray: Uint32Array) => {
                this.pngExporter.export(
                    `${filename}.png`,
                    new Uint32Array(typedArray.buffer.slice(0)),
                    texture.width,
                    texture.height
                );
            }).catch((err: unknown) => {
                console.error('Failed to capture PNG screenshot from render target:', err);
            });
        });
    }

    downloadMeasurementsJson() {
        const data = this.measurementController?.getMeasurementsExportData();
        if (!data) return;
        const filenames = this.observer.get('scene.filenames') as string[];
        const modelName = filenames?.[0]?.replace(/\.[^/.]+$/, '') || 'model-viewer';
        const blob = new Blob([`${JSON.stringify(data, null, 2)}\n`], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.download = `${modelName}.measurements.json`;
        link.href = url;
        link.click();
        URL.revokeObjectURL(url);
    }

    // Снимает ТЕКУЩИЙ вьюпорт (вытянутый, как канвас) и возвращает PNG-байты
    // без скачивания — для заставки-заглушки под прогресс-баром на хосте.
    captureViewportImage(): Promise<Uint8Array | null> {
        return new Promise((resolve) => {
            if (!this.pngExporter) {
                this.pngExporter = new PngExporter();
            }
            let settled = false;
            let timer: ReturnType<typeof setTimeout> | null = null;
            const done = (v: Uint8Array | null) => {
                if (settled) return;
                settled = true;
                if (timer) clearTimeout(timer);
                resolve(v);
            };
            timer = setTimeout(() => done(null), 8000);
            this.renderNextFrame();
            this.app.once('postrender', () => {
                try {
                    const texture = this.camera.camera.renderTarget?.colorBuffer;
                    if (!texture || !texture.width || !texture.height) {
                        done(null);
                        return;
                    }
                    texture.read(0, 0, texture.width, texture.height).then((typedArray: Uint32Array) => {
                        return this.pngExporter.encode(
                            new Uint32Array(typedArray.buffer.slice(0)),
                            texture.width,
                            texture.height
                        );
                    }).then((png: Uint8Array) => done(png)).catch(() => done(null));
                } catch {
                    done(null);
                }
            });
        });
    }

    // Снимает квадратную обложку и возвращает PNG-байты (без скачивания).
    captureCoverImage(): Promise<Uint8Array | null> {
        return new Promise((rawResolve) => {
            const COVER_SIZE = 1024;
            const device = this.app.graphicsDevice;

            // Гард: резолвим ровно один раз. Нужен для таймаут-страховки ниже —
            // иначе при простое рендер-лупа (нет postrender) промис висел бы вечно,
            // а хост получал «Вьюер не ответил» при «Сохранить в проект».
            let settled = false;
            let safetyTimer: ReturnType<typeof setTimeout> | null = null;
            const resolve = (v: Uint8Array | null) => {
                if (settled) return;
                settled = true;
                if (safetyTimer) clearTimeout(safetyTimer);
                rawResolve(v);
            };

            if (!this.pngExporter) {
                this.pngExporter = new PngExporter();
            }

            const savedPosition = this.cameraControls.getPosition().clone();
            const savedFocus = this.cameraControls.getFocus().clone();
            const savedRenderTarget = this.camera.camera.renderTarget;
            const savedMultiframe = this.multiframe?.enabled ?? false;

            if (this.multiframe) this.multiframe.enabled = false;

            this.isCapturingCoverImage = true;

            const createTexture = (w: number, h: number) => new Texture(device, {
                name: 'cover-rt-texture',
                width: w,
                height: h,
                format: PIXELFORMAT_RGBA8,
                mipmaps: false,
                minFilter: FILTER_NEAREST,
                magFilter: FILTER_NEAREST,
                addressU: ADDRESS_CLAMP_TO_EDGE,
                addressV: ADDRESS_CLAMP_TO_EDGE
            });

            const colorBuffer = createTexture(COVER_SIZE, COVER_SIZE);
            const depthBuffer = new Texture(device, {
                name: 'cover-rt-depth',
                width: COVER_SIZE,
                height: COVER_SIZE,
                format: PIXELFORMAT_DEPTH,
                mipmaps: false
            });

            const squareRT = new RenderTarget({
                name: 'viewer-cover-rt',
                colorBuffer,
                depthBuffer,
                flipY: false,
                samples: 1,
                autoResolve: false
            });

            this.camera.camera.renderTarget = squareRT;
            this.focus(false, 1);

            // Если postrender не наступит за 8с — чистим и отдаём null, не зависая.
            safetyTimer = setTimeout(() => {
                this.cleanupCoverCapture(squareRT, savedRenderTarget, savedFocus, savedPosition, savedMultiframe);
                resolve(null);
            }, 8000);

            this.renderNextFrame();
            this.app.once('postrender', () => {
                const texture = this.camera.camera.renderTarget?.colorBuffer;
                if (!texture || texture.width !== COVER_SIZE || texture.height !== COVER_SIZE) {
                    this.cleanupCoverCapture(squareRT, savedRenderTarget, savedFocus, savedPosition, savedMultiframe);
                    resolve(null);
                    return;
                }
                texture.read(0, 0, COVER_SIZE, COVER_SIZE).then((typedArray: Uint32Array) => {
                    return this.pngExporter.encode(
                        new Uint32Array(typedArray.buffer.slice(0)),
                        COVER_SIZE,
                        COVER_SIZE
                    );
                }).then((png: Uint8Array) => {
                    resolve(png);
                }).catch((err: unknown) => {
                    console.error('Failed to capture cover image:', err);
                    resolve(null);
                }).finally(() => {
                    this.cleanupCoverCapture(squareRT, savedRenderTarget, savedFocus, savedPosition, savedMultiframe);
                });
            });
        });
    }

    downloadCoverImageScreenshot() {
        const filenames = this.observer.get('scene.filenames') as string[];
        let baseName = 'model-viewer';
        if (filenames && filenames.length > 0) {
            const stripped = filenames[0].replace(/\.[^/.]+$/, '');
            if (stripped) baseName = stripped;
        }
        this.captureCoverImage().then((png) => {
            if (!png) return;
            if (this.saveToParent) {
                postToViewerParent({
                    type: 'export-cover-result',
                    cover: Viewer.bytesToBase64(png),
                    auto: true
                });
                return;
            }
            if (this.pngExporter) {
                this.pngExporter._downloadFile(`${baseName}-cover.png`, png);
            }
        });
    }

    private cleanupCoverCapture(squareRT: RenderTarget, savedRT: RenderTarget | null, savedFocus: Vec3, savedPosition: Vec3, savedMultiframe: boolean) {
        this.isCapturingCoverImage = false;
        squareRT.colorBuffer?.destroy();
        squareRT.depthBuffer?.destroy();
        squareRT.destroy();
        this.camera.camera.renderTarget = savedRT;
        this.cameraControls.reset(savedFocus, savedPosition);
        if (this.multiframe) this.multiframe.enabled = savedMultiframe;
        this.renderNextFrame();
    }

    moveMicrophone(id: string, name: string, position: { x: number; y: number; z: number }) {
        this.setHelper({
            id,
            name: name || id,
            type: 'audio-source',
            group: 'mic',
            position: [position.x, position.y, position.z]
        });
        this.renderNextFrame();
    }

    clearMicrophones() {
        this.clearHelpers('mic');
        this.renderNextFrame();
    }

    captureTopDownImage(): Promise<{ png: Uint8Array; orthoHeight: number; centerX: number; centerY: number; centerZ: number; boxX: number; boxY: number; boxZ: number; boxCenterX: number; boxCenterZ: number } | null> {
        return new Promise((rawResolve) => {
            const SIZE = 1024;
            const device = this.app.graphicsDevice;

            let settled = false;
            let safetyTimer: ReturnType<typeof setTimeout> | null = null;
            const resolve = (v: { png: Uint8Array; orthoHeight: number; centerX: number; centerY: number; centerZ: number; boxX: number; boxY: number; boxZ: number; boxCenterX: number; boxCenterZ: number } | null) => {
                if (settled) return;
                settled = true;
                if (safetyTimer) clearTimeout(safetyTimer);
                rawResolve(v);
            };

            if (!this.pngExporter) {
                this.pngExporter = new PngExporter();
            }

            const savedPosition = this.camera.getPosition().clone();
            const savedRotation = this.camera.getRotation().clone();
            const savedProjection = this.camera.camera.projection;
            const savedOrthoHeight = this.camera.camera.orthoHeight;
            const savedRenderTarget = this.camera.camera.renderTarget;
            const savedMultiframe = this.multiframe?.enabled ?? false;
            const savedControlsEnabled = this.cameraControls.enabled;

            this.cameraControls.enabled = false;
            if (this.multiframe) this.multiframe.enabled = false;
            // Не даём rebuildRenderTargets() подменить наш квадратный RT на канвас-размер
            // (иначе postrender прочтёт RT не того размера и вернёт null). Свой флаг —
            // не пересекается с async-cleanup'ом captureCoverImage.
            this.isCapturingTopDown = true;

            const createTexture = (w: number, h: number) => new Texture(device, {
                name: 'topdown-rt-texture',
                width: w,
                height: h,
                format: PIXELFORMAT_RGBA8,
                mipmaps: false,
                minFilter: FILTER_NEAREST,
                magFilter: FILTER_NEAREST,
                addressU: ADDRESS_CLAMP_TO_EDGE,
                addressV: ADDRESS_CLAMP_TO_EDGE
            });

            const colorBuffer = createTexture(SIZE, SIZE);
            const depthBuffer = new Texture(device, {
                name: 'topdown-rt-depth',
                width: SIZE,
                height: SIZE,
                format: PIXELFORMAT_DEPTH,
                mipmaps: false
            });

            const squareRT = new RenderTarget({
                name: 'viewer-topdown-rt',
                colorBuffer,
                depthBuffer,
                flipY: false,
                samples: 1,
                autoResolve: false
            });

            this.camera.camera.renderTarget = squareRT;

            const bbox = new BoundingBox();
            this.calcSceneBounds(bbox);
            const focus = this.calcFocalPoint(bbox);
            const sceneSize = bbox.halfExtents.length();

            this.camera.camera.projection = 1; // ORTHOGRAPHIC
            const maxDimension = Math.max(bbox.halfExtents.x, bbox.halfExtents.z) * 2;
            this.camera.camera.orthoHeight = maxDimension * 1.1;

            const camPos = new Vec3(focus.x, focus.y + sceneSize * 2, focus.z);
            this.camera.setPosition(camPos);
            this.camera.lookAt(focus, new Vec3(0, 0, -1));

            safetyTimer = setTimeout(() => {
                this.cleanupTopDownCapture(squareRT, savedRenderTarget, savedPosition, savedRotation, savedProjection, savedOrthoHeight, savedMultiframe, savedControlsEnabled);
                resolve(null);
            }, 8000);

            this.renderNextFrame();
            this.app.once('postrender', () => {
                const texture = this.camera.camera.renderTarget?.colorBuffer;
                if (!texture || texture.width !== SIZE || texture.height !== SIZE) {
                    this.cleanupTopDownCapture(squareRT, savedRenderTarget, savedPosition, savedRotation, savedProjection, savedOrthoHeight, savedMultiframe, savedControlsEnabled);
                    resolve(null);
                    return;
                }
                texture.read(0, 0, SIZE, SIZE).then((typedArray: Uint32Array) => {
                    return this.pngExporter.encode(
                        new Uint32Array(typedArray.buffer.slice(0)),
                        SIZE,
                        SIZE
                    );
                }).then((png: Uint8Array) => {
                    resolve({
                        png,
                        orthoHeight: this.camera.camera.orthoHeight,
                        centerX: focus.x,
                        centerY: focus.y,
                        centerZ: focus.z,
                        // Габариты обводящей коробки модели (в юнитах сцены) и её центр —
                        // для отрисовки реального контура инструмента на миллиметровке.
                        boxX: bbox.halfExtents.x * 2,
                        boxY: bbox.halfExtents.y * 2,
                        boxZ: bbox.halfExtents.z * 2,
                        boxCenterX: bbox.center.x,
                        boxCenterZ: bbox.center.z
                    });
                }).catch((err: unknown) => {
                    console.error('Failed to capture top-down image:', err);
                    resolve(null);
                }).finally(() => {
                    this.cleanupTopDownCapture(squareRT, savedRenderTarget, savedPosition, savedRotation, savedProjection, savedOrthoHeight, savedMultiframe, savedControlsEnabled);
                });
            });
        });
    }

    private cleanupTopDownCapture(
        squareRT: RenderTarget,
        savedRenderTarget: RenderTarget | null,
        savedPosition: Vec3,
        savedRotation: Quat,
        savedProjection: number,
        savedOrthoHeight: number,
        savedMultiframe: boolean,
        savedControlsEnabled: boolean
    ) {
        if (squareRT.colorBuffer) squareRT.colorBuffer.destroy();
        if (squareRT.depthBuffer) squareRT.depthBuffer.destroy();
        squareRT.destroy();

        this.camera.camera.renderTarget = savedRenderTarget;
        this.camera.setPosition(savedPosition);
        this.camera.setRotation(savedRotation);
        this.camera.camera.projection = savedProjection;
        this.camera.camera.orthoHeight = savedOrthoHeight;

        if (this.multiframe) this.multiframe.enabled = savedMultiframe;
        this.cameraControls.enabled = savedControlsEnabled;
        this.isCapturingTopDown = false;
        this.renderNextFrame();
    }


    /**
     * Load a horizontal strip LUT (for example 256×16) selected in the settings panel.
     *
     * @param file - Browser image file containing the LUT strip.
     */
    async loadColorLut(file: Blob & { name: string }): Promise<void> {
        const objectUrl = URL.createObjectURL(file);
        const asset = new Asset(file.name || 'Color LUT', 'texture', {
            url: objectUrl,
            filename: file.name || 'color-lut.png'
        }, {
            mipmaps: false,
            srgb: true
        });

        try {
            const texture = await new Promise<Texture>((resolveTexture, rejectTexture) => {
                asset.once('load', () => resolveTexture(asset.resource as Texture));
                asset.once('error', (err: unknown) => rejectTexture(err instanceof Error ? err : new Error(String(err))));
                this.app.assets.add(asset);
                this.app.assets.load(asset);
            });

            // CameraFrame expects the common horizontal LUT strip: N slices, each N×N.
            if (texture.height < 2 || texture.width !== texture.height * texture.height) {
                throw new Error(t('Color LUT must be a horizontal strip, for example 256 x 16 pixels.', this.observer.get('ui.language')));
            }

            texture.minFilter = FILTER_LINEAR;
            texture.magFilter = FILTER_LINEAR;
            texture.addressU = ADDRESS_CLAMP_TO_EDGE;
            texture.addressV = ADDRESS_CLAMP_TO_EDGE;

            this.releaseColorLut();
            this.colorLutAsset = asset;
            this.colorLutTexture = texture;
            this.colorLutObjectUrl = objectUrl;
            this.observer.set('camera.colorLutName', file.name || 'Color LUT');
            this.destroyRenderTargets();
            this.renderNextFrame();
        } catch (err) {
            asset.unload();
            this.app.assets.remove(asset);
            URL.revokeObjectURL(objectUrl);
            throw err;
        }
    }

    private releaseColorLut(): void {
        if (this.colorLutAsset) {
            this.colorLutAsset.unload();
            this.app.assets.remove(this.colorLutAsset);
        }
        if (this.colorLutObjectUrl) URL.revokeObjectURL(this.colorLutObjectUrl);
        this.colorLutAsset = null;
        this.colorLutTexture = null;
        this.colorLutObjectUrl = null;
    }

    clearColorLut(): void {
        this.releaseColorLut();
        this.observer.set('camera.colorLutName', '');
        this.destroyRenderTargets();
        this.renderNextFrame();
    }

    /** Export current viewer settings (camera, skybox, light, etc.) to a JSON file. */
    exportViewerSettings() {
        if (this.saveToParent) {
            postToViewerParent({
                type: 'export-settings-result',
                settings: this.settingsService.getSettingsData(),
                auto: true
            });
            return;
        }
        this.settingsService.exportViewerSettings();
    }

    /** Reset viewer settings (camera, skybox, light, etc.) to defaults. */
    /**
     * Помечает сцену как сплатовую перед сбросом умолчаний.
     *
     * Решаем по имени файла, а не по составу сцены: сплатовый LOD подцепляет сущности много
     * позже, и `scene.hasGsplat` к этому моменту ещё не отражает правду. Сам масштаб пиксела
     * выбирает сброс — он повторяется при неудачном поиске файла настроек и иначе затирал бы
     * выставленное здесь значение.
     *
     * @param url - Имя или адрес загружаемого файла.
     */
    private markSplatScene(url: string | undefined) {
        this.settingsService.splatScene = !!url &&
            !this.isTilesetFilename(url) && this.isGSplatFilename(url);
    }

    private resetViewerSettingsToDefaults() {
        this.settingsService.resetViewerSettingsToDefaults();
    }

    /**
     * Apply a settings object (e.g. from model-viewer-settings.json) to the observer.
     * @param data - Parsed viewer settings payload.
     */
    applyViewerSettings(data: Record<string, unknown>) {
        this.settingsService.applyViewerSettings(data);
    }

    /**
     * Fetch and apply model settings from nearby files.
     * @param firstModelUrl - URL of the primary loaded model file.
     * @param allFiles - Optional list of all dropped or loaded files.
     * @returns Promise resolved after settings lookup completes.
     */
    private tryFetchAndApplySettings(firstModelUrl: string, allFiles?: Array<{ url: string; filename?: string }>): Promise<boolean> {
        return this.settingsService.tryFetchAndApplySettings(firstModelUrl, allFiles);
    }

    private preloadLoadingBackgroundFromSettings(firstModelUrl: string, allFiles?: Array<{ url: string; filename?: string; sizeBytes?: number }>): Promise<void> {
        return this.settingsService.preloadLoadingBackgroundFromSettings(firstModelUrl, allFiles);
    }

    /** Apply current observer skybox/light to the scene (e.g. after loading settings from file). */
    private syncSkyboxAndLightFromObserver() {
        this.settingsService.syncSkyboxAndLightFromObserver();
    }

    /**
     * Задать пределы расстояния до точки вращения.
     *
     * Автоматический предел считается от габаритов сцены: десять радиусов описанной сферы —
     * достаточно, чтобы обойти модель кругом, и мало, чтобы улететь в пустоту, откуда она
     * выглядит точкой и вернуться нечем.
     *
     * В ручном режиме значения берутся из настроек и кадрированием не перетираются: их задали
     * осознанно, и «вписать в экран» не повод их терять.
     *
     * @param sceneSize - Радиус описанной сферы сцены.
     */
    applyDistanceLimits(sceneSize: number) {
        // Габариты запоминаем: правка полей должна пересчитывать предел от того же размера,
        // от которого его считало кадрирование, а `sceneBounds` — это уже другая величина
        // (кадрируют по выбранному объекту или по фрагменту, а не по всей сцене).
        this.distanceLimitSceneSize = sceneSize;
        const manual = this.observer.get('camera.distanceLimitsManual') === true;
        const min = manual ?
            Math.max(ZOOM_SCALE_MIN, Number(this.observer.get('camera.distanceMin')) || ZOOM_SCALE_MIN) :
            ZOOM_SCALE_MIN;
        const autoMax = AUTO_DISTANCE_MAX_RADII * Math.max(sceneSize, ZOOM_SCALE_MIN);
        const max = manual ?
            (Number(this.observer.get('camera.distanceMax')) || autoMax) :
            autoMax;

        this.cameraControls.zoomRange = new Vec2(min, Math.max(min, max));

        // Показываем посчитанное в полях, чтобы предел был виден и его было с чего править.
        // Значения задаём явно: наблюдатель не рассылает событие на прежнее значение, и
        // рассчитывать, что одно поле подтянет другое, нельзя.
        if (!manual) {
            this.observer.set('camera.distanceMin', min);
            this.observer.set('camera.distanceMax', max);
        }
    }

    // adjust camera clipping planes to fit the scene
    fitCameraClipPlanes() {
        const mat = this.camera.getWorldTransform();

        const cameraPosition = mat.getTranslation();
        const cameraForward = mat.getZ();

        const bound = this.dynamicSceneBounds;
        const boundCenter = bound.center;
        const boundRadius = bound.halfExtents.length() * 2;

        vec.sub2(boundCenter, cameraPosition);
        const dist = -vec.dot(cameraForward);

        const far = dist + boundRadius;
        const near = Math.max(0.001, dist < boundRadius ? far / 1024 : dist - boundRadius);

        this.camera.camera.nearClip = near;
        this.camera.camera.farClip = far;
        this.light.light.shadowDistance = far;
        this.light.light.normalOffsetBias = far / 1024;
    }

    /** Fit the camera to the scene (same as pressing F). */
    frameScene() {
        this.stopCameraFlyTransition();
        if (this.observer.get('fragment.enabled') && this.observer.get('fragment.initialized')) {
            const center = this.fragmentBoxEntity.getPosition().clone();
            const size = this.fragmentBoxEntity.getLocalScale();
            const sceneSize = Math.max(0.00001, size.length() * 0.5);
            const zoom = this.calcZoom(sceneSize);
            const start = this.camera.forward.clone().mulScalar(-zoom).add(center);
            this.cameraControls.moveSpeed = sceneSize * 2.5;
            this.applyDistanceLimits(sceneSize);
            this.cameraControls.reset(center, start);
        } else {
            // Кадрируем по реальной геометрии сцены (calcSceneBounds внутри focus),
            // а не по регулируемому alignment-боксу — так «вписать в экран» центрируется
            // на самой модели.
            this.focus(false);
        }
        this.fitCameraClipPlanes();
        this.renderNextFrame();
    }

    /**
     * Reset only the view: back to the scene's initial camera (or the default direction
     * with the model framed). Unlike resetCamera(), the scene transform is left alone, so
     * this is safe to offer next to the alignment tools.
     */
    resetCameraView() {
        this.stopCameraFlyTransition();
        this.focus(true);
        this.fitCameraClipPlanes();
        this.renderNextFrame();
    }

    /** Reset the camera to default position (same as pressing R). */
    resetCamera() {
        this.stopCameraFlyTransition();
        this.resetSceneTransform();
        this.cameraControls.reset(Vec3.ZERO, new Vec3(2, 2, 2));
    }

    /** Keep the current view direction and distance, but move the orbit pivot to the selected object center. */
    centerPivotToObject() {
        this.stopCameraFlyTransition();
        if (!this.selectedNode) {
            return;
        }

        this.calcSceneBounds(bbox, this.selectedNode as Entity);
        const focus = this.calcFocalPoint(bbox);
        const currentPosition = this.cameraControls.getPosition().clone();
        const currentFocus = this.cameraControls.getFocus().clone();
        const offset = currentPosition.sub(currentFocus);
        const nextPosition = focus.clone().add(offset);

        this.cameraControls.reset(focus, nextPosition);
        this.fitCameraClipPlanes();
        this.renderNextFrame();
    }

    private normalizePoiCameraView(view: PoiCameraView | null | undefined, fallbackFov: number): PoiObserverView | null {
        const isTriple = (value: unknown): value is [number, number, number] => Array.isArray(value) &&
            value.length >= 3 && value.slice(0, 3).every(n => typeof n === 'number' && Number.isFinite(n));
        if (!isTriple(view?.position) || !isTriple(view?.focus)) return null;

        const rawFov = typeof view.fov === 'number' && Number.isFinite(view.fov) ? view.fov : fallbackFov;
        return {
            position: new Vec3(view.position[0], view.position[1], view.position[2]),
            focus: new Vec3(view.focus[0], view.focus[1], view.focus[2]),
            fov: math.clamp(rawFov, 1, 179)
        };
    }

    private getActivePoiCameraView(): PoiCameraView | null {
        try {
            const list = JSON.parse(String(this.observer.get('poi.list') ?? '[]')) as Array<{ id?: string; camera?: PoiCameraView }>;
            if (!Array.isArray(list)) return null;
            const activeId = String(this.observer.get('poi.activeId') ?? '');
            return list.find(poi => poi?.id === activeId)?.camera ?? null;
        } catch {
            return null;
        }
    }

    /**
     * Toggle the external POI camera. In this mode tour navigation drives only a virtual
     * frustum while the user's orbit camera remains enabled and independent.
     *
     * @param enabled - Whether the external observer is active.
     */
    setPoiObserverMode(enabled: boolean) {
        const next = !!enabled;
        if (this.poiObserverMode === next) return;

        this.poiObserverMode = next;
        this.poiObserverTransition = null;
        this.pausedPoiObserverFly = null;
        if (next) {
            // A half-finished regular POI flight must not keep ownership of the user camera.
            this.pausedCameraFly = null;
            if (this.cameraFlyTransition || this.doubleClickZoomTransition) this.stopCameraFlyTransition();
            const selected = this.normalizePoiCameraView(this.getActivePoiCameraView(), this.camera.camera.fov);
            this.poiObserverView = selected ?? {
                position: this.cameraControls.getPosition(),
                focus: this.cameraControls.getFocus(),
                fov: this.camera.camera.fov
            };
        } else {
            this.poiObserverView = null;
        }
        this.renderNextFrame();
    }

    /**
     * Small read-only snapshot used by diagnostics and browser regression tests.
     *
     * @returns Current external-observer state and virtual camera pose.
     */
    getPoiObserverState() {
        const view = this.poiObserverView;
        return {
            enabled: this.poiObserverMode,
            transitioning: !!this.poiObserverTransition,
            position: view ? [view.position.x, view.position.y, view.position.z] : null,
            focus: view ? [view.focus.x, view.focus.y, view.focus.z] : null,
            fov: view?.fov ?? null
        };
    }

    private applyPoiCameraView(view: PoiCameraView, duration = 1.0) {
        if (this.poiObserverMode) {
            this.flyPoiObserverCameraTo(view, duration);
        } else {
            this.flyToCameraView(view, duration);
        }
    }

    private flyPoiObserverCameraTo(view: PoiCameraView, duration = 1.0) {
        const target = this.normalizePoiCameraView(view, this.poiObserverView?.fov ?? this.camera.camera.fov);
        if (!target) {
            this.renderNextFrame();
            return;
        }
        const current = this.poiObserverView ?? {
            position: this.cameraControls.getPosition(),
            focus: this.cameraControls.getFocus(),
            fov: this.camera.camera.fov
        };
        this.pausedPoiObserverFly = null;
        this.poiObserverTransition = {
            elapsed: 0,
            duration: Math.max(0.01, Number.isFinite(duration) ? duration : 1),
            startPosition: current.position.clone(),
            startFocus: current.focus.clone(),
            startFov: current.fov,
            endPosition: target.position,
            endFocus: target.focus,
            endFov: target.fov
        };
        this.poiObserverView = {
            position: current.position.clone(),
            focus: current.focus.clone(),
            fov: current.fov
        };
        this.renderNextFrame();
    }

    flyToCameraView(view: PoiCameraView, duration = 1.0) {
        // Ракурсы точек интереса приходят из `.model-viewer-settings.json`, а его пишет
        // пользователь и может править руками. Точка с недописанным `camera` (скажем,
        // `{}` или обрезанным массивом) раньше валила вьюер прямо здесь, на `position[0]`.
        // Теперь такой ракурс считаем несохранённым: точка становится активной, камера
        // остаётся на месте — ровно как у точки, у которой вида и не было.
        const target = this.normalizePoiCameraView(view, this.camera.camera.fov);
        if (!target) {
            this.renderNextFrame();
            return;
        }

        this.stopCameraFlyTransition();
        this.cameraFlyTransition = {
            elapsed: 0,
            duration: Math.max(0.01, Number.isFinite(duration) ? duration : 1),
            startPosition: this.cameraControls.getPosition(),
            startFocus: this.cameraControls.getFocus(),
            startFov: this.camera.camera.fov,
            endPosition: target.position,
            endFocus: target.focus,
            endFov: target.fov
        };
        this.cameraControls.enabled = false;
        this.renderNextFrame();
    }

    private stopCameraFlyTransition() {
        this.cameraFlyTransition = null;
        this.doubleClickZoomTransition = null;
        this.cameraControls.enabled = true;
    }

    /**
     * Мгновенно заморозить текущий перелёт камеры (пауза тура): камера остаётся там,
     * где оказалась, а цель и остаток времени сохраняются для последующего resume.
     * Возвращает остаток секунд перелёта (0, если перелёта не было).
     *
     * @returns Остаток времени перелёта в секундах.
     */
    pauseCameraFly(): number {
        if (this.poiObserverMode) {
            const tr = this.poiObserverTransition;
            if (!tr) {
                this.pausedPoiObserverFly = null;
                return 0;
            }
            const remaining = Math.max(0, tr.duration - tr.elapsed);
            this.pausedPoiObserverFly = {
                position: [tr.endPosition.x, tr.endPosition.y, tr.endPosition.z],
                focus: [tr.endFocus.x, tr.endFocus.y, tr.endFocus.z],
                fov: tr.endFov,
                remaining
            };
            this.poiObserverTransition = null;
            this.renderNextFrame();
            return remaining;
        }
        const tr = this.cameraFlyTransition;
        if (!tr) {
            this.pausedCameraFly = null;
            if (this.doubleClickZoomTransition) this.stopCameraFlyTransition();
            return 0;
        }
        const remaining = Math.max(0, tr.duration - tr.elapsed);
        this.pausedCameraFly = {
            position: [tr.endPosition.x, tr.endPosition.y, tr.endPosition.z],
            focus: [tr.endFocus.x, tr.endFocus.y, tr.endFocus.z],
            fov: tr.endFov,
            remaining
        };
        this.stopCameraFlyTransition();
        return remaining;
    }

    /** Продолжить прерванный паузой перелёт к той же цели за оставшееся время. */
    resumeCameraFly() {
        if (this.poiObserverMode) {
            const paused = this.pausedPoiObserverFly;
            this.pausedPoiObserverFly = null;
            if (!paused || paused.remaining <= 0.001) return;
            this.flyPoiObserverCameraTo({ position: paused.position, focus: paused.focus, fov: paused.fov }, paused.remaining);
            return;
        }
        const paused = this.pausedCameraFly;
        this.pausedCameraFly = null;
        if (!paused || paused.remaining <= 0.001) return;
        this.flyToCameraView({ position: paused.position, focus: paused.focus, fov: paused.fov }, paused.remaining);
    }

    /** Полностью отменить перелёт камеры (Stop тура): без снапа к цели. */
    cancelCameraFly() {
        this.pausedCameraFly = null;
        this.pausedPoiObserverFly = null;
        this.poiObserverTransition = null;
        if (this.cameraFlyTransition) this.stopCameraFlyTransition();
        this.renderNextFrame();
    }

    private updateCameraFlyTransition(dt: number) {
        if (!this.cameraFlyTransition) {
            return;
        }

        const transition = this.cameraFlyTransition;
        transition.elapsed = Math.min(transition.elapsed + dt, transition.duration);
        const alpha = transition.elapsed / transition.duration;
        const eased = alpha * alpha * (3 - 2 * alpha);

        const position = transition.startPosition.clone().lerp(transition.startPosition, transition.endPosition, eased);
        const focus = transition.startFocus.clone().lerp(transition.startFocus, transition.endFocus, eased);
        this.camera.camera.fov = math.lerp(transition.startFov, transition.endFov, eased);
        this.cameraControls.reset(focus, position);
        this.renderNextFrame();

        if (alpha >= 1) {
            this.observer.set('camera.fov', transition.endFov);
            this.fitCameraClipPlanes();
            this.stopCameraFlyTransition();
        }
    }

    private updatePoiObserverTransition(dt: number) {
        const transition = this.poiObserverTransition;
        const view = this.poiObserverView;
        if (!transition || !view) return;

        transition.elapsed = Math.min(transition.elapsed + dt, transition.duration);
        const alpha = transition.elapsed / transition.duration;
        const eased = alpha * alpha * (3 - 2 * alpha);
        view.position.lerp(transition.startPosition, transition.endPosition, eased);
        view.focus.lerp(transition.startFocus, transition.endFocus, eased);
        view.fov = math.lerp(transition.startFov, transition.endFov, eased);
        this.renderNextFrame();

        if (alpha >= 1) this.poiObserverTransition = null;
    }

    private updateDoubleClickZoomTransition(dt: number) {
        const transition = this.doubleClickZoomTransition;
        if (!transition) return;

        transition.elapsed = Math.min(transition.elapsed + dt, transition.duration);
        const alpha = transition.elapsed / transition.duration;
        const eased = 1 - Math.pow(1 - alpha, 3);
        const orbitDistance = math.lerp(transition.startOrbitDistance, transition.endOrbitDistance, eased);
        const position = this.doubleClickZoomPosition.copy(transition.zoomDirection);
        position.mulScalar(transition.travelDistance * eased).add(transition.startPosition);
        const focus = this.doubleClickZoomFocus.copy(transition.viewDirection);
        focus.mulScalar(orbitDistance).add(position);

        this.cameraControls.reset(focus, position);
        this.renderNextFrame();

        if (alpha >= 1) {
            this.fitCameraClipPlanes();
            this.stopCameraFlyTransition();
        }
    }

    private getSceneTransform() {
        return {
            position: [...this.sceneTransform.position],
            rotation: [...this.sceneTransform.rotation],
            scale: [...this.sceneTransform.scale],
            pivotOffset: [...this.sceneTransform.pivotOffset]
        };
    }

    private applySceneTransform(transform: Record<string, unknown>) {
        const vec3From = (value: unknown, fallback: [number, number, number]): [number, number, number] => {
            if (!Array.isArray(value) || value.length < 3) {
                return fallback;
            }
            return value.slice(0, 3).map((entry, index) => {
                const n = Number(entry);
                return Number.isFinite(n) ? n : fallback[index];
            }) as [number, number, number];
        };

        this.sceneTransform = {
            position: vec3From(transform.position, [0, 0, 0]),
            rotation: vec3From(transform.rotation, [0, 0, 0]),
            scale: vec3From(transform.scale, [1, 1, 1]),
            pivotOffset: vec3From(transform.pivotOffset, [0, 0, 0])
        };
        this.setCenterScene(this.observer.get('centerScene'));
    }

    private resetSceneTransform() {
        const previousTransform = this.captureSceneContentTransform();
        this.sceneTransform = {
            position: [0, 0, 0],
            rotation: [0, 0, 0],
            scale: [1, 1, 1],
            pivotOffset: [0, 0, 0]
        };
        this.setCenterScene(this.observer.get('centerScene'));
        this.transformPoisBetween(previousTransform, this.captureSceneContentTransform());
    }

    setObjectToCenter() {
        const previousTransform = this.captureSceneContentTransform();
        this.tileManager?.syncTransform();
        if (!this.tileManager?.getGeometryBounds(this.sceneBounds)) {
            this.calcSceneBounds(this.sceneBounds);
        }
        const center = this.sceneBounds.center;
        const position = this.sceneTransform.position;
        this.sceneTransform = {
            ...this.sceneTransform,
            position: [
                position[0] - center.x,
                position[1] - center.y,
                position[2] - center.z
            ]
        };
        this.sceneRoot.setLocalPosition(
            this.sceneTransform.position[0],
            this.sceneTransform.position[1],
            this.sceneTransform.position[2]
        );
        this.dirtyBounds = true;
        this.transformPoisBetween(previousTransform, this.captureSceneContentTransform());
        this.renderNextFrame();
    }

    setObjectPivotToCenter() {
        this.tileManager?.syncTransform();
        if (!this.tileManager?.getGeometryBounds(this.sceneBounds)) {
            this.calcSceneBounds(this.sceneBounds);
        }
        this.setObjectPivotToWorldPosition(this.sceneBounds.center.clone());
    }

    /**
     * Move the transform pivot to a world position, keeping the geometry where it is.
     *
     * @param pivotWorldPosition - Target world position for the pivot.
     */
    setObjectPivotToWorldPosition(pivotWorldPosition: Vec3) {
        const previousTransform = this.captureSceneContentTransform();
        const contentWorldPosition = this.sceneContentRoot.getPosition().clone();

        // sceneRoot is the transform gizmo pivot. Move it to the requested position,
        // then compensate on sceneContentRoot so the geometry stays in place.
        this.sceneRoot.setPosition(pivotWorldPosition);
        this.sceneContentRoot.setPosition(contentWorldPosition);

        this.commitPivotTransformFromEntities();
        this.transformPoisBetween(previousTransform, this.captureSceneContentTransform());
        this.setAlignmentGizmoMode(this.observer.get('debug.alignmentGizmoMode') ?? 'rotate');
        this.renderNextFrame();
    }

    /**
     * Write the current sceneRoot/sceneContentRoot split back into sceneTransform as
     * position + pivotOffset. The entities must already be positioned; this only records
     * the result so setCenterScene() can rebuild the same hierarchy later.
     */
    private commitPivotTransformFromEntities() {
        const centered = this.observer.get('centerScene');
        const rootPosition = this.sceneRoot.getLocalPosition();
        const contentPosition = this.sceneContentRoot.getLocalPosition().clone();
        let pivotOffset: [number, number, number] = [
            -contentPosition.x,
            -contentPosition.y,
            -contentPosition.z
        ];

        // Preserve the same hierarchy if automatic scene centering is enabled and
        // setCenterScene() reconstructs the transform later.
        if (centered) {
            this.sceneContentRoot.setLocalPosition(0, 0, 0);
            this.calcSceneBounds(this.sceneBounds);
            pivotOffset = [
                -this.sceneBounds.center.x - contentPosition.x,
                -this.sceneBounds.getMin().y - contentPosition.y,
                -this.sceneBounds.center.z - contentPosition.z
            ];
            this.sceneContentRoot.setLocalPosition(contentPosition);
        }

        this.sceneTransform = {
            ...this.sceneTransform,
            position: [rootPosition.x, rootPosition.y, rootPosition.z],
            pivotOffset
        };
        this.dirtyBounds = true;
    }

    /**
     * Put the pivot back on the model's own origin. The geometry stays where it is —
     * only the transform origin moves, which is what the user expects from a pivot reset.
     */
    resetObjectPivot() {
        this.setObjectPivotToWorldPosition(this.sceneContentRoot.getPosition().clone());
    }

    resetObjectTransform() {
        this.resetSceneTransform();
    }

    private getOrCreateHelperEntity(id: string) {
        let entity = this.helperEntities.get(id);
        if (!entity) {
            entity = new Entity(`helper:${id}`);
            this.app.root.addChild(entity);
            this.helperEntities.set(id, entity);
        }
        return entity;
    }

    setHelper(helper: SceneHelperEntry) {
        const entity = this.getOrCreateHelperEntity(helper.id);
        entity.setLocalPosition(helper.position[0], helper.position[1], helper.position[2]);
        this.microphoneController?.setHelper(helper);
        this.renderNextFrame();
    }

    setHelpers(helpers: SceneHelperEntry[]) {
        const activeIds = new Set(helpers.map(helper => helper.id));
        helpers.forEach(helper => this.setHelper(helper));
        [...this.helperEntities.entries()].forEach(([id, entity]) => {
            if (!activeIds.has(id)) {
                entity.destroy();
                this.helperEntities.delete(id);
            }
        });
        this.microphoneController?.setHelpers(helpers);
        this.renderNextFrame();
    }

    clearHelpers(group?: string) {
        [...this.helperEntities.entries()].forEach(([id, entity]) => {
            const helper = this.microphoneController?.getHelper(id);
            if (!group || helper?.group === group || helper?.type === group) {
                entity.destroy();
                this.helperEntities.delete(id);
            }
        });
        this.microphoneController?.clearHelpers(group);
        if (this.activeHelperId && !this.helperEntities.has(this.activeHelperId)) {
            this.activeHelperId = null;
            this.observer.set('helpers.activeId', '');
        }
        this.setAlignmentGizmoMode(this.observer.get('debug.alignmentGizmoMode') ?? 'rotate');
        this.renderNextFrame();
    }

    private getAlignmentTarget(): 'model' | 'helper' | 'box' | 'pivot' {
        const target = this.observer.get('debug.alignmentTarget');
        return target === 'helper' || target === 'box' || target === 'pivot' ? target : 'model';
    }

    selectHelper(id: string | null) {
        const helperId = id && this.helperEntities.has(id) ? id : null;
        this.activeHelperId = helperId;
        if (this.observer.get('helpers.activeId') !== (helperId ?? '')) {
            this.observer.set('helpers.activeId', helperId ?? '');
        }
        this.setAlignmentGizmoMode(this.observer.get('debug.alignmentGizmoMode') ?? 'rotate');
        this.renderNextFrame();
    }

    private syncActiveHelperFromEntity(emit: boolean) {
        if (!this.activeHelperId) return;
        const entity = this.helperEntities.get(this.activeHelperId);
        if (!entity) return;
        const position = entity.getLocalPosition();
        this.microphoneController?.updateHelperPosition(this.activeHelperId, {
            x: position.x,
            y: position.y,
            z: position.z
        });
        if (emit) {
            postToViewerParent({
                type: 'helper:moved',
                id: this.activeHelperId,
                position: { x: position.x, y: position.y, z: position.z }
            });
        }
    }

    private isImportableHelperName(name: string) {
        return MIC_HELPER_NODE_RE.test(name) || MIC_CAMEL_HELPER_NODE_RE.test(name);
    }

    private helperIdFromNodeName(name: string, usedIds: Set<string>) {
        const base = name
        .trim()
        .replace(/[^\w-]+/g, '_')
        .replace(/^_+|_+$/g, '') || 'mic_helper';
        let id = base;
        let index = 2;
        while (usedIds.has(id)) {
            id = `${base}_${index}`;
            index += 1;
        }
        usedIds.add(id);
        return id;
    }

    private entityHasRenderableComponent(entity: Entity) {
        return !!(
            entity.findComponent('render') ||
            entity.findComponent('model') ||
            entity.findComponent('gsplat') ||
            entity.findComponent('camera') ||
            entity.findComponent('light')
        );
    }

    private collectImportedHelpers() {
        const helpers: SceneHelperEntry[] = [];
        const usedIds = new Set<string>();

        const visit = (node: GraphNode) => {
            const entity = node instanceof Entity ? node : null;
            const name = String(node.name ?? '').trim();
            if (
                entity &&
                name &&
                this.isImportableHelperName(name) &&
                !name.startsWith('helper:') &&
                !this.entityHasRenderableComponent(entity)
            ) {
                const position = entity.getPosition();
                helpers.push({
                    id: this.helperIdFromNodeName(name, usedIds),
                    name,
                    type: 'audio-source',
                    group: 'mic',
                    color: '#f5b642',
                    position: [position.x, position.y, position.z]
                });
            }
            node.children.forEach(visit);
        };

        this.entities.forEach(visit);
        return helpers;
    }

    private importHelpersFromScene() {
        const helpers = this.collectImportedHelpers();
        if (helpers.length === 0) return;

        const currentHelpers = [...this.helperEntities.keys()]
        .map(id => this.microphoneController?.getHelper(id))
        .filter((helper): helper is SceneHelperEntry => !!helper && helper.group !== 'mic');

        this.setHelpers([...currentHelpers, ...helpers]);
        this.observer.set('helpers.group', 'mic');
        postToViewerParent({
            type: 'helper:imported',
            helpers: helpers.map(helper => ({
                id: helper.id,
                name: helper.name,
                type: helper.type,
                group: helper.group,
                color: helper.color,
                position: {
                    x: helper.position[0],
                    y: helper.position[1],
                    z: helper.position[2]
                }
            }))
        });
    }

    setDimensionBoxFromModelBounds() {
        this.calcSceneBounds(this.dynamicSceneBounds);
        const size: [number, number, number] = [
            Math.max(0.000001, this.dynamicSceneBounds.halfExtents.x * 2),
            Math.max(0.000001, this.dynamicSceneBounds.halfExtents.y * 2),
            Math.max(0.000001, this.dynamicSceneBounds.halfExtents.z * 2)
        ];
        const center: [number, number, number] = [
            this.dynamicSceneBounds.center.x,
            this.dynamicSceneBounds.center.y,
            this.dynamicSceneBounds.center.z
        ];
        this.observer.set('dimensionBox.size', size);
        this.observer.set('dimensionBox.center', center);
        this.observer.set('dimensionBox.rotation', [0, 0, 0]);
        this.observer.set('dimensionBox.initialized', true);
        this.observer.set('dimensionBox.enabled', true);
        this.syncDimensionBoxEntityFromObserver();
        this.setAlignmentGizmoMode(this.observer.get('debug.alignmentGizmoMode') ?? 'rotate');
        postToViewerParent({ type: 'dimensionbox-changed' });
        this.dirtyBounds = true;
        this.renderNextFrame();
    }

    /**
     * Углы AABB всей загруженной геометрии в мировых координатах — облако точек для
     * подгонки ориентированного бокса. Для тайлсета берутся все `loaded` тайлы, для
     * обычной модели — её mesh instances.
     *
     * @returns Углы AABB в мировых координатах.
     */
    private collectGeometryCorners(): Vec3[] {
        const points: Vec3[] = [];
        const addAabb = (aabb: BoundingBox) => {
            const c = aabb.center;
            const h = aabb.halfExtents;
            for (let sx = -1; sx <= 1; sx += 2) {
                for (let sy = -1; sy <= 1; sy += 2) {
                    for (let sz = -1; sz <= 1; sz += 2) {
                        points.push(new Vec3(c.x + sx * h.x, c.y + sy * h.y, c.z + sz * h.z));
                    }
                }
            }
        };
        const meshInstances = this.tileManager ?
            this.tileManager.getLoadedMeshInstances() :
            this.meshInstances;
        meshInstances.forEach(mi => addAabb(mi.aabb));
        return points;
    }

    /**
     * Обтянуть alignment-бокс по контуру модели: бокс остаётся вертикальным (up = Y),
     * но разворачивается вокруг Y так, чтобы аккуратно встать по широкой стороне модели.
     * Ориентация берётся из PCA горизонтальной проекции (XZ), затем считаются плотные
     * габариты вдоль повёрнутых осей. Если геометрия ещё не загрузилась — откат на
     * осевой бокс по границам модели.
     */
    setDimensionBoxFittedToModel() {
        this.tileManager?.syncTransform();
        const points = this.collectGeometryCorners();
        if (points.length < 2) {
            this.setDimensionBoxFromModelBounds();
            return;
        }

        const n = points.length;
        let cx = 0;
        let cz = 0;
        for (const p of points) {
            cx += p.x;
            cz += p.z;
        }
        cx /= n;
        cz /= n;

        // Ковариация горизонтальной проекции → угол главной оси (широкой стороны).
        let sxx = 0;
        let sxz = 0;
        let szz = 0;
        for (const p of points) {
            const dx = p.x - cx;
            const dz = p.z - cz;
            sxx += dx * dx;
            sxz += dx * dz;
            szz += dz * dz;
        }
        const theta = 0.5 * Math.atan2(2 * sxz, sxx - szz);
        const cos = Math.cos(theta);
        const sin = Math.sin(theta);

        // Плотные габариты вдоль повёрнутых осей u (главная) / v и вертикали Y.
        let uMin = Infinity;
        let uMax = -Infinity;
        let vMin = Infinity;
        let vMax = -Infinity;
        let yMin = Infinity;
        let yMax = -Infinity;
        for (const p of points) {
            const dx = p.x - cx;
            const dz = p.z - cz;
            const u = dx * cos + dz * sin;
            const v = -dx * sin + dz * cos;
            if (u < uMin) uMin = u;
            if (u > uMax) uMax = u;
            if (v < vMin) vMin = v;
            if (v > vMax) vMax = v;
            if (p.y < yMin) yMin = p.y;
            if (p.y > yMax) yMax = p.y;
        }

        const uc = (uMin + uMax) * 0.5;
        const vc = (vMin + vMax) * 0.5;
        const center: [number, number, number] = [
            cx + uc * cos - vc * sin,
            (yMin + yMax) * 0.5,
            cz + uc * sin + vc * cos
        ];
        const size: [number, number, number] = [
            Math.max(0.000001, uMax - uMin),
            Math.max(0.000001, yMax - yMin),
            Math.max(0.000001, vMax - vMin)
        ];
        // Euler-Y для right-handed Y-up: локальная +X = (cos a, 0, -sin a); чтобы она
        // совпала с осью u = (cos θ, 0, sin θ), берём a = -θ.
        const rotationY = -theta * math.RAD_TO_DEG;

        this.observer.set('dimensionBox.size', size);
        this.observer.set('dimensionBox.center', center);
        this.observer.set('dimensionBox.rotation', [0, rotationY, 0]);
        this.observer.set('dimensionBox.initialized', true);
        this.observer.set('dimensionBox.enabled', true);
        this.syncDimensionBoxEntityFromObserver();
        this.setAlignmentGizmoMode(this.observer.get('debug.alignmentGizmoMode') ?? 'rotate');
        postToViewerParent({ type: 'dimensionbox-changed' });
        this.dirtyBounds = true;
        this.renderNextFrame();
    }

    private dimensionBoxTuple(path: string, fallback: [number, number, number]): [number, number, number] {
        const value = this.observer.get(path) as number[] | undefined;
        if (!Array.isArray(value) || value.length < 3) return fallback;
        return [0, 1, 2].map((index) => {
            const channel = Number(value[index]);
            return Number.isFinite(channel) ? channel : fallback[index];
        }) as [number, number, number];
    }

    private syncDimensionBoxEntityFromObserver() {
        if (!this.dimensionBoxEntity) return;
        const center = this.dimensionBoxTuple('dimensionBox.center', [0, 0, 0]);
        const size = this.dimensionBoxTuple('dimensionBox.size', [1, 1, 1]);
        const rotation = this.dimensionBoxTuple('dimensionBox.rotation', [0, 0, 0]);
        this.dimensionBoxEntity.setPosition(center[0], center[1], center[2]);
        this.dimensionBoxEntity.setEulerAngles(rotation[0], rotation[1], rotation[2]);
        this.dimensionBoxEntity.setLocalScale(
            Math.max(0.000001, Math.abs(size[0])),
            Math.max(0.000001, Math.abs(size[1])),
            Math.max(0.000001, Math.abs(size[2]))
        );
    }

    private syncDimensionBoxObserverFromEntity() {
        if (!this.dimensionBoxEntity) return;
        const center = this.dimensionBoxEntity.getPosition();
        const size = this.dimensionBoxEntity.getLocalScale();
        const rotation = this.dimensionBoxEntity.getEulerAngles();
        this.observer.set('dimensionBox.center', [center.x, center.y, center.z]);
        this.observer.set('dimensionBox.size', [
            Math.max(0.000001, Math.abs(size.x)),
            Math.max(0.000001, Math.abs(size.y)),
            Math.max(0.000001, Math.abs(size.z))
        ]);
        this.observer.set('dimensionBox.rotation', [rotation.x, rotation.y, rotation.z]);
        this.observer.set('dimensionBox.initialized', true);
        this.observer.set('dimensionBox.enabled', true);
        this.dirtyBounds = true;
        this.renderNextFrame();
    }

    /**
     * Жёсткий стандартный вид камеры: top/bottom/front/back/left/right.
     *
     * @param view - Имя вида: `top`, `bottom`, `front`, `back`, `left` или `right`.
     */
    setStandardView(view: string) {
        const bbox = new BoundingBox();
        this.calcSceneBounds(bbox);
        const center = bbox.center.clone();
        const radius = Math.max(bbox.halfExtents.x, bbox.halfExtents.y, bbox.halfExtents.z, 0.001);
        const dist = radius * 4;
        const dirs: Record<string, [number, number, number]> = {
            top: [0, 1, 0],
            bottom: [0, -1, 0],
            front: [0, 0, 1],
            back: [0, 0, -1],
            right: [1, 0, 0],
            left: [-1, 0, 0]
        };
        const d = dirs[view] || dirs.front;
        const pos = new Vec3(center.x + d[0] * dist, center.y + d[1] * dist, center.z + d[2] * dist);
        this.cameraControls.reset(center, pos);
        if (this.camera.camera.projection === 1) {
            this.camera.camera.orthoHeight = radius * 1.2;
        }
        this.renderNextFrame();
    }

    /**
     * Тип проекции камеры: ortho (true) / perspective (false).
     *
     * @param ortho - `true` — ортогональная проекция, `false` — перспективная.
     */
    setCameraProjection(ortho: boolean) {
        this.camera.camera.projection = ortho ? 1 : 0; // 1 = ORTHOGRAPHIC, 0 = PERSPECTIVE
        if (this.observer.get('camera.ortho') !== ortho) {
            this.observer.set('camera.ortho', ortho);
        }
        if (ortho) {
            const bbox = new BoundingBox();
            this.calcSceneBounds(bbox);
            const radius = Math.max(bbox.halfExtents.x, bbox.halfExtents.y, bbox.halfExtents.z, 0.001);
            this.camera.camera.orthoHeight = radius * 1.2;
        }
        this.renderNextFrame();
    }

    /**
     * Текущая проекция камеры ортогональна?
     *
     * @returns `true`, если камера в ортогональной проекции.
     */
    isOrthographic(): boolean {
        return this.camera.camera.projection === 1;
    }

    /** Навигационный куб (создаётся скрытым, показывается в режиме выравнивания). */
    private initViewCube() {
        // Отказоустойчиво: если ViewCube недоступен/падает — НЕ роняем весь вьюер
        // (иначе модели перестают грузиться). Куб опционален.
        try {
            const wrapper = document.getElementById('canvas-wrapper');
            if (!wrapper) return;
            if (typeof ViewCube !== 'function') return;

            // Куб ориентации в правом верхнем углу. Клик по грани → выравнивание камеры.
            this.viewCube = new ViewCube(new Vec4(1, 1, 0, 0));
            this.viewCube.dom.style.position = 'absolute';
            this.viewCube.dom.style.zIndex = '24';
            this.viewCube.dom.style.display = 'none';
            wrapper.appendChild(this.viewCube.dom);
            this.viewCube.on(ViewCube.EVENT_CAMERAALIGN, (dir: Vec3) => this.alignCameraToDir(dir));

            // Кнопка проекции стоит под кубом и центруется по нему. Размер куба считается из
            // его собственных радиуса и длины осей, поэтому отдаём его в CSS переменной, а не
            // хардкодим отступы: при другом размере куба кнопка не наедет на оси.
            const cubeSize = parseFloat(this.viewCube.dom.style.width) || this.viewCube.dom.offsetWidth;
            if (cubeSize > 0) {
                wrapper.style.setProperty('--view-cube-size', `${cubeSize}px`);
            }
        } catch (e) {

            console.warn('ViewCube init failed (пропускаем, плеер работает):', e);
            this.viewCube = null;
        }
    }

    /**
     * Показать/скрыть навигационный куб. Переключатель проекции живёт рядом с ним в React
     * и следит за тем же флагом `camera.viewCube`.
     *
     * @param visible - Показывать ли куб.
     */
    setViewCubeVisible(visible: boolean) {
        if (this.viewCube) this.viewCube.dom.style.display = visible ? '' : 'none';
        if (this.observer.get('camera.viewCube') !== visible) {
            this.observer.set('camera.viewCube', visible);
        }
        // Переключатель проекции скрывается вместе с кубом, поэтому оставить камеру в
        // ортографии значило бы отобрать у пользователя способ вернуть перспективу.
        if (!visible && this.isOrthographic()) {
            this.setCameraProjection(false);
        }
    }

    /**
     * Куб ориентации нужен в выравнивании, изолированном просмотре, визуализации тайлов и
     * инспекторе камеры. В изолированном просмотре он особенно уместен: срезы ставят по
     * стандартным видам сверху/спереди/сбоку и в ортографии.
     */
    private updateViewCubeVisibility() {
        const visible = !!this.observer.get('debug.alignmentMode') ||
            this.observer.get('ui.active') === 'fragment' ||
            (!!this.observer.get('scene.isTileset') &&
                (!!this.observer.get('debug.tileDebug') || !!this.observer.get('debug.tileFreeze')));
        this.setViewCubeVisible(visible);
    }

    /**
     * Выровнять камеру по направлению (от ViewCube): сохраняем дистанцию орбиты.
     *
     * @param dir - Направление взгляда в мировых координатах.
     */
    private alignCameraToDir(dir: Vec3) {
        const bbox = new BoundingBox();
        this.calcSceneBounds(bbox);
        const center = bbox.center.clone();
        const radius = Math.max(bbox.halfExtents.x, bbox.halfExtents.y, bbox.halfExtents.z, 0.001);
        const dist = radius * 4;
        const pos = new Vec3(center.x + dir.x * dist, center.y + dir.y * dist, center.z + dir.z * dist);
        this.cameraControls.reset(center, pos);
        this.renderNextFrame();
    }

    rotateSelectedObject() {
        this.sceneTransform = {
            ...this.sceneTransform,
            rotation: [
                this.sceneTransform.rotation[0],
                this.sceneTransform.rotation[1] + 90,
                this.sceneTransform.rotation[2]
            ]
        };
        this.setCenterScene(this.observer.get('centerScene'));
    }

    // load gltf model given its url and list of external urls
    private loadGltf(
        gltfUrl: File,
        externalUrls: Array<File>,
        warnings: string[],
        onProgress?: (progress: number) => void,
        onTexture?: (seenDelta: number, doneDelta: number) => void
    ) {
        return new Promise((resolve, reject) => {
        // provide buffer view callback so we can handle models compressed with MeshOptimizer
        // https://github.com/zeux/meshoptimizer
            const processBufferView = (
                gltfBuffer: GltfBufferLike,
                buffers: Array<Uint8Array>,
                continuation: AssetProcessContinuation
            ) => {
                if (gltfBuffer.extensions?.EXT_meshopt_compression) {
                    const extensionDef = gltfBuffer.extensions.EXT_meshopt_compression;

                    Promise.all([loadMeshoptDecoder(), buffers[extensionDef.buffer]]).then(([decoder, buffer]) => {
                        const byteOffset = extensionDef.byteOffset || 0;
                        const byteLength = extensionDef.byteLength || 0;

                        const count = extensionDef.count;
                        const stride = extensionDef.byteStride;

                        const result = new Uint8Array(count * stride);
                        const source = new Uint8Array(buffer.buffer, buffer.byteOffset + byteOffset, byteLength);

                        decoder.decodeGltfBuffer(
                            result,
                            count,
                            stride,
                            source,
                            extensionDef.mode,
                            extensionDef.filter
                        );

                        continuation(null, result);
                    })
                    .catch((err) => {
                        // Раньше сюда было не попасть: декодер уже лежал в бандле. Теперь он
                        // догружается по сети, и без этой ветки сорванная догрузка оставила бы
                        // разбор glTF ждать continuation вечно — те самые молчаливые 98%.
                        continuation(`Не удалось распаковать геометрию (meshopt): ${err}`, null);
                    });
                } else {
                    continuation(null, null);
                }
            };

            const createPlaceholderTexture = (name: string) => {
            // Create a small placeholder texture (magenta to indicate missing texture)
                const texture = new Texture(this.app.graphicsDevice, {
                    name: `placeholder-${name}`,
                    width: 2,
                    height: 2,
                    format: PIXELFORMAT_RGBA8
                });
                // Fill with magenta color to indicate missing texture
                const pixels = texture.lock();
                for (let i = 0; i < 4; i++) {
                    pixels[i * 4 + 0] = 255; // R
                    pixels[i * 4 + 1] = 0;   // G
                    pixels[i * 4 + 2] = 255; // B
                    pixels[i * 4 + 3] = 255; // A
                }
                texture.unlock();

                const asset = new Asset(name, 'texture', null, null);
                asset.resource = texture;
                asset.loaded = true;
                this.app.assets.add(asset);
                return asset;
            };

            const processImage = (gltfImage: GltfImageLike, continuation: AssetProcessContinuation) => {
                const u: File = externalUrls.find((url) => {
                    return url.filename === decodeURIComponent(path.normalize(gltfImage.uri || ''));
                });
                if (u) {
                    const textureAsset = new Asset(u.filename, 'texture', {
                        url: u.url,
                        filename: u.filename
                    });
                    textureAsset.on('load', () => {
                        continuation(null, textureAsset);
                    });
                    textureAsset.on('error', (err: string) => {
                    // Texture failed to load - warn but continue with placeholder
                        warnings.push(`Failed to load texture '${u.filename}': ${err}`);
                        continuation(null, createPlaceholderTexture(u.filename));
                    });
                    this.app.assets.add(textureAsset);
                    this.app.assets.load(textureAsset);
                } else if (gltfImage.uri && !gltfImage.uri.startsWith('data:')) {
                // External texture referenced but not provided - warn but continue with placeholder
                    warnings.push(`External texture not found: '${gltfImage.uri}'`);
                    continuation(null, createPlaceholderTexture(gltfImage.uri));
                } else {
                    continuation(null, null);
                }
            };

            const postProcessTexture = (gltfTexture: GltfTextureLike, textureAsset: Asset) => {
            // Set max anisotropy only for textures that use linear filtering, as anisotropic
            // filtering only makes sense with linear filtering modes
                const texture = textureAsset.resource as Texture;
                if (texture.minFilter !== FILTER_NEAREST && texture.magFilter !== FILTER_NEAREST) {
                    texture.anisotropy = this.app.graphicsDevice.maxAnisotropy;
                }
            };

            const processBuffer = (gltfBuffer: GltfBufferLike, continuation: AssetProcessContinuation) => {
                const u = externalUrls.find((url) => {
                    return url.filename === decodeURIComponent(path.normalize(gltfBuffer.uri || ''));
                });
                if (u) {
                    const bufferAsset = new Asset(u.filename, 'binary', {
                        url: u.url,
                        filename: u.filename
                    });
                    bufferAsset.on('load', () => {
                        continuation(null, new Uint8Array(bufferAsset.resource as ArrayBuffer));
                    });
                    bufferAsset.on('error', (err: string) => {
                        continuation(`Failed to load buffer file '${u.filename}': ${err}`, null);
                    });
                    this.app.assets.add(bufferAsset);
                    this.app.assets.load(bufferAsset);
                } else if (gltfBuffer.uri && !gltfBuffer.uri.startsWith('data:')) {
                // External buffer file referenced but not provided
                // Check if only the current .gltf file was dragged (no other files provided)
                    const onlyGltfFile = externalUrls.length === 1 &&
                    this.isModelFilename(externalUrls[0].filename) &&
                    externalUrls[0].filename === gltfUrl.filename;
                    if (onlyGltfFile) {
                        continuation(`External buffer file '${gltfBuffer.uri}' not found. Try dragging the folder containing the .gltf file instead of the file itself.`, null);
                    } else {
                        continuation(`External buffer file not found: '${gltfBuffer.uri}'. Make sure to include the associated .bin file(s).`, null);
                    }
                } else {
                    continuation(null, null);
                }
            };

            const containerAssetOptions: AssetLoadProcessOptions = {
                bufferView: {
                    processAsync: processBufferView
                },
                image: {
                    processAsync: processImage
                },
                texture: {
                    postprocess: postProcessTexture
                },
                buffer: {
                    processAsync: processBuffer
                }
            };
            const containerAsset = new Asset(gltfUrl.filename, 'container', gltfUrl, null, {
                ...(containerAssetOptions as object)
            });
            // Картинки внутри .glb разбирает сам движок: сюда (`processImage`) он за ними не
            // заходит, поэтому считаем текстуры по реестру ассетов. Это единственный честный
            // прогресс между «файл скачан» и «первый кадр»: распаковка PNG и заливка в GPU.
            const onAssetAdd = (asset: Asset) => {
                if (asset.type !== 'texture' || asset.loaded) {
                    return;
                }
                // Вес — байты картинки, а не штука. Текстуры в одной модели отличаются на
                // порядки: у черепа карта нормалей 117 МБ из 152, и по счёту «одна из
                // четырёх» она даёт те же 25%, что и файл в 0.2 МБ. По байтам полоса
                // показывает, сколько работы действительно осталось.
                const weight = (asset.file as { contents?: ArrayBuffer } | undefined)?.contents?.byteLength || 1;
                onTexture?.(weight, 0);
                asset.once('load', () => onTexture?.(0, weight));
                asset.once('error', () => onTexture?.(0, weight));
            };
            if (onTexture) {
                this.app.assets.on('add', onAssetAdd);
            }
            const stopCountingTextures = () => {
                if (onTexture) {
                    this.app.assets.off('add', onAssetAdd);
                }
            };

            containerAsset.on('load', () => {
                stopCountingTextures();
                resolve(containerAsset);
            });
            containerAsset.on('error', (err: string) => {
                stopCountingTextures();
                reject(err);
            });
            this.attachSizeGuard(containerAsset, gltfUrl, reject, onProgress);
            this.app.assets.add(containerAsset);
            this.app.assets.load(containerAsset);
        })
        .catch(err => this.refineRemoteLoadError(gltfUrl, err));
    }

    private loadPly(url: File, externalUrls: Array<File>, onProgress?: (progress: number) => void) {
        if (this.isSpzFilename(url.filename ?? url.url ?? '')) {
            return this.loadSpzAsCompressedPly(url, onProgress)
            .catch(err => this.refineRemoteLoadError(url, err));
        }
        const urls: Record<string, string> = {};
        externalUrls.forEach((externalUrl) => {
            urls[externalUrl.filename] = externalUrl.url;
        });
        return new Promise((resolve, reject) => {
            const gsplatOptions: AssetLoadProcessOptions = {
                mapUrl: (mapUrl: string) => urls[mapUrl]
            };
            const asset = new Asset(url.filename, 'gsplat', url, null, {
                ...(gsplatOptions as object)
            });
            asset.on('load', () => resolve(asset));
            asset.on('error', (err: string) => reject(err));
            this.attachSizeGuard(asset, url, reject, onProgress);
            this.app.assets.add(asset);
            this.app.assets.load(asset);
        })
        .catch(err => this.refineRemoteLoadError(url, err));
    }

    /**
     * The SPZ codec instance, created on first use and shared afterwards (it carries a wasm
     * instance, so building one per file would be wasteful).
     *
     * @returns The initialised codec module.
     */
    private static getSpzCodec() {
        Viewer.spzCodec ??= import('@adobe/spz').then(module => module.default());
        return Viewer.spzCodec;
    }

    /**
     * Load an SPZ (Niantic) splat file by converting it to a compressed PLY in memory.
     *
     * The engine has no SPZ parser (checked through 2.22 beta), so instead of adding a second
     * gsplat code path we decode SPZ here and hand the engine the format its own PlyParser
     * already reads. The asset gets a `.compressed.ply` filename because the engine picks the
     * parser from `asset.file.filename`, and the bytes are passed as `contents` so nothing is
     * fetched twice.
     *
     * Decoding uses `@adobe/spz` — the same codec `@playcanvas/splat-transform` relies on, so it
     * handles current SPZ versions (v3/v4 use zstd streams; the pure-JS `spz-js` decoder only
     * understands the older gzip-based v1/v2). It is loaded lazily so the ~850 KB wasm bundle is
     * only fetched when an SPZ file is actually opened. Serialization to compressed PLY comes from
     * `spz-js`, which already encodes the PLY conventions (log scales, logit opacity, SH layout).
     *
     * SPZ stores RUB by design, PLY uses RDF, so the decode is asked for RDF — otherwise the scene
     * would arrive rotated.
     *
     * Note this re-quantizes: the codec unpacks to float arrays and the compressed-PLY writer
     * re-packs them into the engine's chunked layout. Fidelity is comparable to any other
     * compressed-PLY scene, but it is not bit-identical to the source file.
     *
     * @param url - The file to load (remote URL or blob URL from drag & drop).
     * @param onProgress - Download progress callback, 0..1.
     * @returns The loaded gsplat asset.
     */
    private async loadSpzAsCompressedPly(url: File, onProgress?: (progress: number) => void): Promise<Asset> {
        const source = url.filename ?? url.url ?? '';
        const response = await fetch(url.url);
        if (!response.ok) {
            throw new Error(`Failed to load "${source}" (HTTP ${response.status})`);
        }

        const bytes = new Uint8Array(await this.readBodyWithProgress(response, onProgress));

        const spz = await Viewer.getSpzCodec();
        const cloud = spz.loadSpzFromBuffer(bytes, { to: spz.CoordinateSystem.RDF });
        const ply = serializeCompressedPly(cloud);
        onProgress?.(1);

        const filename = `${source.replace(/\.spz$/i, '')}.compressed.ply`;
        // `.slice()` gives a view backed by a plain ArrayBuffer, which is what Response accepts.
        const contents = new Response(ply.slice(), {
            headers: { 'content-length': String(ply.byteLength) }
        });

        return new Promise<Asset>((resolve, reject) => {
            // The engine's PlyParser awaits `contents` and reads `.body` from it (see
            // parsers/ply.js), i.e. it expects a Response — but the typings declare an
            // ArrayBuffer, which is what the other handlers use. Hence the cast.
            const file = { url: url.url, filename, contents: contents as unknown as ArrayBuffer };
            const asset = new Asset(filename, 'gsplat', file);
            asset.on('load', () => resolve(asset));
            asset.on('error', (err: string) => reject(err));
            this.app.assets.add(asset);
            this.app.assets.load(asset);
        });
    }

    /**
     * Read a response body, reporting download progress when the server tells us the total size.
     *
     * @param response - The response to drain.
     * @param onProgress - Progress callback, 0..1.
     * @returns The full body.
     */
    private async readBodyWithProgress(response: Response, onProgress?: (progress: number) => void): Promise<ArrayBuffer> {
        const total = Number(response.headers.get('content-length') ?? 0);
        if (!onProgress || !response.body || !(total > 0)) {
            return response.arrayBuffer();
        }

        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let received = 0;
        for (;;) {
            // eslint-disable-next-line no-await-in-loop -- draining a stream is inherently sequential
            const { done, value } = await reader.read();
            if (done) break;
            if (!value) continue;
            chunks.push(value);
            received += value.byteLength;
            onProgress(Math.min(1, received / total));
        }

        const body = new Uint8Array(received);
        let offset = 0;
        for (const chunk of chunks) {
            body.set(chunk, offset);
            offset += chunk.byteLength;
        }
        return body.buffer;
    }

    // returns true if the filename has one of the recognized model extensions
    isModelFilename(filename: string) {
        const parts = filename.split('?')[0].split('/').pop().split('.');
        const result = parts.length === 1 || modelExtensions.includes(parts.pop().toLowerCase());
        return result;
    }

    isGSplatFilename(filename: string) {
        const parts = filename.split('?')[0].split('/').pop().split('.');
        const result = parts.length > 0 && ['ply', 'json', 'sog', 'spz'].includes(parts.pop().toLowerCase());
        return result;
    }

    /**
     * Это тайлсет 3D Tiles?
     *
     * Распознаём по имени, а не по содержимому: `.json` во вьюере уже занят сплатовым
     * `lod-meta.json`, и решать по расширению нельзя, а читать файл до `loadFiles` — значит
     * делать лишний запрос на каждый перетащенный JSON. Имя `tileset.json` — соглашение
     * спецификации и его придерживаются все известные конвертеры; суффикс `-tileset.json`
     * добавлен для наборов, где рядом лежит несколько тайлсетов.
     *
     * @param filename - Имя или URL.
     * @returns true, если файл нужно грузить тайловым слоем.
     */
    isTilesetFilename(filename: string): boolean {
        const name = filename.split('?')[0].split('/').pop()?.toLowerCase() ?? '';
        return name === 'tileset.json' || name.endsWith('-tileset.json');
    }

    // SPZ needs decoding before the engine can read it — see loadSpzAsCompressedPly
    private isSpzFilename(filename: string) {
        return filename.split('?')[0].toLowerCase().endsWith('.spz');
    }

    private isViewerSettingsFilename(filename: string): boolean {
        const cleanName = filename.split('?')[0].split('/').pop()?.toLowerCase() ?? '';
        return /\.model-viewer-settings(?:\(\d+\))?\.json$/.test(cleanName);
    }

    private formatBytes(bytes: number): string {
        const mb = bytes / (1024 * 1024);
        if (mb < 1024) return `${mb.toFixed(1)} MB`;
        return `${(mb / 1024).toFixed(2)} GB`;
    }

    private formatLimitMessage(key: string, filename: string, sizeBytes: number): string {
        const lang = this.observer.get('ui.language') as string | undefined;
        return t(key, lang)
        .replace('{filename}', filename)
        .replace('{size}', this.formatBytes(sizeBytes));
    }

    /**
     * Текст для зависшей закачки.
     *
     * @param filename - Файл, на котором остановились байты.
     * @returns Готовое сообщение на языке интерфейса.
     */
    private formatStallMessage(filename: string): string {
        const lang = this.observer.get('ui.language') as string | undefined;
        return t('Download of "{filename}" stalled: no data for {seconds} s.', lang)
        .replace('{filename}', filename)
        .replace('{seconds}', String(Math.round(Viewer.MODEL_DOWNLOAD_STALL_MS / 1000)));
    }

    /**
     * Сообщение о том, что модель скачалась, но так и не собралась.
     *
     * Отдельно от `formatStallMessage`: там оборвалась сеть, здесь сеть отработала, а
     * встала подготовка — чаще всего потому, что браузер отложил встройку, которой не
     * видно на экране, и не отдал ей ни распаковку картинок, ни кадры.
     *
     * @param filename - Имя файла модели.
     * @returns Готовая строка на языке интерфейса.
     */
    private formatPrepareStallMessage(filename: string): string {
        const lang = this.observer.get('ui.language') as string | undefined;
        return t('Model "{filename}" did not finish preparing: no progress for {seconds} s.', lang)
        .replace('{filename}', filename)
        .replace('{seconds}', String(Math.round(Viewer.MODEL_DOWNLOAD_STALL_MS / 1000)));
    }

    private formatMissingRemoteFileMessage(filename: string, status: number): string {
        const lang = this.observer.get('ui.language') as string | undefined;
        const key = status === 403 ? 'File "{filename}" is not accessible on the server (HTTP {status}).' :
            'File "{filename}" was not found on the server (HTTP {status}).';
        return t(key, lang)
        .replace('{filename}', filename)
        .replace('{status}', String(status));
    }

    /**
     * Ask the server whether it is refusing a file outright.
     *
     * Runs only after a load has already failed, to turn a bare loader error into one that names
     * the cause. HEAD alone will not do: some CDNs reject HEAD but serve GET, so a 4xx seen there
     * is only trusted once the ranged GET has had its chance to overrule it.
     *
     * A probe that never gets an answer (timeout, dropped connection, unanswered CORS preflight)
     * proves nothing and is reported as "not refused" — the caller then keeps the original error
     * rather than inventing a reason.
     *
     * @param url - Absolute http(s) URL.
     * @returns The 4xx status the server refused with, or null if it did not refuse the file.
     */
    private async probeRefusalStatus(url: string): Promise<number | null> {
        // A 4xx from HEAD is remembered rather than returned, so the range probe below still gets
        // a chance to prove the file is served after all.
        let refusedStatus: number | null = null;

        const headController = new AbortController();
        const headTimeoutId = setTimeout(() => headController.abort(), Viewer.REMOTE_HEAD_TIMEOUT_MS);
        try {
            const response = await fetch(url, { method: 'HEAD', signal: headController.signal, cache: 'no-store' });
            if (response.ok) {
                return null;
            }
            if (response.status >= 400 && response.status < 500) {
                refusedStatus = response.status;
            }
        } catch {
            // ignore and try range probe
        } finally {
            clearTimeout(headTimeoutId);
        }

        const rangeController = new AbortController();
        const rangeTimeoutId = setTimeout(() => rangeController.abort(), Viewer.REMOTE_HEAD_TIMEOUT_MS);
        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: { Range: 'bytes=0-0' },
                signal: rangeController.signal,
                cache: 'no-store'
            });
            if (response.ok) {
                return null;
            }
            // 4xx means the server knows the file and refuses it (missing, forbidden, gone). A 5xx
            // is a server hiccup that says nothing about the file itself.
            return response.status >= 400 && response.status < 500 ? response.status : refusedStatus;
        } catch {
            // The range probe itself can fail cross-origin: a `Range` header makes the request
            // non-simple, so it needs a CORS preflight that many static-file hosts don't answer.
            // In that case a 4xx seen by HEAD is the best evidence we have.
            return refusedStatus;
        } finally {
            clearTimeout(rangeTimeoutId);
        }
    }

    /**
     * Enforce the model size limit from the download's own progress reports.
     *
     * The transfer announces its total size in the first progress events, so the limit is read from
     * those rather than from a blocking pre-flight probe. Probing first cost a round-trip on every
     * URL load and, whenever the probe timed out on a cold connection, refused a perfectly good
     * file — while a server that misreports its size slipped through anyway.
     *
     * The engine hands out no handle on the underlying request, so the transfer itself cannot be
     * cancelled: rejecting here stops the viewer waiting on it and skips parsing the result.
     *
     * @param asset - The asset being loaded.
     * @param file - The file it came from, for the error message.
     * @param reject - Rejects the enclosing load promise.
     * @param onProgress - Download progress callback, 0..1.
     */
    private attachSizeGuard(asset: Asset, file: File, reject: (err: Error) => void, onProgress?: (progress: number) => void) {
        let rejected = false;
        asset.on('progress', (receivedBytes: number, totalBytes: number) => {
            if (rejected) {
                return;
            }
            // `totalBytes` is the declared size and arrives first; `receivedBytes` is the ground
            // truth that catches a server declaring less than it actually sends.
            const observedBytes = Math.max(receivedBytes, totalBytes);
            if (observedBytes > Viewer.MODEL_FILE_SIZE_LIMIT_BYTES) {
                rejected = true;
                reject(new FormattedLoadError(this.formatLimitMessage(
                    'File "{filename}" ({size}) exceeds model limit of 1 GB.',
                    file.filename ?? file.url ?? '',
                    observedBytes)));
                return;
            }
            onProgress?.(totalBytes > 0 ? receivedBytes / totalBytes : 0);
        });
    }

    /**
     * Replace a bare loader failure with a message that names the actual problem.
     *
     * The engine only reports that the request failed, so the status is probed here — on the
     * failure path only, where an extra round-trip costs nothing the user would notice.
     *
     * @param file - The file that failed to load.
     * @param err - The failure reported by the asset loader.
     * @returns Never — always throws.
     */
    private async refineRemoteLoadError(file: File, err: unknown): Promise<never> {
        if (err instanceof FormattedLoadError) {
            throw err;
        }
        const fileUrl = file.url ?? '';
        if (/^https?:\/\//i.test(fileUrl)) {
            const refusedStatus = await this.probeRefusalStatus(fileUrl);
            if (refusedStatus !== null) {
                throw new Error(this.formatMissingRemoteFileMessage(
                    file.filename ?? fileUrl, refusedStatus));
            }
        }
        throw err instanceof Error ? err : new Error(String(err));
    }

    // load the list of urls.
    // urls can reference glTF files, glb files and skybox textures.
    // returns true if a model was loaded.
    loadFiles(files: Array<File>, resetScene = false) {
        // convert single url to list
        if (!Array.isArray(files)) {
            files = [files];
        }

        // 3D Tiles — отдельный конвейер: у тайлсета нет «одного ассета», который можно
        // добавить в сцену, вместо этого сценой управляет TileManager.
        const tilesetFile = files.find(f => this.isTilesetFilename(f.filename ?? f.url ?? ''));
        if (tilesetFile) {
            this.loadTileset(tilesetFile, resetScene);
            return true;
        }

        const rejectedFiles: string[] = [];
        const acceptedFiles = files.filter((file) => {
            const filename = file.filename ?? file.url ?? '';
            const sizeBytes = file.sizeBytes;
            if (typeof sizeBytes !== 'number' || sizeBytes <= 0) {
                return true;
            }

            if ((this.isModelFilename(filename) || this.isGSplatFilename(filename)) &&
                sizeBytes > Viewer.MODEL_FILE_SIZE_LIMIT_BYTES) {
                rejectedFiles.push(this.formatLimitMessage('File "{filename}" ({size}) exceeds model limit of 1 GB.', filename, sizeBytes));
                return false;
            }

            if (this.isViewerSettingsFilename(filename) &&
                sizeBytes > Viewer.SETTINGS_FILE_SIZE_LIMIT_BYTES) {
                rejectedFiles.push(this.formatLimitMessage('File "{filename}" ({size}) exceeds settings limit of 10 MB.', filename, sizeBytes));
                return false;
            }

            const isKnownType = this.isModelFilename(filename) || this.isGSplatFilename(filename) || this.isViewerSettingsFilename(filename);
            if (!isKnownType && sizeBytes > Viewer.SKYBOX_FILE_SIZE_LIMIT_BYTES) {
                rejectedFiles.push(this.formatLimitMessage('File "{filename}" ({size}) exceeds HDRI/Skybox limit of 50 MB.', filename, sizeBytes));
                return false;
            }

            return true;
        });

        files = acceptedFiles;

        if (rejectedFiles.length > 0) {
            this.observer.set('ui.warnings', rejectedFiles);
            if (files.length === 0) {
                this.observer.set('ui.error', rejectedFiles.join('\n'));
                return false;
            }
        }

        // check if any file is a model
        const hasModelFilename = files.reduce(
            (p, f) => p || this.isModelFilename(f.filename) || this.isGSplatFilename(f.filename),
            false
        );

        if (hasModelFilename) {
            if (resetScene) {
                this.resetScene();
            }

            const loadTimestamp = Date.now();
            const modelFiles = files.filter(f => this.isModelFilename(f.filename) || this.isGSplatFilename(f.filename));

            // Запоминаем основную модель — мост сможет отдать её байты на хост.
            if (modelFiles[0]) this.lastModelFile = modelFiles[0];

            // Чтобы фон не «мигал» (серый → белый → родной) до прихода настроек:
            // держим ТЕКУЩИЙ фон через сброс к дефолтам, а родной цвет поставит
            // preload ниже. Без этого reset перекрашивал в дефолтный серо-голубой.
            const prevBg = this.observer.get('skybox.background');
            const prevBgColor = this.observer.get('skybox.backgroundColor');
            this.markSplatScene(modelFiles[0]?.url ?? modelFiles[0]?.filename);
            this.resetViewerSettingsToDefaults();
            if (prevBgColor) {
                this.observer.set('skybox.background', prevBg);
                this.observer.set('skybox.backgroundColor', prevBgColor);
            }
            this.observer.set('ui.spinner', true);
            this.observer.set('ui.loadProgress', 0);
            this.observer.set('ui.loadingBackgroundReady', false);
            this.observer.set('ui.error', null);
            this.observer.set('ui.warnings', []);
            this.clearCta();
            this.preloadLoadingBackgroundFromSettings(modelFiles[0]?.url, files).catch(() => {});

            // Defer load to next frame so the progress bar can paint at 0%
            requestAnimationFrame(() => {
                const warnings: string[] = rejectedFiles.slice();
                const total = modelFiles.length;
                const progressPerFile: number[] = new Array(total).fill(0);
                let lastProgressValue = 0;
                let lastSet = -1;
                // Сторож зависшей закачки: когда байты приходили в последний раз и осела ли
                // уже вся загрузка (после этого сторож молчит — дальше идёт разбор файла).
                let lastProgressAt = Date.now();
                let settled = false;
                // Текстуры, замеченные и уже загруженные разбором glTF: единственный реальный
                // прогресс на участке между «файл скачан» и «первый кадр».
                let texturesSeen = 0;
                let texturesDone = 0;
                // Монотонно (бар не откатывается назад), потолок 99 — ровно 100 ставит первый кадр.
                const setProgress = (v: number) => {
                    const nv = Math.max(lastProgressValue, Math.min(Viewer.STAGE_ASSEMBLY, v));
                    lastProgressValue = nv;
                    if (Math.round(nv) !== lastSet) {
                        lastSet = Math.round(nv);
                        this.observer.set('ui.loadProgress', nv);
                    }
                };

                // Реальный прогресс скачивания файлов модели → диапазон 0..85.
                const setAggregateProgress = () => {
                    const sum = progressPerFile.reduce((a, b) => a + b, 0);
                    const pct = total > 0 ? (sum / total) * Viewer.STAGE_DOWNLOAD : 0;
                    setProgress(pct);
                };

                // Рубежи слепых этапов. Показать сам этап невозможно: разбор glTF, заливка в
                // видеопамять и сборка сцены держат главный поток, а пока он занят, браузер не
                // рисует вообще — никакая полоса там не сдвинется. Что можно — выставить число
                // ПЕРЕД тяжёлой работой, чтобы зритель видел, на чём стоим, а не выдуманные 98.
                const markStage = (value: number) => setProgress(value);

                // Разбор glTF заводит по ассету на каждую картинку. Их готовность — настоящая
                // мера того, что происходит после скачивания: распаковка PNG и заливка в GPU.
                // Отсюда диапазон 90..98, тот самый, где индикатор раньше просто замирал.
                // Считаем байтами (см. `onAssetAdd`), поэтому доля отражает объём работы.
                const textureBase = () => (texturesSeen > 0 ?
                    Viewer.STAGE_PARSED + (Viewer.STAGE_TEXTURES - Viewer.STAGE_PARSED) * (texturesDone / texturesSeen) :
                    Viewer.STAGE_PARSED);
                const onTexture = (seenDelta: number, doneDelta: number) => {
                    texturesSeen += seenDelta;
                    texturesDone += doneDelta;
                    // Готовность картинок — тоже прогресс. Без этого сторож считал бы
                    // тишиной весь участок после скачивания, где идёт распаковка.
                    lastProgressAt = Date.now();
                    if (texturesSeen > 0) {
                        setProgress(textureBase());
                    }
                };

                /** Оборвать ожидание: закачка не отвечает, ждать дальше нечего. */
                const failStalled = () => {
                    settled = true;
                    if (this.loadCreepTimer) {
                        clearInterval(this.loadCreepTimer);
                        this.loadCreepTimer = null;
                    }
                    const stuckIndex = progressPerFile.findIndex(p => p < 1);
                    const stuck = modelFiles[stuckIndex < 0 ? 0 : stuckIndex];
                    const name = stuck?.filename ?? stuck?.url ?? '';
                    // Не докачалось и не доготовилось — разные беды, и посетителю стоит
                    // сказать, какая именно: одна про сеть, другая про саму модель.
                    this.observer.set('ui.error', stuckIndex < 0 ?
                        this.formatPrepareStallMessage(name) :
                        this.formatStallMessage(name));
                    this.observer.set('ui.loadProgress', 100);
                    this.observer.set('ui.spinner', false);
                    this.observer.set('ui.loadingBackgroundReady', false);
                };

                // Непрерывный «ползунок»: бар никогда не застывает. Во время скачивания
                // подбираемся к 90; ПОСЛЕ него (парсинг GLB, применение настроек, загрузка
                // неба — там прогресса нет) продолжаем ползти к 98. Реальный прогресс, если
                // он выше, перепрыгивает вперёд через setProgress(max). Мин. шаг = не замираем.
                if (this.loadCreepTimer) clearInterval(this.loadCreepTimer);
                const creepInterval = setInterval(() => {
                    // Прогресса нет вовсе — ни байтов, ни готовых картинок. Раньше условие
                    // требовало недокачанного файла, и потому не видело самый коварный случай:
                    // модель скачалась и распаковалась, а сборка контейнера так и не
                    // завершилась. Полоса тогда доползала до своего потолка 96 и парковалась
                    // там навсегда — ровно то, что видели посетители во встройках.
                    if (!settled && Date.now() - lastProgressAt > Viewer.MODEL_DOWNLOAD_STALL_MS) {
                        failStalled();
                        return;
                    }
                    // Пока идут текстуры, потолок ползунка считается от реально готовых
                    // байтов, и таймеру достаётся лишь часть незавершённого отрезка. Раньше
                    // он шёл прямо к 98 и добегал туда за пару секунд — а распаковка длилась
                    // ещё семь. Полоса стояла на 98 и выглядела зависшей, хотя работа шла.
                    const ceiling = texturesSeen > 0 ?
                        textureBase() + (Viewer.STAGE_TEXTURES - textureBase()) * Viewer.LOAD_CREEP_SHARE :
                        Viewer.STAGE_TEXTURES;
                    const target = lastProgressValue < Viewer.STAGE_DOWNLOAD ? Viewer.STAGE_DOWNLOAD : ceiling;
                    if (lastProgressValue < target) {
                        const step = Math.max(0.25, (target - lastProgressValue) * 0.06);
                        setProgress(lastProgressValue + step);
                    }
                }, 160);
                this.loadCreepTimer = creepInterval;

                const promises = modelFiles.map((file, modelIndex) => {
                    const onProgress = (p: number) => {
                        if (p > progressPerFile[modelIndex]) {
                            lastProgressAt = Date.now();
                        }
                        progressPerFile[modelIndex] = p;
                        setAggregateProgress();
                    };
                    return this.isModelFilename(file.filename) ?
                        this.loadGltf(file, files, warnings, onProgress, onTexture) :
                        this.loadPly(file, files, onProgress);
                });

                const wrappedPromises = promises.map((p, i) => p.then((asset) => {
                    progressPerFile[i] = 1;
                    setAggregateProgress();
                    return asset;
                }));

                Promise.all(wrappedPromises)
                .then((assets: Asset[]) => {
                    settled = true;
                    this.loadTimestamp = loadTimestamp;

                    // add assets to the scene
                    assets.forEach((asset) => {
                        if (asset) {
                            this.addToScene(asset);
                        }
                    });

                    // update scene urls
                    const urls = modelFiles.map(f => f.url);
                    const filenames = modelFiles.map(f => f.filename.split('/').pop());
                    if (resetScene) {
                        this.observer.set('scene.urls', urls);
                        this.observer.set('scene.filenames', filenames);
                    } else {
                        this.observer.set('scene.urls', this.observer.get('scene.urls').concat(urls));
                        this.observer.set('scene.filenames', this.observer.get('scene.filenames').concat(filenames));
                    }

                    if (warnings.length > 0) {
                        console.warn(`Model loaded with ${warnings.length} warning(s):`);
                        warnings.forEach(w => console.warn(`  - ${w}`));
                        this.observer.set('ui.warnings', warnings);
                    }

                    // НЕ гасим индикатор здесь: ассет скачан, но модель ещё не
                    // отрисована (впереди postSceneLoad + первый
                    // кадр). Бар продолжает ползти к 98 и гаснет на ПЕРВОМ КАДРЕ модели
                    // (onPostrender/firstFrame) — иначе была пауза «пусто» после бара.

                    // Настройки (камера/свет/небо) догружаем действительно в фоне. Отсутствующий
                    // sidecar или медленный сервер настроек не должны блокировать первый кадр.
                    const firstModelUrl = modelFiles[0]?.url;
                    this.postSceneLoad();

                    this.tryFetchAndApplySettings(firstModelUrl, files)
                    .then((settingsApplied) => {
                        // Без sidecar-настроек сброс к умолчаниям снова включает ловушку теней —
                        // для unlit-сцены возвращаем её выключенной.
                        if (!settingsApplied) {
                            this.applyUnlitShadowCatcherDefault();
                        }
                        this.renderNextFrame();
                    })
                    .catch(err => console.warn('[model-viewer] Background settings apply failed:', err));
                })
                .catch((err) => {
                    settled = true;
                    console.log(err);
                    if (warnings.length > 0) {
                        this.observer.set('ui.warnings', warnings);
                    }
                    this.observer.set('ui.error', err?.toString() || err);
                    // Ошибка → модель не отрисуется, первого кадра не будет: гасим тут.
                    if (this.loadCreepTimer) {
                        clearInterval(this.loadCreepTimer); this.loadCreepTimer = null;
                    }
                    this.observer.set('ui.loadProgress', 100);
                    this.observer.set('ui.spinner', false);
                    this.observer.set('ui.loadingBackgroundReady', false);
                })
                .finally(() => {
                    // В норме индикатор гасит ПЕРВЫЙ КАДР модели (onPostrender/firstFrame).
                    // Здесь — только подстраховка: если кадр по какой-то причине не наступит.
                    setTimeout(() => {
                        if (this.loadCreepTimer) {
                            clearInterval(this.loadCreepTimer); this.loadCreepTimer = null;
                        }
                        this.observer.set('ui.spinner', false);
                        this.observer.set('ui.loadingBackgroundReady', false);
                    }, 10000);
                });
            });
        } else {
            // load skybox
            this.loadSkybox(files);
        }

        // return true if a model/scene was loaded and false otherwise
        return hasModelFilename;
    }

    /**
     * Загрузить тайлсет 3D Tiles.
     *
     * Отличий от обычной модели два, и оба принципиальные. Во-первых, к моменту, когда
     * загрузка «закончилась», на экране нет ничего: `tileset.json` — это только дерево, а
     * геометрия придёт тайлами, по мере того как их запросит обход. Индикатор поэтому
     * гасится по факту разбора дерева, а не по появлению картинки. Во-вторых, кадрировать
     * камеру можно сразу: габариты известны из корневого bounding volume.
     *
     * @param file - Файл tileset.json.
     * @param resetScene - Очистить сцену перед загрузкой.
     */
    private async loadTileset(file: File, resetScene: boolean) {
        if (resetScene) {
            this.resetScene();
        }
        this.destroyTileManager();

        const url = file.url ?? file.filename;
        const warnings: string[] = [];

        this.markSplatScene(url);
        this.resetViewerSettingsToDefaults();
        this.observer.set('ui.spinner', true);
        this.observer.set('ui.loadProgress', 0);
        this.observer.set('ui.error', null);
        this.observer.set('ui.warnings', []);
        this.clearCta();
        this.preloadLoadingBackgroundFromSettings(url, [file]).catch(() => {});

        // Ловитель теней — горизонтальная плоскость по низу габаритов сцены. Под одиночной
        // моделью он на месте, а тайлсет приносит собственный рельеф: плоскость режет его
        // и закрывает половину сцены чёрным. Настройка остаётся, пользователь может
        // включить её обратно.
        this.observer.set('shadowCatcher.enabled', false);

        // Освещённость контента пока неизвестна — определим по первому пришедшему тайлу
        // (см. `handleTileChange`). Панель по этому флагу подписывает Lit (PBR) или Unlit.
        this.observer.set('scene.tilesetLit', null);

        // Tiles Debug — сессионный инструмент. Новый тайлсет всегда открывается в чистом
        // production-виде, даже если на предыдущем были включены контуры или заливка.
        this.observer.set('debug.tileDebug', false);
        this.observer.set('debug.tileCheckerFill', false);
        this.observer.set('debug.tileFreeze', false);
        this.observer.set('debug.tileRecording', false);
        this.observer.set('debug.tilePaused', false);
        this.observer.set('debug.tileLodLock', false);
        this.observer.set('debug.tilePick', false);
        this.observer.set('debug.tileIsolatePick', false);
        this.observer.set('debug.tileLodColor', false);
        this.observer.set('debug.gsplatLodColor', false);
        this.observer.set('debug.gsplatNodeBounds', false);
        this.observer.set('debug.gsplatDebugMode', 'lod');
        this.observer.set('debug.gsplatFreeze', false);
        this.observer.set('debug.gsplatPaused', false);
        this.observer.set('scene.tilesetMaxDepth', 0);
        this.observer.set('scene.tilesetLoadCount', 0);

        const manager = new TileManager({
            app: this.app,
            camera: this.camera,
            parent: this.sceneContentRoot,
            onChange: transformChanged => this.handleTileChange(transformChanged),
            onWarning: message => warnings.push(message)
        });
        this.tileManager = manager;

        try {
            await manager.load(url);

            // Пока грузился тайлсет, сцену могли сменить.
            if (this.tileManager !== manager) {
                return;
            }

            this.loadTimestamp = Date.now();
            this.lastModelFile = file;
            this.observer.set('scene.urls', [url]);
            const sceneName = (file.filename ?? url).split('/').pop();
            this.observer.set('scene.filenames', [sceneName]);

            // Нижний ряд экранных кнопок (Инфо, «Кадрировать сцену», HD, измерения,
            // полный экран) прячется классом `empty`, когда `scene.nodes === '[]'` (см.
            // popup-panel и `#popup.empty` в style.scss). У тайлсета своей статичной
            // иерархии нет — набор тайлов меняется каждый кадр, — поэтому кладём один
            // корневой узел: этого достаточно, чтобы панель показалась и работали
            // кадрирование камеры, инфо и полноэкранный режим.
            this.observer.set('scene.nodes', JSON.stringify([{
                name: sceneName ?? 'tileset',
                path: '',
                children: []
            }]));
            // Признак тайлсета: UI прячет по нему режимы, которые на потоковых тайлах не
            // работают (UV-раскладки строятся из статического `meshInstances`, а он пуст),
            // и переключатель «по объектам».
            this.observer.set('scene.isTileset', true);
            this.updateViewCubeVisibility();
            // Верх ползунка LOD — глубина уже загруженного дерева (растёт по мере
            // разворачивания неявного дерева, см. handleTileChange).
            this.observer.set('scene.tilesetMaxDepth', manager.getTreeDepth());

            // 3D Tiles use the same sidecar convention as regular models:
            // `tileset.model-viewer-settings.json` beside `tileset.json`.
            const settingsApplied = await this.tryFetchAndApplySettings(url, [file]);
            if (this.tileManager !== manager) {
                return;
            }
            // Missing settings reset common viewer defaults, where the shadow catcher is
            // enabled. Keep the safe tileset default unless a sidecar explicitly overrides it.
            if (!settingsApplied) {
                this.observer.set('shadowCatcher.enabled', false);
            }

            // Габариты нужны до кадрирования, причём оба набора: `frameScene` считает по
            // `sceneBounds`, а плоскости отсечения — по `dynamicSceneBounds`, который
            // обычно пересчитывается только в `onPrerender`, то есть уже после.
            this.dirtyBounds = true;
            this.calcSceneBounds(this.sceneBounds);
            this.calcSceneBounds(this.dynamicSceneBounds);
            this.focus(true);
            this.fitCameraClipPlanes();

            if (warnings.length > 0) {
                warnings.forEach(w => console.warn(`3D Tiles: ${w}`));
                this.observer.set('ui.warnings', warnings);
            }
        } catch (err) {
            console.error(err);
            this.observer.set('ui.error', err?.toString() ?? String(err));
            this.destroyTileManager();
        } finally {
            this.observer.set('ui.loadProgress', 100);
            this.observer.set('ui.spinner', false);
            this.observer.set('ui.loadingBackgroundReady', false);
            this.renderNextFrame();
        }
    }

    /** Reset the exact clipping volume to the current model/tileset world bounds. */
    resetFragmentBox() {
        this.tileManager?.syncTransform();
        if (this.tileManager) {
            this.sceneBounds.copy(this.tileManager.bounds);
        } else {
            this.calcSceneBounds(this.sceneBounds);
        }
        const center = this.sceneBounds.center;
        const half = this.sceneBounds.halfExtents;
        const safe = (value: number) => Math.max(0.00001, Math.abs(value) * 2);
        this.observer.set('fragment.center', [center.x, center.y, center.z]);
        this.observer.set('fragment.size', [safe(half.x), safe(half.y), safe(half.z)]);
        this.observer.set('fragment.radius', Math.max(safe(half.x), safe(half.y), safe(half.z)) / 2);
        this.observer.set('fragment.rotation', [0, 0, 0]);
        this.observer.set('fragment.initialized', true);
        this.syncFragmentEntityFromObserver();
        this.syncFragmentClipping();
        this.updateFragmentGizmo();
    }

    private fragmentTuple(path: string, fallback: [number, number, number]): [number, number, number] {
        const raw = this.observer.get(path) as number[] | undefined;
        if (!Array.isArray(raw) || raw.length < 3) return fallback;
        return [0, 1, 2].map((index) => {
            const value = Number(raw[index]);
            return Number.isFinite(value) ? value : fallback[index];
        }) as [number, number, number];
    }

    private syncFragmentEntityFromObserver() {
        if (!this.fragmentBoxEntity) return;
        const center = this.fragmentTuple('fragment.center', [0, 0, 0]);
        const size = this.fragmentTuple('fragment.size', [1, 1, 1]).map(value => Math.max(0.00001, Math.abs(value))) as [number, number, number];
        const rotation = this.fragmentTuple('fragment.rotation', [0, 0, 0]);
        this.fragmentBoxEntity.setPosition(center[0], center[1], center[2]);
        this.fragmentBoxEntity.setEulerAngles(rotation[0], rotation[1], rotation[2]);
        if (this.observer.get('fragment.shape') === 'sphere') {
            // Шейдер сравнивает расстояние с 0.5 в системе координат сущности, значит радиусу
            // отвечает равномерный масштаб в диаметр. Отдельной математики сфере не нужно.
            const diameter = Math.max(0.00002, Math.abs(Number(this.observer.get('fragment.radius')) || 1) * 2);
            this.fragmentBoxEntity.setLocalScale(diameter, diameter, diameter);
        } else {
            this.fragmentBoxEntity.setLocalScale(size[0], size[1], size[2]);
        }
    }

    private syncFragmentObserverFromEntity() {
        const position = this.fragmentBoxEntity.getPosition();
        const scale = this.fragmentBoxEntity.getLocalScale();
        const rotation = this.fragmentBoxEntity.getEulerAngles();
        this.observer.set('fragment.center', [position.x, position.y, position.z]);
        if (this.observer.get('fragment.shape') === 'sphere') {
            // Размеры бокса остаются нетронутыми: у каждой формы свой размер, и переключение
            // не должно терять то, что настроили в другой.
            this.observer.set('fragment.radius', Math.max(0.00001, scale.x / 2));
        }
        this.observer.set('fragment.size', [Math.max(0.00001, Math.abs(scale.x)), Math.max(0.00001, Math.abs(scale.y)), Math.max(0.00001, Math.abs(scale.z))]);
        this.observer.set('fragment.rotation', [rotation.x, rotation.y, rotation.z]);
        this.observer.set('fragment.initialized', true);
    }

    private syncFragmentClipping() {
        if (!this.fragmentBoxEntity || !this.observer.get('fragment.enabled')) {
            this.tileManager?.setClipBox(null);
            this.renderNextFrame();
            return;
        }
        this.fragmentWorldToLocal.copy(this.fragmentBoxEntity.getWorldTransform()).invert();
        this.tileManager?.setClipBox(this.fragmentWorldToLocal, !!this.observer.get('fragment.invert'));
        this.renderNextFrame();
    }

    private syncFragmentMaterials() {
        if (!this.observer.get('fragment.enabled')) return;
        this.fragmentWorldToLocal.copy(this.fragmentBoxEntity.getWorldTransform()).invert();
        // Контур сечения красим в цвет темы: тонкий срез иначе почти не читается на модели.
        const theme = normalizeThemeColor(this.observer.get('theme.primaryColor'));
        this.fragmentClipMaterials.apply(
            this.getPickableMeshInstances(),
            this.fragmentWorldToLocal,
            !!this.observer.get('fragment.invert'),
            this.observer.get('fragment.outline') ?
                { color: [theme.r, theme.g, theme.b], widthPx: this.fragmentOutlineWidth() } :
                null,
            this.observer.get('fragment.shape') === 'sphere'
        );
    }

    /**
     * Толщина подсветки контура сечения из настроек, приведённая к разумным границам.
     *
     * @returns Толщина линии в пикселях.
     */
    private fragmentOutlineWidth(): number {
        const value = Number(this.observer.get('fragment.outlineWidth'));
        if (!Number.isFinite(value)) {
            return 2;
        }
        return Math.min(FRAGMENT_OUTLINE_WIDTH_MAX_PX, Math.max(FRAGMENT_OUTLINE_WIDTH_MIN_PX, value));
    }

    /**
     * Раскраска блоков тайлсета — по уровню детализации либо по разрешению.
     *
     * Схему берём ту же, что у каркаса: режим один на обе картинки, иначе рамки и поверхности
     * говорили бы разное.
     *
     * Работает как раскраска сплатов у движка: цвет не заменяет исходный, а умножается
     * на него (`color.xyz *= uColorMultiply` в шейдере сплатов), поэтому текстура остаётся
     * видна. У фотограмметрии материалы unlit — цвет приходит из emissive, у обычных
     * PBR-тайлов из diffuse, поэтому подменяем оба: у lit-материала emissive чёрный и от
     * умножения не меняется, а у unlit diffuse не используется.
     */
    private syncTileLodColors() {
        const enabled = !!this.tileManager && !!this.observer.get('debug.tileLodColor');
        if (!enabled) {
            if (this.tileLodTinted.size > 0 || this.tileResolutionTint.active) {
                this.clearTileLodColors();
                this.tileResolutionTint.clear();
                this.renderNextFrame();
            }
            return;
        }
        const byResolution = this.observer.get('debug.tileDebugMode') === 'resolution';
        // Две раскраски не смешиваем: у каждой свой способ, и остатки предыдущей были бы видны
        // как умножение цвета дважды.
        if (byResolution) {
            if (this.tileLodTinted.size > 0) this.clearTileLodColors();
        } else if (this.tileResolutionTint.active) {
            this.tileResolutionTint.clear();
        }

        if (byResolution) {
            // Здесь цвет считает шейдер: он меняется по поверхности вместе с расстоянием,
            // поэтому одного значения на меш недостаточно.
            this.tileManager?.forEachVisibleTile((_depth, meshInstances, _ratio, resolutionK) => {
                meshInstances.forEach(meshInstance => this.tileResolutionTint.apply(meshInstance, resolutionK));
            });
            return;
        }

        this.tileManager?.forEachVisibleTile((depth, meshInstances) => {
            meshInstances.forEach((meshInstance) => {
                // Меш принадлежит одному тайлу, глубина у него не меняется: уже покрашенный
                // меш пропускаем, чтобы не трогать параметры каждый кадр.
                if (this.tileLodTinted.get(meshInstance) === depth) {
                    return;
                }
                const material = meshInstance.material as StandardMaterial | undefined;
                if (!material) {
                    return;
                }
                const [r, g, b] = lodColorRgb(depth);
                // Цветовые униформы движок передаёт в линейном пространстве (`Color.linear`).
                const tint = (color: Color | undefined) => (color ? [
                    Math.pow(color.r, 2.2) * r,
                    Math.pow(color.g, 2.2) * g,
                    Math.pow(color.b, 2.2) * b
                ] : [0, 0, 0]);
                meshInstance.setParameter('material_emissive', tint(material.emissive));
                meshInstance.setParameter('material_diffuse', tint(material.diffuse));
                this.tileLodTinted.set(meshInstance, depth);
            });
        });
    }

    /** Снять раскраску со всех мешей, которым она была проставлена. */
    private clearTileLodColors() {
        this.tileLodTinted.forEach((_depth, meshInstance) => {
            meshInstance.deleteParameter('material_emissive');
            meshInstance.deleteParameter('material_diffuse');
        });
        this.tileLodTinted.clear();
    }

    private updatePickCursor() {
        const picking = !!this.observer.get('debug.tilePick') || !!this.observer.get('fragment.selecting');
        this.canvas.style.cursor = picking ? 'crosshair' : '';
    }

    private fragmentWorldToCssScreen(point: Vec3) {
        // `worldToScreen` уже отдаёт CSS-пиксели канваса (движок берёт размер из
        // `device.clientRect`), поэтому пересчитывать нечего — см. `getPickRay`.
        return this.camera.camera.worldToScreen(point);
    }


    private updateFragmentHandles() {
        const visible = !!this.observer.get('fragment.initialized') &&
            this.observer.get('ui.active') === 'fragment' && !this.observer.get('fragment.selecting');
        if (!visible) {
            this.fragmentHandleLayer.style.display = 'none';
            return;
        }
        this.fragmentHandleLayer.style.display = 'block';
        // Пока бокс только ставят на полной модели, ручки нейтрально-серые; когда фрагмент
        // изолирован — красим их в цвет темы, чтобы состояние читалось прямо во вьюпорте.
        this.fragmentHandleLayer.classList.toggle(
            'fragment-handles-isolated',
            !!this.observer.get('fragment.enabled')
        );
        const transform = this.fragmentBoxEntity.getWorldTransform();
        const handles = this.fragmentHandleLayer.querySelectorAll<HTMLButtonElement>('.fragment-face-handle');
        // У сферы одна величина — радиус, и шесть ручек по местам граней висели бы там, где
        // у неё ничего нет. Оставляем одну, на положительной оси X.
        const sphere = this.observer.get('fragment.shape') === 'sphere';
        handles.forEach((handle) => {
            const axis = Number(handle.dataset.axis);
            const sign = Number(handle.dataset.sign);
            if (sphere && !(axis === 0 && sign === 1)) {
                handle.style.display = 'none';
                return;
            }
            handle.style.display = '';
            const local = new Vec3(
                axis === 0 ? sign * 0.5 : 0,
                axis === 1 ? sign * 0.5 : 0,
                axis === 2 ? sign * 0.5 : 0
            );
            const world = transform.transformPoint(local);
            const screen = this.fragmentWorldToCssScreen(world);
            handle.style.left = `${screen.x}px`;
            handle.style.top = `${screen.y}px`;
        });
    }

    /**
     * Вернуть панель фрагмента с гизмо по двойному клику внутри бокса.
     *
     * Панель закрывается любым кликом мимо неё, а вместе с ней уходят и ручки бокса — так
     * потерять контролы легко случайно. Двойной клик по самому боксу возвращает режим редактирования
     * без похода в тулбар.
     *
     * @param x - Координата курсора по горизонтали в CSS-пикселях канваса.
     * @param y - Координата курсора по вертикали в CSS-пикселях канваса.
     * @returns `true`, если клик попал в бокс и панель открыта — тогда камера не центрируется.
     */
    private reopenFragmentPanelAt(x: number, y: number): boolean {
        if (!this.fragmentBoxEntity || !this.observer.get('fragment.initialized')) return false;
        if (this.observer.get('fragment.selecting')) return false;
        if (this.observer.get('ui.active') === 'fragment') return false;
        const ray = this.getPickRay(x, y);
        if (!this.fragmentBoxHit(ray.origin, ray.direction)) return false;
        this.observer.set('ui.active', 'fragment');
        this.renderNextFrame();
        return true;
    }

    /**
     * Пересекает ли луч объём бокса.
     *
     * Луч переводится в локальные координаты бокса, где тот — единичный куб с полуразмером 0.5,
     * поэтому поворот и масштаб учитываются сами собой.
     *
     * @param origin - Начало луча в мировых координатах.
     * @param direction - Направление луча в мировых координатах.
     * @returns `true`, если луч входит в бокс перед камерой.
     */
    private fragmentBoxHit(origin: Vec3, direction: Vec3): boolean {
        fragmentHitMat.copy(this.fragmentBoxEntity.getWorldTransform()).invert();
        fragmentHitMat.transformPoint(origin, fragmentHitOrigin);
        fragmentHitMat.transformVector(direction, fragmentHitDir);
        const o = [fragmentHitOrigin.x, fragmentHitOrigin.y, fragmentHitOrigin.z];
        const d = [fragmentHitDir.x, fragmentHitDir.y, fragmentHitDir.z];
        let near = 0;
        let far = Infinity;
        for (let axis = 0; axis < 3; axis++) {
            // Луч параллелен паре граней: попадание возможно, только если он между ними.
            if (Math.abs(d[axis]) < 1e-9) {
                if (Math.abs(o[axis]) > 0.5) return false;
                continue;
            }
            const t0 = (-0.5 - o[axis]) / d[axis];
            const t1 = (0.5 - o[axis]) / d[axis];
            near = Math.max(near, Math.min(t0, t1));
            far = Math.min(far, Math.max(t0, t1));
            if (near > far) return false;
        }
        return far >= near;
    }

    private updateFragmentGizmo() {
        if (!this.fragmentTranslateGizmo) return;
        [this.fragmentTranslateGizmo, this.fragmentScaleGizmo, this.fragmentRotateGizmo].forEach((gizmo) => {
            gizmo.detach();
            gizmo.enabled = false;
        });
        const visible = !!this.observer.get('fragment.initialized') && this.observer.get('ui.active') === 'fragment';
        if (!visible) return;
        const mode = this.observer.get('fragment.editMode') ?? 'move';
        const gizmo = mode === 'resize' ? this.fragmentScaleGizmo :
            mode === 'rotate' ? this.fragmentRotateGizmo : this.fragmentTranslateGizmo;
        gizmo.attach([this.fragmentBoxEntity]);
        gizmo.enabled = true;
    }

    /**
     * Мешы, по которым работают инструменты: выделение, измерения, точки интереса.
     *
     * Обычная модель даёт статический `meshInstances`, собранный после загрузки. У тайлов
     * такого списка быть не может — видимый набор меняется каждый кадр, поэтому мешы
     * видимых тайлов добавляются на лету.
     *
     * @returns Мешы сцены плюс мешы видимых сейчас тайлов.
     */
    private getPickableMeshInstances(): MeshInstance[] {
        const tileMeshInstances = this.tileManager?.getVisibleMeshInstances();
        if (!tileMeshInstances?.length) {
            return this.meshInstances;
        }
        return this.meshInstances.concat(tileMeshInstances);
    }

    /**
     * Configure human-scale walking from the same meters-per-scene-unit calibration as measurements.
     *
     * @param sceneSize - Radius-like scene extent used for the initial downward floor search.
     */
    private configureWalkScale(sceneSize = this.dynamicSceneBounds.halfExtents.length()) {
        const unitScale = Number(this.observer.get('measure.unitScale') ?? 1);
        const metersPerSceneUnit = Number.isFinite(unitScale) && unitScale > 0 ? unitScale : 1;
        this.cameraControls.walkEyeHeight = 1.7 / metersPerSceneUnit;
        this.cameraControls.walkStepHeight = 0.45 / metersPerSceneUnit;
        this.cameraControls.walkRadius = 0.3 / metersPerSceneUnit;
        this.cameraControls.walkSpeed = 1.8 / metersPerSceneUnit;
        this.cameraControls.walkGravity = 9.81 / metersPerSceneUnit;
        this.cameraControls.walkProbeDistance = Math.max(sceneSize * 4, this.cameraControls.walkEyeHeight * 4);
    }

    /**
     * Closest exact triangle hit for walking. The cheap AABB slab test keeps the per-frame ground
     * ray practical even for a streamed tileset: only visible meshes crossed by the short probe
     * reach the triangle loop.
     *
     * @param origin - World-space start of the ray.
     * @param direction - Normalized world-space direction.
     * @param maxDistance - Furthest accepted hit in scene units.
     * @returns Closest visible triangle hit, or null when the ray crosses no geometry.
     */
    private probeWalkSurface(origin: Vec3, direction: Vec3, maxDistance: number): WalkSurfaceHit | null {
        let bestDistance = maxDistance;
        let bestHit: WalkSurfaceHit | null = null;

        for (const meshInstance of this.getPickableMeshInstances()) {
            if (!meshInstance.visible || meshInstance.node?.enabled === false) continue;
            const aabb = meshInstance.aabb;
            if (!aabb) continue;
            const min = aabb.getMin();
            const max = aabb.getMax();
            let near = 0;
            let far = bestDistance;
            let intersects = true;

            for (const axis of ['x', 'y', 'z'] as const) {
                const d = direction[axis];
                if (Math.abs(d) < 1e-8) {
                    if (origin[axis] < min[axis] || origin[axis] > max[axis]) intersects = false;
                    continue;
                }
                const t0 = (min[axis] - origin[axis]) / d;
                const t1 = (max[axis] - origin[axis]) / d;
                near = Math.max(near, Math.min(t0, t1));
                far = Math.min(far, Math.max(t0, t1));
                if (far < near) intersects = false;
            }
            if (!intersects || near > bestDistance) continue;

            const hit = intersectMeshTrianglesDetailed(
                meshInstance,
                origin,
                direction,
                bestDistance,
                this.meshGeometryCache
            );
            if (!hit || hit.t >= bestDistance) continue;
            bestDistance = hit.t;
            bestHit = { point: hit.point.clone(), normal: hit.normal.clone(), distance: hit.t };
        }

        return bestHit;
    }

    /**
     * Реакция на изменение набора видимых тайлов: перерисовать кадр и, пока не определено,
     * выяснить, освещён ли контент (unlit-сплаты из фотограмметрии vs лит-PBR). Флаг
     * читает панель, чтобы подписать режим и убрать неприменимые каналы.
     *
     * @param transformChanged - Сдвинулся ли сам тайлсет: тогда пересчитываем границы сцены.
     */
    private handleTileChange(transformChanged = false) {
        if (transformChanged && this.tileManager) {
            this.sceneBounds.copy(this.tileManager.bounds);
            this.dynamicSceneBounds.copy(this.tileManager.bounds);
            this.dirtyBounds = true;
            this.fitCameraClipPlanes();
        }
        this.renderNextFrame();
        if (this.observer.get('scene.tilesetLit') === null && this.tileManager) {
            const meshInstance = this.tileManager.getVisibleMeshInstances()[0];
            const material = meshInstance?.material as { useLighting?: boolean } | undefined;
            if (material) {
                this.observer.set('scene.tilesetLit', material.useLighting !== false);
            }
        }
        // Неявное дерево разворачивается по мере зума — верх ползунка LOD растёт вместе с ним.
        if (this.tileManager) {
            const depth = this.tileManager.getTreeDepth();
            if (depth > Number(this.observer.get('scene.tilesetMaxDepth') ?? 0)) {
                this.observer.set('scene.tilesetMaxDepth', depth);
            }
        }
    }

    private destroyTileManager() {
        if (this.observer.get('debug.tilePick')) {
            this.observer.set('debug.tilePick', false);
        }
        this.tileManager?.destroy();
        this.tileManager = null;
        this.updateViewCubeVisibility();
    }

    /**
     * Статистика тайлового слоя — для отладки из консоли и автотестов.
     *
     * @returns Счётчики тайлов или `null`, если тайлсет не загружен.
     */
    getTileStats() {
        return this.tileManager?.getStats() ?? null;
    }

    /** Применить к менеджеру текущую отметку перемотки из observer. */
    private applyTileReplay() {
        const limit = Number(this.observer.get('debug.tileReplay') ?? -1);
        this.tileManager?.setReplayLimit(limit);
        // Вместе с отбором отматываем и саму камеру: тайлы ехали к тем её положениям, и без
        // этого перемотка показывала бы их отбор от камеры на момент заморозки.
        const world = this.tileManager?.applyReplayView(limit) ?? null;
        if (this.frozenTileCamera) {
            if (!this.frozenTileCameraAtFreeze) {
                this.frozenTileCameraAtFreeze = this.frozenTileCamera.world.clone();
            }
            this.frozenTileCamera.world.copy(world ?? this.frozenTileCameraAtFreeze);
        }
        this.renderNextFrame();
    }

    /** Начать новый эпизод: выйти из таймлайна, очистить историю и пустить загрузку. */
    private startTileReplayRecording() {
        if (!this.tileManager) return;

        // Сначала выходим из инспектора: он возвращает живую камеру к последней записанной
        // позе и снимает подмену вида у менеджера. После этого новый эпизод стартует именно
        // с той сцены, на которой закончился предыдущий.
        if (this.observer.get('debug.tileFreeze')) {
            this.observer.set('debug.tileFreeze', false);
        } else {
            this.observer.set('debug.tileReplay', -1);
            // Наблюдатель не рассылает событие при записи прежнего значения.
            this.applyTileReplay();
        }

        this.tileManager?.resetLoadHistory();
        this.surfaceNavigationEvents.length = 0;
        this.tileReplayPlaying = false;
        this.tileReplayCursorValue = 0;
        // Разметку заставляем пересобраться явно: число загрузок после сброса может совпасть
        // с прежним, хотя сам эпизод уже другой.
        this.tileReplayTimeline?.invalidate();
        // Stop ставит поток на паузу; новая запись всегда снова запускает его.
        if (this.observer.get('debug.tilePaused')) {
            this.observer.set('debug.tilePaused', false);
        }
        this.renderNextFrame();
    }

    /** Tile debugging is scoped strictly to the open Materials tab. */
    exitTileDebugMode() {
        this.closingTileDebugMode = true;
        this.tileManager?.stopLoadHistory();
        this.tileManager?.releaseRecordedSelections();
        this.tileReplayPlaying = false;
        this.tileReplayCursorValue = 0;
        this.observer.set('debug.tileRecording', false);
        this.observer.set('debug.tileFreeze', false);
        this.observer.set('debug.tilePaused', false);
        this.observer.set('debug.tileReplay', -1);
        [
            'debug.tileDebug', 'debug.tileLodColor', 'debug.tileOrderLabels',
            'debug.tileIdLabels', 'debug.tileOrderPerLod', 'debug.tilePick',
            'debug.tileIsolatePick', 'debug.tileCheckerFill', 'debug.tileLodLock'
        ].forEach(path => this.observer.set(path, false));
        this.tileManager?.setFrozen(false);
        this.tileManager?.setPaused(false);
        this.tileReplayTimeline?.destroy();
        this.tileReplayTimeline = null;
        this.surfaceNavigationEvents.length = 0;
        document.body.classList.remove('timeline-open');
        this.closingTileDebugMode = false;
        this.renderNextFrame();
    }

    /** Остановить запись и перейти к просмотру зафиксированного эпизода на таймлайне. */
    private stopTileReplayRecording() {
        if (!this.tileManager) return;
        this.tileManager.stopLoadHistory();
        this.tileReplayPlaying = false;
        this.observer.set('debug.tileReplay', -1);
        if (!this.observer.get('debug.tileFreeze')) {
            this.observer.set('debug.tileFreeze', true);
        }
        this.renderNextFrame();
    }

    /**
     * Toggle whichever timeline is currently available to the user.
     *
     * @returns Whether a timeline handled the shortcut.
     */
    private toggleActiveTimelinePlayback() {
        if (document.body.classList.contains('poi-timeline-open')) {
            let hasPoi = false;
            try {
                const list = JSON.parse(String(this.observer.get('poi.list') ?? '[]'));
                hasPoi = Array.isArray(list) && list.some(poi => !poi?.trigger);
            } catch { /* malformed external state: leave the empty timeline stopped */ }
            if (!hasPoi) return false;
            document.dispatchEvent(new Event(TOGGLE_POI_TIMELINE_PLAYBACK_EVENT));
            return true;
        }

        if (document.body.classList.contains('timeline-open')) {
            return this.toggleTileReplayPlayback();
        }

        try {
            const animations = JSON.parse(String(this.observer.get('animation.list') ?? '[]'));
            if (Array.isArray(animations) && animations.length > 0) {
                this.observer.set('animation.playing', !this.observer.get('animation.playing'));
                return true;
            }
        } catch { /* malformed external state: there is no usable animation timeline */ }
        return false;
    }

    /**
     * Toggle tile-history playback and restart from the beginning when it is at the end.
     *
     * @returns Whether a recorded tile timeline was available.
     */
    private toggleTileReplayPlayback() {
        const total = this.tileManager?.getRecordingDuration() ?? 0;
        if (total <= 0) return false;
        this.tileReplayPlaying = !this.tileReplayPlaying;
        if (this.tileReplayPlaying) {
            const now = Number(this.observer.get('debug.tileReplay') ?? -1);
            this.tileReplayCursorValue = now < 0 ? 0 : now;
            if (this.tileReplayCursorValue >= total) this.tileReplayCursorValue = 0;
            this.observer.set('debug.tileReplay', this.tileReplayCursorValue);
        }
        this.renderNextFrame();
        return true;
    }

    /** Применить к менеджеру текущую изоляцию уровня LOD из observer. */
    private applyTileLodIsolate() {
        const locked = !!this.observer.get('debug.tileLodLock');
        const level = Number(this.observer.get('debug.tileLodLevel') ?? 0);
        this.tileManager?.setLodIsolate(locked ? level : null);
        this.renderNextFrame();
    }

    /**
     * Сохранить позу и оптику камеры в момент Freeze. После этого живая камера свободно
     * двигается как инспектор, а менеджер тайлов продолжает считать выбор от того же вида.
     *
     * @param enabled - Создать или удалить снимок камеры.
     * @param requireTileManager - Снимать только при живом менеджере тайлов.
     */
    private captureFrozenTileCamera(enabled: boolean, requireTileManager = true) {
        if (!enabled || (requireTileManager && !this.tileManager)) {
            this.frozenTileCamera = null;
            return;
        }
        const camera = this.camera.camera;
        this.frozenTileCameraAtFreeze = null;
        this.frozenTileCamera = {
            world: this.camera.getWorldTransform().clone(),
            focus: this.cameraControls.getFocus().clone(),
            fov: camera.fov,
            horizontalFov: camera.horizontalFov,
            aspect: camera.aspectRatio || 1,
            nearClip: camera.nearClip,
            farClip: camera.farClip,
            orthographic: camera.projection === 1,
            orthoHeight: camera.orthoHeight
        };
    }

    /** Перевести живую камеру в боковой ракурс, где одновременно видны сцена и камера отбора. */
    private enterFrozenTileCameraInspector() {
        const frozen = this.frozenTileCamera;
        if (!frozen) return;

        const origin = new Vec3();
        frozen.world.getTranslation(origin);
        const focus = frozen.focus;
        const radius = Math.max(this.sceneBounds.halfExtents.length(), 0.01);
        const span = Math.max(origin.distance(focus) + radius, radius * 2, 1);
        const viewDirection = new Vec3().sub2(focus, origin).normalize();
        const side = new Vec3().cross(viewDirection, Vec3.UP);
        if (side.lengthSq() < 1e-8) {
            side.copy(Vec3.RIGHT);
        } else {
            side.normalize();
        }
        const target = new Vec3(
            origin.x + (focus.x - origin.x) * 0.55,
            origin.y + (focus.y - origin.y) * 0.55,
            origin.z + (focus.z - origin.z) * 0.55
        );
        const observerPosition = target.clone()
        .add(side.mulScalar(span * 0.82))
        .add(new Vec3(0, span * 0.38, 0));
        this.cameraControls.reset(target, observerPosition);
        this.fitCameraClipPlanes();
    }

    /** Вернуть рабочую камеру в сохранённый вид при выходе из inspector-режима. */
    private restoreFrozenTileCameraView() {
        const frozen = this.frozenTileCamera;
        if (!frozen) return;

        const position = new Vec3();
        frozen.world.getTranslation(position);
        const camera = this.camera.camera;
        camera.fov = frozen.fov;
        camera.horizontalFov = frozen.horizontalFov;
        camera.projection = frozen.orthographic ? 1 : 0;
        camera.orthoHeight = frozen.orthoHeight;
        this.cameraControls.reset(frozen.focus, position);
        this.fitCameraClipPlanes();
    }

    /** Нарисовать замороженную камеру: RGB-оси, каркас/сетку и полупрозрачный объём FOV. */
    private drawFrozenTileCamera() {
        this.debugTileCamera.clear();
        this.debugTileCameraSolid.clear();

        const frozen = this.frozenTileCamera;
        const freezeEnabled = this.observer.get('debug.tileFreeze') || this.observer.get('debug.gsplatFreeze');
        if (!frozen || !freezeEnabled) {
            this.debugTileCamera.update();
            this.debugTileCameraSolid.update();
            return;
        }

        const origin = new Vec3();
        frozen.world.getTranslation(origin);
        const radius = Math.max(this.sceneBounds.halfExtents.length(), 0.01);
        const distanceToScene = origin.distance(this.sceneBounds.center);
        const desiredLength = Math.max(radius * 1.5, distanceToScene + radius * 0.35, 0.5);
        const farDistance = Math.max(
            frozen.nearClip * 2,
            Math.min(frozen.farClip, desiredLength)
        );
        const nearDistance = Math.min(
            farDistance * 0.25,
            Math.max(frozen.nearClip, farDistance * 0.025)
        );

        let verticalFov = frozen.fov * math.DEG_TO_RAD;
        if (frozen.horizontalFov) {
            verticalFov = 2 * Math.atan(Math.tan(verticalFov * 0.5) / frozen.aspect);
        }

        const cornersAt = (distance: number) => {
            const halfHeight = frozen.orthographic ?
                frozen.orthoHeight :
                Math.tan(verticalFov * 0.5) * distance;
            const halfWidth = halfHeight * frozen.aspect;
            return [
                new Vec3(-halfWidth, halfHeight, -distance),
                new Vec3(halfWidth, halfHeight, -distance),
                new Vec3(halfWidth, -halfHeight, -distance),
                new Vec3(-halfWidth, -halfHeight, -distance)
            ].map(point => frozen.world.transformPoint(point, point));
        };
        const nearCorners = cornersAt(nearDistance);
        const farCorners = cornersAt(farDistance);

        // Оси камеры: X красный, Y зелёный, Z синий. Жёлтая линия показывает направление -Z.
        const axisSize = Math.max(radius * 0.08, farDistance * 0.04, 0.05);
        this.debugTileCamera.axis(frozen.world, axisSize);
        const farCenter = new Vec3();
        frozen.world.transformPoint(new Vec3(0, 0, -farDistance), farCenter);
        this.debugTileCamera.line(origin, farCenter, 0xff00ffff);

        for (let i = 0; i < 4; ++i) {
            const next = (i + 1) % 4;
            this.debugTileCamera.line(nearCorners[i], nearCorners[next], 0xffffffff);
            this.debugTileCamera.line(farCorners[i], farCorners[next], 0xff00ffff);
            this.debugTileCamera.line(
                frozen.orthographic ? nearCorners[i] : origin,
                farCorners[i],
                0xffffff00
            );
        }

        // Сетка дальнего сечения делает угол/аспект FOV читаемыми со стороны.
        const interpolate = (a: Vec3, b: Vec3, t: number) => new Vec3(
            a.x + (b.x - a.x) * t,
            a.y + (b.y - a.y) * t,
            a.z + (b.z - a.z) * t
        );
        for (let i = 1; i < 4; ++i) {
            const t = i / 4;
            this.debugTileCamera.line(
                interpolate(farCorners[0], farCorners[1], t),
                interpolate(farCorners[3], farCorners[2], t),
                0x8000ffff
            );
            this.debugTileCamera.line(
                interpolate(farCorners[0], farCorners[3], t),
                interpolate(farCorners[1], farCorners[2], t),
                0x8000ffff
            );
        }

        this.debugTileCameraSolid.frustumFaces(nearCorners, farCorners);
        this.debugTileCamera.update();
        this.debugTileCameraSolid.update();
    }

    /** Draw the authored POI path and the independently animated virtual camera. */
    private drawPoiObserverCamera() {
        this.debugPoiObserverCamera.clear();
        this.debugPoiObserverCameraSolid.clear();

        const view = this.poiObserverView;
        if (!this.poiObserverMode || !view) {
            this.debugPoiObserverCamera.update();
            this.debugPoiObserverCameraSolid.update();
            return;
        }

        // The saved camera positions make the authored route readable even while playback is
        // stopped. Invalid/partial settings entries are simply omitted from the path.
        try {
            const list = JSON.parse(String(this.observer.get('poi.list') ?? '[]')) as Array<{
                trigger?: boolean;
                camera?: PoiCameraView;
            }>;
            const keyframes = Array.isArray(list) ? list
            .filter(poi => !poi?.trigger)
            .map(poi => this.normalizePoiCameraView(poi?.camera, view.fov))
            .filter((camera): camera is PoiObserverView => !!camera) : [];
            for (let i = 1; i < keyframes.length; ++i) {
                this.debugPoiObserverCamera.line(keyframes[i - 1].position, keyframes[i].position, 0xc0ffb33c);
            }
        } catch {
            // A malformed POI list must not take down rendering; the current frustum still works.
        }

        const forward = view.focus.clone().sub(view.position);
        const focusDistance = forward.length();
        if (focusDistance < 1e-6) forward.set(0, 0, -1);
        else forward.mulScalar(1 / focusDistance);
        const upHint = Math.abs(forward.y) > 0.98 ? new Vec3(0, 0, 1) : new Vec3(0, 1, 0);
        const right = new Vec3().cross(forward, upHint).normalize();
        const up = new Vec3().cross(right, forward).normalize();

        const radius = Math.max(this.sceneBounds.halfExtents.length(), 0.05);
        const farDistance = Math.max(radius * 0.35, Math.min(Math.max(focusDistance, radius * 0.35), radius * 1.5));
        const nearDistance = Math.max(farDistance * 0.04, 0.005);
        const aspect = Math.max(0.1, this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight));
        const verticalFov = math.clamp(view.fov, 1, 179) * math.DEG_TO_RAD;
        const cornersAt = (distance: number) => {
            const halfHeight = Math.tan(verticalFov * 0.5) * distance;
            const halfWidth = halfHeight * aspect;
            return [
                [-halfWidth, halfHeight],
                [halfWidth, halfHeight],
                [halfWidth, -halfHeight],
                [-halfWidth, -halfHeight]
            ].map(([x, y]) => view.position.clone()
            .add(right.clone().mulScalar(x))
            .add(up.clone().mulScalar(y))
            .add(forward.clone().mulScalar(distance)));
        };
        const nearCorners = cornersAt(nearDistance);
        const farCorners = cornersAt(farDistance);

        // Cyan is the route/current view, yellow is the optical direction, and the translucent
        // volume makes the saved field of view legible against the model from either side.
        this.debugPoiObserverCamera.line(view.position, view.focus, 0xffffd24a);
        for (let i = 0; i < 4; ++i) {
            const next = (i + 1) % 4;
            this.debugPoiObserverCamera.line(nearCorners[i], nearCorners[next], 0xffffffff);
            this.debugPoiObserverCamera.line(farCorners[i], farCorners[next], 0xc0ffb33c);
            this.debugPoiObserverCamera.line(view.position, farCorners[i], 0xa0ffb33c);
        }
        this.debugPoiObserverCameraSolid.frustumFaces(nearCorners, farCorners, 0x123cb3ff, 0x0a4ad2ff);
        this.debugPoiObserverCamera.update();
        this.debugPoiObserverCameraSolid.update();
    }

    // set the currently selected track
    setSelectedTrack(trackName: string) {
        if (trackName !== 'ALL_TRACKS') {
            const a = this.animationMap[trackName];
            this.entities.forEach((e) => {
                e.anim?.baseLayer?.transition(a);
            });
        }
    }

    // play an animation / play all the animations
    play() {
        this.entities.forEach((e) => {
            if (e.anim) {
                e.anim.playing = true;
                e.anim.baseLayer?.play();
            }
        });
    }

    // stop playing animations
    stop() {
        this.animStopTime = null;
        this.entities.forEach((e) => {
            if (e.anim) {
                e.anim.playing = false;
                e.anim.baseLayer?.pause();
            }
        });
    }

    /**
     * Задать время (сек) автостопа анимации. Цикл обновления остановит
     * проигрывание, когда текущее время клипа достигнет цели. null — снять.
     *
     * @param time - Время остановки в секундах или `null`, чтобы снять автостоп.
     */
    setAnimationStopTime(time: number | null) {
        this.animStopTime = time;
    }

    // set the animation speed
    setSpeed(speed: number) {
        this.animSpeed = speed;
        this.entities.forEach((e) => {
            const anim = e.anim;
            if (anim) {
                anim.speed = speed;
            }
        });
    }

    setTransition(transition: number) {
        this.animTransition = transition;

        // it's not possible to change the transition time after creation,
        // so rebuilt the animation graph with the new transition
        if (this.animTracks.length > 0) {
            this.rebuildAnimTracks();
        }
    }

    setLoops(loops: number) {
        this.animLoops = loops;

        // it's not possible to change the transition time after creation,
        // so rebuilt the animation graph with the new transition
        if (this.animTracks.length > 0) {
            this.rebuildAnimTracks();
        }
    }

    setAnimationProgress(progress: number) {
        if (this.suppressAnimationProgressUpdate) return;
        // Ручная перемотка — снимаем автостоп диапазона (пользователь взял управление).
        this.animStopTime = null;
        this.entities.forEach((e) => {
            const anim = e.anim;
            const baseLayer = anim?.baseLayer;
            if (baseLayer) {
                this.play();
                baseLayer.activeStateCurrentTime = baseLayer.activeStateDuration * progress;
                anim.update(0);
                anim.playing = false;
            }
        });
        this.renderNextFrame();
    }

    setSelectedNode(path: string) {
        const graphNode = this.app.root.findByPath(path);
        if (graphNode) {
            this.observer.set('scene.selectedNode', {
                name: graphNode.name,
                path: path,
                position: graphNode.getLocalPosition().toString(),
                rotation: graphNode.getLocalEulerAngles().toString(),
                scale: graphNode.getLocalScale().toString()
            });
        } else {
            this.observer.set('scene.selectedNode', {
                name: '',
                path: '',
                position: '',
                rotation: '',
                scale: ''
            });
        }

        this.selectedNode = graphNode;
        this.updateMaterialChannelInfo();
        this.updateSelectedMaterialFactors();
        this.updateSelectedMaterialColor();
        this.updateSelectedSpecularColor();
        this.updateSelectedUvSets();
        this.updateTexelDensityStats();
        this.dirtyWireframe = true;
        this.dirtySelectionHighlight = true;
        this.dirtyTexelDensityHeatmap = true;
        this.dirtyBounds = true;
        this.dirtySkeleton = true;
        this.renderNextFrame();
    }

    setSelectedVariant(variant: string) {
        if (variant) {
            this.entityAssets.forEach((entityAsset) => {
                const resource = entityAsset.asset.resource as ContainerResource;
                if (resource.getMaterialVariants().indexOf(variant) !== -1) {
                    resource.applyMaterialVariant(entityAsset.entity, variant);
                }
            });
            if (Object.keys(this.materialFactorOverrides).length > 0) {
                this.applyMaterialOverrides(this.materialFactorOverrides);
            }
            this.updateMaterialChannelInfo();
            this.updateSelectedMaterialFactors();
            this.updateSelectedMaterialColor();
            this.updateSelectedSpecularColor();
            this.updateSelectedUvSets();
            this.updateTexelDensityStats();
            this.dirtyTexelDensityHeatmap = true;
            this.renderNextFrame();
        }
    }

    setSelectedUvSet(value: number) {
        const selectedUvSet = Math.max(0, Math.min(UV_SEMANTICS.length - 1, Number(value) | 0));
        this.uvCheckerMaterial.diffuseMapUv = selectedUvSet;
        this.uvCheckerMaterial.emissiveMapUv = selectedUvSet;
        this.uvCheckerMaterial.update();
        this.uvColorMaterial.diffuseMapUv = selectedUvSet;
        this.uvColorMaterial.emissiveMapUv = selectedUvSet;
        this.uvColorMaterial.update();

        if (this.uvDebugMode === 'uv0') {
            this.resetUvColorMeshes();
            this.buildUvColorMeshes();
        }

        this.updateTexelDensityStats();
        this.dirtyTexelDensityHeatmap = true;
        this.renderNextFrame();
    }

    setSelectedCamera(cameraPath: string) {
        // CameraFrame is bound to one concrete CameraComponent.
        this.destroyPostProcessingFrame();
        // disable any previously active scene camera
        if (this.activeSceneCamera) {
            this.activeSceneCamera.enabled = false;
            this.activeSceneCamera = null;
        }

        if (cameraPath) {
            // find the camera entity by path
            const cameraEntity = this.app.root.findByPath(cameraPath) as Entity;
            if (cameraEntity && cameraEntity.camera) {
                // disable the viewer camera and its controls
                this.camera.camera.enabled = false;
                this.cameraControls.enabled = false;

                // enable the scene camera
                cameraEntity.camera.enabled = true;
                this.activeSceneCamera = cameraEntity.camera;

                // transfer render target and layers to scene camera
                cameraEntity.camera.renderTarget = this.camera.camera.renderTarget;
                cameraEntity.camera.layers = this.camera.camera.layers;
                cameraEntity.camera.clearColor = this.camera.camera.clearColor;
                cameraEntity.camera.toneMapping = this.camera.camera.toneMapping;
            } else {
                // if the specified camera is not found or invalid, fall back to the viewer camera
                this.camera.camera.enabled = true;
                this.cameraControls.enabled = true;
            }
        } else {
            // switch back to viewer camera
            this.camera.camera.enabled = true;
            this.cameraControls.enabled = true;
        }

        this.syncMultiframeCamera();
        this.renderNextFrame();
    }

    setCenterScene(value: boolean) {
        const positionOffset = this.sceneTransform.position;
        this.sceneRoot.setLocalPosition(positionOffset[0], positionOffset[1], positionOffset[2]);
        this.sceneRoot.setLocalEulerAngles(this.sceneTransform.rotation[0], this.sceneTransform.rotation[1], this.sceneTransform.rotation[2]);
        this.sceneRoot.setLocalScale(this.sceneTransform.scale[0], this.sceneTransform.scale[1], this.sceneTransform.scale[2]);
        this.sceneContentRoot.setLocalPosition(0, 0, 0);

        // calculate scene bounds after first render in order to get accurate morph target and skinned bounds
        this.tileManager?.syncTransform();
        this.calcSceneBounds(this.sceneBounds);

        // offset scene geometry to place it at the origin
        const pivotOffset = this.sceneTransform.pivotOffset;
        let contentX = -pivotOffset[0];
        let contentY = -pivotOffset[1];
        let contentZ = -pivotOffset[2];
        if (value) {
            contentX += -this.sceneBounds.center.x;
            contentY += -this.sceneBounds.getMin().y;
            contentZ += -this.sceneBounds.center.z;
        }
        this.sceneContentRoot.setLocalPosition(contentX, contentY, contentZ);

        this.dirtyBounds = true;

        // 3D Tiles select LOD in world space; keep their OBB/SSE transform in lockstep
        // with the hierarchy instead of waiting for the next frame.
        this.tileManager?.syncTransform();

        this.renderNextFrame();
    }

    /**
     * Unlit-контент светом не затеняется, но тень на ловушку он всё равно отбрасывает — под
     * фотограмметрией с уже запечённым освещением она выглядит инородно, а раздела света,
     * где её выключают, для unlit-сцены больше нет. Поэтому гасим ловушку по умолчанию;
     * явная настройка из settings JSON применяется позже и побеждает.
     */
    private applyUnlitShadowCatcherDefault() {
        if (this.observer.get('scene.unlit')) {
            this.observer.set('shadowCatcher.enabled', false);
        }
    }

    private captureSceneContentTransform() {
        return new Mat4().copy(this.sceneContentRoot.getWorldTransform());
    }

    private applyPoiTransformFromLastAlignmentState() {
        if (!this.lastAlignmentContentTransform) {
            return;
        }
        const currentTransform = this.captureSceneContentTransform();
        this.transformPoisBetween(this.lastAlignmentContentTransform, currentTransform);
        this.lastAlignmentContentTransform = currentTransform;
    }

    private transformPoisBetween(previousTransform: Mat4, nextTransform: Mat4) {
        const previousInverse = new Mat4().copy(previousTransform).invert();

        // Бокс размеров следует за моделью: переносим его центр тем же
        // преобразованием. Делаем это ДО раннего выхода по отсутствию POI,
        // чтобы бокс двигался даже когда точек интереса нет.
        if (this.observer.get('dimensionBox.enabled')) {
            const c = this.observer.get('dimensionBox.center') as unknown;
            if (Array.isArray(c) && c.length >= 3) {
                const bp = new Vec3(Number(c[0]) || 0, Number(c[1]) || 0, Number(c[2]) || 0);
                const bl = new Vec3();
                const bw = new Vec3();
                previousInverse.transformPoint(bp, bl);
                nextTransform.transformPoint(bl, bw);
                this.observer.set('dimensionBox.center', [bw.x, bw.y, bw.z]);
                this.dirtyBounds = true;
            }
        }

        const poiListRaw = this.observer.get('poi.list');
        if (!poiListRaw) {
            return;
        }

        let poiList: Array<Record<string, unknown>>;
        try {
            poiList = JSON.parse(String(poiListRaw));
        } catch {
            return;
        }
        if (!Array.isArray(poiList) || poiList.length === 0) {
            return;
        }

        const point = new Vec3();
        const localPoint = new Vec3();
        const worldPoint = new Vec3();
        const vector = new Vec3();
        const localVector = new Vec3();
        const worldVector = new Vec3();

        const transformPoint = (value: unknown) => {
            if (!Array.isArray(value) || value.length < 3) return value;
            point.set(Number(value[0]) || 0, Number(value[1]) || 0, Number(value[2]) || 0);
            previousInverse.transformPoint(point, localPoint);
            nextTransform.transformPoint(localPoint, worldPoint);
            return [worldPoint.x, worldPoint.y, worldPoint.z];
        };

        const transformVector = (value: unknown) => {
            if (!Array.isArray(value) || value.length < 3) return value;
            vector.set(Number(value[0]) || 0, Number(value[1]) || 0, Number(value[2]) || 0);
            previousInverse.transformVector(vector, localVector);
            nextTransform.transformVector(localVector, worldVector);
            worldVector.normalize();
            return [worldVector.x, worldVector.y, worldVector.z];
        };

        const updated = poiList.map((poi) => {
            const nextPoi: Record<string, unknown> = { ...poi };
            nextPoi.position = transformPoint(poi.position);
            nextPoi.normal = transformVector(poi.normal);

            if (poi.camera && typeof poi.camera === 'object' && !Array.isArray(poi.camera)) {
                const camera = poi.camera as Record<string, unknown>;
                nextPoi.camera = {
                    ...camera,
                    position: transformPoint(camera.position),
                    focus: transformPoint(camera.focus)
                };
            }

            return nextPoi;
        });

        this.observer.set('poi.list', JSON.stringify(updated));
        this.renderNextFrame();
    }

    setDebugStats(show: boolean) {
        this.miniStats.enabled = show;
        this.renderNextFrame();
    }

    setDebugWireframe(show: boolean) {
        this.showWireframe = show;
        this.dirtyWireframe = true;
        this.dirtySelectionHighlight = true;
        this.renderNextFrame();
    }

    setWireframeColor(color: { r: number; g: number; b: number } | null | undefined) {
        const safe = Viewer.sanitizeRgb(color, { r: 0, g: 1, b: 0 });
        this.wireframeMaterial.ambient = new Color(safe.r, safe.g, safe.b);
        this.wireframeMaterial.diffuse = new Color(safe.r, safe.g, safe.b);
        this.wireframeMaterial.specular = new Color(0, 0, 0);
        this.wireframeMaterial.emissive = new Color(safe.r, safe.g, safe.b);
        this.wireframeMaterial.update();
        this.renderNextFrame();
    }

    setDebugBounds(show: boolean) {
        this.showBounds = show;
        this.dirtyBounds = true;
        this.renderNextFrame();
    }

    setDebugSkeleton(show: boolean) {
        this.showSkeleton = show;
        this.dirtySkeleton = true;
        this.renderNextFrame();
    }

    setAlignmentMode(enabled: boolean) {
        if (!this.rotateGizmo || !this.translateGizmo || !this.dimensionBoxScaleGizmo) {
            return;
        }

        this.rotateGizmo.enabled = false;
        this.translateGizmo.enabled = false;
        this.dimensionBoxScaleGizmo.enabled = false;
        // Куб используется и выравниванием, и инспектором тайлов; выход из одного режима
        // не должен прятать инструмент, пока второй остаётся активным.
        this.updateViewCubeVisibility();
        if (enabled) {
            this.setAlignmentGizmoMode(this.observer.get('debug.alignmentGizmoMode') ?? 'rotate');
        } else {
            this.rotateGizmo.detach();
            this.translateGizmo.detach();
            this.dimensionBoxScaleGizmo.detach();
            this.cameraControls.enabled = true;
            // Все отображения выравнивания гаснут при выходе: размерный бокс и орто-проекция
            // (камера возвращается к обычной перспективе — это была песочница).
            this.observer.set('dimensionBox.enabled', false);
            if (this.isOrthographic()) this.setCameraProjection(false);
        }
        this.renderNextFrame();
    }

    setAlignmentGizmoMode(mode: 'move' | 'rotate' | 'resize') {
        if (!this.rotateGizmo || !this.translateGizmo || !this.dimensionBoxScaleGizmo) {
            return;
        }

        const target = this.getAlignmentTarget();
        // Гизмо доступен либо в режиме выравнивания (редактор), либо когда активен
        // РЕДАКТИРУЕМЫЙ хелпер (напр. «слушатель» пространственного звука на публичной
        // странице, где alignmentMode выключен). Иначе слушателя нельзя было таскать.
        const helperEditing = target === 'helper' && !!this.observer.get('helpers.editable');
        const enabled = !!this.observer.get('debug.alignmentMode') || helperEditing;
        this.rotateGizmo.enabled = false;
        this.translateGizmo.enabled = false;
        this.dimensionBoxScaleGizmo.enabled = false;
        this.rotateGizmo.detach();
        this.translateGizmo.detach();
        this.dimensionBoxScaleGizmo.detach();

        if (!enabled) {
            this.renderNextFrame();
            return;
        }

        if (target === 'helper') {
            const editable = !!this.observer.get('helpers.editable');
            const entity = this.activeHelperId ? this.helperEntities.get(this.activeHelperId) : null;
            if (!editable || !entity || mode !== 'move') {
                this.renderNextFrame();
                return;
            }
            // Крупнее (2×) для хелпера: подпись «Слушатель» перекрывает стандартный размер.
            this.translateGizmo.size = 2;
            this.translateGizmo.attach([entity]);
            this.translateGizmo.enabled = true;
            this.translateGizmo.update();
            this.renderNextFrame();
            return;
        }

        // Pivot uses the same sceneRoot as the model, but only translation: the drag
        // handlers hold the geometry in place so just the transform origin moves.
        if (target === 'pivot') {
            if (mode !== 'move') {
                this.renderNextFrame();
                return;
            }
            this.translateGizmo.size = 1;
            this.translateGizmo.attach([this.sceneRoot]);
            this.translateGizmo.enabled = true;
            this.translateGizmo.update();
            this.renderNextFrame();
            return;
        }

        if (target === 'box') {
            if (!this.observer.get('dimensionBox.initialized')) {
                this.setDimensionBoxFromModelBounds();
            }
            if (!this.observer.get('dimensionBox.enabled')) {
                this.renderNextFrame();
                return;
            }
            this.syncDimensionBoxEntityFromObserver();
            if (mode === 'move') {
                this.translateGizmo.size = 1;
                this.translateGizmo.attach([this.dimensionBoxEntity]);
                this.translateGizmo.enabled = true;
                this.translateGizmo.update();
            } else if (mode === 'resize') {
                this.dimensionBoxScaleGizmo.attach([this.dimensionBoxEntity]);
                this.dimensionBoxScaleGizmo.enabled = true;
                this.dimensionBoxScaleGizmo.update();
            } else {
                this.rotateGizmo.attach([this.dimensionBoxEntity]);
                this.rotateGizmo.enabled = true;
                this.rotateGizmo.update();
            }
            this.renderNextFrame();
            return;
        }

        if (mode === 'move') {
            this.translateGizmo.size = 1; // обычный размер для выравнивания сцены
            this.translateGizmo.attach([this.sceneRoot]);
            this.translateGizmo.enabled = true;
            this.translateGizmo.update();
        } else {
            this.rotateGizmo.attach([this.sceneRoot]);
            this.rotateGizmo.enabled = true;
            this.rotateGizmo.update();
        }

        this.renderNextFrame();
    }

    private setRotationSnap(enabled: boolean) {
        if (!this.rotateGizmo) {
            return;
        }
        this.rotateGizmo.snap = enabled;
        this.rotateGizmo.snapIncrement = 10;
    }

    setDebugAxes(show: boolean) {
        this.showAxes = show;
        this.dirtySkeleton = true;
        this.renderNextFrame();
    }

    setDebugGrid(show: boolean) {
        this.showGrid = show;
        this.dirtyGrid = true;
        this.renderNextFrame();
    }

    setNormalLength(length: number) {
        this.normalLength = length;
        this.dirtyNormals = true;
        this.renderNextFrame();
    }

    setUvCheckerScale(scale: number) {
        const clamped = Math.max(1, Math.min(64, Number(scale) || 16));
        this.uvCheckerMaterial.diffuseMapTiling.set(clamped, clamped);
        this.uvCheckerMaterial.emissiveMapTiling.set(clamped, clamped);
        this.uvCheckerMaterial.update();
        this.renderNextFrame();
    }

    setFov(fov: number) {
        this.camera.camera.fov = fov;
        this.renderNextFrame();
    }

    setRenderMode(renderMode: string) {
        const nextUvDebugMode = (renderMode === 'uv_checker' || renderMode === 'uv0') ? renderMode : null;
        if (this.uvDebugMode !== nextUvDebugMode) {
            this.resetUvCheckerMeshes();
            this.resetUvColorMeshes();
            this.uvDebugMode = nextUvDebugMode;
            this.uvCheckerEnabled = nextUvDebugMode === 'uv_checker';

            if (nextUvDebugMode) {
                this.setUvCheckerBaseVisibility(true);
                if (nextUvDebugMode === 'uv_checker') {
                    this.buildUvCheckerMeshes();
                } else {
                    this.buildUvColorMeshes();
                }
            } else {
                this.setUvCheckerBaseVisibility(false);
                this.meshInstances.forEach((mi) => {
                    mi.visible = true;
                });
            }
        } else if (nextUvDebugMode === 'uv_checker') {
            this.uvCheckerEnabled = true;
            this.resetUvCheckerMeshes();
            this.buildUvCheckerMeshes();
        } else if (nextUvDebugMode === 'uv0') {
            this.resetUvColorMeshes();
            this.buildUvColorMeshes();
        } else {
            this.meshInstances.forEach((mi) => {
                mi.visible = true;
            });
        }

        this.camera.camera.setShaderPass((renderMode !== 'default' && !nextUvDebugMode) ? `debug_${renderMode}` : 'forward');
        this.renderNextFrame();
    }

    setLightEnabled(value: boolean) {
        this.light.enabled = value;
        this.renderNextFrame();
    }

    setLightIntensity(factor: number) {
        this.light.light.intensity = factor;
        this.renderNextFrame();
    }

    setLightColor(color: { r: number; g: number; b: number } | null | undefined) {
        const safe = Viewer.sanitizeRgb(color, { r: 1, g: 1, b: 1 });
        this.light.light.color = new Color(safe.r, safe.g, safe.b);
        this.renderNextFrame();
    }

    setLightFollow(enable: boolean) {
        this.light.reparent(enable ? this.camera : this.app.root);
        if (enable) {
            this.light.setLocalEulerAngles(90, 0, 0);
        } else {
            this.light.setLocalEulerAngles(45, 30, 0);
        }
        this.renderNextFrame();
    }

    setLightShadow(enable: boolean) {
        this.light.light.castShadows = enable;
        this.renderNextFrame();
    }

    setShadowCatcherEnabled(value: boolean) {
        this.shadowCatcher.enabled = value;
        this.renderNextFrame();
    }

    setShadowCatcherIntensity(value: number) {
        this.shadowCatcher.intensity = value;
        this.renderNextFrame();
    }

    setShadowCatcherHeightOffset(value: number) {
        this.shadowCatcher.heightOffset = value;
        this.renderNextFrame();
    }

    setSkyboxExposure(factor: number) {
        this.app.scene.skyboxIntensity = Math.pow(2, factor);
        this.renderNextFrame();
    }

    setSkyboxRotation(factor: number) {
        const rot = new Quat();
        rot.setFromEulerAngles(0, factor, 0);
        this.app.scene.skyboxRotation = rot;

        this.renderNextFrame();
    }

    setSkyboxBackground(background: string) {
        const { scene } = this.app;

        this.app.scene.layers.getLayerById(LAYERID_SKYBOX).enabled = background !== 'Solid Color';

        switch (background) {
            case 'Solid Color':
                break;
            case 'Infinite Sphere':
                scene.sky.type = SKYTYPE_INFINITE;
                break;
            case 'Projective Dome':
                scene.sky.type = SKYTYPE_DOME;
                break;
            case 'Projective Box':
                scene.sky.type = SKYTYPE_BOX;
                break;
        }

        this.app.scene.skyboxMip = background === 'Infinite Sphere' ? this.observer.get('skybox.blur') : 0;

        this.renderNextFrame();
    }

    setSkyboxBlur(blur: number) {
        this.app.scene.skyboxMip = this.observer.get('skybox.background') === 'Infinite Sphere' ? blur : 0;
        this.renderNextFrame();
    }

    setSkyboxDomeRadius(radius: number) {
        const scale = (this.sceneBounds?.halfExtents.length() ?? 1) * radius;
        this.app.scene.sky.node.setLocalScale(scale, scale, scale);
        this.renderNextFrame();
    }

    setSkyboxTripodOffset(offset: number) {
        this.app.scene.sky.center = new Vec3(0, offset, 0);
        this.renderNextFrame();
    }

    setTonemapping(tonemapping: string) {
        const mapping: Record<string, number> = {
            None: TONEMAP_NONE,
            Linear: TONEMAP_LINEAR,
            Neutral: TONEMAP_NEUTRAL,
            Filmic: TONEMAP_FILMIC,
            Hejl: TONEMAP_HEJL,
            ACES: TONEMAP_ACES,
            ACES2: TONEMAP_ACES2
        };

        this.camera.camera.toneMapping = mapping.hasOwnProperty(tonemapping) ? mapping[tonemapping] : TONEMAP_ACES;
        this.renderNextFrame();
    }

    setBackgroundColor(color: { r: number; g: number; b: number } | null | undefined) {
        // null/битый цвет (испорченный localStorage или sidecar-настройки) не должен
        // валить вьюер на старте — молча берём дефолтный фон.
        const safe = Viewer.sanitizeRgb(color, { r: 128 / 255, g: 128 / 255, b: 128 / 255 });
        const cnv = (value: number) => Math.max(0, Math.min(255, Math.floor(value * 255)));
        document.getElementById('canvas-wrapper').style.backgroundColor = `rgb(${cnv(safe.r)}, ${cnv(safe.g)}, ${cnv(
            safe.b
        )})`;
    }

    private static sanitizeRgb(
        color: { r?: unknown; g?: unknown; b?: unknown } | null | undefined,
        fallback: { r: number; g: number; b: number }
    ): { r: number; g: number; b: number } {
        if (!color || typeof color !== 'object') return fallback;
        const r = Number(color.r);
        const g = Number(color.g);
        const b = Number(color.b);
        return [r, g, b].every(Number.isFinite) ? { r, g, b } : fallback;
    }

    update(deltaTime: number) {
        // GSplatWorld создаётся лениво уже после загрузки сцены. Устанавливаем cap-only бюджет до
        // `framerender`, где движок впервые рассчитывает LOD и формирует очередь загрузки.
        this.syncGSplatBudgetCeilings();

        // Менеджер spatial-сцены может появиться уже после нажатия кнопки. Патчим его
        // до `framerender`, где PlayCanvas переносит цвета в work buffer.
        if (this.observer.get('debug.gsplatLodColor')) this.syncGSplatLodDebugPalette();

        // Шаг проигрывания истории — здесь, а не в обновлении оверлея: запрос кадра изнутри
        // самого кадра следующего не даёт, и проигрывание вставало после первого шага.
        if (this.tileReplayPlaying) {
            this.advanceTileReplay(this.tileManager?.getRecordingDuration() ?? 0, deltaTime);
        }
        this.updateCameraFlyTransition(deltaTime);
        this.updatePoiObserverTransition(deltaTime);
        this.updateDoubleClickZoomTransition(deltaTime);

        // update the orbit camera
        if (!this.cameraFlyTransition && !this.doubleClickZoomTransition) {
            this.cameraControls.update(deltaTime);
        }
        if (this.observer.get('debug.tileRecording')) {
            this.tileManager?.recordFrame();
        }

        // Surface markers use the camera pose produced above. In particular, a pan marker must
        // move in the same frame as its grabbed point instead of visually trailing by one frame.
        this.surfacePivotController?.update();

        // Синхронизируем навигационный куб с ориентацией камеры (только когда он виден).
        if (this.viewCube && this.viewCube.dom.style.display !== 'none') {
            this.viewCube.update(this.camera.getWorldTransform());
        }

        this.setRotationSnap(!!this.rotateGizmo?.enabled && this.app.keyboard.isPressed(KEY_CONTROL));

        // Обход дерева тайлов идёт каждый кадр, даже когда рендера не будет: он дешёвый, а
        // решение «нужен ли кадр» принимает сам менеджер — по изменению набора видимых
        // тайлов (у приложения `autoRender === false`).
        this.tileManager?.update();

        const maxdiff = (a: Mat4, b: Mat4) => {
            let result = 0;
            for (let i = 0; i < 16; ++i) {
                result = Math.max(result, Math.abs(a.data[i] - b.data[i]));
            }
            return result;
        };

        // if the camera has moved since the last render
        const cameraWorldTransform = this.camera.getWorldTransform();
        if (maxdiff(cameraWorldTransform, this.prevCameraMat) > 1e-4) {
            this.prevCameraMat.copy(cameraWorldTransform);
            this.renderNextFrame();
        }

        // or an animation is loaded and we're animating
        let isAnimationPlaying = false;
        for (let i = 0; i < this.entities.length; ++i) {
            const anim = this.entities[i].anim;
            if (anim && anim.baseLayer && anim.baseLayer.playing) {
                isAnimationPlaying = true;
                break;
            }
        }

        if (isAnimationPlaying) {
            this.dirtyBounds = true;
            this.dirtySkeleton = true;
            this.dirtyNormals = true;
            this.renderNextFrame();
            this.observer.emit('animationUpdate');
        }

        // or the ministats is enabled
        if (this.miniStats.enabled) {
            this.renderNextFrame();
        }
    }

    renderNextFrame() {
        this.app.renderNextFrame = true;
        if (this.multiframe) {
            this.multiframe.moved();
        }
    }

    clearCta() {
        // Флаг убирает экран из разметки; классы ниже оставлены — на них завязаны
        // соседние правила стилей (отступы панели и канваса без приглашения).
        this.observer.set('ui.cta', false);
        document.querySelector('#panel-left')?.classList.add('no-cta');
        document.querySelector('#application-canvas')?.classList.add('no-cta');
        document.querySelector('.load-button-panel')?.classList.add('hide');
    }

    // add a loaded asset to the scene
    // asset is a container asset with renders and/or animations
    private addToScene(asset: Asset) {
        const resource = asset.resource as ContainerResourceLike | null;
        const meshesLoaded = !!(resource?.renders && resource.renders.length > 0);
        const animsLoaded = !!(resource?.animations && resource.animations.length > 0);
        const prevEntity: Entity = this.entities.length === 0 ? null : this.entities[this.entities.length - 1];

        let entity: Entity;

        // create entity
        if (!meshesLoaded && prevEntity && prevEntity.findComponent('render')) {
            entity = prevEntity;
        } else {
            if (asset.type === 'container') {
                // container/glb
                entity = resource?.instantiateRenderEntity?.() ?? new Entity();
            } else {
                // Gaussian splat scene. Every format (PLY, compressed PLY, SOG, LOD/streaming
                // meta.json) goes through the engine's unified gsplat pipeline: `unified` defaults
                // to true since engine 2.20 and the non-unified path is deprecated there, so we
                // deliberately don't pass the flag. Frame invalidation for splat streaming/sorting
                // is handled once, app-wide, in initGSplat().
                entity = new Entity();
                entity.setEulerAngles(0, 0, 180);
                entity.addComponent('gsplat', { asset });
            }

            this.entities.push(entity);
            this.entityAssets.push({ entity: entity, asset: asset });
            this.sceneContentRoot.addChild(entity);
            this.shadowCatcher.onEntityAdded(entity);
        }

        // create animation component
        if (animsLoaded) {
            // append anim tracks to global list
            (resource?.animations ?? []).forEach((a) => {
                this.animTracks.push(a.resource);
            });
        }

        // store the loaded asset
        this.assets.push(asset);
    }

    // perform post-load operations on the scene
    private postSceneLoad() {
        // construct a list of meshInstances so we can quickly access them when configuring wireframe rendering etc.
        this.meshInstances = this.entities
        .map((entity) => {
            return this.collectMeshInstances(entity);
        })
        .flat();

        if (this.observer.get('debug.renderMode') === 'uv_checker') {
            this.uvCheckerEnabled = true;
            this.uvDebugMode = 'uv_checker';
            this.setUvCheckerBaseVisibility(true);
            this.resetUvCheckerMeshes();
            this.buildUvCheckerMeshes();
        } else if (this.observer.get('debug.renderMode') === 'uv0') {
            this.uvDebugMode = 'uv0';
            this.setUvCheckerBaseVisibility(true);
            this.resetUvColorMeshes();
            this.buildUvColorMeshes();
        }

        // if no meshes are currently loaded, then enable skeleton rendering so user can see something
        // Mesh-less scenes default to skeleton debug — but a splat scene is not "empty", it just has
        // no MeshInstances under the unified gsplat pipeline.
        const hasGsplat = this.entities.some(entity => !!entity.findComponent('gsplat'));
        if (this.meshInstances.length === 0 && !hasGsplat) {
            this.observer.set('debug.skeleton', true);
        }

        // update
        this.updateSceneStats();
        this.updateSelectedUvSets();

        // rebuild the anim state graph
        if (this.animTracks.length > 0) {
            this.rebuildAnimTracks();
        }

        // make a list of all the morph instance target names
        const morphs: Record<string, { name: string; targets: Record<string, MorphTargetData> }> = {};
        const morphInstances: Record<string, MorphInstance> = {};

        // get all morph targets
        this.meshInstances.forEach((meshInstance, i) => {
            if (meshInstance.morphInstance) {
                const morphInstance = meshInstance.morphInstance;
                morphInstances[i] = morphInstance;

                // mesh name line
                const meshName = (meshInstance && meshInstance.node && meshInstance.node.name) || `Mesh ${i}`;
                morphs[i] = {
                    name: meshName,
                    targets: {}
                };

                // morph targets
                morphInstance.morph.targets.forEach((target: MorphTarget, targetIndex: number) => {
                    morphs[i].targets[targetIndex] = {
                        name: target.name,
                        targetIndex: targetIndex
                    };
                    this.observer.on(`morphs.${i}.targets.${targetIndex}.weight:set`, (weight: number) => {
                        morphInstances[i].setWeight(targetIndex, weight);
                        this.dirtyNormals = true;
                        this.renderNextFrame();
                    });
                });
            }
        });

        this.observer.suspendEvents = true;
        this.observer.set('morphs', morphs);
        this.observer.suspendEvents = false;

        // handle animation update
        const observer = this.observer;
        observer.on('animationUpdate', () => {
            // set progress
            for (let i = 0; i < this.entities.length; ++i) {
                const entity = this.entities[i];
                if (entity && entity.anim) {
                    const baseLayer = entity.anim.baseLayer;
                    // Автостоп ограниченного диапазона (POI-триггер): останавливаем,
                    // когда текущее время клипа достигло цели. Здесь время
                    // авторитетно (в секундах), в отличие от обработчика progress.
                    if (this.animStopTime !== null && baseLayer.activeStateCurrentTime >= this.animStopTime) {
                        this.stop();
                    }
                    const progress = baseLayer.activeStateCurrentTime / baseLayer.activeStateDuration;
                    this.suppressAnimationProgressUpdate = true;
                    observer.set('animation.progress', progress === 1 ? progress : progress % 1);
                    this.suppressAnimationProgressUpdate = false;
                    break;
                }
            }
        });

        // dirty everything
        this.dirtySelectionHighlight = true;
        this.dirtyWireframe = this.dirtyBounds = this.dirtySkeleton = this.dirtyGrid = this.dirtyNormals = true;

        // we perform some special processing on the first frame
        this.firstFrame = true;

        // Сцена собрана. Дальше остался только кадр — но если браузер его не даст
        // (отложенная встройка), хост не должен ждать вечно.
        if (this.viewerReadyTimer) {
            clearTimeout(this.viewerReadyTimer);
        }
        this.viewerReadyTimer = setTimeout(() => this.announceViewerReady(), Viewer.VIEWER_READY_FALLBACK_MS);

        // Schedule the frame only after the flag is set. This guarantees that even
        // engines which consume renderNextFrame immediately will run first-frame cleanup.
        this.renderNextFrame();

        // re-apply skybox/light from observer (in case anything in postSceneLoad used defaults)
        this.syncSkyboxAndLightFromObserver();
    }

    private initSceneBounds() {
        this.setCenterScene(this.observer.get('centerScene'));

        // set projective skybox radius
        this.setSkyboxDomeRadius(this.observer.get('skybox.domeProjection.domeRadius'));

        // focus the camera on the scene
        this.focus(true);

        // refit camera clip planes
        this.fitCameraClipPlanes();
    }

    // rebuild the animation state graph
    private rebuildAnimTracks() {
        // reset animation map to avoid stale entries when rebuilding
        this.animationMap = {};
        // Build unique display names for animations (handle duplicate names)
        const nameCounts = new Map<string, number>();
        this.animTracks.forEach((t: any) => {
            nameCounts.set(t.name, (nameCounts.get(t.name) ?? 0) + 1);
        });

        // If there are duplicates, append index to make names unique
        const nameIndices = new Map<string, number>();
        const uniqueDisplayNames: string[] = this.animTracks.map((t: any) => {
            const name = t.name;
            if (nameCounts.get(name) > 1) {
                const index = nameIndices.get(name) ?? 0;
                nameIndices.set(name, index + 1);
                return `${name} (${index + 1})`;
            }
            return name;
        });

        this.entities.forEach((entity) => {
            // create the anim component if there isn't one already
            if (!entity.anim) {
                entity.addComponent('anim', {
                    activate: true,
                    speed: this.animSpeed
                });
                entity.anim.rootBone = entity;
            } else {
                // clean up any previous animations
                entity.anim.removeStateGraph();
            }

            this.animTracks.forEach((t: any, i: number) => {
                // add an event to each track which transitions to the next track when it ends
                t.events = new AnimEvents([
                    {
                        name: 'transition',
                        time: t.duration,
                        nextTrack: `track_${i === this.animTracks.length - 1 ? 0 : i + 1}`
                    }
                ]);
                const path = `track_${i}`;
                entity.anim.assignAnimation(path, t);
                // Use unique display name as key to avoid overwriting animations with the same name
                this.animationMap[uniqueDisplayNames[i]] = path;
            });
            // if the user has selected to play all tracks in succession, then transition to the next track after a set amount of loops
            entity.anim.on('transition', (e) => {
                const animationName: string = this.observer.get('animation.selectedTrack');
                if (animationName === 'ALL_TRACKS' && entity.anim.baseLayer.activeStateProgress >= this.animLoops) {
                    entity.anim.baseLayer.transition(e.nextTrack, this.animTransition);
                }
            });
        });

        // let the controls know about the new animations, set the selected track and immediately start playing the animation
        const animationState = this.observer.get('animation');
        const animationKeys = Object.keys(this.animationMap);
        animationState.list = JSON.stringify(animationKeys);
        animationState.selectedTrack = animationKeys[0];
        // Авто-старт анимации можно отключить флагом встройки animAutoplay
        // (модель грузится и видна, но анимация стоит на паузе на кадре 0).
        const embed = this.observer.get('ui.embed');
        animationState.playing = !embed?.enabled || embed?.animAutoplay !== false;
        this.observer.set('animation', animationState);
    }

    private calcSceneBounds(result: BoundingBox, root: Entity | null = null) {
        const entities = root ? [root] : this.entities;

        let first = true;

        const renderComponents = entities.map(e => e.findComponents('render') as RenderComponent[]).flat().map(rc => rc.meshInstances).flat();
        if (renderComponents.length) {
            for (let i = 0; i < renderComponents.length; ++i) {
                if (first) {
                    result.copy(renderComponents[i].aabb);
                    first = false;
                } else {
                    result.add(renderComponents[i].aabb);
                }
            }
        }

        const gsplatComponents = entities.map(e => e.findComponents('gsplat') as GSplatComponent[]).flat().filter(gc => !!gc.customAabb);
        if (gsplatComponents.length) {
            for (let i = 0; i < gsplatComponents.length; ++i) {
                bbox.setFromTransformedAabb(gsplatComponents[i].customAabb, gsplatComponents[i].entity.getWorldTransform());
                if (first) {
                    result.copy(bbox);
                    first = false;
                } else {
                    result.add(bbox);
                }
            }
        }

        // Габариты тайлсета берутся из корневого bounding volume, а не из загруженных
        // тайлов: набор видимых тайлов меняется каждый кадр, и если считать по ним, камера
        // и кадрирование будут прыгать при каждом переключении уровня детализации.
        if (!root && this.tileManager) {
            if (first) {
                result.copy(this.tileManager.bounds);
                first = false;
            } else {
                result.add(this.tileManager.bounds);
            }
        }

        if (first) {
            result.copy(defaultSceneBounds);
        }
    }

    private resetWireframeMeshes() {
        this.app.scene.layers.getLayerByName('World').removeMeshInstances(this.wireframeMeshInstances);
        this.wireframeMeshInstances.forEach((mi) => {
            mi.clearShaders();
        });
        this.wireframeMeshInstances = [];
    }

    private resetUvCheckerMeshes() {
        this.app.scene.layers.getLayerByName('World').removeMeshInstances(this.uvCheckerMeshInstances);
        this.uvCheckerMeshInstances.forEach((mi) => {
            mi.clearShaders();
        });
        this.uvCheckerMeshInstances = [];
    }

    private resetUvColorMeshes() {
        this.app.scene.layers.getLayerByName('World').removeMeshInstances(this.uvColorMeshInstances);
        this.uvColorMeshInstances.forEach((mi) => {
            mi.clearShaders();
        });
        this.uvColorMeshInstances = [];
    }

    private buildUvCheckerMeshes() {
        this.uvCheckerMeshInstances = this.meshInstances.map((mi) => {
            const meshInstance = new MeshInstance(mi.mesh, this.uvCheckerMaterial, mi.node);
            meshInstance.skinInstance = mi.skinInstance;
            meshInstance.morphInstance = mi.morphInstance;
            return meshInstance;
        });

        this.app.scene.layers.getLayerByName('World').addMeshInstances(this.uvCheckerMeshInstances);
    }

    private buildUvColorMeshes() {
        this.uvColorMeshInstances = this.meshInstances
        .map((mi) => {
            const meshInstance = new MeshInstance(mi.mesh, this.uvColorMaterial, mi.node);
            meshInstance.skinInstance = mi.skinInstance;
            meshInstance.morphInstance = mi.morphInstance;
            return meshInstance;
        });

        this.app.scene.layers.getLayerByName('World').addMeshInstances(this.uvColorMeshInstances);
    }

    private setUvCheckerBaseVisibility(enabled: boolean) {
        if (enabled) {
            this.uvCheckerOriginalVisibility.clear();
            this.meshInstances.forEach((mi) => {
                this.uvCheckerOriginalVisibility.set(mi.id, mi.visible);
                mi.visible = false;
            });
            return;
        }

        this.meshInstances.forEach((mi) => {
            mi.visible = this.uvCheckerOriginalVisibility.has(mi.id) ?
                this.uvCheckerOriginalVisibility.get(mi.id) as boolean :
                true;
        });
        this.uvCheckerOriginalVisibility.clear();
    }

    /**
     * Снять обводку с ранее выделенного узла.
     *
     * Именно `removeEntity`, а не `removeAllEntities`: последний только вычищает слой, но
     * оставляет на материалах хук `onUpdateShader` и параметр `pcOutlineColor`, и они
     * копятся от выделения к выделению.
     */
    private clearSelectionOutline() {
        if (this.outlinedEntity && this.outlineRenderer) {
            this.outlineRenderer.removeEntity(this.outlinedEntity);
        }
        this.outlinedEntity = null;
    }

    private resetTexelDensityHeatmapMeshes() {
        this.app.scene.layers.getLayerByName('World').removeMeshInstances(this.texelDensityHeatmapMeshInstances);
        this.texelDensityHeatmapMeshInstances.forEach((mi) => {
            mi.clearShaders();
        });
        this.texelDensityHeatmapMeshInstances = [];
        this.texelDensityHeatmapMaterials.forEach(material => material.destroy());
        this.texelDensityHeatmapMaterials = [];
    }

    private getTexelDensityHeatmapColor(value: number, min: number, max: number) {
        const stops = [
            { t: 0.0, c: [0.129, 0.4, 0.968] },
            { t: 0.25, c: [0.121, 0.78, 0.867] },
            { t: 0.5, c: [0.365, 0.86, 0.365] },
            { t: 0.75, c: [0.969, 0.82, 0.251] },
            { t: 1.0, c: [0.922, 0.251, 0.2] }
        ];
        const safeMin = Math.max(1e-6, min);
        const safeMax = Math.max(safeMin + 1e-6, max);
        const logMin = Math.log(safeMin);
        const logMax = Math.log(safeMax);
        const t = math.clamp((Math.log(Math.max(value, 1e-6)) - logMin) / (logMax - logMin), 0, 1);
        for (let i = 1; i < stops.length; i++) {
            if (t <= stops[i].t) {
                const a = stops[i - 1];
                const b = stops[i];
                const f = (t - a.t) / (b.t - a.t);
                return new Color(
                    a.c[0] + (b.c[0] - a.c[0]) * f,
                    a.c[1] + (b.c[1] - a.c[1]) * f,
                    a.c[2] + (b.c[2] - a.c[2]) * f
                );
            }
        }
        const last = stops[stops.length - 1].c;
        return new Color(last[0], last[1], last[2]);
    }

    private buildTexelDensityHeatmapMeshes() {
        if (!this.selectedNode || !this.observer.get('debug.withTextureOnly') || !this.observer.get('debug.texelDensityHeatmap')) return;

        const unitScale = Number(this.observer.get('measure.unitScale') ?? 1);
        const safeUnitScale = Number.isFinite(unitScale) && unitScale > 0 ? unitScale : 1;
        const selectedMeshes = this.collectMeshInstances(this.selectedNode as Entity);
        const entries = selectedMeshes.map(mi => ({
            mi,
            entry: this.calculateMeshInstanceTexelDensity(mi, safeUnitScale)
        })).filter(item => !!item.entry) as Array<{
            mi: MeshInstance;
            entry: NonNullable<ReturnType<Viewer['calculateMeshInstanceTexelDensity']>>;
        }>;

        if (entries.length === 0) return;

        const minTd = Math.min(...entries.map(item => item.entry.td));
        const maxTd = Math.max(...entries.map(item => item.entry.td));

        this.texelDensityHeatmapMeshInstances = entries.map(({ mi, entry }) => {
            const color = this.getTexelDensityHeatmapColor(entry.td, minTd, maxTd);
            const material = new StandardMaterial();
            material.useLighting = false;
            material.useSkybox = false;
            material.cull = mi.material?.cull;
            material.blendType = BLEND_NORMAL;
            material.depthState.write = false;
            material.depthBias = -0.2;
            material.slopeDepthBias = 0.2;
            material.opacity = 0.72;
            material.diffuse = color;
            material.emissive = color;
            material.update();
            this.texelDensityHeatmapMaterials.push(material);

            const meshInstance = new MeshInstance(mi.mesh, material, mi.node);
            meshInstance.skinInstance = mi.skinInstance;
            meshInstance.morphInstance = mi.morphInstance;
            return meshInstance;
        });

        this.app.scene.layers.getLayerByName('World').addMeshInstances(this.texelDensityHeatmapMeshInstances);
    }

    private buildWireframeMeshes() {
        this.wireframeMeshInstances = this.getSelectedMeshInstances().map((mi) => {
            const meshInstance = new MeshInstance(mi.mesh, this.wireframeMaterial, mi.node);
            meshInstance.renderStyle = PRIMITIVE_LINES;
            meshInstance.skinInstance = mi.skinInstance;
            meshInstance.morphInstance = mi.morphInstance;
            return meshInstance;
        });

        this.app.scene.layers.getLayerByName('World').addMeshInstances(this.wireframeMeshInstances);
    }

    /**
     * Обвести выделенный узел.
     *
     * Обводка берёт меши узла и его потомков и рисует их своей внутренней камерой в
     * отдельную цель, откуда силуэт подмешивается поверх сцены. Работает только со
     * `StandardMaterial` — этого хватает: glTF даёт именно их.
     */
    /**
     * Обводчик по требованию.
     *
     * Не создаётся, пока режимом «по объектам» не воспользовались: конструктор заводит
     * камеру, две цели отрисовки и компилирует пару шейдеров — платить за это тем, кто
     * выделением не пользуется, незачем.
     *
     * @returns Обводчик, готовый к работе.
     */
    private ensureOutlineRenderer(): OutlineRenderer {
        if (!this.outlineRenderer) {
            // Свой слой обязателен: камера сцены его не рисует (в её списке слоёв его нет),
            // рисует только внутренняя камера обводки — в свою цель за кадром, откуда
            // результат подмешивается поверх сцены.
            const layer = new Layer({ name: 'SelectionOutline' });
            this.app.scene.layers.push(layer);
            this.outlineLayer = layer;
            this.outlineRenderer = new OutlineRenderer(this.app, layer);
        }
        return this.outlineRenderer;
    }

    private updateSelectionOutline() {
        this.clearSelectionOutline();
        if (!this.selectedNode || !this.observer.get('debug.withTextureOnly')) {
            // Камера обводки рисует КАЖДЫЙ кадр, даже когда обводить нечего: чистит свою
            // цель и вхолостую гоняет проходы. На загрузке доспеха (125 МБ) это стоило
            // 1.8 секунды до первого кадра — замерено сравнением сборок. Поэтому пока
            // ничего не выделено, камера выключена, а сам обводчик и вовсе не создаётся,
            // если режимом «по объектам» не пользовались.
            if (this.outlineRenderer) {
                this.outlineRenderer.outlineCameraEntity.enabled = false;
            }
            return;
        }
        this.ensureOutlineRenderer().outlineCameraEntity.enabled = true;
        const renderer = this.outlineRenderer as OutlineRenderer;
        this.outlinedEntity = this.selectedNode as Entity;
        renderer.addEntity(this.outlinedEntity, SELECTION_OUTLINE_COLOR);

        // Заплатка на изъян движка (playcanvas 2.21.4). `addEntity` собирает для прохода
        // обводки СВЕЖИЕ `StandardMaterialOptions` и переносит туда лишь горстку полей —
        // `clusteredLightingEnabled` среди них нет, а по умолчанию он `true`. У нас
        // кластерное освещение выключено (см. `clusteredLightingEnabled = false`), поэтому
        // куска `lightBufferDefinesPS` в наборе нет вовсе. Препроцессор GLSL спотыкается о
        // неразрешённое включение, бросает работу — и в компилятор уходит сырой
        // `#include "litMainVS"` с ошибкой «invalid directive name». Под WGSL не всплывает.
        // Проверено опытом: без этих строк выделение под `?webgl` роняет компиляцию шейдера.
        const clustered = this.app.scene.clusteredLightingEnabled;
        const patched = new Set<unknown>();
        renderer.getMeshInstances(this.outlinedEntity, true).forEach((mi) => {
            const material = mi.material;
            if (!material || patched.has(material)) return;
            patched.add(material);
            const inner = (material as unknown as { onUpdateShader?: (o: StandardMaterialOptions) => StandardMaterialOptions }).onUpdateShader;
            if (typeof inner !== 'function') return;
            (material as unknown as { onUpdateShader: (o: StandardMaterialOptions) => StandardMaterialOptions }).onUpdateShader = (options) => {
                const opts = inner(options);
                opts.litOptions.clusteredLightingEnabled = clustered;
                return opts;
            };
        });
    }

    private onFrameRender() {
        const perfStart = this.perfEnabled ? performance.now() : 0;
        if (this.perfEnabled) {
            this.perfFrames++;
            if (this.perfLastFrameStartMs > 0) {
                this.perfFrameDeltasMs.push(perfStart - this.perfLastFrameStartMs);
            }
            this.perfLastFrameStartMs = perfStart;
        }

        if (this.canvasResize) {
            // Бэкбуфер держим в нативном разрешении экрана. `camera.pixelScale` уменьшает
            // не его, а цель, в которую рисуется сцена: тогда растяжку до экрана делает наш
            // финальный проход, а не композитор браузера ближайшим соседом.
            const { width, height } = this.getCanvasSize();
            this.app.graphicsDevice.setResolution(
                Math.max(1, Math.floor(width * window.devicePixelRatio)),
                Math.max(1, Math.floor(height * window.devicePixelRatio))
            );
            this.canvasResize = false;
        }

        // Движение отмечаем до пересборки целей: от него зависит запрошенное разрешение.
        this.updateCameraMotion();
        this.updateTileFocus();

        // rebuild render targets
        this.rebuildRenderTargets();
        // Optional post-processing is attached only after the final destination target exists.
        this.syncPostProcessingFrame();

        if (this.perfEnabled) {
            this.perfOnFrameRenderTotalMs += performance.now() - perfStart;
        }
    }

    // generate and render debug elements on prerender
    private onPrerender() {
        const perfStart = this.perfEnabled ? performance.now() : 0;
        if (this.firstFrame) {
            return;
        }

        // Обводка выделенного объекта.
        if (this.dirtySelectionHighlight) {
            this.dirtySelectionHighlight = false;
            this.updateSelectionOutline();
        }
        // Обводке нужен свой проход каждый кадр, и только когда есть что обводить:
        // вхолостую он стоил бы очистки полноэкранной цели на каждом кадре.
        if (this.outlinedEntity && this.outlineRenderer) {
            const cameraEntity = this.getRenderingCamera().entity as Entity;
            this.outlineRenderer.frameUpdate(cameraEntity, this.app.scene.layers.getLayerByName('World'), true);
        }

        if (this.dirtyTexelDensityHeatmap) {
            this.dirtyTexelDensityHeatmap = false;
            this.resetTexelDensityHeatmapMeshes();
            this.buildTexelDensityHeatmapMeshes();
        }

        // wireframe
        if (this.dirtyWireframe) {
            this.dirtyWireframe = false;

            this.resetWireframeMeshes();
            if (this.showWireframe) {
                this.buildWireframeMeshes();
            }

            this.getSelectedMeshInstances().forEach((mi) => {
                mi.material.depthBias = this.showWireframe ? -1.0 : 0.0;
                mi.material.slopeDepthBias = this.showWireframe ? 1.0 : 0.0;
            });
        }

        // debug bounds
        if (this.dirtyBounds) {
            this.dirtyBounds = false;

            // calculate bounds
            this.calcSceneBounds(this.dynamicSceneBounds);

            this.debugBounds.clear();
            if (this.showBounds) {
                this.calcSceneBounds(bbox, this.selectedNode as Entity);
                this.debugBounds.box(bbox.getMin(), bbox.getMax());
            }
            if (this.observer.get('dimensionBox.enabled')) {
                this.syncDimensionBoxEntityFromObserver();
                const transform = this.dimensionBoxEntity.getWorldTransform();
                const center = this.dimensionBoxEntity.getPosition();
                const ax = transform.transformVector(new Vec3(0.5, 0, 0));
                const ay = transform.transformVector(new Vec3(0, 0.5, 0));
                const az = transform.transformVector(new Vec3(0, 0, 0.5));
                this.debugBounds.obb(center, ax, ay, az, 0xff33d6ff);
            }
            this.debugBounds.update();

            this.tmpBoundsSize.set(
                this.dynamicSceneBounds.halfExtents.x * 2,
                this.dynamicSceneBounds.halfExtents.y * 2,
                this.dynamicSceneBounds.halfExtents.z * 2
            );
            this.observer.set('scene.bounds', this.tmpBoundsSize.toString());
            this.observer.set('scene.boundsCenter', this.dynamicSceneBounds.center.toString());
        }

        // debug normals
        if (this.dirtyNormals) {
            this.dirtyNormals = false;
            this.debugNormals.clear();

            if (this.normalLength > 0) {
                for (let i = 0; i < this.meshInstances.length; ++i) {
                    const meshInstance = this.meshInstances[i];

                    const vertexBuffer = meshInstance.morphInstance ? // @ts-ignore TODO not defined in pc
                        meshInstance.morphInstance._vertexBuffer :
                        meshInstance.mesh.vertexBuffer;

                    if (vertexBuffer) {
                        const skinMatrices = meshInstance.skinInstance ? meshInstance.skinInstance.matrices : null;

                        // if there is skinning we need to manually update matrices here otherwise
                        // our normals are always a frame behind
                        if (skinMatrices) {
                            // @ts-ignore TODO not defined in pc
                            meshInstance.skinInstance.updateMatrices(meshInstance.node);
                        }

                        this.debugNormals.generateNormals(
                            vertexBuffer,
                            meshInstance.node.getWorldTransform(),
                            this.normalLength,
                            skinMatrices
                        );
                    }
                }
            }
            this.debugNormals.update();
        }

        // debug skeleton
        if (this.dirtySkeleton) {
            this.dirtySkeleton = false;
            this.debugSkeleton.clear();

            if (this.showSkeleton) {
                this.entities.forEach((entity) => {
                    if (this.meshInstances.length === 0 || entity.findComponent('render')) {
                        this.debugSkeleton.generateSkeleton(
                            entity,
                            true,
                            false,
                            this.selectedNode
                        );
                    }
                });
            }

            if (this.showAxes) {
                const axisSize = Math.max(this.dynamicSceneBounds.halfExtents.length() * 0.25, 0.1);
                this.debugSkeleton.axis(this.sceneRoot.getWorldTransform(), axisSize);
            }

            this.debugSkeleton.update();
        }

        // debug grid
        if (this.sceneBounds && this.dirtyGrid) {
            this.dirtyGrid = false;

            this.debugGrid.clear();
            if (this.showGrid) {
                // calculate primary spacing
                const spacing = Math.pow(10, Math.floor(Math.log10(this.sceneBounds.halfExtents.length())));

                const v0 = this.tmpGridV0;
                const v1 = this.tmpGridV1;

                const y = 0;

                const numGrids = 10;
                const a = numGrids * spacing;
                for (let x = -numGrids; x < numGrids + 1; ++x) {
                    const b = x * spacing;

                    v0.set(-a, y, b);
                    v1.set(a, y, b);
                    this.debugGrid.line(v0, v1, b === 0 ? 0x80000000 >>> 0 : 0x80ffffff >>> 0);

                    v0.set(b, y, -a);
                    v1.set(b, y, a);
                    this.debugGrid.line(v0, v1, b === 0 ? 0x80000000 >>> 0 : 0x80ffffff >>> 0);
                }
            }
            this.debugGrid.update();
        }

        // debug tiles overlay (Фаза 1): OBB активных тайлов + живой HUD.
        // Не gated dirty-флагом: набор и состояния тайлов при стриминге меняются каждый кадр.
        this.debugTiles.clear();
        this.debugTilesSolid.clear();
        this.debugTilesFill.clear();
        this.debugSurfaceCursor.clear();
        if (this.tileManager && this.observer.get('debug.tileDebug')) {
            const mode = (this.observer.get('debug.tileDebugMode') as TileDebugMode) ?? 'lod';
            const style: TileDebugStyle = {
                lineThickness: Number(this.observer.get('debug.tileLineThickness') ?? 2),
                checker: this.observer.get('debug.tileLineStyle') !== 'solid',
                checkerFill: !!this.observer.get('debug.tileCheckerFill')
            };
            this.tileManager.debugDraw(this.debugTiles, this.debugTilesSolid, this.debugTilesFill, mode, style);
        }
        this.updateTileOrderLabels();
        const gsplatDebugEnabled = !!this.observer.get('scene.hasGsplat') &&
            (!!this.observer.get('debug.gsplatNodeBounds') || !!this.observer.get('debug.gsplatLodColor') ||
                !!this.observer.get('debug.gsplatFreeze') || !!this.observer.get('debug.gsplatPaused'));
        this.syncGSplatStreamingDebugControls();
        this.gsplatDebugStats = gsplatDebugEnabled ?
            this.updateGSplatDebugBounds(!!this.observer.get('debug.gsplatNodeBounds')) : null;
        this.debugTiles.update();
        this.debugTilesFill.update();
        this.debugTilesSolid.update();
        this.drawSurfaceNavigationCursor();
        this.debugSurfaceCursor.update();
        const loaded = this.tileManager?.getLoadedCount() ?? 0;
        if (loaded !== Number(this.observer.get('scene.tilesetLoadCount') ?? 0)) {
            this.observer.set('scene.tilesetLoadCount', loaded);
        }
        this.updateTileHud();
        this.updateTileReplayBar();
        this.drawFrozenTileCamera();
        this.drawPoiObserverCamera();

        // Exact production clipping and its persistent oriented-box contour. Newly
        // streamed materials are discovered here before the frame is submitted.
        this.syncFragmentMaterials();
        this.syncTileLodColors();
        this.debugFragmentBoxSolid.clear();
        this.debugFragmentBox.clear();
        if (this.observer.get('fragment.initialized')) {
            const transform = this.fragmentBoxEntity.getWorldTransform();
            const center = this.fragmentBoxEntity.getPosition();
            const ax = transform.transformVector(new Vec3(0.5, 0, 0));
            const ay = transform.transformVector(new Vec3(0, 0.5, 0));
            const az = transform.transformVector(new Vec3(0, 0, 0.5));
            const sphere = this.observer.get('fragment.shape') === 'sphere';
            if (!this.observer.get('fragment.enabled')) {
                if (sphere) {
                    this.debugFragmentBoxSolid.sphereFaces(center, ax, ay, az, this.fragmentFillColor());
                } else {
                    this.debugFragmentBoxSolid.obbFaces(center, ax, ay, az, this.fragmentFillColor());
                }
            }
            if (sphere) {
                // Толщина та же, что у рёбер бокса: иначе контур сферы выглядит тоньше, и две
                // формы читаются как разные по важности.
                this.debugFragmentBoxSolid.sphereEdgesThick(
                    center,
                    ax,
                    ay,
                    az,
                    this.camera.getPosition(),
                    0.0021,
                    0xffffffff
                );
            } else {
                this.debugFragmentBoxSolid.obbEdgesThick(
                    center,
                    ax,
                    ay,
                    az,
                    this.camera.getPosition(),
                    0.0021,
                    0xffffffff
                );
                this.debugFragmentBox.obb(center, ax, ay, az, 0xffffffff);
            }
        }
        this.debugFragmentBoxSolid.update();
        this.debugFragmentBox.update();
        this.updateFragmentHandles();

        // measurement overlays (thick 2D SVG line + crosses)
        // keep DebugLines buffer empty so measurements are always overlay-only (never depth-tested / occluded by mesh)
        this.debugMeasure.clear();
        this.debugMeasure.update();
        this.drawReferenceRuler();
        this.measurementController.updateOverlay((point: Vec3) => this.camera.camera.worldToScreen(point));
        this.poiController.updateOverlay((point: Vec3) => this.camera.camera.worldToScreen(point));
        this.microphoneController?.updateOverlay((point: Vec3) => this.camera.camera.worldToScreen(point));

        // fit camera planes to the scene
        this.fitCameraClipPlanes();

        this.shadowCatcher.onUpdate(this.dynamicSceneBounds);

        if (this.perfEnabled) {
            this.perfOnPrerenderTotalMs += performance.now() - perfStart;
        }
    }

    /** Живой DOM-оверлей со статистикой тайлов; создаётся лениво, прячется когда выключен. */
    private updateTileHud() {
        // Раскраска блоков по LOD включает HUD сама по себе: цвета на экране есть, значит
        // нужна и легенда, даже если контуры OBB выключены.
        const tileLodColor = !!this.observer.get('debug.tileLodColor');
        const tileEnabled = !!this.tileManager && (!!this.observer.get('debug.tileDebug') || tileLodColor);
        const gsplatEnabled = !!this.gsplatDebugStats;
        const enabled = tileEnabled || gsplatEnabled;
        if (!enabled) {
            if (this.tileHud) {
                this.tileHud.style.display = 'none';
            }
            return;
        }
        if (!this.tileHud) {
            const el = document.createElement('div');
            el.id = 'tile-debug-hud';
            el.style.cssText = 'position:absolute;left:8px;bottom:8px;z-index:100;pointer-events:none;' +
                'font:11px/1.45 ui-monospace,Menlo,monospace;color:#e8e8e8;background:rgba(0,0,0,0.62);' +
                'padding:6px 9px;border-radius:5px;letter-spacing:0.2px;';
            const text = document.createElement('div');
            text.style.cssText = 'white-space:pre;';
            // Полоска долей уровней — самая верхняя строка окна: соотношение считывается
            // взглядом, а числа в легенде под ней нужны, когда захочется точности. Наполняет её
            // та же функция, что рисует легенду, — так они не могут разойтись.
            const bar = document.createElement('div');
            bar.style.cssText = 'display:none;height:6px;border-radius:3px;overflow:hidden;' +
                'margin:0 0 5px;background:rgba(255,255,255,0.10);';

            const legend = document.createElement('div');
            // Легенда над текстом: цвета — первое, что нужно глазу, а строки статистики
            // меняются по высоте (выбранный тайл добавляет блок) и сдвигали бы её.
            legend.style.cssText = 'display:none;flex-wrap:wrap;align-items:center;gap:4px;margin:0 0 5px;';
            el.appendChild(bar);
            el.appendChild(legend);
            el.appendChild(text);
            this.tileHudBar = bar;
            const canvas = this.app.graphicsDevice.canvas as HTMLCanvasElement;
            (canvas.parentElement ?? document.body).appendChild(el);
            this.tileHud = el;
            this.tileHudText = text;
            this.tileHudLegend = legend;
        }
        this.tileHud.style.display = 'block';
        // Над временной шкалой, когда она открыта: иначе она накрывает нижние строки статистики.
        this.tileHud.style.bottom = document.body.classList.contains('timeline-open') ? '76px' : '8px';

        if (gsplatEnabled && this.gsplatDebugStats) {
            const s = this.gsplatDebugStats;
            const mode = (this.observer.get('debug.gsplatDebugMode') as 'state' | 'lod') ?? 'lod';
            const lods = s.lodCounts.map((count, lod) => `L${lod}:${count}`).filter(label => !label.endsWith(':0')).join('  ');
            const flags = [
                this.observer.get('debug.gsplatFreeze') ? 'FROZEN' : '',
                this.observer.get('debug.gsplatPaused') ? 'PAUSED' : ''
            ].filter(Boolean).join(' ');
            // Легенда имеет смысл, только когда на экране действительно цвета LOD: это либо
            // раскраска самих сплатов, либо режим `lod` у границ узлов. В режиме `state`
            // границы окрашены по состоянию загрузки, и палитра уровней там ни при чём.
            const lodColored = !!this.observer.get('debug.gsplatLodColor') || mode === 'lod';
            this.renderLodLegend(s.lodCounts, lodColored, lod => s.maxLod - lod);
            this.setHudText(
                `GSPLAT SPATIAL LOD   mode: ${mode}${flags ? `   ${flags}` : ''}${s.awaitingLodUpdate ? '   UPDATING' : ''}\n` +
                `nodes ${s.nodes}   visible ${s.visibleNodes}   transitioning ${s.transitioningNodes}\n` +
                `files loaded ${s.loadedFiles}   running ${s.runningFiles}   queued ${s.queuedFiles}\n` +
                `splats ${s.activeSplats.toLocaleString()} / ${s.budget.toLocaleString()}${lodColored ? '' : `\n${lods || 'LOD selection pending'}`}`
            );
            return;
        }

        const s = this.tileManager.getStats();
        const mb = (s.bytes / (1024 * 1024)).toFixed(1);
        const budgetMb = (s.bytesBudget / (1024 * 1024)).toFixed(0);
        // Порог показываем только когда память его подняла: в норме это лишний шум, а под
        // нехваткой это главное, что объясняет, почему картинка загрубела.
        const sse = s.errorTargetScale > 1.01 ?
            `   SSE ${s.errorTarget.toFixed(1)}px x${s.errorTargetScale.toFixed(2)} (memory)` : '';
        const mode = (this.observer.get('debug.tileDebugMode') as TileDebugMode) ?? 'lod';
        const flags = [
            this.observer.get('debug.tileRecording') ? 'RECORDING' :
                (this.observer.get('debug.tileFreeze') ? 'TIMELINE' : ''),
            this.observer.get('debug.tilePaused') ? 'PAUSED' : ''
        ].filter(Boolean).join(' ');
        if (mode === 'resolution') {
            this.renderResolutionLegend(true);
        } else {
            this.renderLodLegend(s.depthCounts, mode === 'lod' || tileLodColor);
        }
        this.setHudText(
            `TILES ${s.tiles}   mode: ${mode}${flags ? `   ${flags}` : ''}\n` +
            `ready ${s.ready}  loading ${s.loading}  queued ${s.queued}  failed ${s.failed}\n` +
            `selected ${s.selected}   depth ${s.maxSelectedDepth}   ${mb} / ${budgetMb} MB${sse}`
        );

        const picked = this.tileManager.getDebugPickedTileInfo();
        if (picked) {
            const pickedMb = (picked.bytes / (1024 * 1024)).toFixed(2);
            const primaryUrl = picked.urls[0] ?? '(no content URL)';
            let displayUrl = primaryUrl;
            try {
                const parsed = new URL(primaryUrl, window.location.href);
                displayUrl = `${parsed.pathname}${parsed.search}`;
            } catch {
                // Оставляем исходную строку: URL нужен для диагностики даже если он некорректен.
            }
            if (displayUrl.length > 76) {
                displayUrl = `…${displayUrl.slice(-75)}`;
            }
            this.appendHudText(
                `\n\nPICKED TILE   LOD ${picked.depth}   ${picked.state.toUpperCase()}   ${picked.refine}\n` +
                `SSE ${picked.screenSpaceError.toFixed(2)} px   error ${picked.geometricError.toFixed(2)}   distance ${picked.distance.toFixed(2)}\n` +
                `content ${picked.contentCount}   ${pickedMb} MB   triangles ${picked.triangles.toLocaleString()}\n` +
                `${displayUrl}`
            );
        } else if (this.observer.get('debug.tilePick')) {
            this.appendHudText('\n\nPICK TILE: click model surface');
        }
    }

    /**
     * Записать текстовую часть HUD.
     *
     * @param text - Готовые строки статистики.
     */
    private setHudText(text: string) {
        if (this.tileHudText) this.tileHudText.textContent = text;
    }

    /**
     * Дописать блок к тексту HUD.
     *
     * @param text - Дополнительные строки.
     */
    private appendHudText(text: string) {
        if (this.tileHudText) this.tileHudText.textContent += text;
    }

    /**
     * Легенда уровней детализации: ряд квадратов цвета LOD с номером уровня внутри и
     * количеством узлов/тайлов рядом. Палитра общая со сплатами и тайлами, поэтому одна и
     * та же легенда объясняет и раскраску сплатов, и контуры блоков.
     *
     * @param counts - Количество элементов по уровням; индекс массива — номер уровня.
     * @param visible - Показывать ли легенду (на экране действительно цвета LOD).
     */
    /**
     * Нарисовать номера порядка загрузки в центрах выбранных тайлов.
     *
     * Одним канвасом поверх сцены, а не сотней узлов разметки: тайлов на экране бывают сотни, и
     * держать под каждый элемент с пересчётом положения каждый кадр — расточительство. Текст
     * `DebugLines` не умеет, поэтому проекция и отрисовка живут здесь.
     */
    private updateTileOrderLabels() {
        // Не требуем включённых границ тайлов: номера — самостоятельный режим, и смотреть их
        // поверх чистой сцены обычно удобнее, чем поверх сетки рамок.
        const showIds = !!this.observer.get('debug.tileIdLabels');
        const enabled = !!this.tileManager &&
            (!!this.observer.get('debug.tileOrderLabels') || showIds);

        if (!enabled) {
            if (this.tileOrderCanvas) this.tileOrderCanvas.style.display = 'none';
            return;
        }

        const sceneCanvas = this.app.graphicsDevice.canvas as HTMLCanvasElement;
        // Канвас без раскладки (скрытая вкладка, свёрнутая встройка) рисовать незачем: работа
        // ушла бы в никуда, а `getContext` на нулевом размере ещё и бросает при чтении.
        if (sceneCanvas.clientWidth <= 0 || sceneCanvas.clientHeight <= 0) {
            if (this.tileOrderCanvas) this.tileOrderCanvas.style.display = 'none';
            return;
        }

        if (!this.tileOrderCanvas) {
            const el = document.createElement('canvas');
            el.id = 'tile-order-labels';
            el.style.cssText = 'position:absolute;left:0;top:0;z-index:99;pointer-events:none;';
            (sceneCanvas.parentElement ?? document.body).appendChild(el);
            this.tileOrderCanvas = el;
        }

        const canvas = this.tileOrderCanvas;
        canvas.style.display = 'block';
        const width = sceneCanvas.clientWidth;
        const height = sceneCanvas.clientHeight;
        const dpr = window.devicePixelRatio || 1;
        if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
            canvas.width = Math.round(width * dpr);
            canvas.height = Math.round(height * dpr);
            canvas.style.width = `${width}px`;
            canvas.style.height = `${height}px`;
        }

        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, width, height);

        this.tileManager?.collectOrderLabels(this.tileOrderLabels);
        if (this.tileOrderLabels.length === 0) return;

        // Ближние подписи рисуем последними: при наложении сверху окажется та, что ближе.
        const camera = this.camera.camera;
        // Глубину считаем сами, а не берём `z` у проекции: в перспективе там расстояние по оси
        // взгляда, а в ортогональной — другая величина, и диапазон плоскостей отсечения к ней
        // неприменим. Из-за этого в ортогональном режиме пропадали все подписи разом.
        tileLabelViewInv.copy(this.camera.getWorldTransform()).invert();
        const perLod = !!this.observer.get('debug.tileOrderPerLod');
        const screen: Array<{ x: number, y: number, text: string, depth: number, lod: number }> = [];
        for (const { center, order, lodOrder, name, depth: lod } of this.tileOrderLabels) {
            tileLabelViewInv.transformPoint(center, tileLabelView);
            // Камера смотрит вдоль минус Z, поэтому глубина — это минус координата.
            const depth = -tileLabelView.z;
            if (depth <= camera.nearClip || depth >= camera.farClip) continue;
            const point = camera.worldToScreen(center, tileLabelScreen);
            if (point.x < -40 || point.y < -20 || point.x > width + 40 || point.y > height + 20) continue;
            // Идентификатор перекрывает порядок: это разные вопросы к одной картинке, и
            // показывать оба значения в одном кружке негде.
            const value = showIds ? name : String(perLod ? lodOrder : order);
            screen.push({ x: point.x, y: point.y, text: value, depth, lod });
        }
        screen.sort((a, b) => b.depth - a.depth);

        ctx.font = '600 12px ui-monospace, Menlo, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (const label of screen) {
            const text = label.text;
            const w = ctx.measureText(text).width + 10;
            const h = 16;
            // Подложка в цвете уровня — та же палитра, что у легенды и полоски долей: номер
            // сразу говорит и «когда доехал», и «какого уровня».
            ctx.fillStyle = lodColorCss(label.lod);
            ctx.beginPath();
            ctx.roundRect(label.x - w / 2, label.y - h / 2, w, h, 4);
            ctx.fill();
            // Цвет цифры выбираем по яркости подложки: на жёлтом и голубом белый не читается.
            const [r, g, b] = lodColorRgb(label.lod);
            ctx.fillStyle = (0.299 * r + 0.587 * g + 0.114 * b) > 0.55 ? '#101010' : '#ffffff';
            ctx.fillText(text, label.x, label.y);
        }
    }

    /**
     * Наэкранная шкала перемотки по истории загрузки.
     *
     * Разметка и стили перенесены из `supersplat` (`src/ui/timeline-panel.ts` и
     * `src/ui/scss/timeline-panel.scss`): те же имена классов, те же отступы, тот же способ
     * расстановки. Готовой временной шкалы в pcui нет, и там она тоже написана руками — своё
     * изобретать незачем.
     *
     * Отличие про данные: ромбики отмечают первое появление каждого уровня детализации,
     * контурные кольца — его последнюю загрузку внутри записи. Оба вида вех красятся цветом
     * уровня и не выдают последнюю активность за гарантию полной загрузки LOD.
     *
     * Крайнее правое положение означает «сейчас»: при замороженной камере подкачка стоит, и
     * последняя загрузка — это и есть текущее состояние сцены.
     */
    private updateTileReplayBar() {
        const manager = this.tileManager;
        const duration = manager?.getRecordingDuration() ?? 0;
        const enabled = !!manager && !!this.observer.get('debug.tileFreeze') && duration > 0;
        // Пока шкала внизу, поднимаем над ней круглую панель кнопок — иначе она садится ровно
        // на ряд перемотки и закрывает его.
        document.body.classList.toggle('timeline-open', enabled);
        if (!enabled) {
            this.tileReplayTimeline?.hide();
            return;
        }

        if (!this.tileReplayTimeline) {
            if (this.tileReplayTimelineLoading) return;

            // Важно: import остаётся именно здесь. Rollup вынесет UI, ResizeObserver и все
            // обработчики дорожки в отдельный чанк, которого нет в стартовом запросе.
            const lang = this.observer.get('ui.language') as string | undefined;
            const sceneCanvas = this.app.graphicsDevice.canvas as HTMLCanvasElement;
            const parent = sceneCanvas.parentElement ?? document.body;
            this.tileReplayTimelineLoading = import('./ui/tile-replay-timeline').then(({ TileReplayTimeline }) => {
                if (this.destroyed || !this.observer.get('debug.tileFreeze')) {
                    this.tileReplayTimelineLoading = null;
                    return;
                }
                this.tileReplayTimeline = new TileReplayTimeline(parent, {
                    stepBack: t('Step back', lang),
                    play: t('Play', lang),
                    stepForward: t('Step forward', lang),
                    loop: t('Loop', lang),
                    recordAgain: t('Record again', lang),
                    milestoneTitle: t('LOD {level} first appeared · frame {frame}', lang),
                    lastMilestoneTitle: t('LOD {level} last load in recording · frame {frame}', lang),
                    now: lang === 'ru' ? 'сейчас' : (lang === 'zh' ? '当前' : 'now'),
                    timeUnit: t('Time unit', lang),
                    timecode: t('Timecode', lang),
                    frames: t('Frames', lang),
                    zoom: t('Zoom', lang),
                    orbit: t('Orbit', lang),
                    pan: t('Pan', lang)
                }, {
                    onStep: (delta) => {
                        const total = this.tileManager?.getRecordingDuration() ?? 0;
                        const now = Number(this.observer.get('debug.tileReplay') ?? -1);
                        const base = now < 0 ? total : now;
                        const value = Math.max(0, Math.min(total, base + delta / this.tileReplayFps));
                        this.tileReplayPlaying = false;
                        this.tileReplayCursorValue = value;
                        this.observer.set('debug.tileReplay', value >= total ? -1 : value);
                    },
                    onTogglePlay: () => {
                        this.toggleTileReplayPlayback();
                    },
                    onSpeed: (speed) => {
                        this.tileReplaySpeed = speed;
                    },
                    onUnit: (unit) => {
                        this.tileReplayDisplayUnit = unit;
                        this.tileReplayTimeline?.invalidate();
                        this.renderNextFrame();
                    },
                    onFps: (fps) => {
                        this.tileReplayFps = Math.max(1, Math.min(240, Math.round(fps)));
                        this.tileReplayTimeline?.invalidate();
                        this.renderNextFrame();
                    },
                    onToggleLoop: () => {
                        this.tileReplayLoop = !this.tileReplayLoop;
                        this.renderNextFrame();
                    },
                    onRecordAgain: () => this.observer.set('debug.tileRecording', true),
                    onScrub: (value) => {
                        const total = this.tileManager?.getRecordingDuration() ?? 0;
                        this.observer.set('debug.tileReplay', value >= total ? -1 : value);
                    },
                    onRequestRender: () => this.renderNextFrame()
                });
                this.tileReplayTimelineLoading = null;
                this.renderNextFrame();
            }).catch((error) => {
                this.tileReplayTimelineLoading = null;
                console.error('Failed to load tile replay timeline:', error);
            });
            return;
        }

        const state: TileReplayTimelineState = {
            duration,
            replay: Number(this.observer.get('debug.tileReplay') ?? -1),
            playing: this.tileReplayPlaying,
            loop: this.tileReplayLoop,
            speed: this.tileReplaySpeed,
            displayUnit: this.tileReplayDisplayUnit,
            fps: this.tileReplayFps,
            scheme: this.observer.get('debug.tileDebugMode') === 'resolution' ? 'resolution' : 'lod',
            milestones: manager.getLoadOrderMilestones(),
            surfaceEvents: this.surfaceNavigationEvents.map(event => ({ type: event.type, time: event.time }))
        };
        this.tileReplayTimeline.update(state);
    }

    /**
     * Продвинуть проигрывание истории на один кадр.
     *
     * Отметку держим дробной: скорость задаётся в загрузках за секунду и редко кратна частоте
     * кадров, а от округления на каждом кадре проигрывание шло бы рывками.
     *
     * @param duration - Real recording duration in seconds.
     * @param deltaTime - Время кадра в секундах.
     */
    private advanceTileReplay(duration: number, deltaTime: number) {
        if (duration <= 0) return;
        this.tileReplayCursorValue += this.tileReplaySpeed * (deltaTime || 1 / 60);
        if (this.tileReplayCursorValue >= duration) {
            if (this.tileReplayLoop) {
                this.tileReplayCursorValue = 0;
            } else {
                this.tileReplayCursorValue = duration;
                this.tileReplayPlaying = false;
                this.observer.set('debug.tileReplay', -1);
                return;
            }
        }
        // Дробную отметку передаём целиком: состав тайлов всё равно меняется только на
        // целых номерах, а камера использует долю для интерполяции между ключевыми позами.
        this.observer.set('debug.tileReplay', this.tileReplayCursorValue);
        this.renderNextFrame();
    }

    /**
     * Легенда для раскраски по разрешению: градиент вместо перечня уровней.
     *
     * Величина непрерывная, и перечислять её нечем — вместо квадратов уровней показываем саму
     * шкалу и три подписи: детальнее цели, попадание, грубее цели.
     *
     * @param visible - Показывать ли легенду.
     */
    private renderResolutionLegend(visible: boolean) {
        const legend = this.tileHudLegend;
        if (!legend) return;
        const bar = this.tileHudBar;
        if (!visible) return;

        legend.style.display = 'flex';
        if (bar) bar.style.display = 'flex';
        const key = 'resolution';
        if (key === this.tileHudLegendKey) return;
        this.tileHudLegendKey = key;
        legend.replaceChildren();
        bar?.replaceChildren();

        if (bar) {
            const stops: string[] = [];
            const steps = 24;
            for (let i = 0; i <= steps; i++) {
                // Полоску размечаем по той же логарифмической оси, что и раскраску: слева
                // вчетверо детальнее цели, справа вчетверо грубее.
                const octaves = ((i / steps) * 2 - 1) * RESOLUTION_LOG_RANGE;
                stops.push(`${resolutionColorCss(Math.pow(2, octaves))} ${(i / steps) * 100}%`);
            }
            const strip = document.createElement('div');
            strip.style.cssText = `height:100%;width:100%;background:linear-gradient(90deg,${stops.join(',')});`;
            bar.appendChild(strip);
        }

        // Подписи ставим под теми же долями, что и переломы шкалы: цель приходится ровно на
        // середину, потому что красный набирается к двукратному превышению.
        // Подписи держим короткими: HUD узкий, и длинные переносились на вторую строку.
        // Что синее — детальнее, а красное — грубее, читается по самому градиенту.
        [['1/4', 'flex-start'], ['цель', 'center'], ['x4', 'flex-end']]
        .forEach(([text, align]) => {
            const item = document.createElement('span');
            item.style.cssText = `flex:1;display:flex;justify-content:${align};color:#cfcfcf;`;
            item.textContent = text;
            legend.appendChild(item);
        });
    }

    private renderLodLegend(counts: number[], visible: boolean, colorIndex = (lod: number) => lod) {
        const legend = this.tileHudLegend;
        if (!legend) return;
        const bar = this.tileHudBar;
        if (!visible) {
            if (legend.style.display !== 'none') {
                legend.style.display = 'none';
                legend.replaceChildren();
                if (bar) {
                    bar.style.display = 'none';
                    bar.replaceChildren();
                }
                this.tileHudLegendKey = null;
            }
            return;
        }

        const levels = counts
        .map((count, lod) => ({ lod, colorLod: colorIndex(lod), count: Number(count) || 0 }))
        .filter(entry => entry.count > 0);
        const key = levels.map(entry => `${entry.lod}:${entry.colorLod}:${entry.count}`).join(',');
        legend.style.display = 'flex';
        if (bar) bar.style.display = 'flex';
        // HUD обновляется каждый кадр — пересобираем DOM только при изменении состава.
        if (key === this.tileHudLegendKey) return;
        this.tileHudLegendKey = key;
        legend.replaceChildren();
        bar?.replaceChildren();

        // Доли уровней в той же палитре, что и квадраты легенды: полоска показывает то же
        // самое, только соотношением, а не числами.
        const totalCount = levels.reduce((sum, entry) => sum + entry.count, 0);
        if (bar && totalCount > 0) {
            for (let i = 0; i < levels.length; i++) {
                const { colorLod, count } = levels[i];
                const part = document.createElement('div');
                // Волосяной разделитель между отрезками. В палитре восемь цветов, дальше она
                // идёт по кругу: на глубоком дереве L0 и L8 одного цвета, и без разделителя
                // соседние отрезки слились бы в один. В легенде их различает номер в квадрате,
                // а в полоске номеров нет.
                const divider = i > 0 ? 'box-shadow:inset 1px 0 0 rgba(0,0,0,0.55);' : '';
                part.style.cssText = `height:100%;width:${(count / totalCount) * 100}%;` +
                    `background:${lodColorCss(colorLod)};${divider}`;
                bar.appendChild(part);
            }
        }

        if (levels.length === 0) {
            const empty = document.createElement('span');
            empty.style.cssText = 'color:#b9b9b9;';
            empty.textContent = 'LOD selection pending';
            legend.appendChild(empty);
            return;
        }

        levels.forEach(({ lod, colorLod, count }) => {
            const item = document.createElement('span');
            item.style.cssText = 'display:inline-flex;align-items:center;gap:3px;';

            const swatch = document.createElement('span');
            const color = lodColorCss(colorLod);
            // Подпись внутри квадрата: на жёлтом и голубом белый текст не читается,
            // поэтому цвет цифры выбираем по яркости фона.
            const [r, g, b] = lodColorRgb(colorLod);
            const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
            swatch.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;' +
                'width:15px;height:15px;border-radius:3px;font-size:10px;line-height:1;font-weight:700;' +
                `background:${color};color:${luminance > 0.55 ? '#101010' : '#ffffff'};` +
                'box-shadow:inset 0 0 0 1px rgba(255,255,255,0.35);';
            swatch.textContent = String(lod);

            const label = document.createElement('span');
            label.style.cssText = 'color:#cfcfcf;';
            label.textContent = String(count);

            item.appendChild(swatch);
            item.appendChild(label);
            legend.appendChild(item);
        });
    }

    /**
     * Читает живое состояние GSplatWorld без мутаций и при необходимости рисует OBB leaf-узлов.
     * Внутренние поля используются только в одном адаптере: UI и остальной viewer от структуры
     * PlayCanvas не зависят.
     *
     * @param drawBounds - Рисовать OBB узлов вместе со сбором статистики.
     * @returns Сводный снимок spatial LOD для HUD.
     */
    private updateGSplatDebugBounds(drawBounds: boolean): GSplatDebugStats {
        const stats: GSplatDebugStats = {
            nodes: 0,
            visibleNodes: 0,
            transitioningNodes: 0,
            pendingFiles: 0,
            queuedFiles: 0,
            runningFiles: 0,
            loadedFiles: 0,
            activeSplats: 0,
            budget: Number(this.app.scene.gsplat.splatBudget ?? 0),
            awaitingLodUpdate: false,
            lodCounts: [],
            maxLod: 0
        };
        const managers = this.getGSplatManagers();

        // Стиль каркаса общий с тайлами: настройка одна, и обе отладки выглядят одинаково.
        const boundsStyle = {
            lineThickness: Number(this.observer.get('debug.tileLineThickness') ?? 1),
            checker: this.observer.get('debug.tileLineStyle') !== 'solid'
        };
        const cameraPos = this.camera.getPosition();
        const stateColors = {
            optimal: 0xff52d273,
            coarser: 0xffbfd42d,
            finer: 0xffc084fc,
            loading: 0xff00bfff,
            missing: 0xff888888
        };

        for (const manager of managers) {
            const world = manager.world;
            stats.pendingFiles += Number(world?.pendingLoadCount ?? 0);
            stats.activeSplats += Number(world?.currentState?.totalActiveSplats ?? 0);
            stats.awaitingLodUpdate ||= !!world?.awaitingLodUpdate;
            const instances = [...(world?._octreeInstances?.values?.() ?? [])];
            const worldMaxLod = instances.reduce(
                (max: number, inst: any) => Math.max(max, Number(inst.octree?.lodLevels ?? 1) - 1),
                0
            );
            stats.maxLod = Math.max(stats.maxLod, worldMaxLod);
            for (const inst of instances) {
                stats.loadedFiles += Number(inst.octree?.fileResources?.size ?? 0);
                stats.queuedFiles += Number(inst.octree?.assetLoader?._loadQueue?.length ?? 0);
                stats.runningFiles += Number(inst.octree?.assetLoader?._currentlyLoading?.size ?? 0);
                const bounds = inst.octree?.nodeBoundsMinMax as Float32Array | undefined;
                const infos = inst.nodeInfos as Array<{ currentLod: number; optimalLod: number }> | undefined;
                const worldMat = inst.placement?.node?.getWorldTransform?.() as Mat4 | undefined;
                if (!bounds || !infos || !worldMat) continue;
                stats.nodes += infos.length;
                for (let i = 0; i < infos.length; i++) {
                    const info = infos[i];
                    const current = Number(info.currentLod);
                    const optimal = Number(info.optimalLod);
                    const transitioning = current !== optimal || current < 0;
                    if (current >= 0) {
                        stats.visibleNodes++;
                        stats.lodCounts[current] = (stats.lodCounts[current] ?? 0) + 1;
                    }
                    if (transitioning) stats.transitioningNodes++;
                    if (!drawBounds) continue;

                    const b = i * 6;
                    const center = new Vec3(
                        (bounds[b] + bounds[b + 3]) * 0.5,
                        (bounds[b + 1] + bounds[b + 4]) * 0.5,
                        (bounds[b + 2] + bounds[b + 5]) * 0.5
                    );
                    const half = new Vec3(
                        (bounds[b + 3] - bounds[b]) * 0.5,
                        (bounds[b + 4] - bounds[b + 1]) * 0.5,
                        (bounds[b + 5] - bounds[b + 2]) * 0.5
                    );
                    const worldCenter = worldMat.transformPoint(center, new Vec3());
                    const ax = worldMat.transformVector(new Vec3(half.x, 0, 0), new Vec3());
                    const ay = worldMat.transformVector(new Vec3(0, half.y, 0), new Vec3());
                    const az = worldMat.transformVector(new Vec3(0, 0, half.z), new Vec3());
                    const mode = this.observer.get('debug.gsplatDebugMode') ?? 'lod';
                    let color = lodColorAbgr(worldMaxLod - current);
                    if (mode === 'state') {
                        const pending = inst.pendingVisibleAdds?.has?.(i) ||
                            (current >= 0 && inst.pendingDecrements?.has?.(i));
                        color = current < 0 ? (pending ? stateColors.loading : stateColors.missing) :
                            (current === optimal ? stateColors.optimal :
                                (current > optimal ? stateColors.coarser : stateColors.finer));
                    } else if (current < 0) {
                        color = stateColors.missing;
                    }
                    // Тот же каркас, что у полигональных тайлов: толстые рёбра, шахматное
                    // чередование яркости у соседей и та же настройка толщины. Раньше здесь
                    // была тонкая линия без стиля, и две одинаковые по смыслу отладки
                    // выглядели по-разному.
                    const parity = (
                        Math.round(gridIndex(worldCenter, ax)) +
                        Math.round(gridIndex(worldCenter, ay)) +
                        Math.round(gridIndex(worldCenter, az))
                    ) & 1;
                    const edge = (!boundsStyle.checker || parity) ? color : dimColor(color, 0.55);
                    const width = Math.min(8, Math.max(0.5, boundsStyle.lineThickness)) * EDGE_WIDTH_UNIT;
                    this.debugTilesSolid.obbEdgesThick(worldCenter, ax, ay, az, cameraPos, width, edge);
                }
            }
        }
        return stats;
    }

    /**
     * Разворачивает только диагностическую палитру GSplat, не меняя raw LOD и его выбор.
     *
     * У PlayCanvas L0 самый подробный, у 3D Tiles depth 0 самый грубый. Поэтому штатный
     * массив цветов движка нужно читать с конца конкретного spatial-набора: Lmax становится
     * красным, следующий зелёным и так далее. `getDebugColors` пока не имеет публичной
     * настройки палитры, поэтому вся зависимость от внутреннего API изолирована здесь — так же,
     * как чтение `nodeInfos` для диагностического HUD ниже.
     */
    private syncGSplatLodDebugPalette() {
        for (const manager of this.getGSplatManagers()) {
            const world = manager.world;
            if (!world || this.gsplatWorldDebugColorGetters.has(world) ||
                typeof world.getDebugColors !== 'function') continue;

            const original = world.getDebugColors as () => number[][] | undefined;
            this.gsplatWorldDebugColorGetters.set(world, original);
            world.getDebugColors = () => {
                if (!this.observer.get('debug.gsplatLodColor')) return original.call(world);

                let maxLod = 0;
                for (const inst of world?._octreeInstances?.values?.() ?? []) {
                    maxLod = Math.max(maxLod, Number(inst.octree?.lodLevels ?? 1) - 1);
                }
                let colors = this.gsplatDebugColorsByMaxLod.get(maxLod);
                if (!colors) {
                    colors = Array.from({ length: maxLod + 1 }, (_unused, lod) => lodColorRgb(maxLod - lod));
                    this.gsplatDebugColorsByMaxLod.set(maxLod, colors);
                }
                return colors;
            };
        }
    }

    /**
     * Делает `splatBudget` верхним пределом, а не целью заполнения.
     *
     * Штатный GSplatWorld масштабирует дистанции в обе стороны и при недоборе бюджета принудительно
     * повышает LOD ближайших узлов. Здесь сначала всегда рассчитывается естественный LOD при scale=1.
     * Балансировщик вызывается только при превышении: в этой ветке он идёт от дальних bucket-ов и
     * последовательно выбирает более грубые уровни. Padding строк GPU-текстур учитывается так же,
     * как в движке, поэтому ограничение сохраняет исходную защиту видеопамяти.
     */
    private syncGSplatBudgetCeilings() {
        for (const manager of this.getGSplatManagers()) {
            const world = manager.world;
            if (!world || this.gsplatWorldBudgetEnforcers.has(world) ||
                typeof world._enforceBudget !== 'function') continue;

            const original = world._enforceBudget as GSplatBudgetEnforcer;
            this.gsplatWorldBudgetEnforcers.set(world, original);
            world._enforceBudget = (budget: number, camera: any) => {
                const textureWidth = Math.max(1, Number(world._workBuffer?.textureSize) || 1);
                let fixedSplats = 0;
                let paddingEstimate = 0;

                for (const placement of world._layerPlacements ?? []) {
                    const numSplats = Number(placement.resource?.numSplats ?? 0);
                    fixedSplats += numSplats;
                    paddingEstimate += (textureWidth - numSplats % textureWidth) % textureWidth;
                }

                const octreeBudget = Math.max(1, budget - fixedSplats);
                const globalMaxDistance = world.computeGlobalMaxDistance(camera);
                let naturalSplats = 0;

                for (const inst of world._octreeInstances?.values?.() ?? []) {
                    naturalSplats += inst.evaluateOptimalLods(camera, world._scene.gsplat, 1, globalMaxDistance);
                    for (const placement of inst.activePlacements ?? []) {
                        const numSplats = Number(placement.resource?.numSplats ?? 0);
                        paddingEstimate += (textureWidth - numSplats % textureWidth) % textureWidth;
                    }
                }

                const adjustedBudget = Math.max(1, octreeBudget - paddingEstimate);
                world._budgetScale = 1;
                if (naturalSplats > adjustedBudget) {
                    world._budgetBalancer.balance(world._octreeInstances, adjustedBudget);
                }

                for (const inst of world._octreeInstances?.values?.() ?? []) {
                    inst.applyLodChanges(inst.octree.lodLevels - 1, world._scene.gsplat);
                }
            };
        }
    }

    /** @returns Активные GSplat-менеджеры основной камеры без дубликатов слоёв. */
    private getGSplatManagers(): Set<any> {
        const renderer = this.app.renderer as unknown as {
            gsplatDirector?: {
                camerasMap?: Map<unknown, { layersMap?: Map<unknown, { gsplatManager?: any }> }>;
            };
        };
        const managers = new Set<any>();
        for (const cameraData of renderer.gsplatDirector?.camerasMap?.values?.() ?? []) {
            for (const layerData of cameraData.layersMap?.values?.() ?? []) {
                if (layerData.gsplatManager) managers.add(layerData.gsplatManager);
            }
        }
        return managers;
    }

    /** Сохраняет текущую render-камеру как неизменяемый источник расчёта LOD. */
    private captureGSplatLodCamera() {
        const manager = this.getGSplatManagers().values().next().value;
        const node = manager?.cameraNode;
        const camera = node?.camera;
        if (!node || !camera) return;
        const position = node.getPosition().clone();
        this.gsplatFrozenLodCamera = {
            position,
            forward: node.forward.clone(),
            camera: {
                fov: camera.fov,
                horizontalFov: camera.horizontalFov,
                aspectRatio: camera.aspectRatio
            },
            getPosition: () => position
        };
        this.syncGSplatStreamingDebugControls();
    }

    /**
     * Применяет freeze/pause к уже созданным и появившимся позже GSplatWorld/asset loaders.
     * Уже идущие загрузки на паузе не отменяются; очередь возобновляется штатным обработчиком.
     */
    private syncGSplatStreamingDebugControls() {
        const frozenCamera = this.observer.get('debug.gsplatFreeze') ? this.gsplatFrozenLodCamera : null;
        const paused = !!this.observer.get('debug.gsplatPaused');
        for (const manager of this.getGSplatManagers()) {
            const world = manager.world;
            const originalUpdate = this.gsplatWorldUpdates.get(world);
            if (frozenCamera && !originalUpdate) {
                const original = world.update.bind(world);
                this.gsplatWorldUpdates.set(world, original);
                world.update = (camera: unknown, ...args: unknown[]) => original(this.gsplatFrozenLodCamera ?? camera, ...args);
            } else if (!frozenCamera && originalUpdate) {
                world.update = originalUpdate;
                this.gsplatWorldUpdates.delete(world);
            }

            for (const inst of world?._octreeInstances?.values?.() ?? []) {
                const loader = inst.octree?.assetLoader;
                if (!loader) continue;
                if (paused) {
                    if (!this.gsplatLoaderConcurrency.has(loader)) {
                        this.gsplatLoaderConcurrency.set(loader, Number(loader.maxConcurrentLoads ?? 2));
                    }
                    loader.maxConcurrentLoads = 0;
                } else {
                    const concurrency = this.gsplatLoaderConcurrency.get(loader);
                    if (concurrency !== undefined) {
                        loader.maxConcurrentLoads = concurrency;
                        this.gsplatLoaderConcurrency.delete(loader);
                        loader._processQueue?.();
                    }
                }
            }
        }
    }

    private drawReferenceRuler() {
        this.debugRuler.clear();

        const enabled = !!this.observer.get('measure.referenceRuler');
        if (!enabled || !this.sceneBounds) {
            this.debugRuler.update();
            return;
        }

        const unitScale = Number(this.observer.get('measure.unitScale') ?? 1);
        const safeUnitScale = Number.isFinite(unitScale) && unitScale > 0 ? unitScale : 1;

        const humanHeightMeters = 1.75;
        const sceneHeight = humanHeightMeters / safeUnitScale;

        const rulerBounds = this.selectedNode ? bbox : this.dynamicSceneBounds;
        if (this.selectedNode) {
            this.calcSceneBounds(rulerBounds, this.selectedNode as Entity);
        }

        const center = rulerBounds.center.clone();
        const min = rulerBounds.getMin();
        const objectRadius = Math.max(rulerBounds.halfExtents.length(), sceneHeight * 0.5);
        const cameraRight = this.camera.right.clone().normalize();
        const cameraUp = this.camera.up.clone().normalize();
        const anchor = center.clone().add(cameraRight.mulScalar(-objectRadius));
        anchor.y = min.y;

        const width = sceneHeight * 0.28;
        const shoulderWidth = width * 0.9;
        const hipWidth = width * 0.55;
        const headRadius = sceneHeight * 0.085;
        const neckY = sceneHeight * 0.86;
        const shoulderY = sceneHeight * 0.78;
        const hipY = sceneHeight * 0.45;
        const handY = sceneHeight * 0.48;
        const kneeY = sceneHeight * 0.22;

        const pointAt = (horizontal: number, vertical: number) => anchor.clone()
        .add(cameraRight.clone().mulScalar(horizontal))
        .add(cameraUp.clone().mulScalar(vertical));

        const v0 = this.tmpRulerV0;
        const v1 = this.tmpRulerV1;

        // torso
        v0.copy(pointAt(0, neckY));
        v1.copy(pointAt(0, hipY));
        this.debugRuler.line(v0, v1, 0xffffffff);

        // shoulders and arms
        v0.copy(pointAt(-shoulderWidth * 0.5, shoulderY));
        v1.copy(pointAt(shoulderWidth * 0.5, shoulderY));
        this.debugRuler.line(v0, v1, 0xffffffff);
        this.debugRuler.line(pointAt(-shoulderWidth * 0.5, shoulderY), pointAt(-width * 0.72, handY), 0xffffffff);
        this.debugRuler.line(pointAt(shoulderWidth * 0.5, shoulderY), pointAt(width * 0.72, handY), 0xffffffff);

        // hips and legs
        v0.copy(pointAt(-hipWidth * 0.5, hipY));
        v1.copy(pointAt(hipWidth * 0.5, hipY));
        this.debugRuler.line(v0, v1, 0xffffffff);
        this.debugRuler.line(pointAt(-hipWidth * 0.25, hipY), pointAt(-width * 0.28, kneeY), 0xffffffff);
        this.debugRuler.line(pointAt(-width * 0.28, kneeY), pointAt(-width * 0.16, 0), 0xffffffff);
        this.debugRuler.line(pointAt(hipWidth * 0.25, hipY), pointAt(width * 0.28, kneeY), 0xffffffff);
        this.debugRuler.line(pointAt(width * 0.28, kneeY), pointAt(width * 0.16, 0), 0xffffffff);

        // head circle approximation
        const headCenter = pointAt(0, sceneHeight - headRadius * 1.15);
        const segments = 20;
        for (let i = 0; i < segments; i++) {
            const a0 = (Math.PI * 2 * i) / segments;
            const a1 = (Math.PI * 2 * (i + 1)) / segments;
            v0.copy(headCenter)
            .add(cameraRight.clone().mulScalar(Math.cos(a0) * headRadius))
            .add(cameraUp.clone().mulScalar(Math.sin(a0) * headRadius));
            v1.copy(headCenter)
            .add(cameraRight.clone().mulScalar(Math.cos(a1) * headRadius))
            .add(cameraUp.clone().mulScalar(Math.sin(a1) * headRadius));
            this.debugRuler.line(v0, v1, 0xffffffff);
        }

        this.debugRuler.update();
    }

    /**
     * Сообщить хосту, что вьюер поднялся и принимает команды.
     *
     * Зовётся из двух мест: с первого отрисованного кадра (честный путь) и по таймеру,
     * если кадра не случилось. Идемпотентен — хост получит ровно одно сообщение.
     */
    private announceViewerReady() {
        if (this.viewerReadyTimer) {
            clearTimeout(this.viewerReadyTimer);
            this.viewerReadyTimer = null;
        }
        if (this.viewerReadySent) {
            return;
        }
        this.viewerReadySent = true;
        postToViewerParent({ type: 'viewer-ready' });
    }

    private onPostrender() {
        const perfStart = this.perfEnabled ? performance.now() : 0;
        if (this.firstFrame) {
            this.firstFrame = false;

            // reinit scene bounds after first render in order to get accurate morph target and skinned bounds
            this.initSceneBounds();

            // Модель РЕАЛЬНО отрисована на этом кадре → только теперь гасим индикатор
            // загрузки (прогресс-бар держался до появления модели, без паузы «пусто»).
            if (this.loadCreepTimer) {
                clearInterval(this.loadCreepTimer); this.loadCreepTimer = null;
            }
            this.observer.set('ui.loadProgress', 100);
            this.observer.set('ui.spinner', false);
            this.observer.set('ui.loadingBackgroundReady', false);

            // Сообщаем хосту, что вьюер инициализирован и принимает команды
            // (helper/microphone/poi). До этого вьюер НЕ слал родителю ни одного
            // сообщения, поэтому встройка не знала о готовности и не отправляла,
            // например, микрофоны пространственной записи на пассивной странице.
            this.announceViewerReady();
        }

        // resolve the (possibly multisampled) render target
        const rt = this.getRenderingCamera().renderTarget;
        if (rt && rt.samples > 1) {
            rt.resolve();
        }

        // perform multiframe update. returned flag indicates whether more frames
        // are needed.
        this.multiframeBusy = this.multiframe.update();

        if (this.perfEnabled) {
            this.perfOnPostrenderTotalMs += performance.now() - perfStart;
        }
    }

    private onFrameend() {
        if (this.perfEnabled) {
            const now = performance.now();
            if (this.perfWindowStartMs === 0) {
                this.perfWindowStartMs = now;
            }

            const elapsed = now - this.perfWindowStartMs;
            if (elapsed >= this.perfWindowDurationMs && this.perfFrames > 0) {
                const seconds = elapsed / 1000;
                const fps = this.perfFrames / seconds;
                const sorted = [...this.perfFrameDeltasMs].sort((a, b) => a - b);
                const p95 = sorted.length > 0 ? sorted[Math.max(0, Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95)))] : 0;
                const avgFrameRender = this.perfOnFrameRenderTotalMs / this.perfFrames;
                const avgPrerender = this.perfOnPrerenderTotalMs / this.perfFrames;
                const avgPostrender = this.perfOnPostrenderTotalMs / this.perfFrames;
                console.log(
                    `[perf] ${seconds.toFixed(1)}s | fps=${fps.toFixed(1)} | p95=${p95.toFixed(2)}ms | frame=${avgFrameRender.toFixed(2)}ms | pre=${avgPrerender.toFixed(2)}ms | post=${avgPostrender.toFixed(2)}ms | meshes=${this.meshInstances.length}`
                );

                this.perfWindowStartMs = now;
                this.perfFrames = 0;
                this.perfFrameDeltasMs.length = 0;
                this.perfOnFrameRenderTotalMs = 0;
                this.perfOnPrerenderTotalMs = 0;
                this.perfOnPostrenderTotalMs = 0;
            }
        }

        if (this.loadTimestamp !== null) {
            this.observer.set('scene.loadTime', `${Date.now() - this.loadTimestamp}ms`);
            this.loadTimestamp = null;
        }

        if (this.multiframeBusy) {
            this.app.renderNextFrame = true;
        }
    }
}

export default Viewer;
