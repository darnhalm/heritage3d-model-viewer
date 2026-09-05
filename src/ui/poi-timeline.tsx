import React, { useEffect, useMemo, useRef, useState } from 'react';

import { t } from '../i18n/translations';
import { DEFAULT_POI_DURATION_SECONDS, DEFAULT_POI_HOLD_TIME_SECONDS } from '../poi-defaults';
import { ObserverData } from '../types';
import { TIMELINE_FPS_OPTIONS, formatTimelineSeconds, normalizeTimelineFps, stepTimelineZoom, type TimelineUnit } from './timeline-units';

type PoiTimelineEntry = {
    id: string;
    number: number;
    title?: string;
    color?: string;
    duration?: number;
    holdTime?: number;
    trigger?: boolean;
    camera?: { position?: unknown; focus?: unknown; fov?: unknown };
};
type TimelineSegment = { poi: PoiTimelineEntry; start: number; arrival: number; end: number; duration: number; holdTime: number };
type PoiTimelineProps = {
    observerData: ObserverData;
    setProperty: (path: string, value: unknown) => void;
    onTogglePlay: () => void;
    onStop: () => void;
    onPrevious: () => void;
    onNext: () => void;
    onSeek: (time: number) => void;
    getPlaybackTime: () => number;
};

const PIXELS_PER_SECOND = 88;
const TRACK_PADDING = 24;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const parsePoiList = (raw: string): PoiTimelineEntry[] => {
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter((entry): entry is PoiTimelineEntry => (
            !!entry && typeof entry === 'object' && typeof entry.id === 'string' && !entry.trigger
        )) : [];
    } catch {
        return [];
    }
};
const safeColor = (value?: string) => (
    /^#[0-9a-f]{6}$/i.test(value ?? '') ? value as string : '#7c7678'
);
const mixWithWhite = (hex: string, colorShare: number) => {
    const value = Number.parseInt(hex.slice(1), 16);
    const mix = (channel: number) => Math.round(255 * (1 - colorShare) + channel * colorShare);
    return `rgb(${mix((value >> 16) & 255)}, ${mix((value >> 8) & 255)}, ${mix(value & 255)})`;
};
const contrastColor = (hex: string) => {
    const value = Number.parseInt(hex.slice(1), 16);
    const luminance = 0.299 * ((value >> 16) & 255) + 0.587 * ((value >> 8) & 255) + 0.114 * (value & 255);
    return luminance > 150 ? '#111111' : '#ffffff';
};

const PoiTimeline = ({ observerData, setProperty, onTogglePlay, onStop, onPrevious, onNext, onSeek, getPlaybackTime }: PoiTimelineProps) => {
    const lang = observerData.ui?.language;
    const [unit, setUnit] = useState<TimelineUnit>('timecode');
    const [playbackTime, setPlaybackTime] = useState(0);
    const [observerMode, setObserverMode] = useState(false);
    const [zoom, setZoom] = useState(1);
    const stopDraggingRef = useRef<(() => void) | null>(null);
    const scrubbingRef = useRef(false);
    const trackRef = useRef<HTMLDivElement>(null);
    const fps = normalizeTimelineFps(observerData.poi?.timeline?.fps);
    const poiList = useMemo(() => parsePoiList(observerData.poi?.list ?? '[]'), [observerData.poi?.list]);
    const segments = useMemo(() => {
        let cursor = 0;
        return poiList.map((poi): TimelineSegment => {
            const rawDuration = Number(poi.duration ?? DEFAULT_POI_DURATION_SECONDS);
            const rawHold = Number(poi.holdTime ?? DEFAULT_POI_HOLD_TIME_SECONDS);
            const duration = Number.isFinite(rawDuration) ? clamp(rawDuration, 0, 10) : DEFAULT_POI_DURATION_SECONDS;
            const holdTime = Number.isFinite(rawHold) ? clamp(rawHold, 0, 60) : DEFAULT_POI_HOLD_TIME_SECONDS;
            const segment = { poi, start: cursor, arrival: cursor + duration, end: cursor + duration + holdTime, duration, holdTime };
            cursor = segment.end;
            return segment;
        });
    }, [poiList]);
    const duration = segments.length > 0 ? segments[segments.length - 1].end : 0;
    const pixelsPerSecond = PIXELS_PER_SECOND * zoom;
    // Zoom must still enlarge a short tour that already fits in a wide timeline.
    // The CSS min-width keeps the initial track as wide as its viewport, so use that
    // viewport as the baseline once the ref is available as well.
    const contentWidth = Math.max(
        560,
        duration * pixelsPerSecond + TRACK_PADDING * 2,
        (trackRef.current?.clientWidth ?? 0) * zoom
    );
    const activeId = observerData.poi?.activeId ?? '';
    const playing = !!observerData.poi?.playing;
    const canObserve = segments.some(({ poi }) => (
        Array.isArray(poi.camera?.position) && poi.camera.position.length >= 3 &&
        Array.isArray(poi.camera?.focus) && poi.camera.focus.length >= 3
    ));

    useEffect(() => {
        document.body.classList.add('poi-timeline-open');
        return () => {
            stopDraggingRef.current?.();
            window.viewer?.setPoiObserverMode?.(false);
            document.body.classList.remove('poi-timeline-open');
        };
    }, []);
    useEffect(() => {
        let frame = 0;
        const update = () => {
            setPlaybackTime(clamp(getPlaybackTime(), 0, duration));
            if (playing) frame = requestAnimationFrame(update);
        };
        update();
        return () => cancelAnimationFrame(frame);
    }, [playing, activeId, duration, getPlaybackTime]);
    useEffect(() => {
        if (!canObserve && observerMode) {
            window.viewer?.setPoiObserverMode?.(false);
            setObserverMode(false);
        }
    }, [canObserve, observerMode]);

    const startDrag = (event: React.PointerEvent<HTMLButtonElement>, segment: TimelineSegment, field: 'duration' | 'holdTime') => {
        if (!event.isPrimary) return;
        event.preventDefault();
        event.stopPropagation();
        stopDraggingRef.current?.();
        const initialX = event.clientX;
        const initialValue = field === 'duration' ? segment.duration : segment.holdTime;
        const maxValue = field === 'duration' ? 10 : 60;
        const update = (pointerEvent: PointerEvent) => {
            if (!pointerEvent.isPrimary) return;
            const rounded = Math.round(clamp(initialValue + (pointerEvent.clientX - initialX) / pixelsPerSecond, 0, maxValue) * 100) / 100;
            if (field === 'duration') window.viewer?.updatePoiDuration?.(segment.poi.id, rounded);
            else window.viewer?.updatePoiHoldTime?.(segment.poi.id, rounded);
        };
        const stop = () => {
            document.removeEventListener('pointermove', update);
            document.removeEventListener('pointerup', stop);
            document.removeEventListener('pointercancel', stop);
            stopDraggingRef.current = null;
        };
        stopDraggingRef.current = stop;
        document.addEventListener('pointermove', update);
        document.addEventListener('pointerup', stop);
        document.addEventListener('pointercancel', stop);
    };

    // Same interaction as the tile-debug timeline: the whole track captures the pointer,
    // while the colored time label is the visible playhead handle.
    const scrubFromEvent = (event: React.PointerEvent<HTMLDivElement>) => {
        if (!event.isPrimary || duration <= 0) return;
        const track = event.currentTarget;
        const rect = track.getBoundingClientRect();
        const time = clamp((event.clientX - rect.left + track.scrollLeft - TRACK_PADDING) / pixelsPerSecond, 0, duration);
        setPlaybackTime(time);
        onSeek(time);
    };
    const startScrubbing = (event: React.PointerEvent<HTMLDivElement>) => {
        if (!event.isPrimary || (event.target as Element).closest('button')) return;
        scrubbingRef.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        scrubFromEvent(event);
    };
    const continueScrubbing = (event: React.PointerEvent<HTMLDivElement>) => {
        if (scrubbingRef.current) scrubFromEvent(event);
    };
    const stopScrubbing = (event: React.PointerEvent<HTMLDivElement>) => {
        if (!scrubbingRef.current) return;
        scrubbingRef.current = false;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
    };

    const unitOptions: Array<{ value: TimelineUnit; label: string }> = [
        { value: 'timecode', label: t('Timecode', lang) },
        { value: 'frames', label: t('Frames', lang) }
    ];
    const fpsOptions = Array.from(new Set<number>([...TIMELINE_FPS_OPTIONS, fps])).sort((a, b) => a - b);
    const tickStep = pixelsPerSecond >= 150 ? 0.5 : pixelsPerSecond >= 70 ? 1 : pixelsPerSecond >= 40 ? 2 : 5;
    const tickValues = Array.from({ length: Math.floor(duration / tickStep) + 1 }, (_, index) => index * tickStep);
    const changeZoom = (direction: -1 | 1) => {
        const next = stepTimelineZoom(zoom, direction);
        if (next === zoom) return;
        const track = trackRef.current;
        const centerTime = track ?
            clamp((track.scrollLeft + track.clientWidth / 2 - TRACK_PADDING) / pixelsPerSecond, 0, duration) : 0;
        setZoom(next);
        requestAnimationFrame(() => {
            if (!track) return;
            track.scrollLeft = TRACK_PADDING + centerTime * PIXELS_PER_SECOND * next - track.clientWidth / 2;
        });
    };

    return <div id='poi-timeline-panel' aria-label={t('POI timeline', lang)}>
        <div className='poi-timeline-toolbar'>
            <div className='poi-timeline-name'>{t('POI timeline', lang)}</div>
            <div className='poi-timeline-transport'>
                <button type='button' onClick={onPrevious} title={t('Previous POI', lang)} aria-label={t('Previous POI', lang)}><span className='material-symbols-outlined'>skip_previous</span></button>
                <button type='button' onClick={onTogglePlay} title={playing ? t('Pause', lang) : t('Play', lang)} aria-label={playing ? t('Pause', lang) : t('Play', lang)}><span className='material-symbols-outlined'>{playing ? 'pause' : 'play_arrow'}</span></button>
                <button type='button' onClick={onStop} title={t('Stop', lang)} aria-label={t('Stop', lang)}><span className='material-symbols-outlined'>stop</span></button>
                <button type='button' onClick={onNext} title={t('Next POI', lang)} aria-label={t('Next POI', lang)}><span className='material-symbols-outlined'>skip_next</span></button>
                <button
                    type='button'
                    className={observerMode ? 'active' : ''}
                    title={t('Observe camera externally', lang)}
                    aria-label={t('Observe camera externally', lang)}
                    aria-pressed={observerMode}
                    disabled={!canObserve}
                    onClick={() => {
                        const next = !observerMode;
                        window.viewer?.setPoiObserverMode?.(next);
                        setObserverMode(next);
                    }}
                ><span className='material-symbols-outlined'>view_in_ar</span></button>
            </div>
            <div className='poi-timeline-settings'>
                <div className='poi-timeline-zoom' aria-label={t('Zoom', lang)}>
                    <button type='button' disabled={zoom <= 1} title={`${t('Zoom', lang)} −`} aria-label={`${t('Zoom', lang)} −`} onClick={() => changeZoom(-1)}><span className='timeline-zoom-svg zoom-out-icon' aria-hidden='true' /></button>
                    <span>{Math.round(zoom * 100)}%</span>
                    <button type='button' disabled={zoom >= 4} title={`${t('Zoom', lang)} +`} aria-label={`${t('Zoom', lang)} +`} onClick={() => changeZoom(1)}><span className='timeline-zoom-svg zoom-in-icon' aria-hidden='true' /></button>
                </div>
                <label><span>{t('Time unit', lang)}</span><select id='poi-timeline-unit' value={unit} aria-label={t('Time unit', lang)} onChange={event => setUnit(event.target.value as TimelineUnit)}>{unitOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                <label><span>FPS</span><select id='poi-timeline-fps' value={fps} aria-label='FPS' onChange={event => setProperty('poi.timeline.fps', normalizeTimelineFps(event.target.value))}>{fpsOptions.map(value => <option key={value} value={value}>{value} FPS</option>)}</select></label>
            </div>
        </div>
        <div ref={trackRef} className='poi-timeline-track' onPointerDown={startScrubbing} onPointerMove={continueScrubbing} onPointerUp={stopScrubbing} onPointerCancel={stopScrubbing}>
            <div className='poi-timeline-content' style={{ width: `${contentWidth}px` }}>
                <div className='poi-timeline-axis' aria-hidden='true'>{tickValues.map(value => <div className='poi-timeline-axis-tick' key={value} style={{ left: `${TRACK_PADDING + value * pixelsPerSecond}px` }}><span>{formatTimelineSeconds(value, unit, fps)}</span></div>)}</div>
                {segments.map((segment) => {
                    const color = safeColor(segment.poi.color);
                    const label = String(segment.poi.title ?? `POI ${segment.poi.number}`);
                    const left = TRACK_PADDING + segment.start * pixelsPerSecond;
                    const arrival = TRACK_PADDING + segment.arrival * pixelsPerSecond;
                    const end = TRACK_PADDING + segment.end * pixelsPerSecond;
                    return <React.Fragment key={segment.poi.id}>
                        <div className='poi-timeline-transition' data-poi-id={segment.poi.id} style={{ left: `${left}px`, width: `${segment.duration * pixelsPerSecond}px`, borderColor: color, color }} title={`${label} · ${t('Camera transition', lang)} · ${formatTimelineSeconds(segment.duration, unit, fps)}`} />
                        <div className='poi-timeline-hold' data-poi-id={segment.poi.id} style={{ left: `${arrival}px`, width: `${segment.holdTime * pixelsPerSecond}px`, backgroundColor: mixWithWhite(color, 0.18), borderColor: mixWithWhite(color, 0.48) }} title={`${label} · ${t('Hold', lang)} · ${formatTimelineSeconds(segment.holdTime, unit, fps)}`} />
                        <button type='button' className={`poi-timeline-marker${activeId === segment.poi.id ? ' active' : ''}`} data-poi-id={segment.poi.id} style={{ left: `${left}px`, backgroundColor: color, color: contrastColor(color) }} title={`${label} · ${formatTimelineSeconds(segment.start, unit, fps)}`} aria-label={`${label} · ${formatTimelineSeconds(segment.start, unit, fps)}`} onClick={() => window.viewer?.focusPoi?.(segment.poi.id)}>{segment.poi.number}</button>
                        <button type='button' className='poi-timeline-handle poi-timeline-transition-handle' data-poi-id={segment.poi.id} data-field='duration' style={{ left: `${arrival}px`, color }} title={t('Drag to change camera transition duration', lang)} onPointerDown={event => startDrag(event, segment, 'duration')} />
                        <button type='button' className='poi-timeline-handle poi-timeline-hold-handle' data-poi-id={segment.poi.id} data-field='holdTime' style={{ left: `${end}px`, color }} title={t('Drag to change hold duration', lang)} onPointerDown={event => startDrag(event, segment, 'holdTime')} />
                    </React.Fragment>;
                })}
                {segments.length > 0 && <div className='poi-timeline-cursor' style={{ left: `${TRACK_PADDING + playbackTime * pixelsPerSecond}px` }}>{formatTimelineSeconds(playbackTime, unit, fps)}</div>}
                {segments.length === 0 && <div className='poi-timeline-empty'>{t('Add a POI to build the timeline', lang)}</div>}
            </div>
        </div>
    </div>;
};

export default PoiTimeline;
