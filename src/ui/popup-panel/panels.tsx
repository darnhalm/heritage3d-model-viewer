import { Container, Button, Label, TreeView, TreeViewItem } from '@playcanvas/pcui/react';
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
                {iconList.map(ic => (
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
      readonly gpu: {
          requestAdapter: () => Promise<{
              requestDevice: () => Promise<{
                  createCommandEncoder: () => {
                      beginRenderPass: (descriptor: unknown) => { end: () => void };
                      finish: () => unknown;
                  };
                  queue: {
                      submit: (commands: unknown[]) => void;
                  };
              }>;
          }>;
      };
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
type EmbedGeneratorState = {
    embedType: 'responsive' | 'fixed',
    preset: 'full' | 'compact' | 'minimal',
    width: number,
    height: number,
    panel: boolean,
    autoplay: boolean,
    allowFullscreen: boolean,
    poi: boolean,
    tour: boolean,
    measure: boolean,
    info: boolean,
    modelInfo: boolean,
    controls: boolean,
    fit: boolean,
    reset: boolean,
    language: 'auto' | 'en' | 'ru' | 'zh',
    copied: boolean
};

class InfoPanel extends React.Component <{
    observerData: ObserverData,
    setProperty: SetProperty }> {
    state: { tab: InfoTab; controlsSubTab: ControlsSubTab } = { tab: 'controls', controlsSubTab: 'desktop' };

    modelHierarchyRef = React.createRef<HTMLDivElement>();

    componentDidUpdate(prevProps: Readonly<{ observerData: ObserverData }>, prevState: Readonly<{ tab: InfoTab }>) {
        const prevPath = prevProps.observerData?.scene?.selectedNode?.path ?? '';
        const path = this.props.observerData?.scene?.selectedNode?.path ?? '';
        if (path && path !== prevPath && this.state.tab === 'model') {
            const selectedEl = this.modelHierarchyRef.current?.querySelector<HTMLElement>('.pcui-treeview-item.pcui-treeview-item-selected');
            selectedEl?.scrollIntoView({ block: 'nearest' });
        } else if (this.state.tab === 'model' && prevState.tab !== 'model' && path) {
            const selectedEl = this.modelHierarchyRef.current?.querySelector<HTMLElement>('.pcui-treeview-item.pcui-treeview-item-selected');
            selectedEl?.scrollIntoView({ block: 'nearest' });
        }
    }

    render() {
        const { observerData, setProperty } = this.props;
        if (!observerData) return null;
        const scene = observerData.scene;
        const lang = observerData?.ui?.language;
        const embed = observerData?.ui?.embed;
        const showControlsTab = !(embed?.enabled) || embed.controls;
        const showModelTab = !(embed?.enabled) || embed.modelInfo;
        const showAboutTab = !(embed?.enabled) || embed.info;
        const showFitControl = !(embed?.enabled) || embed.fit;
        const showResetControl = !(embed?.enabled) || embed.reset;
        const activeTab = (() => {
            if (this.state.tab === 'controls' && showControlsTab) return 'controls';
            if (this.state.tab === 'model' && showModelTab) return 'model';
            if (this.state.tab === 'about' && showAboutTab) return 'about';
            if (showControlsTab) return 'controls';
            if (showModelTab) return 'model';
            if (showAboutTab) return 'about';
            return null;
        })();
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
                        {showControlsTab && (
                            <button
                                type='button'
                                className={`info-tab${activeTab === 'controls' ? ' active' : ''}`}
                                onClick={() => this.setState({ tab: 'controls' })}
                            >
                                {t('Controls', lang)}
                            </button>
                        )}
                        {showModelTab && (
                            <button
                                type='button'
                                className={`info-tab${activeTab === 'model' ? ' active' : ''}`}
                                onClick={() => this.setState({ tab: 'model' })}
                            >
                                {t('Model', lang)}
                            </button>
                        )}
                        {showAboutTab && (
                            <button
                                type='button'
                                className={`info-tab${activeTab === 'about' ? ' active' : ''}`}
                                onClick={() => this.setState({ tab: 'about' })}
                            >
                                {t('About', lang)}
                            </button>
                        )}
                    </div>
                    {activeTab === 'controls' && (
                        <>
                            <div className='info-panel-subtabs'>
                                <button
                                    type='button'
                                    className={`info-subtab${this.state.controlsSubTab === 'desktop' ? ' active' : ''}`}
                                    onClick={() => this.setState({ controlsSubTab: 'desktop' })}
                                >
                                    {t('Desktop', lang)}
                                </button>
                                <button
                                    type='button'
                                    className={`info-subtab${this.state.controlsSubTab === 'touch' ? ' active' : ''}`}
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
                                    {(showFitControl || showResetControl) && (
                                        <>
                                            <Label text={t('General', lang)} class='popup-panel-heading' />
                                            {showFitControl && (
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
                                            )}
                                            {showResetControl && (
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
                                            )}
                                        </>
                                    )}
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
                    {activeTab === 'model' && (
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
                                const selectedPath = scene?.selectedNode?.path ?? '';
                                const isSelfOrAncestor = (path: string) => {
                                    if (!path) return true;
                                    if (selectedPath === path) return true;
                                    return selectedPath.startsWith(`${path}/`) ||
                                           selectedPath.startsWith(`${path}.`) ||
                                           selectedPath.startsWith(`${path}>`);
                                };
                                try {
                                    modelHierarchy = JSON.parse(scene.nodes || '[]');
                                    if (!Array.isArray(modelHierarchy)) modelHierarchy = [];
                                } catch {
                                    modelHierarchy = [];
                                }
                                const mapNodes = (nodes: Array<HierarchyNode>) => nodes.map((node: HierarchyNode) => (
                                    <TreeViewItem
                                        key={node.path}
                                        text={node.name}
                                        selected={selectedPath === node.path}
                                        open={isSelfOrAncestor(node.path)}
                                        onSelect={(deselect: () => void) => {
                                            setProperty('scene.selectedNode.path', node.path);
                                            const remove = addEventListenerOnClickOnly(document.body, () => {
                                                deselect();
                                                remove();
                                            }, 4);
                                        }}
                                        onDeselect={() => setProperty('scene.selectedNode.path', '')}
                                    >
                                        {mapNodes(node.children || [])}
                                    </TreeViewItem>
                                ));
                                return modelHierarchy.length > 0 ? (
                                    <div className='info-panel-hierarchy' ref={this.modelHierarchyRef}>
                                        <TreeView key={`model-hierarchy-${selectedPath}`} allowReordering={false} allowDrag={false}>
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
                    {activeTab === 'about' && (
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
    private cycleReferenceRuler = () => {
        const next = !this.props.observerData.measure.referenceRuler;
        this.props.setProperty('measure.referenceRuler', next);
        window.viewer?.frameScene?.();
    };

    private setMode = (mode: 'distance' | 'angle' | 'area') => {
        if (this.props.observerData.measure.mode === mode) return;
        this.props.setProperty('measure.mode', mode);
    };

    shouldComponentUpdate(nextProps: Readonly<{
        observerData: ObserverData;
        setProperty: SetProperty; }>): boolean {
        const a = nextProps.observerData;
        const b = this.props.observerData;
        return a.ui?.active !== b.ui?.active ||
               a.ui?.language !== b.ui?.language ||
               a.measure?.enabled !== b.measure?.enabled ||
               a.measure?.unit !== b.measure?.unit ||
               a.measure?.referenceRuler !== b.measure?.referenceRuler ||
               a.measure?.unitScale !== b.measure?.unitScale ||
               a.measure?.knownDistance !== b.measure?.knownDistance ||
               a.measure?.knownDistanceWarning !== b.measure?.knownDistanceWarning ||
               a.measure?.lastDistance !== b.measure?.lastDistance ||
               a.measure?.lastAngle !== b.measure?.lastAngle ||
               a.measure?.lastArea !== b.measure?.lastArea ||
               a.measure?.areaPlanarity !== b.measure?.areaPlanarity ||
               a.measure?.mode !== b.measure?.mode ||
               a.measure?.pointCount !== b.measure?.pointCount;
    }

    render() {
        const props = this.props;
        const measureData = props.observerData.measure;
        const lang = props.observerData?.ui?.language;
        const mode = measureData.mode || 'distance';
        const factor = measureData.unit === 'mm' ? 1000 : (measureData.unit === 'cm' ? 100 : 1);
        const precision = measureData.unit === 'mm' ? 0 : 2;
        const areaPrecision = measureData.unit === 'mm' ? 0 : 3;

        const meters = measureData.lastDistance;
        const measuredDistance = meters === null ? '-' : `${(meters * factor).toFixed(precision)} ${measureData.unit}`;

        const angleDeg = measureData.lastAngle;
        const measuredAngle = angleDeg === null ? '-' : `${angleDeg.toFixed(2)}°`;

        const areaSqM = measureData.lastArea;
        const measuredArea = areaSqM === null ?
            '-' :
            `${(areaSqM * factor * factor).toFixed(areaPrecision)} ${measureData.unit}²`;

        const planarity = measureData.areaPlanarity;
        const planarityValue = planarity === null ?
            '-' :
            `${(planarity * factor).toFixed(precision)} ${measureData.unit}`;
        const planarityWarn = planarity !== null && areaSqM !== null && areaSqM > 0 &&
            (planarity / Math.sqrt(areaSqM)) > 0.05;

        const pointsHintKey = (() => {
            const pc = measureData.pointCount || 0;
            if (mode === 'area') {
                if (pc === 0) return 'Pick first point';
                if (pc === 1) return 'Pick second point';
                if (pc === 2) return 'Pick third point';
                return 'Pick next point or close polygon';
            }
            const needed = mode === 'distance' ? 2 : 3;
            if (pc >= needed) return 'Pick first point';
            if (pc === 0) return 'Pick first point';
            if (pc === 1) return 'Pick second point';
            if (pc === 2) return 'Pick third point';
            return 'Pick fourth point';
        })();

        return (
            <div className='popup-panel-parent'>
                <Container class='popup-panel' flex hidden={props.observerData.ui.active !== 'measurement'}>
                    <Label text={t('Measurement', lang)} class='popup-panel-heading' />

                    <div className='measure-mode-toolbar'>
                        <button
                            type='button'
                            title={t('Distance tool', lang)}
                            className={`measure-mode-btn${mode === 'distance' ? ' active' : ''}`}
                            onClick={() => this.setMode('distance')}
                        >
                            <span className='material-symbols-outlined'>linear_scale</span>
                        </button>
                        <button
                            type='button'
                            title={t('Angle tool', lang)}
                            className={`measure-mode-btn${mode === 'angle' ? ' active' : ''}`}
                            onClick={() => this.setMode('angle')}
                        >
                            <span className='material-symbols-outlined'>square_foot</span>
                        </button>
                        <button
                            type='button'
                            title={t('Area tool', lang)}
                            className={`measure-mode-btn${mode === 'area' ? ' active' : ''}`}
                            onClick={() => this.setMode('area')}
                        >
                            <span className='material-symbols-outlined'>crop_3_2</span>
                        </button>
                    </div>

                    <Toggle
                        label={t('Enable measuring', lang)}
                        value={measureData.enabled}
                        setProperty={(value: boolean) => props.setProperty('measure.enabled', value)}
                    />
                    <Button
                        class='secondary'
                        text={t('CLEAR MEASUREMENTS', lang)}
                        onClick={() => {
                            if (window.viewer) window.viewer.clearMeasurement();
                        }}
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

                    {mode === 'distance' && (
                        <>
                            <Numeric
                                label={`${t('Known distance', lang)} (${measureData.unit})`}
                                value={measureData.knownDistance ?? 0}
                                min={0}
                                max={1e9}
                                setProperty={(value: number) => props.setProperty('measure.knownDistance', Math.max(0, value))}
                            />
                            {measureData.knownDistanceWarning && (
                                <div className='measure-warning'>
                                    {t('Only one known segment can be used for scene scale. A new distance replaces the previous one.', lang)}
                                </div>
                            )}
                            <Button
                                class='secondary'
                                text={t('RECALCULATE SCENE SIZE', lang)}
                                onClick={() => {
                                    if (window.viewer) window.viewer.recalculateSceneSize();
                                }}
                                enabled={measureData.lastDistance != null && measureData.lastDistance > 0 && (measureData.knownDistance ?? 0) > 0}
                            />
                            <Detail label={t('Last Distance', lang)} value={measuredDistance} />
                        </>
                    )}

                    {mode === 'angle' && (
                        <Detail label={t('Last Angle', lang)} value={measuredAngle} />
                    )}

                    {mode === 'area' && (
                        <>
                            <Detail label={t('Last Area', lang)} value={measuredArea} />
                            <Detail
                                label={`${t('Planarity deviation', lang)}${planarityWarn ? ' ⚠' : ''}`}
                                value={planarityValue}
                            />
                        </>
                    )}

                    <Detail label={t('Points', lang)} value={t(pointsHintKey, lang)} />
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
    declare state: EmbedGeneratorState;

    private presetDefaults: Record<'full' | 'compact' | 'minimal', {
        panel: boolean,
        poi: boolean,
        tour: boolean,
        measure: boolean,
        info: boolean,
        modelInfo: boolean,
        controls: boolean,
        allowFullscreen: boolean,
        fit: boolean,
        reset: boolean
    }> = {
            full: { panel: true, poi: true, tour: true, measure: true, info: true, modelInfo: true, controls: true, allowFullscreen: true, fit: true, reset: true },
            compact: { panel: false, poi: true, tour: true, measure: false, info: true, modelInfo: false, controls: true, allowFullscreen: true, fit: true, reset: true },
            minimal: { panel: false, poi: true, tour: true, measure: false, info: false, modelInfo: false, controls: false, allowFullscreen: true, fit: false, reset: true }
        };

    get embedSrc() {
        const url = new URL(window.location.href);
        url.search = '';
        this.props.sceneData.urls.forEach((modelUrl: string) => {
            let normalizedUrl = modelUrl;
            try {
                const parsed = new URL(modelUrl, window.location.href);
                if (parsed.origin === window.location.origin) {
                    normalizedUrl = `${parsed.pathname}${parsed.search}${parsed.hash}`;
                } else {
                    normalizedUrl = parsed.toString();
                }
            } catch {
                normalizedUrl = modelUrl;
            }
            url.searchParams.append('load', normalizedUrl);
        });
        url.searchParams.set('embed', '1');
        url.searchParams.set('ui', this.state.preset);
        url.searchParams.set('panel', this.state.panel ? '1' : '0');
        url.searchParams.set('autoplay', this.state.autoplay ? '1' : '0');
        url.searchParams.set('poi', this.state.poi ? '1' : '0');
        url.searchParams.set('tour', this.state.tour ? '1' : '0');
        url.searchParams.set('measure', this.state.measure ? '1' : '0');
        url.searchParams.set('info', this.state.info ? '1' : '0');
        url.searchParams.set('modelInfo', this.state.modelInfo ? '1' : '0');
        url.searchParams.set('controls', this.state.controls ? '1' : '0');
        url.searchParams.set('fullscreen', this.state.allowFullscreen ? '1' : '0');
        url.searchParams.set('fit', this.state.fit ? '1' : '0');
        url.searchParams.set('reset', this.state.reset ? '1' : '0');
        if (this.state.language !== 'auto') {
            url.searchParams.set('lang', this.state.language);
        }
        return url.toString();
    }

    get embedCode() {
        const allowAttrs = ['autoplay'];
        if (this.state.allowFullscreen) {
            allowAttrs.push('fullscreen', 'xr-spatial-tracking', 'web-share');
        }
        if (this.state.embedType === 'responsive') {
            return `<div style="position: relative; width: 100%; height: ${this.state.height}px;">
  <iframe
    title="3D Viewer"
    frameborder="0"
    ${this.state.allowFullscreen ? 'allowfullscreen\n    mozallowfullscreen="true"\n    webkitallowfullscreen="true"' : ''}
    allow="${allowAttrs.join('; ')}"
    src="${this.embedSrc}"
    style="position: absolute; inset: 0; width: 100%; height: 100%; border: 0;"
  ></iframe>
</div>`;
        }
        return `<iframe
  title="3D Viewer"
  frameborder="0"
  ${this.state.allowFullscreen ? 'allowfullscreen\n  mozallowfullscreen="true"\n  webkitallowfullscreen="true"' : ''}
  allow="${allowAttrs.join('; ')}"
  src="${this.embedSrc}"
  width="${this.state.width}"
  height="${this.state.height}"
  style="border: 0;"
></iframe>`;
    }

    constructor(props: {
        sceneData: ObserverData['scene'],
        uiData: ObserverData['ui'],
        runtimeData: ObserverData['runtime'],
        setProperty: SetProperty
    }) {
        super(props);
        const embed = props.uiData?.embed;
        const preset = (embed?.preset ?? 'compact') as EmbedGeneratorState['preset'];
        const defaults = this.presetDefaults[preset];
        this.state = {
            embedType: 'responsive',
            preset,
            width: 960,
            height: 640,
            panel: embed?.panel ?? defaults.panel,
            autoplay: embed?.autoplay ?? true,
            allowFullscreen: embed?.fullscreen ?? defaults.allowFullscreen,
            poi: embed?.poi ?? defaults.poi,
            tour: embed?.tour ?? defaults.tour,
            measure: embed?.measure ?? defaults.measure,
            info: embed?.info ?? defaults.info,
            modelInfo: embed?.modelInfo ?? defaults.modelInfo,
            controls: embed?.controls ?? defaults.controls,
            fit: embed?.fit ?? defaults.fit,
            reset: embed?.reset ?? defaults.reset,
            language: (props.uiData?.language ?? 'auto') as 'auto' | 'en' | 'ru' | 'zh',
            copied: false
        };
    }

    shouldComponentUpdate(nextProps: Readonly<{
        sceneData: ObserverData['scene'];
        uiData: ObserverData['ui'];
        setProperty: SetProperty; }>, nextState: Readonly<EmbedGeneratorState>): boolean {
        const a = nextProps;
        const b = this.props;
        const urlsA = a.sceneData?.urls || [];
        const urlsB = b.sceneData?.urls || [];
        if (urlsA.length !== urlsB.length) return true;
        for (let i = 0; i < urlsA.length; i++) {
            if (urlsA[i] !== urlsB[i]) return true;
        }
        return a.uiData?.active !== b.uiData?.active ||
               a.uiData?.language !== b.uiData?.language ||
               JSON.stringify(nextState) !== JSON.stringify(this.state);
    }

    private applyPreset = (preset: 'full' | 'compact' | 'minimal') => {
        const defaults = this.presetDefaults[preset];
        this.setState({
            preset,
            panel: defaults.panel,
            autoplay: true,
            poi: defaults.poi,
            tour: defaults.tour,
            measure: defaults.measure,
            info: defaults.info,
            modelInfo: defaults.modelInfo,
            controls: defaults.controls,
            allowFullscreen: defaults.allowFullscreen,
            fit: defaults.fit,
            reset: defaults.reset,
            copied: false
        });
    };

    render() {
        const props = this.props;
        const lang = props.uiData?.language;
        return (
            <div className='popup-panel-parent'>
                <Container id='view-panel' class='popup-panel' flex hidden={props.uiData.active !== 'view'}>
                    <Label text={t('Embed Type', lang)} />
                    <Select
                        label=''
                        type='string'
                        options={[
                            { v: 'responsive', t: t('Responsive', lang) },
                            { v: 'fixed', t: t('Fixed', lang) }
                        ]}
                        value={this.state.embedType}
                        setProperty={(value: 'responsive' | 'fixed') => this.setState({ embedType: value })}
                    />
                    <Label text={t('UI Preset', lang)} />
                    <Select
                        label=''
                        type='string'
                        options={[
                            { v: 'full', t: t('Full', lang) },
                            { v: 'compact', t: t('Compact', lang) },
                            { v: 'minimal', t: t('Minimal', lang) }
                        ]}
                        value={this.state.preset}
                        setProperty={(value: 'full' | 'compact' | 'minimal') => this.applyPreset(value)}
                    />
                    {this.state.embedType === 'fixed' && (
                        <Numeric
                            label={t('Width', lang)}
                            value={this.state.width}
                            min={200}
                            max={4096}
                            setProperty={(value: number) => this.setState({ width: Math.max(200, Math.round(value || 200)) })}
                        />
                    )}
                    <Numeric
                        label={t('Height', lang)}
                        value={this.state.height}
                        min={200}
                        max={4096}
                        setProperty={(value: number) => this.setState({ height: Math.max(200, Math.round(value || 200)) })}
                    />
                    <Toggle label={t('Show left panel', lang)} value={this.state.panel} setProperty={(value: boolean) => this.setState({ panel: value })} />
                    <Toggle label={t('Autoplay', lang)} value={this.state.autoplay} setProperty={(value: boolean) => this.setState({ autoplay: value })} />
                    <Toggle label={t('Allow fullscreen', lang)} value={this.state.allowFullscreen} setProperty={(value: boolean) => this.setState({ allowFullscreen: value })} />
                    <Toggle label={t('Show POI', lang)} value={this.state.poi} setProperty={(value: boolean) => this.setState({ poi: value })} />
                    <Toggle label={t('Show tour', lang)} value={this.state.tour} setProperty={(value: boolean) => this.setState({ tour: value })} />
                    <Toggle label={t('Enable measure', lang)} value={this.state.measure} setProperty={(value: boolean) => this.setState({ measure: value })} />
                    <Toggle label={t('Show info', lang)} value={this.state.info} setProperty={(value: boolean) => this.setState({ info: value })} />
                    <Toggle label={t('Show model info', lang)} value={this.state.modelInfo} setProperty={(value: boolean) => this.setState({ modelInfo: value })} />
                    <Toggle label={t('Show controls', lang)} value={this.state.controls} setProperty={(value: boolean) => this.setState({ controls: value })} />
                    <Toggle label={t('Show fit to screen', lang)} value={this.state.fit} setProperty={(value: boolean) => this.setState({ fit: value })} />
                    <Toggle label={t('Show reset camera', lang)} value={this.state.reset} setProperty={(value: boolean) => this.setState({ reset: value })} />
                    <Select
                        label={t('Language', lang)}
                        type='string'
                        options={[
                            { v: 'auto', t: t('Auto', lang) },
                            { v: 'en', t: 'EN' },
                            { v: 'ru', t: 'RU' },
                            { v: 'zh', t: 'ZH' }
                        ]}
                        value={this.state.language}
                        setProperty={(value: 'auto' | 'en' | 'ru' | 'zh') => this.setState({ language: value })}
                    />
                    <Label text={t('Generated Embed Code', lang)} />
                    <div id='embed-code-wrapper'>
                        <textarea readOnly value={this.embedCode} />
                    </div>
                    <div id='copy-embed-row'>
                        <Button
                            id='copy-embed-button'
                            class='secondary'
                            text={t('Copy Embed Code', lang)}
                            onClick={() => {
                                if (navigator.clipboard && window.isSecureContext) {
                                    navigator.clipboard.writeText(this.embedCode);
                                    this.setState({ copied: true });
                                    window.setTimeout(() => this.setState({ copied: false }), 2000);
                                }
                            }}
                        />
                        {this.state.copied && <span className='metadata-saved-feedback'>✓ {t('Copied', lang)}</span>}
                    </div>
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

// Метаданные (Dublin Core) убраны из плеера — источник правды портал.
// ID-панель показывает только техническую идентификацию узла сцены (путь/имя).

class IDPanel extends React.Component <{
    observerData: ObserverData,
    setProperty: SetProperty }> {
    shouldComponentUpdate(nextProps: Readonly<{
        observerData: ObserverData;
        setProperty: SetProperty; }>): boolean {
        return JSON.stringify(nextProps.observerData.scene?.selectedNode) !== JSON.stringify(this.props.observerData.scene?.selectedNode) ||
               JSON.stringify(nextProps.observerData.ui) !== JSON.stringify(this.props.observerData.ui);
    }

    render() {
        const props = this.props;
        const scene = props.observerData.scene;
        const lang = props.observerData?.ui?.language;
        const path = scene?.selectedNode?.path ?? '';
        const name = scene?.selectedNode?.name ?? '';

        const isActive = props.observerData.ui.active === 'id';
        return (
            <div className='popup-panel-parent' hidden={!isActive}>
                <div
                    id='id-panel'
                    className='popup-panel id-panel'
                >
                    {path ? (
                        <>
                            <div className='id-panel-row'>
                                <span className='id-panel-label'>{t('Path', lang)}</span>
                                <span className='id-panel-value'>{path}</span>
                            </div>
                            <div className='id-panel-row'>
                                <span className='id-panel-label'>{t('Name', lang)}</span>
                                <span className='id-panel-value'>{name || '-'}</span>
                            </div>
                            <Button
                                class='secondary'
                                text={t('Copy path', lang)}
                                onClick={() => {
                                    navigator.clipboard?.writeText(path);
                                }}
                            />
                        </>
                    ) : null}
                </div>
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
