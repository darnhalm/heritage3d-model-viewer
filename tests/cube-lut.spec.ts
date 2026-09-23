import { expect, test } from '@playwright/test';

import { cubeLutToStrip, floatsToHalf, parseCubeLut } from '../src/hdr/cube-lut';

/**
 * Собрать текст `.cube` из готовых троек.
 *
 * @param size - Сторона сетки.
 * @param rows - Тройки в порядке файла: красный меняется быстрее всех.
 * @param header - Дополнительные строки заголовка.
 * @returns Содержимое файла.
 */
const cube = (size: number, rows: number[][], header: string[] = []) => [
    '# проверочная таблица',
    `LUT_3D_SIZE ${size}`,
    ...header,
    ...rows.map(row => row.join(' '))
].join('\n');

/** Тождественная сетка: значение узла равно его нормированным координатам. */
const identityRows = (n: number) => {
    const rows: number[][] = [];
    for (let b = 0; b < n; b++) {
        for (let g = 0; g < n; g++) {
            for (let r = 0; r < n; r++) rows.push([r / (n - 1), g / (n - 1), b / (n - 1)]);
        }
    }
    return rows;
};

test('читает размер, границы области и данные в порядке файла', () => {
    const text = cube(2, identityRows(2), ['TITLE "Проявка"', 'DOMAIN_MIN 0 0 0', 'DOMAIN_MAX 16 16 16']);
    const lut = parseCubeLut(text);
    expect(lut.title).toBe('Проявка');
    expect(lut.size).toBe(2);
    expect(lut.domainMax).toEqual([16, 16, 16]);
    expect(lut.data.length).toBe(2 * 2 * 2 * 3);
    // Второй узел файла — красный на максимуме, остальные в нуле: красный меняется первым.
    expect([...lut.data.slice(3, 6)]).toEqual([1, 0, 0]);
});

test('раскладка в полосу кладёт синий в срез, красный внутрь среза, зелёный в строку', () => {
    const n = 4;
    const lut = parseCubeLut(cube(n, identityRows(n)));
    const strip = cubeLutToStrip(lut);
    expect(strip.length).toBe(n * n * n * 4);

    // Шейдер выбирает тексель (x = b * n + r, y = g) из полосы шириной n².
    const texel = (r: number, g: number, b: number) => {
        const index = (g * n * n + b * n + r) * 4;
        return [strip[index], strip[index + 1], strip[index + 2]];
    };
    for (const [r, g, b] of [[0, 0, 0], [3, 0, 0], [0, 3, 0], [0, 0, 3], [1, 2, 3], [3, 3, 3]]) {
        // Сравнение с допуском: полоса хранится в Float32Array, и треть в неё не ложится точно.
        const expected = [r / (n - 1), g / (n - 1), b / (n - 1)];
        texel(r, g, b).forEach((value, channel) => expect(value).toBeCloseTo(expected[channel], 6));
    }
});

test('отклоняет обрезанный файл, лишние строки и одномерную таблицу', () => {
    const short = cube(2, identityRows(2).slice(0, 7));
    expect(() => parseCubeLut(short)).toThrow(/Строк данных 7/);

    const long = cube(2, [...identityRows(2), [0, 0, 0]]);
    expect(() => parseCubeLut(long)).toThrow(/больше, чем объявлено/);

    expect(() => parseCubeLut('LUT_1D_SIZE 16\n0 0 0')).toThrow(/Одномерная таблица/);
    expect(() => parseCubeLut('0.5 0.5 0.5')).toThrow(/раньше LUT_3D_SIZE/);
    expect(() => parseCubeLut('LUT_3D_SIZE 3\n')).toThrow(/Строк данных 0/);
});

test('отклоняет неверные границы области и размер вне диапазона', () => {
    expect(() => parseCubeLut(cube(2, identityRows(2), ['DOMAIN_MAX 0 1 1']))).toThrow(/DOMAIN_MAX/);
    expect(() => parseCubeLut('LUT_3D_SIZE 128')).toThrow(/вне поддерживаемого диапазона/);
    expect(() => parseCubeLut('LUT_3D_SIZE 1')).toThrow(/вне поддерживаемого диапазона/);
});

test('перевод во float16 сохраняет значения и переносит округление в порядок', () => {
    const half = (value: number) => floatsToHalf(Float32Array.from([value]))[0];
    // Точно представимые значения должны пройти без изменений.
    expect(half(0)).toBe(0x0000);
    expect(half(1)).toBe(0x3c00);
    expect(half(0.5)).toBe(0x3800);
    expect(half(2)).toBe(0x4000);
    expect(half(-1)).toBe(0xbc00);

    // Значение чуть ниже единицы округляется вверх: мантисса переполняется, и единица обязана
    // перенестись в порядок. Побитовое ИЛИ здесь дало бы 0x3800, то есть вдвое меньше.
    expect(half(1 - 1e-8)).toBe(0x3c00);

    // Выход за пределы float16 и нечисловые значения переносятся явно, а не гасятся в ноль.
    expect(half(1e30)).toBe(0x7c00);
    expect(half(-1e30)).toBe(0xfc00);
    expect(half(NaN) & 0x7c00).toBe(0x7c00);
    expect(half(NaN) & 0x03ff).not.toBe(0);

    // Слишком малое для денормализованных — ноль со знаком.
    expect(half(1e-12)).toBe(0x0000);

    // Обратный перевод через DataView должен вернуть исходное с точностью половинной.
    const view = new DataView(new ArrayBuffer(2));
    const back = (value: number) => { view.setUint16(0, half(value), true); return view.getFloat16?.(0, true); };
    if (view.getFloat16) expect(back(0.3333)).toBeCloseTo(0.3333, 3);
});
