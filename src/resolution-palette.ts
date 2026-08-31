/**
 * Расходящаяся палитра для раскраски тайлов по разрешению.
 *
 * Величина здесь непрерывная — отношение экранной ошибки тайла к целевой, — и у неё есть
 * естественная середина: единица означает «ровно то разрешение, которое заказано». Поэтому
 * шкала расходится в обе стороны от белого, а не идёт от холодного к горячему:
 *
 * - краснее — ошибка больше целевой, тайл выглядит грубее, чем нужно;
 * - белое — попадание в цель;
 * - синее — ошибка меньше целевой, разрешение выше необходимого.
 *
 * Радужную шкалу (jet) намеренно не берём: её переходы к голубому и жёлтому глаз читает как
 * границу там, где в данных ничего не происходит, а в длинном зелёном участке настоящие
 * перепады теряются.
 */

/** Во сколько раз ошибка должна превысить целевую, чтобы цвет дошёл до чистого красного. */
const RESOLUTION_RED_AT = 2;

const COARSE: [number, number, number] = [1, 0.24, 0.16];
const ON_TARGET: [number, number, number] = [0.93, 0.93, 0.93];
const FINE: [number, number, number] = [0.2, 0.45, 1];

const mix = (
    a: [number, number, number],
    b: [number, number, number],
    t: number
): [number, number, number] => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t
];

/**
 * Цвет по отношению экранной ошибки к целевой.
 *
 * @param ratio - Отношение ошибки к цели; единица означает попадание.
 * @returns Компоненты RGB в диапазоне 0..1.
 */
const resolutionColorRgb = (ratio: number): [number, number, number] => {
    const value = Number.isFinite(ratio) ? Math.max(0, ratio) : RESOLUTION_RED_AT;
    if (value <= 1) {
        return mix(FINE, ON_TARGET, value);
    }
    return mix(ON_TARGET, COARSE, Math.min(1, (value - 1) / (RESOLUTION_RED_AT - 1)));
};

/**
 * Цвет по отношению ошибки к целевой для `DebugLines` / `DebugSolid`.
 *
 * @param ratio - Отношение ошибки к цели.
 * @param alpha - Альфа 0..1.
 * @returns Упакованный цвет 0xAABBGGRR (порядок байт little-endian RGBA).
 */
const resolutionColorAbgr = (ratio: number, alpha = 1): number => {
    const [r, g, b] = resolutionColorRgb(ratio);
    const byte = (value: number) => Math.max(0, Math.min(255, Math.round(value * 255)));
    return (((byte(alpha) << 24) | (byte(b) << 16) | (byte(g) << 8) | byte(r)) >>> 0);
};

/**
 * Цвет по отношению ошибки к целевой для DOM-легенды.
 *
 * @param ratio - Отношение ошибки к цели.
 * @returns Цвет в формате `#rrggbb`.
 */
const resolutionColorCss = (ratio: number): string => {
    const [r, g, b] = resolutionColorRgb(ratio);
    const hex = (value: number) => Math.max(0, Math.min(255, Math.round(value * 255))).toString(16).padStart(2, '0');
    return `#${hex(r)}${hex(g)}${hex(b)}`;
};

export { RESOLUTION_RED_AT, resolutionColorRgb, resolutionColorAbgr, resolutionColorCss };
