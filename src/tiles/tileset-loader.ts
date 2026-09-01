/**
 * Загрузка `tileset.json` и разворачивание его в дерево тайлов рантайма.
 *
 * Здесь же решаются два вопроса, которые потом больше нигде не всплывают: как складываются
 * трансформации по цепочке родителей и относительно чего разрешаются относительные URI
 * контента (относительно того tileset.json, в котором они написаны, — у внешних тайлсетов
 * своя база).
 */

import { Mat4 } from 'playcanvas';

import { makeWorldObb, maxScaleOfMat4 } from './tile-math';
import { TILE_UNLOADED, type Tile, type TileJson, type TilesetJson } from './tile-types';

/**
 * Абсолютный URL контента относительно базы тайлсета.
 *
 * @param uri - URI из tileset.json.
 * @param baseUrl - URL самого tileset.json.
 * @returns Абсолютный URL.
 */
export function resolveTileUri(uri: string, baseUrl: string): string {
    return new URL(uri, baseUrl).href;
}

/**
 * Скачать и минимально проверить tileset.json.
 *
 * @param url - Адрес tileset.json.
 * @returns Разобранный JSON.
 */
export async function fetchTilesetJson(url: string): Promise<TilesetJson> {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Не удалось загрузить tileset.json (HTTP ${response.status}): ${url}`);
    }

    let json: TilesetJson;
    try {
        json = await response.json();
    } catch (err) {
        throw new Error(`tileset.json не разбирается как JSON: ${url}`);
    }

    if (!json?.root) {
        throw new Error(`В tileset.json нет корневого тайла: ${url}`);
    }
    return json;
}

/**
 * Матрица из 16 чисел column-major (как в glTF и 3D Tiles).
 *
 * @param values - Массив из 16 чисел или undefined.
 * @returns Матрица; единичная, если массив не задан или неверной длины.
 */
function mat4FromArray(values: number[] | undefined): Mat4 {
    const m = new Mat4();
    if (values && values.length === 16) {
        m.set(values);
    }
    return m;
}

function contentUrisOf(json: TileJson): string[] {
    const list: string[] = [];
    const push = (c: { uri?: string; url?: string } | undefined) => {
        // 3D Tiles 1.0 писала `url`, 1.1 — `uri`. Файлы в природе встречаются с обоими.
        const uri = c?.uri ?? c?.url;
        if (uri) {
            list.push(uri);
        }
    };
    push(json.content);
    (json.contents ?? []).forEach(push);
    return list;
}

export type BuildTreeOptions = {
    /** URL tileset.json, относительно которого разрешаются URI контента. */
    baseUrl: string;
    /** Трансформация, накопленная выше по дереву (для внешнего тайлсета — трансформ его тайла). */
    parentTransform?: Mat4;
    /** Матрица «тайлсет → мир»: поворот Z-вверх → Y-вверх, рецентровка и трансформ сцены. */
    tilesetToWorld: Mat4;
    parent?: Tile | null;
    /** Предупреждения (неподдержанные части формата) складываются сюда. */
    warnings: string[];
};

/**
 * Развернуть JSON-дерево в дерево тайлов рантайма.
 *
 * Габариты и геометрическая ошибка сразу пересчитываются в мировые единицы — см. пояснение
 * в `tile-math.ts`. Пересчитать их заново (после трансформации сцены) умеет
 * `recomputeWorldVolumes`.
 *
 * @param json - Корневой тайл (или любой поддеревянный узел).
 * @param options - База URL, накопленный трансформ и приёмник предупреждений.
 * @returns Корень построенного поддерева.
 */
/**
 * Счётчик номеров тайлов.
 *
 * Общий на модуль: внешние тайлсеты разбираются позже основного, и сквозная передача состояния
 * через рекурсию ради меньших чисел усложнила бы разбор без пользы.
 */
let tileIdCounter = 0;

export function buildTileTree(json: TileJson, options: BuildTreeOptions): Tile {
    const { baseUrl, tilesetToWorld, warnings } = options;
    const parent = options.parent ?? null;
    const parentTransform = options.parentTransform ?? new Mat4();

    const transform = new Mat4().mul2(parentTransform, mat4FromArray(json.transform));

    const worldMatrix = new Mat4().mul2(tilesetToWorld, transform);
    const obb = makeWorldObb(json.boundingVolume ?? {}, worldMatrix);
    if (!obb) {
        warnings.push('Bounding volume типа `region` не поддержан — тайл будет считаться всегда видимым.');
    }

    const refine = (json.refine ?? parent?.refine ?? 'REPLACE').toUpperCase() as 'ADD' | 'REPLACE';

    const uris = contentUrisOf(json).map(uri => resolveTileUri(uri, baseUrl));
    // Контент-«tileset.json» — это внешний тайлсет, а не геометрия: его нельзя отдавать
    // загрузчику GLB, он подставляет вместо себя целое поддерево.
    const externalTilesetUri = uris.find(u => /\.json(?:\?|$)/i.test(u)) ?? null;
    const contentUris = uris.filter(u => u !== externalTilesetUri);

    const tile: Tile = {
        json,
        parent,
        children: [],
        depth: parent ? parent.depth + 1 : 0,
        transform,
        // Габариты `region` заменяются пустышкой; такие тайлы никогда не отсекаются
        // по фрустуму и всегда получают бесконечную ошибку — то есть максимально
        // консервативное поведение вместо неверного.
        obb: obb as Tile['obb'],
        geometricError: (json.geometricError ?? 0) * maxScaleOfMat4(worldMatrix),
        refine,
        contentUris,
        externalTilesetUri,
        externalRoot: null,
        id: ++tileIdCounter,
        state: TILE_UNLOADED,
        entity: null,
        assets: [],
        bytes: 0,
        lastUsedFrame: -1,
        distance: Infinity,
        error: 0,
        inFrustum: false,
        central: true,
        loadSequence: 0,
        loadTime: 0,
        lodSequence: 0,
        selected: false,
        wasRefined: false,
        loadToken: null,
        implicit: null
    };

    tile.children = (json.children ?? []).map(child => buildTileTree(child, {
        baseUrl,
        parentTransform: transform,
        tilesetToWorld,
        parent: tile,
        warnings
    }));

    return tile;
}

/**
 * Пересчитать мировые габариты и геометрическую ошибку всего поддерева.
 *
 * Нужно при любом изменении трансформации сцены: вьюер позволяет двигать, вращать и
 * масштабировать содержимое гизмо, а LOD считается в мировых единицах.
 *
 * @param tile - Корень поддерева.
 * @param tilesetToWorld - Новая матрица «тайлсет → мир».
 */
export function recomputeWorldVolumes(tile: Tile, tilesetToWorld: Mat4) {
    const worldMatrix = new Mat4().mul2(tilesetToWorld, tile.transform);
    const obb = makeWorldObb(tile.json.boundingVolume ?? {}, worldMatrix);
    if (obb) {
        tile.obb = obb;
    }
    tile.geometricError = (tile.json.geometricError ?? 0) * maxScaleOfMat4(worldMatrix);
    tile.children.forEach(child => recomputeWorldVolumes(child, tilesetToWorld));
    if (tile.externalRoot) {
        recomputeWorldVolumes(tile.externalRoot, tilesetToWorld);
    }
}

/**
 * Найти «плотные» габариты тайла в его метаданных.
 *
 * Тайлсеты из Cesium ion кладут рядом с `boundingVolume` ещё один объём с семантикой
 * `TILE_BOUNDING_BOX` — он описывает реальную геометрию, тогда как сам `boundingVolume`
 * у неявного дерева всегда кубический и заметно больше модели. Для отсечения и выбора
 * уровня нужен именно кубический (по нему делится дерево), а кадрировать камеру по нему —
 * значит увести её в разы дальше, чем нужно.
 *
 * @param tilesetJson - Весь tileset.json (нужна схема метаданных).
 * @param tileJson - JSON тайла.
 * @returns 12 чисел `box` или `null`.
 */
export function findTightBoundingBox(tilesetJson: TilesetJson, tileJson: TileJson): number[] | null {
    const metadata = tileJson.metadata;
    const classes = tilesetJson.schema?.classes;
    if (!metadata?.properties || !classes) {
        return null;
    }
    const schemaProperties = classes[metadata.class]?.properties ?? {};
    for (const [name, value] of Object.entries(metadata.properties)) {
        if (schemaProperties[name]?.semantic === 'TILE_BOUNDING_BOX' &&
            Array.isArray(value) && value.length === 12) {
            return value as number[];
        }
    }
    return null;
}

/**
 * Обойти поддерево, вызвав `fn` для каждого тайла.
 *
 * @param tile - Корень поддерева.
 * @param fn - Что вызвать для каждого тайла.
 */
export function forEachTile(tile: Tile, fn: (tile: Tile) => void) {
    fn(tile);
    tile.children.forEach(child => forEachTile(child, fn));
}
