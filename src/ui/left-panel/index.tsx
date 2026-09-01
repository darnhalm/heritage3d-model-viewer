import { Panel, Container, Button, Label, NumericInput, SelectInput, TextAreaInput, TextInput } from '@playcanvas/pcui/react';
import React from 'react';

import { postToViewerParent } from '../../embed-messaging';
import { persistRequestedBackend, GraphicsBackend } from '../../graphics-backend';
import { extract, isMobileLayout } from '../../helpers';
import { t } from '../../i18n/translations';
import { DEFAULT_POI_DURATION_SECONDS, DEFAULT_POI_HOLD_TIME_SECONDS } from '../../poi-defaults';
import { DEFAULT_THEME_COLOR } from '../../theme';
import { SetProperty, ObserverData, Option } from '../../types';
import { Detail, Select, Slider, Toggle, ColorPickerControl, Numeric, NakedSlider } from '../components';
import { hasSeenTour } from './tour-seen';

/**
 * Делители разрешения сцены.
 *
 * Дробные ступени взяты из пресетов FSR 1: там качество задают долей стороны — Ultra Quality
 * 77%, Quality 67%, Balanced 59%, Performance 50%. В делителях это 1.3, 1.5, 1.7 и 2. Целые
 * 4/8/16 оставлены как были: пользы в них немного, но на них удобно смотреть, во что упирается
 * сцена.
 *
 * Почему дробные вообще нужны: пиксели считаются по площади, поэтому шаг с 1 сразу на 2 — это
 * не «вдвое меньше работы», а вчетверо, и картинка проседает соответственно. 1.5 даёт 44%
 * пикселей — почти весь выигрыш при заметно меньшей потере чёткости.
 *
 * Значения строковые, и это не небрежность: `SelectInput` из pcui при `type='number'`
 * прогоняет выбранное через `parseInt(value, 10)`, то есть 1.5 превратилась бы в 1 и
 * переключатель бы просто отскакивал назад. Поэтому список строковый, а обратно в число
 * значение переводит уже обработчик.
 */
const PIXEL_SCALES: Option[] = [
    { v: '1', t: '1 — 100%' },
    { v: '1.3', t: '1.3 — 77%' },
    { v: '1.5', t: '1.5 — 67%' },
    { v: '1.7', t: '1.7 — 59%' },
    { v: '2', t: '2 — 50%' },
    { v: '4', t: '4 — 25%' },
    { v: '8', t: '8' },
    { v: '16', t: '16' }
];

type PoiItem = {
    id: string;
    number: number;
    title?: string;
    color?: string;
    description?: string;
    duration?: number;
    holdTime?: number;
    trigger?: boolean;
    systemName?: string;
    animClip?: string;
    animFrom?: number;
    animTo?: number;
    animFps?: number;
    camera?: unknown;
};

type SceneCameraOption = {
    name: string;
    path: string;
};

type ViewerApi = {
    exportViewerSettings?: () => void;
    graphicsBackend?: 'webgpu' | 'webgl';
    observer?: { get?: (path: string) => unknown, set?: (path: string, value: unknown) => void };
    cameraControls?: {
        mode?: string;
        getPosition: () => { x: number; y: number; z: number };
        getFocus: () => { x: number; y: number; z: number };
    };
    setObjectToCenter?: () => void;
    setObjectPivotToCenter?: () => void;
    resetObjectPivot?: () => void;
    resetObjectTransform?: () => void;
    frameScene?: () => void;
    resetCameraView?: () => void;
    setDimensionBoxFromModelBounds?: () => void;
    setDimensionBoxFittedToModel?: () => void;
    setStandardView?: (view: string) => void;
    setCameraProjection?: (ortho: boolean) => void;
    isOrthographic?: () => boolean;
    pulsePois?: () => void;
    exitTileDebugMode?: () => void;
    reorderPoi?: (sourceId: string, targetId: string) => void;
    setSelectedMaterialFactor?: (channel: 'metallic' | 'roughness' | 'opacity', value: number) => void;
    setSelectedDiffuseColor?: (value: { r: number; g: number; b: number }) => void;
    setSelectedSpecularColor?: (value: { r: number; g: number; b: number }) => void;
    updatePoiTitle?: (id: string, value: string) => void;
    updatePoiColor?: (id: string, hexColor: string) => void;
    updatePoiDescription?: (id: string, value: string) => void;
    capturePoiCameraView?: (id: string) => void;
    clearPoiCameraView?: (id: string) => void;
    updatePoiDuration?: (id: string, value: number) => void;
    updatePoiHoldTime?: (id: string, value: number) => void;
    updatePoiTrigger?: (id: string, value: boolean) => void;
    updatePoiSystemName?: (id: string, value: string) => void;
    updatePoiAnimClip?: (id: string, value: string) => void;
    updatePoiAnimFrom?: (id: string, value: number | null) => void;
    updatePoiAnimTo?: (id: string, value: number | null) => void;
    updatePoiAnimFps?: (id: string, value: number | null) => void;
    removePoi?: (id: string) => void;
};

const getViewer = (): ViewerApi | undefined => (window as Window & { viewer?: ViewerApi }).viewer;
const isHTMLElement = (value: EventTarget | null): value is HTMLElement => value instanceof HTMLElement;
const unitDisplayFactor = (unit: string | undefined) => (unit === 'mm' ? 1000 : (unit === 'cm' ? 100 : 1));
const safeUnitScale = (value: unknown) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : 1;
};
const sceneToDisplaySize = (sceneValue: number, unitScale: number, unit: string | undefined) => sceneValue * unitScale * unitDisplayFactor(unit);
const displayToSceneSize = (displayValue: number, unitScale: number, unit: string | undefined) => {
    const sceneValue = displayValue / unitDisplayFactor(unit) / unitScale;
    return Number.isFinite(sceneValue) && sceneValue > 0 ? sceneValue : 0.000001;
};
const parseVec3String = (value: unknown): [number, number, number] | null => {
    if (Array.isArray(value) && value.length >= 3) {
        const tuple = value.slice(0, 3).map(entry => Number(entry));
        return tuple.every(entry => Number.isFinite(entry)) ? tuple as [number, number, number] : null;
    }
    const matches = String(value ?? '').match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi);
    if (!matches || matches.length < 3) return null;
    const tuple = matches.slice(0, 3).map(entry => Number(entry));
    return tuple.every(entry => Number.isFinite(entry)) ? tuple as [number, number, number] : null;
};

const parseJsonArray = <T, >(raw: string | undefined, mapItem?: (value: unknown) => T | null): T[] => {
    try {
        const parsed = JSON.parse(raw ?? '[]');
        if (!Array.isArray(parsed)) return [];
        if (!mapItem) return parsed as T[];
        return parsed.map(mapItem).filter((value): value is T => value !== null);
    } catch {
        return [];
    }
};

const parseStringArray = (raw: string | undefined): string[] => parseJsonArray<string>(raw, value => (typeof value === 'string' ? value : null));

const parseStringArrayLoose = (raw: unknown): string[] => {
    if (Array.isArray(raw)) {
        return raw.filter((value): value is string => typeof value === 'string');
    }
    if (typeof raw === 'string') {
        return parseStringArray(raw);
    }
    return [];
};

const parseSceneCameras = (raw: string | undefined): SceneCameraOption[] => parseJsonArray<SceneCameraOption>(raw, (value) => {
    if (!value || typeof value !== 'object') return null;
    const candidate = value as { name?: unknown; path?: unknown };
    if (typeof candidate.name !== 'string' || typeof candidate.path !== 'string') return null;
    return { name: candidate.name, path: candidate.path };
});

const parseOptions = (raw: string | undefined): Option[] => parseJsonArray<Option>(raw, (value) => {
    if (!value || typeof value !== 'object') return null;
    const candidate = value as { v?: unknown; t?: unknown };
    if (typeof candidate.t !== 'string') return null;
    const v = candidate.v;
    if (typeof v === 'string' || typeof v === 'number' || v === null) {
        return { v: v as Option['v'], t: candidate.t };
    }
    return null;
});

const parseStringRecord = (raw: string | undefined): Record<string, string> => {
    try {
        const parsed = JSON.parse(raw ?? '{}');
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
        const out: Record<string, string> = {};
        Object.entries(parsed).forEach(([key, value]) => {
            if (typeof value === 'string') out[key] = value;
        });
        return out;
    } catch {
        return {};
    }
};

const parsePoiList = (raw: string | undefined): PoiItem[] => parseJsonArray<PoiItem>(raw, (value) => {
    if (!value || typeof value !== 'object') return null;
    const candidate = value as Record<string, unknown>;
    const id = candidate.id;
    const number = candidate.number;
    if ((typeof id !== 'string' && typeof id !== 'number') || typeof number !== 'number') return null;
    return {
        id: String(id),
        number,
        title: typeof candidate.title === 'string' ? candidate.title : undefined,
        color: typeof candidate.color === 'string' ? candidate.color : undefined,
        description: typeof candidate.description === 'string' ? candidate.description : undefined,
        duration: typeof candidate.duration === 'number' ? candidate.duration : undefined,
        holdTime: typeof candidate.holdTime === 'number' ? candidate.holdTime : undefined,
        trigger: typeof candidate.trigger === 'boolean' ? candidate.trigger : undefined,
        systemName: typeof candidate.systemName === 'string' ? candidate.systemName : undefined,
        animClip: typeof candidate.animClip === 'string' ? candidate.animClip : undefined,
        animFrom: typeof candidate.animFrom === 'number' ? candidate.animFrom : undefined,
        animTo: typeof candidate.animTo === 'number' ? candidate.animTo : undefined,
        animFps: typeof candidate.animFps === 'number' ? candidate.animFps : undefined,
        camera: candidate.camera
    };
});

const rgbToArr = (rgb: { r: number, g: number, b: number }) => [rgb.r, rgb.g, rgb.b, 1];
const arrToRgb = (arr: number[]) => ({ r: arr[0], g: arr[1], b: arr[2] });
const hexToArr = (hex?: string) => {
    const normalized = /^#[0-9a-f]{6}$/i.test(hex || '') ? String(hex) : '#000000';
    const value = parseInt(normalized.slice(1), 16);
    return [
        ((value >> 16) & 255) / 255,
        ((value >> 8) & 255) / 255,
        (value & 255) / 255,
        1
    ];
};
const arrToHex = (arr: number[]) => {
    const toByte = (value: number) => Math.max(0, Math.min(255, Math.round((value ?? 0) * 255)));
    return `#${[toByte(arr[0]), toByte(arr[1]), toByte(arr[2])].map(value => value.toString(16).padStart(2, '0')).join('')}`;
};
const texelDensityUnitLabel = (unit?: string) => (unit === 'mm' ? 'px/mm' : (unit === 'cm' ? 'px/cm' : 'px/m'));
const texelDensityDisplayValue = (td: number, unit?: string) => {
    const divisor = unit === 'mm' ? 1000 : (unit === 'cm' ? 100 : 1);
    const precision = unit === 'm' ? 0 : 2;
    return `${(td / divisor).toFixed(precision)} ${texelDensityUnitLabel(unit)}`;
};
const texelDensityAreaValue = (areaM2: number, unit?: string) => {
    const factor = unit === 'mm' ? 1000000 : (unit === 'cm' ? 10000 : 1);
    const suffix = unit === 'mm' ? 'mm²' : (unit === 'cm' ? 'cm²' : 'm²');
    const precision = unit === 'm' ? 2 : 0;
    return `${(areaM2 * factor).toFixed(precision)} ${suffix}`;
};

const exportViewerSettings = (observerData: ObserverData) => {
    const viewer = getViewer();
    if (viewer?.exportViewerSettings) {
        viewer.exportViewerSettings();
        return;
    }
    const camera: Record<string, unknown> = observerData.camera ? { ...observerData.camera } : {};
    if (viewer?.cameraControls?.mode === 'orbit') {
        const p = viewer.cameraControls.getPosition();
        const f = viewer.cameraControls.getFocus();
        camera.position = [p.x, p.y, p.z];
        camera.focus = [f.x, f.y, f.z];
    }
    const settings = {
        camera,
        skybox: observerData.skybox,
        light: observerData.light,
        debug: observerData.debug,
        shadowCatcher: observerData.shadowCatcher,
        measure: observerData.measure,
        metadata: observerData.metadata ?? {}
    };
    const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const filenames = parseStringArrayLoose(viewer?.observer?.get?.('scene.filenames'));
    const firstFilename = Array.isArray(filenames) && filenames.length > 0 ? filenames[0] : null;
    const baseName = firstFilename ? firstFilename.replace(/\.[^/.]+$/, '') || null : null;
    a.download = baseName ? `${baseName}.model-viewer-settings.json` : 'model-viewer-settings.json';
    a.click();
    URL.revokeObjectURL(url);
};

type LeftPanelTab = 'scene' | 'alignment' | 'materials' | 'poi';

// Метаданные (Dublin Core/ЕГРОКН/Госкаталог) убраны из плеера: источник правды —
// портал. Здесь остаётся лишь невидимый identifier (см. types/index defaults).

const toggleCollapsed = () => {
    const leftPanel = document.getElementById('panel-left');
    if (leftPanel) {
        leftPanel.classList.toggle('expanded');
    }
};

/**
 * Записать нынешнее расстояние камеры в один из пределов.
 *
 * Расстояние читается живым, из наблюдателя: React-обёртка pcui вешает `onClick` один раз при
 * монтировании и больше не переустанавливает, поэтому значение, захваченное при рендере, вечно
 * осталось бы нулевым — кнопка выглядела бы рабочей и ничего не записывала.
 *
 * Нажатие само включает ручной режим: просить сначала передвинуть переключатель, а потом
 * нажать кнопку — лишний шаг, а смысл нажатия и так однозначен.
 *
 * @param path - Путь настройки: ближний или дальний предел.
 */
const takeDistanceFromView = (path: 'camera.distanceMin' | 'camera.distanceMax') => {
    const observer = getViewer()?.observer;
    const distance = Number(observer?.get?.('runtime.cameraDistance')) || 0;
    if (!observer || distance <= 0) return;
    observer.set?.('camera.distanceLimitsManual', true);
    observer.set?.(path, distance);
};

class CameraPanel extends React.Component <{ observerData: ObserverData, setProperty: SetProperty }> {
    shouldComponentUpdate(nextProps: Readonly<{ observerData: ObserverData; setProperty: SetProperty; }>): boolean {
        const a = nextProps.observerData;
        const b = this.props.observerData;
        return a.ui?.language !== b.ui?.language ||
               a.scene?.cameras !== b.scene?.cameras ||
               a.scene?.selectedCamera !== b.scene?.selectedCamera ||
               a.camera?.fov !== b.camera?.fov ||
               a.camera?.tonemapping !== b.camera?.tonemapping ||
               a.camera?.pixelScale !== b.camera?.pixelScale ||
               a.camera?.easu !== b.camera?.easu ||
               a.camera?.sharpness !== b.camera?.sharpness ||
               a.camera?.dynamicScale !== b.camera?.dynamicScale ||
               a.camera?.distanceLimitsManual !== b.camera?.distanceLimitsManual ||
               a.camera?.distanceMin !== b.camera?.distanceMin ||
               a.camera?.distanceMax !== b.camera?.distanceMax ||
               a.camera?.multisampleSupported !== b.camera?.multisampleSupported ||
               a.camera?.multisample !== b.camera?.multisample ||
               a.camera?.hq !== b.camera?.hq ||
               a.runtime?.cameraDistance !== b.runtime?.cameraDistance ||
               a.runtime?.viewportWidth !== b.runtime?.viewportWidth ||
               a.runtime?.viewportHeight !== b.runtime?.viewportHeight;
    }

    render() {
        const props = this.props;
        const sceneCameras = parseSceneCameras(props.observerData.scene?.cameras);
        const cameraOptions = [{ v: 'viewer', t: 'Viewer' }].concat(
            sceneCameras.map(c => ({ v: c.path, t: c.name }))
        );
        const selectedCamera = props.observerData.scene?.selectedCamera || 'viewer';
        const isViewerCamera = selectedCamera === 'viewer';

        const lang = props.observerData?.ui?.language;
        return (
            <Panel headerText={t('Camera', lang)} id='camera-panel' flexShrink={'0'} flexGrow={'0'} collapsible={false}>
                <Select
                    selectKey={props.observerData.scene?.cameras}
                    label={t('Active Camera', lang)}
                    type='string'
                    options={cameraOptions}
                    value={selectedCamera}
                    setProperty={(value: string) => props.setProperty('scene.selectedCamera', value === 'viewer' ? '' : value)}
                    enabled={sceneCameras.length > 0} />
                <Slider
                    label={t('Fov', lang)}
                    precision={0}
                    min={35}
                    max={150}
                    value={props.observerData.camera.fov}
                    setProperty={(value: number) => props.setProperty('camera.fov', value)}
                    enabled={isViewerCamera} />
                <Select
                    label={t('Tonemap', lang)}
                    type='string'
                    options={['None', 'Linear', 'Neutral', 'Filmic', 'Hejl', 'ACES', 'ACES2'].map(v => ({ v, t: v }))}
                    value={props.observerData.camera.tonemapping}
                    setProperty={(value: string) => props.setProperty('camera.tonemapping', value)} />
                <Select
                    label={t('Pixel Scale', lang)}
                    value={String(props.observerData.camera.pixelScale)}
                    type='string'
                    options={PIXEL_SCALES}
                    setProperty={(value: string) => props.setProperty('camera.pixelScale', Number(value))} />
                {/* В подписи — только имя технологии: переводить EASU и RCAS не на что, своих
                    русских названий у них нет. Что они делают, объясняет подсказка. */}
                <span title={t('EASU: edge-preserving upscaling from AMD FidelityFX FSR 1.0. Works only when pixel scale is above one.', lang)} style={{ display: 'contents' }}>
                    <Toggle
                        label='EASU'
                        value={props.observerData.camera.easu !== false}
                        setProperty={(value: boolean) => props.setProperty('camera.easu', value)}
                    />
                </span>
                <span title={t('RCAS: contrast-adaptive sharpening from AMD FidelityFX FSR 1.0. Boosts edges and leaves flat areas untouched.', lang)} style={{ display: 'contents' }}>
                    <Slider
                        label='RCAS'
                        precision={2}
                        min={0}
                        max={1}
                        step={0.05}
                        value={props.observerData.camera.sharpness ?? 1}
                        setProperty={(value: number) => props.setProperty('camera.sharpness', value)} />
                </span>
                <Toggle
                    label={t('Lower while moving', lang)}
                    value={props.observerData.camera.dynamicScale !== false}
                    setProperty={(value: boolean) => props.setProperty('camera.dynamicScale', value)}
                />
                <Detail label={t('Viewport', lang)} value={`${props.observerData.runtime?.viewportWidth ?? 0} x ${props.observerData.runtime?.viewportHeight ?? 0}`} />
                <Toggle
                    label={t('Multisample', lang)}
                    value={props.observerData.camera.multisample}
                    enabled={props.observerData.camera.multisampleSupported}
                    setProperty={(value: boolean) => props.setProperty('camera.multisample', value)}
                />
                <Toggle
                    label={t('HD', lang)}
                    value={props.observerData.camera.hq}
                    setProperty={(value: boolean) => props.setProperty('camera.hq', value)}
                />
            </Panel>
        );
    }
}

class LimitsPanel extends React.Component <{ observerData: ObserverData, setProperty: SetProperty }> {
    shouldComponentUpdate(nextProps: Readonly<{ observerData: ObserverData; setProperty: SetProperty; }>): boolean {
        const a = nextProps.observerData;
        const b = this.props.observerData;
        return a.camera?.distanceLimitsManual !== b.camera?.distanceLimitsManual ||
               a.camera?.distanceMin !== b.camera?.distanceMin ||
               a.camera?.distanceMax !== b.camera?.distanceMax ||
               a.runtime?.cameraDistance !== b.runtime?.cameraDistance ||
               a.ui?.language !== b.ui?.language;
    }

    render() {
        const props = this.props;
        const lang = props.observerData?.ui?.language;
        return (
            <Panel headerText={t('Camera limits', lang)} id='limits-panel' flexShrink={'0'} flexGrow={'0'} collapsible={false}>
                <Toggle
                    label={t('Manual distance limits', lang)}
                    value={props.observerData.camera.distanceLimitsManual === true}
                    setProperty={(value: boolean) => props.setProperty('camera.distanceLimitsManual', value)}
                />
                <Numeric
                    label={t('Min distance', lang)}
                    value={props.observerData.camera.distanceMin ?? 0}
                    min={0.001}
                    max={1e9}
                    enabled={props.observerData.camera.distanceLimitsManual === true}
                    setProperty={(value: number) => props.setProperty('camera.distanceMin', value)}
                />
                <Numeric
                    label={t('Max distance', lang)}
                    value={props.observerData.camera.distanceMax ?? 0}
                    min={0.001}
                    max={1e9}
                    enabled={props.observerData.camera.distanceLimitsManual === true}
                    setProperty={(value: number) => props.setProperty('camera.distanceMax', value)}
                />
                <Detail label={t('Current distance', lang)} value={String(props.observerData.runtime?.cameraDistance ?? 0)} />
                <Container class='distance-from-view'>
                    <span title={t('Use the current camera distance as the near limit', lang)} style={{ display: 'contents' }}>
                        <Button
                            text={t('Near from view', lang)}
                            class='secondary'
                            onClick={() => takeDistanceFromView('camera.distanceMin')} />
                    </span>
                    <span title={t('Use the current camera distance as the far limit', lang)} style={{ display: 'contents' }}>
                        <Button
                            text={t('Far from view', lang)}
                            class='secondary'
                            onClick={() => takeDistanceFromView('camera.distanceMax')} />
                    </span>
                </Container>
            </Panel>
        );
    }
}

class SkyboxPanel extends React.Component <{ observerData: ObserverData, setProperty: SetProperty }> {
    shouldComponentUpdate(nextProps: Readonly<{ observerData: ObserverData; setProperty: SetProperty; }>): boolean {
        return JSON.stringify(nextProps.observerData.skybox) !== JSON.stringify(this.props.observerData.skybox) ||
               nextProps.observerData?.ui?.language !== this.props.observerData?.ui?.language;
    }

    render() {
        const props = this.props;
        const skybox = props.observerData.skybox;
        const lang = props.observerData?.ui?.language;

        return (
            <Panel headerText={t('Sky', lang)} id='sky-panel' flexShrink={'0'} flexGrow={'0'} collapsible={false}>
                <Select
                    label={t('Environment Map', lang)}
                    type='string'
                    options={parseOptions(skybox?.options)}
                    value={skybox?.value}
                    setProperty={(value: string) => props.setProperty('skybox.value', value)} />
                <Slider
                    label={t('Exposure', lang)}
                    value={skybox?.exposure ?? 0}
                    setProperty={(value: number) => props.setProperty('skybox.exposure', value)}
                    precision={2}
                    min={-6}
                    max={6}
                    enabled={skybox?.value !== 'None'} />
                <Slider
                    label={t('Rotation', lang)}
                    precision={0}
                    min={-180}
                    max={180}
                    value={skybox?.rotation ?? 0}
                    setProperty={(value: number) => props.setProperty('skybox.rotation', value)}
                    enabled={skybox?.value !== 'None'} />
                <Select
                    label={t('Background', lang)}
                    type='string'
                    options={['Solid Color', 'Infinite Sphere', 'Projective Dome', 'Projective Box'].map(v => ({ v, t: v }))}
                    value={skybox?.background}
                    setProperty={(value: string) => props.setProperty('skybox.background', value)}
                    enabled={skybox?.value !== 'None'} />
                <ColorPickerControl
                    label={t('Background Color', lang)}
                    value={rgbToArr(skybox?.backgroundColor ?? { r: 128 / 255, g: 128 / 255, b: 128 / 255 })}
                    setProperty={(value: number[]) => props.setProperty('skybox.backgroundColor', arrToRgb(value))}
                    enabled={skybox?.value === 'None' || skybox?.background === 'Solid Color'} />
                <Slider
                    label={t('Blur', lang)}
                    value={skybox?.blur ?? 1}
                    setProperty={(value: number) => props.setProperty('skybox.blur', value)}
                    enabled={skybox?.value !== 'None' && skybox?.background === 'Infinite Sphere'}
                    min={0}
                    max={5}
                    precision={0}
                    step={1} />
                <Numeric
                    label={t('Scale', lang)}
                    value={skybox?.domeProjection?.domeRadius ?? 20}
                    setProperty={(value: number) => props.setProperty('skybox.domeProjection.domeRadius', value)}
                    min={0}
                    max={1000}
                    enabled={skybox?.value !== 'None' && ['Projective Dome', 'Projective Box'].indexOf(skybox?.background ?? '') !== -1} />
                <Slider
                    label={t('Tripod Offset', lang)}
                    value={skybox?.domeProjection?.tripodOffset ?? 0.1}
                    setProperty={(value: number) => props.setProperty('skybox.domeProjection.tripodOffset', value)}
                    min={0}
                    max={1}
                    precision={2}
                    enabled={skybox?.value !== 'None' && ['Projective Dome', 'Projective Box'].indexOf(skybox?.background ?? '') !== -1} />
            </Panel>
        );
    }
}

class LightPanel extends React.Component <{ observerData: ObserverData, setProperty: SetProperty }> {
    shouldComponentUpdate(nextProps: Readonly<{ observerData: ObserverData; setProperty: SetProperty; }>): boolean {
        return JSON.stringify(nextProps.observerData.light) !== JSON.stringify(this.props.observerData.light) ||
               JSON.stringify(nextProps.observerData.shadowCatcher) !== JSON.stringify(this.props.observerData.shadowCatcher) ||
               nextProps.observerData?.ui?.language !== this.props.observerData?.ui?.language;
    }

    render() {
        const props = this.props;
        const light = props.observerData.light;
        const shadowCatcher = props.observerData.shadowCatcher;
        const lang = props.observerData?.ui?.language;

        return (
            <Panel headerText={t('Light', lang)} id='light-panel' flexShrink={'0'} flexGrow={'0'} collapsible={false}>
                <Toggle
                    label={t('Enabled', lang)}
                    value={light?.enabled ?? true}
                    setProperty={(value: boolean) => props.setProperty('light.enabled', value)} />
                <Toggle
                    label={t('Follow Camera', lang)}
                    value={light?.follow ?? false}
                    setProperty={(value: boolean) => props.setProperty('light.follow', value)} />
                <ColorPickerControl
                    label={t('Color', lang)}
                    value={rgbToArr(light?.color ?? { r: 1, g: 1, b: 1 })}
                    setProperty={(value: number[]) => props.setProperty('light.color', arrToRgb(value))} />
                <Slider
                    label={t('Intensity', lang)}
                    precision={2}
                    min={0}
                    max={6}
                    value={light?.intensity ?? 1}
                    setProperty={(value: number) => props.setProperty('light.intensity', value)} />
                <Toggle
                    label={t('Cast Shadow', lang)}
                    value={light?.shadow ?? true}
                    setProperty={(value: boolean) => props.setProperty('light.shadow', value)} />
                {/* Ловушка теней — горизонтальная плоскость по низу сцены. У тайлсета свой
                    рельеф, плоскость его режет, поэтому для тайлсетов её прячем целиком. */}
                {!props.observerData?.scene?.isTileset && (
                    <>
                        <Toggle
                            label={t('Shadow Catcher', lang)}
                            value={shadowCatcher?.enabled ?? true}
                            setProperty={(value: boolean) => props.setProperty('shadowCatcher.enabled', value)} />
                        <Slider
                            label={t('Catcher Intensity', lang)}
                            precision={2}
                            min={0}
                            max={1}
                            value={shadowCatcher?.intensity ?? 0.4}
                            setProperty={(value: number) => props.setProperty('shadowCatcher.intensity', value)} />
                        <Slider
                            label={t('Catcher Height', lang)}
                            precision={2}
                            min={-10}
                            max={10}
                            value={shadowCatcher?.heightOffset ?? 0}
                            setProperty={(value: number) => props.setProperty('shadowCatcher.heightOffset', value)}
                            enabled={shadowCatcher?.enabled ?? true} />
                    </>
                )}
            </Panel>
        );
    }
}

const MATERIAL_CHANNEL_ITEMS: Array<{ label: string; value: string }> = [
    { label: 'Base Color', value: 'albedo' },
    { label: 'Metalness', value: 'metalness' },
    { label: 'Roughness', value: 'gloss' },
    { label: 'Normal Map', value: 'world_normal' },
    { label: 'Specular F0', value: 'specularity' },
    { label: 'Emissive', value: 'emission' },
    { label: 'Lighting', value: 'lighting' },
    { label: 'AO', value: 'ao' },
    { label: 'Opacity', value: 'opacity' }
];

/** Формат текстуры канала, как его отдаёт вьюер. */
type ChannelFormat = { container: string; gpu: string; compressed: boolean; width: number; height: number };

/**
 * Разобрать карту форматов каналов из observer.
 *
 * @param raw - JSON, записанный вьюером.
 * @returns Формат по каналу; при неразборчивом значении — пустая карта.
 */
const parseFormatRecord = (raw: unknown): Record<string, ChannelFormat> => {
    try {
        const parsed = JSON.parse(String(raw ?? '{}'));
        return parsed && typeof parsed === 'object' ? parsed as Record<string, ChannelFormat> : {};
    } catch {
        return {};
    }
};

const renderModeCategories = (
    channelsWithTextures: Set<string>,
    _withTextureOnly: boolean,
    channelFilenames: Record<string, string>,
    channelFormats: Record<string, ChannelFormat>
): Array<{
    title: string;
    items: Array<{ label: string; value: string; filename?: string; format?: ChannelFormat }>;
}> => {
    const materialItems = MATERIAL_CHANNEL_ITEMS.map(item => ({
        ...item,
        filename: channelsWithTextures.has(item.value) ? (channelFilenames[item.value] || undefined) : undefined,
        format: channelsWithTextures.has(item.value) ? channelFormats[item.value] : undefined
    }));
    return [
        { title: 'RENDER', items: [{ label: 'Final Render', value: 'default' }] },
        { title: 'MATERIAL CHANNELS', items: materialItems },
        { title: 'UV', items: [{ label: 'UV Colored', value: 'uv0' }, { label: 'UV Checker', value: 'uv_checker' }] }
    ];
};

class SettingsPanel extends React.Component <{ observerData: ObserverData, setProperty: SetProperty }> {
    shouldComponentUpdate(nextProps: Readonly<{ observerData: ObserverData; setProperty: SetProperty; }>): boolean {
        return JSON.stringify(nextProps.observerData.debug) !== JSON.stringify(this.props.observerData.debug) ||
               JSON.stringify(nextProps.observerData.theme) !== JSON.stringify(this.props.observerData.theme) ||
               nextProps.observerData.runtime?.activeDeviceType !== this.props.observerData.runtime?.activeDeviceType ||
               nextProps.observerData.runtime?.requestedBackend !== this.props.observerData.runtime?.requestedBackend ||
               nextProps.observerData?.ui?.language !== this.props.observerData?.ui?.language;
    }

    render() {
        const props = this.props;
        const debugData = props.observerData.debug;
        // WebGPU support is roughly gated by the presence of navigator.gpu; disable that side otherwise.
        const webgpuAvailable = typeof navigator !== 'undefined' && 'gpu' in navigator;
        // Position the switch automatically to whatever backend is actually running. Read it live
        // from the viewer (runtime.activeDeviceType isn't reliably mirrored into React state);
        // before the device exists, fall back to the requested preference.
        const running = getViewer()?.graphicsBackend;
        const requested: GraphicsBackend = props.observerData.runtime?.requestedBackend ?? 'auto';
        const active: GraphicsBackend = running ??
            (requested === 'webgl' || !webgpuAvailable ? 'webgl' : 'webgpu');

        const lang = props.observerData?.ui?.language;

        // One switch, two positions. Switching the graphics backend restarts the device, so we
        // persist the device-local preference (never in settings JSON) and reload the viewer.
        const switchTo = (backend: GraphicsBackend) => {
            // Сверяемся с живым бэкендом в момент вызова, а не с `active` из замыкания.
            // pcui шлёт `change` и когда значение переключателя меняют программно, а меняем
            // мы его сами: до создания устройства тумблер показывает предполагаемый бэкенд, а
            // как только устройство завелось — реальный. Там, где вместо WebGPU стартует
            // WebGL 2 (Firefox и Safari без WebGPU, старый Chrome, заблокированная
            // видеокарта), значение переезжает, приходит `change`, а `active` в замыкании
            // остаётся прежним — и проверка ниже пропускала мнимое переключение: вьюер молча
            // записывал пользователю webgl и перезагружал страницу. Модель качалась дважды.
            const live = getViewer()?.graphicsBackend ?? active;
            if (backend === live) return;
            persistRequestedBackend(backend);
            props.setProperty('runtime.requestedBackend', backend);
            window.location.reload();
        };

        return (
            <Panel headerText={t('Settings', lang)} id='settings-panel' flexShrink={'0'} flexGrow={'0'} collapsible={false}>
                <ColorPickerControl
                    label={t('Theme color', lang)}
                    value={rgbToArr(props.observerData.theme?.primaryColor ?? DEFAULT_THEME_COLOR)}
                    setProperty={(value: number[]) => props.setProperty('theme.primaryColor', arrToRgb(value))} />
                <Toggle
                    label='WebGPU / WebGL 2'
                    value={active === 'webgl'}
                    setProperty={(value: boolean) => switchTo(value ? 'webgl' : 'webgpu')} />
                <Toggle
                    label={t('Grid', lang)}
                    value={debugData?.grid ?? false}
                    setProperty={(value: boolean) => props.setProperty('debug.grid', value)} />
                <Toggle
                    label={t('Axes', lang)}
                    value={debugData?.axes ?? false}
                    setProperty={(value: boolean) => props.setProperty('debug.axes', value)} />
                <Toggle
                    label={t('Skeleton', lang)}
                    value={debugData?.skeleton ?? false}
                    setProperty={(value: boolean) => props.setProperty('debug.skeleton', value)} />
                <Toggle
                    label={t('Bounds', lang)}
                    value={debugData?.bounds ?? false}
                    setProperty={(value: boolean) => props.setProperty('debug.bounds', value)} />
            </Panel>
        );
    }
}

class AlignmentPanel extends React.Component <{ observerData: ObserverData, setProperty: SetProperty, setAlignmentMode: (value: boolean) => void }, { flashLabel: string }> {
    state = { flashLabel: '' };

    private flashTimer: ReturnType<typeof setTimeout> | null = null;

    componentWillUnmount() {
        if (this.flashTimer) clearTimeout(this.flashTimer);
        this.flashTimer = null;
    }

    // Touch devices have no hover, so briefly surface the tool name after a tap.
    private flash = (label: string) => {
        this.setState({ flashLabel: label });
        if (this.flashTimer) clearTimeout(this.flashTimer);
        this.flashTimer = setTimeout(() => this.setState({ flashLabel: '' }), 1600);
    };

    shouldComponentUpdate(nextProps: Readonly<{ observerData: ObserverData; setProperty: SetProperty; setAlignmentMode: (value: boolean) => void }>, nextState: Readonly<{ flashLabel: string }>): boolean {
        if (nextState?.flashLabel !== this.state?.flashLabel) return true;
        const keys = ['debug', 'scene.selectedNode', 'scene.bounds', 'scene.boundsCenter', 'measure.unit', 'measure.unitScale', 'dimensionBox', 'helpers', 'ui.language'];
        return JSON.stringify(extract(nextProps.observerData, keys)) !== JSON.stringify(extract(this.props.observerData, keys));
    }

    render() {
        const props = this.props;
        const debugData = props.observerData.debug;
        const dimensionBox = props.observerData.dimensionBox;
        const lang = props.observerData?.ui?.language;

        const target = debugData?.alignmentTarget ?? 'model';
        const gizmoMode = debugData?.alignmentGizmoMode ?? 'rotate';

        // Compact icon button — a pcui Button; the name lives in a tooltip (span title, per the
        // popup-panel convention) and a tap also flashes the name below the toolbar for touch.
        const toolBtn = (opts: {
            icon: string;
            label: string;
            onClick: () => void;
            active?: boolean;
            extraClass?: string;
        }) => (
            <span key={opts.icon} title={opts.label} style={{ display: 'contents' }}>
                <Button
                    class={[
                        'secondary', 'alignment-icon-btn', opts.icon,
                        ...(opts.active ? ['active'] : []),
                        ...(opts.extraClass ? [opts.extraClass] : [])
                    ]}
                    onClick={() => {
                        this.flash(opts.label);
                        opts.onClick();
                    }} />
            </span>
        );

        // One labelled row per group: the caption column keeps the groups readable in a
        // narrow panel without hovering every icon. An empty group drops out entirely.
        const toolRow = (caption: string, rowClass: string, buttons: (React.ReactElement | null)[]) => {
            const items = buttons.filter(Boolean);
            return items.length ? (
                <Container class={['alignment-toolbar-row', rowClass]}>
                    <Label class='alignment-toolbar-caption' text={caption} />
                    <Container class='alignment-toolbar-group'>{items}</Container>
                </Container>
            ) : null;
        };

        return (
            <Container id='alignment-panel' class='tab-panel'>
                <Container class='alignment-toolbar'>
                    {toolRow(t('Object', lang), 'alignment-toolbar-row-target', [
                        toolBtn({
                            icon: 'align-icon-model',
                            label: t('Model', lang),
                            active: target === 'model',
                            onClick: () => {
                                props.setProperty('debug.alignmentTarget', 'model');
                                // Режим читаем живым: pcui привязывает onClick один раз при
                                // монтировании, поэтому значение из замыкания рендера устаревает.
                                if (getViewer()?.observer?.get?.('debug.alignmentGizmoMode') === 'resize') {
                                    props.setProperty('debug.alignmentGizmoMode', 'move');
                                }
                            }
                        }),
                        toolBtn({
                            icon: 'align-icon-helper',
                            label: t('Helper', lang),
                            active: target === 'helper',
                            onClick: () => {
                                props.setProperty('debug.alignmentTarget', 'helper');
                                props.setProperty('debug.alignmentGizmoMode', 'move');
                            }
                        }),
                        toolBtn({
                            icon: 'align-icon-box',
                            label: t('Box', lang),
                            active: target === 'box',
                            onClick: () => {
                                if (!dimensionBox?.initialized) {
                                    getViewer()?.setDimensionBoxFromModelBounds?.();
                                } else {
                                    props.setProperty('dimensionBox.enabled', true);
                                }
                                props.setProperty('debug.alignmentTarget', 'box');
                            }
                        }),
                        toolBtn({
                            icon: 'align-icon-pivot',
                            label: t('Object Pivot', lang),
                            active: target === 'pivot',
                            onClick: () => {
                                props.setProperty('debug.alignmentTarget', 'pivot');
                                // The pivot can only be translated, so never leave a
                                // rotate/resize mode selected — the gizmo would vanish.
                                props.setProperty('debug.alignmentGizmoMode', 'move');
                            }
                        })
                    ])}
                    {toolRow(t('Operation', lang), 'alignment-toolbar-row-operation', [
                        toolBtn({
                            icon: 'align-icon-move',
                            label: t('Move', lang),
                            active: gizmoMode === 'move',
                            onClick: () => props.setProperty('debug.alignmentGizmoMode', 'move')
                        }),
                        target === 'model' || target === 'box' ? toolBtn({
                            icon: 'align-icon-rotate',
                            label: t('Rotate', lang),
                            active: gizmoMode === 'rotate',
                            onClick: () => props.setProperty('debug.alignmentGizmoMode', 'rotate')
                        }) : null,
                        target === 'box' ? toolBtn({
                            icon: 'align-icon-scale',
                            label: t('Resize box', lang),
                            active: gizmoMode === 'resize',
                            onClick: () => props.setProperty('debug.alignmentGizmoMode', 'resize')
                        }) : null
                    ])}
                    {toolRow(t('Actions', lang), 'alignment-toolbar-row-actions', [
                        target === 'model' ? toolBtn({
                            icon: 'align-icon-object-center',
                            label: t('Object to Center', lang),
                            onClick: () => getViewer()?.setObjectToCenter?.()
                        }) : null,
                        target === 'model' || target === 'pivot' ? toolBtn({
                            icon: 'align-icon-pivot-center',
                            label: t('Pivot Point: Center to Object', lang),
                            onClick: () => getViewer()?.setObjectPivotToCenter?.()
                        }) : null,
                        target === 'pivot' ? toolBtn({
                            icon: 'align-icon-pivot-reset',
                            label: t('Reset Pivot', lang),
                            onClick: () => getViewer()?.resetObjectPivot?.()
                        }) : null,
                        target === 'box' ? toolBtn({
                            icon: 'align-icon-box-fit',
                            label: t('Fit Box to Model', lang),
                            onClick: () => getViewer()?.setDimensionBoxFittedToModel?.()
                        }) : null,
                        target === 'box' ? toolBtn({
                            icon: 'align-icon-box-bounds',
                            label: t('Box from Model Bounds', lang),
                            onClick: () => getViewer()?.setDimensionBoxFromModelBounds?.()
                        }) : null
                    ])}
                    {toolRow(t('Camera', lang), 'alignment-toolbar-row-camera', [
                        toolBtn({
                            icon: 'align-icon-fit',
                            label: t('Fit to Screen', lang),
                            onClick: () => getViewer()?.frameScene?.()
                        }),
                        toolBtn({
                            icon: 'align-icon-reset-view',
                            label: t('Reset View', lang),
                            onClick: () => getViewer()?.resetCameraView?.()
                        })
                    ])}
                    {toolRow(t('Scene', lang), 'alignment-toolbar-row-scene', [
                        toolBtn({
                            icon: 'align-icon-reset',
                            label: t('Reset Object', lang),
                            extraClass: 'alignment-reset',
                            onClick: () => getViewer()?.resetObjectTransform?.()
                        })
                    ])}
                </Container>
                {/* Ternary → null (not `&&` → '') so pcui Container never receives a falsy child. */}
                {this.state.flashLabel ?
                    <Label class='alignment-tool-caption' text={this.state.flashLabel} /> :
                    null}
            </Container>
        );
    }
}

class LeftPanel extends React.Component <{ observerData: ObserverData, setProperty: SetProperty }> {
    state: { tab: LeftPanelTab, poiSaved: boolean, draggingPoiId: string | null, dragOverPoiId: string | null, dragX: number, dragY: number, activePoiCardId: string | null } = {
        tab: 'scene',
        poiSaved: false,
        draggingPoiId: null,
        dragOverPoiId: null,
        dragX: 0,
        dragY: 0,
        activePoiCardId: null
    };

    private collapseHandler: (() => void) | null = null;

    private poiSaveTimer: ReturnType<typeof setTimeout> | null = null;

    private poiPointerMoveHandler: ((event: MouseEvent) => void) | null = null;

    private poiPointerUpHandler: ((event: MouseEvent) => void) | null = null;

    private previousAlignmentAxes = false;

    private previousAlignmentGrid = false;

    private previousAlignmentVisibilitySaved = false;

    shouldComponentUpdate(nextProps: Readonly<{ observerData: ObserverData; setProperty: SetProperty; }>, nextState: { tab: LeftPanelTab, poiSaved: boolean, draggingPoiId: string | null, dragOverPoiId: string | null, dragX: number, dragY: number, activePoiCardId: string | null }): boolean {
        const keys = ['camera', 'debug', 'measure.unit', 'scene.cameras', 'scene.selectedCamera', 'scene.selectedNode', 'scene.hasGsplat', 'scene.unlit', 'scene.isTileset', 'scene.tilesetLit', 'scene.tilesetMaxDepth', 'scene.materialChannelsWithTextures', 'scene.materialChannelFilenames', 'scene.materialChannelFormats', 'scene.selectedMaterialNames', 'scene.selectedMaterialFactors', 'scene.selectedMaterialColor', 'scene.selectedSpecularColor', 'scene.availableUvSets', 'scene.variants', 'scene.variant', 'scene.texelDensitySummary', 'scene.texelDensityReport', 'runtime', 'poi', 'skybox', 'light', 'shadowCatcher', 'ui.language', 'animation.list'];
        const a = extract(nextProps.observerData, keys);
        const b = extract(this.props.observerData, keys);
        return JSON.stringify(a) !== JSON.stringify(b) ||
            nextState.tab !== this.state.tab ||
            nextState.poiSaved !== this.state.poiSaved ||
            nextState.draggingPoiId !== this.state.draggingPoiId ||
            nextState.dragOverPoiId !== this.state.dragOverPoiId ||
            nextState.dragX !== this.state.dragX ||
            nextState.dragY !== this.state.dragY ||
            nextState.activePoiCardId !== this.state.activePoiCardId;
    }

    componentDidMount(): void {
        this.collapseHandler = () => {
            toggleCollapsed();
            const leftPanel = document.getElementById('panel-left');
            const isExpanded = leftPanel?.classList.contains('expanded') ?? false;
            if (!isExpanded && (this.props.observerData?.debug?.alignmentMode ?? false)) {
                this.setAlignmentMode(false);
            } else if (isExpanded && this.state.tab === 'alignment' && !(this.props.observerData?.debug?.alignmentMode ?? false)) {
                this.setAlignmentMode(true);
            }
            if (!isExpanded && (this.props.observerData?.poi?.enabled ?? false)) {
                this.props.setProperty('poi.enabled', false);
            } else if (isExpanded && this.state.tab === 'poi' && !(this.props.observerData?.poi?.enabled ?? false)) {
                this.props.setProperty('poi.enabled', true);
                getViewer()?.pulsePois?.();
            }
            if (!isExpanded && this.state.tab === 'materials') {
                getViewer()?.exitTileDebugMode?.();
            }
            // First time the user opens the panel — run the guided tour.
            // Сам тур тянет driver.js и лежит отдельным чанком: грузим его только когда
            // он и правда понадобится, а «уже видели» проверяем без загрузки.
            if (isExpanded && !this.props.observerData?.ui?.embed?.enabled && !hasSeenTour()) {
                const lang = this.props.observerData?.ui?.language;
                import('./tour').then(m => m.maybeAutoStartTour(lang)).catch(() => {});
            }
        };
        document.getElementById('panel-toggle')?.addEventListener('click', this.collapseHandler);
        document.getElementById('title')?.addEventListener('click', this.collapseHandler);
        this.poiPointerMoveHandler = (event: MouseEvent) => {
            if (!this.state.draggingPoiId) {
                return;
            }
            const targetId = this.getPoiDropTarget(event.clientY);
            if (targetId !== this.state.dragOverPoiId || event.clientX !== this.state.dragX || event.clientY !== this.state.dragY) {
                this.setState({ dragOverPoiId: targetId, dragX: event.clientX, dragY: event.clientY });
            }
        };
        this.poiPointerUpHandler = (event: MouseEvent) => {
            if (!this.state.draggingPoiId) {
                return;
            }
            const sourceId = this.state.draggingPoiId;
            const targetId = this.getPoiDropTarget(event.clientY);
            if (sourceId && targetId && sourceId !== targetId) {
                getViewer()?.reorderPoi?.(sourceId, targetId);
            }
            this.setState({ draggingPoiId: null, dragOverPoiId: null, dragX: 0, dragY: 0 });
        };
        document.addEventListener('mousemove', this.poiPointerMoveHandler);
        document.addEventListener('mouseup', this.poiPointerUpHandler);
    }

    componentWillUnmount(): void {
        if (this.state.tab === 'materials') getViewer()?.exitTileDebugMode?.();
        if (this.poiSaveTimer) {
            clearTimeout(this.poiSaveTimer);
        }
        if (this.poiPointerMoveHandler) {
            document.removeEventListener('mousemove', this.poiPointerMoveHandler);
        }
        if (this.poiPointerUpHandler) {
            document.removeEventListener('mouseup', this.poiPointerUpHandler);
        }
        if (this.collapseHandler) {
            document.getElementById('panel-toggle')?.removeEventListener('click', this.collapseHandler);
            document.getElementById('title')?.removeEventListener('click', this.collapseHandler);
        }
    }

    componentDidUpdate(_: Readonly<{ observerData: ObserverData; setProperty: SetProperty; }>, prevState: { tab: LeftPanelTab, poiSaved: boolean, draggingPoiId: string | null, dragOverPoiId: string | null, dragX: number, dragY: number, activePoiCardId: string | null }) {
        if (this.props.observerData?.ui?.embed?.enabled && this.state.tab !== 'scene') {
            this.setState({ tab: 'scene' });
            return;
        }

        if (prevState.tab === this.state.tab) {
            return;
        }

        if (prevState.tab === 'materials' && this.state.tab !== 'materials') {
            getViewer()?.exitTileDebugMode?.();
        }

        const poiEnabled = this.props.observerData?.poi?.enabled ?? false;
        if (this.state.tab === 'poi' && !poiEnabled) {
            this.props.setProperty('poi.enabled', true);
        } else if (prevState.tab === 'poi' && this.state.tab !== 'poi' && poiEnabled) {
            this.props.setProperty('poi.enabled', false);
        }

        if (this.state.tab === 'alignment' && prevState.tab !== 'alignment') {
            this.setAlignmentMode(true);
        } else if (prevState.tab === 'alignment' && this.state.tab !== 'alignment') {
            this.setAlignmentMode(false);
        }
    }

    handlePoiSave = () => {
        this.setState({ poiSaved: true });
        if (this.poiSaveTimer) {
            clearTimeout(this.poiSaveTimer);
        }
        this.poiSaveTimer = setTimeout(() => this.setState({ poiSaved: false }), 2000);
    };

    handlePoiPointerDown = (id: string, event: React.MouseEvent<HTMLDivElement>) => {
        if (event.button !== 0) {
            return;
        }
        const target = isHTMLElement(event.target) ? event.target : null;
        if (target?.closest('input, button, .pcui-color-picker, .pcui-text-input, .pcui-slider, .pcui-numeric-input')) {
            return;
        }
        event.preventDefault();
        this.props.setProperty('poi.activeId', id);
        this.setState({ draggingPoiId: id, dragOverPoiId: null, dragX: event.clientX, dragY: event.clientY, activePoiCardId: id });
    };

    handlePoiCardClick = (id: string) => {
        this.props.setProperty('poi.activeId', id);
        if (this.state.activePoiCardId !== id) {
            this.setState({ activePoiCardId: id });
        }
    };

    private getPoiDropTarget(clientY: number) {
        if (!this.state.draggingPoiId) {
            return null;
        }

        const items = Array.from(document.querySelectorAll<HTMLElement>('.poi-list-item[data-poi-id]'));
        let bestId: string | null = null;
        let bestDistance = Number.POSITIVE_INFINITY;

        items.forEach((item) => {
            const poiId = item.dataset.poiId ?? null;
            if (!poiId || poiId === this.state.draggingPoiId) {
                return;
            }

            const rect = item.getBoundingClientRect();
            const centerY = rect.top + rect.height / 2;
            const distance = Math.abs(clientY - centerY);
            if (distance < bestDistance) {
                bestDistance = distance;
                bestId = poiId;
            }
        });

        return bestId;
    }

    private setAlignmentMode = (value: boolean) => {
        const debugData = this.props.observerData.debug;

        if (value) {
            if (!this.previousAlignmentVisibilitySaved) {
                this.previousAlignmentAxes = debugData?.axes ?? false;
                this.previousAlignmentGrid = debugData?.grid ?? false;
                this.previousAlignmentVisibilitySaved = true;
            }
            this.props.setProperty('debug.alignmentMode', true);
            this.props.setProperty('debug.grid', true);
            this.props.setProperty('debug.axes', true);
            return;
        }

        this.props.setProperty('debug.alignmentMode', false);
        this.props.setProperty('debug.grid', this.previousAlignmentVisibilitySaved ? this.previousAlignmentGrid : false);
        this.props.setProperty('debug.axes', this.previousAlignmentVisibilitySaved ? this.previousAlignmentAxes : false);
        this.previousAlignmentVisibilitySaved = false;
    };

    render() {
        const { tab, draggingPoiId, dragOverPoiId, dragX, dragY } = this.state;
        const { observerData, setProperty } = this.props;
        const lang = observerData?.ui?.language;
        const animTracks: string[] = (() => {
            try {
                const l = JSON.parse(observerData?.animation?.list ?? '[]'); return Array.isArray(l) ? l.filter((s: unknown) => typeof s === 'string' && s !== 'ALL_TRACKS') : [];
            } catch {
                return [];
            }
        })();
        const embedEnabled = !!observerData?.ui?.embed?.enabled;
        const embedPreset = observerData?.ui?.embed?.preset;
        // Unlit-сцена (KHR_materials_unlit или unlit-тайлсет фотограмметрии) не затеняется
        // светом, поэтому раздел света для неё скрыт. Окружение при этом остаётся.
        const unlitScene = observerData?.scene?.unlit === true ||
            (!!observerData?.scene?.isTileset && observerData?.scene?.tilesetLit === false);
        const showMaterialsTab = !embedEnabled;
        const tabLabels: Record<LeftPanelTab, string> = {
            scene: t('Settings', lang),
            alignment: t('Object Alignment', lang),
            materials: t('Materials', lang),
            poi: t('POI', lang)
        };
        const activePoiCardId = observerData?.poi?.activeId || this.state.activePoiCardId;
        const texelDensityShortValue = (() => {
            const summary = observerData?.scene?.texelDensitySummary || 'n/a';
            return summary.split('|')[0]?.trim() || summary;
        })();
        const selectedMaterialFactors = observerData?.scene?.selectedMaterialFactors;
        const hasSelectedObject = !!observerData?.scene?.selectedNode?.path;
        const materialFactorRows = [
            { key: 'metallic', label: t('Metallic', lang), value: selectedMaterialFactors?.metallicPercent },
            { key: 'roughness', label: t('Roughness', lang), value: selectedMaterialFactors?.roughnessPercent },
            { key: 'opacity', label: t('Opacity', lang), value: selectedMaterialFactors?.opacityPercent }
        ].filter(item => item.value !== null && item.value !== undefined);
        const materialFactorByRenderMode: Record<string, { key: 'metallic' | 'roughness' | 'opacity', label: string, value: number | null | undefined }> = {
            metalness: { key: 'metallic', label: t('Metallic', lang), value: selectedMaterialFactors?.metallicPercent },
            gloss: { key: 'roughness', label: t('Roughness', lang), value: selectedMaterialFactors?.roughnessPercent },
            opacity: { key: 'opacity', label: t('Opacity', lang), value: selectedMaterialFactors?.opacityPercent }
        };
        const selectedMaterialColor = observerData?.scene?.selectedMaterialColor;
        const selectedSpecularColor = observerData?.scene?.selectedSpecularColor;
        const setSelectedMaterialFactor = (channel: 'metallic' | 'roughness' | 'opacity', value: number) => {
            getViewer()?.setSelectedMaterialFactor?.(channel, value);
        };
        const setSelectedDiffuseColor = (value: number[]) => {
            getViewer()?.setSelectedDiffuseColor?.(arrToRgb(value));
        };
        const setSelectedSpecularColor = (value: number[]) => {
            getViewer()?.setSelectedSpecularColor?.(arrToRgb(value));
        };
        const materialActionButton = (label: string, selected: boolean, onClick: () => void, classes: string[] = []) => (
            <button
                type='button'
                className={['materials-layer-item', ...classes, ...(selected ? ['selected'] : [])].join(' ')}
                onClick={onClick}
            >
                {label}
            </button>
        );
        // Debug buttons are intentionally native: streaming tile/GSplat state can
        // update between clicks, while PCUI Button retains its mount-time callback.
        // Always read the live Observer value so a second click reliably switches
        // the mode off even during rapid streaming updates.
        const toggleObserverBoolean = (path: string, fallback: boolean) => {
            const current = getViewer()?.observer?.get?.(path);
            setProperty(path, !(typeof current === 'boolean' ? current : fallback));
        };
        const toggleObserverNumber = (path: string, fallback: number, activeValue: number) => {
            const current = getViewer()?.observer?.get?.(path);
            const value = typeof current === 'number' && Number.isFinite(current) ? current : fallback;
            setProperty(path, value > 0 ? 0 : activeValue);
        };
        const poiList = parsePoiList(observerData?.poi?.list);
        const draggedPoi = poiList.find(poi => String(poi.id) === draggingPoiId) ?? null;
        const visiblePoiList = draggingPoiId ? poiList.filter(poi => String(poi.id) !== draggingPoiId) : poiList;
        const materialRenderCategories = observerData?.scene?.hasGsplat ? [] : renderModeCategories(
            new Set(parseStringArray(observerData?.scene?.materialChannelsWithTextures)),
            observerData?.debug?.withTextureOnly ?? false,
            parseStringRecord(observerData?.scene?.materialChannelFilenames),
            parseFormatRecord(observerData?.scene?.materialChannelFormats)
        )
        // На тайлсете прячем категорию UV: её раскладки строятся из
        // статического `meshInstances`, которого у потоковых тайлов нет.
        .filter(cat => !(observerData?.scene?.isTileset && cat.title === 'UV'))
        // У «запечённого» (unlit) контента каналы материала бессмысленны.
        .filter(cat => !(observerData?.scene?.isTileset && observerData?.scene?.tilesetLit === false && cat.title === 'MATERIAL CHANNELS'));

        return (
            <Container id='scene-container' flex class='left-panel-tabs-container'>
                <div className='left-panel-tabs'>
                    <div className='left-panel-tab-slot' title={tabLabels.scene}>
                        <Button
                            class={['left-panel-tab', 'left-panel-tab-scene', ...(tab === 'scene' ? ['active'] : [])]}
                            text={tabLabels.scene}
                            onClick={() => this.setState({ tab: 'scene' })}
                        />
                    </div>
                    {!embedEnabled && (
                        <div className='left-panel-tab-slot' title={tabLabels.alignment}>
                            <Button
                                class={['left-panel-tab', 'left-panel-tab-alignment', ...(tab === 'alignment' ? ['active', 'tool-active'] : [])]}
                                text={tabLabels.alignment}
                                onClick={() => this.setState({ tab: 'alignment' })}
                            />
                        </div>
                    )}
                    {showMaterialsTab && (
                        <div className='left-panel-tab-slot' title={tabLabels.materials}>
                            <Button
                                class={['left-panel-tab', 'left-panel-tab-materials', ...(tab === 'materials' ? ['active'] : [])]}
                                text={tabLabels.materials}
                                onClick={() => this.setState({ tab: 'materials' })}
                            />
                        </div>
                    )}
                    {!embedEnabled && (
                        <div className='left-panel-tab-slot' title={tabLabels.poi}>
                            <Button
                                class={[
                                    'left-panel-tab',
                                    'left-panel-tab-poi',
                                    ...(tab === 'poi' ? ['active'] : []),
                                    ...(observerData?.poi?.enabled ? ['tool-active'] : [])
                                ]}
                                text={tabLabels.poi}
                                onClick={() => this.setState({ tab: 'poi' })}
                            />
                        </div>
                    )}
                </div>

                <Label class='left-panel-active-title' text={tabLabels[tab]} />

                <div className='left-panel-tab-content'>
                    {tab === 'scene' && (
                        <>
                            <CameraPanel observerData={observerData} setProperty={setProperty} />
                            <LimitsPanel observerData={observerData} setProperty={setProperty} />
                            {!embedEnabled && !observerData?.scene?.hasGsplat && (
                                <>
                                    {/* Окружение остаётся и для unlit: модель его не учитывает,
                                        но фон и HDRI-подложка сцены им по-прежнему задаются. */}
                                    <SkyboxPanel observerData={observerData} setProperty={setProperty} />
                                    {!unlitScene && (
                                        <LightPanel observerData={observerData} setProperty={setProperty} />
                                    )}
                                </>
                            )}
                            {(!embedEnabled || embedPreset === 'full') && (
                                <SettingsPanel observerData={observerData} setProperty={setProperty} />
                            )}
                            {!embedEnabled && (
                                <div id='export-settings-row'>
                                    <Button
                                        class={['secondary', 'export-settings-button']}
                                        text={t('Export viewer settings', lang)}
                                        onClick={() => exportViewerSettings(observerData)}
                                    />
                                </div>
                            )}
                        </>
                    )}
                    {!embedEnabled && tab === 'alignment' && (
                        <AlignmentPanel observerData={observerData} setProperty={setProperty} setAlignmentMode={this.setAlignmentMode} />
                    )}
                    {showMaterialsTab && tab === 'materials' && (
                        <Container id='materials-panel' class='tab-panel'>
                            <div className='materials-layer-list'>
                                {observerData?.scene?.hasGsplat && (
                                    <div className='materials-layer-category'>
                                        <div className='materials-layer-category-title'>{t('Spatial LOD Debug', lang)} (4)</div>
                                        {materialActionButton(t('Color Splats by LOD', lang), !!observerData?.debug?.gsplatLodColor, () => toggleObserverBoolean('debug.gsplatLodColor', !!observerData?.debug?.gsplatLodColor))}
                                        {materialActionButton(t('Spatial Node Bounds', lang), !!observerData?.debug?.gsplatNodeBounds, () => toggleObserverBoolean('debug.gsplatNodeBounds', !!observerData?.debug?.gsplatNodeBounds))}
                                        {observerData?.debug?.gsplatNodeBounds && (
                                            <>
                                                {materialActionButton(
                                                    t('Checker Frame', lang),
                                                    observerData?.debug?.tileLineStyle !== 'solid',
                                                    () => {
                                                        const checker = getViewer()?.observer?.get?.('debug.tileLineStyle') !== 'solid';
                                                        setProperty('debug.tileLineStyle', checker ? 'solid' : 'checker');
                                                    }
                                                )}
                                                <div className='materials-layer-normals-row'>
                                                    {materialActionButton(t('By State', lang), (observerData?.debug?.gsplatDebugMode ?? 'lod') === 'state', () => setProperty('debug.gsplatDebugMode', 'state'))}
                                                    {materialActionButton(t('By LOD', lang), (observerData?.debug?.gsplatDebugMode ?? 'lod') !== 'state', () => setProperty('debug.gsplatDebugMode', 'lod'))}
                                                </div>
                                                <Slider
                                                    label={t('Line Thickness', lang)}
                                                    precision={1}
                                                    min={0.5}
                                                    max={8}
                                                    step={0.5}
                                                    value={observerData?.debug?.tileLineThickness ?? 1}
                                                    setProperty={(value: number) => setProperty('debug.tileLineThickness', value)}
                                                />
                                            </>
                                        )}
                                        <div className='materials-layer-inline-hint'>
                                            {t('LOD diagnostics use the live streaming state.', lang)}
                                        </div>
                                        {/* Тот же блок управления показом, что и у полигональных тайлов:
                                            заморозка камеры и пауза загрузки — одно и то же действие,
                                            и выглядеть они должны одинаково. */}
                                        <div className='tile-playback-toolbar'>
                                            <button
                                                type='button'
                                                className={`tile-playback-button${observerData?.debug?.gsplatFreeze ? ' active' : ''}`}
                                                title={t('Freeze LOD Camera', lang)}
                                                aria-label={t('Freeze LOD Camera', lang)}
                                                aria-pressed={!!observerData?.debug?.gsplatFreeze}
                                                onClick={() => toggleObserverBoolean('debug.gsplatFreeze', !!observerData?.debug?.gsplatFreeze)}
                                            >
                                                <span className='tile-playback-glyph-stack'>
                                                    <span className='material-symbols-outlined'>photo_camera</span>
                                                    <span className='material-symbols-outlined tile-playback-glyph-badge'>ac_unit</span>
                                                </span>
                                            </button>
                                            <button
                                                type='button'
                                                className={`tile-playback-button${observerData?.debug?.gsplatPaused ? ' active' : ''}`}
                                                title={t(observerData?.debug?.gsplatPaused ? 'Resume Loading' : 'Pause Loading', lang)}
                                                aria-label={t(observerData?.debug?.gsplatPaused ? 'Resume Loading' : 'Pause Loading', lang)}
                                                aria-pressed={!!observerData?.debug?.gsplatPaused}
                                                onClick={() => toggleObserverBoolean('debug.gsplatPaused', !!observerData?.debug?.gsplatPaused)}
                                            >
                                                <span className='material-symbols-outlined'>
                                                    {observerData?.debug?.gsplatPaused ? 'play_arrow' : 'pause'}
                                                </span>
                                            </button>
                                        </div>
                                    </div>
                                )}
                                {materialRenderCategories.map((cat, ci) => (
                                    <div key={ci} className='materials-layer-category'>
                                        <div className='materials-layer-category-title'>
                                            {cat.title} ({cat.items.length})
                                        </div>
                                        {/* Режим «По объектам» требует кликать по объектам и читать
                                            поштучные значения материалов — на узком экране это нерабочий
                                            сценарий, поэтому переключатель там не показывается. */}
                                        {cat.title === 'MATERIAL CHANNELS' && !observerData?.scene?.isTileset && !isMobileLayout() && (
                                            <Toggle
                                                label={t('By objects', lang)}
                                                value={observerData?.debug?.withTextureOnly ?? false}
                                                setProperty={(value: boolean) => setProperty('debug.withTextureOnly', value)}
                                            />
                                        )}
                                        {cat.items.map(item => (
                                            <React.Fragment key={item.value}>
                                                <button
                                                    type='button'
                                                    className={`materials-layer-item${item.value === 'default' ? ' materials-layer-item-final-render' : ''}${item.value === 'albedo' ? ' materials-layer-item-base-color' : ''}${item.value === 'metalness' ? ' materials-layer-item-metalness' : ''}${item.value === 'gloss' ? ' materials-layer-item-roughness' : ''}${item.value === 'world_normal' ? ' materials-layer-item-normal' : ''}${item.value === 'specularity' ? ' materials-layer-item-specular' : ''}${item.value === 'emission' ? ' materials-layer-item-emissive' : ''}${item.value === 'lighting' ? ' materials-layer-item-lighting' : ''}${item.value === 'ao' ? ' materials-layer-item-ao' : ''}${item.value === 'opacity' ? ' materials-layer-item-opacity' : ''}${(item.value === 'uv0' || item.value === 'uv_checker') ? ' materials-layer-item-uv' : ''}${observerData?.debug?.renderMode === item.value ? ' selected' : ''}`}
                                                    onClick={() => setProperty('debug.renderMode', item.value)}
                                                >
                                                    <span className='materials-layer-item-label'>
                                                        {item.value === 'default' && observerData?.scene?.isTileset ?
                                                            `${item.label} — ${observerData?.scene?.tilesetLit === true ? 'Lit (PBR)' :
                                                                (observerData?.scene?.tilesetLit === false ? 'Unlit' : 'Detecting…')}` :
                                                            item.label}
                                                        {observerData?.debug?.withTextureOnly && item.filename ? <span className='materials-layer-item-filename' title={item.filename}> {item.filename}</span> : null}
                                                    </span>
                                                    {item.format ? (
                                                        <span className='materials-layer-item-texinfo'>
                                                            <span
                                                                className='materials-layer-item-size'
                                                                title={t('Texture resolution in pixels', lang)}
                                                            >
                                                                {item.format.width === item.format.height ?
                                                                    `${item.format.width}²` :
                                                                    `${item.format.width}×${item.format.height}`}
                                                            </span>
                                                            <span
                                                                className={`materials-layer-item-format${item.format.compressed ? ' compressed' : ''}`}
                                                                title={`${item.format.gpu} — ${item.format.compressed ?
                                                                    t('GPU-compressed texture: the card reads it as is, no CPU unpacking', lang) :
                                                                    t('Uncompressed pixels: unpacked by the CPU and uploaded raw', lang)}`}
                                                            >
                                                                {item.format.container}
                                                            </span>
                                                        </span>
                                                    ) : null}
                                                </button>
                                                {cat.title === 'MATERIAL CHANNELS' && observerData?.debug?.renderMode === item.value && materialFactorByRenderMode[item.value] && (
                                                    <>
                                                        {(observerData?.debug?.withTextureOnly ?? false) && !hasSelectedObject && (
                                                            <div className='materials-layer-inline-hint'>{t('Click an object in the viewport.', lang)}</div>
                                                        )}
                                                        {(observerData?.debug?.withTextureOnly ?? false) && hasSelectedObject && (materialFactorByRenderMode[item.value].value === null || materialFactorByRenderMode[item.value].value === undefined) && (
                                                            <div className='materials-layer-inline-hint'>{t('No editable PBR factors.', lang)}</div>
                                                        )}
                                                        {(observerData?.debug?.withTextureOnly ?? false) && hasSelectedObject && materialFactorByRenderMode[item.value].value !== null && materialFactorByRenderMode[item.value].value !== undefined && (
                                                            <Slider
                                                                label={`${materialFactorByRenderMode[item.value].label} (%)`}
                                                                precision={0}
                                                                min={0}
                                                                max={100}
                                                                step={1}
                                                                value={materialFactorByRenderMode[item.value].value ?? 0}
                                                                setProperty={(value: number) => setSelectedMaterialFactor(materialFactorByRenderMode[item.value].key, value)}
                                                            />
                                                        )}
                                                    </>
                                                )}
                                                {cat.title === 'MATERIAL CHANNELS' && observerData?.debug?.renderMode === item.value && item.value === 'albedo' && (
                                                    <>
                                                        {(observerData?.debug?.withTextureOnly ?? false) && !hasSelectedObject && (
                                                            <div className='materials-layer-inline-hint'>{t('Click an object in the viewport.', lang)}</div>
                                                        )}
                                                        {(observerData?.debug?.withTextureOnly ?? false) && hasSelectedObject && !selectedMaterialColor && (
                                                            <div className='materials-layer-inline-hint'>{t('No editable PBR factors.', lang)}</div>
                                                        )}
                                                        {(observerData?.debug?.withTextureOnly ?? false) && hasSelectedObject && selectedMaterialColor && (
                                                            <ColorPickerControl
                                                                label={t('Diffuse Color', lang)}
                                                                value={rgbToArr(selectedMaterialColor)}
                                                                setProperty={setSelectedDiffuseColor}
                                                            />
                                                        )}
                                                    </>
                                                )}
                                                {cat.title === 'MATERIAL CHANNELS' && observerData?.debug?.renderMode === item.value && item.value === 'specularity' && (
                                                    <>
                                                        {(observerData?.debug?.withTextureOnly ?? false) && !hasSelectedObject && (
                                                            <div className='materials-layer-inline-hint'>{t('Click an object in the viewport.', lang)}</div>
                                                        )}
                                                        {(observerData?.debug?.withTextureOnly ?? false) && hasSelectedObject && !selectedSpecularColor && (
                                                            <div className='materials-layer-inline-hint'>{t('No editable PBR factors.', lang)}</div>
                                                        )}
                                                        {(observerData?.debug?.withTextureOnly ?? false) && hasSelectedObject && selectedSpecularColor && (
                                                            <ColorPickerControl
                                                                label={t('Specular Color', lang)}
                                                                value={rgbToArr(selectedSpecularColor)}
                                                                setProperty={setSelectedSpecularColor}
                                                            />
                                                        )}
                                                    </>
                                                )}
                                            </React.Fragment>
                                        ))}
                                        {cat.title === 'UV' && (
                                            <>
                                                {observerData?.debug?.renderMode === 'uv_checker' && (
                                                    <Slider
                                                        label={t('Checker Scale', lang)}
                                                        precision={0}
                                                        min={1}
                                                        max={64}
                                                        value={observerData?.debug?.uvCheckerScale ?? 16}
                                                        setProperty={(value: number) => setProperty('debug.uvCheckerScale', value)}
                                                    />
                                                )}
                                                {(observerData?.debug?.withTextureOnly ?? false) && (
                                                    <div className='materials-layer-uv-extra'>
                                                        <div className='materials-layer-item materials-layer-item-static'>
                                                            <span className='materials-layer-item-label'>
                                                                <img src='static/icons/texel-density.svg' alt='' className='materials-layer-item-inline-icon' />
                                                                <span>{t('Texel Density', lang)}</span>
                                                            </span>
                                                            {observerData?.scene?.selectedNode?.path ? (
                                                                <span className='materials-layer-item-value' title={observerData?.scene?.texelDensitySummary || 'n/a'}>
                                                                    {texelDensityShortValue}
                                                                </span>
                                                            ) : null}
                                                        </div>
                                                        {(() => {
                                                            const selectedPath = observerData?.scene?.selectedNode?.path ?? '';
                                                            if (!selectedPath) {
                                                                return <div className='materials-layer-inline-hint'>{t('Click an object in the viewport.', lang)}</div>;
                                                            }
                                                            return null;
                                                        })()}
                                                    </div>
                                                )}
                                            </>
                                        )}
                                    </div>
                                ))}
                                {/* Каркас и нормали вершин строятся из статического
                                    `meshInstances` — у потоковых тайлов он пуст, поэтому для
                                    тайлсета вся геометрическая категория скрыта. */}
                                {!observerData?.scene?.isTileset && !observerData?.scene?.hasGsplat && (
                                    <div className='materials-layer-category'>
                                        <div className='materials-layer-category-title'>{t('Geometry', lang)} (2)</div>
                                        {materialActionButton(t('Wireframe', lang), !!observerData?.debug?.wireframe, () => toggleObserverBoolean('debug.wireframe', !!observerData?.debug?.wireframe), ['materials-layer-item-wireframe'])}
                                        <div className='materials-layer-normals-row'>
                                            {materialActionButton(t('Vertex Normals', lang), (observerData?.debug?.normals ?? 0) > 0, () => toggleObserverNumber('debug.normals', observerData?.debug?.normals ?? 0, 0.2), ['materials-layer-item-vertex-normals'])}
                                            {(observerData?.debug?.normals ?? 0) > 0 && (
                                                <div className='materials-layer-normals-slider'>
                                                    <Slider
                                                        label=''
                                                        precision={2}
                                                        min={0}
                                                        max={1}
                                                        value={observerData?.debug?.normals ?? 0}
                                                        setProperty={(value: number) => setProperty('debug.normals', value)} />
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}
                                {/* Отладка тайлов: OBB-контуры + HUD. Только для
                                    тайлсетов — вешаем в слот, где для них скрыты UV/Geometry. */}
                                {observerData?.scene?.isTileset && (
                                    <div className='materials-layer-category'>
                                        <div className='materials-layer-category-title'>{t('Tiles Debug', lang)} (1)</div>
                                        {/* Три опции в один уровень: раскраска, границы, подписи. Каждая —
                                            обычная кнопка, а свои настройки показывает включённой. Сворачивания
                                            нет намеренно: в отладке эти переключатели дёргают постоянно, и лишнее
                                            раскрытие стоило бы клика на каждом заходе. */}
                                        {materialActionButton(t('Color the model', lang), !!observerData?.debug?.tileLodColor, () => toggleObserverBoolean('debug.tileLodColor', !!observerData?.debug?.tileLodColor))}
                                        {/* Схем всего две, и они общие для поверхностей и каркаса — поэтому
                                            показываем их, когда включено любое из двух, а не только раскраска.
                                            Двумя кнопками, а не списком: выбранная видна без раскрытия. */}
                                        {(observerData?.debug?.tileLodColor || observerData?.debug?.tileDebug) && (
                                            <div className='materials-layer-normals-row materials-layer-scheme-row'>
                                                {materialActionButton(t('By LOD', lang), (observerData?.debug?.tileDebugMode ?? 'lod') !== 'resolution', () => setProperty('debug.tileDebugMode', 'lod'))}
                                                <span title={t('Colours tiles by how far their screen-space error is from the target: red is coarser than asked for, white is on target, blue is finer than needed.', lang)} style={{ display: 'contents' }}>
                                                    {materialActionButton(t('By Resolution', lang), observerData?.debug?.tileDebugMode === 'resolution', () => setProperty('debug.tileDebugMode', 'resolution'))}
                                                </span>
                                            </div>
                                        )}

                                        {materialActionButton(t('Tile Bounds (OBB)', lang), !!observerData?.debug?.tileDebug, () => toggleObserverBoolean('debug.tileDebug', !!observerData?.debug?.tileDebug))}
                                        {observerData?.debug?.tileDebug && (
                                            <>
                                                {materialActionButton(
                                                    // Подпись постоянная, подсветка означает «включено» — как у прочих
                                                    // кнопок панели. Прежде менялись обе, и ровный каркас читался как
                                                    // выключённый режим, хотя он и есть умолчание.
                                                    t('Checker Frame', lang),
                                                    observerData?.debug?.tileLineStyle !== 'solid',
                                                    () => {
                                                        // Каркас либо ровный, либо шахматный: одной кнопки с двумя состояниями хватает.
                                                        const checker = getViewer()?.observer?.get?.('debug.tileLineStyle') !== 'solid';
                                                        setProperty('debug.tileLineStyle', checker ? 'solid' : 'checker');
                                                    }
                                                )}
                                                {observerData?.debug?.tileLineStyle !== 'solid' && (
                                                    materialActionButton(t('Checker Fill', lang), !!observerData?.debug?.tileCheckerFill, () => toggleObserverBoolean('debug.tileCheckerFill', !!observerData?.debug?.tileCheckerFill))
                                                )}
                                                <Slider
                                                    label={t('Line Thickness', lang)}
                                                    precision={1}
                                                    min={0.5}
                                                    max={8}
                                                    step={0.5}
                                                    value={observerData?.debug?.tileLineThickness ?? 2}
                                                    setProperty={(value: number) => setProperty('debug.tileLineThickness', value)}
                                                />
                                                {materialActionButton(t('Pick Tile', lang), !!observerData?.debug?.tilePick, () => toggleObserverBoolean('debug.tilePick', !!observerData?.debug?.tilePick))}
                                                {observerData?.debug?.tilePick && (
                                                    materialActionButton(t('Isolate Picked Tile', lang), !!observerData?.debug?.tileIsolatePick, () => toggleObserverBoolean('debug.tileIsolatePick', !!observerData?.debug?.tileIsolatePick))
                                                )}
                                            </>
                                        )}

                                        {/* Подписи — одна кнопка и список того, что писать: два числа в одном
                                            кружке не показать, и прежние отдельные переключатели приходилось
                                            гасить друг о друга вручную. */}
                                        {materialActionButton(t('Tile labels', lang), !!(observerData?.debug?.tileOrderLabels || observerData?.debug?.tileIdLabels), () => {
                                            const debug = getViewer()?.observer;
                                            const on = !!(debug?.get?.('debug.tileOrderLabels') || debug?.get?.('debug.tileIdLabels'));
                                            setProperty('debug.tileOrderLabels', !on);
                                            setProperty('debug.tileIdLabels', false);
                                        })}
                                        {(observerData?.debug?.tileOrderLabels || observerData?.debug?.tileIdLabels) && (
                                            <>
                                                {/* Парой кнопок, как и схема раскраски: выбранное видно без раскрытия.
                                                    Подписи короткие — «порядок» и «номер» помещаются в половину строки. */}
                                                <div className='materials-layer-normals-row materials-layer-scheme-row'>
                                                    {materialActionButton(t('Load order', lang), !observerData?.debug?.tileIdLabels, () => {
                                                        setProperty('debug.tileIdLabels', false);
                                                        setProperty('debug.tileOrderLabels', true);
                                                    })}
                                                    {materialActionButton(t('Tile ID', lang), !!observerData?.debug?.tileIdLabels, () => {
                                                        // Два числа в одном кружке не показать: режимы исключают друг друга.
                                                        setProperty('debug.tileOrderLabels', false);
                                                        setProperty('debug.tileIdLabels', true);
                                                    })}
                                                </div>
                                                {!observerData?.debug?.tileIdLabels && (
                                                    materialActionButton(t('Number within each LOD', lang), !!observerData?.debug?.tileOrderPerLod, () => toggleObserverBoolean('debug.tileOrderPerLod', !!observerData?.debug?.tileOrderPerLod))
                                                )}
                                            </>
                                        )}

                                        {/* Последовательный цикл: в обычном режиме видна только запись;
                                            во время записи рядом появляется Stop; после Stop он сменяется
                                            выходом из редактора таймлайна. Заморозка остаётся внутренней
                                            деталью режима просмотра. */}
                                        <div className='tile-playback-toolbar'>
                                            <button
                                                type='button'
                                                className={`tile-playback-button${observerData?.debug?.tileRecording ? ' active' : ''}`}
                                                title={t('Start recording', lang)}
                                                aria-label={t('Start recording', lang)}
                                                aria-pressed={!!observerData?.debug?.tileRecording}
                                                disabled={!!observerData?.debug?.tileRecording}
                                                onClick={() => setProperty('debug.tileRecording', true)}
                                            >
                                                {/* Камера с красной точкой: записываются её путь и история тайлов. */}
                                                <span className='tile-playback-glyph-stack'>
                                                    <span className='material-symbols-outlined'>photo_camera</span>
                                                    <span className='material-symbols-outlined tile-playback-glyph-badge tile-recording-badge'>circle</span>
                                                </span>
                                            </button>
                                            {!!observerData?.debug?.tileRecording && (
                                                <button
                                                    type='button'
                                                    className='tile-playback-button'
                                                    title={t('Stop recording', lang)}
                                                    aria-label={t('Stop recording', lang)}
                                                    onClick={() => setProperty('debug.tileRecording', false)}
                                                >
                                                    <span className='material-symbols-outlined'>stop</span>
                                                </button>
                                            )}
                                            {!observerData?.debug?.tileRecording && !!observerData?.debug?.tileFreeze && (
                                                <button
                                                    type='button'
                                                    className='tile-playback-button'
                                                    title={t('Exit timeline', lang)}
                                                    aria-label={t('Exit timeline', lang)}
                                                    onClick={() => {
                                                        // Выход возвращает живую камеру и сразу продолжает стриминг:
                                                        // оставленная Stop-пауза вне редактора была бы невидимой ловушкой.
                                                        setProperty('debug.tileFreeze', false);
                                                        setProperty('debug.tilePaused', false);
                                                    }}
                                                >
                                                    <span className='material-symbols-outlined'>close</span>
                                                </button>
                                            )}
                                        </div>
                                        {/* Изоляция уровня — один ползунок вместо пары «переключатель плюс
                                            появляющийся ползунок». Крайнее левое положение (-1) выключает её:
                                            отдельному тумблеру тут делать нечего, состояний всё равно одно. */}
                                        <span title={t('Leftmost position turns isolation off; further right shows only the chosen level.', lang)} style={{ display: 'contents' }}>
                                            <Slider
                                                label={t('Isolate LOD', lang)}
                                                precision={0}
                                                min={-1}
                                                max={Math.max(0, observerData?.scene?.tilesetMaxDepth ?? 0)}
                                                step={1}
                                                value={observerData?.debug?.tileLodLock ?
                                                    Math.min(observerData?.debug?.tileLodLevel ?? 0, observerData?.scene?.tilesetMaxDepth ?? 0) : -1}
                                                setProperty={(value: number) => {
                                                    // Уровень и признак изоляции ходят парой: сначала уровень,
                                                    // иначе включённая изоляция успела бы показать прежний.
                                                    if (value >= 0) setProperty('debug.tileLodLevel', value);
                                                    setProperty('debug.tileLodLock', value >= 0);
                                                }}
                                            />
                                        </span>
                                    </div>
                                )}
                            </div>
                            {!observerData?.scene?.isTileset && !observerData?.scene?.hasGsplat && observerData?.debug?.wireframe && (
                                <ColorPickerControl
                                    label={t('Wireframe Color', lang)}
                                    value={rgbToArr(observerData?.debug?.wireframeColor ?? { r: 0, g: 0, b: 0 })}
                                    setProperty={(value: number[]) => setProperty('debug.wireframeColor', arrToRgb(value))} />
                            )}
                        </Container>
                    )}
                    {tab === 'poi' && (
                        <Container id='poi-panel' class='tab-panel'>
                            <div className='materials-layer-inline-hint'>{t('Click on the model surface to place a POI.', lang)}</div>
                            <div className='poi-list'>
                                {poiList.length === 0 && (
                                    <div className='materials-layer-inline-hint'>{t('No POIs yet.', lang)}</div>
                                )}
                                {visiblePoiList.map(poi => (
                                    <React.Fragment key={String(poi.id)}>
                                        {draggingPoiId && dragOverPoiId === String(poi.id) && <div className='poi-list-placeholder' />}
                                        <div
                                            className={`poi-list-item${dragOverPoiId === String(poi.id) ? ' poi-list-item-drop-target' : ''}${activePoiCardId === String(poi.id) ? ' poi-list-item-active' : ''}`}
                                            data-poi-id={String(poi.id)}
                                            onClick={() => this.handlePoiCardClick(String(poi.id))}
                                        >
                                            <div className='poi-list-row'>
                                                <div
                                                    className='poi-list-drag-handle'
                                                    onMouseDown={event => this.handlePoiPointerDown(String(poi.id), event)}
                                                />
                                                <div
                                                    className='poi-list-badge'
                                                    style={{
                                                        backgroundColor: poi.color || '#111111'
                                                    }}
                                                >
                                                    {poi.number}
                                                </div>
                                                <TextInput
                                                    class='poi-list-input'
                                                    value={String(poi.title ?? `POI ${poi.number}`)}
                                                    onChange={(value: string) => getViewer()?.updatePoiTitle?.(String(poi.id), value)}
                                                />
                                            </div>
                                            <div className='poi-trigger-row' style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '6px 0' }}>
                                                <Toggle
                                                    label={t('Trigger', lang)}
                                                    value={!!poi.trigger}
                                                    setProperty={(value: boolean) => getViewer()?.updatePoiTrigger?.(String(poi.id), value)}
                                                />
                                                {poi.trigger ? (
                                                    <TextInput
                                                        class='poi-list-input'
                                                        placeholder={t('Short name', lang)}
                                                        value={String(poi.systemName ?? '')}
                                                        onChange={(value: string) => getViewer()?.updatePoiSystemName?.(String(poi.id), value)}
                                                    />
                                                ) : null}
                                            </div>
                                            {poi.trigger ? (
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, margin: '4px 0 6px' }}>
                                                    {animTracks.length > 0 ? (
                                                        <SelectInput
                                                            class='poi-list-animation-select'
                                                            type='string'
                                                            options={[
                                                                { v: '', t: `— ${t('Anim clip', lang)} —` },
                                                                ...animTracks.map((clip: string) => ({ v: clip, t: clip }))
                                                            ]}
                                                            value={poi.animClip ?? ''}
                                                            onChange={(value: unknown) => getViewer()?.updatePoiAnimClip?.(String(poi.id), String(value ?? ''))}
                                                        />
                                                    ) : (
                                                        <TextInput
                                                            class='poi-list-input'
                                                            placeholder={t('Anim clip', lang)}
                                                            value={String(poi.animClip ?? '')}
                                                            onChange={(value: string) => getViewer()?.updatePoiAnimClip?.(String(poi.id), value)}
                                                        />
                                                    )}
                                                    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                                                        <NumericInput
                                                            class='poi-list-animation-number'
                                                            placeholder={t('From', lang)}
                                                            value={poi.animFrom ?? null}
                                                            min={0}
                                                            step={1}
                                                            precision={0}
                                                            allowNull
                                                            hideSlider
                                                            width={60}
                                                            onChange={(value: unknown) => {
                                                                const v = value === null || value === '' ? null : Number(value);
                                                                getViewer()?.updatePoiAnimFrom?.(String(poi.id), v);
                                                            }}
                                                        />
                                                        <span style={{ fontSize: 10, opacity: 0.6 }}>–</span>
                                                        <NumericInput
                                                            class='poi-list-animation-number'
                                                            placeholder={t('To', lang)}
                                                            value={poi.animTo ?? null}
                                                            min={0}
                                                            step={1}
                                                            precision={0}
                                                            allowNull
                                                            hideSlider
                                                            width={60}
                                                            onChange={(value: unknown) => {
                                                                const v = value === null || value === '' ? null : Number(value);
                                                                getViewer()?.updatePoiAnimTo?.(String(poi.id), v);
                                                            }}
                                                        />
                                                        <span style={{ fontSize: 10, opacity: 0.6 }}>fps</span>
                                                        <NumericInput
                                                            class='poi-list-animation-number'
                                                            placeholder='24'
                                                            value={poi.animFps ?? null}
                                                            min={1}
                                                            step={1}
                                                            precision={0}
                                                            allowNull
                                                            hideSlider
                                                            width={44}
                                                            onChange={(value: unknown) => {
                                                                const v = value === null || value === '' ? null : Number(value);
                                                                getViewer()?.updatePoiAnimFps?.(String(poi.id), v);
                                                            }}
                                                        />
                                                    </div>
                                                </div>
                                            ) : null}
                                            <ColorPickerControl
                                                label={t('Color', lang)}
                                                value={hexToArr(poi.color)}
                                                setProperty={(value: number[]) => getViewer()?.updatePoiColor?.(String(poi.id), arrToHex(value))}
                                            />
                                            {!poi.trigger && (
                                                <div className='poi-description-field'>
                                                    <TextAreaInput
                                                        class='poi-list-description'
                                                        value={String(poi.description ?? '')}
                                                        placeholder={t('Description', lang)}
                                                        resizable='vertical'
                                                        onChange={(value: unknown) => getViewer()?.updatePoiDescription?.(String(poi.id), String(value ?? '').slice(0, 636))}
                                                    />
                                                </div>
                                            )}
                                            {!poi.trigger && (
                                                <div className='poi-list-actions poi-list-actions-secondary'>
                                                    <div
                                                        className='poi-list-secondary-action'
                                                        title={t(poi.camera ? 'Retake View' : 'Capture View', lang)}
                                                    >
                                                        <Button
                                                            class={[
                                                                'poi-list-secondary-button',
                                                                poi.camera ? 'poi-list-secondary-button-retake-view' : 'poi-list-secondary-button-capture-view',
                                                                ...(poi.camera ? ['is-saved'] : [])
                                                            ]}
                                                            text={t(poi.camera ? 'Retake View' : 'Capture View', lang)}
                                                            onClick={() => getViewer()?.capturePoiCameraView?.(String(poi.id))}
                                                        />
                                                    </div>
                                                    {poi.camera ? (
                                                        <div className='poi-list-secondary-action' title={t('Delete View', lang)}>
                                                            <Button
                                                                class={['poi-list-secondary-button', 'poi-list-secondary-button-delete-view']}
                                                                text={t('Delete View', lang)}
                                                                onClick={() => getViewer()?.clearPoiCameraView?.(String(poi.id))}
                                                            />
                                                        </div>
                                                    ) : null}
                                                </div>
                                            )}
                                            <div className='poi-list-actions'>
                                                {!poi.trigger && (
                                                    <div className='poi-list-sliders' style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                                        <div className='poi-list-duration'>
                                                            <span title={t('Transition', lang)} style={{ width: 24, display: 'inline-block', textAlign: 'center' }}>
                                                                <img src='static/icons/poi-transition.svg' alt='' className='poi-list-duration-icon' style={{ margin: 0 }} />
                                                            </span>
                                                            <div style={{ position: 'relative', width: 120 }}>
                                                                <div id={`poi-progress-transition-${String(poi.id)}`} className='poi-progress-transition' style={{ position: 'absolute', top: 0, left: 0, height: '100%', width: '0%', pointerEvents: 'none', borderRadius: 2 }} />
                                                                <NakedSlider
                                                                    class='poi-list-duration-slider'
                                                                    width={120}
                                                                    precision={1}
                                                                    min={0}
                                                                    max={10}
                                                                    value={Number.isFinite(Number(poi.duration)) ? Number(poi.duration) : DEFAULT_POI_DURATION_SECONDS}
                                                                    setProperty={(value: number) => getViewer()?.updatePoiDuration?.(String(poi.id), value)}
                                                                />
                                                            </div>
                                                        </div>
                                                        <div className='poi-list-duration'>
                                                            <span title={t('Hold time', lang)} style={{ width: 24, display: 'inline-block', textAlign: 'center' }}>
                                                                <img src='static/icons/poi-duration.svg' alt='' className='poi-list-duration-icon' style={{ margin: 0 }} />
                                                            </span>
                                                            <div style={{ position: 'relative', width: 120 }}>
                                                                <div id={`poi-progress-hold-${String(poi.id)}`} className='poi-progress-hold' style={{ position: 'absolute', top: 0, left: 0, height: '100%', width: '0%', pointerEvents: 'none', borderRadius: 2 }} />
                                                                <NakedSlider
                                                                    class='poi-list-duration-slider'
                                                                    width={120}
                                                                    precision={1}
                                                                    min={0}
                                                                    max={60}
                                                                    value={Number.isFinite(Number(poi.holdTime)) ? Number(poi.holdTime) : DEFAULT_POI_HOLD_TIME_SECONDS}
                                                                    setProperty={(value: number) => getViewer()?.updatePoiHoldTime?.(String(poi.id), value)}
                                                                />
                                                            </div>
                                                        </div>
                                                    </div>
                                                )}
                                                <Button
                                                    class='poi-list-delete'
                                                    text=''
                                                    onClick={() => getViewer()?.removePoi?.(String(poi.id))}
                                                />
                                            </div>
                                        </div>
                                    </React.Fragment>
                                ))}
                                {draggingPoiId && !dragOverPoiId && <div className='poi-list-placeholder' />}
                            </div>
                            {draggedPoi && (
                                <div
                                    className='poi-drag-ghost'
                                    style={{ transform: `translate(${dragX + 14}px, ${dragY + 14}px)` }}
                                >
                                    <div className='poi-list-row'>
                                        <div className='poi-list-drag-handle' />
                                        <div
                                            className='poi-list-badge'
                                            style={{
                                                backgroundColor: draggedPoi.color || '#111111'
                                            }}
                                        >
                                            {draggedPoi.number}
                                        </div>
                                        <div className='poi-drag-ghost-title'>{String(draggedPoi.title ?? `POI ${draggedPoi.number}`)}</div>
                                    </div>
                                </div>
                            )}
                            <div id='poi-save-row'>
                                <Button class='secondary' text={t('Save', lang)} onClick={this.handlePoiSave} />
                                {this.state.poiSaved && <span className='metadata-saved-feedback'>✓ {t('Saved', lang)}</span>}
                            </div>
                        </Container>
                    )}
                </div>

                <div id='scene-scrolly-bits' />
            </Container>
        );
    }
}

export default LeftPanel;
