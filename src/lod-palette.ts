/**
 * Единая палитра LOD для отладки. Одними и теми же цветами красятся сплаты, границы
 * spatial-узлов и блоки полигонального тайлсета — поэтому легенда в HUD одна на все режимы.
 *
 * Порядок повторяет палитру движка (`_lodColorsRaw` в `gsplat-world.js`): раскраску самих
 * сплатов делает PlayCanvas по флагу `scene.gsplat.colorizeLod`, и поменять её из приложения
 * нельзя — значит, подстраиваться должны остальные режимы, а не наоборот.
 */
const LOD_PALETTE: Array<[number, number, number]> = [
    [1, 0, 0], // 0 — красный
    [0, 1, 0], // 1 — зелёный
    [0, 0, 1], // 2 — синий
    [1, 1, 0], // 3 — жёлтый
    [1, 0, 1], // 4 — пурпурный
    [0, 1, 1], // 5 — голубой
    [1, 0.5, 0], // 6 — оранжевый
    [0.5, 0, 1] // 7 — фиолетовый
];

/** Сколько различимых цветов в палитре; дальше нумерация уровней идёт по кругу. */
const LOD_PALETTE_SIZE = LOD_PALETTE.length;

/**
 * Цвет уровня в палитре.
 *
 * @param lod - Номер уровня детализации; отрицательные значения приводятся к нулю.
 * @returns Компоненты RGB в диапазоне 0..1.
 */
const lodColorRgb = (lod: number): [number, number, number] => {
    const index = Math.max(0, Math.floor(lod)) % LOD_PALETTE_SIZE;
    return LOD_PALETTE[index];
};

/**
 * Цвет уровня для `DebugLines` / `DebugSolid`.
 *
 * @param lod - Номер уровня детализации.
 * @param alpha - Альфа 0..1; у DebugSolid задаёт интенсивность заливки.
 * @returns Упакованный цвет 0xAABBGGRR (порядок байт little-endian RGBA).
 */
const lodColorAbgr = (lod: number, alpha = 1): number => {
    const [r, g, b] = lodColorRgb(lod);
    const byte = (value: number) => Math.max(0, Math.min(255, Math.round(value * 255)));
    return (((byte(alpha) << 24) | (byte(b) << 16) | (byte(g) << 8) | byte(r)) >>> 0);
};

/**
 * Цвет уровня для DOM-легенды.
 *
 * @param lod - Номер уровня детализации.
 * @returns Цвет в формате `#rrggbb`.
 */
const lodColorCss = (lod: number): string => {
    const [r, g, b] = lodColorRgb(lod);
    const hex = (value: number) => Math.max(0, Math.min(255, Math.round(value * 255))).toString(16).padStart(2, '0');
    return `#${hex(r)}${hex(g)}${hex(b)}`;
};

export { LOD_PALETTE_SIZE, lodColorRgb, lodColorAbgr, lodColorCss };
