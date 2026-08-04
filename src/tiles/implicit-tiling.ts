/**
 * Разворачивание неявного дерева тайлов (implicit tiling) в обычные узлы рантайма.
 *
 * Тайлсет с `implicitTiling` не перечисляет тайлы: он задаёт корневой объём, схему деления
 * и шаблоны URI, а какие узлы существуют — лежит в масках `.subtree` (см. `subtree.ts`).
 * Здесь эти маски превращаются в такие же `Tile`, как у явного дерева, — дальше обход,
 * выбор уровня детализации и загрузка не знают, откуда взялся узел.
 *
 * Разворачивание ленивое: сначала корневое поддерево, дальше вложенные — по мере того как
 * обход до них доходит. У тайлсета храма это 185 файлов масок на 552 тайла; грузить их все
 * сразу значило бы 185 запросов до первой картинки.
 */

import { Mat4 } from 'playcanvas';

import {
    branchingFactor, fetchSubtree, fillUriTemplate, levelOffset, mortonIndex,
    type SubdivisionScheme, type Subtree
} from './subtree';
import type { Tile, TileJson } from './tile-types';
import { buildTileTree } from './tileset-loader';

/** Всё, что нужно знать о неявном дереве, чтобы разворачивать его узлы. */
export type ImplicitTilingInfo = {
    scheme: SubdivisionScheme;
    /** Сколько уровней описывает один файл масок. */
    subtreeLevels: number;
    /** Максимальная глубина дерева. */
    availableLevels: number;
    /**
     * Шаблон адреса файлов масок — В ИСХОДНОМ ВИДЕ, как записан в tileset.json.
     *
     * Разрешать его относительно базы заранее нельзя: конструктор `URL` кодирует фигурные
     * скобки (`{level}` → `%7Blevel%7D`), и подстановка координат перестаёт срабатывать.
     * Поэтому сначала подстановка, потом разрешение относительно `baseUrl`.
     */
    subtreeTemplate: string;
    /** Шаблоны адресов контента, тоже в исходном виде (в 1.1 их может быть несколько). */
    contentTemplates: string[];
    /** База, относительно которой разрешаются шаблоны после подстановки. */
    baseUrl: string;
    /** `boundingVolume.box` корня неявного дерева — из него делением получаются все прочие. */
    rootBox: number[];
    /** Геометрическая ошибка корня в единицах тайлсета. */
    rootGeometricError: number;
    /** Как наследуется `refine`. */
    refine: 'ADD' | 'REPLACE';
};

/** Координаты узла в неявном дереве. */
export type ImplicitCoord = { level: number; x: number; y: number; z: number };

/**
 * Габариты узла: корневой ящик, поделённый по координатам узла.
 *
 * Полуоси уменьшаются в 2^level раз, центр смещается вдоль каждой оси на долю, которую
 * задаёт координата. Оси при этом остаются исходными, так что повёрнутый корневой ящик
 * делится корректно — без этого тайлсеты с ECEF-ориентацией разъехались бы.
 *
 * @param rootBox - 12 чисел корневого `box`.
 * @param scheme - Схема деления.
 * @param coord - Координаты узла.
 * @returns 12 чисел `box` узла.
 */
export function subdivideBox(rootBox: number[], scheme: SubdivisionScheme, coord: ImplicitCoord): number[] {
    const divisions = 2 ** coord.level;
    const cx = rootBox[0];
    const cy = rootBox[1];
    const cz = rootBox[2];

    // Три полуоси корня.
    const ax = rootBox.slice(3, 6);
    const ay = rootBox.slice(6, 9);
    const az = rootBox.slice(9, 12);

    // Смещение центра вдоль оси: от -1 (первая ячейка) до +1 (последняя), в долях полуоси.
    const fx = (2 * coord.x + 1) / divisions - 1;
    const fy = (2 * coord.y + 1) / divisions - 1;
    // Квадродерево третью ось не делит.
    const fz = scheme === 'OCTREE' ? (2 * coord.z + 1) / divisions - 1 : 0;
    const scaleZ = scheme === 'OCTREE' ? 1 / divisions : 1;

    return [
        cx + fx * ax[0] + fy * ay[0] + fz * az[0],
        cy + fx * ax[1] + fy * ay[1] + fz * az[1],
        cz + fx * ax[2] + fy * ay[2] + fz * az[2],
        ax[0] / divisions, ax[1] / divisions, ax[2] / divisions,
        ay[0] / divisions, ay[1] / divisions, ay[2] / divisions,
        az[0] * scaleZ, az[1] * scaleZ, az[2] * scaleZ
    ];
}

/**
 * Собрать JSON-описание узла неявного дерева.
 *
 * Узел описывается тем же `TileJson`, что и узел явного дерева, — так дальше работает общий
 * код построения (`buildTileTree`), пересчёта габаритов и загрузки контента.
 *
 * @param info - Параметры неявного дерева.
 * @param coord - Координаты узла.
 * @param hasContent - Есть ли у узла контент.
 * @returns Описание узла.
 */
function makeTileJson(info: ImplicitTilingInfo, coord: ImplicitCoord, hasContent: boolean): TileJson {
    const json: TileJson = {
        boundingVolume: { box: subdivideBox(info.rootBox, info.scheme, coord) },
        geometricError: info.rootGeometricError / 2 ** coord.level,
        refine: info.refine
    };
    if (hasContent) {
        const uris = info.contentTemplates.map(t => fillUriTemplate(t, coord.level, coord.x, coord.y, coord.z));
        if (uris.length === 1) {
            json.content = { uri: uris[0] };
        } else {
            json.contents = uris.map(uri => ({ uri }));
        }
    }
    return json;
}

export type ExpandOptions = {
    /** Матрица «тайлсет → мир» на момент разворачивания. */
    tilesetToWorld: Mat4;
    /** Трансформация, накопленная до корня неявного дерева. */
    parentTransform: Mat4;
    /** База для разрешения URI (шаблоны уже абсолютные, но `buildTileTree` требует базу). */
    baseUrl: string;
    warnings: string[];
};

/**
 * Развернуть одно поддерево: создать узлы его уровней и подвесить их к тайлу-корню.
 *
 * Возвращает координаты вложенных поддеревьев, до которых обход дойдёт позже, — грузить их
 * сразу не нужно.
 *
 * @param rootTile - Тайл, соответствующий корню поддерева.
 * @param rootCoord - Координаты этого тайла в неявном дереве.
 * @param subtree - Разобранные маски.
 * @param info - Параметры неявного дерева.
 * @param options - Трансформации и приёмник предупреждений.
 * @returns Созданные тайлы-заглушки вложенных поддеревьев.
 */
export function expandSubtree(
    rootTile: Tile,
    rootCoord: ImplicitCoord,
    subtree: Subtree,
    info: ImplicitTilingInfo,
    options: ExpandOptions
): { tile: Tile; coord: ImplicitCoord }[] {
    const { scheme, subtreeLevels } = info;
    const octree = scheme === 'OCTREE';
    const deferred: { tile: Tile; coord: ImplicitCoord }[] = [];

    // Узлы поддерева по локальным уровням: индекс — код Мортона, значение — созданный тайл.
    const byLevel: Map<number, Tile>[] = [new Map([[0, rootTile]])];

    // У корня поддерева контент проставляется здесь: до загрузки масок о нём ничего не
    // известно, и тайл-заглушка создавался пустым.
    if (subtree.tile.get(0) && subtree.content.get(0) && rootTile.contentUris.length === 0) {
        const json = makeTileJson(info, rootCoord, true);
        rootTile.contentUris = (json.contents ?? [json.content]).map(c => new URL(c.uri, options.baseUrl).href);
    }

    for (let local = 1; local < subtreeLevels; ++local) {
        const level = new Map<number, Tile>();
        byLevel.push(level);

        const parents = byLevel[local - 1];
        for (const [parentMorton, parentTile] of parents) {
            const parentCoord = mortonToCoord(scheme, parentMorton, local - 1);

            for (let child = 0; child < branchingFactor(scheme); ++child) {
                // Маски адресуются координатами ВНУТРИ поддерева, а URI и габариты —
                // глобальными координатами узла в дереве. Путать их нельзя: на корневом
                // поддереве они совпадают, а на вложенных разъезжаются.
                const localX = parentCoord.x * 2 + (child & 1);
                const localY = parentCoord.y * 2 + ((child >> 1) & 1);
                const localZ = octree ? parentCoord.z * 2 + ((child >> 2) & 1) : 0;

                const coord: ImplicitCoord = {
                    level: rootCoord.level + local,
                    x: (rootCoord.x << local) + localX,
                    y: (rootCoord.y << local) + localY,
                    z: octree ? (rootCoord.z << local) + localZ : 0
                };
                const morton = mortonIndex(scheme, localX, localY, localZ, local);
                const index = levelOffset(scheme, local) + morton;

                if (!subtree.tile.get(index)) {
                    continue;
                }

                const tile = buildTileTree(makeTileJson(info, coord, subtree.content.get(index)), {
                    baseUrl: options.baseUrl,
                    parentTransform: options.parentTransform,
                    tilesetToWorld: options.tilesetToWorld,
                    parent: parentTile,
                    warnings: options.warnings
                });
                parentTile.children.push(tile);
                level.set(morton, tile);
            }
        }
    }

    // Границы поддерева: там, где маска обещает вложенный файл, ставим тайл-заглушку.
    const deepest = byLevel[subtreeLevels - 1];
    for (const [parentMorton, parentTile] of deepest) {
        const parentCoord = mortonToCoord(scheme, parentMorton, subtreeLevels - 1);
        for (let child = 0; child < branchingFactor(scheme); ++child) {
            const localX = parentCoord.x * 2 + (child & 1);
            const localY = parentCoord.y * 2 + ((child >> 1) & 1);
            const localZ = octree ? parentCoord.z * 2 + ((child >> 2) & 1) : 0;
            const morton = mortonIndex(scheme, localX, localY, localZ, subtreeLevels);
            if (!subtree.childSubtree.get(morton)) {
                continue;
            }

            const coord: ImplicitCoord = {
                level: rootCoord.level + subtreeLevels,
                x: (rootCoord.x << subtreeLevels) + localX,
                y: (rootCoord.y << subtreeLevels) + localY,
                z: octree ? (rootCoord.z << subtreeLevels) + localZ : 0
            };
            if (coord.level >= info.availableLevels) {
                continue;
            }

            // Контент заглушки неизвестен, пока не загружены её маски.
            const tile = buildTileTree(makeTileJson(info, coord, false), {
                baseUrl: options.baseUrl,
                parentTransform: options.parentTransform,
                tilesetToWorld: options.tilesetToWorld,
                parent: parentTile,
                warnings: options.warnings
            });
            parentTile.children.push(tile);
            deferred.push({ tile, coord });
        }
    }

    return deferred;
}

/**
 * Обратное преобразование индекса Мортона в координаты.
 *
 * @param scheme - Схема деления.
 * @param morton - Индекс Мортона.
 * @param level - Уровень (сколько бит на координату).
 * @returns Координаты внутри уровня.
 */
function mortonToCoord(scheme: SubdivisionScheme, morton: number, level: number): { x: number; y: number; z: number } {
    const octree = scheme === 'OCTREE';
    const stride = octree ? 3 : 2;
    let x = 0;
    let y = 0;
    let z = 0;
    for (let i = 0; i < level; ++i) {
        x |= ((morton >> (stride * i)) & 1) << i;
        y |= ((morton >> (stride * i + 1)) & 1) << i;
        if (octree) {
            z |= ((morton >> (stride * i + 2)) & 1) << i;
        }
    }
    return { x, y, z };
}

/**
 * Прочитать `implicitTiling` из JSON тайла.
 *
 * @param json - JSON тайла.
 * @param baseUrl - База для шаблонов URI.
 * @param refine - Унаследованный режим уточнения.
 * @returns Параметры неявного дерева или `null`, если его нет.
 */
export function readImplicitTiling(json: TileJson, baseUrl: string, refine: 'ADD' | 'REPLACE'): ImplicitTilingInfo | null {
    const it = json.implicitTiling as {
        subdivisionScheme?: string;
        subtreeLevels?: number;
        availableLevels?: number;
        levels?: number;
        subtrees?: { uri?: string };
    } | undefined;

    if (!it?.subtrees?.uri || !it.subtreeLevels) {
        return null;
    }
    if (!json.boundingVolume?.box) {
        return null;
    }

    const contents = json.contents ?? (json.content ? [json.content] : []);
    return {
        scheme: it.subdivisionScheme === 'QUADTREE' ? 'QUADTREE' : 'OCTREE',
        subtreeLevels: it.subtreeLevels,
        // В черновиках расширения поле называлось `levels`; читаем оба.
        availableLevels: it.availableLevels ?? it.levels ?? 32,
        subtreeTemplate: it.subtrees.uri,
        contentTemplates: contents
        .map(c => c.uri ?? c.url)
        .filter((u): u is string => !!u),
        baseUrl,
        rootBox: json.boundingVolume.box,
        rootGeometricError: json.geometricError ?? 0,
        refine
    };
}

/**
 * Загрузить маски поддерева по координатам его корня.
 *
 * @param info - Параметры неявного дерева.
 * @param coord - Координаты корня поддерева.
 * @param signal - Сигнал отмены.
 * @returns Разобранные маски.
 */
export function loadSubtreeAt(info: ImplicitTilingInfo, coord: ImplicitCoord, signal?: AbortSignal): Promise<Subtree> {
    const uri = fillUriTemplate(info.subtreeTemplate, coord.level, coord.x, coord.y, coord.z);
    return fetchSubtree(new URL(uri, info.baseUrl).href, signal);
}
