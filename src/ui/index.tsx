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

    render() {
        if (!this.state) return null;
        return <div id="application-container">
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
            </Container>
            <div id='canvas-wrapper'>
                <canvas id="application-canvas" ref={this.canvasRef} />
                <LoadControls observerData={this.state} setProperty={this._setStateProperty}/>
                <SelectedNode observerData={this.state} setProperty={this._setStateProperty} />
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
