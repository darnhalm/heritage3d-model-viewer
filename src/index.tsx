import { Observer } from '@playcanvas/observer';
import { version as pcuiVersion, revision as pcuiRevision } from '@playcanvas/pcui/react';
import {
    basisInitialize,
    createGraphicsDevice,
    Vec3,
    WasmModule,
    version as engineVersion,
    revision as engineRevision
} from 'playcanvas';

import { initMaterials } from './material';
import { ObserverData, File as ViewerFile } from './types';
import initializeUI from './ui';
import Viewer from './viewer';
import './style.scss';
import { version as modelViewerVersion } from '../package.json';
import { DummyWebGPU } from './dummy-webgpu';

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

const findEmbedPlaceholder = (files: Array<{ url: string, filename?: string }>) => {
    const firstModel = files[0];
    if (!firstModel) return null;

    const candidates = getEmbedPlaceholderCandidates(firstModel);
    const tryCandidateAt = (index: number): Promise<string | null> => {
        if (index >= candidates.length) return Promise.resolve(null);
        return loadImage(candidates[index]).catch(() => tryCandidateAt(index + 1));
    };

    return tryCandidateAt(0);
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
    ui: {
        fullscreen: false,
        active: null,
        spinner: false,
        loadProgress: 0,
        error: null,
        language: 'en',
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
            modelInfo: true,
            controls: true,
            fullscreen: true,
            fit: true,
            reset: true
        }
    },
    camera: {
        fov: 40,
        tonemapping: 'Linear',
        pixelScale: 1,
        multisampleSupported: true,
        multisample: true,
        hq: true,
        mode: 'orbit',
        position: null,
        focus: null
    },
    skybox: {
        value: 'Paul Lobe Haus',
        options: JSON.stringify(['None'].concat(skyboxes.map(s => s.label)).map(l => ({ v: l, t: l }))),
        exposure: 0,
        rotation: 0,
        background: 'Solid Color',
        backgroundColor: { r: 134 / 255, g: 152 / 255, b: 174 / 255 },
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
        normals: 0,
        uvCheckerScale: 16,
        selectedUvSet: 0,
        withTextureOnly: false,
        texelDensityHeatmap: false
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
        hasGsplat: false
    },
    runtime: {
        activeDeviceType: '',
        viewportWidth: 0,
        viewportHeight: 0,
        xrSupported: false,
        xrActive: false
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
    dimensionBox: {
        enabled: false,
        size: [1, 1, 1],
        center: [0, 0, 0]
    },
    posteffects: {
        bloom: {
            enabled: false,
            intensity: 1.25,
            threshold: 0.25,
            blurAmount: 4
        },
        ssao: {
            enabled: false,
            radius: 0.2,
            intensity: 2,
            samples: 20
        },
        brightnessContrast: {
            enabled: false,
            brightness: 0,
            contrast: 0
        },
        hueSaturation: {
            enabled: false,
            hue: 0,
            saturation: 0
        },
        lut: {
            enabled: false,
            intensity: 1,
            fileName: null
        },
        fxaa: {
            enabled: false
        }
    },
    morphs: null,
    enableWebGPU: false,
    centerScene: false,
    // Метаданные убраны из плеера (источник правды — портал). Остаётся только
    // невидимый идентификатор для связи файла с записью инструмента.
    metadata: {
        identifier: ''
    }
};

/** Merge saved posteffects with defaults so keys (e.g. lut) exist after partial localStorage load. */
const mergePosteffectsDefaults = (observer: Observer) => {
    const d = observerData.posteffects;
    const stored = observer.get('posteffects') as ObserverData['posteffects'] | undefined;
    const mergeSec = <K extends keyof typeof d>(key: K) => ({
        ...d[key],
        ...(typeof stored?.[key] === 'object' && stored[key] !== null && !Array.isArray(stored[key])
            ? (stored[key] as object)
            : {})
    });
    if (!stored || typeof stored !== 'object') {
        observer.set('posteffects', d);
        return;
    }
    observer.set('posteffects', {
        bloom: mergeSec('bloom'),
        ssao: mergeSec('ssao'),
        brightnessContrast: mergeSec('brightnessContrast'),
        hueSaturation: mergeSec('hueSaturation'),
        lut: mergeSec('lut'),
        fxaa: mergeSec('fxaa')
    });
};

const saveOptions = (observer: Observer, name: string) => {
    const options = observer.json() as Partial<ObserverData>;
    const debug = options.debug ? {
        ...options.debug,
        alignmentMode: false
    } : options.debug;
    window.localStorage.setItem(`model-viewer-${name}`, JSON.stringify({
        camera: options.camera,
        skybox: options.skybox,
        light: options.light,
        debug,
        shadowCatcher: options.shadowCatcher,
        measure: options.measure,
        dimensionBox: options.dimensionBox,
        enableWebGPU: options.enableWebGPU,
        metadata: options.metadata ?? {},
        ui: { language: options.ui?.language }
    }));
};

const loadOptions = (observer: Observer, name: string, skyboxUrls: Map<string, string>) => {
    const filter = ['skybox.options', 'debug.renderMode', 'debug.alignmentMode'];

    const loadRec = (path: string, value: unknown) => {
        if (filter.indexOf(path) !== -1) {
            return;
        }

        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
            Object.keys(value as Record<string, unknown>).forEach((k) => {
                loadRec(path ? `${path}.${k}` : k, (value as Record<string, unknown>)[k]);
            });
        } else {
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
};

// print out versions of dependent packages
console.log(`HERITAGE3D Viewer v${modelViewerVersion} | PCUI v${pcuiVersion} (${pcuiRevision}) | PlayCanvas Engine v${engineVersion} (${engineRevision})`);

const main = () => {
    // initialize the apps state
    const observer: Observer = new Observer(observerData);

    // global url
    const url = new URL(window.location.href);
    const perfParam = url.searchParams.get('perf');
    const perfEnabled = perfParam !== null && perfParam.toLowerCase() !== '0' && perfParam.toLowerCase() !== 'false';

    const parseBool = (key: string, defaultValue: boolean) => {
        const value = url.searchParams.get(key);
        if (value === null) return defaultValue;
        return !['0', 'false', 'off', 'no'].includes(value.toLowerCase());
    };

    const embedEnabled = parseBool('embed', false);
    const embedPresetParam = url.searchParams.get('ui');
    const embedPreset = embedPresetParam === 'compact' || embedPresetParam === 'minimal' || embedPresetParam === 'full' ?
        embedPresetParam :
        'full';
    const embedDefaults = {
        full: { panel: true, poi: true, tour: true, measure: true, info: true, modelInfo: true, controls: true, fullscreen: true, fit: true, reset: true, animAutoplay: true, animControls: true },
        compact: { panel: false, poi: true, tour: true, measure: false, info: true, modelInfo: false, controls: true, fullscreen: true, fit: true, reset: true, animAutoplay: true, animControls: true },
        minimal: { panel: false, poi: true, tour: true, measure: false, info: false, modelInfo: false, controls: false, fullscreen: true, fit: false, reset: true, animAutoplay: true, animControls: false }
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
        panel: parseBool('panel', embedDefaults[embedPreset].panel),
        poi: parseBool('poi', embedDefaults[embedPreset].poi),
        tour: parseBool('tour', embedDefaults[embedPreset].tour),
        measure: parseBool('measure', embedDefaults[embedPreset].measure),
        info: parseBool('info', embedDefaults[embedPreset].info),
        modelInfo: parseBool('modelInfo', embedDefaults[embedPreset].modelInfo),
        controls: parseBool('controls', embedDefaults[embedPreset].controls),
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
        'controls',
        'fullscreen',
        'fit',
        'reset',
        'lang',
        'perf',
        'poster'
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
        mergePosteffectsDefaults(observer);

        observer.on('*:set', () => {
            saveOptions(observer, 'uistate');
        });
    }

    observer.set('ui.embed', embedConfig);
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

    // create react ui
    initializeUI(observer);

    document.addEventListener('fullscreenchange', () => {
        observer.set('ui.fullscreen', !!document.fullscreenElement);
    });

    // create the canvas
    const canvas = document.getElementById('application-canvas') as HTMLCanvasElement;

    // create the graphics device
    createGraphicsDevice(canvas, {
        deviceTypes: url.searchParams.has('webgpu') || observer.get('enableWebGPU') ? ['webgpu'] : [],
        antialias: false,
        depth: false,
        stencil: false,
        xrCompatible: true,
        powerPreference: 'high-performance'
    }).then((device) => {
        observer.set('runtime.activeDeviceType', device.deviceType);

        // create viewer instance
        const viewer = new Viewer(canvas, device, observer, skyboxUrls);

        // make available globally
        window.viewer = viewer;
        viewer.setPerfEnabled(perfEnabled);

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
                            const entry = Array.isArray(list)
                                ? list.find((p: { number?: number; trigger?: boolean }) => !p.trigger && p.number === number)
                                : null;
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
                            const entry = Array.isArray(list)
                                ? list.find((p: { systemName?: string }) => p.systemName === name)
                                : null;
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
                        window.parent?.postMessage({ type: 'trigger-note-set', id: activeId, note }, '*');
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
                    const id = typeof data.id === 'string' ? data.id : '';
                    const name = typeof data.name === 'string' ? data.name : '';
                    const position = data.position && typeof data.position === 'object'
                        ? { x: Number(data.position.x), y: Number(data.position.y), z: Number(data.position.z) }
                        : null;
                    if (id && position) {
                        viewer.moveMicrophone(id, name, position);
                    }
                    break;
                }
                case 'microphone:clear': {
                    viewer.clearMicrophones();
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
                window.parent?.postMessage({
                    type: 'poi-selected',
                    id: activeId,
                    number: poi?.number ?? null,
                    title: poi?.title ?? null,
                    description: poi?.description ?? null,
                    color: poi?.color ?? null,
                    trigger: poi?.trigger ?? false,
                    systemName: poi?.systemName ?? null,
                    tour: tourPlaying
                }, '*');
            } else {
                window.parent?.postMessage({
                    type: 'poi-cleared'
                }, '*');
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
                    window.postMessage(msg, '*');
                }
                // Хосту — только нота сэмплера (звук живёт на стороне сайта).
                // systemName необязателен: триггер может быть чисто анимационным.
                window.parent?.postMessage({
                    type: 'poi-selected',
                    id: hit.id,
                    trigger: true,
                    systemName: hit.systemName || null
                }, '*');
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
            window.parent?.postMessage({
                type: 'animation-time',
                clip,
                time,
                frame: Math.round(time * fps),
                fps,
                duration,
                progress
            }, '*');
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
                const placeholderUrl = posterParam
                    ? posterParam
                    : (embedConfig.enabled ? await findEmbedPlaceholder(files) : null);
                observer.set('ui.embed.placeholderUrl', placeholderUrl);
                if (embedConfig.enabled && !embedConfig.autoplay) {
                    observer.set('ui.embed.waiting', true);
                    window.startEmbedPlayback = () => {
                        observer.set('ui.embed.waiting', false);
                        window.startEmbedPlayback = undefined;
                        viewer.loadFiles(files);
                    };
                } else {
                    viewer.loadFiles(files);
                }
            }
        });
    });
};

// start main
main();
