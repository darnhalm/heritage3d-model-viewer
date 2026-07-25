import { ObserverData } from './types';

/** Strip LUT to fields safe for JSON (no binary); GPU texture is never persisted. */
export function sanitizePosteffectsForStorage(pe: ObserverData['posteffects'] | undefined) {
    if (!pe) return undefined;
    const { lut, ...rest } = pe;
    return {
        ...rest,
        lut: lut
            ? {
                enabled: lut.enabled,
                intensity: lut.intensity,
                fileName: lut.fileName ?? null
            }
            : undefined
    };
}
