import { Button } from '@playcanvas/pcui/react';
import { UsdzExporter } from 'playcanvas';
import React from 'react';

import AnimationControls from './animation-controls';
import { MeasurementsPanel, ViewPanel, InfoPanel } from './panels';
import { addEventListenerOnClickOnly } from '../../helpers';
import { SetProperty, ObserverData } from '../../types';

const PopupPanelControls = (props: { observerData: ObserverData, setProperty: SetProperty }) => {
    return (<>
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

        return (
            <div id='popup-buttons-parent'>
                <AnimationControls animationData={this.props.observerData.animation} setProperty={this.props.setProperty} />
                <Button
                    class={buildClass('info').concat('info-button')}
                    id='info-button'
                    width={40}
                    height={40}
                    onClick={() => handleClick('info')}
                />
                <div class='hd-button-wrapper'>
                    <span class='hd-button-label'>{this.props.observerData.camera.hq ? 'FHD' : 'HD'}</span>
                    <Button
                        class={['popup-button', 'hd-button', this.props.observerData.camera.hq ? 'hd-mode' : 'sd-mode']}
                        id='hd-button'
                        width={40}
                        height={40}
                        onClick={() => {
                            this.props.setProperty('camera.hq', !this.props.observerData.camera.hq);
                        }}
                    />
                </div>
                <Button
                    class={buildClass('measurement').concat('measurement-button')}
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
                <Button class={buildClass('view').concat('view-button')} id='view-button' width={40} height={40} onClick={() => handleClick('view')} />
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
        </div>);
    }
}

export default PopupPanel;
