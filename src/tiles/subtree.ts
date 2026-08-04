/**
 * Разбор файлов `.subtree` — бинарной части implicit tiling в 3D Tiles 1.1.
 *
 * Неявное дерево не перечисляет тайлы в JSON: вместо этого тайлсет задаёт схему деления
 * (квадро- или октодерево), шаблоны URI и глубину, а какие узлы существуют на самом деле —
 * лежит в битовых масках `.subtree`. Один файл описывает `subtreeLevels` уровней; глубже
 * идут вложенные файлы, на которые ссылается маска `childSubtreeAvailability`.
 *
 * Формат: заголовок (`subt`, версия, длины чанков), JSON-чанк, бинарный чанк.
 */

/** Маска доступности: либо константа на всё поддерево, либо битовый поток. */
export type AvailabilityJson = {
    constant?: 0 | 1;
    bitstream?: number;
    availableCount?: number;
};

export type SubtreeJson = {
    buffers?: { uri?: string; byteLength: number }[];
    bufferViews?: { buffer: number; byteOffset?: number; byteLength: number }[];
    tileAvailability: AvailabilityJson;
    /** В 1.1 контентов у тайла может быть несколько, поэтому это массив. */
    contentAvailability?: AvailabilityJson[] | AvailabilityJson;
    childSubtreeAvailability?: AvailabilityJson;
};

/** Готовая к опросу маска доступности. */
export class Availability {
    /**
     * @param constantValue - Значение для всего поддерева или `null`, если задан поток.
     * @param bits - Битовый поток (младший бит первого байта — элемент с индексом 0).
     */
    constructor(private constantValue: 0 | 1 | null, private bits: Uint8Array | null) {}

    /**
     * Доступен ли элемент с указанным индексом.
     *
     * @param index - Индекс элемента.
     * @returns true, если бит выставлен.
     */
    get(index: number): boolean {
        if (this.constantValue !== null) {
            return this.constantValue === 1;
        }
        if (!this.bits || index < 0) {
            return false;
        }
        const byte = index >> 3;
        return byte < this.bits.length && ((this.bits[byte] >> (index & 7)) & 1) === 1;
    }
}

export type Subtree = {
    /** Существует ли узел дерева. */
    tile: Availability;
    /** Есть ли у узла контент (объединение по всем контентам тайла). */
    content: Availability;
    /** Есть ли за узлом вложенное поддерево. */
    childSubtree: Availability;
};

export type SubdivisionScheme = 'OCTREE' | 'QUADTREE';

/**
 * Сколько потомков у узла: 8 у октодерева, 4 у квадродерева.
 *
 * @param scheme - Схема деления.
 * @returns Число потомков.
 */
export function branchingFactor(scheme: SubdivisionScheme): number {
    return scheme === 'OCTREE' ? 8 : 4;
}

/**
 * Индекс Мортона (Z-order) координат внутри уровня.
 *
 * Биты координат перемежаются, начиная с `x` в младшем разряде — так их укладывает
 * спецификация, и от этого зависит соответствие бита в маске конкретному тайлу.
 *
 * @param scheme - Схема деления.
 * @param x - Координата X внутри уровня.
 * @param y - Координата Y внутри уровня.
 * @param z - Координата Z (у квадродерева игнорируется).
 * @param level - Номер уровня (сколько бит участвует).
 * @returns Индекс Мортона.
 */
export function mortonIndex(scheme: SubdivisionScheme, x: number, y: number, z: number, level: number): number {
    const octree = scheme === 'OCTREE';
    const stride = octree ? 3 : 2;
    let index = 0;
    for (let i = 0; i < level; ++i) {
        index |= ((x >> i) & 1) << (stride * i);
        index |= ((y >> i) & 1) << (stride * i + 1);
        if (octree) {
            index |= ((z >> i) & 1) << (stride * i + 2);
        }
    }
    return index;
}

/**
 * Смещение начала уровня в маске доступности тайлов.
 *
 * Маска — это все узлы поддерева подряд, уровень за уровнем, поэтому индекс тайла равен
 * «сколько узлов было на предыдущих уровнях» плюс индекс Мортона.
 *
 * @param scheme - Схема деления.
 * @param level - Локальный уровень внутри поддерева.
 * @returns Индекс первого узла уровня.
 */
export function levelOffset(scheme: SubdivisionScheme, level: number): number {
    const b = branchingFactor(scheme);
    return (b ** level - 1) / (b - 1);
}

/**
 * Собрать маску по её описанию из JSON.
 *
 * @param json - Описание маски.
 * @param views - Готовые данные bufferView'ов.
 * @returns Маска доступности.
 */
function makeAvailability(json: AvailabilityJson | undefined, views: (Uint8Array | null)[]): Availability {
    if (!json) {
        return new Availability(0, null);
    }
    if (json.constant !== undefined) {
        return new Availability(json.constant, null);
    }
    if (json.bitstream !== undefined) {
        return new Availability(null, views[json.bitstream] ?? null);
    }
    return new Availability(0, null);
}

/**
 * Скачать и разобрать `.subtree`.
 *
 * Внешние буферы (`buffers[].uri`) поддержаны: крупные тайлсеты выносят маски в отдельные
 * файлы рядом с поддеревом.
 *
 * @param url - Адрес файла.
 * @param signal - Сигнал отмены.
 * @returns Разобранные маски доступности.
 */
export async function fetchSubtree(url: string, signal?: AbortSignal): Promise<Subtree> {
    const response = await fetch(url, { signal });
    if (!response.ok) {
        throw new Error(`Не удалось загрузить поддерево (HTTP ${response.status}): ${url}`);
    }
    const buffer = await response.arrayBuffer();
    const view = new DataView(buffer);

    const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
    if (magic !== 'subt') {
        throw new Error(`Ожидался subtree, в файле magic "${magic}": ${url}`);
    }

    // Длины чанков в формате 64-битные, но читаются как пара 32-битных: старшее слово у
    // любого мыслимого файла нулевое, а `getBigUint64` требует поднимать `lib` проекта до
    // es2020 ради двух чисел.
    const readUint64 = (offset: number) => {
        const low = view.getUint32(offset, true);
        const high = view.getUint32(offset + 4, true);
        if (high !== 0) {
            throw new Error(`Слишком большой чанк в поддереве: ${url}`);
        }
        return low;
    };
    const jsonLength = readUint64(8);
    const binaryLength = readUint64(16);
    const jsonStart = 24;
    const binaryStart = jsonStart + jsonLength;

    const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, jsonStart, jsonLength))) as SubtreeJson;

    // Буфер без `uri` — это встроенный бинарный чанк.
    const buffers = await Promise.all((json.buffers ?? []).map(async (b) => {
        if (!b.uri) {
            return new Uint8Array(buffer, binaryStart, binaryLength);
        }
        const external = await fetch(new URL(b.uri, url).href, { signal });
        if (!external.ok) {
            throw new Error(`Не загрузился внешний буфер поддерева (HTTP ${external.status}): ${b.uri}`);
        }
        return new Uint8Array(await external.arrayBuffer());
    }));

    const views = (json.bufferViews ?? []).map((v) => {
        const source = buffers[v.buffer];
        if (!source) {
            return null;
        }
        const offset = v.byteOffset ?? 0;
        return source.subarray(offset, offset + v.byteLength);
    });

    const contentJson = Array.isArray(json.contentAvailability) ?
        json.contentAvailability[0] :
        json.contentAvailability;

    return {
        tile: makeAvailability(json.tileAvailability, views),
        content: makeAvailability(contentJson, views),
        childSubtree: makeAvailability(json.childSubtreeAvailability, views)
    };
}

/**
 * Подставить координаты тайла в шаблон URI (`{level}`, `{x}`, `{y}`, `{z}`).
 *
 * @param template - Шаблон из tileset.json.
 * @param level - Уровень.
 * @param x - Координата X.
 * @param y - Координата Y.
 * @param z - Координата Z.
 * @returns Готовый URI.
 */
export function fillUriTemplate(template: string, level: number, x: number, y: number, z: number): string {
    return template
    .replace(/\{level\}/g, String(level))
    .replace(/\{x\}/g, String(x))
    .replace(/\{y\}/g, String(y))
    .replace(/\{z\}/g, String(z));
}
