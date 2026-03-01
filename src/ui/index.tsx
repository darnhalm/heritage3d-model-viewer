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
};

class App extends React.Component<{ observer: Observer }> {
    state: ObserverData = null;

    canvasRef: any;

    private stateUpdateRaf: number | null = null;

    constructor(props: any) {
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
    }

    componentWillUnmount(): void {
        if (this.stateUpdateRaf !== null) {
            window.cancelAnimationFrame(this.stateUpdateRaf);
            this.stateUpdateRaf = null;
        }
    }

    _retrieveState = () => {
        const state: any = {};
        (this.props.observer as any)._keys.forEach((key: string) => {
            state[key] = this.props.observer.get(key);
        });
        return state;
    };

    _setStateProperty = (path: string, value: string) => {
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

        if (poiList !== prevPoiList && poiList !== '[]' && !activeId) {
            const firstPoi = this.getPoiList()[0];
            if (firstPoi?.id) {
                window.viewer?.focusPoi?.(String(firstPoi.id));
            }
        }
    }

    render() {
        if (!this.state) return null;
        const embed = this.state?.ui?.embed;
        const poiList = this.getPoiList();
        const activePoiId = this.state?.poi?.activeId || '';
        const activePoiIndex = poiList.findIndex((poi) => String(poi.id) === activePoiId);
        const currentPoiIndex = activePoiIndex >= 0 ? activePoiIndex : (poiList.length > 0 ? 0 : -1);
        const currentPoi = currentPoiIndex >= 0 ? poiList[currentPoiIndex] : null;
        const showLeftPanel = !(embed?.enabled && !embed?.panel);
        const showLoadControls = !embed?.enabled;
        const showSelectedNode = !embed?.enabled && !!this.state?.debug?.withTextureOnly;
        const showEmbedStartOverlay = !!(embed?.enabled && embed?.waiting);
        const showEmbedLoadingBackdrop = !!(embed?.enabled && !embed?.waiting && embed?.placeholderUrl && this.state?.ui?.spinner);
        const showPoiPlayer = poiList.length > 0 && !(embed?.enabled && !embed?.tour);
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
                            className='poi-player-button'
                            title='Previous POI'
                            onClick={() => {
                                const prevIndex = currentPoiIndex > 0 ? currentPoiIndex - 1 : poiList.length - 1;
                                const prevPoi = poiList[prevIndex];
                                if (prevPoi?.id) window.viewer?.focusPoi?.(String(prevPoi.id));
                            }}
                        >
                            &#8249;
                        </button>
                        <div className='poi-player-title'>
                            {String(currentPoi.title ?? `POI ${currentPoi.number}`)}
                        </div>
                        <button
                            type='button'
                            className='poi-player-button'
                            title='Next POI'
                            onClick={() => {
                                const nextIndex = currentPoiIndex < poiList.length - 1 ? currentPoiIndex + 1 : 0;
                                const nextPoi = poiList[nextIndex];
                                if (nextPoi?.id) window.viewer?.focusPoi?.(String(nextPoi.id));
                            }}
                        >
                            &#8250;
                        </button>
                    </div>
                )}
                <PopupPanel observerData={this.state} setProperty={this._setStateProperty} />
                <ErrorBox observerData={this.state} setProperty={this._setStateProperty} />
                <WarningsBox observerData={this.state} setProperty={this._setStateProperty} />
                {this.state?.ui?.spinner && (
                    <div className="load-progress-wrapper">
                        <Progress value={this.state.ui.loadProgress ?? 0} />
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
