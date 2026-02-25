import { Container, Button, Label, TextInput, TreeView, TreeViewItem } from '@playcanvas/pcui/react';
// @ts-ignore no type defs included
import QRious from 'qrious';
import React from 'react';

import { extract, addEventListenerOnClickOnly } from '../../helpers';
import { t } from '../../i18n/translations';
import { SetProperty, ObserverData, HierarchyNode } from '../../types';
import { Detail, Slider, Toggle, Select, ColorPickerControl, ToggleColor, Numeric, Vector } from '../components';

const ControlDetail = (props: { label: string, value: string, icon?: string, icons?: string[], useMouseIcon?: boolean, trackpadIcon?: '1' | '2', swipeIcon?: 'left' | 'right' }) => {
    const iconList = props.icons || (props.icon ? [props.icon] : []);
    return (
        <Container class={['panel-option', 'control-detail']}>
            <Label class='panel-label' text={props.label} />
            <div className='panel-value control-value'>
                {props.useMouseIcon && <span className='control-icon control-icon-mouse' />}
                {props.trackpadIcon === '1' && <span className='control-icon control-icon-trackpad-1' />}
                {props.trackpadIcon === '2' && <span className='control-icon control-icon-trackpad-2' />}
                {props.swipeIcon === 'left' && <span className='control-icon control-icon-swipe-left' />}
                {props.swipeIcon === 'right' && <span className='control-icon control-icon-swipe-right' />}
                {iconList.map((ic) => (
                    <span key={ic} className='material-symbols-outlined control-icon'>{ic}</span>
                ))}
                <span>{props.value}</span>
            </div>
        </Container>
    );
};
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
        const lang = observerData?.ui?.language;
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
                            {t('Controls', lang)}
                        </button>
                        <button
                            type='button'
                            className={'info-tab' + (this.state.tab === 'model' ? ' active' : '')}
                            onClick={() => this.setState({ tab: 'model' })}
                        >
                            {t('Model', lang)}
                        </button>
                        <button
                            type='button'
                            className={'info-tab' + (this.state.tab === 'about' ? ' active' : '')}
                            onClick={() => this.setState({ tab: 'about' })}
                        >
                            {t('About', lang)}
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
                                    {t('Desktop', lang)}
                                </button>
                                <button
                                    type='button'
                                    className={'info-subtab' + (this.state.controlsSubTab === 'touch' ? ' active' : '')}
                                    onClick={() => this.setState({ controlsSubTab: 'touch' })}
                                >
                                    {t('Touch', lang)}
                                </button>
                            </div>
                            {this.state.controlsSubTab === 'desktop' ? (
                                <div className='info-controls-content'>
                                    <Label text={t('Orbit Mode', lang)} class='popup-panel-heading' />
                                    <ControlDetail label={t('Orbit', lang)} value={t('Left Mouse', lang)} useMouseIcon icons={['right_click']} />
                                    <ControlDetail label={t('Pan', lang)} value={t('Right Mouse', lang)} useMouseIcon icons={['left_click']} />
                                    <ControlDetail label={t('Zoom', lang)} value={t('Mouse Wheel', lang)} useMouseIcon icons={['swap_vert']} />
                                    <ControlDetail label={t('Set Focus', lang)} value={t('Double Click', lang)} useMouseIcon icons={['touch_double']} />
                                    <Label text={t('Fly Mode', lang)} class='popup-panel-heading' />
                                    <ControlDetail label={t('Look Around', lang)} value={t('Left Mouse', lang)} useMouseIcon icons={['right_click']} />
                                    <ControlDetail label={t('Fly', lang)} value='W, S, A, D' icon='keyboard' />
                                    <Label text={t('General', lang)} class='popup-panel-heading' />
                                    <Container class={['panel-option', 'control-detail']}>
                                        <Label class='panel-label' text={t('Frame Scene', lang)} />
                                        <div className='panel-value control-value'>
                                            <span>F</span>
                                            <Button
                                                class={['fit-screen-button', 'fit-screen-button-inline']}
                                                width={28}
                                                height={28}
                                                onClick={() => window.viewer?.frameScene?.()}
                                            />
                                        </div>
                                    </Container>
                                    <Container class={['panel-option', 'control-detail']}>
                                        <Label class='panel-label' text={t('Reset Camera', lang)} />
                                        <div className='panel-value control-value'>
                                            <span>R</span>
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
                                    <Label text={t('Orbit Mode', lang)} class='popup-panel-heading' />
                                    <ControlDetail label={t('Orbit', lang)} value={t('One Finger Drag', lang)} trackpadIcon='1' />
                                    <ControlDetail label={t('Pan', lang)} value={t('Two Finger Drag', lang)} trackpadIcon='2' />
                                    <ControlDetail label={t('Zoom', lang)} value={t('Pinch', lang)} icon='pinch' />
                                    <ControlDetail label={t('Set Focus', lang)} value={t('Double Tap', lang)} icon='touch_double' />
                                    <Label text={t('Fly Mode', lang)} class='popup-panel-heading' />
                                    <ControlDetail label={t('Look Around', lang)} value={t('Touch on Right', lang)} swipeIcon='right' />
                                    <ControlDetail label={t('Fly', lang)} value={t('Touch on Left', lang)} swipeIcon='left' />
                                </div>
                            )}
                        </>
                    )}
                    {this.state.tab === 'model' && (
                        <div className='info-panel-model-combined'>
                            <Label text={t('Model', lang)} class='popup-panel-heading' />
                            {hasModel ? (
                                <>
                                    <Detail label={t('Filename', lang)} value={scene.filenames?.join(', ') || '-'} />
                                    <Detail label={t('Meshes', lang)} value={scene.meshCount ?? '-'} />
                                    <Detail label={t('Materials', lang)} value={scene.materialCount ?? '-'} />
                                    <Detail label={t('Textures', lang)} value={scene.textureCount ?? '-'} />
                                    <Detail label={t('Primitives', lang)} value={scene.primitiveCount ?? '-'} />
                                    <Detail label={t('Verts', lang)} value={scene.vertexCount ?? '-'} />
                                    <Detail label={t('Mesh VRAM', lang)} value={bytesToSizeString(scene.meshVRAM ?? 0)} />
                                    <Detail label={t('Texture VRAM', lang)} value={bytesToSizeString(scene.textureVRAM ?? 0)} />
                                    <Detail label={t('Load time', lang)} value={scene.loadTime ?? '-'} />
                                    {scene.bounds && typeof scene.bounds === 'object' ? (
                                        <Vector label={t('Bounds', lang)} dimensions={3} value={scene.bounds} enabled={false} />
                                    ) : (
                                        <Detail label={t('Bounds', lang)} value='-' />
                                    )}
                                    <Select
                                        label={t('Variant', lang)}
                                        type='string'
                                        options={variantListOptions}
                                        value={scene.variant?.selected ?? ''}
                                        setProperty={(value: string) => setProperty('scene.variant.selected', value)}
                                        enabled={variantListOptions.length > 0}
                                    />
                                </>
                            ) : (
                                <div style={{ color: '#888', fontSize: 13 }}>{t('No model loaded. Drag & drop a glTF/GLB file.', lang)}</div>
                            )}
                            <Label text={t('Hierarchy', lang)} class='popup-panel-heading' />
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
                                    <div style={{ color: '#888', fontSize: 13 }}>{t('No hierarchy data.', lang)}</div>
                                );
                            })() : (
                                <div style={{ color: '#888', fontSize: 13 }}>{t('No model loaded.', lang)}</div>
                            )}
                            <Label text={t('Stats', lang)} class='popup-panel-heading' />
                            <Toggle
                                label={t('Show performance stats', lang)}
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
                            <div className='about-header'>
                                <img src='static/heritage3d-logo.svg' alt='' className='about-logo' />
                                <div className='about-title'>HERITAGE3D Viewer v1.0</div>
                            </div>
                            <div className='about-description'>
                                {t('This viewer is a modified version of the open-source project PlayCanvas Model Viewer (MIT License):', lang)}
                            </div>
                            <a href='https://github.com/playcanvas/model-viewer' target='_blank' rel='noopener noreferrer' className='about-link'>https://github.com/playcanvas/model-viewer</a>
                            <div className='about-description'>
                                {t('UI components are based on PlayCanvas PCUI (MIT License):', lang)}
                            </div>
                            <a href='https://github.com/playcanvas/pcui' target='_blank' rel='noopener noreferrer' className='about-link'>https://github.com/playcanvas/pcui</a>
                            <div className='about-description'>
                                {t('Icons: Google Material Icons', lang)} — <a href='https://fonts.google.com/icons' target='_blank' rel='noopener noreferrer' className='about-link'>fonts.google.com/icons</a>
                            </div>
                            <div className='about-description'>
                                {t('Flags: flag-icons', lang)} — <a href='https://github.com/lipis/flag-icons' target='_blank' rel='noopener noreferrer' className='about-link'>github.com/lipis/flag-icons</a>
                            </div>
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
        const lang = props.observerData?.ui?.language;
        const meters = measureData.lastDistance;
        const factor = measureData.unit === 'mm' ? 1000 : (measureData.unit === 'cm' ? 100 : 1);
        const precision = measureData.unit === 'mm' ? 0 : 2;
        const measuredValue = meters === null ? '-' : `${(meters * factor).toFixed(precision)} ${measureData.unit}`;

        return (
            <div className='popup-panel-parent'>
                <Container class='popup-panel' flex hidden={props.observerData.ui.active !== 'measurement'}>
                    <Label text={t('Measurement', lang)} class='popup-panel-heading' />
                    <Toggle
                        label={t('Measure Mode', lang)}
                        value={measureData.enabled}
                        setProperty={(value: boolean) => props.setProperty('measure.enabled', value)}
                    />
                    <Select
                        label={t('Units', lang)}
                        type='string'
                        options={[
                            { t: t('millimeters (mm)', lang), v: 'mm' },
                            { t: t('centimeters (cm)', lang), v: 'cm' },
                            { t: t('meters (m)', lang), v: 'm' }
                        ]}
                        value={measureData.unit}
                        setProperty={(value: 'mm' | 'cm' | 'm') => props.setProperty('measure.unit', value)}
                    />
                    <Numeric
                        label={t('1 Unit = (m)', lang)}
                        value={measureData.unitScale}
                        min={0.000001}
                        max={1000000}
                        setProperty={(value: number) => props.setProperty('measure.unitScale', Math.max(0.000001, value))}
                    />
                    <Numeric
                        label={`${t('Known distance', lang)} (${measureData.unit})`}
                        value={measureData.knownDistance ?? 0}
                        min={0}
                        max={1e9}
                        setProperty={(value: number) => props.setProperty('measure.knownDistance', Math.max(0, value))}
                    />
                    <Button
                        class='secondary'
                        text={t('RECALCULATE SCENE SIZE', lang)}
                        onClick={() => {
                            if (window.viewer) window.viewer.recalculateSceneSize();
                        }}
                        enabled={measureData.lastDistance != null && measureData.lastDistance > 0 && (measureData.knownDistance ?? 0) > 0}
                    />
                    <Detail label={t('Last Distance', lang)} value={measuredValue} />
                    <Detail label={t('Points', lang)} value={measureData.pointCount === 0 ? t('Pick first point', lang) : t('Pick second point', lang)} />
                    <Button
                        class='secondary'
                        text={t('CLEAR MEASUREMENT', lang)}
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
        const lang = props.uiData?.language;
        return (
            <div className='popup-panel-parent'>
                <Container id='view-panel' class='popup-panel' flex hidden={props.uiData.active !== 'view'}>
                    { this.hasQRCode ?
                        <>
                            <Label text={t('View and share on mobile with QR code', lang)} />
                            <div id='qr-wrapper'>
                                <canvas id='share-qr' />
                            </div>
                            <Label text={t('View and share on mobile with URL', lang)} />
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
                        text={t('TAKE A SNAPSHOT AS PNG', lang)}
                        onClick={() => {
                            if (window.viewer) window.viewer.downloadPngScreenshot();
                        }}
                    />
                    <Button
                        class='secondary'
                        text={t('COVER IMAGE (1:1)', lang)}
                        onClick={() => {
                            if (window.viewer) window.viewer.downloadCoverImageScreenshot();
                        }}
                    />
                    <Button
                        class='secondary'
                        text={t('EXPORT VIEWER SETTINGS', lang)}
                        onClick={() => {
                            if (window.viewer) window.viewer.exportViewerSettings();
                        }}
                    />
                </Container>
            </div>
        );
    }
}

const DUBLIN_CORE_DISPLAY_KEYS = ['title', 'creator', 'subject', 'description', 'publisher', 'contributor', 'date', 'type', 'format', 'identifier', 'source', 'language', 'relation', 'coverage', 'rights'] as const;
const DUBLIN_CORE_LABELS: Record<string, string> = {
    title: 'Title', creator: 'Creator', subject: 'Subject', description: 'Description',
    publisher: 'Publisher', contributor: 'Contributor', date: 'Date', type: 'Type',
    format: 'Format', identifier: 'Identifier', source: 'Source', language: 'Language',
    relation: 'Relation', coverage: 'Coverage', rights: 'Rights'
};

class IDPanel extends React.Component <{
    observerData: ObserverData,
    setProperty: SetProperty }> {
    shouldComponentUpdate(nextProps: Readonly<{
        observerData: ObserverData;
        setProperty: SetProperty; }>): boolean {
        return JSON.stringify(nextProps.observerData.scene?.selectedNode) !== JSON.stringify(this.props.observerData.scene?.selectedNode) ||
               JSON.stringify(nextProps.observerData.ui) !== JSON.stringify(this.props.observerData.ui) ||
               JSON.stringify(nextProps.observerData.metadata) !== JSON.stringify(this.props.observerData.metadata);
    }

    render() {
        const props = this.props;
        const scene = props.observerData.scene;
        const metadata = props.observerData.metadata ?? {};
        const lang = props.observerData?.ui?.language;
        const path = scene?.selectedNode?.path ?? '';
        const name = scene?.selectedNode?.name ?? '';
        const filledFields = DUBLIN_CORE_DISPLAY_KEYS.filter(
            (key) => (metadata[key] !== undefined && metadata[key] !== null && String(metadata[key]).trim() !== '')
        );

        return (
            <div className='popup-panel-parent'>
                <Container class='popup-panel' flex hidden={props.observerData.ui.active !== 'id'}>
                    <Label text={t('ID', lang)} class='popup-panel-heading' />
                    {path ? (
                        <>
                            <Detail label={t('Path', lang)} value={path} />
                            <Detail label={t('Name', lang)} value={name || '-'} />
                            <Button
                                class='secondary'
                                text={t('Copy path', lang)}
                                onClick={() => {
                                    navigator.clipboard?.writeText(path);
                                }}
                            />
                        </>
                    ) : null}
                    {filledFields.length > 0 && (
                        <div className='id-panel-metadata'>
                            <Label text={t('Metadata (Dublin Core)', lang)} class='popup-panel-heading' />
                            {filledFields.map((key) => (
                                <Detail key={key} label={t(DUBLIN_CORE_LABELS[key], lang)} value={String(metadata[key])} />
                            ))}
                        </div>
                    )}
                </Container>
            </div>
        );
    }
}

export {
    InfoPanel,
    MeasurementsPanel,
    ViewPanel,
    IDPanel
};
