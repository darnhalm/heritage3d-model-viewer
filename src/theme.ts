type ThemeRgb = { r: number; g: number; b: number };

const DEFAULT_THEME_COLOR: ThemeRgb = { r: 200 / 255, g: 200 / 255, b: 200 / 255 };

const normalizeChannel = (value: unknown, fallback: number) => {
    const channel = Number(value);
    return Number.isFinite(channel) ? Math.max(0, Math.min(1, channel)) : fallback;
};

const normalizeThemeColor = (value: unknown): ThemeRgb => {
    const color = value && typeof value === 'object' ? value as Partial<ThemeRgb> : {};
    return {
        r: normalizeChannel(color.r, DEFAULT_THEME_COLOR.r),
        g: normalizeChannel(color.g, DEFAULT_THEME_COLOR.g),
        b: normalizeChannel(color.b, DEFAULT_THEME_COLOR.b)
    };
};

const toByte = (value: number) => Math.round(value * 255);

const applyThemeColor = (value: unknown) => {
    if (typeof document === 'undefined') return;
    const color = normalizeThemeColor(value);
    const brighten = (channel: number) => channel + (1 - channel) * 0.32;
    const primary = [toByte(color.r), toByte(color.g), toByte(color.b)];
    const bright = [toByte(brighten(color.r)), toByte(brighten(color.g)), toByte(brighten(color.b))];
    const style = document.documentElement.style;
    style.setProperty('--theme-primary', `rgb(${primary.join(' ')})`);
    style.setProperty('--theme-primary-rgb', primary.join(', '));
    style.setProperty('--theme-bright', `rgb(${bright.join(' ')})`);
    style.setProperty('--theme-bright-rgb', bright.join(', '));
};

export { DEFAULT_THEME_COLOR, applyThemeColor, normalizeThemeColor };
export type { ThemeRgb };
