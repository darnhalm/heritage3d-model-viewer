import { Button } from '@playcanvas/pcui/react';
import React from 'react';

import AnimationControls from './animation-controls';
import { FragmentPanel, MeasurementsPanel, ViewPanel, InfoPanel } from './panels';
import { addEventListenerOnClickOnly } from '../../helpers';
import { t } from '../../i18n/translations';
import { SetProperty, ObserverData } from '../../types';

const PopupPanelControls = (props: { observerData: ObserverData, setProperty: SetProperty }) => {
    return (<>
        <InfoPanel setProperty={props.setProperty} observerData={props.observerData} />
        <MeasurementsPanel setProperty={props.setProperty} observerData={props.observerData} />
        <FragmentPanel setProperty={props.setProperty} observerData={props.observerData} />
        <ViewPanel setProperty={props.setProperty} sceneData={props.observerData.scene} uiData={props.observerData.ui} runtimeData={props.observerData.runtime}/>
    </>);
};

class PopupButtonControls extends React.Component <{ observerData: ObserverData, setProperty: SetProperty }> {
    popupPanelElement: HTMLElement | null = null;

    removeDeselectEvents: (() => void) | null = null;

    componentWillUnmount() {
        this.removeDeselectEvents?.();
        this.removeDeselectEvents = null;
    }

    private handleClick = (value: string) => {
        const nextActive = this.props.observerData.ui.active === value ? null : value;
        this.props.setProperty('ui.active', nextActive);

        if (this.removeDeselectEvents) {
            this.removeDeselectEvents();
            this.removeDeselectEvents = null;
        }

        if (!nextActive) return;

        if (!this.popupPanelElement) this.popupPanelElement = document.getElementById('popup');

        setTimeout(() => {
            const deactivateUi = (e: MouseEvent) => {
                const target = e.target;
                if (target instanceof Node && this.popupPanelElement?.contains(target)) {
                    return;
                }
                // Куб ориентации и переключатель проекции лежат поверх канваса, но это
                // инструменты просмотра, а не «клик мимо панели»: закрывать по ним панель
                // нельзя — вместе с ней исчезли бы они сами.
                if (target instanceof Element && target.closest('#view-cube-container, .projection-toggle-slot')) {
                    return;
                }
                // Choosing a fragment is intentionally a click on the canvas outside
                // the popup. Keep the panel and selection mode alive for that click.
                if (document.querySelector('.fragment-panel.fragment-selecting') && target instanceof HTMLCanvasElement) {
                    return;
                }
                this.props.setProperty('ui.active', null);
                this.removeDeselectEvents?.();
                this.removeDeselectEvents = null;
            };
            this.removeDeselectEvents = addEventListenerOnClickOnly(document.body, deactivateUi, 4);
        });
    };

    render() {
        const buildClass = (value: string) => {
            return (this.props.observerData.ui.active === value) ? ['popup-button', 'selected'] : ['popup-button'];
        };

        const lang = this.props.observerData?.ui?.language;
        const embed = this.props.observerData?.ui?.embed;
        // Вне встройки — всегда; во встройке — по флагу animControls (его дефолт
        // зависит от пресета: full/compact → вкл, minimal → выкл).
        const showAnimationControls = !(embed?.enabled) || embed?.animControls !== false;
        const showInfoButton = !(embed?.enabled) || embed.info || embed.controls;
        const showMeasureButton = !(embed?.enabled) || embed.measure;
        const showFitButton = !(embed?.enabled) || embed.fit;
        const showFullscreenButton = !(embed?.enabled) || embed.fullscreen;
        const showHdButton = !(embed?.enabled) || embed.hd;
        const showShareButton = !(embed?.enabled) || embed.share;
        const showCameraModeButton = !(embed?.enabled) || embed.cameraMode;
        const showFragmentButton = !!this.props.observerData.scene.isTileset && (!(embed?.enabled) || embed.fragment);
        const fragmentActive = this.props.observerData.fragment.selecting ||
            this.props.observerData.fragment.initialized ||
            this.props.observerData.fragment.enabled;
        const wrap = (titleText: string, btn: React.ReactNode) => (
            <span title={titleText} style={{ display: 'contents' }}>{btn}</span>
        );
        return (
            <div id='popup-buttons-parent'>
                {showAnimationControls && (
                    <AnimationControls animationData={this.props.observerData.animation} setProperty={this.props.setProperty} lang={this.props.observerData?.ui?.language} />
                )}
                {showInfoButton && wrap(t('Info', lang), (
                    <Button
                        class={buildClass('info').concat('info-button')}
                        id='info-button'
                        width={40}
                        height={40}
                        onClick={() => this.handleClick('info')}
                    />
                ))}
                {showHdButton && wrap(this.props.observerData.camera.hq ? t('HD mode', lang) : t('SD mode', lang), (
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
                {showMeasureButton && wrap(t('Measurement', lang), (
                    <Button
                        class={buildClass('measurement')
                        .concat('measurement-button')
                        .concat(this.props.observerData.measure.enabled ? 'measure-enabled' : [])}
                        id='measurement-button'
                        width={40}
                        height={40}
                        onClick={() => {
                            const isOpening = this.props.observerData.ui.active !== 'measurement';
                            this.handleClick('measurement');
                            if (isOpening) {
                                this.props.setProperty('measure.enabled', true);
                            }
                        }}
                    />
                ))}
                {showFragmentButton && wrap(t('Fragment view', lang), (
                    <Button
                        class={buildClass('fragment')
                        .concat('fragment-button')
                        .concat(fragmentActive ? 'fragment-enabled' : [])}
                        id='fragment-button'
                        width={40}
                        height={40}
                        onClick={() => {
                            const isOpening = this.props.observerData.ui.active !== 'fragment';
                            this.handleClick('fragment');
                            if (isOpening && !this.props.observerData.fragment.initialized) {
                                window.viewer?.beginFragmentSelection?.();
                            }
                        }}
                    />
                ))}
                {showShareButton && wrap(t('View & share', lang), (
                    <Button class={buildClass('view').concat('view-button')} id='view-button' width={40} height={40} onClick={() => this.handleClick('view')} />
                ))}
                {showFitButton && wrap(t('Frame scene', lang), (
                    <Button
                        class={['popup-button', 'fit-screen-button']}
                        id='fit-screen-button'
                        width={40}
                        height={40}
                        onClick={() => window.viewer?.frameScene?.()}
                    />
                ))}
                {showCameraModeButton && wrap(this.props.observerData.camera.mode === 'orbit' ? t('Orbit mode', lang) : t('Fly mode', lang), (
                    <Button
                        class={['popup-button', 'camera-mode-button', ...(this.props.observerData.camera.mode ? [this.props.observerData.camera.mode] : [])]}
                        id='camera-mode-button'
                        width={40}
                        height={40}
                        onClick={() => {
                            const mode = this.props.observerData.camera.mode === 'orbit' ? 'fly' : 'orbit';
                            this.props.setProperty('camera.mode', mode);
                        }}
                    />
                ))}
                {showFullscreenButton && wrap(this.props.observerData.ui.fullscreen ? t('Exit fullscreen', lang) : t('Fullscreen', lang), (
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
    render() {
        return (<div id='popup' className={this.props.observerData.scene.nodes === '[]' ? 'empty' : null}>
            <PopupPanelControls observerData={this.props.observerData} setProperty={this.props.setProperty} />
            <PopupButtonControls observerData={this.props.observerData} setProperty={this.props.setProperty} />
        </div>);
    }
}

export default PopupPanel;
