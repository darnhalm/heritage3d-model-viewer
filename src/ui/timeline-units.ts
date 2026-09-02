type TimelineUnit = 'timecode' | 'frames';

const TIMELINE_FPS_OPTIONS = [24, 25, 30, 50, 60] as const;
const TIMELINE_ZOOM_STEPS = [1, 1.5, 2, 3, 4] as const;

const stepTimelineZoom = (current: number, direction: -1 | 1) => {
    const safe = Number.isFinite(current) ? current : 1;
    if (direction > 0) return TIMELINE_ZOOM_STEPS.find(value => value > safe + 1e-6) ?? TIMELINE_ZOOM_STEPS[TIMELINE_ZOOM_STEPS.length - 1];
    return [...TIMELINE_ZOOM_STEPS].reverse().find(value => value < safe - 1e-6) ?? TIMELINE_ZOOM_STEPS[0];
};

const normalizeTimelineFps = (value: unknown, fallback = 30) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.max(1, Math.min(240, Math.round(numeric))) : fallback;
};

/**
 * Format canonical seconds either as project frames or HH:MM:SS.mmm timecode.
 *
 * @param seconds - Canonical real time in seconds.
 * @param unit - Selected display mode.
 * @param fps - Project frame rate used for frame conversion.
 * @returns Frames or timecode without changing canonical data.
 */
const formatTimelineSeconds = (seconds: number, unit: TimelineUnit, fps: number) => {
    const safeSeconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
    if (unit === 'frames') return String(Math.round(safeSeconds * normalizeTimelineFps(fps)));

    const totalMilliseconds = Math.round(safeSeconds * 1000);
    const hours = Math.floor(totalMilliseconds / 3_600_000);
    const minutes = Math.floor(totalMilliseconds / 60_000) % 60;
    const wholeSeconds = Math.floor(totalMilliseconds / 1000) % 60;
    const milliseconds = totalMilliseconds % 1000;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:` +
        `${String(wholeSeconds).padStart(2, '0')}.${String(milliseconds).padStart(3, '0')}`;
};

export {
    TIMELINE_FPS_OPTIONS,
    TIMELINE_ZOOM_STEPS,
    formatTimelineSeconds,
    normalizeTimelineFps,
    stepTimelineZoom,
    type TimelineUnit
};
