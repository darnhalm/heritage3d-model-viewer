import { Observer } from '@playcanvas/observer';
import { Container, Progress } from '@playcanvas/pcui/react';
import React from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';

import { ObserverData } from '../types';
import { ErrorBox, WarningsBox } from './errors';
import LeftPanel from './left-panel';
import LoadControls from './load-controls';
import PopupPanel from './popup-panel';
import SelectedNode from './selected-node';

type PoiUiEntry = {
    id: string;
    number: number;
    title?: string;
    duration?: number;
    holdTime?: number;
};

const rgbToCssColor = (color?: { r: number; g: number; b: number } | null) => {
    if (!color) return '#ffffff';
    const channel = (value: number) => Math.max(0, Math.min(255, Math.round(value * 255)));
    return `rgb(${channel(color.r)}, ${channel(color.g)}, ${channel(color.b)})`;
};

const DEFAULT_LOADING_BACKGROUND_COLOR = '#ffffff';

class App extends React.Component<{ observer: Observer }> {
    state: ObserverData | null = null;

    canvasRef: React.RefObject<HTMLCanvasElement | null>;

    private stateUpdateRaf: number | null = null;
    private poiSlideshowTimeout: ReturnType<typeof setTimeout> | null = null;
    private poiProgressRaf: number | null = null;

    private currentPoiStartTime: number = 0;
    private currentPoiDuration: number = 0;
    private currentPoiHoldTime: number = 0;
    private activePoiId: string = '';

    constructor(props: { observer: Observer }) {
        super(props);

        this.canvasRef = React.createRef();
        this.state = { ...this._retrieveState() };

        props.observer.on('*:set', () => {
            if (this.stateUpdateRaf !== null) return;
            // Coalesce bursty observer updates into a single React state update per frame.
            this.stateUpdateRaf = window.requestAnimationFrame(() => {
                this.stateUpdateRaf = null;
                this.setState(this._retrieveState());
            });
        });

        this.updatePoiProgress();
    }

    private updatePoiProgress = () => {
        if (!this.state?.poi?.playing || !this.activePoiId) {
            document.querySelectorAll('.poi-progress-transition, .poi-progress-hold').forEach(el => {
                (el as HTMLElement).style.width = '0%';
            });
            this.poiProgressRaf = requestAnimationFrame(this.updatePoiProgress);
            return;
        }

        const elapsed = (Date.now() - this.currentPoiStartTime) / 1000;
        const duration = this.currentPoiDuration;
        const holdTime = this.currentPoiHoldTime;
        
        const transitionProgress = Math.min(100, Math.max(0, duration > 0 ? (elapsed / duration) * 100 : 100));
        let holdProgress = 0;
        if (elapsed > duration && holdTime > 0) {
            holdProgress = Math.min(100, Math.max(0, ((elapsed - duration) / holdTime) * 100));
        }

        document.querySelectorAll('.poi-progress-transition').forEach(el => {
            const castEl = el as HTMLElement;
            if (el.id === `poi-progress-transition-${this.activePoiId}`) castEl.style.width = `${transitionProgress}%`;
            else castEl.style.width = '0%';
        });
        document.querySelectorAll('.poi-progress-hold').forEach(el => {
            const castEl = el as HTMLElement;
            if (el.id === `poi-progress-hold-${this.activePoiId}`) castEl.style.width = `${holdProgress}%`;
            else castEl.style.width = '0%';
        });

        this.poiProgressRaf = requestAnimationFrame(this.updatePoiProgress);
    };

    componentWillUnmount(): void {
        if (this.stateUpdateRaf !== null) {
            window.cancelAnimationFrame(this.stateUpdateRaf);
            this.stateUpdateRaf = null;
        }
        if (this.poiSlideshowTimeout !== null) {
            clearTimeout(this.poiSlideshowTimeout);
            this.poiSlideshowTimeout = null;
        }
        if (this.poiProgressRaf !== null) {
            cancelAnimationFrame(this.poiProgressRaf);
            this.poiProgressRaf = null;
        }
    }

    _retrieveState = () => {
        return this.props.observer.json() as ObserverData;
    };

    _setStateProperty = (path: string, value: any) => {
        this.props.observer.set(path, value);
    };

    private getPoiList(): PoiUiEntry[] {
        try {
            const parsed = JSON.parse(String(this.state?.poi?.list ?? '[]'));
            return Array.isArray(parsed) ? parsed as PoiUiEntry[] : [];
        } catch {
            return [];
        }
    }

    componentDidUpdate(prevProps: Readonly<{ observer: Observer }>, prevState: Readonly<ObserverData>): void {
        const prevPoiList = prevState?.poi?.list ?? '[]';
        const poiList = this.state?.poi?.list ?? '[]';
        const activeId = this.state?.poi?.activeId ?? '';
        const prevActiveId = prevState?.poi?.activeId ?? '';
        const playing = this.state?.poi?.playing ?? false;
        const prevPlaying = prevState?.poi?.playing ?? false;

        if (poiList !== prevPoiList && poiList !== '[]' && !activeId) {
            const firstPoi = this.getPoiList()[0];
            if (firstPoi?.id) {
                window.viewer?.focusPoi?.(String(firstPoi.id));
            }
        }

        if (playing && (!prevPlaying || activeId !== prevActiveId)) {
            if (this.poiSlideshowTimeout !== null) {
                clearTimeout(this.poiSlideshowTimeout);
            }
            
            const list = this.getPoiList();
            const currentPoi = list.find(poi => String(poi.id) === activeId);
            const duration = currentPoi?.duration ?? 1.0;
            const holdTime = currentPoi?.holdTime ?? 1.0;

            this.currentPoiStartTime = Date.now();
            this.currentPoiDuration = duration;
            this.currentPoiHoldTime = holdTime;
            this.activePoiId = activeId;

            this.poiSlideshowTimeout = setTimeout(() => {
                const currentIndex = list.findIndex(poi => String(poi.id) === activeId);
                const nextIndex = currentIndex < list.length - 1 ? currentIndex + 1 : 0;
                const nextPoi = list[nextIndex];
                if (nextPoi?.id) {
                    window.viewer?.focusPoi?.(String(nextPoi.id));
                }
            }, (duration + holdTime) * 1000);
        } else if (!playing && prevPlaying) {
            if (this.poiSlideshowTimeout !== null) {
                clearTimeout(this.poiSlideshowTimeout);
                this.poiSlideshowTimeout = null;
            }
        }
    }

    render() {
        if (!this.state) return null;
        const embed = this.state?.ui?.embed;
        const poiList = this.getPoiList();
        const activePoiId = this.state?.poi?.activeId || '';
        const activePoiIndex = poiList.findIndex(poi => String(poi.id) === activePoiId);
        const currentPoiIndex = activePoiIndex >= 0 ? activePoiIndex : (poiList.length > 0 ? 0 : -1);
        const currentPoi = currentPoiIndex >= 0 ? poiList[currentPoiIndex] : null;
        const showLeftPanel = !(embed?.enabled && !embed?.panel);
        const showLoadControls = !embed?.enabled;
        const showSelectedNode = !embed?.enabled && !!this.state?.debug?.withTextureOnly;
        const showEmbedStartOverlay = !!(embed?.enabled && embed?.waiting);
        const showEmbedLoadingBackdrop = !!(embed?.enabled && !embed?.waiting && embed?.placeholderUrl && this.state?.ui?.spinner);
        const showPoiPlayer = poiList.length > 0 && !(embed?.enabled && !embed?.tour);
        const showLoadProgressBackdrop = !!this.state?.ui?.spinner;
        const loadProgressBackdropColor = this.state?.ui?.loadingBackgroundReady && this.state?.skybox?.background === 'Solid Color' ?
            rgbToCssColor(this.state.skybox.backgroundColor) :
            DEFAULT_LOADING_BACKGROUND_COLOR;
        return <div id="application-container">
            {showLeftPanel && (
                <Container id="panel-left" width={32} flex resizable='right' resizeMin={220} resizeMax={800}>
                    <div className="header" style={{ display: 'none' }}>
                        <div id="title">
                            <img src={'static/heritage3d-logo.svg'}/>
                            <div>HERITAGE3D Viewer v1.0</div>
                        </div>
                    </div>
                    <div id="panel-toggle">
                        <img src={'static/heritage3d-logo.svg'}/>
                    </div>
                    <LeftPanel observerData={this.state} setProperty={this._setStateProperty} />
                    {!embed?.enabled && (
                        <div className='lang-switcher'>
                            <button
                                type='button'
                                className={`fi fi-gb fis${this.state?.ui?.language === 'en' ? ' active' : ''}`}
                                title='English'
                                onClick={() => this._setStateProperty('ui.language', 'en')}
                            />
                            <button
                                type='button'
                                className={`fi fi-ru fis${this.state?.ui?.language === 'ru' ? ' active' : ''}`}
                                title='Русский'
                                onClick={() => this._setStateProperty('ui.language', 'ru')}
                            />
                            <button
                                type='button'
                                className={`fi fi-cn fis${this.state?.ui?.language === 'zh' ? ' active' : ''}`}
                                title='中文'
                                onClick={() => this._setStateProperty('ui.language', 'zh')}
                            />
                        </div>
                    )}
                </Container>
            )}
            <div id='canvas-wrapper'>
                <canvas id="application-canvas" ref={this.canvasRef} />
                {showEmbedLoadingBackdrop && (
                    <div id='embed-loading-backdrop'>
                        <img src={embed.placeholderUrl} alt='' />
                    </div>
                )}
                {showEmbedStartOverlay && (
                    <div id='embed-start-overlay'>
                        {embed?.placeholderUrl && (
                            <img id='embed-start-poster' src={embed.placeholderUrl} alt='' />
                        )}
                        <button
                            type='button'
                            id='embed-start-button'
                            title='Start'
                            onClick={() => window.startEmbedPlayback?.()}
                        >
                            <img src='static/icons/embed-play.svg' alt='Start' />
                        </button>
                    </div>
                )}
                {showLoadControls && <LoadControls observerData={this.state} setProperty={this._setStateProperty}/>}
                {showSelectedNode && <SelectedNode observerData={this.state} setProperty={this._setStateProperty} />}
                {showPoiPlayer && currentPoi && (
                    <div id='poi-player-overlay'>
                        <button
                            type='button'
                            className='poi-player-button poi-player-play-button'
                            onClick={() => {
                                this._setStateProperty('poi.playing', !(this.state?.poi?.playing ?? false));
                            }}
                            title={this.state?.poi?.playing ? 'Pause' : 'Play'}
                        >
                            {this.state?.poi?.playing ? '⏸' : '►'}
                        </button>
                        <button
                            type='button'
                            className='poi-player-button'
                            onClick={() => {
                                const prevIndex = currentPoiIndex > 0 ? currentPoiIndex - 1 : poiList.length - 1;
                                const prevPoi = poiList[prevIndex];
                                if (prevPoi?.id) window.viewer?.focusPoi?.(String(prevPoi.id));
                            }}
                        >
                            ‹
                        </button>
                        <div className='poi-player-title'>
                            {String(currentPoi.title ?? `POI ${currentPoi.number}`)}
                        </div>
                        <button
                            type='button'
                            className='poi-player-button'
                            onClick={() => {
                                const nextIndex = currentPoiIndex < poiList.length - 1 ? currentPoiIndex + 1 : 0;
                                const nextPoi = poiList[nextIndex];
                                if (nextPoi?.id) window.viewer?.focusPoi?.(String(nextPoi.id));
                            }}
                        >
                            ›
                        </button>
                    </div>
                )}
                <PopupPanel observerData={this.state} setProperty={this._setStateProperty} />
                <ErrorBox observerData={this.state} setProperty={this._setStateProperty} />
                <WarningsBox observerData={this.state} setProperty={this._setStateProperty} />
                {showLoadProgressBackdrop && (
                    <div className="load-progress-backdrop" style={{ backgroundColor: loadProgressBackdropColor }} />
                )}
                {this.state?.ui?.spinner && (
                    <div className="load-progress-wrapper">
                        <Progress value={this.state.ui.loadProgress ?? 0} />
                        <div className='load-progress-value'>
                            {`${Math.max(0, Math.min(100, Math.round(this.state.ui.loadProgress ?? 0)))}%`}
                        </div>
                    </div>
                )}
            </div>
        </div>;
    }
}

export default (observer: Observer) => {
    const root = createRoot(document.getElementById('app'));
    root.render(<App observer={observer}/>);

    // Commit the initial mount synchronously
    flushSync(() => {
        root.render(<App observer={observer} />);
    });

    // Prevent flash of expanded panel: show only after layout is settled (2 frames)
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            document.body.classList.add('ui-ready');
        });
    });
};
