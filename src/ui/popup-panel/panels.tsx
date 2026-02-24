import { Container, Button, Label, TextInput, TreeView, TreeViewItem } from '@playcanvas/pcui/react';
// @ts-ignore no type defs included
import QRious from 'qrious';
import React from 'react';

import { extract, addEventListenerOnClickOnly } from '../../helpers';
import { SetProperty, ObserverData, HierarchyNode } from '../../types';
import { Detail, Slider, Toggle, Select, ColorPickerControl, ToggleColor, Numeric, Vector } from '../components';
import MorphTargetPanel from '../left-panel/morph-target-panel';

declare global {
    interface Navigator {
      readonly gpu: any;
    }
}

const bytesToSizeString = (bytes: number): string => {
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    if (bytes === 0) return 'n/a';
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), sizes.length - 1);
    return (i === 0) ? `${bytes} ${sizes[i]}` : `${(bytes / (1024 ** i)).toFixed(1)} ${sizes[i]}`;
};

type InfoTab = 'controls' | 'model' | 'about';
type ControlsSubTab = 'desktop' | 'touch';

class InfoPanel extends React.Component <{
    observerData: ObserverData,
    setProperty: SetProperty }> {
    state: { tab: InfoTab; controlsSubTab: ControlsSubTab } = { tab: 'controls', controlsSubTab: 'desktop' };

    render() {
        const { observerData, setProperty } = this.props;
        if (!observerData) return null;
        const scene = observerData.scene;
        let variantListOptions: Array<{ v: string, t: string }> = [];
        try {
            const parsed = JSON.parse(scene?.variants?.list || '[]');
            variantListOptions = Array.isArray(parsed) ? parsed.map((v: string) => ({ v: String(v), t: String(v) })) : [];
        } catch {
            variantListOptions = [];
        }
        const hasModel = Boolean(scene && scene.nodes !== '[]');

        return (
            <div className='popup-panel-parent info-panel-parent' hidden={observerData?.ui?.active !== 'info'}>
                <Container class={['popup-panel', 'info-panel']} flex>
                    <div className='info-panel-tabs'>
                        <button
                            type='button'
                            className={'info-tab' + (this.state.tab === 'controls' ? ' active' : '')}
                            onClick={() => this.setState({ tab: 'controls' })}
                        >
                            Controls
                        </button>
                        <button
                            type='button'
                            className={'info-tab' + (this.state.tab === 'model' ? ' active' : '')}
                            onClick={() => this.setState({ tab: 'model' })}
                        >
                            Model
                        </button>
                        <button
                            type='button'
                            className={'info-tab' + (this.state.tab === 'about' ? ' active' : '')}
                            onClick={() => this.setState({ tab: 'about' })}
                        >
                            About
                        </button>
                    </div>
                    {this.state.tab === 'controls' && (
                        <>
                            <div className='info-panel-subtabs'>
                                <button
                                    type='button'
                                    className={'info-subtab' + (this.state.controlsSubTab === 'desktop' ? ' active' : '')}
                                    onClick={() => this.setState({ controlsSubTab: 'desktop' })}
                                >
                                    Desktop
                                </button>
                                <button
                                    type='button'
                                    className={'info-subtab' + (this.state.controlsSubTab === 'touch' ? ' active' : '')}
                                    onClick={() => this.setState({ controlsSubTab: 'touch' })}
                                >
                                    Touch
                                </button>
                            </div>
                            {this.state.controlsSubTab === 'desktop' ? (
                                <div className='info-controls-content'>
                                    <Label text='Orbit Mode' class='popup-panel-heading' />
                                    <Detail label='Orbit' value='Left Mouse' />
                                    <Detail label='Pan' value='Right Mouse' />
                                    <Detail label='Zoom' value='Mouse Wheel' />
                                    <Detail label='Set Focus' value='Double Click' />
                                    <Label text='Fly Mode' class='popup-panel-heading' />
                                    <Detail label='Look Around' value='Left Mouse' />
                                    <Detail label='Fly' value='W, S, A, D' />
                                    <Label text='General' class='popup-panel-heading' />
                                    <Container class='panel-option'>
                                        <Label class='panel-label' text='Frame Scene' />
                                        <div className='panel-value' style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                            <Label text='F' />
                                            <Button
                                                class={['fit-screen-button', 'fit-screen-button-inline']}
                                                width={28}
                                                height={28}
                                                onClick={() => window.viewer?.frameScene?.()}
                                            />
                                        </div>
                                    </Container>
                                    <Container class='panel-option'>
                                        <Label class='panel-label' text='Reset Camera' />
                                        <div className='panel-value' style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                            <Label text='R' />
                                            <Button
                                                class={['reset-camera-button', 'reset-camera-button-inline']}
                                                width={28}
                                                height={28}
                                                onClick={() => window.viewer?.resetCamera?.()}
                                            />
                                        </div>
                                    </Container>
                                </div>
                            ) : (
                                <div className='info-controls-content'>
                                    <Label text='Orbit Mode' class='popup-panel-heading' />
                                    <Detail label='Orbit' value='One Finger Drag' />
                                    <Detail label='Pan' value='Two Finger Drag' />
                                    <Detail label='Zoom' value='Pinch' />
                                    <Detail label='Set Focus' value='Double Tap' />
                                    <Label text='Fly Mode' class='popup-panel-heading' />
                                    <Detail label='Look Around' value='Touch on Right' />
                                    <Detail label='Fly' value='Touch on Left' />
                                </div>
                            )}
                        </>
                    )}
                    {this.state.tab === 'model' && (
                        <div className='info-panel-model-combined'>
                            <Label text='Model' class='popup-panel-heading' />
                            {hasModel ? (
                                <>
                                    <Detail label='Filename' value={scene.filenames?.join(', ') || '-'} />
                                    <Detail label='Meshes' value={scene.meshCount ?? '-'} />
                                    <Detail label='Materials' value={scene.materialCount ?? '-'} />
                                    <Detail label='Textures' value={scene.textureCount ?? '-'} />
                                    <Detail label='Primitives' value={scene.primitiveCount ?? '-'} />
                                    <Detail label='Verts' value={scene.vertexCount ?? '-'} />
                                    <Detail label='Mesh VRAM' value={bytesToSizeString(scene.meshVRAM ?? 0)} />
                                    <Detail label='Texture VRAM' value={bytesToSizeString(scene.textureVRAM ?? 0)} />
                                    <Detail label='Load time' value={scene.loadTime ?? '-'} />
                                    {scene.bounds && typeof scene.bounds === 'object' ? (
                                        <Vector label='Bounds' dimensions={3} value={scene.bounds} enabled={false} />
                                    ) : (
                                        <Detail label='Bounds' value='-' />
                                    )}
                                    <Select
                                        label='Variant'
                                        type='string'
                                        options={variantListOptions}
                                        value={scene.variant?.selected ?? ''}
                                        setProperty={(value: string) => setProperty('scene.variant.selected', value)}
                                        enabled={variantListOptions.length > 0}
                                    />
                                </>
                            ) : (
                                <div style={{ color: '#888', fontSize: 13 }}>No model loaded. Drag & drop a glTF/GLB file.</div>
                            )}
                            <Label text='Hierarchy' class='popup-panel-heading' />
                            {hasModel ? (() => {
                                let modelHierarchy: Array<HierarchyNode> = [];
                                try {
                                    modelHierarchy = JSON.parse(scene.nodes || '[]');
                                    if (!Array.isArray(modelHierarchy)) modelHierarchy = [];
                                } catch {
                                    modelHierarchy = [];
                                }
                                const mapNodes = (nodes: Array<HierarchyNode>) =>
                                    nodes.map((node: HierarchyNode) => (
                                        <TreeViewItem
                                            key={node.path}
                                            text={node.name}
                                            onSelect={(tv: any) => {
                                                setProperty('scene.selectedNode.path', node.path);
                                                const remove = addEventListenerOnClickOnly(document.body, () => {
                                                    tv.selected = false;
                                                    remove();
                                                }, 4);
                                            }}
                                            onDeselect={() => setProperty('scene.selectedNode.path', '')}
                                        >
                                            {mapNodes(node.children || [])}
                                        </TreeViewItem>
                                    ));
                                return modelHierarchy.length > 0 ? (
                                    <div className='info-panel-hierarchy'>
                                        <TreeView allowReordering={false} allowDrag={false}>
                                            {mapNodes(modelHierarchy)}
                                        </TreeView>
                                    </div>
                                ) : (
                                    <div style={{ color: '#888', fontSize: 13 }}>No hierarchy data.</div>
                                );
                            })() : (
                                <div style={{ color: '#888', fontSize: 13 }}>No model loaded.</div>
                            )}
                            <Label text='Stats' class='popup-panel-heading' />
                            <Toggle
                                label='Show performance stats'
                                value={observerData?.debug?.stats ?? false}
                                setProperty={(value: boolean) => setProperty('debug.stats', value)}
                            />
                            <MorphTargetPanel
                                morphs={observerData.morphs}
                                progress={observerData.animation?.progress ?? 0}
                                setProperty={setProperty}
                            />
                        </div>
                    )}
                    {this.state.tab === 'about' && (
                        <div className='info-about-block'>
                            <Label text='About' class='popup-panel-heading' />
                            <div className='about-title'>HERITAGE3D Viewer v1.0</div>
                            <div className='about-description'>
                                This viewer is a modified version of the open-source project
                                PlayCanvas Model Viewer (MIT License):
                            </div>
                            <a href='https://github.com/playcanvas/model-viewer' target='_blank' rel='noopener noreferrer' className='about-link'>https://github.com/playcanvas/model-viewer</a>
                            <div className='about-description'>
                                UI components are based on
                                PlayCanvas PCUI (MIT License):
                            </div>
                            <a href='https://github.com/playcanvas/pcui' target='_blank' rel='noopener noreferrer' className='about-link'>https://github.com/playcanvas/pcui</a>
                            <div className='about-project'>HERITAGE3D.RU Project</div>
                        </div>
                    )}
                </Container>
            </div>
        );
    }
}

const rgbToArr = (rgb: { r: number, g: number, b: number }) => [rgb.r, rgb.g, rgb.b, 1];
const arrToRgb = (arr: number[]) => {
    return { r: arr[0], g: arr[1], b: arr[2] };
};

class MeasurementsPanel extends React.Component <{
    observerData: ObserverData,
    setProperty: SetProperty }> {
    shouldComponentUpdate(nextProps: Readonly<{
        observerData: ObserverData;
        setProperty: SetProperty; }>): boolean {
        return JSON.stringify(nextProps.observerData.measure) !== JSON.stringify(this.props.observerData.measure) ||
               JSON.stringify(nextProps.observerData.ui) !== JSON.stringify(this.props.observerData.ui);
    }

    render() {
        const props = this.props;
        const measureData = props.observerData.measure;
        const meters = measureData.lastDistance;
        const factor = measureData.unit === 'mm' ? 1000 : (measureData.unit === 'cm' ? 100 : 1);
        const precision = measureData.unit === 'mm' ? 0 : 2;
        const measuredValue = meters === null ? '-' : `${(meters * factor).toFixed(precision)} ${measureData.unit}`;

        return (
            <div className='popup-panel-parent'>
                <Container class='popup-panel' flex hidden={props.observerData.ui.active !== 'measurement'}>
                    <Label text='Measurement' class='popup-panel-heading' />
                    <Toggle
                        label='Measure Mode'
                        value={measureData.enabled}
                        setProperty={(value: boolean) => props.setProperty('measure.enabled', value)}
                    />
                    <Select
                        label='Units'
                        type='string'
                        options={[
                            { t: 'millimeters (mm)', v: 'mm' },
                            { t: 'centimeters (cm)', v: 'cm' },
                            { t: 'meters (m)', v: 'm' }
                        ]}
                        value={measureData.unit}
                        setProperty={(value: 'mm' | 'cm' | 'm') => props.setProperty('measure.unit', value)}
                    />
                    <Numeric
                        label='1 Unit = (m)'
                        value={measureData.unitScale}
                        min={0.000001}
                        max={1000000}
                        setProperty={(value: number) => props.setProperty('measure.unitScale', Math.max(0.000001, value))}
                    />
                    <Numeric
                        label={`Known distance (${measureData.unit})`}
                        value={measureData.knownDistance ?? 0}
                        min={0}
                        max={1e9}
                        setProperty={(value: number) => props.setProperty('measure.knownDistance', Math.max(0, value))}
                    />
                    <Button
                        class='secondary'
                        text='RECALCULATE SCENE SIZE'
                        onClick={() => {
                            if (window.viewer) window.viewer.recalculateSceneSize();
                        }}
                        enabled={measureData.lastDistance != null && measureData.lastDistance > 0 && (measureData.knownDistance ?? 0) > 0}
                    />
                    <Detail label='Last Distance' value={measuredValue} />
                    <Detail label='Points' value={measureData.pointCount === 0 ? 'Pick first point' : 'Pick second point'} />
                    <Button
                        class='secondary'
                        text='CLEAR MEASUREMENT'
                        onClick={() => {
                            if (window.viewer) window.viewer.clearMeasurement();
                        }}
                    />
                </Container>
            </div>
        );
    }
}

class ViewPanel extends React.Component <{
    sceneData: ObserverData['scene'],
    uiData: ObserverData['ui'],
    runtimeData: ObserverData['runtime'],
    setProperty: SetProperty }> {
    isMobile: boolean;

    get shareUrl() {
        return `${location.origin}${location.pathname}?${this.props.sceneData.urls.map((url: string) => `load=${url}`).join('&')}`;
    }

    constructor(props: any) {
        super(props);
        this.isMobile = (/Android|webOS|iPhone|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent));
    }

    shouldComponentUpdate(nextProps: Readonly<{
        sceneData: ObserverData['scene'];
        uiData: ObserverData['ui'];
        setProperty: SetProperty; }>): boolean {
        return JSON.stringify(nextProps.sceneData) !== JSON.stringify(this.props.sceneData) ||
               JSON.stringify(nextProps.uiData) !== JSON.stringify(this.props.uiData);
    }

    get hasQRCode() {
        return this.props.sceneData.urls.length > 0 && !this.isMobile;
    }

    updateQRCode() {
        const canvas = document.getElementById('share-qr') as HTMLCanvasElement;
        const qr = new QRious({
            element: canvas,
            value: this.shareUrl,
            size: canvas.getBoundingClientRect().width * window.devicePixelRatio
        });
    }

    componentDidMount() {
        if (this.hasQRCode) {
            this.updateQRCode();
        }
    }

    componentDidUpdate(): void {
        if (this.hasQRCode) {
            this.updateQRCode();
        }
    }

    render() {
        const props = this.props;
        return (
            <div className='popup-panel-parent'>
                <Container id='view-panel' class='popup-panel' flex hidden={props.uiData.active !== 'view'}>
                    { this.hasQRCode ?
                        <>
                            <Label text='View and share on mobile with QR code' />
                            <div id='qr-wrapper'>
                                <canvas id='share-qr' />
                            </div>
                            <Label text='View and share on mobile with URL' />
                            <div id='share-url-wrapper'>
                                <TextInput class='secondary' value={this.shareUrl} enabled={false} />
                                <Button id='copy-button' icon='E126' onClick={() => {
                                    if (navigator.clipboard && window.isSecureContext) {
                                        navigator.clipboard.writeText(this.shareUrl);
                                    }
                                }}/>
                            </div>
                        </> : null }
                    <Button
                        class='secondary'
                        text='TAKE A SNAPSHOT AS PNG'
                        onClick={() => {
                            if (window.viewer) window.viewer.downloadPngScreenshot();
                        }}
                    />
                    <Button
                        class='secondary'
                        text='COVER IMAGE (1:1)'
                        onClick={() => {
                            if (window.viewer) window.viewer.downloadCoverImageScreenshot();
                        }}
                    />
                    <Button
                        class='secondary'
                        text='EXPORT VIEWER SETTINGS'
                        onClick={() => {
                            if (window.viewer) window.viewer.exportViewerSettings();
                        }}
                    />
                </Container>
            </div>
        );
    }
}

export {
    InfoPanel,
    MeasurementsPanel,
    ViewPanel
};
