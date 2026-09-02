import { lodColorCss } from '../lod-palette';
import { resolutionColorCss } from '../resolution-palette';
import {
    TIMELINE_FPS_OPTIONS,
    formatTimelineSeconds,
    stepTimelineZoom,
    type TimelineUnit
} from './timeline-units';

/** Отступ по краям дорожки: под крайние подписи и чтобы бегунок не срезался. */
const PADDING = 20;

type Milestone = {
    depth: number;
    sequence: number;
    errorRatio: number;
    lastSequence: number;
    lastErrorRatio: number;
    time: number;
    lastTime: number;
};

type SurfaceEvent = {
    type: 'orbit' | 'pan' | 'zoom';
    time: number;
};

type TimelineState = {
    duration: number;
    replay: number;
    playing: boolean;
    loop: boolean;
    speed: number;
    displayUnit: TimelineUnit;
    fps: number;
    scheme: 'lod' | 'resolution';
    milestones: Milestone[];
    surfaceEvents: SurfaceEvent[];
};

type TimelineLabels = {
    stepBack: string;
    play: string;
    stepForward: string;
    loop: string;
    recordAgain: string;
    milestoneTitle: string;
    lastMilestoneTitle: string;
    now: string;
    timeUnit: string;
    timecode: string;
    frames: string;
    zoom: string;
    orbit: string;
    pan: string;
};

type TimelineCallbacks = {
    onStep: (delta: number) => void;
    onTogglePlay: () => void;
    onSpeed: (speed: number) => void;
    onUnit: (unit: TimelineUnit) => void;
    onFps: (fps: number) => void;
    onToggleLoop: () => void;
    onRecordAgain: () => void;
    onScrub: (value: number) => void;
    onRequestRender: () => void;
};

/**
 * DOM временной шкалы перемотки тайлов.
 *
 * Модуль импортируется динамически только при первом входе в редактор: обычный просмотр
 * модели не загружает ни этот код, ни ResizeObserver, ни обработчики дорожки.
 */
class TileReplayTimeline {
    private readonly panel: HTMLDivElement;

    private readonly area: HTMLDivElement;

    private readonly ticks: HTMLDivElement;

    private readonly playButton: HTMLButtonElement;

    private readonly speedSelect: HTMLSelectElement;

    private readonly unitSelect: HTMLSelectElement;

    private readonly fpsSelect: HTMLSelectElement;

    private readonly loopButton: HTMLButtonElement;

    private readonly resizeObserver: ResizeObserver;

    private readonly nowLabel: string;

    private readonly milestoneTitleTemplate: string;

    private readonly lastMilestoneTitleTemplate: string;

    private readonly labelsOrbit: string;

    private readonly labelsPan: string;

    private readonly labelsZoom: string;

    private cursor: HTMLDivElement | null = null;

    private layoutKey = '';

    private duration = 0;

    private displayUnit: TimelineUnit = 'timecode';

    private fps = 30;

    private zoom = 1;

    constructor(parent: HTMLElement, labels: TimelineLabels, callbacks: TimelineCallbacks) {
        this.nowLabel = labels.now;
        this.milestoneTitleTemplate = labels.milestoneTitle;
        this.lastMilestoneTitleTemplate = labels.lastMilestoneTitle;
        this.labelsOrbit = labels.orbit;
        this.labelsPan = labels.pan;
        this.labelsZoom = labels.zoom;
        const panel = document.createElement('div');
        panel.id = 'timeline-panel';

        const controls = document.createElement('div');
        controls.id = 'controls-wrap';
        const spacerLeft = document.createElement('div');
        spacerLeft.className = 'spacer';
        controls.appendChild(spacerLeft);

        const buttons = document.createElement('div');
        buttons.id = 'button-controls';
        const makeButton = (glyph: string, hint: string, onClick: () => void) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'button';
            button.title = hint;
            const icon = document.createElement('span');
            icon.className = 'material-symbols-outlined';
            icon.textContent = glyph;
            button.appendChild(icon);
            button.addEventListener('click', onClick);
            buttons.appendChild(button);
            return button;
        };
        makeButton('skip_previous', labels.stepBack, () => callbacks.onStep(-1));
        this.playButton = makeButton('play_arrow', labels.play, callbacks.onTogglePlay);
        makeButton('skip_next', labels.stepForward, () => callbacks.onStep(1));
        controls.appendChild(buttons);

        const spacer = document.createElement('div');
        spacer.className = 'spacer';
        const settings = document.createElement('div');
        settings.id = 'settings-controls';

        const unit = document.createElement('select');
        unit.id = 'tile-timeline-unit';
        unit.className = 'timeline-select';
        unit.title = labels.timeUnit;
        unit.setAttribute('aria-label', labels.timeUnit);
        ([
            ['timecode', labels.timecode],
            ['frames', labels.frames]
        ] as Array<[TimelineUnit, string]>).forEach(([value, label]) => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = label;
            unit.appendChild(option);
        });
        unit.addEventListener('change', () => callbacks.onUnit(unit.value as TimelineUnit));
        settings.appendChild(unit);
        this.unitSelect = unit;

        const fpsSelect = document.createElement('select');
        fpsSelect.id = 'tile-timeline-fps';
        fpsSelect.className = 'timeline-select';
        fpsSelect.title = 'FPS';
        fpsSelect.setAttribute('aria-label', 'FPS');
        TIMELINE_FPS_OPTIONS.forEach((value) => {
            const option = document.createElement('option');
            option.value = String(value);
            option.textContent = `${value} FPS`;
            fpsSelect.appendChild(option);
        });
        fpsSelect.addEventListener('change', () => callbacks.onFps(Number(fpsSelect.value) || 30));
        settings.appendChild(fpsSelect);
        this.fpsSelect = fpsSelect;

        const speed = document.createElement('select');
        speed.id = 'speed';
        speed.className = 'timeline-select';
        [0.25, 0.5, 1, 2].forEach((value) => {
            const option = document.createElement('option');
            option.value = String(value);
            option.textContent = `${value}×`;
            speed.appendChild(option);
        });
        speed.addEventListener('change', () => callbacks.onSpeed(Number(speed.value) || 1));
        settings.appendChild(speed);
        this.speedSelect = speed;

        const loop = document.createElement('button');
        loop.type = 'button';
        loop.id = 'loop';
        loop.title = labels.loop;
        const loopIcon = document.createElement('span');
        loopIcon.className = 'material-symbols-outlined';
        loopIcon.textContent = 'repeat';
        loop.appendChild(loopIcon);
        loop.addEventListener('click', callbacks.onToggleLoop);
        settings.appendChild(loop);
        this.loopButton = loop;

        const restart = document.createElement('button');
        restart.type = 'button';
        restart.id = 'restart';
        restart.title = labels.recordAgain;
        const restartIcon = document.createElement('span');
        restartIcon.className = 'material-symbols-outlined';
        restartIcon.textContent = 'restart_alt';
        restart.appendChild(restartIcon);
        restart.addEventListener('click', callbacks.onRecordAgain);
        settings.appendChild(restart);

        const zoomOut = document.createElement('button');
        zoomOut.type = 'button';
        zoomOut.className = 'timeline-zoom-button';
        zoomOut.title = `${labels.zoom} −`;
        zoomOut.setAttribute('aria-label', zoomOut.title);
        const zoomOutIcon = document.createElement('span');
        zoomOutIcon.className = 'material-symbols-outlined';
        zoomOutIcon.textContent = 'zoom_out';
        zoomOut.appendChild(zoomOutIcon);
        zoomOut.disabled = true;
        settings.appendChild(zoomOut);

        const zoomValue = document.createElement('span');
        zoomValue.className = 'timeline-zoom-value';
        zoomValue.textContent = '100%';
        settings.appendChild(zoomValue);

        const zoomIn = document.createElement('button');
        zoomIn.type = 'button';
        zoomIn.className = 'timeline-zoom-button';
        zoomIn.title = `${labels.zoom} +`;
        zoomIn.setAttribute('aria-label', zoomIn.title);
        const zoomInIcon = document.createElement('span');
        zoomInIcon.className = 'material-symbols-outlined';
        zoomInIcon.textContent = 'zoom_in';
        zoomIn.appendChild(zoomInIcon);
        settings.appendChild(zoomIn);
        spacer.appendChild(settings);
        controls.appendChild(spacer);
        panel.appendChild(controls);

        const ticks = document.createElement('div');
        ticks.id = 'ticks';
        const area = document.createElement('div');
        area.id = 'ticks-area';
        ticks.appendChild(area);
        panel.appendChild(ticks);
        parent.appendChild(panel);
        this.panel = panel;
        this.area = area;
        this.ticks = ticks;

        const setZoom = (next: number) => {
            if (next === this.zoom) return;
            const viewportWidth = Math.max(1, ticks.clientWidth);
            const oldWidth = Math.max(1, area.clientWidth - PADDING * 2);
            const centerRatio = Math.max(0, Math.min(1,
                (ticks.scrollLeft + viewportWidth / 2 - PADDING) / oldWidth));
            this.zoom = next;
            area.style.width = `${Math.max(viewportWidth, viewportWidth * this.zoom)}px`;
            zoomValue.textContent = `${Math.round(this.zoom * 100)}%`;
            zoomOut.disabled = this.zoom <= 1;
            zoomIn.disabled = this.zoom >= 4;
            this.invalidate();
            requestAnimationFrame(() => {
                const newWidth = Math.max(1, area.clientWidth - PADDING * 2);
                ticks.scrollLeft = PADDING + centerRatio * newWidth - viewportWidth / 2;
                callbacks.onRequestRender();
            });
        };
        zoomOut.addEventListener('click', () => setZoom(stepTimelineZoom(this.zoom, -1)));
        zoomIn.addEventListener('click', () => setZoom(stepTimelineZoom(this.zoom, 1)));

        let scrubbing = false;
        const setFromEvent = (event: PointerEvent) => {
            const width = area.clientWidth - PADDING * 2;
            const value = Math.max(0, Math.min(this.duration,
                (event.offsetX - PADDING) / Math.max(1, width) * this.duration));
            callbacks.onScrub(value);
        };
        area.addEventListener('pointerdown', (event: PointerEvent) => {
            if (scrubbing || !event.isPrimary) return;
            scrubbing = true;
            area.setPointerCapture(event.pointerId);
            setFromEvent(event);
        });
        area.addEventListener('pointermove', (event: PointerEvent) => {
            if (scrubbing) setFromEvent(event);
        });
        const stop = (event: PointerEvent) => {
            if (!scrubbing) return;
            scrubbing = false;
            area.releasePointerCapture(event.pointerId);
        };
        area.addEventListener('pointerup', stop);
        area.addEventListener('pointercancel', stop);

        this.resizeObserver = new ResizeObserver(() => {
            this.area.style.width = `${Math.max(1, this.ticks.clientWidth * this.zoom)}px`;
            this.invalidate();
            callbacks.onRequestRender();
        });
        this.resizeObserver.observe(ticks);
    }

    update(state: TimelineState) {
        this.panel.style.display = 'block';
        this.duration = state.duration;
        this.displayUnit = state.displayUnit;
        this.fps = state.fps;
        if (this.speedSelect.value !== String(state.speed)) {
            this.speedSelect.value = String(state.speed);
        }
        if (this.unitSelect.value !== state.displayUnit) this.unitSelect.value = state.displayUnit;
        if (this.fpsSelect.value !== String(state.fps)) this.fpsSelect.value = String(state.fps);
        this.loopButton.classList.toggle('active', state.loop);
        const glyph = this.playButton.querySelector('.material-symbols-outlined');
        if (glyph) glyph.textContent = state.playing ? 'pause' : 'play_arrow';

        const key = `${this.area.clientWidth}|${this.zoom}|${state.duration}|${state.scheme}|${state.displayUnit}|${state.fps}|${
            state.milestones.map(m => `${m.depth}:${m.time}:${m.lastTime}`).join(',')}|${
            state.surfaceEvents.map(event => `${event.type}:${event.time}`).join(',')}`;
        if (key !== this.layoutKey) {
            this.layoutKey = key;
            this.rebuild(state);
            return;
        }
        this.updateCursor(state.replay, state.duration);
    }

    hide() {
        this.panel.style.display = 'none';
    }

    invalidate() {
        this.layoutKey = '';
    }

    destroy() {
        this.resizeObserver.disconnect();
        this.panel.remove();
    }

    private updateCursor(replay: number, duration: number) {
        if (!this.cursor) return;
        const width = this.area.clientWidth - PADDING * 2;
        const at = replay < 0 ? duration : replay;
        this.cursor.style.left = `${PADDING + Math.floor(at / Math.max(0.001, duration) * width)}px`;
        this.cursor.textContent = replay < 0 ? this.nowLabel : formatTimelineSeconds(replay, this.displayUnit, this.fps);
    }

    private rebuild(state: TimelineState) {
        this.area.innerHTML = '';
        const width = this.area.clientWidth - PADDING * 2;
        const at = (value: number) => PADDING + Math.floor(value / Math.max(0.001, state.duration) * width);
        const minStep = Math.max(0.001, state.duration / Math.max(1, Math.floor(width / 90)));
        const magnitude = 10 ** Math.floor(Math.log10(minStep));
        const labelStep = [1, 2, 5, 10].map(m => m * magnitude).find(v => v >= minStep) ?? 10 * magnitude;
        const tickStep = labelStep === 1 ? 0 : labelStep / (labelStep % 5 === 0 ? 5 : 2);

        for (let value = 0; value < state.duration; value += labelStep) {
            const label = document.createElement('div');
            label.classList.add('time-label');
            label.style.left = `${at(value)}px`;
            label.textContent = formatTimelineSeconds(value, state.displayUnit, state.fps);
            this.area.appendChild(label);
        }
        if (tickStep > 0) {
            for (let value = tickStep; value < state.duration; value += tickStep) {
                if (value % labelStep === 0) continue;
                const tick = document.createElement('div');
                tick.classList.add('time-tick');
                tick.style.left = `${at(value)}px`;
                this.area.appendChild(tick);
            }
        }

        state.milestones.forEach(({ depth, sequence, errorRatio, lastSequence, lastErrorRatio, time, lastTime }) => {
            const first = document.createElement('div');
            first.classList.add('time-label', 'key', 'first');
            first.style.left = `${at(time)}px`;
            first.style.backgroundColor = state.scheme === 'resolution' ?
                resolutionColorCss(errorRatio) : lodColorCss(depth);
            const title = this.milestoneTitleTemplate
            .replace('{level}', String(depth))
            .replace('{frame}', String(sequence));
            first.title = title;
            first.setAttribute('aria-label', title);
            first.dataset.kind = 'first';
            first.dataset.depth = String(depth);
            first.dataset.sequence = String(sequence);
            this.area.appendChild(first);

            // Контурное кольцо менее заметно, чем ромбик. Если у уровня в записи только один
            // тайл, кольцо окажется вокруг ромбика и честно покажет, что обе вехи совпали.
            const last = document.createElement('div');
            last.classList.add('time-label', 'key', 'last');
            last.style.left = `${at(lastTime)}px`;
            last.style.borderColor = state.scheme === 'resolution' ?
                resolutionColorCss(lastErrorRatio) : lodColorCss(depth);
            const lastTitle = this.lastMilestoneTitleTemplate
            .replace('{level}', String(depth))
            .replace('{frame}', String(lastSequence));
            last.title = lastTitle;
            last.setAttribute('aria-label', lastTitle);
            last.dataset.kind = 'last';
            last.dataset.depth = String(depth);
            last.dataset.sequence = String(lastSequence);
            this.area.appendChild(last);
        });

        const eventNames = { orbit: this.labelsOrbit, pan: this.labelsPan, zoom: this.labelsZoom };
        state.surfaceEvents.forEach((event, index) => {
            const marker = document.createElement('div');
            marker.classList.add('time-label', 'surface-event', event.type);
            marker.style.left = `${at(event.time)}px`;
            marker.dataset.kind = event.type;
            marker.dataset.time = String(event.time);
            const title = `${eventNames[event.type]} ${index + 1} · ${formatTimelineSeconds(event.time, state.displayUnit, state.fps)}`;
            marker.title = title;
            marker.setAttribute('aria-label', title);
            this.area.appendChild(marker);
        });

        const cursor = document.createElement('div');
        cursor.classList.add('time-label', 'cursor');
        this.area.appendChild(cursor);
        this.cursor = cursor;
        this.updateCursor(state.replay, state.duration);
    }
}

export { TileReplayTimeline, type TimelineState };
