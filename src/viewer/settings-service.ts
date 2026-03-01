import { Observer } from '@playcanvas/observer';
import { Vec3 } from 'playcanvas';

type Rgb = { r: number; g: number; b: number };

type ModelFile = { url: string; filename?: string };

type CameraControlsLike = {
    mode: 'orbit' | 'fly';
    getPosition: () => Vec3;
    getFocus: () => Vec3;
};

type SettingsServiceArgs = {
    observer: Observer;
    skyboxUrls: Map<string, string>;
    cameraControls: CameraControlsLike;
    isModelFilename: (filename: string) => boolean;
    isGSplatFilename: (filename: string) => boolean;
    setBackgroundColor: (color: Rgb) => void;
    setSkyboxBackground: (value: string) => void;
    setLightColor: (color: Rgb) => void;
    onMeasurementReset: () => void;
    getMaterialOverrides: () => Record<string, unknown>;
    applyMaterialOverrides: (overrides: Record<string, unknown>) => void;
    resetMaterialOverrides: () => void;
    getSceneTransform: () => Record<string, unknown>;
    applySceneTransform: (transform: Record<string, unknown>) => void;
    resetSceneTransform: () => void;
};

class SettingsService {
    private static readonly SETTINGS_APPLY_KEYS = ['camera', 'skybox', 'light', 'debug', 'shadowCatcher', 'measure', 'poi', 'enableWebGPU', 'metadata'];

    private static readonly SETTINGS_FILTER_PATHS = ['skybox.options', 'debug.renderMode'];

    private static readonly SETTINGS_CANDIDATE_VERSIONS = 20;

    private static readonly SETTINGS_FETCH_TIMEOUT_MS = 5000;

    private observer: Observer;

    private skyboxUrls: Map<string, string>;

    private cameraControls: CameraControlsLike;

    private isModelFilename: (filename: string) => boolean;

    private isGSplatFilename: (filename: string) => boolean;

    private setBackgroundColor: (color: Rgb) => void;

    private setSkyboxBackground: (value: string) => void;

    private setLightColor: (color: Rgb) => void;

    private onMeasurementReset: () => void;

    private getMaterialOverrides: () => Record<string, unknown>;

    private applyMaterialOverrides: (overrides: Record<string, unknown>) => void;

    private resetMaterialOverrides: () => void;

    private getSceneTransform: () => Record<string, unknown>;

    private applySceneTransform: (transform: Record<string, unknown>) => void;

    private resetSceneTransform: () => void;

    constructor(args: SettingsServiceArgs) {
        this.observer = args.observer;
        this.skyboxUrls = args.skyboxUrls;
        this.cameraControls = args.cameraControls;
        this.isModelFilename = args.isModelFilename;
        this.isGSplatFilename = args.isGSplatFilename;
        this.setBackgroundColor = args.setBackgroundColor;
        this.setSkyboxBackground = args.setSkyboxBackground;
        this.setLightColor = args.setLightColor;
        this.onMeasurementReset = args.onMeasurementReset;
        this.getMaterialOverrides = args.getMaterialOverrides;
        this.applyMaterialOverrides = args.applyMaterialOverrides;
        this.resetMaterialOverrides = args.resetMaterialOverrides;
        this.getSceneTransform = args.getSceneTransform;
        this.applySceneTransform = args.applySceneTransform;
        this.resetSceneTransform = args.resetSceneTransform;
    }

    private static rgbToHex(r: number, g: number, b: number): string {
        const toByte = (x: number) => Math.round(Math.max(0, Math.min(1, Number(x))) * 255);
        return `#${[toByte(r), toByte(g), toByte(b)].map(n => n.toString(16).padStart(2, '0')).join('')}`;
    }

    private static hexToRgb(hex: string): Rgb | null {
        const m = /^#([0-9a-f]{6})$/i.exec(hex);
        if (!m) return null;
        const n = parseInt(m[1], 16);
        return { r: ((n >> 16) & 0xff) / 255, g: ((n >> 8) & 0xff) / 255, b: (n & 0xff) / 255 };
    }

    exportViewerSettings() {
        const options = this.observer.json() as Record<string, unknown>;
        const skybox = (options.skybox && typeof options.skybox === 'object') ? { ...(options.skybox as Record<string, unknown>) } : {};
        const light = (options.light && typeof options.light === 'object') ? { ...(options.light as Record<string, unknown>) } : {};
        if (skybox.backgroundColor && typeof skybox.backgroundColor === 'object' && !Array.isArray(skybox.backgroundColor)) {
            const c = skybox.backgroundColor as { r?: number; g?: number; b?: number };
            skybox.backgroundColor = SettingsService.rgbToHex(Number(c.r ?? 0), Number(c.g ?? 0), Number(c.b ?? 0));
        }
        if (light.color && typeof light.color === 'object' && !Array.isArray(light.color)) {
            const c = light.color as { r?: number; g?: number; b?: number };
            light.color = SettingsService.rgbToHex(Number(c.r ?? 0), Number(c.g ?? 0), Number(c.b ?? 0));
        }
        const data: Record<string, unknown> = {
            modelViewerSettingsVersion: 1,
            camera: options.camera,
            skybox,
            light,
            debug: options.debug,
            shadowCatcher: options.shadowCatcher,
            measure: options.measure,
            poi: {
                list: (() => {
                    try {
                        const parsed = JSON.parse(String((options.poi as Record<string, unknown> | undefined)?.list ?? '[]'));
                        return Array.isArray(parsed) ? parsed : [];
                    } catch {
                        return [];
                    }
                })()
            },
            enableWebGPU: options.enableWebGPU
        };
        const materialOverrides = this.getMaterialOverrides();
        if (Object.keys(materialOverrides).length > 0) {
            data.materialOverrides = materialOverrides;
        }
        data.sceneTransform = this.getSceneTransform();
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
        const baseName = (filenames && filenames.length > 0 && filenames[0]) ?
            filenames[0].replace(/\.[^/.]+$/, '') || 'model-viewer' :
            'model-viewer';
        a.download = `${baseName}.model-viewer-settings.json`;
        a.click();
        URL.revokeObjectURL(url);
    }

    resetViewerSettingsToDefaults() {
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
        o.set('debug.selectedUvSet', 0);
        o.set('debug.texelDensityHeatmap', false);
        o.set('measure.enabled', false);
        o.set('measure.unit', 'm');
        o.set('measure.referenceRuler', false);
        o.set('measure.unitScale', 1);
        o.set('measure.lastDistance', null);
        o.set('measure.pointCount', 0);
        o.set('measure.knownDistance', 0);
        o.set('poi.enabled', false);
        o.set('poi.list', '[]');
        this.onMeasurementReset();
        this.resetMaterialOverrides();
        this.resetSceneTransform();
        this.syncSkyboxAndLightFromObserver();
    }

    applyViewerSettings(data: Record<string, unknown>) {
        const filter = SettingsService.SETTINGS_FILTER_PATHS;
        const blockedKeys = new Set(['__proto__', 'constructor', 'prototype']);
        const colorPaths = ['skybox.backgroundColor', 'light.color', 'debug.wireframeColor'];
        const numericPaths = new Set(['measure.unitScale', 'measure.knownDistance', 'camera.fov', 'skybox.exposure', 'debug.selectedUvSet']);
        const clampFinite = (value: unknown, min: number, max: number): number | null => {
            const n = Number(value);
            if (!Number.isFinite(n)) return null;
            return Math.max(min, Math.min(max, n));
        };
        const sanitizeLeaf = (path: string, value: unknown): unknown => {
            switch (path) {
                case 'measure.unitScale':
                    return clampFinite(value, 0.000001, 1000000);
                case 'measure.knownDistance':
                    return clampFinite(value, 0, 1000000000);
                case 'camera.fov':
                    return clampFinite(value, 35, 150);
                case 'skybox.exposure':
                    return clampFinite(value, -6, 6);
                case 'debug.selectedUvSet':
                    return clampFinite(value, 0, 7);
                case 'poi.list':
                    return Array.isArray(value) ? JSON.stringify(value) : '[]';
                default:
                    return value;
            }
        };
        const toRgb = (v: unknown): Rgb | null => {
            if (typeof v === 'string') return SettingsService.hexToRgb(v);
            if (v && typeof v === 'object' && !Array.isArray(v)) {
                const o = v as Record<string, unknown>;
                const r = Number(o.r);
                const g = Number(o.g);
                const b = Number(o.b);
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
                const keys = path === '' ? SettingsService.SETTINGS_APPLY_KEYS.filter(k => obj[k] !== undefined) : Object.keys(obj);
                keys.forEach((k) => {
                    if (blockedKeys.has(k)) return;
                    loadRec(path ? `${path}.${k}` : k, obj[k]);
                });
            } else {
                const safeValue = sanitizeLeaf(path, value);
                if (numericPaths.has(path) && safeValue == null) return;
                if (path !== 'skybox.value' || safeValue === 'None' || this.skyboxUrls.has(safeValue as string)) {
                    this.observer.set(path, safeValue);
                }
            }
        };
        try {
            loadRec('', data);
            const materialOverrides = data.materialOverrides;
            if (materialOverrides && typeof materialOverrides === 'object' && !Array.isArray(materialOverrides)) {
                this.applyMaterialOverrides(materialOverrides as Record<string, unknown>);
            }
            const sceneTransform = data.sceneTransform;
            if (sceneTransform && typeof sceneTransform === 'object' && !Array.isArray(sceneTransform)) {
                this.applySceneTransform(sceneTransform as Record<string, unknown>);
            }
        } catch (_) { /* ignore */ }
    }

    private static settingsUrlCandidatesForModelUrl(modelUrl: string): { url: string; version: number }[] {
        const out: { url: string; version: number }[] = [];
        try {
            const absoluteUrl =
                modelUrl.startsWith('http://') || modelUrl.startsWith('https://') ?
                    modelUrl :
                    new URL(modelUrl, typeof window !== 'undefined' ? window.location.href : 'http://localhost').href;
            const u = new URL(absoluteUrl);
            if (!u.protocol.startsWith('http')) return out;
            const pathParts = u.pathname.split('/').filter(Boolean);
            if (pathParts.length === 0) return out;
            const baseName = pathParts[pathParts.length - 1].replace(/\.[^/.]+$/, '') || pathParts[pathParts.length - 1];
            const dir = pathParts.slice(0, -1);
            out.push({ url: `${u.origin}/${dir.concat(`${baseName}.model-viewer-settings.json`).join('/')}`, version: 0 });
            for (let n = 1; n <= SettingsService.SETTINGS_CANDIDATE_VERSIONS; n++) {
                out.push({ url: `${u.origin}/${dir.concat(`${baseName}.model-viewer-settings(${n}).json`).join('/')}`, version: n });
            }
            return out;
        } catch {
            return out;
        }
    }

    private static settingsVersionFromFilename(filename: string, baseName: string): number {
        const name = filename.split('/').pop() || '';
        if (name === `${baseName}.model-viewer-settings.json`) return 0;
        const m = name.match(new RegExp(`^${baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.model-viewer-settings\\((\\d+)\\)\\.json$`, 'i'));
        return m ? parseInt(m[1], 10) : -1;
    }

    tryFetchAndApplySettings(firstModelUrl: string, allFiles?: ModelFile[]): Promise<void> {
        const firstModelFilename = allFiles?.find(f => (f.filename && this.isModelFilename(f.filename)) || (f.filename && this.isGSplatFilename(f.filename))
        )?.filename;
        const baseName = firstModelFilename ? firstModelFilename.replace(/\.[^/.]+$/, '').split('/').pop() || '' : '';

        const fromDroppedFiles = (): Promise<{ data: Record<string, unknown>; version: number } | null> => {
            if (!allFiles || !baseName) return Promise.resolve(null);
            const best: { file: { url: string }; version: number } | null = allFiles.reduce(
                (acc, f) => {
                    if (!f.filename) return acc;
                    const v = SettingsService.settingsVersionFromFilename(f.filename, baseName);
                    if (v < 0) return acc;
                    if (!acc || v > acc.version) return { file: f, version: v };
                    return acc;
                },
                null as { file: { url: string }; version: number } | null
            );
            if (!best) return Promise.resolve(null);
            return fetch(best.file.url, { cache: 'no-store' })
            .then(res => (res.ok ? res.json().then((data: Record<string, unknown>) => ({ data, version: best.version })) : null))
            .catch((): null => null);
        };

        const candidates = SettingsService.settingsUrlCandidatesForModelUrl(firstModelUrl);
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
        const timeoutId = setTimeout(() => controller.abort(), SettingsService.SETTINGS_FETCH_TIMEOUT_MS);
        const fetchOne = (c: { url: string; version: number }): Promise<{ data: Record<string, unknown>; version: number } | null> => fetch(c.url, { method: 'GET', signal: controller.signal, cache: 'no-store' })
        .then((res) => {
            if (!res.ok) return null;
            return res.json().then((data: Record<string, unknown>) => ({ data, version: c.version })).catch((): null => null);
        })
        .catch((): null => null);

        return Promise.all([...candidates.map(fetchOne), fromDroppedFiles()])
        .then((results) => {
            const ok = results.filter((r): r is { data: Record<string, unknown>; version: number } => r != null && typeof (r as any).data === 'object');
            if (ok.length === 0) {
                if (typeof console !== 'undefined' && console.warn) {
                    console.warn('[model-viewer] Settings file not found. Tried:', candidates.slice(0, 3).map(c => c.url));
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

    syncSkyboxAndLightFromObserver() {
        const bgColor = this.observer.get('skybox.backgroundColor') as { r?: number; g?: number; b?: number } | undefined;
        if (bgColor && typeof bgColor === 'object' && [bgColor.r, bgColor.g, bgColor.b].every(x => typeof x === 'number')) {
            this.setBackgroundColor({ r: Number(bgColor.r), g: Number(bgColor.g), b: Number(bgColor.b) });
        }
        const background = this.observer.get('skybox.background');
        if (typeof background === 'string') this.setSkyboxBackground(background);
        const lc = this.observer.get('light.color') as { r?: number; g?: number; b?: number } | undefined;
        if (lc && typeof lc === 'object' && [lc.r, lc.g, lc.b].every(x => typeof x === 'number')) {
            this.setLightColor({ r: Number(lc.r), g: Number(lc.g), b: Number(lc.b) });
        }
    }
}

export { SettingsService };
