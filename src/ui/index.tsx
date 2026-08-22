import { Observer } from '@playcanvas/observer';
import { Button, Container, Progress } from '@playcanvas/pcui/react';
import React from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';

import { postToViewerParent } from '../embed-messaging';
import { t } from '../i18n/translations';
import { DEFAULT_POI_DURATION_SECONDS, DEFAULT_POI_HOLD_TIME_SECONDS } from '../poi-defaults';
import { ObserverData } from '../types';
import { ErrorBox, WarningsBox } from './errors';
import LeftPanel from './left-panel';
import { startLeftPanelTour } from './left-panel/tour';
import LoadControls from './load-controls';
import PopupPanel from './popup-panel';
import SelectedNode from './selected-node';

// Через сколько применить изменения observer, если кадр так и не наступил.
// Полтора кадра при 60 Гц: пока кадры идут, страховка никогда не срабатывает первой.
const STATE_UPDATE_FALLBACK_MS = 25;

type PoiUiEntry = {
    id: string;
    number: number;
    title?: string;
    duration?: number;
    holdTime?: number;
    trigger?: boolean;
};

const rgbToCssColor = (color?: { r: number; g: number; b: number } | null) => {
    if (!color) return '#ffffff';
    const channel = (value: number) => Math.max(0, Math.min(255, Math.round(value * 255)));
    return `rgb(${channel(color.r)}, ${channel(color.g)}, ${channel(color.b)})`;
};

// Нейтральный тёмно-серый фон загрузки (НЕ белый и НЕ цветной) — чтобы под
// прогресс-баром не мелькал ни белый кадр, ни «синий» дефолт. Поверх плавно
// проявляется размытая заставка и подгружается реальный цвет сцены.
const DEFAULT_LOADING_BACKGROUND_COLOR = '#2b2e33';

class App extends React.Component<{ observer: Observer }> {
    state: ObserverData | null = null;

    canvasRef: React.RefObject<HTMLCanvasElement | null>;

    private stateUpdateRaf: number | null = null;

    // Страховочный таймер к кадру: см. `scheduleStateUpdate`.
    private stateUpdateTimer: ReturnType<typeof setTimeout> | null = null;

    private poiSlideshowTimeout: ReturnType<typeof setTimeout> | null = null;

    private poiProgressRaf: number | null = null;

    private currentPoiStartTime: number = 0;

    private currentPoiDuration: number = 0;

    private currentPoiHoldTime: number = 0;

    private activePoiId: string = '';

    // Токен сессии воспроизведения: инкрементируется при каждом старте карточки,
    // паузе, стопе и ручном переключении. Отложенный колбэк авто-перехода сверяет
    // свой токен с текущим и молча выходит, если тур уже ушёл вперёд/остановлен.
    private poiPlaybackToken: number = 0;

    // Прошедшее время карточки в момент паузы (сек). Пока не null — тур на паузе:
    // прогресс заморожен на этом значении, Play продолжит с него, а не с нуля.
    private poiPausedElapsed: number | null = null;

    // Stop сам переводит playing в false. Флаг не даёт componentDidUpdate
    // принять этот переход за обычную паузу и снова заморозить камеру.
    private poiStopPending: boolean = false;

    constructor(props: { observer: Observer }) {
        super(props);

        this.canvasRef = React.createRef();
        this.state = { ...this._retrieveState() };

        props.observer.on('*:set', this.scheduleStateUpdate);

        this.updatePoiProgress();
    }

    private setOverallProgress = (pct: number) => {
        const fill = document.getElementById('poi-player-progress-fill');
        if (fill) fill.style.width = `${Math.min(100, Math.max(0, pct))}%`;
    };

    private updatePoiProgress = () => {
        const paused = this.poiPausedElapsed !== null;
        const playing = !!this.state?.poi?.playing;

        // Idle/Stop: ни воспроизведения, ни паузы — всё в ноль.
        if ((!playing && !paused) || !this.activePoiId) {
            document.querySelectorAll('.poi-progress-transition, .poi-progress-hold').forEach((el) => {
                (el as HTMLElement).style.width = '0%';
            });
            this.setOverallProgress(0);
            this.poiProgressRaf = requestAnimationFrame(this.updatePoiProgress);
            return;
        }

        const duration = this.currentPoiDuration;
        const holdTime = this.currentPoiHoldTime;
        // На паузе время заморожено на poiPausedElapsed, иначе идёт от старта карточки.
        const cardTotal = duration + holdTime;
        const elapsed = paused ?
            (this.poiPausedElapsed as number) :
            Math.min((Date.now() - this.currentPoiStartTime) / 1000, cardTotal);

        const transitionProgress = Math.min(100, Math.max(0, duration > 0 ? (elapsed / duration) * 100 : 100));
        let holdProgress = 0;
        if (elapsed > duration && holdTime > 0) {
            holdProgress = Math.min(100, Math.max(0, ((elapsed - duration) / holdTime) * 100));
        }

        document.querySelectorAll('.poi-progress-transition').forEach((el) => {
            const castEl = el as HTMLElement;
            if (el.id === `poi-progress-transition-${this.activePoiId}`) castEl.style.width = `${transitionProgress}%`;
            else castEl.style.width = '0%';
        });
        document.querySelectorAll('.poi-progress-hold').forEach((el) => {
            const castEl = el as HTMLElement;
            if (el.id === `poi-progress-hold-${this.activePoiId}`) castEl.style.width = `${holdProgress}%`;
            else castEl.style.width = '0%';
        });

        // Общий прогресс тура: сумма (duration + holdTime) всех обычных точек,
        // завершённые карточки до текущей + прошедшее в текущей.
        const list = this.getPoiList();
        const idx = list.findIndex(poi => String(poi.id) === this.activePoiId);
        let total = 0;
        let before = 0;
        list.forEach((poi, i) => {
            const cardT = (poi.duration ?? DEFAULT_POI_DURATION_SECONDS) + (poi.holdTime ?? DEFAULT_POI_HOLD_TIME_SECONDS);
            total += cardT;
            if (idx >= 0 && i < idx) before += cardT;
        });
        const overallElapsed = before + Math.min(elapsed, cardTotal);
        this.setOverallProgress(total > 0 ? (overallElapsed / total) * 100 : 0);

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

    /**
     * Свести всплеск изменений observer в одно обновление React.
     *
     * Раньше обновление висело только на `requestAnimationFrame` — и терялось насовсем,
     * если кадра не случалось. У приложения `autoRender = false`: когда рисовать нечего,
     * браузер кадров не производит, и запрошенный callback просто не вызывается. Поймано
     * счётчиками на живом сценарии: `scheduled: 1, ran: 0` — в туре нажали «следующая
     * точка», камера улетела, `poi.activeId` сменился, а подпись осталась от прежней точки
     * и висела так, пока в интерфейсе случайно не менялось что-нибудь ещё.
     *
     * Теперь кадр и таймер соревнуются: кто первым, тот и применяет, второй снимается. Пока
     * кадры идут, всё как было — одно обновление на кадр; когда их нет, состояние доезжает
     * с задержкой таймера, а не теряется.
     */
    private scheduleStateUpdate = () => {
        if (this.stateUpdateRaf !== null || this.stateUpdateTimer !== null) return;

        const apply = () => {
            if (this.stateUpdateRaf !== null) {
                window.cancelAnimationFrame(this.stateUpdateRaf);
                this.stateUpdateRaf = null;
            }
            if (this.stateUpdateTimer !== null) {
                clearTimeout(this.stateUpdateTimer);
                this.stateUpdateTimer = null;
            }
            this.setState(this._retrieveState());
        };

        this.stateUpdateRaf = window.requestAnimationFrame(apply);
        this.stateUpdateTimer = setTimeout(apply, STATE_UPDATE_FALLBACK_MS);
    };

    _retrieveState = () => {
        return this.props.observer.json() as ObserverData;
    };

    _setStateProperty = (path: string, value: any) => {
        this.props.observer.set(path, value);
    };

    private getPoiList(): PoiUiEntry[] {
        try {
            const parsed = JSON.parse(String(this.state?.poi?.list ?? '[]'));
            // Тур-плеер показывает только обычные точки. Триггеры (привязаны к нотам)
            // — отдельный тип, в тур/навигацию/слайдшоу не входят.
            return Array.isArray(parsed) ? (parsed as PoiUiEntry[]).filter(p => !p.trigger) : [];
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

        // Авто-фокус первой точки при загрузке нужен ТОЛЬКО для тур-плеера.
        // Если плеер тура скрыт (tour выключен), не выделяем точку автоматически —
        // иначе на хосте текст сам прокручивается к «точке интереса 1» при открытии.
        const embed = this.state?.ui?.embed;
        const tourPlayerShown = !(embed?.enabled && !embed?.tour);
        if (tourPlayerShown && poiList !== prevPoiList && poiList !== '[]' && !activeId) {
            const firstPoi = this.getPoiList()[0];
            if (firstPoi?.id) {
                window.viewer?.focusPoi?.(String(firstPoi.id));
            }
        }

        const list = this.getPoiList();
        if (this.poiStopPending && !playing) {
            // Stop уже отменил перелёт и сбросил таймеры. Не вызываем pauseCard
            // повторно на отложенном React-обновлении observer.
            this.poiStopPending = false;
            this.poiPausedElapsed = null;
            this.syncCardMetrics(activeId, list);
        } else if (playing && !prevPlaying && this.poiPausedElapsed !== null && activeId === this.activePoiId) {
            // Возобновление с паузы — продолжаем ту же карточку с замороженной фазы.
            this.resumeCard(activeId, list);
        } else if (playing && (!prevPlaying || activeId !== prevActiveId)) {
            // Старт карточки заново: первый Play или переход на другую точку.
            this.poiPausedElapsed = null;
            this.startCard(activeId, list);
            if (!prevPlaying) this.emitTourState('playing');
        } else if (!playing && prevPlaying) {
            // Пауза — мгновенно замораживаем перелёт камеры, таймер и прогресс.
            this.pauseCard();
        } else if (!playing && activeId !== prevActiveId) {
            // Ручное переключение точки вне воспроизведения: снимаем паузу и
            // синхронизируем метрики карточки (прогресс покажет исходное состояние).
            this.poiPausedElapsed = null;
            this.syncCardMetrics(activeId, list);
        }
    }

    private scheduleAdvance(seconds: number, activeId: string, list: PoiUiEntry[], token: number) {
        if (this.poiSlideshowTimeout !== null) {
            clearTimeout(this.poiSlideshowTimeout);
        }
        this.poiSlideshowTimeout = setTimeout(() => {
            if (token !== this.poiPlaybackToken) return; // устаревший колбэк — тур ушёл вперёд/на паузу/стоп
            const currentIndex = list.findIndex(poi => String(poi.id) === activeId);
            const nextIndex = currentIndex < list.length - 1 ? currentIndex + 1 : 0;
            const nextPoi = list[nextIndex];
            if (nextPoi?.id) window.viewer?.focusPoi?.(String(nextPoi.id));
        }, Math.max(0, seconds) * 1000);
    }

    private syncCardMetrics(activeId: string, list: PoiUiEntry[]) {
        const currentPoi = list.find(poi => String(poi.id) === activeId);
        this.currentPoiDuration = currentPoi?.duration ?? DEFAULT_POI_DURATION_SECONDS;
        this.currentPoiHoldTime = currentPoi?.holdTime ?? DEFAULT_POI_HOLD_TIME_SECONDS;
        this.currentPoiStartTime = Date.now();
        this.activePoiId = activeId;
    }

    private startCard(activeId: string, list: PoiUiEntry[]) {
        this.poiPlaybackToken++;
        this.syncCardMetrics(activeId, list);
        this.scheduleAdvance(this.currentPoiDuration + this.currentPoiHoldTime, activeId, list, this.poiPlaybackToken);
    }

    private resumeCard(activeId: string, list: PoiUiEntry[]) {
        this.poiPlaybackToken++;
        const elapsed = this.poiPausedElapsed ?? 0;
        this.poiPausedElapsed = null;
        const cardTotal = this.currentPoiDuration + this.currentPoiHoldTime;
        this.currentPoiStartTime = Date.now() - elapsed * 1000;
        this.activePoiId = activeId;
        window.viewer?.resumeCameraFly?.();
        this.scheduleAdvance(cardTotal - elapsed, activeId, list, this.poiPlaybackToken);
        this.emitTourState('playing');
    }

    private pauseCard() {
        this.poiPlaybackToken++; // инвалидируем запланированный авто-переход
        if (this.poiSlideshowTimeout !== null) {
            clearTimeout(this.poiSlideshowTimeout);
            this.poiSlideshowTimeout = null;
        }
        const cardTotal = this.currentPoiDuration + this.currentPoiHoldTime;
        const elapsed = Math.min((Date.now() - this.currentPoiStartTime) / 1000, cardTotal);
        this.poiPausedElapsed = Math.max(0, elapsed);
        window.viewer?.pauseCameraFly?.();
        this.emitTourState('paused');
    }

    private emitTourState(state: 'playing' | 'paused' | 'stopped') {
        postToViewerParent({
            type: 'tour-state',
            state,
            id: this.activePoiId || null,
            elapsed: state === 'stopped' ? 0 : (this.poiPausedElapsed ?? Math.max(0, (Date.now() - this.currentPoiStartTime) / 1000))
        });
    }

    private toggleTourPlayback = () => {
        const playing = !!this.state?.poi?.playing;
        if (playing) {
            this._setStateProperty('poi.playing', false);
            return;
        }

        // A fresh Play always starts the tour from its first regular POI.
        // Resume is the only case that keeps the currently active POI.
        if (this.poiPausedElapsed === null) {
            const first = this.getPoiList()[0];
            if (first?.id) {
                window.viewer?.focusPoi?.(String(first.id));
            }
        }
        this._setStateProperty('poi.playing', true);
    };

    private stopTour = () => {
        this.poiPlaybackToken++;
        if (this.poiSlideshowTimeout !== null) {
            clearTimeout(this.poiSlideshowTimeout);
            this.poiSlideshowTimeout = null;
        }
        const wasPlaying = !!this.state?.poi?.playing;
        this.poiPausedElapsed = null;
        this.poiStopPending = wasPlaying;
        this._setStateProperty('poi.playing', false);

        // Вернуть выбор к первой обычной точке, но не доигрывать начатый
        // focusPoi перелёт: Stop оставляет камеру там, где её остановили.
        const first = this.getPoiList()[0];
        this.currentPoiStartTime = 0;
        if (first?.id) {
            this.activePoiId = String(first.id);
            window.viewer?.focusPoi?.(String(first.id));
        }
        window.viewer?.cancelCameraFly?.();
        this.setOverallProgress(0);
        this.emitTourState('stopped');
    };

    render() {
        if (!this.state) return null;
        const embed = this.state?.ui?.embed;
        const lang = this.state?.ui?.language;
        const poiList = this.getPoiList();
        const activePoiId = this.state?.poi?.activeId || '';
        const activePoiIndex = poiList.findIndex(poi => String(poi.id) === activePoiId);
        const currentPoiIndex = activePoiIndex >= 0 ? activePoiIndex : (poiList.length > 0 ? 0 : -1);
        const currentPoi = currentPoiIndex >= 0 ? poiList[currentPoiIndex] : null;
        const showLeftPanel = !(embed?.enabled && !embed?.panel);
        const showLoadControls = !embed?.enabled && (this.state?.ui?.cta ?? true);
        const showSelectedNode = !embed?.enabled && !!this.state?.debug?.withTextureOnly;
        const showEmbedStartOverlay = !!(embed?.enabled && embed?.waiting);
        const showEmbedLoadingBackdrop = !!(embed?.enabled && !embed?.waiting && embed?.placeholderUrl && this.state?.ui?.spinner);
        const showPoiPlayer = poiList.length > 0 && !(embed?.enabled && !embed?.tour);
        // Переключатель проекции живёт под навигационным кубом и показывается вместе с ним.
        const showProjectionToggle = !!this.state?.camera?.viewCube;
        const orthographic = !!this.state?.camera?.ortho;
        const showLoadProgressBackdrop = !!this.state?.ui?.spinner;
        const loadProgressBackdropColor = this.state?.ui?.loadingBackgroundReady && this.state?.skybox?.background === 'Solid Color' ?
            rgbToCssColor(this.state.skybox.backgroundColor) :
            DEFAULT_LOADING_BACKGROUND_COLOR;
        return <div id="application-container">
            {showLeftPanel && (
                <Container id="panel-left" width={32} flex resizable='right' resizeMin={220} resizeMax={800}>
                    <div className="header" style={{ display: 'none' }}>
                        <div id="title">
                            <img src={'static/heritage3d-logo.svg?v=2218652'}/>
                            <div>HERITAGE3D Viewer v1.0</div>
                        </div>
                    </div>
                    <div id="panel-toggle">
                        <img src={'static/heritage3d-logo.svg?v=2218652'}/>
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
                            <button
                                type='button'
                                className='left-panel-tour-button'
                                title={t('Tour: Help button', lang)}
                                aria-label={t('Tour: Help button', lang)}
                                onClick={() => {
                                    document.querySelector<HTMLElement>('.left-panel-tab-scene')?.click();
                                    window.setTimeout(() => startLeftPanelTour(lang), 0);
                                }}
                            >
                                ?
                            </button>
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
                {showProjectionToggle && (
                    <span
                        className='projection-toggle-slot'
                        title={orthographic ?
                            t('Orthographic projection (click for perspective)', lang) :
                            t('Perspective projection (click for orthographic)', lang)}
                    >
                        <Button
                            class={['projection-toggle', ...(orthographic ? ['active'] : [])]}
                            text={orthographic ? t('Ortho', lang) : t('Persp', lang)}
                            onClick={() => {
                                // Состояние читаем в момент клика, а не из замыкания рендера:
                                // React-обёртка pcui привязывает onClick один раз при монтировании
                                // и больше его не переустанавливает, поэтому захваченное значение
                                // навсегда осталось бы от первого рендера.
                                const viewer = window.viewer;
                                viewer?.setCameraProjection?.(!viewer?.isOrthographic?.());
                            }}
                        />
                    </span>
                )}
                {showLoadControls && <LoadControls observerData={this.state} setProperty={this._setStateProperty}/>}
                {showSelectedNode && <SelectedNode observerData={this.state} setProperty={this._setStateProperty} />}
                {showPoiPlayer && currentPoi && (
                    <div id='poi-player-overlay'>
                        <div className='poi-player-progress' aria-hidden='true'>
                            <div className='poi-player-progress-fill' id='poi-player-progress-fill' />
                        </div>
                        <button
                            type='button'
                            className='poi-player-button poi-player-play-button'
                            onClick={this.toggleTourPlayback}
                            title={this.state?.poi?.playing ? t('Pause', lang) : t('Play', lang)}
                            aria-label={this.state?.poi?.playing ? t('Pause', lang) : t('Play', lang)}
                        >
                            {this.state?.poi?.playing ? '⏸' : '►'}
                        </button>
                        <button
                            type='button'
                            className='poi-player-button'
                            onClick={this.stopTour}
                            title={t('Stop', lang)}
                            aria-label={t('Stop', lang)}
                        >
                            ⏹
                        </button>
                        <button
                            type='button'
                            className='poi-player-button'
                            onClick={() => {
                                const prevIndex = currentPoiIndex > 0 ? currentPoiIndex - 1 : poiList.length - 1;
                                const prevPoi = poiList[prevIndex];
                                if (prevPoi?.id) window.viewer?.focusPoi?.(String(prevPoi.id));
                            }}
                            title={t('Previous POI', lang)}
                            aria-label={t('Previous POI', lang)}
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
                            title={t('Next POI', lang)}
                            aria-label={t('Next POI', lang)}
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
