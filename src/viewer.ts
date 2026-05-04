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
    FILTER_NEAREST,
    KEY_CONTROL,
    KEY_F,
    KEY_R,
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
    GSplatComponent,
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
    MiniStats,
    Quat,
    RotateGizmo,
    RenderComponent,
    RenderTarget,
    SEMANTIC_POSITION,
    SEMANTIC_TEXCOORD0,
    ShaderMaterial,
    StandardMaterial,
    Texture,
    TouchDevice,
    TranslateGizmo,
    Vec3,
    Vec2,
    CameraComponent,
    PostEffect
} from 'playcanvas';

import { App } from './app';
import { CameraControls } from './camera-controls';
import { DebugLines } from './debug-lines';
import { CreateDropBlocker, CreateDropHandler } from './drop-handler';
import { t } from './i18n/translations';
import { Multiframe } from './multiframe';
import { Picker } from './picker';
import { PngExporter } from './png-exporter';
import { ShadowCatcher } from './shadow-catcher';
import arCloseImage from './svg/ar-close.svg';
import arModeImage from './svg/ar-mode.svg';
import { File, HierarchyNode, MorphTargetData, ObserverData, SceneCamera } from './types';
import { MeasurementController, PoiController, SelectionController } from './viewer/controllers';
import { CachedMeshGeometry, getCachedMeshGeometry } from './viewer/controllers/mesh-raycast';
import { SettingsService } from './viewer/settings-service';
import { createLut1DTextureFromCubeData, createLutTextureFromCubeData } from './viewer/lut/createLutTexture';
import { decodeLutFileBuffer, lutBufferLooksBinaryAfterUtf8Decode } from './viewer/lut/decodeLutFile';
import { tryParseBinaryCubeLut } from './viewer/lut/parseBinaryCubeLut';
import { MAX_LUT_FILE_BYTES, parseCubeLut, type ParseCubeLutResult } from './viewer/lut/parseCubeLut';
import { BloomEffect } from './viewer/posteffects/BloomEffect';
import { BrightnessContrastEffect } from './viewer/posteffects/BrightnessContrastEffect';
import { FXAAEffect } from './viewer/posteffects/FXAAEffect';
import { HueSaturationEffect } from './viewer/posteffects/HueSaturationEffect';
import { LutEffect } from './viewer/posteffects/LutEffect';
import { SSAOEffect } from './viewer/posteffects/SSAOEffect';
import { XRObjectPlacementController } from './xr-mode';
import { MeshoptDecoder } from '../lib/meshopt_decoder.module.js';

// model filename extensions
const modelExtensions = ['gltf', 'glb', 'vox'];
const defaultSceneBounds = new BoundingBox(new Vec3(0, 1, 0), new Vec3(1, 1, 1));
const UV_SEMANTICS = ['TEXCOORD0', 'TEXCOORD1', 'TEXCOORD2', 'TEXCOORD3', 'TEXCOORD4', 'TEXCOORD5', 'TEXCOORD6', 'TEXCOORD7'] as const;

const vec = new Vec3();
const bbox = new BoundingBox();

const FOCUS_FOV = 75;
const ZOOM_SCALE_MIN = 0.01;

const doubleTapDelay = 400;
const doubleTapRadius = 45;
const RIPPLE_CAMERA_DELAY_MS = 380;
const RIPPLE_REMOVE_MS = 900;
type ViewerTaggedMeshInstance = MeshInstance & { __viewerIsGsplat?: boolean };
type TextureAssetFile = { filename?: string };
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
type AssetFileLike = {
    filename?: string;
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

const overlayVertexGLSL = /* glsl */ `
attribute vec3 vertex_position;
uniform mat4 matrix_model;
uniform mat4 matrix_viewProjection;
void main(void) {
    gl_Position = matrix_viewProjection * matrix_model * vec4(vertex_position, 1.0);
}
`;

const overlayFragmentGLSL = /* glsl */ `
precision highp float;
uniform vec4 uColor;
void main(void) {
    gl_FragColor = uColor;
}
`;

const overlayVertexWGSL = /* wgsl */ `
attribute vertex_position: vec3f;
uniform matrix_model: mat4x4f;
uniform matrix_viewProjection: mat4x4f;
@vertex
fn vertexMain(input: VertexInput) -> VertexOutput {
    var output: VertexOutput;
    output.position = uniform.matrix_viewProjection * uniform.matrix_model * vec4(input.vertex_position, 1.0);
    return output;
}
`;

const overlayFragmentWGSL = /* wgsl */ `
uniform uColor: vec4f;
@fragment
fn fragmentMain(input: FragmentInput) -> FragmentOutput {
    var output: FragmentOutput;
    output.color = uColor;
    return output;
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

class Viewer {
    private static readonly MODEL_FILE_SIZE_LIMIT_BYTES = 1024 * 1024 * 1024; // 1 GB

    private static readonly SETTINGS_FILE_SIZE_LIMIT_BYTES = 10 * 1024 * 1024; // 10 MB

    private static readonly SKYBOX_FILE_SIZE_LIMIT_BYTES = 50 * 1024 * 1024; // 50 MB

    private static readonly REMOTE_HEAD_TIMEOUT_MS = 5000;

    canvas: HTMLCanvasElement;

    app: App;

    skyboxUrls: Map<string, string>;

    controlEventKeys: string[] = null;

    pngExporter: PngExporter = null;

    prevCameraMat: Mat4;

    camera: Entity;

    initialCameraPosition: Vec3 | null;

    initialCameraFocus: Vec3 | null;

    light: Entity;

    sceneRoot: Entity;

    sceneContentRoot: Entity;

    sceneTransform: { position: [number, number, number]; rotation: [number, number, number]; scale: [number, number, number]; pivotOffset: [number, number, number] };

    rotateGizmo: RotateGizmo | null;

    translateGizmo: TranslateGizmo | null;

    lastAlignmentContentTransform: Mat4 | null;

    debugRoot: Entity;

    entities: Array<Entity>;

    entityAssets: Array<{ entity: Entity; asset: Asset }>;

    assets: Array<Asset>;

    meshInstances: Array<MeshInstance>;

    wireframeMeshInstances: Array<MeshInstance>;

    wireframeMaterial: StandardMaterial;

    selectionHighlightMeshInstances: Array<MeshInstance>;

    selectionHighlightMaterial: ShaderMaterial;

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

    dirtyNormals: boolean;

    sceneBounds: BoundingBox;

    dynamicSceneBounds: BoundingBox;

    debugBounds: DebugLines;

    debugSkeleton: DebugLines;

    debugGrid: DebugLines;

    debugNormals: DebugLines;

    debugMeasure: DebugLines;

    debugRuler: DebugLines;

    miniStats: MiniStats;

    observer: Observer;

    measurementController: MeasurementController;

    poiController: PoiController;

    selectionController: SelectionController;

    settingsService: SettingsService;

    suppressAnimationProgressUpdate: boolean;

    selectedNode: GraphNode | null;

    multiframe: Multiframe | null;

    multiframeBusy = false;

    private postEffectsBloom!: BloomEffect;

    private postEffectsSsao!: SSAOEffect;


    private postEffectsBrightnessContrast!: BrightnessContrastEffect;

    private postEffectsHueSaturation!: HueSaturationEffect;

    private postEffectsFxaa!: FXAAEffect;

    private lutEffect!: LutEffect;

    private lutTextureResource: Texture | null = null;

    private isCapturingCoverImage = false;

    picker: Picker = null;

    cursorWorld = new Vec3();

    private tmpBoundsSize = new Vec3();

    private tmpGridV0 = new Vec3();

    private tmpGridV1 = new Vec3();

    private tmpRulerV0 = new Vec3();

    private tmpRulerV1 = new Vec3();

    rippleContainer: HTMLDivElement | null = null;

    captureFlashEl: HTMLDivElement | null = null;

    lastTapTime = 0;

    lastTapX = 0;

    lastTapY = 0;

    loadTimestamp?: number = null;

    shadowCatcher: ShadowCatcher = null;

    xrMode: XRObjectPlacementController;

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
        const origMouseHandler = app.mouse._moveHandler;
        app.mouse.detach();
        app.mouse._moveHandler = (event: MouseEvent) => {
            if (event.target === canvas) {
                origMouseHandler(event);
            }
        };
        app.mouse.attach(canvas);

        const origTouchHandler = app.touch._moveHandler;
        app.touch.detach();
        app.touch._moveHandler = (event: MouseEvent) => {
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

        // observe canvas size changes
        new ResizeObserver(() => {
            if (this.xrMode && !this.xrMode.active) {
                this.canvasResize = true;
                this.renderNextFrame();
            }
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
        this.cameraControls = new CameraControls(app, camera.camera, observer);
        this.cameraControls.zoomRange = new Vec2(ZOOM_SCALE_MIN, Infinity);

        camera.camera.requestSceneColorMap(true);

        app.keyboard.on(EVENT_KEYDOWN, (event) => {
            const el = document.activeElement as HTMLElement | null;
            if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) {
                return;
            }
            switch (event.key) {
                case KEY_F: {
                    this.focus(false);
                    break;
                }
                case KEY_R: {
                    this.resetCamera();
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
        this.debugRoot = debugRoot;
        this.entities = [];
        this.entityAssets = [];
        this.assets = [];
        this.meshInstances = [];
        this.wireframeMeshInstances = [];
        this.selectionHighlightMeshInstances = [];
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

        const overlayShaderArgs = {
            uniqueName: 'selection-overlay',
            attributes: {
                vertex_position: SEMANTIC_POSITION
            },
            vertexGLSL: overlayVertexGLSL,
            fragmentGLSL: overlayFragmentGLSL,
            vertexWGSL: overlayVertexWGSL,
            fragmentWGSL: overlayFragmentWGSL
        };

        const selectionMat = new ShaderMaterial(overlayShaderArgs);
        selectionMat.setParameter('uColor', [0.224, 1.0, 0.078, 1.0]);
        selectionMat.blendType = BLEND_NORMAL;
        selectionMat.depthState.write = false;
        selectionMat.depthBias = -2.0;
        selectionMat.slopeDepthBias = 2.0;
        selectionMat.update();
        this.selectionHighlightMaterial = selectionMat;

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
        this.dirtyNormals = false;

        this.sceneBounds = new BoundingBox();
        this.dynamicSceneBounds = new BoundingBox();

        this.debugBounds = new DebugLines(app, camera);
        this.debugSkeleton = new DebugLines(app, camera);
        this.debugGrid = new DebugLines(app, camera, false);
        this.debugNormals = new DebugLines(app, camera, false);
        this.debugMeasure = new DebugLines(app, camera, false);
        this.debugRuler = new DebugLines(app, camera, false);

        // construct ministats, default off
        this.miniStats = new MiniStats(app);
        this.miniStats.enabled = observer.get('debug.stats');

        this.observer = observer;

        const gd = app.graphicsDevice;
        this.postEffectsBloom = new BloomEffect(gd);
        this.postEffectsSsao = new SSAOEffect(gd);
        this.postEffectsBrightnessContrast = new BrightnessContrastEffect(gd);
        this.postEffectsHueSaturation = new HueSaturationEffect(gd);
        this.postEffectsFxaa = new FXAAEffect(gd);
        this.lutEffect = new LutEffect(gd);
        this.installPostEffectsObserverBindings();

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
            this.lastAlignmentContentTransform = this.captureSceneContentTransform();
        });
        this.rotateGizmo.on('transform:move', () => {
            this.applyPoiTransformFromLastAlignmentState();
            const eulers = this.sceneRoot.getLocalEulerAngles();
            this.sceneTransform = {
                ...this.sceneTransform,
                rotation: [eulers.x, eulers.y, eulers.z]
            };
            this.renderNextFrame();
        });
        this.rotateGizmo.on('transform:end', () => {
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
            this.lastAlignmentContentTransform = this.captureSceneContentTransform();
        });
        this.translateGizmo.on('transform:move', () => {
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

        const device = this.app.graphicsDevice;

        // render frame after device restored
        device.on('devicerestored', () => {
            this.renderNextFrame();
        });

        // multiframe
        this.multiframe = new Multiframe(device, this.camera.camera);

        // dynamic shadow catcher
        this.shadowCatcher = new ShadowCatcher(app, this.camera.camera, this.debugRoot, this.sceneRoot);

        // xr support
        this.initXrMode();

        // initialize control events
        this.bindControlEvents();

        // load initial settings
        this.reloadSettings();

        // construct the depth reader
        this.picker = new Picker(app, camera);
        this.cursorWorld = new Vec3();
        this.measurementController = new MeasurementController({
            canvas: this.canvas,
            observer: this.observer,
            picker: this.picker,
            getMeshInstances: () => this.meshInstances,
            getPickRay: this.getPickRay.bind(this),
            renderNextFrame: this.renderNextFrame.bind(this)
        });
        this.poiController = new PoiController({
            canvas: this.canvas,
            observer: this.observer,
            picker: this.picker,
            getMeshInstances: () => this.meshInstances,
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
            applyCameraView: (view, duration) => this.flyToCameraView(view, duration),
            renderNextFrame: this.renderNextFrame.bind(this)
        });
        this.selectionController = new SelectionController({
            canvas: this.canvas,
            observer: this.observer,
            picker: this.picker,
            selectionHighlightMaterial: this.selectionHighlightMaterial,
            getMeshInstances: () => this.meshInstances,
            getCameraPosition: () => this.camera.getPosition(),
            getPickRay: this.getPickRay.bind(this),
            getSelectedNode: () => this.selectedNode,
            setSelectedNodePath: (path: string) => this.setSelectedNode(path),
            resetSelectionHighlightMeshes: this.resetSelectionHighlightMeshes.bind(this),
            renderNextFrame: this.renderNextFrame.bind(this)
        });

        // ripple container over canvas (pointer-events: none)
        const wrapper = this.canvas.parentElement;
        if (wrapper) {
            this.rippleContainer = document.createElement('div');
            this.rippleContainer.className = 'ripple-container';
            wrapper.appendChild(this.rippleContainer);
            this.captureFlashEl = document.createElement('div');
            this.captureFlashEl.className = 'capture-flash';
            this.captureFlashEl.addEventListener('animationend', () => {
                this.captureFlashEl?.classList.remove('active');
            });
            wrapper.appendChild(this.captureFlashEl);
        }

        // double click: pick → ripple → after 380ms center camera
        canvas.addEventListener('dblclick', (event: MouseEvent) => {
            if (this.observer.get('measure.enabled')) return;
            this._pickAndCenterAt(event.offsetX, event.offsetY);
        });

        // double tap (mobile): same as dblclick when second tap within delay and radius
        canvas.addEventListener('touchend', (event: TouchEvent) => {
            if (this.observer.get('measure.enabled')) return;
            if (event.changedTouches.length !== 1) return;
            const touch = event.changedTouches[0];
            const rect = canvas.getBoundingClientRect();
            const x = touch.clientX - rect.left;
            const y = touch.clientY - rect.top;
            const now = Date.now();
            if (now - this.lastTapTime < doubleTapDelay &&
                Math.hypot(x - this.lastTapX, y - this.lastTapY) <= doubleTapRadius) {
                this._pickAndCenterAt(x, y);
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

    private initXrMode() {
        const xr = this.app.xr;

        this.xrMode = new XRObjectPlacementController({
            xr: xr,
            camera: this.camera,
            content: this.sceneRoot,
            showUI: false,
            startArImgSrc: arModeImage.src,
            stopArImgSrc: arCloseImage.src,
            getContentScale: () => {
                const unitScale = Number(this.observer.get('measure.unitScale') ?? 1);
                return Number.isFinite(unitScale) && unitScale > 0 ? unitScale : 1;
            }
        });

        const events = this.xrMode.events;

        // Reflect runtime AR capability/state for UI visibility logic.
        this.observer.set('runtime.xrSupported', this.xrMode.available);
        this.observer.set('runtime.xrActive', false);

        events.on('xr:available', (available: boolean) => {
            this.observer.set('runtime.xrSupported', available);
        });

        events.on('xr:started', () => {
            this.observer.set('runtime.xrActive', true);

            // prepare scene settings for AR mode
            this.setShadowCatcherEnabled(true);
            this.setShadowCatcherIntensity(0.4);
            this.setDebugGrid(false);
            this.setDebugBounds(false);
            this.setLightEnabled(true);
            this.setLightShadow(true);
            this.setLightFollow(false);
            this.setCenterScene(true);

            this.setSkyboxBackground('None');
            this.setSkyboxExposure(0);
            this.setBackgroundColor(Color.BLACK);
            this.app.scene.layers.getLayerById(LAYERID_SKYBOX).enabled = false;

            this.multiframe.blend = 0.5;
        });

        events.on('xr:initial-place', () => {
            this.multiframe.blend = 1.0;
        });

        events.on('xr:ended', () => {
            this.observer.set('runtime.xrActive', false);

            // reload all user options
            this.reloadSettings();

            // background color isn't correctly restored
            this.setBackgroundColor(this.observer.get('skybox.backgroundColor'));

            this.multiframe.blend = 1.0;
        });
    }

    private _showRipple(x: number, y: number) {
        if (!this.rippleContainer) return;
        const el = document.createElement('div');
        el.className = 'ripple-element';
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
        const dot = document.createElement('div');
        dot.className = 'ripple-dot';
        el.appendChild(dot);
        const delays = [0, 0.12, 0.24];
        for (let i = 0; i < 3; i++) {
            const ring = document.createElement('div');
            ring.className = 'ripple-ring';
            ring.style.animationDelay = `${delays[i]}s`;
            el.appendChild(ring);
        }
        this.rippleContainer.appendChild(el);
        setTimeout(() => {
            el.remove();
        }, RIPPLE_REMOVE_MS);
    }

    private async _pickAndCenterAt(x: number, y: number) {
        const result = await this.picker.pick(x, y);
        if (!result) return;
        this._showRipple(x, y);
        setTimeout(() => {
            this.cameraControls.reset(result, this.camera.getPosition());
        }, RIPPLE_CAMERA_DELAY_MS);
    }

    private getPickRay(x: number, y: number) {
        const origin = this.camera.camera.screenToWorld(x, y, this.camera.camera.nearClip);
        const end = this.camera.camera.screenToWorld(x, y, this.camera.camera.farClip);
        const direction = end.sub(origin).normalize();
        return { origin, direction };
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
        this.clearPostEffectsQueueOnCamera(this.camera.camera);
        if (this.activeSceneCamera) {
            this.clearPostEffectsQueueOnCamera(this.activeSceneCamera);
        }
        this.lutTextureResource?.destroy();
        this.lutTextureResource = null;
        this.lutEffect.lutTexture = null;
        this.lutEffect.lutSize = 0;
        this.measurementController?.dispose?.();
        this.poiController?.dispose?.();
        this.selectionController?.dispose?.();
    }

    /**
     * Load a 3D LUT from an Iridas/Adobe ASCII .cube file (Effects tab).
     */
    loadLutFromCubeFile(domFile: globalThis.File): void {
        void (async () => {
            try {
                const buf = await domFile.arrayBuffer();
                if (buf.byteLength > MAX_LUT_FILE_BYTES) {
                    this.observer.set(
                        'ui.error',
                        `LUT file is too large (max ${MAX_LUT_FILE_BYTES / (1024 * 1024)} MB).`
                    );
                    return;
                }
                const head = new Uint8Array(buf.slice(0, 2));
                const utf16Bom =
                    buf.byteLength >= 2 &&
                    ((head[0] === 0xff && head[1] === 0xfe) || (head[0] === 0xfe && head[1] === 0xff));

                let parsed: ParseCubeLutResult;
                if (utf16Bom) {
                    parsed = parseCubeLut(decodeLutFileBuffer(buf));
                } else {
                    const binary = tryParseBinaryCubeLut(buf);
                    if (binary !== null) {
                        parsed = binary;
                    } else if (lutBufferLooksBinaryAfterUtf8Decode(buf)) {
                        this.observer.set(
                            'ui.error',
                            'Binary LUT is not supported. Use Iridas/Adobe text .cube/.lut, or a raw float32 3D LUT with the supported 28-byte header.'
                        );
                        return;
                    } else {
                        parsed = parseCubeLut(decodeLutFileBuffer(buf));
                    }
                }
                if (parsed.ok === false) {
                    this.observer.set('ui.error', parsed.reason);
                    return;
                }
                this.lutTextureResource?.destroy();
                const lut = parsed.lut;
                let tex: Texture;
                if (lut.kind === '3d') {
                    this.lutEffect.lutIs1D = false;
                    tex = createLutTextureFromCubeData(this.app.graphicsDevice, lut.rgb, lut.size);
                    this.lutEffect.lutSize = lut.size;
                } else {
                    this.lutEffect.lutIs1D = true;
                    this.lutEffect.lutDomainMin = lut.domainMin;
                    this.lutEffect.lutDomainMax = lut.domainMax;
                    this.lutEffect.lutOutputMin = lut.outputMin;
                    this.lutEffect.lutOutputMax = lut.outputMax;
                    tex = createLut1DTextureFromCubeData(
                        this.app.graphicsDevice,
                        lut.rgb,
                        lut.size,
                        lut.outputMin,
                        lut.outputMax
                    );
                    this.lutEffect.lutSize = lut.size;
                }
                this.lutTextureResource = tex;
                this.lutEffect.lutTexture = tex;
                this.observer.set('posteffects.lut.fileName', domFile.name);
                this.observer.set('posteffects.lut.enabled', true);
                this.applyPostEffectsParamsFromObserver();
                this.rebuildPostEffectsQueue();
                this.renderNextFrame();
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                this.observer.set('ui.error', msg);
            }
        })();
    }

    clearLut(): void {
        this.lutTextureResource?.destroy();
        this.lutTextureResource = null;
        this.lutEffect.lutTexture = null;
        this.lutEffect.lutSize = 0;
        this.lutEffect.lutIs1D = false;
        this.observer.set('posteffects.lut.fileName', null);
        this.observer.set('posteffects.lut.enabled', false);
        this.applyPostEffectsParamsFromObserver();
        this.rebuildPostEffectsQueue();
        this.renderNextFrame();
    }

    private syncLutEffectFromObserver(): void {
        const enabled = !!this.observer.get('posteffects.lut.enabled');
        const intensity = Math.max(0, Math.min(1, Number(this.observer.get('posteffects.lut.intensity') ?? 1)));
        this.lutEffect.intensity = enabled ? intensity : 0;
    }

    /** Camera that actually draws the viewport (glTF scene camera or viewer camera). Post-effects must attach here. */
    private getRenderingCamera(): CameraComponent {
        return this.activeSceneCamera ?? this.camera.camera;
    }

    private clearPostEffectsQueueOnCamera(cam: CameraComponent): void {
        const q = cam.postEffects;
        while (q.effects.length > 0) {
            q.removeEffect(q.effects[0].effect);
        }
    }

    private applyPostEffectsParamsFromObserver(): void {
        const pe = this.observer.get('posteffects') as ObserverData['posteffects'] | undefined;
        const rc = this.getRenderingCamera();
        if (!pe) {
            return;
        }

        this.postEffectsBloom.bloomThreshold = Math.max(0, Math.min(1, Number(pe.bloom?.threshold ?? 0.25)));
        this.postEffectsBloom.blurAmount = Math.max(1, Math.min(20, Number(pe.bloom?.blurAmount ?? 4)));
        this.postEffectsBloom.bloomIntensity = Math.max(0, Math.min(5, Number(pe.bloom?.intensity ?? 1.25)));

        this.postEffectsSsao.radius = Math.max(0.01, Math.min(1, Number(pe.ssao?.radius ?? 0.2)));
        this.postEffectsSsao.samples = Math.max(4, Math.min(64, Math.round(Number(pe.ssao?.samples ?? 20))));
        const ssaoInt = Number(pe.ssao?.intensity ?? 2);
        this.postEffectsSsao.brightness = Math.max(0, Math.min(1, 1 - Math.min(1, ssaoInt / 5)));
        this.postEffectsSsao.cameraFarClip = rc.farClip;

        this.postEffectsBrightnessContrast.brightness = Math.max(-1, Math.min(1, Number(pe.brightnessContrast?.brightness ?? 0)));
        this.postEffectsBrightnessContrast.contrast = Math.max(-1, Math.min(1, Number(pe.brightnessContrast?.contrast ?? 0)));

        this.postEffectsHueSaturation.hue = Math.max(-1, Math.min(1, Number(pe.hueSaturation?.hue ?? 0)));
        this.postEffectsHueSaturation.saturation = Math.max(-1, Math.min(1, Number(pe.hueSaturation?.saturation ?? 0)));

        this.syncLutEffectFromObserver();
    }

    private rebuildPostEffectsQueue(): void {
        this.clearPostEffectsQueueOnCamera(this.camera.camera);
        if (this.activeSceneCamera) {
            this.clearPostEffectsQueueOnCamera(this.activeSceneCamera);
        }
        this.applyPostEffectsParamsFromObserver();

        const cam = this.getRenderingCamera();
        /* Post stack needs a render target; scene camera may hold the shared viewer RT when orbit cam is off */
        if (!cam.renderTarget) {
            if (this.multiframe) {
                this.multiframe.camera = cam;
            }
            return;
        }
        const pe = this.observer.get('posteffects') as ObserverData['posteffects'] | undefined;
        if (!pe) {
            if (this.multiframe) {
                this.multiframe.camera = cam;
            }
            return;
        }
        const add = (eff: PostEffect) => {
            cam.postEffects.addEffect(eff);
        };
        if (pe.ssao?.enabled) {
            add(this.postEffectsSsao);
        }
        if (pe.bloom?.enabled) {
            add(this.postEffectsBloom);
        }
        if (pe.brightnessContrast?.enabled) {
            add(this.postEffectsBrightnessContrast);
        }
        if (pe.hueSaturation?.enabled) {
            add(this.postEffectsHueSaturation);
        }
        if (this.lutEffect.lutTexture && pe.lut?.enabled && pe.lut?.fileName) {
            add(this.lutEffect);
        }
        if (pe.fxaa?.enabled) {
            add(this.postEffectsFxaa);
        }
        if (this.multiframe) {
            this.multiframe.camera = cam;
        }
    }

    /**
     * Post-effects: see docs/POST-EFFECTS.md. With `app.autoRender === false`, every path that
     * calls `rebuildPostEffectsQueue()` must also call `renderNextFrame()` or the canvas may not
     * redraw until the camera moves.
     */
    private installPostEffectsObserverBindings(): void {
        const paths = [
            'posteffects.bloom.enabled',
            'posteffects.bloom.intensity',
            'posteffects.bloom.threshold',
            'posteffects.bloom.blurAmount',
            'posteffects.ssao.enabled',
            'posteffects.ssao.radius',
            'posteffects.ssao.intensity',
            'posteffects.ssao.samples',
            'posteffects.brightnessContrast.enabled',
            'posteffects.brightnessContrast.brightness',
            'posteffects.brightnessContrast.contrast',
            'posteffects.hueSaturation.enabled',
            'posteffects.hueSaturation.hue',
            'posteffects.hueSaturation.saturation',
            'posteffects.lut.enabled',
            'posteffects.lut.intensity',
            'posteffects.fxaa.enabled'
        ];
        for (const p of paths) {
            this.observer.on(`${p}:set`, () => {
                this.applyPostEffectsParamsFromObserver();
                this.rebuildPostEffectsQueue();
                this.renderNextFrame();
            });
        }
        /* Whole-object set (mergePosteffectsDefaults, localStorage) does not fire leaf :set events */
        this.observer.on('posteffects:set', () => {
            this.applyPostEffectsParamsFromObserver();
            this.rebuildPostEffectsQueue();
            this.renderNextFrame();
        });
        this.observer.on('posteffects.lut.fileName:set', () => {
            this.applyPostEffectsParamsFromObserver();
            this.rebuildPostEffectsQueue();
            this.renderNextFrame();
        });
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

            const gsplatComponents = entity.findComponents('gsplat');
            for (let i = 0; i < gsplatComponents.length; i++) {
                const gsplat = gsplatComponents[i] as GSplatComponent;
                if (gsplat.instance) {
                    (gsplat.instance.meshInstance as ViewerTaggedMeshInstance).__viewerIsGsplat = true;
                    meshInstances.push(gsplat.instance.meshInstance);
                }
            }
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
            // camera
            'camera.fov': this.setFov.bind(this),
            'camera.tonemapping': this.setTonemapping.bind(this),
            'camera.pixelScale': () => {
                this.canvasResize = true;
                this.renderNextFrame();
            },
            'camera.multisample': () => {
                this.destroyRenderTargets();
                this.renderNextFrame();
            },
            'camera.hq': (enabled: boolean) => {
                this.multiframe.enabled = enabled;
                this.renderNextFrame();
            },
            'camera.mode': (mode: 'orbit' | 'fly') => {
                this.cameraControls.mode = mode;
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
            'debug.normals': this.setNormalLength.bind(this),
            'debug.uvCheckerScale': this.setUvCheckerScale.bind(this),
            'debug.selectedUvSet': this.setSelectedUvSet.bind(this),
            'debug.withTextureOnly': () => {
                this.selectionController?.onTextureSelectionModeChange(this.observer.get('debug.withTextureOnly'));
                this.dirtySelectionHighlight = true;
                this.dirtyTexelDensityHeatmap = true;
                this.renderNextFrame();
            },
            'debug.texelDensityHeatmap': () => {
                this.dirtyTexelDensityHeatmap = true;
                this.renderNextFrame();
            },
            'debug.renderMode': this.setRenderMode.bind(this),

            // animation
            'animation.playing': (playing: boolean) => {
                if (playing) {
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
                }
                this.canvas.style.cursor = enabled ? 'crosshair' : '';
                this.renderNextFrame();
            },
            'measure.unit': () => {
                this.updateTexelDensityStats();
                this.renderNextFrame();
            },
            'measure.unitScale': () => {
                this.updateTexelDensityStats();
                this.renderNextFrame();
            },
            'measure.knownDistance': () => {
                this.measurementController?.limitToLatestKnownDistanceSegment();
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
        this.rebuildPostEffectsQueue();
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
        this.calcSceneBounds(bbox, this.selectedNode as Entity);

        // calculate scene size
        const sceneSize = bbox.halfExtents.length();
        this.cameraControls.moveSpeed = sceneSize * 2.5;
        this.cameraControls.zoomRange = new Vec2(ZOOM_SCALE_MIN, 10 * sceneSize);

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

    destroyRenderTargets() {
        const rt = this.camera.camera.renderTarget;
        if (rt && this.activeSceneCamera && this.activeSceneCamera.renderTarget === rt) {
            this.activeSceneCamera.renderTarget = null;
        }
        this.clearPostEffectsQueueOnCamera(this.camera.camera);
        if (this.activeSceneCamera) {
            this.clearPostEffectsQueueOnCamera(this.activeSceneCamera);
        }
        if (rt) {
            rt.colorBuffer?.destroy();
            rt.depthBuffer?.destroy();
            rt.destroy();
            this.camera.camera.renderTarget = null;
        }
    }

    rebuildRenderTargets() {
        const device = this.app.graphicsDevice;

        // get the canvas UI size
        const widthPixels = device.width;
        const heightPixels = device.height;

        const old = this.camera.camera.renderTarget;
        if (this.isCapturingCoverImage || (old && old.width === widthPixels && old.height === heightPixels)) {
            return;
        }

        // out with the old
        this.destroyRenderTargets();

        const createTexture = (width: number, height: number, format: number) => {
            return new Texture(device, {
                name: 'viewer-rt-texture',
                width: width,
                height: height,
                format: format,
                mipmaps: false,
                minFilter: FILTER_NEAREST,
                magFilter: FILTER_NEAREST,
                addressU: ADDRESS_CLAMP_TO_EDGE,
                addressV: ADDRESS_CLAMP_TO_EDGE
            });
        };

        const maxSamples = Number((device as GraphicsDevice & { maxSamples?: number }).maxSamples ?? 1);

        // in with the new
        const colorBuffer = createTexture(widthPixels, heightPixels, PIXELFORMAT_RGBA8);
        const depthBuffer = createTexture(widthPixels, heightPixels, PIXELFORMAT_DEPTH);
        const renderTarget = new RenderTarget({
            name: 'viewer-rt',
            colorBuffer: colorBuffer,
            depthBuffer: depthBuffer,
            flipY: false,
            samples: this.observer.get('camera.multisample') ? maxSamples : 1,
            autoResolve: false
        });
        this.camera.camera.renderTarget = renderTarget;
        if (this.activeSceneCamera) {
            this.activeSceneCamera.renderTarget = renderTarget;
        }
        this.rebuildPostEffectsQueue();
    }

    // reset the viewer, unloading resources
    resetScene() {
        const app = this.app;

        // reset camera state first - switch back to viewer camera before destroying entities
        if (this.activeSceneCamera) {
            this.activeSceneCamera.enabled = false;
            this.activeSceneCamera = null;
            this.camera.camera.enabled = true;
            this.cameraControls.enabled = true;
        }
        this.sceneCameras = [];

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
        this.selectionController.reset();
        this.resetWireframeMeshes();
        this.resetSelectionHighlightMeshes();
        this.resetTexelDensityHeatmapMeshes();
        this.resetUvColorMeshes();
        this.resetUvCheckerMeshes();
        this.uvCheckerOriginalVisibility.clear();
        this.uvCheckerEnabled = false;
        this.uvDebugMode = null;
        this.resetMaterialOverrides();
        this.clearMeasurement();

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
    }

    private updateMaterialChannelInfo() {
        const channelsWithTextures = new Set<string>();
        const channelFilenames: Record<string, string> = {};
        const materialNames = new Set<string>();

        const getTextureFilename = (tex: TextureLike | null | undefined): string | undefined => {
            if (!tex) return undefined;
            const texAssets = this.app.assets.filter((a: Asset) => a.type === 'texture');
            const texAsset = texAssets.find((a: Asset) => a.resource === tex);
            const file = texAsset?.file as TextureAssetFile | undefined;
            return file?.filename;
        };

        const collectFromMaterial = (mat: MaterialLike | null | undefined) => {
            if (!mat) return;
            if (typeof mat.name === 'string' && mat.name.trim()) {
                materialNames.add(mat.name.trim());
            }
            if (mat.diffuseMap) {
                channelsWithTextures.add('albedo'); if (!channelFilenames.albedo) channelFilenames.albedo = getTextureFilename(mat.diffuseMap) ?? '';
            }
            if (mat.metalnessMap) {
                channelsWithTextures.add('metalness'); if (!channelFilenames.metalness) channelFilenames.metalness = getTextureFilename(mat.metalnessMap) ?? '';
            }
            if (mat.glossMap) {
                channelsWithTextures.add('gloss'); if (!channelFilenames.gloss) channelFilenames.gloss = getTextureFilename(mat.glossMap) ?? '';
            }
            if (mat.normalMap) {
                channelsWithTextures.add('world_normal'); if (!channelFilenames.world_normal) channelFilenames.world_normal = getTextureFilename(mat.normalMap) ?? '';
            }
            if (mat.specularMap) {
                channelsWithTextures.add('specularity'); if (!channelFilenames.specularity) channelFilenames.specularity = getTextureFilename(mat.specularMap) ?? '';
            }
            if (mat.emissiveMap) {
                channelsWithTextures.add('emission'); if (!channelFilenames.emission) channelFilenames.emission = getTextureFilename(mat.emissiveMap) ?? '';
            }
            if (mat.aoMap) {
                channelsWithTextures.add('ao'); if (!channelFilenames.ao) channelFilenames.ao = getTextureFilename(mat.aoMap) ?? '';
            }
            if (mat.opacityMap) {
                channelsWithTextures.add('opacity'); if (!channelFilenames.opacity) channelFilenames.opacity = getTextureFilename(mat.opacityMap) ?? '';
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

        // mesh stats
        this.observer.set('scene.meshCount', meshCount);
        this.observer.set('scene.materialCount', materialCount);
        this.observer.set('scene.textureCount', textureCount);
        this.observer.set('scene.vertexCount', vertexCount);
        this.observer.set('scene.primitiveCount', primitiveCount);
        this.observer.set('scene.textureVRAM', textureVRAM);
        this.observer.set('scene.meshVRAM', meshVRAM);
        this.observer.set('scene.hasGsplat', this.entities.some(entity => entity.findComponents('gsplat').length > 0));

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

    downloadCoverImageScreenshot() {
        const COVER_SIZE = 1024;
        const device = this.app.graphicsDevice;

        if (!this.pngExporter) {
            this.pngExporter = new PngExporter();
        }

        const filenames = this.observer.get('scene.filenames') as string[];
        let baseName = 'model-viewer';
        if (filenames && filenames.length > 0) {
            const stripped = filenames[0].replace(/\.[^/.]+$/, '');
            if (stripped) baseName = stripped;
        }
        const filename = `${baseName}-cover.png`;

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

        this.renderNextFrame();
        this.app.once('postrender', () => {
            const texture = this.camera.camera.renderTarget?.colorBuffer;
            if (!texture || texture.width !== COVER_SIZE || texture.height !== COVER_SIZE) {
                this.cleanupCoverCapture(squareRT, savedRenderTarget, savedFocus, savedPosition, savedMultiframe);
                return;
            }
            texture.read(0, 0, COVER_SIZE, COVER_SIZE).then((typedArray: Uint32Array) => {
                this.pngExporter.export(
                    filename,
                    new Uint32Array(typedArray.buffer.slice(0)),
                    COVER_SIZE,
                    COVER_SIZE
                );
            }).catch((err: unknown) => {
                console.error('Failed to capture cover image:', err);
            }).finally(() => {
                this.cleanupCoverCapture(squareRT, savedRenderTarget, savedFocus, savedPosition, savedMultiframe);
            });
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

    /** Export current viewer settings (camera, skybox, light, etc.) to a JSON file. */
    exportViewerSettings() {
        this.settingsService.exportViewerSettings();
    }

    /** Reset viewer settings (camera, skybox, light, etc.) to defaults. */
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
    private tryFetchAndApplySettings(firstModelUrl: string, allFiles?: Array<{ url: string; filename?: string }>): Promise<void> {
        return this.settingsService.tryFetchAndApplySettings(firstModelUrl, allFiles);
    }

    private preloadLoadingBackgroundFromSettings(firstModelUrl: string, allFiles?: Array<{ url: string; filename?: string; sizeBytes?: number }>): Promise<void> {
        return this.settingsService.preloadLoadingBackgroundFromSettings(firstModelUrl, allFiles);
    }

    /** Apply current observer skybox/light to the scene (e.g. after loading settings from file). */
    private syncSkyboxAndLightFromObserver() {
        this.settingsService.syncSkyboxAndLightFromObserver();
    }

    // adjust camera clipping planes to fit the scene
    fitCameraClipPlanes() {
        if (this.xrMode?.active) {
            return;
        }

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
        this.focus(false);
        this.fitCameraClipPlanes();
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

    flyToCameraView(view: { position: [number, number, number]; focus: [number, number, number]; fov?: number }, duration = 1.0) {
        const endPosition = new Vec3(view.position[0], view.position[1], view.position[2]);
        const endFocus = new Vec3(view.focus[0], view.focus[1], view.focus[2]);
        const endFov = typeof view.fov === 'number' && Number.isFinite(view.fov) ? view.fov : this.camera.camera.fov;

        this.cameraFlyTransition = {
            elapsed: 0,
            duration: Math.max(0.01, duration),
            startPosition: this.cameraControls.getPosition(),
            startFocus: this.cameraControls.getFocus(),
            startFov: this.camera.camera.fov,
            endPosition,
            endFocus,
            endFov
        };
        this.cameraControls.enabled = false;
        this.renderNextFrame();
    }

    private stopCameraFlyTransition() {
        this.cameraFlyTransition = null;
        this.cameraControls.enabled = true;
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

    setObjectPivotToCenter() {
        const previousTransform = this.captureSceneContentTransform();
        const centered = this.observer.get('centerScene');
        const positionOffset = this.sceneTransform.position;
        this.sceneRoot.setLocalPosition(positionOffset[0], positionOffset[1], positionOffset[2]);
        this.sceneRoot.setLocalEulerAngles(this.sceneTransform.rotation[0], this.sceneTransform.rotation[1], this.sceneTransform.rotation[2]);
        this.sceneRoot.setLocalScale(this.sceneTransform.scale[0], this.sceneTransform.scale[1], this.sceneTransform.scale[2]);
        this.sceneContentRoot.setLocalPosition(0, 0, 0);
        this.calcSceneBounds(this.sceneBounds);

        this.sceneTransform = {
            ...this.sceneTransform,
            pivotOffset: centered ?
                [0, this.sceneBounds.center.y - this.sceneBounds.getMin().y, 0] :
                [this.sceneBounds.center.x, this.sceneBounds.center.y, this.sceneBounds.center.z]
        };
        this.setCenterScene(centered);
        this.transformPoisBetween(previousTransform, this.captureSceneContentTransform());
    }

    resetObjectPivot() {
        const previousTransform = this.captureSceneContentTransform();
        this.sceneTransform = {
            ...this.sceneTransform,
            pivotOffset: [0, 0, 0]
        };
        this.setCenterScene(this.observer.get('centerScene'));
        this.transformPoisBetween(previousTransform, this.captureSceneContentTransform());
    }

    resetObjectTransform() {
        this.resetSceneTransform();
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
    private loadGltf(gltfUrl: File, externalUrls: Array<File>, warnings: string[], onProgress?: (progress: number) => void) {
        return this.exceedsRemoteSizeLimit(gltfUrl, Viewer.MODEL_FILE_SIZE_LIMIT_BYTES)
        .then((oversizedBytes) => {
            if (oversizedBytes === 'unknown') {
                throw new Error(this.formatUnknownRemoteSizeMessage(gltfUrl.filename ?? gltfUrl.url ?? '', '1 GB'));
            }
            if (oversizedBytes !== null) {
                throw new Error(this.formatLimitMessage('File "{filename}" ({size}) exceeds model limit of 1 GB.', gltfUrl.filename ?? gltfUrl.url ?? '', oversizedBytes));
            }
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

                        Promise.all([MeshoptDecoder.ready, buffers[extensionDef.buffer]]).then((promiseResult) => {
                            const buffer = promiseResult[1] as Uint8Array;

                            const byteOffset = extensionDef.byteOffset || 0;
                            const byteLength = extensionDef.byteLength || 0;

                            const count = extensionDef.count;
                            const stride = extensionDef.byteStride;

                            const result = new Uint8Array(count * stride);
                            const source = new Uint8Array(buffer.buffer, buffer.byteOffset + byteOffset, byteLength);

                            MeshoptDecoder.decodeGltfBuffer(
                                result,
                                count,
                                stride,
                                source,
                                extensionDef.mode,
                                extensionDef.filter
                            );

                            continuation(null, result);
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
                containerAsset.on('load', () => resolve(containerAsset));
                containerAsset.on('error', (err: string) => reject(err));
                if (onProgress) {
                    containerAsset.on('progress', (receivedBytes: number, totalBytes: number) => {
                        onProgress(totalBytes > 0 ? receivedBytes / totalBytes : 0);
                    });
                }
                this.app.assets.add(containerAsset);
                this.app.assets.load(containerAsset);
            });
        });
    }

    private loadPly(url: File, externalUrls: Array<File>, onProgress?: (progress: number) => void) {
        return this.exceedsRemoteSizeLimit(url, Viewer.MODEL_FILE_SIZE_LIMIT_BYTES)
        .then((oversizedBytes) => {
            if (oversizedBytes === 'unknown') {
                throw new Error(this.formatUnknownRemoteSizeMessage(url.filename ?? url.url ?? '', '1 GB'));
            }
            if (oversizedBytes !== null) {
                throw new Error(this.formatLimitMessage('File "{filename}" ({size}) exceeds model limit of 1 GB.', url.filename ?? url.url ?? '', oversizedBytes));
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
                if (onProgress) {
                    asset.on('progress', (receivedBytes: number, totalBytes: number) => {
                        onProgress(totalBytes > 0 ? receivedBytes / totalBytes : 0);
                    });
                }
                this.app.assets.add(asset);
                this.app.assets.load(asset);
            });
        });
    }

    // returns true if the filename has one of the recognized model extensions
    isModelFilename(filename: string) {
        const parts = filename.split('?')[0].split('/').pop().split('.');
        const result = parts.length === 1 || modelExtensions.includes(parts.pop().toLowerCase());
        return result;
    }

    isGSplatFilename(filename: string) {
        const parts = filename.split('?')[0].split('/').pop().split('.');
        const result = parts.length > 0 && ['ply', 'json', 'sog'].includes(parts.pop().toLowerCase());
        return result;
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

    private formatUnknownRemoteSizeMessage(filename: string, limitLabel: string): string {
        const lang = this.observer.get('ui.language') as string | undefined;
        return t('File "{filename}" was blocked because server does not provide size metadata. Limit: {size}.', lang)
        .replace('{filename}', filename)
        .replace('{size}', limitLabel);
    }

    private parseContentRangeTotal(contentRange: string | null): number | null {
        if (!contentRange) return null;
        const match = /^bytes\s+\d+-\d+\/(\d+|\*)$/i.exec(contentRange.trim());
        if (!match || match[1] === '*') return null;
        const total = Number(match[1]);
        return Number.isFinite(total) && total > 0 ? total : null;
    }

    private async resolveRemoteFileSize(url: string): Promise<number | null> {
        const headController = new AbortController();
        const headTimeoutId = setTimeout(() => headController.abort(), Viewer.REMOTE_HEAD_TIMEOUT_MS);
        try {
            const response = await fetch(url, { method: 'HEAD', signal: headController.signal, cache: 'no-store' });
            if (response.ok) {
                const contentLength = response.headers.get('content-length');
                const bytes = Number(contentLength);
                if (Number.isFinite(bytes) && bytes > 0) {
                    return bytes;
                }
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
            if (!response.ok) return null;

            const rangeTotal = this.parseContentRangeTotal(response.headers.get('content-range'));
            if (rangeTotal !== null) return rangeTotal;

            const contentLength = response.headers.get('content-length');
            const bytes = Number(contentLength);
            return Number.isFinite(bytes) && bytes > 0 ? bytes : null;
        } catch {
            return null;
        } finally {
            clearTimeout(rangeTimeoutId);
        }
    }

    private async exceedsRemoteSizeLimit(file: File, limitBytes: number): Promise<number | 'unknown' | null> {
        if (typeof file.sizeBytes === 'number' && file.sizeBytes > 0) {
            return file.sizeBytes > limitBytes ? file.sizeBytes : null;
        }
        const fileUrl = file.url ?? '';
        if (!/^https?:\/\//i.test(fileUrl)) {
            return null;
        }
        const resolvedBytes = await this.resolveRemoteFileSize(fileUrl);
        if (resolvedBytes === null) return 'unknown';
        return resolvedBytes > limitBytes ? resolvedBytes : null;
    }

    // load the list of urls.
    // urls can reference glTF files, glb files and skybox textures.
    // returns true if a model was loaded.
    loadFiles(files: Array<File>, resetScene = false) {
        // convert single url to list
        if (!Array.isArray(files)) {
            files = [files];
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

            this.resetViewerSettingsToDefaults();
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
                let lastProgressUpdate = 0;
                let lastProgressValue = 0;
                const PROGRESS_THROTTLE_MS = 80;
                const PROGRESS_MIN_DELTA = 1.5;

                let fallbackInterval: ReturnType<typeof setInterval> | null = null;
                const stopFallbackProgress = () => {
                    if (fallbackInterval) {
                        clearInterval(fallbackInterval);
                        fallbackInterval = null;
                    }
                };

                const setAggregateProgress = () => {
                    const sum = progressPerFile.reduce((a, b) => a + b, 0);
                    const pct = total > 0 ? (sum / total) * 90 : 0;
                    const target = Math.min(90, Math.floor(pct * 10) / 10);
                    const now = Date.now();
                    const deltaOk = Math.abs(target - lastProgressValue) >= PROGRESS_MIN_DELTA;
                    const timeOk = now - lastProgressUpdate >= PROGRESS_THROTTLE_MS;
                    if (target >= 90 || deltaOk || timeOk) {
                        lastProgressUpdate = now;
                        lastProgressValue = target;
                        this.observer.set('ui.loadProgress', target);
                    }
                    if (sum > 0 && fallbackInterval) stopFallbackProgress();
                };

                const startFallbackProgress = () => {
                    fallbackInterval = setInterval(() => {
                        const current = this.observer.get('ui.loadProgress') as number;
                        if (current >= 90) return;
                        this.observer.set('ui.loadProgress', Math.min(90, current + 3));
                    }, 150);
                };

                const promises = modelFiles.map((file, modelIndex) => {
                    const onProgress = (p: number) => {
                        progressPerFile[modelIndex] = p;
                        setAggregateProgress();
                    };
                    return this.isModelFilename(file.filename) ?
                        this.loadGltf(file, files, warnings, onProgress) :
                        this.loadPly(file, files, onProgress);
                });

                setTimeout(() => {
                    if ((this.observer.get('ui.loadProgress') as number) === 0) startFallbackProgress();
                }, 300);

                const wrappedPromises = promises.map((p, i) => p.then((asset) => {
                    progressPerFile[i] = 1;
                    setAggregateProgress();
                    return asset;
                }));

                Promise.all(wrappedPromises)
                .then((assets: Asset[]) => {
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

                    // auto-load settings from model folder (URL) or from dropped/selected files (blob)
                    const firstModelUrl = modelFiles[0]?.url;
                    return this.tryFetchAndApplySettings(firstModelUrl, files);
                })
                .then(() => {
                    this.postSceneLoad();
                })
                .catch((err) => {
                    console.log(err);
                    if (warnings.length > 0) {
                        this.observer.set('ui.warnings', warnings);
                    }
                    this.observer.set('ui.error', err?.toString() || err);
                })
                .finally(() => {
                    stopFallbackProgress();
                    this.observer.set('ui.loadProgress', 100);
                    setTimeout(() => {
                        this.observer.set('ui.spinner', false);
                        this.observer.set('ui.loadingBackgroundReady', false);
                    }, 250);
                });
            });
        } else {
            // load skybox
            this.loadSkybox(files);
        }

        // return true if a model/scene was loaded and false otherwise
        return hasModelFilename;
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
        this.entities.forEach((e) => {
            if (e.anim) {
                e.anim.playing = false;
                e.anim.baseLayer?.pause();
            }
        });
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
        }

        this.selectedNode = graphNode;
        this.selectionController?.onSelectionNodeChanged();
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

        this.rebuildPostEffectsQueue();
        this.renderNextFrame();
    }

    setCenterScene(value: boolean) {
        const positionOffset = this.sceneTransform.position;
        this.sceneRoot.setLocalPosition(positionOffset[0], positionOffset[1], positionOffset[2]);
        this.sceneRoot.setLocalEulerAngles(this.sceneTransform.rotation[0], this.sceneTransform.rotation[1], this.sceneTransform.rotation[2]);
        this.sceneRoot.setLocalScale(this.sceneTransform.scale[0], this.sceneTransform.scale[1], this.sceneTransform.scale[2]);
        this.sceneContentRoot.setLocalPosition(0, 0, 0);

        // calculate scene bounds after first render in order to get accurate morph target and skinned bounds
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

        this.renderNextFrame();
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

        const previousInverse = new Mat4().copy(previousTransform).invert();
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

    setWireframeColor(color: { r: number; g: number; b: number }) {
        this.wireframeMaterial.ambient = new Color(color.r, color.g, color.b);
        this.wireframeMaterial.diffuse = new Color(color.r, color.g, color.b);
        this.wireframeMaterial.specular = new Color(0, 0, 0);
        this.wireframeMaterial.emissive = new Color(color.r, color.g, color.b);
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
        if (!this.rotateGizmo || !this.translateGizmo) {
            return;
        }

        this.rotateGizmo.enabled = false;
        this.translateGizmo.enabled = false;
        if (enabled) {
            this.setAlignmentGizmoMode(this.observer.get('debug.alignmentGizmoMode') ?? 'rotate');
        } else {
            this.rotateGizmo.detach();
            this.translateGizmo.detach();
            this.cameraControls.enabled = true;
        }
        this.renderNextFrame();
    }

    setAlignmentGizmoMode(mode: 'move' | 'rotate') {
        if (!this.rotateGizmo || !this.translateGizmo) {
            return;
        }

        const enabled = !!this.observer.get('debug.alignmentMode');
        this.rotateGizmo.enabled = false;
        this.translateGizmo.enabled = false;
        this.rotateGizmo.detach();
        this.translateGizmo.detach();

        if (!enabled) {
            this.renderNextFrame();
            return;
        }

        if (mode === 'move') {
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

    setLightColor(color: { r: number; g: number; b: number }) {
        this.light.light.color = new Color(color.r, color.g, color.b);
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

    setBackgroundColor(color: { r: number; g: number; b: number }) {
        const cnv = (value: number) => Math.max(0, Math.min(255, Math.floor(value * 255)));
        document.getElementById('canvas-wrapper').style.backgroundColor = `rgb(${cnv(color.r)}, ${cnv(color.g)}, ${cnv(
            color.b
        )})`;
    }

    update(deltaTime: number) {
        this.updateCameraFlyTransition(deltaTime);

        // update the orbit camera
        if (!this.xrMode?.active && !this.cameraFlyTransition) {
            this.cameraControls.update(deltaTime);
        }

        this.setRotationSnap(!!this.rotateGizmo?.enabled && this.app.keyboard.isPressed(KEY_CONTROL));

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

        // always render during xr sessions
        if (this.xrMode?.active) {
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
                const unified = ((asset.file as AssetFileLike | undefined)?.filename ?? '').endsWith('lod-meta.json');

                // gaussian splat scene
                entity = new Entity();
                entity.setEulerAngles(0, 0, 180);
                entity.addComponent('gsplat', { unified, asset });

                // render frame if gaussian splat sorter updates)
                if (!unified) {
                    entity.gsplat.instance.sorter.on('updated', () => {
                        this.renderNextFrame();
                    });
                }
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
        if (this.meshInstances.length === 0) {
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

        this.renderNextFrame();

        // we perform some special processing on the first frame
        this.firstFrame = true;

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
        animationState.playing = true;
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

    private resetSelectionHighlightMeshes() {
        this.app.scene.layers.getLayerByName('World').removeMeshInstances(this.selectionHighlightMeshInstances);
        this.selectionHighlightMeshInstances.forEach((mi) => {
            mi.clearShaders();
        });
        this.selectionHighlightMeshInstances = [];
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

    private buildSelectionHighlightMeshes() {
        if (!this.selectedNode || !this.observer.get('debug.withTextureOnly')) return;

        const selectedMeshes = this.collectMeshInstances(this.selectedNode as Entity);
        this.selectionHighlightMeshInstances = selectedMeshes.map((mi) => {
            const meshInstance = new MeshInstance(mi.mesh, this.selectionHighlightMaterial, mi.node);
            meshInstance.renderStyle = PRIMITIVE_LINES;
            meshInstance.skinInstance = mi.skinInstance;
            meshInstance.morphInstance = mi.morphInstance;
            return meshInstance;
        });
        this.app.scene.layers.getLayerByName('World').addMeshInstances(this.selectionHighlightMeshInstances);
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
            const { width, height } = this.getCanvasSize();
            const pixelScale = this.observer.get('camera.pixelScale');
            const widthPixels = Math.floor((width * window.devicePixelRatio) / pixelScale);
            const heightPixels = Math.floor((height * window.devicePixelRatio) / pixelScale);
            this.app.graphicsDevice.setResolution(widthPixels, heightPixels);
            this.observer.set('runtime.viewportWidth', widthPixels);
            this.observer.set('runtime.viewportHeight', heightPixels);
            this.canvasResize = false;
        }

        // rebuild render targets
        this.rebuildRenderTargets();

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

        // selected-object highlight (green contour only)
        if (this.dirtySelectionHighlight) {
            this.dirtySelectionHighlight = false;
            this.resetSelectionHighlightMeshes();
            this.buildSelectionHighlightMeshes();
        }
        this.selectionController.onPrerender(this.selectionHighlightMeshInstances.length);
        if (this.showWireframe && this.observer.get('debug.withTextureOnly')) {
            const showWireframeOverlay = !this.selectionController.isFlashActive();
            this.wireframeMeshInstances.forEach((mi) => {
                mi.visible = showWireframeOverlay;
            });
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
        if (this.dirtyBounds || this.xrMode?.active) {
            this.dirtyBounds = false;

            // calculate bounds
            this.calcSceneBounds(this.dynamicSceneBounds);

            this.debugBounds.clear();
            if (this.showBounds) {
                this.calcSceneBounds(bbox, this.selectedNode as Entity);
                this.debugBounds.box(bbox.getMin(), bbox.getMax());
            }
            this.debugBounds.update();

            this.tmpBoundsSize.set(
                this.dynamicSceneBounds.halfExtents.x * 2,
                this.dynamicSceneBounds.halfExtents.y * 2,
                this.dynamicSceneBounds.halfExtents.z * 2
            );
            this.observer.set('scene.bounds', this.tmpBoundsSize.toString());
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

        // measurement overlays (thick 2D SVG line + crosses)
        // keep DebugLines buffer empty so measurements are always overlay-only (never depth-tested / occluded by mesh)
        this.debugMeasure.clear();
        this.debugMeasure.update();
        this.drawReferenceRuler();
        this.measurementController.updateOverlay((point: Vec3) => this.camera.camera.worldToScreen(point));
        this.poiController.updateOverlay((point: Vec3) => this.camera.camera.worldToScreen(point));

        // fit camera planes to the scene
        this.fitCameraClipPlanes();

        this.shadowCatcher.onUpdate(this.dynamicSceneBounds);

        if (this.perfEnabled) {
            this.perfOnPrerenderTotalMs += performance.now() - perfStart;
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

    private onPostrender() {
        const perfStart = this.perfEnabled ? performance.now() : 0;
        if (this.firstFrame) {
            this.firstFrame = false;

            // reinit scene bounds after first render in order to get accurate morph target and skinned bounds
            this.initSceneBounds();
        }

        // resolve the (possibly multisampled) render target — use post-effect output when the queue is active
        const cam = this.getRenderingCamera();
        const pq = cam.postEffects;
        const dest = pq.enabled && pq.effects.length > 0 ? pq.destinationRenderTarget : null;
        const rt = dest ?? cam.renderTarget;
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
