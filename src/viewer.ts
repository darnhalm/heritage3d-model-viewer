import { Observer } from '@playcanvas/observer';
import {
    ADDRESS_CLAMP_TO_EDGE,
    BLENDMODE_ONE,
    BLENDMODE_ZERO,
    BLENDEQUATION_ADD,
    EVENT_KEYDOWN,
    FILTER_NEAREST,
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
    RenderComponent,
    RenderTarget,
    StandardMaterial,
    Texture,
    TouchDevice,
    Vec3,
    Vec2,
    CameraComponent
} from 'playcanvas';

import { App } from './app';
import { CameraControls } from './camera-controls';
import { DebugLines } from './debug-lines';
import { CreateDropHandler } from './drop-handler';
import { Multiframe } from './multiframe';
import { Picker } from './picker';
import { PngExporter } from './png-exporter';
import { ShadowCatcher } from './shadow-catcher';
import arCloseImage from './svg/ar-close.svg';
import arModeImage from './svg/ar-mode.svg';
import { File, HierarchyNode, MorphTargetData, SceneCamera } from './types';
import { XRObjectPlacementController } from './xr-mode';
import { MeshoptDecoder } from '../lib/meshopt_decoder.module.js';

// model filename extensions
const modelExtensions = ['gltf', 'glb', 'vox'];
const defaultSceneBounds = new BoundingBox(new Vec3(0, 1, 0), new Vec3(1, 1, 1));

const vec = new Vec3();
const bbox = new BoundingBox();

const FOCUS_FOV = 75;
const ZOOM_SCALE_MIN = 0.01;

const doubleTapDelay = 400;
const doubleTapRadius = 45;
const MEASURE_CLICK_DRAG_THRESHOLD = 5;
const RIPPLE_CAMERA_DELAY_MS = 380;
const RIPPLE_REMOVE_MS = 900;

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

class Viewer {
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

    debugRoot: Entity;

    entities: Array<Entity>;

    entityAssets: Array<{ entity: Entity; asset: Asset }>;

    assets: Array<Asset>;

    meshInstances: Array<MeshInstance>;

    wireframeMeshInstances: Array<MeshInstance>;

    wireframeMaterial: StandardMaterial;

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

    miniStats: MiniStats;

    observer: Observer;

    suppressAnimationProgressUpdate: boolean;

    selectedNode: GraphNode | null;

    multiframe: Multiframe | null;

    multiframeBusy = false;

    private isCapturingCoverImage = false;

    picker: Picker = null;

    cursorWorld = new Vec3();

    rippleContainer: HTMLDivElement | null = null;

    measureOverlay: HTMLDivElement | null = null;

    measureSvgEl: SVGSVGElement | null = null;

    measureLineEl: SVGLineElement | null = null;

    measureStartHX: SVGLineElement | null = null;

    measureStartVY: SVGLineElement | null = null;

    measureEndHX: SVGLineElement | null = null;

    measureEndVY: SVGLineElement | null = null;

    measureLabelEl: HTMLDivElement | null = null;

    lastTapTime = 0;

    lastTapX = 0;

    lastTapY = 0;

    private measureClickDown: { clientX: number; clientY: number; canvasX: number; canvasY: number } | null = null;

    private measureIsPotentialClick = false;

    measureStart: Vec3 | null = null;

    measureEnd: Vec3 | null = null;

    loadTimestamp?: number = null;

    shadowCatcher: ShadowCatcher = null;

    xrMode: XRObjectPlacementController;

    canvasResize = true;

    cameraControls: CameraControls;

    sceneCameras: Array<CameraComponent> = [];

    activeSceneCamera: CameraComponent | null = null;

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

        // @ts-ignore
        const multisampleSupported = app.graphicsDevice.maxSamples > 1;
        observer.set('camera.multisampleSupported', multisampleSupported);
        observer.set('camera.multisample', multisampleSupported && observer.get('camera.multisample'));

        // create drop handler
        CreateDropHandler(document.getElementById('app'), (files: Array<File>, resetScene: boolean) => {
            this.loadFiles(files, resetScene);
        });

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
                    this.cameraControls.reset(Vec3.ZERO, new Vec3(2, 2, 2));
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

        const debugRoot = new Entity('debugRoot', app);
        app.root.addChild(debugRoot);

        // store app things
        this.camera = camera;
        this.initialCameraPosition = null;
        this.initialCameraFocus = null;
        this.light = light;
        this.sceneRoot = sceneRoot;
        this.debugRoot = debugRoot;
        this.entities = [];
        this.entityAssets = [];
        this.assets = [];
        this.meshInstances = [];
        this.wireframeMeshInstances = [];

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

        // construct ministats, default off
        this.miniStats = new MiniStats(app);
        this.miniStats.enabled = observer.get('debug.stats');

        this.observer = observer;

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

        // ripple container over canvas (pointer-events: none)
        const wrapper = this.canvas.parentElement;
        if (wrapper) {
            this.rippleContainer = document.createElement('div');
            this.rippleContainer.className = 'ripple-container';
            wrapper.appendChild(this.rippleContainer);

            this.measureOverlay = document.createElement('div');
            this.measureOverlay.className = 'measure-overlay';
            this.measureSvgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            this.measureSvgEl.setAttribute('class', 'measure-svg');
            this.measureSvgEl.style.display = 'none';

            const mkLine = (cls: string) => {
                const el = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                el.setAttribute('class', cls);
                this.measureSvgEl?.appendChild(el);
                return el;
            };
            this.measureLineEl = mkLine('measure-line');
            this.measureStartHX = mkLine('measure-cross');
            this.measureStartVY = mkLine('measure-cross');
            this.measureEndHX = mkLine('measure-cross');
            this.measureEndVY = mkLine('measure-cross');
            this.measureOverlay.appendChild(this.measureSvgEl);

            this.measureLabelEl = document.createElement('div');
            this.measureLabelEl.className = 'measure-label';
            this.measureLabelEl.style.display = 'none';
            this.measureOverlay.appendChild(this.measureLabelEl);
            wrapper.appendChild(this.measureOverlay);
        }

        // double click: pick → ripple → after 380ms center camera
        canvas.addEventListener('dblclick', (event: MouseEvent) => {
            if (this.observer.get('measure.enabled')) return;
            this._pickAndCenterAt(event.offsetX, event.offsetY);
        });

        // measure mode: pick points only on real click (not on click+orbit drag)
        const onMeasureMousedown = (event: MouseEvent) => {
            if (!this.observer.get('measure.enabled')) return;
            if (event.button !== 0) return;
            if (event.target !== canvas) return;
            const rect = canvas.getBoundingClientRect();
            this.measureClickDown = {
                clientX: event.clientX,
                clientY: event.clientY,
                canvasX: event.clientX - rect.left,
                canvasY: event.clientY - rect.top
            };
            this.measureIsPotentialClick = true;
        };
        const onMeasureMousemove = (event: MouseEvent) => {
            if (!this.measureIsPotentialClick || !this.measureClickDown) return;
            const dx = event.clientX - this.measureClickDown.clientX;
            const dy = event.clientY - this.measureClickDown.clientY;
            if (Math.hypot(dx, dy) > MEASURE_CLICK_DRAG_THRESHOLD) {
                this.measureIsPotentialClick = false;
            }
        };
        const onMeasureMouseup = (event: MouseEvent) => {
            if (event.button !== 0) return;
            if (this.measureIsPotentialClick && this.measureClickDown && this.observer.get('measure.enabled')) {
                this._pickAndMeasureAt(this.measureClickDown.canvasX, this.measureClickDown.canvasY);
            }
            this.measureIsPotentialClick = false;
            this.measureClickDown = null;
        };
        canvas.addEventListener('mousedown', onMeasureMousedown);
        document.addEventListener('mousemove', onMeasureMousemove);
        document.addEventListener('mouseup', onMeasureMouseup);

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

    private initXrMode() {
        const xr = this.app.xr;

        this.xrMode = new XRObjectPlacementController({
            xr: xr,
            camera: this.camera,
            content: this.sceneRoot,
            showUI: true,
            startArImgSrc: arModeImage.src,
            stopArImgSrc: arCloseImage.src
        });

        const events = this.xrMode.events;

        events.on('xr:started', () => {
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

    private async _pickAndMeasureAt(x: number, y: number) {
        const p = await this.picker.pick(x, y);
        if (!p) return;

        const waitingSecondPoint = this.observer.get('measure.pointCount') === 1;

        if (!waitingSecondPoint || !this.measureStart) {
            this.measureStart = p.clone();
            this.measureEnd = null;
            this.observer.set('measure.pointCount', 1);
            this.observer.set('measure.lastDistance', null);
            this.renderNextFrame();
            return;
        }

        this.measureEnd = p.clone();
        const rawDistance = this.measureStart.distance(this.measureEnd);
        const unitScale = Number(this.observer.get('measure.unitScale') ?? 1);
        const distanceMeters = rawDistance * (Number.isFinite(unitScale) && unitScale > 0 ? unitScale : 1);

        this.observer.set('measure.lastDistance', distanceMeters);
        this.observer.set('measure.pointCount', 0);
        this.renderNextFrame();
    }

    clearMeasurement() {
        this.measureStart = null;
        this.measureEnd = null;
        this.observer.set('measure.pointCount', 0);
        this.observer.set('measure.lastDistance', null);
        if (this.measureLabelEl) this.measureLabelEl.style.display = 'none';
        if (this.measureSvgEl) this.measureSvgEl.style.display = 'none';
        this.renderNextFrame();
    }

    /** Recalibrate unitScale: user measured two points and knows the real-world distance. Sets unitScale so that lastDistance matches knownDistance. */
    recalculateSceneSize() {
        const lastDistance = this.observer.get('measure.lastDistance') as number | null;
        const unitScale = Number(this.observer.get('measure.unitScale') ?? 1);
        const knownDistance = Number(this.observer.get('measure.knownDistance') ?? 0);
        const unit = this.observer.get('measure.unit') as 'mm' | 'cm' | 'm';
        if (lastDistance == null || lastDistance <= 0 || !Number.isFinite(unitScale) || unitScale <= 0 || !Number.isFinite(knownDistance) || knownDistance <= 0) {
            return;
        }
        const factor = unit === 'mm' ? 0.001 : unit === 'cm' ? 0.01 : 1;
        const knownDistanceMeters = knownDistance * factor;
        const rawDistance = lastDistance / unitScale;
        const newUnitScale = knownDistanceMeters / rawDistance;
        if (!Number.isFinite(newUnitScale) || newUnitScale <= 0) return;
        this.observer.set('measure.unitScale', newUnitScale);
        this.observer.set('measure.lastDistance', knownDistanceMeters);
        this.renderNextFrame();
    }

    private updateMeasurementOverlay() {
        if (!this.measureSvgEl || !this.measureStart) return;
        this.measureSvgEl.setAttribute('viewBox', `0 0 ${this.canvas.clientWidth} ${this.canvas.clientHeight}`);

        const dpr = window.devicePixelRatio || 1;
        const start = this.camera.camera.worldToScreen(this.measureStart);
        const sx = start.x / dpr;
        const sy = start.y / dpr;
        const visStart = start.z > 0;

        const crossSize = 7;
        const setCross = (hx: SVGLineElement | null, vy: SVGLineElement | null, x: number, y: number, visible: boolean) => {
            if (!hx || !vy) return;
            hx.setAttribute('x1', `${x - crossSize}`);
            hx.setAttribute('y1', `${y}`);
            hx.setAttribute('x2', `${x + crossSize}`);
            hx.setAttribute('y2', `${y}`);
            vy.setAttribute('x1', `${x}`);
            vy.setAttribute('y1', `${y - crossSize}`);
            vy.setAttribute('x2', `${x}`);
            vy.setAttribute('y2', `${y + crossSize}`);
            const disp = visible ? 'block' : 'none';
            hx.style.display = disp;
            vy.style.display = disp;
        };

        setCross(this.measureStartHX, this.measureStartVY, sx, sy, visStart);

        if (!this.measureEnd) {
            if (this.measureLineEl) this.measureLineEl.style.display = 'none';
            if (this.measureEndHX) this.measureEndHX.style.display = 'none';
            if (this.measureEndVY) this.measureEndVY.style.display = 'none';
            if (this.measureLabelEl) this.measureLabelEl.style.display = 'none';
            this.measureSvgEl.style.display = visStart ? 'block' : 'none';
            return;
        }

        const end = this.camera.camera.worldToScreen(this.measureEnd);
        const ex = end.x / dpr;
        const ey = end.y / dpr;
        const visEnd = end.z > 0;
        setCross(this.measureEndHX, this.measureEndVY, ex, ey, visEnd);

        const lineVisible = visStart && visEnd;
        if (this.measureLineEl) {
            this.measureLineEl.setAttribute('x1', `${sx}`);
            this.measureLineEl.setAttribute('y1', `${sy}`);
            this.measureLineEl.setAttribute('x2', `${ex}`);
            this.measureLineEl.setAttribute('y2', `${ey}`);
            this.measureLineEl.style.display = lineVisible ? 'block' : 'none';
        }

        if (this.measureLabelEl) {
            const lastMeters = this.observer.get('measure.lastDistance') as number | null;
            if (Number.isFinite(lastMeters) && lineVisible) {
                const unit = this.observer.get('measure.unit') as 'mm' | 'cm' | 'm';
                const factor = unit === 'mm' ? 1000 : (unit === 'cm' ? 100 : 1);
                const precision = unit === 'mm' ? 0 : 2;
                this.measureLabelEl.textContent = `${(lastMeters * factor).toFixed(precision)} ${unit}`;
                this.measureLabelEl.style.left = `${(sx + ex) * 0.5}px`;
                this.measureLabelEl.style.top = `${(sy + ey) * 0.5}px`;
                this.measureLabelEl.style.display = 'block';
            } else {
                this.measureLabelEl.style.display = 'none';
            }
        }

        this.measureSvgEl.style.display = lineVisible || visStart ? 'block' : 'none';
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
        const controlEvents: Record<string, (...args: any[]) => void> = {
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
            'debug.normals': this.setNormalLength.bind(this),
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
                if (!enabled) {
                    this.clearMeasurement();
                }
                this.canvas.style.cursor = enabled ? 'crosshair' : '';
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
            const toVec3 = (v: any): Vec3 | null => {
                if (!v || typeof v !== 'object') return null;
                const a = Array.isArray(v) ? v : ('0' in v && '1' in v && '2' in v ? [v[0], v[1], v[2]] : null);
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

        // @ts-ignore
        const maxSamples = device.maxSamples;

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
            this.sceneRoot.removeChild(entity);
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
        this.resetWireframeMeshes();
        this.clearMeasurement();

        // reset animation state
        this.animTracks = [];
        this.animationMap = {};

        this.observer.set('scene.materialChannelsWithTextures', '[]');
        this.observer.set('scene.materialChannelPreviews', '{}');
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
                const resource = asset.resource as any;

                variants = variants.concat(resource.getMaterialVariants() ?? []);

                resource.renders.forEach((renderAsset: Asset) => {
                    const res = renderAsset.resource as any;
                    meshCount += res.meshes.length;
                    res.meshes.forEach((mesh: Mesh) => {
                        vertexCount += mesh.vertexBuffer.getNumVertices();

                        const prim = mesh.primitive[0];
                        switch (prim.type) {
                            case PRIMITIVE_POINTS:
                                primitiveCount += prim.count;
                                break;
                            case PRIMITIVE_LINES:
                                primitiveCount += prim.count / 2;
                                break;
                            case PRIMITIVE_LINELOOP:
                                primitiveCount += prim.count;
                                break;
                            case PRIMITIVE_LINESTRIP:
                                primitiveCount += prim.count - 1;
                                break;
                            case PRIMITIVE_TRIANGLES:
                                primitiveCount += prim.count / 3;
                                break;
                            case PRIMITIVE_TRISTRIP:
                                primitiveCount += prim.count - 2;
                                break;
                            case PRIMITIVE_TRIFAN:
                                primitiveCount += prim.count - 2;
                                break;
                        }
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

        // collect which material channels have texture maps (for "hide empty channels" option)
        const channelsWithTextures = new Set<string>();
        this.assets.forEach((asset) => {
            if (asset.type === 'gsplat') return;
            const resource = asset.resource as any;
            (resource.materials ?? []).forEach((matAsset: Asset) => {
                const mat = matAsset?.resource as any;
                if (!mat) return;
                if (mat.diffuseMap) channelsWithTextures.add('albedo');
                if (mat.metalnessMap) channelsWithTextures.add('metalness');
                if (mat.glossMap) channelsWithTextures.add('gloss');
                if (mat.normalMap) channelsWithTextures.add('world_normal');
                if (mat.specularMap) channelsWithTextures.add('specularity');
                if (mat.emissiveMap) channelsWithTextures.add('emission');
                if (mat.aoMap) channelsWithTextures.add('ao');
                if (mat.opacityMap) channelsWithTextures.add('opacity');
            });
        });
        channelsWithTextures.add('lighting'); // lighting is computed, always show
        this.observer.set('scene.materialChannelsWithTextures', JSON.stringify([...channelsWithTextures]));

        // collect channel previews (texture thumbnails or value/color)
        const channelPreviews: Record<string, { type: string; src?: string; value?: number; r?: number; g?: number; b?: number }> = {};
        const getTextureSrc = (tex: any): string | null => {
            if (!tex || typeof tex.getSource !== 'function') return null;
            try {
                const src = tex.getSource();
                if (!src) return null;
                if (src.src) return src.src;
                if (src instanceof HTMLCanvasElement) return src.toDataURL();
                return null;
            } catch {
                return null;
            }
        };
        this.assets.forEach((asset) => {
            if (asset.type === 'gsplat') return;
            const resource = asset.resource as any;
            (resource.materials ?? []).forEach((matAsset: Asset) => {
                const mat = matAsset?.resource as any;
                if (!mat) return;
                if (!channelPreviews.albedo) {
                    const src = getTextureSrc(mat.diffuseMap);
                    if (src) channelPreviews.albedo = { type: 'texture', src };
                    else if (mat.diffuse) channelPreviews.albedo = { type: 'color', r: mat.diffuse.r, g: mat.diffuse.g, b: mat.diffuse.b };
                }
                if (!channelPreviews.metalness) {
                    const src = getTextureSrc(mat.metalnessMap);
                    if (src) channelPreviews.metalness = { type: 'texture', src };
                    else if (typeof mat.metalness === 'number') channelPreviews.metalness = { type: 'value', value: mat.metalness };
                }
                if (!channelPreviews.gloss) {
                    const src = getTextureSrc(mat.glossMap);
                    if (src) channelPreviews.gloss = { type: 'texture', src };
                    else if (typeof mat.gloss === 'number') channelPreviews.gloss = { type: 'value', value: mat.gloss };
                }
                if (!channelPreviews.world_normal && mat.normalMap) {
                    const src = getTextureSrc(mat.normalMap);
                    if (src) channelPreviews.world_normal = { type: 'texture', src };
                }
                if (!channelPreviews.specularity) {
                    const src = getTextureSrc(mat.specularMap);
                    if (src) channelPreviews.specularity = { type: 'texture', src };
                    else if (mat.specular) channelPreviews.specularity = { type: 'color', r: mat.specular.r, g: mat.specular.g, b: mat.specular.b };
                }
                if (!channelPreviews.emission) {
                    const src = getTextureSrc(mat.emissiveMap);
                    if (src) channelPreviews.emission = { type: 'texture', src };
                    else if (mat.emissive) channelPreviews.emission = { type: 'color', r: mat.emissive.r, g: mat.emissive.g, b: mat.emissive.b };
                }
                if (!channelPreviews.ao && mat.aoMap) {
                    const src = getTextureSrc(mat.aoMap);
                    if (src) channelPreviews.ao = { type: 'texture', src };
                }
                if (!channelPreviews.opacity) {
                    const src = getTextureSrc(mat.opacityMap);
                    if (src) channelPreviews.opacity = { type: 'texture', src };
                    else if (typeof mat.opacity === 'number') channelPreviews.opacity = { type: 'value', value: mat.opacity };
                }
            });
        });
        this.observer.set('scene.materialChannelPreviews', JSON.stringify(channelPreviews));

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

    private static rgbToHex(r: number, g: number, b: number): string {
        const toByte = (x: number) => Math.round(Math.max(0, Math.min(1, Number(x))) * 255);
        return '#' + [toByte(r), toByte(g), toByte(b)].map((n) => n.toString(16).padStart(2, '0')).join('');
    }

    private static hexToRgb(hex: string): { r: number; g: number; b: number } | null {
        const m = /^#([0-9A-Fa-f]{6})$/.exec(hex);
        if (!m) return null;
        const n = parseInt(m[1], 16);
        return { r: ((n >> 16) & 0xff) / 255, g: ((n >> 8) & 0xff) / 255, b: (n & 0xff) / 255 };
    }

    /** Export current viewer settings (camera, skybox, light, etc.) to a JSON file. */
    exportViewerSettings() {
        const options = this.observer.json() as Record<string, unknown>;
        const skybox = (options.skybox && typeof options.skybox === 'object') ? { ...(options.skybox as Record<string, unknown>) } : {};
        const light = (options.light && typeof options.light === 'object') ? { ...(options.light as Record<string, unknown>) } : {};
        if (skybox.backgroundColor && typeof skybox.backgroundColor === 'object' && !Array.isArray(skybox.backgroundColor)) {
            const c = skybox.backgroundColor as { r?: number; g?: number; b?: number };
            skybox.backgroundColor = Viewer.rgbToHex(Number(c.r ?? 0), Number(c.g ?? 0), Number(c.b ?? 0));
        }
        if (light.color && typeof light.color === 'object' && !Array.isArray(light.color)) {
            const c = light.color as { r?: number; g?: number; b?: number };
            light.color = Viewer.rgbToHex(Number(c.r ?? 0), Number(c.g ?? 0), Number(c.b ?? 0));
        }
        const data: Record<string, unknown> = {
            modelViewerSettingsVersion: 1,
            camera: options.camera,
            skybox,
            light,
            debug: options.debug,
            shadowCatcher: options.shadowCatcher,
            measure: options.measure,
            enableWebGPU: options.enableWebGPU
        };
        if (this.cameraControls.mode === 'orbit') {
            const p = this.cameraControls.getPosition();
            const f = this.cameraControls.getFocus();
            (data.camera as Record<string, unknown>).position = [p.x, p.y, p.z];
            (data.camera as Record<string, unknown>).focus = [f.x, f.y, f.z];
        }
        const json = JSON.stringify(data, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const filenames = this.observer.get('scene.filenames') as string[] | undefined;
        const baseName = (filenames && filenames.length > 0 && filenames[0])
            ? filenames[0].replace(/\.[^/.]+$/, '') || 'model-viewer'
            : 'model-viewer';
        a.download = `${baseName}.model-viewer-settings.json`;
        a.click();
        URL.revokeObjectURL(url);
    }

    private static readonly SETTINGS_APPLY_KEYS = ['camera', 'skybox', 'light', 'debug', 'shadowCatcher', 'measure', 'enableWebGPU', 'metadata'];
    private static readonly SETTINGS_FILTER_PATHS = ['skybox.options', 'debug.renderMode'];

    /** Reset viewer settings (camera, skybox, light, etc.) to defaults. Call before loading a new model so that if no settings file is found, defaults are shown. */
    private resetViewerSettingsToDefaults() {
        const o = this.observer;
        o.set('camera.fov', 40);
        o.set('camera.tonemapping', 'Linear');
        o.set('camera.pixelScale', 1);
        o.set('camera.multisample', true);
        o.set('camera.hq', true);
        o.set('camera.mode', 'orbit');
        o.set('skybox.value', this.skyboxUrls.has('Paul Lobe Haus') ? 'Paul Lobe Haus' : 'None');
        o.set('skybox.exposure', 0);
        o.set('skybox.rotation', 0);
        o.set('skybox.background', 'Solid Color');
        o.set('skybox.backgroundColor', { r: 134 / 255, g: 152 / 255, b: 174 / 255 });
        o.set('skybox.blur', 1);
        o.set('skybox.domeProjection.domeRadius', 20);
        o.set('skybox.domeProjection.tripodOffset', 0.1);
        o.set('light.enabled', true);
        o.set('light.color', { r: 1, g: 1, b: 1 });
        o.set('light.intensity', 1);
        o.set('light.follow', false);
        o.set('light.shadow', true);
        o.set('shadowCatcher.enabled', true);
        o.set('shadowCatcher.intensity', 0.4);
        o.set('shadowCatcher.heightOffset', 0);
        o.set('debug.renderMode', 'default');
        o.set('debug.stats', false);
        o.set('debug.wireframe', false);
        o.set('debug.wireframeColor', { r: 0, g: 0, b: 0 });
        o.set('debug.bounds', false);
        o.set('debug.skeleton', false);
        o.set('debug.axes', false);
        o.set('debug.grid', false);
        o.set('debug.normals', 0);
        o.set('measure.enabled', false);
        o.set('measure.unit', 'm');
        o.set('measure.unitScale', 1);
        o.set('measure.lastDistance', null);
        o.set('measure.pointCount', 0);
        o.set('measure.knownDistance', 0);
        this.measureStart = null;
        this.syncSkyboxAndLightFromObserver();
    }

    /** Apply a settings object (e.g. from model-viewer-settings.json) to the observer. */
    applyViewerSettings(data: Record<string, unknown>) {
        const filter = Viewer.SETTINGS_FILTER_PATHS;
        const colorPaths = ['skybox.backgroundColor', 'light.color', 'debug.wireframeColor'];
        const toRgb = (v: unknown): { r: number; g: number; b: number } | null => {
            if (typeof v === 'string') return Viewer.hexToRgb(v);
            if (v && typeof v === 'object' && !Array.isArray(v)) {
                const o = v as Record<string, unknown>;
                const r = Number(o.r), g = Number(o.g), b = Number(o.b);
                if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) return { r, g, b };
            }
            return null;
        };
        const loadRec = (path: string, value: unknown): void => {
            if (filter.indexOf(path) !== -1) return;
            if (colorPaths.indexOf(path) !== -1) {
                const rgb = toRgb(value);
                if (rgb) {
                    this.observer.set(path, rgb);
                    return;
                }
            }
            if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                const obj = value as Record<string, unknown>;
                const keys = path === '' ? Viewer.SETTINGS_APPLY_KEYS.filter((k) => obj[k] !== undefined) : Object.keys(obj);
                keys.forEach((k) => loadRec(path ? `${path}.${k}` : k, obj[k]));
            } else {
                if (path !== 'skybox.value' || value === 'None' || this.skyboxUrls.has(value as string)) {
                    this.observer.set(path, value);
                }
            }
        };
        try {
            loadRec('', data);
        } catch (_) { /* ignore */ }
    }

    /** Max (N) in candidate names: base.model-viewer-settings.json, (1)..(N). */
    private static readonly SETTINGS_CANDIDATE_VERSIONS = 20;

    /** Build candidate URLs for settings file: base.model-viewer-settings.json and base.model-viewer-settings(1).json … (N).json (Chrome adds (1) on re-download). */
    private static settingsUrlCandidatesForModelUrl(modelUrl: string): { url: string; version: number }[] {
        const out: { url: string; version: number }[] = [];
        try {
            const absoluteUrl =
                modelUrl.startsWith('http://') || modelUrl.startsWith('https://')
                    ? modelUrl
                    : new URL(modelUrl, typeof window !== 'undefined' ? window.location.href : 'http://localhost').href;
            const u = new URL(absoluteUrl);
            if (!u.protocol.startsWith('http')) return out;
            const pathParts = u.pathname.split('/').filter(Boolean);
            if (pathParts.length === 0) return out;
            const baseName = pathParts[pathParts.length - 1].replace(/\.[^/.]+$/, '') || pathParts[pathParts.length - 1];
            const dir = pathParts.slice(0, -1);
            out.push({ url: u.origin + '/' + dir.concat(`${baseName}.model-viewer-settings.json`).join('/'), version: 0 });
            for (let n = 1; n <= Viewer.SETTINGS_CANDIDATE_VERSIONS; n++) {
                out.push({ url: u.origin + '/' + dir.concat(`${baseName}.model-viewer-settings(${n}).json`).join('/'), version: n });
            }
            return out;
        } catch {
            return out;
        }
    }

    private static readonly SETTINGS_FETCH_TIMEOUT_MS = 5000;

    /** Match settings filename like baseName.model-viewer-settings.json or baseName.model-viewer-settings(1).json. Returns version (0 for base, N for (N)) or -1 if no match. */
    private static settingsVersionFromFilename(filename: string, baseName: string): number {
        const name = filename.split('/').pop() || '';
        if (name === `${baseName}.model-viewer-settings.json`) return 0;
        const m = name.match(new RegExp(`^${baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.model-viewer-settings\\((\\d+)\\)\\.json$`, 'i'));
        return m ? parseInt(m[1], 10) : -1;
    }

    /** Fetch settings file next to the model URL (same folder) or from dropped/selected files. Tries base and (1)..(N) names; applies the one with highest version number that exists. If none found, resets to defaults. */
    private tryFetchAndApplySettings(firstModelUrl: string, allFiles?: Array<{ url: string; filename?: string }>): Promise<void> {
        const firstModelFilename = allFiles?.find((f) =>
            (f.filename && this.isModelFilename(f.filename)) || (f.filename && this.isGSplatFilename(f.filename))
        )?.filename;
        const baseName = firstModelFilename ? firstModelFilename.replace(/\.[^/.]+$/, '').split('/').pop() || '' : '';

        const fromDroppedFiles = (): Promise<{ data: Record<string, unknown>; version: number } | null> => {
            if (!allFiles || !baseName) return Promise.resolve(null);
            const best: { file: { url: string }; version: number } | null = allFiles.reduce(
                (acc, f) => {
                    if (!f.filename) return acc;
                    const v = Viewer.settingsVersionFromFilename(f.filename, baseName);
                    if (v < 0) return acc;
                    if (!acc || v > acc.version) return { file: f, version: v };
                    return acc;
                },
                null as { file: { url: string }; version: number } | null
            );
            if (!best) return Promise.resolve(null);
            return fetch(best.file.url, { cache: 'no-store' })
                .then((res) => (res.ok ? res.json().then((data: Record<string, unknown>) => ({ data, version: best.version })) : null))
                .catch((): null => null);
        };

        const candidates = Viewer.settingsUrlCandidatesForModelUrl(firstModelUrl);
        if (candidates.length === 0) {
            return fromDroppedFiles().then((r) => {
                if (r) {
                    this.applyViewerSettings(r.data);
                    this.syncSkyboxAndLightFromObserver();
                } else {
                    this.observer.set('camera.position', null);
                    this.observer.set('camera.focus', null);
                    this.resetViewerSettingsToDefaults();
                }
            });
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), Viewer.SETTINGS_FETCH_TIMEOUT_MS);
        const fetchOne = (c: { url: string; version: number }): Promise<{ data: Record<string, unknown>; version: number } | null> =>
            fetch(c.url, { method: 'GET', signal: controller.signal, cache: 'no-store' })
                .then((res) => {
                    if (!res.ok) return null;
                    return res.json().then((data: Record<string, unknown>) => ({ data, version: c.version })).catch(() => null);
                })
                .catch((): null => null);

        return Promise.all([...candidates.map(fetchOne), fromDroppedFiles()])
            .then((results) => {
                const ok = results.filter((r): r is { data: Record<string, unknown>; version: number } => r != null && typeof (r as any).data === 'object');
                if (ok.length === 0) {
                    if (typeof console !== 'undefined' && console.warn) {
                        console.warn('[model-viewer] Settings file not found. Tried:', candidates.slice(0, 3).map((c) => c.url));
                    }
                    this.observer.set('camera.position', null);
                    this.observer.set('camera.focus', null);
                    this.resetViewerSettingsToDefaults();
                    return;
                }
                const best = ok.reduce((a, b) => (a.version >= b.version ? a : b));
                this.applyViewerSettings(best.data);
                this.syncSkyboxAndLightFromObserver();
                if (typeof console !== 'undefined' && console.debug) {
                    console.debug('[model-viewer] Applied settings from file (version', best.version, ')');
                }
            })
            .catch((err) => {
                if (typeof console !== 'undefined' && console.warn) {
                    console.warn('[model-viewer] Settings fetch failed:', err);
                }
                this.observer.set('camera.position', null);
                this.observer.set('camera.focus', null);
                this.resetViewerSettingsToDefaults();
            })
            .finally(() => clearTimeout(timeoutId));
    }

    /** Apply current observer skybox/light to the scene (e.g. after loading settings from file). */
    private syncSkyboxAndLightFromObserver() {
        const bgColor = this.observer.get('skybox.backgroundColor') as { r?: number; g?: number; b?: number } | undefined;
        if (bgColor && typeof bgColor === 'object' && [bgColor.r, bgColor.g, bgColor.b].every((x) => typeof x === 'number')) {
            this.setBackgroundColor({ r: Number(bgColor.r), g: Number(bgColor.g), b: Number(bgColor.b) });
        }
        const background = this.observer.get('skybox.background');
        if (typeof background === 'string') this.setSkyboxBackground(background);
        const lc = this.observer.get('light.color') as { r?: number; g?: number; b?: number } | undefined;
        if (lc && typeof lc === 'object' && [lc.r, lc.g, lc.b].every((x) => typeof x === 'number')) {
            this.setLightColor({ r: Number(lc.r), g: Number(lc.g), b: Number(lc.b) });
        }
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
        this.focus(false);
        this.fitCameraClipPlanes();
    }

    /** Reset the camera to default position (same as pressing R). */
    resetCamera() {
        this.cameraControls.reset(Vec3.ZERO, new Vec3(2, 2, 2));
    }

    // load gltf model given its url and list of external urls
    private loadGltf(gltfUrl: File, externalUrls: Array<File>, warnings: string[], onProgress?: (progress: number) => void) {
        return new Promise((resolve, reject) => {
            // provide buffer view callback so we can handle models compressed with MeshOptimizer
            // https://github.com/zeux/meshoptimizer
            const processBufferView = (
                gltfBuffer: any,
                buffers: Array<any>,
                continuation: (err: string, result: any) => void
            ) => {
                if (gltfBuffer.extensions && gltfBuffer.extensions.EXT_meshopt_compression) {
                    const extensionDef = gltfBuffer.extensions.EXT_meshopt_compression;

                    Promise.all([MeshoptDecoder.ready, buffers[extensionDef.buffer]]).then((promiseResult) => {
                        const buffer = promiseResult[1];

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

            const processImage = (gltfImage: any, continuation: (err: string, result: any) => void) => {
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

            const postProcessTexture = (gltfTexture: any, textureAsset: Asset) => {
                // Set max anisotropy only for textures that use linear filtering, as anisotropic
                // filtering only makes sense with linear filtering modes
                const texture = textureAsset.resource as Texture;
                if (texture.minFilter !== FILTER_NEAREST && texture.magFilter !== FILTER_NEAREST) {
                    texture.anisotropy = this.app.graphicsDevice.maxAnisotropy;
                }
            };

            const processBuffer = (gltfBuffer: any, continuation: (err: string, result: any) => void) => {
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

            const containerAsset = new Asset(gltfUrl.filename, 'container', gltfUrl, null, {
                // @ts-ignore TODO no definition in pc
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
    }

    private loadPly(url: File, externalUrls: Array<File>, onProgress?: (progress: number) => void) {
        const urls: any = {};
        externalUrls.forEach((url) => {
            urls[url.filename] = url.url;
        });
        return new Promise((resolve, reject) => {
            const asset = new Asset(url.filename, 'gsplat', url, null, {
                // @ts-ignore TODO no definition in pc
                mapUrl: mapUrl => urls[mapUrl]
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

    // load the list of urls.
    // urls can reference glTF files, glb files and skybox textures.
    // returns true if a model was loaded.
    loadFiles(files: Array<File>, resetScene = false) {
        // convert single url to list
        if (!Array.isArray(files)) {
            files = [files];
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

            this.observer.set('ui.spinner', true);
            this.observer.set('ui.loadProgress', 0);
            this.observer.set('ui.error', null);
            this.observer.set('ui.warnings', []);
            this.clearCta();

            // Defer load to next frame so the progress bar can paint at 0%
            requestAnimationFrame(() => {
            this.resetViewerSettingsToDefaults();
            const warnings: string[] = [];
            const modelFiles = files.filter((f) => this.isModelFilename(f.filename) || this.isGSplatFilename(f.filename));
            const total = modelFiles.length;
            const progressPerFile: number[] = new Array(total).fill(0);
            let lastProgressUpdate = 0;
            let lastProgressValue = 0;
            const PROGRESS_THROTTLE_MS = 80;
            const PROGRESS_MIN_DELTA = 1.5;

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

            let fallbackInterval: ReturnType<typeof setInterval> | null = null;
            const startFallbackProgress = () => {
                fallbackInterval = setInterval(() => {
                    const current = this.observer.get('ui.loadProgress') as number;
                    if (current >= 90) return;
                    this.observer.set('ui.loadProgress', Math.min(90, current + 3));
                }, 150);
            };
            const stopFallbackProgress = () => {
                if (fallbackInterval) {
                    clearInterval(fallbackInterval);
                    fallbackInterval = null;
                }
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
                this.observer.set('ui.error', err?.toString() || err);
            })
            .finally(() => {
                stopFallbackProgress();
                this.observer.set('ui.loadProgress', 100);
                setTimeout(() => {
                    this.observer.set('ui.spinner', false);
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
        this.dirtyWireframe = true;
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
            this.renderNextFrame();
        }
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

        this.renderNextFrame();
    }

    setCenterScene(value: boolean) {
        this.sceneRoot.setLocalPosition(0, 0, 0);

        // calculate scene bounds after first render in order to get accurate morph target and skinned bounds
        this.calcSceneBounds(this.sceneBounds);

        // offset scene geometry to place it at the origin
        if (value) {
            this.sceneRoot.setLocalPosition(
                -this.sceneBounds.center.x,
                -this.sceneBounds.getMin().y,
                -this.sceneBounds.center.z
            );
        }

        this.dirtyBounds = true;

        this.renderNextFrame();
    }

    setDebugStats(show: boolean) {
        this.miniStats.enabled = show;
        this.renderNextFrame();
    }

    setDebugWireframe(show: boolean) {
        this.showWireframe = show;
        this.dirtyWireframe = true;
        this.renderNextFrame();
    }

    setWireframeColor(color: { r: number; g: number; b: number }) {
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

    setFov(fov: number) {
        this.camera.camera.fov = fov;
        this.renderNextFrame();
    }

    setRenderMode(renderMode: string) {
        this.camera.camera.setShaderPass(renderMode !== 'default' ? `debug_${renderMode}` : 'forward');
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
        // update the orbit camera
        if (!this.xrMode?.active) {
            this.cameraControls.update(deltaTime);
        }

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
        document.querySelector('#panel-left').classList.add('no-cta');
        document.querySelector('#application-canvas').classList.add('no-cta');
        document.querySelector('.load-button-panel').classList.add('hide');
    }

    // add a loaded asset to the scene
    // asset is a container asset with renders and/or animations
    private addToScene(asset: Asset) {
        const resource = asset.resource as any;
        const meshesLoaded = resource.renders && resource.renders.length > 0;
        const animsLoaded = resource.animations && resource.animations.length > 0;
        const prevEntity: Entity = this.entities.length === 0 ? null : this.entities[this.entities.length - 1];

        let entity: Entity;

        // create entity
        if (!meshesLoaded && prevEntity && prevEntity.findComponent('render')) {
            entity = prevEntity;
        } else {
            if (asset.type === 'container') {
                // container/glb
                entity = resource.instantiateRenderEntity();
            } else {
                const unified = ((asset.file as any)?.filename ?? '').endsWith('lod-meta.json');

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
            this.sceneRoot.addChild(entity);
            this.shadowCatcher.onEntityAdded(entity);
        }

        // create animation component
        if (animsLoaded) {
            // append anim tracks to global list
            resource.animations.forEach((a: any) => {
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

        // if no meshes are currently loaded, then enable skeleton rendering so user can see something
        if (this.meshInstances.length === 0) {
            this.observer.set('debug.skeleton', true);
        }

        // update
        this.updateSceneStats();

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

    private onFrameRender() {
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
    }

    // generate and render debug elements on prerender
    private onPrerender() {
        if (this.firstFrame) {
            return;
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

            const v = new Vec3(
                this.dynamicSceneBounds.halfExtents.x * 2,
                this.dynamicSceneBounds.halfExtents.y * 2,
                this.dynamicSceneBounds.halfExtents.z * 2
            );
            this.observer.set('scene.bounds', v.toString());
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

            if (this.showSkeleton || this.showAxes) {
                this.entities.forEach((entity) => {
                    if (this.meshInstances.length === 0 || entity.findComponent('render')) {
                        this.debugSkeleton.generateSkeleton(
                            entity,
                            this.showSkeleton,
                            this.showAxes,
                            this.selectedNode
                        );
                    }
                });
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

                const v0 = new Vec3(0, 0, 0);
                const v1 = new Vec3(0, 0, 0);

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
        if (this.measureStart) {
            this.updateMeasurementOverlay();
        } else {
            if (this.measureSvgEl) this.measureSvgEl.style.display = 'none';
            if (this.measureLabelEl) this.measureLabelEl.style.display = 'none';
        }

        // fit camera planes to the scene
        this.fitCameraClipPlanes();

        this.shadowCatcher.onUpdate(this.dynamicSceneBounds);
    }

    private onPostrender() {
        if (this.firstFrame) {
            this.firstFrame = false;

            // reinit scene bounds after first render in order to get accurate morph target and skinned bounds
            this.initSceneBounds();
        }

        // resolve the (possibly multisampled) render target
        const rt = this.camera.camera.renderTarget;
        if (rt.samples > 1) {
            rt.resolve();
        }

        // perform multiframe update. returned flag indicates whether more frames
        // are needed.
        this.multiframeBusy = this.multiframe.update();
    }

    private onFrameend() {
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
