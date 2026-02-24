import { Panel, Container, Button } from '@playcanvas/pcui/react';
import React from 'react';

import { extract } from '../../helpers';
import { SetProperty, ObserverData } from '../../types';
import { Detail, Select, Slider, Toggle, ColorPickerControl, Numeric, ToggleColor } from '../components';

const rgbToArr = (rgb: { r: number, g: number, b: number }) => [rgb.r, rgb.g, rgb.b, 1];
const arrToRgb = (arr: number[]) => ({ r: arr[0], g: arr[1], b: arr[2] });

const exportViewerSettings = (observerData: ObserverData) => {
    const settings = {
        camera: observerData.camera,
        skybox: observerData.skybox,
        light: observerData.light,
        debug: observerData.debug,
        shadowCatcher: observerData.shadowCatcher,
        measure: observerData.measure,
        enableWebGPU: observerData.enableWebGPU
    };
    const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'model-viewer-settings.json';
    a.click();
    URL.revokeObjectURL(url);
};

type LeftPanelTab = 'scene' | 'materials' | 'poi';

const toggleCollapsed = () => {
    const leftPanel = document.getElementById('panel-left');
    if (leftPanel) {
        leftPanel.classList.toggle('collapsed');
    }
};

class CameraPanel extends React.Component <{ observerData: ObserverData, setProperty: SetProperty }> {
    shouldComponentUpdate(nextProps: Readonly<{ observerData: ObserverData; setProperty: SetProperty; }>): boolean {
        const keys = ['ui', 'camera', 'debug', 'animation.playing', 'scene.cameras', 'scene.selectedCamera', 'runtime'];
        const a = extract(nextProps.observerData, keys);
        const b = extract(this.props.observerData, keys);
        return JSON.stringify(a) !== JSON.stringify(b);
    }

    render() {
        const props = this.props;
        const sceneCameras: Array<{ name: string, path: string }> = JSON.parse(props.observerData.scene?.cameras || '[]');
        const cameraOptions = [{ v: 'viewer', t: 'Viewer' }].concat(
            sceneCameras.map(c => ({ v: c.path, t: c.name }))
        );
        const selectedCamera = props.observerData.scene?.selectedCamera || 'viewer';
        const isViewerCamera = selectedCamera === 'viewer';

        return (
            <Panel headerText='CAMERA' id='camera-panel' flexShrink={'0'} flexGrow={'0'} collapsible={false}>
                <Select
                    selectKey={props.observerData.scene?.cameras}
                    label='Active Camera'
                    type='string'
                    options={cameraOptions}
                    value={selectedCamera}
                    setProperty={(value: string) => props.setProperty('scene.selectedCamera', value === 'viewer' ? '' : value)}
                    enabled={sceneCameras.length > 0} />
                <Slider
                    label='Fov'
                    precision={0}
                    min={35}
                    max={150}
                    value={props.observerData.camera.fov}
                    setProperty={(value: number) => props.setProperty('camera.fov', value)}
                    enabled={isViewerCamera} />
                <Select
                    label='Tonemap'
                    type='string'
                    options={['None', 'Linear', 'Neutral', 'Filmic', 'Hejl', 'ACES', 'ACES2'].map(v => ({ v, t: v }))}
                    value={props.observerData.camera.tonemapping}
                    setProperty={(value: string) => props.setProperty('camera.tonemapping', value)} />
                <Select
                    label='Pixel Scale'
                    value={props.observerData.camera.pixelScale}
                    type='number'
                    options={[1, 2, 4, 8, 16].map(v => ({ v: v, t: Number(v).toString() }))}
                    setProperty={(value: number) => props.setProperty('camera.pixelScale', value)} />
                <Detail label='Viewport' value={`${props.observerData.runtime?.viewportWidth ?? 0} x ${props.observerData.runtime?.viewportHeight ?? 0}`} />
                <Toggle
                    label='Multisample'
                    value={props.observerData.camera.multisample}
                    enabled={props.observerData.camera.multisampleSupported}
                    setProperty={(value: boolean) => props.setProperty('camera.multisample', value)}
                />
                <Toggle
                    label='HD'
                    value={props.observerData.camera.hq}
                    setProperty={(value: boolean) => props.setProperty('camera.hq', value)}
                />
            </Panel>
        );
    }
}

class SkyboxPanel extends React.Component <{ observerData: ObserverData, setProperty: SetProperty }> {
    shouldComponentUpdate(nextProps: Readonly<{ observerData: ObserverData; setProperty: SetProperty; }>): boolean {
        return JSON.stringify(nextProps.observerData.skybox) !== JSON.stringify(this.props.observerData.skybox);
    }

    render() {
        const props = this.props;
        const skybox = props.observerData.skybox;

        return (
            <Panel headerText='SKY' id='sky-panel' flexShrink={'0'} flexGrow={'0'} collapsible={false}>
                <Select
                    label='Environment'
                    type='string'
                    options={JSON.parse(skybox?.options || '[]')}
                    value={skybox?.value}
                    setProperty={(value: string) => props.setProperty('skybox.value', value)} />
                <Slider
                    label='Exposure'
                    value={skybox?.exposure ?? 0}
                    setProperty={(value: number) => props.setProperty('skybox.exposure', value)}
                    precision={2}
                    min={-6}
                    max={6}
                    enabled={skybox?.value !== 'None'} />
                <Slider
                    label='Rotation'
                    precision={0}
                    min={-180}
                    max={180}
                    value={skybox?.rotation ?? 0}
                    setProperty={(value: number) => props.setProperty('skybox.rotation', value)}
                    enabled={skybox?.value !== 'None'} />
                <Select
                    label='Background'
                    type='string'
                    options={['Solid Color', 'Infinite Sphere', 'Projective Dome', 'Projective Box'].map(v => ({ v, t: v }))}
                    value={skybox?.background}
                    setProperty={(value: string) => props.setProperty('skybox.background', value)}
                    enabled={skybox?.value !== 'None'} />
                <ColorPickerControl
                    label='Background Color'
                    value={rgbToArr(skybox?.backgroundColor ?? { r: 0.5, g: 0.6, b: 0.68 })}
                    setProperty={(value: number[]) => props.setProperty('skybox.backgroundColor', arrToRgb(value))}
                    enabled={skybox?.value === 'None' || skybox?.background === 'Solid Color'} />
                <Slider
                    label='Blur'
                    value={skybox?.blur ?? 1}
                    setProperty={(value: number) => props.setProperty('skybox.blur', value)}
                    enabled={skybox?.value !== 'None' && skybox?.background === 'Infinite Sphere'}
                    min={0}
                    max={5}
                    precision={0}
                    step={1} />
                <Numeric
                    label='Scale'
                    value={skybox?.domeProjection?.domeRadius ?? 20}
                    setProperty={(value: number) => props.setProperty('skybox.domeProjection.domeRadius', value)}
                    min={0}
                    max={1000}
                    enabled={skybox?.value !== 'None' && ['Projective Dome', 'Projective Box'].indexOf(skybox?.background ?? '') !== -1} />
                <Slider
                    label='Tripod Offset'
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
               JSON.stringify(nextProps.observerData.shadowCatcher) !== JSON.stringify(this.props.observerData.shadowCatcher);
    }

    render() {
        const props = this.props;
        const light = props.observerData.light;
        const shadowCatcher = props.observerData.shadowCatcher;

        return (
            <Panel headerText='LIGHT' id='light-panel' flexShrink={'0'} flexGrow={'0'} collapsible={false}>
                <Toggle
                    label='Enabled'
                    value={light?.enabled ?? true}
                    setProperty={(value: boolean) => props.setProperty('light.enabled', value)} />
                <Toggle
                    label='Follow Camera'
                    value={light?.follow ?? false}
                    setProperty={(value: boolean) => props.setProperty('light.follow', value)} />
                <ColorPickerControl
                    label='Color'
                    value={rgbToArr(light?.color ?? { r: 1, g: 1, b: 1 })}
                    setProperty={(value: number[]) => props.setProperty('light.color', arrToRgb(value))} />
                <Slider
                    label='Intensity'
                    precision={2}
                    min={0}
                    max={6}
                    value={light?.intensity ?? 1}
                    setProperty={(value: number) => props.setProperty('light.intensity', value)} />
                <Toggle
                    label='Cast Shadow'
                    value={light?.shadow ?? true}
                    setProperty={(value: boolean) => props.setProperty('light.shadow', value)} />
                <Toggle
                    label='Shadow Catcher'
                    value={shadowCatcher?.enabled ?? true}
                    setProperty={(value: boolean) => props.setProperty('shadowCatcher.enabled', value)} />
                <Slider
                    label='Catcher Intensity'
                    precision={2}
                    min={0}
                    max={1}
                    value={shadowCatcher?.intensity ?? 0.4}
                    setProperty={(value: number) => props.setProperty('shadowCatcher.intensity', value)} />
            </Panel>
        );
    }
}

const renderModeCategories: Array<{
    title: string;
    items: Array<{ label: string; value: string }>;
}> = [
    { title: 'RENDER', items: [{ label: 'Final Render', value: 'default' }] },
    {
        title: 'MATERIAL CHANNELS',
        items: [
            { label: 'Base Color', value: 'albedo' },
            { label: 'Metalness', value: 'metalness' },
            { label: 'Roughness', value: 'gloss' },
            { label: 'Normal Map', value: 'world_normal' },
            { label: 'Specular F0', value: 'specularity' },
            { label: 'Emissive', value: 'emission' },
            { label: 'Lighting', value: 'lighting' },
            { label: 'AO', value: 'ao' },
            { label: 'Opacity', value: 'opacity' }
        ]
    },
    { title: 'UV', items: [{ label: 'UV Checker', value: 'uv0' }] }
];

class SettingsPanel extends React.Component <{ observerData: ObserverData, setProperty: SetProperty }> {
    shouldComponentUpdate(nextProps: Readonly<{ observerData: ObserverData; setProperty: SetProperty; }>): boolean {
        return JSON.stringify(nextProps.observerData.debug) !== JSON.stringify(this.props.observerData.debug) ||
               nextProps.observerData.enableWebGPU !== this.props.observerData.enableWebGPU ||
               nextProps.observerData.runtime.activeDeviceType !== this.props.observerData.runtime.activeDeviceType;
    }

    render() {
        const props = this.props;
        const debugData = props.observerData.debug;
        const activeDevice = props.observerData.runtime?.activeDeviceType;

        return (
            <Panel headerText='SETTINGS' id='settings-panel' flexShrink={'0'} flexGrow={'0'} collapsible={false}>
                <Detail label='Current Device' value={activeDevice === 'webgpu' ? 'WebGPU' : 'WebGL 2'} />
                <Toggle
                    label='Use WebGPU'
                    value={props.observerData.enableWebGPU}
                    enabled={typeof navigator !== 'undefined' && navigator.gpu !== undefined}
                    setProperty={(value: boolean) => {
                        if (value === props.observerData.enableWebGPU) return;
                        const message = value ?
                            'Enable WebGPU? The page will refresh to apply this change.' :
                            'Disable WebGPU? The page will refresh to apply this change.';
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
                    label='Grid'
                    value={debugData?.grid ?? false}
                    setProperty={(value: boolean) => props.setProperty('debug.grid', value)} />
                <Toggle
                    label='Axes'
                    value={debugData?.axes ?? false}
                    setProperty={(value: boolean) => props.setProperty('debug.axes', value)} />
                <Toggle
                    label='Skeleton'
                    value={debugData?.skeleton ?? false}
                    setProperty={(value: boolean) => props.setProperty('debug.skeleton', value)} />
                <Toggle
                    label='Bounds'
                    value={debugData?.bounds ?? false}
                    setProperty={(value: boolean) => props.setProperty('debug.bounds', value)} />
            </Panel>
        );
    }
}

class LeftPanel extends React.Component <{ observerData: ObserverData, setProperty: SetProperty }> {
    state: { tab: LeftPanelTab } = { tab: 'scene' };

    shouldComponentUpdate(nextProps: Readonly<{ observerData: ObserverData; setProperty: SetProperty; }>, nextState: { tab: LeftPanelTab }): boolean {
        const keys = ['camera', 'debug', 'scene.cameras', 'scene.selectedCamera', 'runtime', 'skybox', 'light', 'shadowCatcher', 'enableWebGPU'];
        const a = extract(nextProps.observerData, keys);
        const b = extract(this.props.observerData, keys);
        return JSON.stringify(a) !== JSON.stringify(b) || nextState.tab !== this.state.tab;
    }

    componentDidMount(): void {
        document.getElementById('panel-toggle')?.addEventListener('click', () => toggleCollapsed());
        document.getElementById('title')?.addEventListener('click', () => toggleCollapsed());
        setTimeout(() => toggleCollapsed());
    }

    render() {
        const { tab } = this.state;
        const { observerData, setProperty } = this.props;

        return (
            <Container id='scene-container' flex class='left-panel-tabs-container'>
                <div className='left-panel-tabs'>
                    <button
                        type='button'
                        className={'left-panel-tab left-panel-tab-scene' + (tab === 'scene' ? ' active' : '')}
                        onClick={() => this.setState({ tab: 'scene' })}
                    >
                        Settings
                    </button>
                    <button
                        type='button'
                        className={'left-panel-tab left-panel-tab-materials' + (tab === 'materials' ? ' active' : '')}
                        onClick={() => this.setState({ tab: 'materials' })}
                    >
                        Materials
                    </button>
                    <button
                        type='button'
                        className={'left-panel-tab left-panel-tab-poi' + (tab === 'poi' ? ' active' : '')}
                        onClick={() => this.setState({ tab: 'poi' })}
                    >
                        POI
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
                                    class='secondary'
                                    text='Export viewer settings'
                                    onClick={() => exportViewerSettings(observerData)}
                                />
                            </div>
                        </>
                    )}
                    {tab === 'materials' && (
                        <Panel headerText='MATERIALS' id='materials-panel' flexShrink={'0'} collapsible={false}>
                            <div className='materials-layer-list'>
                                {renderModeCategories.map((cat, ci) => (
                                    <div key={ci} className='materials-layer-category'>
                                        <div className='materials-layer-category-title'>
                                            {cat.title} ({cat.items.length})
                                        </div>
                                        {cat.items.map((item) => (
                                            <button
                                                key={item.value}
                                                type='button'
                                                className={'materials-layer-item' + (observerData?.debug?.renderMode === item.value ? ' selected' : '')}
                                                onClick={() => setProperty('debug.renderMode', item.value)}
                                            >
                                                {item.label}
                                            </button>
                                        ))}
                                    </div>
                                ))}
                                <div className='materials-layer-category'>
                                <div className='materials-layer-category-title'>GEOMETRY (2)</div>
                                <button
                                    type='button'
                                    className={'materials-layer-item' + (observerData?.debug?.wireframe ? ' selected' : '')}
                                    onClick={() => setProperty('debug.wireframe', !observerData?.debug?.wireframe)}
                                >
                                    Wireframe
                                </button>
                                <div className='materials-layer-normals-row'>
                                    <button
                                        type='button'
                                        className={'materials-layer-item' + ((observerData?.debug?.normals ?? 0) > 0 ? ' selected' : '')}
                                        onClick={() => setProperty('debug.normals', (observerData?.debug?.normals ?? 0) > 0 ? 0 : 1)}
                                    >
                                        Vertex Normals
                                    </button>
                                    {(observerData?.debug?.normals ?? 0) > 0 && (
                                        <Slider
                                            label=''
                                            precision={2}
                                            min={0}
                                            max={1}
                                            value={observerData?.debug?.normals ?? 0}
                                            setProperty={(value: number) => setProperty('debug.normals', value)} />
                                    )}
                                </div>
                                </div>
                            </div>
                            {observerData?.debug?.wireframe && (
                                <ColorPickerControl
                                    label='Wireframe Color'
                                    value={rgbToArr(observerData?.debug?.wireframeColor ?? { r: 0, g: 0, b: 0 })}
                                    setProperty={(value: number[]) => setProperty('debug.wireframeColor', arrToRgb(value))} />
                            )}
                        </Panel>
                    )}
                    {tab === 'poi' && <div id='left-tab-poi' />}
                </div>

                <div id='scene-scrolly-bits' />
            </Container>
        );
    }
}

export default LeftPanel;
