import { Observer } from '@playcanvas/observer';
import { Vec3 } from 'playcanvas';

import { t } from '../i18n/translations';

type Rgb = { r: number; g: number; b: number };

type ModelFile = { url: string; filename?: string; sizeBytes?: number };

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
    private static readonly SETTINGS_APPLY_KEYS = ['camera', 'skybox', 'light', 'debug', 'shadowCatcher', 'measure', 'dimensionBox', 'poi', 'enableWebGPU'];

    private static readonly SETTINGS_FILTER_PATHS = ['skybox.options', 'debug.renderMode'];

    private static readonly SETTINGS_CANDIDATE_VERSIONS = 20;

    private static readonly SETTINGS_FETCH_TIMEOUT_MS = 30000;

    private static readonly SETTINGS_LOADING_BACKGROUND_TIMEOUT_MS = 2500;

    private static readonly SETTINGS_FILE_SIZE_LIMIT_BYTES = 10 * 1024 * 1024;

    private static readonly SETTINGS_HEAD_TIMEOUT_MS = 5000;

    private static readonly SETTINGS_MISS_CACHE_TTL_MS = 60 * 1000;

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

    private remoteSettingsMissCache = new Map<string, number>();

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

    private formatBytes(bytes: number): string {
        const mb = bytes / (1024 * 1024);
        if (mb < 1024) return `${mb.toFixed(1)} MB`;
        return `${(mb / 1024).toFixed(2)} GB`;
    }

    private formatSettingsLimitMessage(filename: string, sizeBytes: number): string {
        const lang = this.observer.get('ui.language') as string | undefined;
        return t('File "{filename}" ({size}) exceeds settings limit of 10 MB.', lang)
        .replace('{filename}', filename)
        .replace('{size}', this.formatBytes(sizeBytes));
    }

    private formatUnknownSettingsSizeMessage(filename: string): string {
        const lang = this.observer.get('ui.language') as string | undefined;
        return t('File "{filename}" was blocked because server does not provide size metadata. Limit: 10 MB.', lang)
        .replace('{filename}', filename);
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
        const headTimeoutId = setTimeout(() => headController.abort(), SettingsService.SETTINGS_HEAD_TIMEOUT_MS);
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
        const rangeTimeoutId = setTimeout(() => rangeController.abort(), SettingsService.SETTINGS_HEAD_TIMEOUT_MS);
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

    private async exceedsSettingsSizeLimit(url: string, filename: string, knownSizeBytes?: number): Promise<string | null> {
        if (typeof knownSizeBytes === 'number' && knownSizeBytes > SettingsService.SETTINGS_FILE_SIZE_LIMIT_BYTES) {
            return this.formatSettingsLimitMessage(filename, knownSizeBytes);
        }
        if (!/^https?:\/\//i.test(url)) {
            return null;
        }
        const resolvedBytes = await this.resolveRemoteFileSize(url);
        if (resolvedBytes === null) return null;
        if (resolvedBytes > SettingsService.SETTINGS_FILE_SIZE_LIMIT_BYTES) {
            return this.formatSettingsLimitMessage(filename, resolvedBytes);
        }
        return null;
    }

    private async fetchJsonWithSizeLimit(url: string, signal?: AbortSignal): Promise<Record<string, unknown> | null> {
        try {
            const response = await fetch(url, { method: 'GET', signal, cache: 'no-store' });
            if (!response.ok) return null;

            let size = 0;
            if (response.body?.getReader) {
                const reader = response.body.getReader();
                const chunks: Uint8Array[] = [];
                const readChunk = (): Promise<boolean | null> => reader.read().then(({ done, value }) => {
                    if (done) return true;
                    if (value) {
                        size += value.byteLength;
                        if (size > SettingsService.SETTINGS_FILE_SIZE_LIMIT_BYTES) {
                            return null;
                        }
                        chunks.push(value);
                    }
                    return readChunk();
                });
                const readResult = await readChunk();
                if (readResult === null) {
                    return null;
                }
                const merged = new Uint8Array(size);
                let offset = 0;
                chunks.forEach((chunk) => {
                    merged.set(chunk, offset);
                    offset += chunk.byteLength;
                });
                const text = new TextDecoder().decode(merged);
                return JSON.parse(text) as Record<string, unknown>;
            }

            const text = await response.text();
            size = new TextEncoder().encode(text).byteLength;
            if (size > SettingsService.SETTINGS_FILE_SIZE_LIMIT_BYTES) {
                return null;
            }
            return JSON.parse(text) as Record<string, unknown>;
        } catch {
            return null;
        }
    }

    private static getSolidBackgroundFromSettings(data: Record<string, unknown>): { background: string; backgroundColor: Rgb } | null {
        const skybox = data.skybox;
        if (!skybox || typeof skybox !== 'object' || Array.isArray(skybox)) return null;

        const skyboxData = skybox as Record<string, unknown>;
        if (skyboxData.background !== 'Solid Color') return null;

        const color = skyboxData.backgroundColor;
        if (typeof color === 'string') {
            const rgb = SettingsService.hexToRgb(color);
            return rgb ? { background: 'Solid Color', backgroundColor: rgb } : null;
        }

        if (color && typeof color === 'object' && !Array.isArray(color)) {
            const c = color as { r?: unknown; g?: unknown; b?: unknown };
            const r = Number(c.r);
            const g = Number(c.g);
            const b = Number(c.b);
            if ([r, g, b].every(Number.isFinite)) {
                return { background: 'Solid Color', backgroundColor: { r, g, b } };
            }
        }

        return null;
    }

    // Собирает объект настроек (без скачивания) — для экспорта на хост через postMessage.
    getSettingsData(): Record<string, unknown> {
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
            measure: (() => {
                const m = options.measure;
                // Калибровку/единицы/точки сохраняем, но активность режима — нет
                // (сессионный инструмент, не должен «висеть» в плеере).
                return m && typeof m === 'object' && !Array.isArray(m)
                    ? { ...(m as Record<string, unknown>), enabled: false }
                    : m;
            })(),
            dimensionBox: (() => {
                const d = options.dimensionBox;
                // Размеры/центр сохраняем, но включённость — нет (сессионный инструмент).
                return d && typeof d === 'object' && !Array.isArray(d)
                    ? { ...(d as Record<string, unknown>), enabled: false }
                    : d;
            })(),
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
        return data;
    }

    exportViewerSettings() {
        const data = this.getSettingsData();
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
        o.set('measure.mode', 'distance');
        o.set('measure.lastDistance', null);
        o.set('measure.lastAngle', null);
        o.set('measure.lastArea', null);
        o.set('measure.areaPlanarity', null);
        o.set('measure.pointCount', 0);
        o.set('measure.knownDistance', 0);
        o.set('measure.knownDistanceWarning', false);
        o.set('dimensionBox.enabled', false);
        o.set('dimensionBox.size', [1, 1, 1]);
        o.set('dimensionBox.center', [0, 0, 0]);
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
                case 'dimensionBox.size':
                case 'dimensionBox.center': {
                    if (!Array.isArray(value) || value.length < 3) return null;
                    const tuple = value.slice(0, 3).map((entry) => Number(entry));
                    return tuple.every((entry) => Number.isFinite(entry)) ? tuple : null;
                }
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
            // Бокс размеров — сессионный инструмент: НЕ восстанавливаем его включённым
            // из сохранённых настроек, иначе он «висит» поверх модели после загрузки.
            if (path === 'dimensionBox.enabled') {
                this.observer.set(path, false);
                return;
            }
            // Режим измерения — тоже сессионный инструмент: всегда выключен по
            // умолчанию, не восстанавливаем активность из настроек (иначе утекает
            // из админки в публичный плеер).
            if (path === 'measure.enabled') {
                this.observer.set(path, false);
                return;
            }
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
                if ((numericPaths.has(path) || path === 'dimensionBox.size' || path === 'dimensionBox.center') && safeValue == null) return;
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

    private resolveAbsoluteHttpUrl(url: string): string | null {
        try {
            const absoluteUrl =
                url.startsWith('http://') || url.startsWith('https://') ?
                    url :
                    new URL(url, typeof window !== 'undefined' ? window.location.href : 'http://localhost').href;
            const parsed = new URL(absoluteUrl);
            if (!parsed.protocol.startsWith('http')) return null;
            return parsed.href;
        } catch {
            return null;
        }
    }

    private shouldBypassSettingsMissCache(absoluteModelUrl: string): boolean {
        try {
            const parsed = new URL(absoluteModelUrl);
            for (const [key] of parsed.searchParams.entries()) {
                const normalized = key.toLowerCase();
                if (['v', 'ver', 'version', 't', 'ts', 'timestamp', 'cachebust', 'cb'].includes(normalized)) {
                    return true;
                }
            }
            return false;
        } catch {
            return true;
        }
    }

    private hasFreshSettingsMissCache(cacheKey: string): boolean {
        const expiresAt = this.remoteSettingsMissCache.get(cacheKey);
        if (!expiresAt) return false;
        if (Date.now() >= expiresAt) {
            this.remoteSettingsMissCache.delete(cacheKey);
            return false;
        }
        return true;
    }

    private markSettingsMissCache(cacheKey: string) {
        this.remoteSettingsMissCache.set(cacheKey, Date.now() + SettingsService.SETTINGS_MISS_CACHE_TTL_MS);
    }

    private clearSettingsMissCache(cacheKey: string) {
        this.remoteSettingsMissCache.delete(cacheKey);
    }

    preloadLoadingBackgroundFromSettings(firstModelUrl: string, allFiles?: ModelFile[]): Promise<void> {
        const firstModelFilename = allFiles?.find(f => (f.filename && this.isModelFilename(f.filename)) || (f.filename && this.isGSplatFilename(f.filename))
        )?.filename;
        const baseName = firstModelFilename ? firstModelFilename.replace(/\.[^/.]+$/, '').split('/').pop() || '' : '';

        const fromDroppedFiles = (): Promise<Record<string, unknown> | null> => {
            if (!allFiles || !baseName) return Promise.resolve(null);
            const best: { file: ModelFile; version: number } | null = allFiles.reduce(
                (acc, f) => {
                    if (!f.filename) return acc;
                    const v = SettingsService.settingsVersionFromFilename(f.filename, baseName);
                    if (v < 0) return acc;
                    if (!acc || v > acc.version) return { file: f, version: v };
                    return acc;
                },
                null as { file: ModelFile; version: number } | null
            );
            if (!best) return Promise.resolve(null);
            return this.fetchJsonWithSizeLimit(best.file.url);
        };

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), SettingsService.SETTINGS_LOADING_BACKGROUND_TIMEOUT_MS);
        const candidates = SettingsService.settingsUrlCandidatesForModelUrl(firstModelUrl);
        const fetchOne = (url: string) => this.fetchJsonWithSizeLimit(url, controller.signal);
        const sources = [fromDroppedFiles(), ...candidates.map(c => fetchOne(c.url))];

        return new Promise<void>((resolve) => {
            let pending = sources.length;
            let resolved = false;
            const finish = () => {
                if (resolved) return;
                resolved = true;
                clearTimeout(timeoutId);
                controller.abort();
                resolve();
            };
            setTimeout(finish, SettingsService.SETTINGS_LOADING_BACKGROUND_TIMEOUT_MS);

            sources.forEach((source) => {
                source
                .then((result) => {
                    if (resolved || !result) return;
                    const background = SettingsService.getSolidBackgroundFromSettings(result);
                    if (!background) return;

                    this.observer.set('skybox.background', background.background);
                    this.observer.set('skybox.backgroundColor', background.backgroundColor);
                    this.observer.set('ui.loadingBackgroundReady', true);
                    this.setBackgroundColor(background.backgroundColor);
                    finish();
                })
                .catch(() => {})
                .finally(() => {
                    pending--;
                    if (pending <= 0) finish();
                });
            });
        });
    }

    tryFetchAndApplySettings(firstModelUrl: string, allFiles?: ModelFile[]): Promise<void> {
        const firstModelFilename = allFiles?.find(f => (f.filename && this.isModelFilename(f.filename)) || (f.filename && this.isGSplatFilename(f.filename))
        )?.filename;
        const baseName = firstModelFilename ? firstModelFilename.replace(/\.[^/.]+$/, '').split('/').pop() || '' : '';
        const warnings: string[] = [];
        const cacheKey = this.resolveAbsoluteHttpUrl(firstModelUrl);
        const canUseMissCache = !!cacheKey && !this.shouldBypassSettingsMissCache(cacheKey);
        const skipRemoteLookup = !!cacheKey && canUseMissCache && this.hasFreshSettingsMissCache(cacheKey);

        const fromDroppedFiles = (): Promise<{ data: Record<string, unknown>; version: number } | null> => {
            if (!allFiles || !baseName) return Promise.resolve(null);
            const best: { file: ModelFile; version: number } | null = allFiles.reduce(
                (acc, f) => {
                    if (!f.filename) return acc;
                    const v = SettingsService.settingsVersionFromFilename(f.filename, baseName);
                    if (v < 0) return acc;
                    if (!acc || v > acc.version) return { file: f, version: v };
                    return acc;
                },
                null as { file: ModelFile; version: number } | null
            );
            if (!best) return Promise.resolve(null);
            const filename = best.file.filename ?? best.file.url;
            return this.exceedsSettingsSizeLimit(best.file.url, filename, best.file.sizeBytes)
            .then((limitWarning) => {
                if (limitWarning) {
                    warnings.push(limitWarning);
                    return null;
                }
                return this.fetchJsonWithSizeLimit(best.file.url)
                .then(data => (data ? { data, version: best.version } : null));
            })
            .catch((): null => null);
        };

        const candidates = SettingsService.settingsUrlCandidatesForModelUrl(firstModelUrl);
        if (candidates.length === 0 || skipRemoteLookup) {
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
        const fetchOne = (c: { url: string; version: number }): Promise<{ data: Record<string, unknown>; version: number } | null> => this.fetchJsonWithSizeLimit(c.url, controller.signal)
        .then((data) => {
            if (!data) return null;
            return { data, version: c.version };
        })
        .catch((): null => null);

        return Promise.all([...candidates.map(fetchOne), fromDroppedFiles()])
        .then((results) => {
            if (warnings.length > 0) {
                this.observer.set('ui.warnings', warnings);
            }
            const ok = results.filter((r): r is { data: Record<string, unknown>; version: number } => {
                if (!r || typeof r !== 'object') return false;
                const record = r as { data?: unknown; version?: unknown };
                return !!record.data && typeof record.data === 'object' && typeof record.version === 'number';
            });
            if (ok.length === 0) {
                if (cacheKey && canUseMissCache) {
                    this.markSettingsMissCache(cacheKey);
                }
                if (typeof console !== 'undefined' && console.warn) {
                    console.warn('[model-viewer] Settings file not found. Tried:', candidates.slice(0, 3).map(c => c.url));
                }
                this.observer.set('camera.position', null);
                this.observer.set('camera.focus', null);
                this.resetViewerSettingsToDefaults();
                return;
            }
            const best = ok.reduce((a, b) => (a.version >= b.version ? a : b));
            if (cacheKey && canUseMissCache) {
                this.clearSettingsMissCache(cacheKey);
            }
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
