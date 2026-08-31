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
 * Ось логарифмическая, и это важно. Уровни детализации идут вдвое: при каждом уточнении
 * ошибка примерно делится пополам. На линейной оси соседние уровни у камеры разносило по
 * цвету сильно, а вдали не разносило вовсе — всё выше двукратного превышения слипалось в
 * один красный. В октавах шаг между соседними уровнями одинаков по всей сцене, и «вдвое
 * грубее» отходит от белого ровно настолько же, насколько «вдвое детальнее».
 *
 * Радужную шкалу (jet) намеренно не берём: её переходы к голубому и жёлтому глаз читает как
 * границу там, где в данных ничего не происходит, а в длинном зелёном участке настоящие
 * перепады теряются.
 */

/** Сколько октав отклонения укладывается в половину шкалы: от вчетверо детальнее до вчетверо грубее. */
const RESOLUTION_LOG_RANGE = 2;

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
    // Ноль и не-числа означают «ошибки нет» — это предел детальности, дальний край шкалы.
    const octaves = ratio > 0 && Number.isFinite(ratio) ?
        Math.log2(ratio) / RESOLUTION_LOG_RANGE : -1;
    const t = Math.max(-1, Math.min(1, octaves));
    return t <= 0 ? mix(ON_TARGET, FINE, -t) : mix(ON_TARGET, COARSE, t);
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

export { RESOLUTION_LOG_RANGE, resolutionColorRgb, resolutionColorAbgr, resolutionColorCss };
