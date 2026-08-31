import { lodColorCss } from '../lod-palette';
import { resolutionColorCss } from '../resolution-palette';

/** Отступ по краям дорожки: под крайние подписи и чтобы бегунок не срезался. */
const PADDING = 20;

type Milestone = {
    depth: number;
    sequence: number;
    errorRatio: number;
};

type TimelineState = {
    count: number;
    replay: number;
    playing: boolean;
    loop: boolean;
    speed: number;
    scheme: 'lod' | 'resolution';
    milestones: Milestone[];
};

type TimelineLabels = {
    stepBack: string;
    play: string;
    stepForward: string;
    loop: string;
    recordAgain: string;
    now: string;
};

type TimelineCallbacks = {
    onStep: (delta: number) => void;
    onTogglePlay: () => void;
    onSpeed: (speed: number) => void;
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

    private readonly playButton: HTMLButtonElement;

    private readonly speedSelect: HTMLSelectElement;

    private readonly loopButton: HTMLButtonElement;

    private readonly resizeObserver: ResizeObserver;

    private readonly nowLabel: string;

    private cursor: HTMLDivElement | null = null;

    private layoutKey = '';

    private count = 0;

    constructor(parent: HTMLElement, labels: TimelineLabels, callbacks: TimelineCallbacks) {
        this.nowLabel = labels.now;
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
        const speed = document.createElement('select');
        speed.id = 'speed';
        [10, 30, 60, 120].forEach((value) => {
            const option = document.createElement('option');
            option.value = String(value);
            option.textContent = `${value}/с`;
            speed.appendChild(option);
        });
        speed.addEventListener('change', () => callbacks.onSpeed(Number(speed.value) || 30));
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

        let scrubbing = false;
        const setFromEvent = (event: PointerEvent) => {
            const width = area.clientWidth - PADDING * 2;
            const value = Math.max(0, Math.min(this.count,
                (event.offsetX - PADDING) / Math.max(1, width) * this.count));
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
            this.invalidate();
            callbacks.onRequestRender();
        });
        this.resizeObserver.observe(area);
    }

    update(state: TimelineState) {
        this.panel.style.display = 'block';
        this.count = state.count;
        if (this.speedSelect.value !== String(state.speed)) {
            this.speedSelect.value = String(state.speed);
        }
        this.loopButton.classList.toggle('active', state.loop);
        const glyph = this.playButton.querySelector('.material-symbols-outlined');
        if (glyph) glyph.textContent = state.playing ? 'pause' : 'play_arrow';

        const key = `${this.area.clientWidth}|${state.count}|${state.scheme}|${
            state.milestones.map(m => `${m.depth}:${m.sequence}`).join(',')}`;
        if (key !== this.layoutKey) {
            this.layoutKey = key;
            this.rebuild(state);
            return;
        }
        this.updateCursor(state.replay, state.count);
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

    private updateCursor(replay: number, count: number) {
        if (!this.cursor) return;
        const width = this.area.clientWidth - PADDING * 2;
        const at = replay < 0 ? count : replay;
        this.cursor.style.left = `${PADDING + Math.floor(at / Math.max(1, count) * width)}px`;
        this.cursor.textContent = replay < 0 ? this.nowLabel : String(Math.floor(replay));
    }

    private rebuild(state: TimelineState) {
        this.area.innerHTML = '';
        const width = this.area.clientWidth - PADDING * 2;
        const at = (value: number) => PADDING + Math.floor(value / Math.max(1, state.count) * width);
        const minStep = Math.max(1, state.count / Math.max(1, Math.floor(width / 50)));
        const magnitude = 10 ** Math.floor(Math.log10(minStep));
        const labelStep = [1, 2, 5, 10].map(m => m * magnitude).find(v => v >= minStep) ?? 10 * magnitude;
        const tickStep = labelStep === 1 ? 0 : labelStep / (labelStep % 5 === 0 ? 5 : 2);

        for (let value = 0; value < state.count; value += labelStep) {
            const label = document.createElement('div');
            label.classList.add('time-label');
            label.style.left = `${at(value)}px`;
            label.textContent = String(Math.round(value));
            this.area.appendChild(label);
        }
        if (tickStep > 0) {
            for (let value = tickStep; value < state.count; value += tickStep) {
                if (value % labelStep === 0) continue;
                const tick = document.createElement('div');
                tick.classList.add('time-tick');
                tick.style.left = `${at(value)}px`;
                this.area.appendChild(tick);
            }
        }

        state.milestones.forEach(({ depth, sequence, errorRatio }) => {
            const key = document.createElement('div');
            key.classList.add('time-label', 'key');
            key.style.left = `${at(sequence)}px`;
            key.style.backgroundColor = state.scheme === 'resolution' ?
                resolutionColorCss(errorRatio) : lodColorCss(depth);
            key.title = `L${depth} — ${sequence}`;
            this.area.appendChild(key);
        });

        const cursor = document.createElement('div');
        cursor.classList.add('time-label', 'cursor');
        this.area.appendChild(cursor);
        this.cursor = cursor;
        this.updateCursor(state.replay, state.count);
    }
}

export { TileReplayTimeline, type TimelineState };
