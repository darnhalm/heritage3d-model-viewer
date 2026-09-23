/**
 * Разбор таблицы `.cube` (Adobe/IRIDAS) и раскладка её в текстуру для шейдера вывода.
 *
 * Проявочные таблицы приходят в этом формате, а не горизонтальной полосой PNG: восемь бит на
 * канал не унесут ни широкий диапазон на входе, ни точность в тенях, ради которой таблицу и
 * берут. Поэтому здесь читается текст с числами с плавающей точкой, а на GPU уходит RGBA16F.
 *
 * Сам формат описывает только размер сетки и границы входной области (`DOMAIN_MIN`/`DOMAIN_MAX`).
 * Ни кодирования входа (линейное оно или логарифмическое), ни пространства выхода в файле нет —
 * это задаётся снаружи, вызывающей стороной. Угадывать по имени файла было бы враньём: одна и
 * та же сетка 33×33×33 может ждать и линейный вход, и ACEScct.
 */

/** Наибольшая сторона сетки. 65 — обычный размер проявочных таблиц, меньшие берутся как есть. */
const MAX_EDGE = 65;

/** Наименьшая осмысленная сторона: на двух узлах таблица вырождается в линейную интерполяцию. */
const MIN_EDGE = 2;

type CubeLut = {
    /** `TITLE` из файла; пустая строка, если его не было. */
    title: string;
    /** Сторона сетки. */
    size: number;
    /** Нижняя граница входной области, по каналам. */
    domainMin: [number, number, number];
    /** Верхняя граница входной области, по каналам. Выше единицы — признак широкого входа. */
    domainMax: [number, number, number];
    /** `size³` троек RGB в порядке файла: красный меняется быстрее всех. */
    data: Float32Array;
};

/**
 * Прочитать три числа из строки заголовка.
 *
 * @param parts - Слова строки без ключевого слова.
 * @param key - Имя ключа, для сообщения об ошибке.
 * @returns Три конечных числа.
 */
const triple = (parts: string[], key: string): [number, number, number] => {
    if (parts.length !== 3) throw new Error(`${key} ожидает три числа, получено ${parts.length}`);
    const values = parts.map(Number);
    if (!values.every(Number.isFinite)) throw new Error(`${key} содержит нечисловое значение`);
    return values as [number, number, number];
};

/**
 * Разобрать текст `.cube`.
 *
 * Однонерные таблицы (`LUT_1D_SIZE`) отклоняются, а не читаются как трёхмерные: их роль в
 * проявке — подготовка входа перед сеткой, и обращаться с ними как с сеткой значило бы тихо
 * испортить цвет.
 *
 * @param text - Содержимое файла.
 * @returns Разобранная таблица.
 */
const parseCubeLut = (text: string): CubeLut => {
    let title = '';
    let size = 0;
    let domainMin: [number, number, number] = [0, 0, 0];
    let domainMax: [number, number, number] = [1, 1, 1];
    let data: Float32Array | null = null;
    let written = 0;

    for (const rawLine of text.split(/\r?\n/)) {
        // Комментарий отделяется решёткой в начале строки; внутри строки данных её не бывает.
        const line = rawLine.trim();
        if (line === '' || line.startsWith('#')) continue;

        const parts = line.split(/\s+/);
        const key = parts[0].toUpperCase();

        if (key === 'TITLE') {
            title = line.slice(line.indexOf('TITLE') + 5).trim().replace(/^"|"$/g, '');
            continue;
        }
        if (key === 'LUT_1D_SIZE') {
            throw new Error('Одномерная таблица (LUT_1D_SIZE) — это подготовка входа, а не сетка цвета');
        }
        if (key === 'LUT_3D_SIZE') {
            size = Number(parts[1]);
            if (!Number.isInteger(size) || size < MIN_EDGE || size > MAX_EDGE) {
                throw new Error(`LUT_3D_SIZE вне поддерживаемого диапазона ${MIN_EDGE}..${MAX_EDGE}: ${parts[1]}`);
            }
            data = new Float32Array(size * size * size * 3);
            continue;
        }
        if (key === 'DOMAIN_MIN') {
            domainMin = triple(parts.slice(1), 'DOMAIN_MIN');
            continue;
        }
        if (key === 'DOMAIN_MAX') {
            domainMax = triple(parts.slice(1), 'DOMAIN_MAX');
            continue;
        }

        // Всё остальное — строка данных. Она обязана идти после объявления размера: без него
        // неизвестно, сколько их ждать, и незаметно прочитался бы обрезанный файл.
        if (!data) throw new Error('Данные идут раньше LUT_3D_SIZE');
        const rgb = triple(parts, 'Строка данных');
        if (written + 3 > data.length) throw new Error('Строк данных больше, чем объявлено в LUT_3D_SIZE');
        data[written++] = rgb[0];
        data[written++] = rgb[1];
        data[written++] = rgb[2];
    }

    if (!data) throw new Error('В файле нет LUT_3D_SIZE');
    if (written !== data.length) {
        throw new Error(`Строк данных ${written / 3}, а по LUT_3D_SIZE нужно ${data.length / 3}`);
    }
    for (let i = 0; i < 3; i++) {
        if (!(domainMax[i] > domainMin[i])) {
            throw new Error('DOMAIN_MAX должен быть больше DOMAIN_MIN по каждому каналу');
        }
    }

    return { title, size, domainMin, domainMax, data };
};

/**
 * Разложить сетку в горизонтальную полосу, которую читает шейдер вывода.
 *
 * Полоса `size²` на `size`: синий выбирает срез (блок шириной `size` по горизонтали), красный
 * задаёт положение внутри среза, зелёный — строку. Такую же раскладку читает и прежняя
 * восьмибитная таблица, поэтому выборка в шейдере остаётся одна на оба случая.
 *
 * В файле порядок другой — красный меняется быстрее всех, — отсюда перестановка.
 *
 * @param lut - Разобранная таблица.
 * @returns Пиксели RGBA в порядке строк полосы, по четыре значения на тексель.
 */
const cubeLutToStrip = (lut: CubeLut): Float32Array => {
    const n = lut.size;
    const strip = new Float32Array(n * n * n * 4);
    for (let b = 0; b < n; b++) {
        for (let g = 0; g < n; g++) {
            for (let r = 0; r < n; r++) {
                const source = (r + g * n + b * n * n) * 3;
                // Тексель полосы: x = b * n + r, y = g, ширина строки — n².
                const target = (g * n * n + b * n + r) * 4;
                strip[target] = lut.data[source];
                strip[target + 1] = lut.data[source + 1];
                strip[target + 2] = lut.data[source + 2];
                strip[target + 3] = 1;
            }
        }
    }
    return strip;
};

/**
 * Перевести значения в половинные слова float16 — в таком виде их ждёт `PIXELFORMAT_RGBA16F`.
 *
 * Шестнадцати бит здесь хватает с запасом: широкий диапазон живёт на входе таблицы и разбирается
 * кодированием, а в самих узлах лежат либо экранные значения 0..1, либо линейные того же порядка.
 *
 * @param values - Исходные значения.
 * @returns Те же значения половинной точности.
 */
const floatsToHalf = (values: Float32Array): Uint16Array => {
    const out = new Uint16Array(values.length);
    const single = new Float32Array(1);
    const bits = new Uint32Array(single.buffer);
    for (let i = 0; i < values.length; i++) {
        single[0] = values[i];
        const word = bits[0];
        const sign = (word >>> 16) & 0x8000;
        const mantissa = word & 0x7fffff;
        let exponent = (word >>> 23) & 0xff;
        if (exponent === 0xff) {
            // Бесконечность и NaN переносим как есть: молча подменять их нулём — значит скрыть
            // испорченный файл до того, как он себя проявит.
            out[i] = sign | 0x7c00 | (mantissa ? 0x200 : 0);
            continue;
        }
        exponent = exponent - 127 + 15;
        if (exponent >= 0x1f) {
            out[i] = sign | 0x7c00;
        } else if (exponent <= 0) {
            // Денормализованные: меньше -10 уже не представимо ничем, кроме нуля.
            out[i] = exponent < -10 ? sign : sign + (((mantissa | 0x800000) >>> (1 - exponent)) + 0x1000 >>> 13);
        } else {
            // Сложение, а не побитовое ИЛИ: округление мантиссы вверх должно переносить
            // единицу в порядок, иначе на границе получится значение вдвое меньше нужного.
            out[i] = (sign | (exponent << 10)) + (mantissa + 0x1000 >>> 13);
        }
    }
    return out;
};

export { parseCubeLut, cubeLutToStrip, floatsToHalf, MAX_EDGE as CUBE_LUT_MAX_EDGE, type CubeLut };
