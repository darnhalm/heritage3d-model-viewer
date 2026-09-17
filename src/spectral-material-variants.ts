type SpectralZone = 'xray' | 'uv' | 'visible' | 'infrared';

type SpectralDefinition = {
    code: string;
    aliases: string[];
    wavelengthNm: number;
    zone: SpectralZone;
    color: string;
};

export type SpectralMaterialVariant = {
    code: string;
    wavelengthNm: number;
    position: number;
    zone: SpectralZone;
    color: string;
};

export type PositionedSpectralVariant = {
    key: string;
    position: number;
};

export const ORIGINAL_VARIANT_COLOR_KEY = '__original__';

const DEFINITIONS: SpectralDefinition[] = [
    { code: 'VIS', aliases: ['VIS-R-VIS', 'RGB', 'VIS'], wavelengthNm: 550, zone: 'visible', color: '#9a9a9a' },
    { code: 'RAK', aliases: ['VISR-R-VIS', 'VISR', 'VIS-R', 'RAK'], wavelengthNm: 550, zone: 'visible', color: '#9a9a9a' },
    { code: 'VIST', aliases: ['VIST-R-VIS', 'VIS-T', 'VIST', 'TL', 'VT'], wavelengthNm: 550, zone: 'visible', color: '#9a9a9a' },
    { code: 'UVR', aliases: ['UV-R-UV', 'UVR', 'RUV'], wavelengthNm: 300, zone: 'uv', color: '#8176b6' },
    { code: 'UVL', aliases: ['VIS-L-UV', 'UV-VL', 'UVL', 'UVF', 'FUV'], wavelengthNm: 420, zone: 'visible', color: '#66a9b0' },
    { code: 'UVIL', aliases: ['IR-L-UV', 'UV-IL', 'UVIL'], wavelengthNm: 900, zone: 'infrared', color: '#66a9b0' },
    { code: 'IR', aliases: ['IR-R-IR', 'NIRR', 'NIR', 'RIR', 'IR'], wavelengthNm: 850, zone: 'infrared', color: '#d63636' },
    { code: 'IRR', aliases: ['IRR'], wavelengthNm: 1000, zone: 'infrared', color: '#d63636' },
    { code: 'SWIR', aliases: ['SWIRR', 'SWIR'], wavelengthNm: 2000, zone: 'infrared', color: '#d63636' },
    { code: 'IRT', aliases: ['IRT', 'TIR'], wavelengthNm: 900, zone: 'infrared', color: '#d63636' },
    { code: 'IRRT', aliases: ['IRRT'], wavelengthNm: 1500, zone: 'infrared', color: '#d63636' },
    { code: 'VIL', aliases: ['IR-L-VIS', 'V-IL', 'VIL'], wavelengthNm: 1000, zone: 'infrared', color: '#d63636' },
    { code: 'VIVL', aliases: ['VIS-VL', 'VIVL'], wavelengthNm: 600, zone: 'visible', color: '#9a9a9a' },
    { code: 'IRFC', aliases: ['IRRFC', 'IR-FC', 'IRFC', 'FCIR'], wavelengthNm: 1000, zone: 'infrared', color: '#d63636' },
    { code: 'UVFC', aliases: ['UVRFC', 'UV-FC', 'UVFC', 'FCUV'], wavelengthNm: 300, zone: 'uv', color: '#8176b6' },
    { code: 'XR', aliases: ['X-RAY', 'XRAY', 'XRR', 'XR'], wavelengthNm: 0.05, zone: 'xray', color: '#5a0099' }
];

const ZONES = [
    { nmStart: 0.001, nmEnd: 10, posStart: 0, posEnd: 0.22, log: true },
    { nmStart: 10, nmEnd: 380, posStart: 0.22, posEnd: 0.40, log: true },
    { nmStart: 380, nmEnd: 700, posStart: 0.40, posEnd: 0.67, log: false },
    { nmStart: 700, nmEnd: 3000, posStart: 0.67, posEnd: 1, log: true }
];

const aliasEntries = DEFINITIONS.flatMap(definition => definition.aliases.map(alias => ({ definition, alias })))
.sort((a, b) => b.alias.length - a.alias.length);

export const wavelengthToSpectrumPosition = (wavelengthNm: number): number => {
    const wavelength = Math.max(0.001, Math.min(3000, wavelengthNm));
    const zone = ZONES.find(candidate => wavelength >= candidate.nmStart && wavelength <= candidate.nmEnd) ?? ZONES[ZONES.length - 1];
    const amount = zone.log ?
        (Math.log10(wavelength) - Math.log10(zone.nmStart)) / (Math.log10(zone.nmEnd) - Math.log10(zone.nmStart)) :
        (wavelength - zone.nmStart) / (zone.nmEnd - zone.nmStart);
    return zone.posStart + Math.max(0, Math.min(1, amount)) * (zone.posEnd - zone.posStart);
};

/**
 * Read the first known, explicitly marked spectral code from a material variant name.
 * Codes are deliberately case-sensitive and require `@`, so ordinary names never become
 * scientific metadata by accident.
 *
 * @param name - Full material variant name stored in glTF.
 * @returns Recognized spectral display metadata, or null for an ordinary variant.
 */
export const classifySpectralMaterialVariant = (name: string): SpectralMaterialVariant | null => {
    let best: { definition: SpectralDefinition; alias: string; index: number } | null = null;
    aliasEntries.forEach(({ definition, alias }) => {
        let from = 0;
        const needle = `@${alias}`;
        while (from < name.length) {
            const index = name.indexOf(needle, from);
            if (index < 0) break;
            const next = name[index + needle.length];
            if ((!next || !/[A-Z0-9]/.test(next)) && (!best || index < best.index || (index === best.index && alias.length > best.alias.length))) {
                best = { definition, alias, index };
            }
            from = index + needle.length;
        }
    });
    if (!best) return null;
    const definition = best.definition;
    return {
        code: definition.code,
        wavelengthNm: definition.wavelengthNm,
        position: wavelengthToSpectrumPosition(definition.wavelengthNm),
        zone: definition.zone,
        color: definition.color
    };
};

/**
 * Choose the next material marker in a spectrum zone, matching the 2D viewer's
 * bracket navigation. Markers cycle from left to right; an empty zone selects
 * the marker nearest to the centre of that zone.
 *
 * @param variants - Material variants with their rendered scale positions.
 * @param selectedKey - Currently selected material variant.
 * @param start - Inclusive start of the clicked zone on the normalized scale.
 * @param end - Inclusive end of the clicked zone on the normalized scale.
 * @returns The next variant key, or null when the scale has no markers.
 */
export const nextSpectralVariantKey = (
    variants: PositionedSpectralVariant[],
    selectedKey: string,
    start: number,
    end: number
): string | null => {
    if (variants.length === 0) return null;
    const candidates = variants.filter(variant => variant.position >= start && variant.position <= end)
    .sort((a, b) => a.position - b.position || a.key.localeCompare(b.key));
    if (candidates.length === 0) {
        const centre = (start + end) / 2;
        return variants.reduce((nearest, candidate) => (
            Math.abs(candidate.position - centre) < Math.abs(nearest.position - centre) ? candidate : nearest
        )).key;
    }
    const selectedIndex = candidates.findIndex(variant => variant.key === selectedKey);
    return candidates[selectedIndex >= 0 ? (selectedIndex + 1) % candidates.length : 0].key;
};

export const parseVariantColorMap = (value: unknown): Record<string, string> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const result: Record<string, string> = {};
    Object.entries(value as Record<string, unknown>).forEach(([name, color]) => {
        if (typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color)) {
            const normalized = color.toLowerCase();
            if (normalized !== '#000000') result[name] = normalized;
        }
    });
    return result;
};

export const colorArrayToHex = (value: number[]): string => {
    const channel = (index: number) => Math.round(Math.max(0, Math.min(1, Number(value[index]) || 0)) * 255)
    .toString(16)
    .padStart(2, '0');
    return `#${channel(0)}${channel(1)}${channel(2)}`;
};

export const hexToColorArray = (hex?: string): number[] => {
    const match = /^#([0-9a-f]{6})$/i.exec(hex ?? '');
    if (!match) return [0, 0, 0, 1];
    const value = Number.parseInt(match[1], 16);
    return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255, 1];
};
