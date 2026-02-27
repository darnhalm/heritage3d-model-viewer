import { Panel, Container, Button, Label, TextInput } from '@playcanvas/pcui/react';
import React from 'react';

import { extract } from '../../helpers';
import { t } from '../../i18n/translations';
import { SetProperty, ObserverData } from '../../types';
import { Detail, Select, Slider, Toggle, ColorPickerControl, Numeric, ToggleColor } from '../components';

const rgbToArr = (rgb: { r: number, g: number, b: number }) => [rgb.r, rgb.g, rgb.b, 1];
const arrToRgb = (arr: number[]) => ({ r: arr[0], g: arr[1], b: arr[2] });
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
    const viewer = (window as any).viewer;
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
        enableWebGPU: observerData.enableWebGPU,
        metadata: observerData.metadata ?? {}
    };
    const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const filenames = viewer?.observer?.get?.('scene.filenames') as string[] | undefined;
    const firstFilename = Array.isArray(filenames) && filenames.length > 0 ? filenames[0] : null;
    const baseName = firstFilename ? firstFilename.replace(/\.[^/.]+$/, '') || null : null;
    a.download = baseName ? `${baseName}.model-viewer-settings.json` : 'model-viewer-settings.json';
    a.click();
    URL.revokeObjectURL(url);
};

type LeftPanelTab = 'scene' | 'materials' | 'poi' | 'metadata';

const DUBLIN_CORE_FIELDS: Array<{ key: string; labelKey: string }> = [
    { key: 'title', labelKey: 'Title' }, { key: 'creator', labelKey: 'Creator' }, { key: 'subject', labelKey: 'Subject' },
    { key: 'description', labelKey: 'Description' }, { key: 'publisher', labelKey: 'Publisher' }, { key: 'contributor', labelKey: 'Contributor' },
    { key: 'date', labelKey: 'Date' }, { key: 'type', labelKey: 'Type' }, { key: 'format', labelKey: 'Format' },
    { key: 'identifier', labelKey: 'Identifier' }, { key: 'source', labelKey: 'Source' }, { key: 'language', labelKey: 'Language' },
    { key: 'relation', labelKey: 'Relation' }, { key: 'coverage', labelKey: 'Coverage' }, { key: 'rights', labelKey: 'Rights' }
];

class MetadataPanel extends React.Component<{ observerData: ObserverData; setProperty: SetProperty }> {
    state: { saved: boolean } = { saved: false };

    saveTimer: ReturnType<typeof setTimeout> | null = null;

    shouldComponentUpdate(nextProps: { observerData: ObserverData }, nextState: { saved: boolean }) {
        return JSON.stringify(nextProps.observerData.metadata) !== JSON.stringify(this.props.observerData.metadata) ||
               nextProps.observerData?.ui?.language !== this.props.observerData?.ui?.language ||
               nextState.saved !== this.state.saved;
    }

    componentWillUnmount() {
        if (this.saveTimer) clearTimeout(this.saveTimer);
    }

    handleSave = () => {
        this.setState({ saved: true });
        if (this.saveTimer) clearTimeout(this.saveTimer);
        this.saveTimer = setTimeout(() => this.setState({ saved: false }), 2000);
    };

    render() {
        const { observerData, setProperty } = this.props;
        const metadata = observerData.metadata ?? {};
        const lang = observerData?.ui?.language;
        const egrokn = !!metadata.egrokn;
        const isMuseumItem = !!metadata.isMuseumItem;
        const egroknLevelOptions = [
            { v: 'federal', t: t('Federal', lang) },
            { v: 'regional', t: t('Regional', lang) },
            { v: 'municipal', t: t('Municipal', lang) }
        ];
        return (
            <Panel headerText={t('Metadata (Dublin Core)', lang)} id='metadata-panel' flexShrink={'0'} collapsible={false}>
                {DUBLIN_CORE_FIELDS.map(({ key, labelKey }) => (
                    <Container key={key} class={['panel-option', 'metadata-field']}>
                        <Label class='panel-label' text={t(labelKey, lang)} />
                        <TextInput
                            class='panel-value'
                            value={String(metadata[key as keyof typeof metadata] ?? '')}
                            onChange={(value: string) => setProperty(`metadata.${key}`, value)}
                        />
                    </Container>
                ))}
                <Container class={['panel-option', 'metadata-section-header']}>
                    <Label class='panel-label' text={t('Heritage', lang)} />
                </Container>
                <Toggle
                    label={t('EGROKN', lang)}
                    value={egrokn}
                    setProperty={(v: boolean) => setProperty('metadata.egrokn', v)}
                />
                {egrokn && (
                    <Select
                        label={t('EGROKN level', lang)}
                        type='string'
                        options={egroknLevelOptions}
                        value={metadata.egroknLevel ?? 'federal'}
                        setProperty={(v: string) => setProperty('metadata.egroknLevel', v)}
                    />
                )}
                <Container class={['panel-option', 'metadata-field']}>
                    <Label class='panel-label' text={t('Object number', lang)} />
                    <TextInput
                        class='panel-value'
                        value={metadata.objectNumber ?? ''}
                        onChange={(value: string) => setProperty('metadata.objectNumber', value)}
                    />
                </Container>
                <Toggle
                    label={t('Museum item', lang)}
                    value={isMuseumItem}
                    setProperty={(v: boolean) => setProperty('metadata.isMuseumItem', v)}
                />
                {isMuseumItem && (
                    <Container class={['panel-option', 'metadata-field']}>
                        <Label class='panel-label' text={t('Goskatalog link', lang)} />
                        <TextInput
                            class='panel-value'
                            placeholder='https://goskatalog.ru/...'
                            value={metadata.goskatalogLink ?? ''}
                            onChange={(value: string) => setProperty('metadata.goskatalogLink', value)}
                        />
                    </Container>
                )}
                <div id='metadata-save-row'>
                    <Button class='secondary' text={t('Save', lang)} onClick={this.handleSave} />
                    {this.state.saved && <span className='metadata-saved-feedback'>✓ {t('Saved', lang)}</span>}
                </div>
            </Panel>
        );
    }
}

const toggleCollapsed = () => {
    const leftPanel = document.getElementById('panel-left');
    if (leftPanel) {
        leftPanel.classList.toggle('expanded');
    }
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
               a.camera?.multisampleSupported !== b.camera?.multisampleSupported ||
               a.camera?.multisample !== b.camera?.multisample ||
               a.camera?.hq !== b.camera?.hq ||
               a.runtime?.viewportWidth !== b.runtime?.viewportWidth ||
               a.runtime?.viewportHeight !== b.runtime?.viewportHeight;
    }

    render() {
        const props = this.props;
        const sceneCameras: Array<{ name: string, path: string }> = JSON.parse(props.observerData.scene?.cameras || '[]');
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
                    value={props.observerData.camera.pixelScale}
                    type='number'
                    options={[1, 2, 4, 8, 16].map(v => ({ v: v, t: Number(v).toString() }))}
                    setProperty={(value: number) => props.setProperty('camera.pixelScale', value)} />
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
                    label={t('Environment', lang)}
                    type='string'
                    options={JSON.parse(skybox?.options || '[]')}
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
                    value={rgbToArr(skybox?.backgroundColor ?? { r: 0.5, g: 0.6, b: 0.68 })}
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

const renderModeCategories = (
    channelsWithTextures: Set<string>,
    withTextureOnly: boolean,
    channelFilenames: Record<string, string>
): Array<{
    title: string;
    items: Array<{ label: string; value: string; filename?: string }>;
}> => {
    const materialItems = (withTextureOnly ?
        MATERIAL_CHANNEL_ITEMS.filter(item => channelsWithTextures.has(item.value)) :
        MATERIAL_CHANNEL_ITEMS
    ).map(item => ({
        ...item,
        filename: channelFilenames[item.value] || undefined
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
               nextProps.observerData.enableWebGPU !== this.props.observerData.enableWebGPU ||
               nextProps.observerData.runtime?.activeDeviceType !== this.props.observerData.runtime?.activeDeviceType ||
               nextProps.observerData?.ui?.language !== this.props.observerData?.ui?.language;
    }

    render() {
        const props = this.props;
        const debugData = props.observerData.debug;
        const activeDevice = props.observerData.runtime?.activeDeviceType;

        const lang = props.observerData?.ui?.language;
        return (
            <Panel headerText={t('Settings', lang)} id='settings-panel' flexShrink={'0'} flexGrow={'0'} collapsible={false}>
                <Detail label={t('Current Device', lang)} value={activeDevice === 'webgpu' ? 'WebGPU' : 'WebGL 2'} />
                <Toggle
                    label={t('Use WebGPU', lang)}
                    value={props.observerData.enableWebGPU}
                    enabled={typeof navigator !== 'undefined' && navigator.gpu !== undefined}
                    setProperty={(value: boolean) => {
                        if (value === props.observerData.enableWebGPU) return;
                        const message = value ?
                            'Enable WebGPU? The page will refresh to apply this change.' :
                            'Disable WebGPU? The page will refresh to apply this change.';
                        // eslint-disable-next-line no-alert
                        if (window.confirm(message)) {
                            props.setProperty('enableWebGPU', value);
                            setTimeout(() => window.location.reload(), 100);
                        } else {
                            props.setProperty('enableWebGPU', value);
                            requestAnimationFrame(() => props.setProperty('enableWebGPU', !value));
                        }
                    }}
                />
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

class LeftPanel extends React.Component <{ observerData: ObserverData, setProperty: SetProperty }> {
    state: { tab: LeftPanelTab } = { tab: 'scene' };

    shouldComponentUpdate(nextProps: Readonly<{ observerData: ObserverData; setProperty: SetProperty; }>, nextState: { tab: LeftPanelTab }): boolean {
        const keys = ['camera', 'debug', 'measure.unit', 'scene.cameras', 'scene.selectedCamera', 'scene.selectedNode', 'scene.materialChannelsWithTextures', 'scene.materialChannelFilenames', 'scene.selectedMaterialNames', 'scene.availableUvSets', 'scene.variants', 'scene.variant', 'scene.texelDensitySummary', 'scene.texelDensityReport', 'runtime', 'skybox', 'light', 'shadowCatcher', 'enableWebGPU', 'ui.language', 'metadata'];
        const a = extract(nextProps.observerData, keys);
        const b = extract(this.props.observerData, keys);
        return JSON.stringify(a) !== JSON.stringify(b) || nextState.tab !== this.state.tab;
    }

    componentDidMount(): void {
        document.getElementById('panel-toggle')?.addEventListener('click', () => toggleCollapsed());
        document.getElementById('title')?.addEventListener('click', () => toggleCollapsed());
    }

    render() {
        const { tab } = this.state;
        const { observerData, setProperty } = this.props;
        const lang = observerData?.ui?.language;
        const texelDensityShortValue = (() => {
            const summary = observerData?.scene?.texelDensitySummary || 'n/a';
            return summary.split('|')[0]?.trim() || summary;
        })();

        return (
            <Container id='scene-container' flex class='left-panel-tabs-container'>
                <div className='left-panel-tabs'>
                    <button
                        type='button'
                        className={`left-panel-tab left-panel-tab-scene${tab === 'scene' ? ' active' : ''}`}
                        onClick={() => this.setState({ tab: 'scene' })}
                    >
                        {t('Settings', lang)}
                    </button>
                    <button
                        type='button'
                        className={`left-panel-tab left-panel-tab-materials${tab === 'materials' ? ' active' : ''}`}
                        onClick={() => this.setState({ tab: 'materials' })}
                    >
                        {t('Materials', lang)}
                    </button>
                    <button
                        type='button'
                        className={`left-panel-tab left-panel-tab-poi${tab === 'poi' ? ' active' : ''}`}
                        onClick={() => this.setState({ tab: 'poi' })}
                    >
                        {t('POI', lang)}
                    </button>
                    <button
                        type='button'
                        className={`left-panel-tab left-panel-tab-metadata${tab === 'metadata' ? ' active' : ''}`}
                        onClick={() => this.setState({ tab: 'metadata' })}
                    >
                        {t('Metadata (Dublin Core)', lang)}
                    </button>
                </div>

                <div className='left-panel-tab-content'>
                    {tab === 'scene' && (
                        <>
                            <CameraPanel observerData={observerData} setProperty={setProperty} />
                            <SkyboxPanel observerData={observerData} setProperty={setProperty} />
                            <LightPanel observerData={observerData} setProperty={setProperty} />
                            <SettingsPanel observerData={observerData} setProperty={setProperty} />
                            <div id='export-settings-row'>
                                <Button
                                    class={['secondary', 'export-settings-button']}
                                    text={t('Export viewer settings', lang)}
                                    onClick={() => exportViewerSettings(observerData)}
                                />
                            </div>
                        </>
                    )}
                    {tab === 'materials' && (
                        <Panel headerText={t('Materials', lang)} id='materials-panel' flexShrink={'0'} collapsible={false}>
                            <div className='materials-layer-list'>
                                {renderModeCategories(
                                    new Set(JSON.parse(observerData?.scene?.materialChannelsWithTextures ?? '[]')),
                                    observerData?.debug?.withTextureOnly ?? false,
                                    (() => {
                                        try {
                                            return JSON.parse(observerData?.scene?.materialChannelFilenames ?? '{}');
                                        } catch {
                                            return {};
                                        }
                                    })()
                                ).map((cat, ci) => (
                                    <div key={ci} className='materials-layer-category'>
                                        <div className='materials-layer-category-title'>
                                            {cat.title} ({cat.items.length})
                                        </div>
                                        {cat.title === 'MATERIAL CHANNELS' && (
                                            <Toggle
                                                label='With texturemap'
                                                value={observerData?.debug?.withTextureOnly ?? false}
                                                setProperty={(value: boolean) => setProperty('debug.withTextureOnly', value)}
                                            />
                                        )}
                                        {cat.items.map(item => (
                                            <button
                                                key={item.value}
                                                type='button'
                                                className={`materials-layer-item${item.value === 'default' ? ' materials-layer-item-final-render' : ''}${item.value === 'albedo' ? ' materials-layer-item-base-color' : ''}${item.value === 'metalness' ? ' materials-layer-item-metalness' : ''}${item.value === 'gloss' ? ' materials-layer-item-roughness' : ''}${item.value === 'world_normal' ? ' materials-layer-item-normal' : ''}${item.value === 'specularity' ? ' materials-layer-item-specular' : ''}${item.value === 'emission' ? ' materials-layer-item-emissive' : ''}${item.value === 'lighting' ? ' materials-layer-item-lighting' : ''}${item.value === 'ao' ? ' materials-layer-item-ao' : ''}${item.value === 'opacity' ? ' materials-layer-item-opacity' : ''}${(item.value === 'uv0' || item.value === 'uv_checker') ? ' materials-layer-item-uv' : ''}${observerData?.debug?.renderMode === item.value ? ' selected' : ''}`}
                                                onClick={() => setProperty('debug.renderMode', item.value)}
                                            >
                                                <span className='materials-layer-item-label'>
                                                    {item.label}
                                                    {observerData?.debug?.withTextureOnly && item.filename ? <span className='materials-layer-item-filename' title={item.filename}> {item.filename}</span> : null}
                                                </span>
                                            </button>
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
                                <div className='materials-layer-category'>
                                    <div className='materials-layer-category-title'>{t('Geometry', lang)} (2)</div>
                                    <button
                                        type='button'
                                        className={`materials-layer-item materials-layer-item-wireframe${observerData?.debug?.wireframe ? ' selected' : ''}`}
                                        onClick={() => setProperty('debug.wireframe', !observerData?.debug?.wireframe)}
                                    >
                                        {t('Wireframe', lang)}
                                    </button>
                                    <div className='materials-layer-normals-row'>
                                        <button
                                            type='button'
                                            className={`materials-layer-item materials-layer-item-vertex-normals${(observerData?.debug?.normals ?? 0) > 0 ? ' selected' : ''}`}
                                            onClick={() => setProperty('debug.normals', (observerData?.debug?.normals ?? 0) > 0 ? 0 : 1)}
                                        >
                                            {t('Vertex Normals', lang)}
                                        </button>
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
                            </div>
                            {observerData?.debug?.wireframe && (
                                <ColorPickerControl
                                    label={t('Wireframe Color', lang)}
                                    value={rgbToArr(observerData?.debug?.wireframeColor ?? { r: 0, g: 0, b: 0 })}
                                    setProperty={(value: number[]) => setProperty('debug.wireframeColor', arrToRgb(value))} />
                            )}
                        </Panel>
                    )}
                    {tab === 'poi' && <div id='left-tab-poi' />}
                    {tab === 'metadata' && <MetadataPanel observerData={observerData} setProperty={setProperty} />}
                </div>

                <div id='scene-scrolly-bits' />
            </Container>
        );
    }
}

export default LeftPanel;
