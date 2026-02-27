import { Button } from '@playcanvas/pcui/react';
import { UsdzExporter } from 'playcanvas';
import React from 'react';

import { t } from '../../i18n/translations';
import AnimationControls from './animation-controls';
import { MeasurementsPanel, ViewPanel, InfoPanel, IDPanel } from './panels';
import { addEventListenerOnClickOnly } from '../../helpers';
import { SetProperty, ObserverData } from '../../types';

const PopupPanelControls = (props: { observerData: ObserverData, setProperty: SetProperty }) => {
    return (<>
        <IDPanel setProperty={props.setProperty} observerData={props.observerData} />
        <InfoPanel setProperty={props.setProperty} observerData={props.observerData} />
        <MeasurementsPanel setProperty={props.setProperty} observerData={props.observerData} />
        <ViewPanel setProperty={props.setProperty} sceneData={props.observerData.scene} uiData={props.observerData.ui} runtimeData={props.observerData.runtime}/>
    </>);
};

class PopupButtonControls extends React.Component <{ observerData: ObserverData, setProperty: SetProperty }> {
    popupPanelElement: any;

    render() {
        let removeDeselectEvents: any;
        const handleClick = (value: string) => {
            this.props.setProperty('ui.active', this.props.observerData.ui.active === value ? null : value);

            // after a popup button is set active, listen for another click outside the panel to deactivate it
            if (!this.popupPanelElement) this.popupPanelElement = document.getElementById('popup');
            // add the event listener after the current click is complete
            setTimeout(() => {
                if (removeDeselectEvents) removeDeselectEvents();
                const deactivateUi = (e: any) => {
                    if (this.popupPanelElement.contains(e.target)) {
                        return;
                    }
                    this.props.setProperty('ui.active', null);
                    removeDeselectEvents();
                    removeDeselectEvents = null;
                };
                removeDeselectEvents = addEventListenerOnClickOnly(document.body, deactivateUi, 4);
            });
        };

        const buildClass = (value: string) => {
            return (this.props.observerData.ui.active === value) ? ['popup-button', 'selected'] : ['popup-button'];
        };

        const lang = this.props.observerData?.ui?.language;
        const wrap = (titleText: string, btn: React.ReactNode) => (
            <span title={titleText} style={{ display: 'contents' }}>{btn}</span>
        );
        return (
            <div id='popup-buttons-parent'>
                <AnimationControls animationData={this.props.observerData.animation} setProperty={this.props.setProperty} lang={this.props.observerData?.ui?.language} />
                {wrap(t('Info', lang), (
                    <Button
                        class={buildClass('info').concat('info-button')}
                        id='info-button'
                        width={40}
                        height={40}
                        onClick={() => handleClick('info')}
                    />
                ))}
                {wrap(this.props.observerData.camera.hq ? t('HD mode', lang) : t('SD mode', lang), (
                    <Button
                        class={['popup-button', 'hd-button', this.props.observerData.camera.hq ? 'hd-mode' : 'sd-mode']}
                        id='hd-button'
                        width={40}
                        height={40}
                        onClick={() => {
                            this.props.setProperty('camera.hq', !this.props.observerData.camera.hq);
                        }}
                    />
                ))}
                {wrap(t('Measurement', lang), (
                    <Button
                        class={buildClass('measurement')
                            .concat('measurement-button')
                            .concat(this.props.observerData.measure.enabled ? 'measure-enabled' : [])}
                        id='measurement-button'
                        width={40}
                        height={40}
                        onClick={() => {
                            const isOpening = this.props.observerData.ui.active !== 'measurement';
                            handleClick('measurement');
                            if (isOpening) {
                                this.props.setProperty('measure.enabled', true);
                            }
                        }}
                    />
                ))}
                {wrap(t('ID', lang), (
                    <Button
                        class={buildClass('id').concat('id-button')}
                        id='id-button'
                        width={40}
                        height={40}
                        onClick={() => handleClick('id')}
                    />
                ))}
                {wrap(t('View & share', lang), (
                    <Button class={buildClass('view').concat('view-button')} id='view-button' width={40} height={40} onClick={() => handleClick('view')} />
                ))}
                {wrap(t('Frame scene', lang), (
                    <Button
                        class={['popup-button', 'fit-screen-button']}
                        id='fit-screen-button'
                        width={40}
                        height={40}
                        onClick={() => window.viewer?.frameScene?.()}
                    />
                ))}
                {wrap(this.props.observerData.camera.mode === 'orbit' ? t('Orbit mode', lang) : t('Fly mode', lang), (
                    <Button
                        class={['popup-button', 'camera-mode-button', this.props.observerData.camera.mode]}
                        id='camera-mode-button'
                        width={40}
                        height={40}
                        onClick={() => {
                            const mode = this.props.observerData.camera.mode === 'orbit' ? 'fly' : 'orbit';
                            this.props.setProperty('camera.mode', mode);
                        }}
                    />
                ))}
                {wrap(this.props.observerData.ui.fullscreen ? t('Exit fullscreen', lang) : t('Fullscreen', lang), (
                    <Button
                        class={['popup-button', 'fullscreen-button', this.props.observerData.ui.fullscreen ? 'fullscreen-exit' : 'fullscreen-enter']}
                        id='fullscreen-button'
                        width={40}
                        height={40}
                        onClick={() => {
                            const el = document.getElementById('application-container');
                            if (!el) return;
                            if (document.fullscreenElement) {
                                document.exitFullscreen?.();
                            } else {
                                el.requestFullscreen?.();
                            }
                        }}
                    />
                ))}
            </div>
        );
    }
}

class PopupPanel extends React.Component <{ observerData: ObserverData, setProperty: SetProperty }> {
    link: HTMLAnchorElement;

    usdzExporter: any;

    get hasArSupport() {
        return this.props.observerData.runtime.xrSupported || this.usdzExporter;
    }

    constructor(props: any) {
        super(props);
        this.link = (document.getElementById('ar-link') as HTMLAnchorElement);
        if (this.link.relList.supports('ar') || (Boolean(window.webkit?.messageHandlers) && Boolean(/CriOS\/|EdgiOS\/|FxiOS\/|GSA\/|DuckDuckGo\//.test(navigator.userAgent)))) {
            this.usdzExporter = new UsdzExporter();
        }
    }

    render() {
        return (<div id='popup' className={this.props.observerData.scene.nodes === '[]' ? 'empty' : null}>
            <PopupPanelControls observerData={this.props.observerData} setProperty={this.props.setProperty} />
            <PopupButtonControls observerData={this.props.observerData} setProperty={this.props.setProperty} />
            <span title={t('View in AR', this.props.observerData?.ui?.language)} style={{ display: 'contents' }}>
            <Button
                class='popup-button'
                id='launch-ar-button'
                icon='E189'
                hidden={!this.hasArSupport || this.props.observerData.scene.nodes === '[]'}
                width={40}
                height={40}
                onClick={() => {
                    if (this.usdzExporter) {
                        const sceneRoot = (window as any).viewer.app.root.findByName('sceneRoot');
                        // convert the loaded entity into asdz file
                        this.usdzExporter.build(sceneRoot).then((arrayBuffer: any) => {
                            const blob = new Blob([arrayBuffer], { type: 'application/octet-stream' });
                            this.link.href = URL.createObjectURL(blob);
                            this.link.click();
                        }).catch(console.error);
                    } else {
                        if (window.viewer) window.viewer.xrMode.start();
                    }
                } }
            />
            </span>
        </div>);
    }
}

export default PopupPanel;
