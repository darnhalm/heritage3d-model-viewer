/**
 * Типы формата 3D Tiles (подмножество, которое читает наш рантайм) и типы состояния тайла
 * в рантайме.
 *
 * Из спецификации сознательно взято не всё — см. `docs/GLB-TILING-PLAYCANVAS.md`, раздел
 * «Предлагаемый формат». Не поддерживаются: bounding volume `region`,
 * `viewerRequestVolume`, метаданные (`EXT_structural_metadata`), контенты
 * `.pnts` / `.i3dm` / `.cmpt`.
 */

import type { BoundingSphere, Entity, Mat4, Vec3 } from 'playcanvas';

import type { ImplicitCoord, ImplicitTilingInfo } from './implicit-tiling';

/** Bounding volume тайла в том виде, в каком он лежит в JSON. */
export type TileBoundingVolumeJson = {
    /** 12 чисел: центр (3) + три полуоси (9). Оси произвольные, не обязательно ортогональные. */
    box?: number[];
    /** 4 числа: центр (3) + радиус. */
    sphere?: number[];
    /** 6 чисел, географический объём (запад, юг, восток, север, minH, maxH) — не поддержан. */
    region?: number[];
};

export type TileContentJson = {
    uri?: string;
    /** 3D Tiles 1.0 писала `url`; читаем оба. */
    url?: string;
};

export type TileJson = {
    boundingVolume: TileBoundingVolumeJson;
    geometricError: number;
    refine?: 'ADD' | 'REPLACE' | 'add' | 'replace';
    /** 16 чисел, column-major, как в glTF. */
    transform?: number[];
    content?: TileContentJson;
    /** 1.1: несколько контентов на тайл. */
    contents?: TileContentJson[];
    children?: TileJson[];
    implicitTiling?: unknown;
    /** Метаданные тайла (`EXT_structural_metadata`); читаем из них только габариты. */
    metadata?: { class: string; properties?: Record<string, unknown> };
};

export type TilesetJson = {
    asset?: { version?: string };
    geometricError: number;
    root: TileJson;
    /** Схема метаданных — нужна, чтобы понять семантику свойств тайла. */
    schema?: { classes?: Record<string, { properties?: Record<string, { semantic?: string }> }> };
};

/**
 * Жизненный цикл контента тайла. `ABORTED` в MVP нет: отменить уже начатую загрузку
 * PlayCanvas Asset API не позволяет, поэтому устаревший результат просто не становится
 * видимым (см. `TileContent.load`).
 */
export const TILE_UNLOADED = 'unloaded';
export const TILE_QUEUED = 'queued';
export const TILE_LOADING = 'loading';
export const TILE_READY = 'ready';
export const TILE_FAILED = 'failed';

export type TileState =
    | typeof TILE_UNLOADED
    | typeof TILE_QUEUED
    | typeof TILE_LOADING
    | typeof TILE_READY
    | typeof TILE_FAILED;

/**
 * Ориентированный габаритный ящик в мировых координатах.
 *
 * Хранится центром и тремя полуосями (не нормализованными) — ровно так, как задан `box`
 * в 3D Tiles. Оси могут быть неортогональными, поэтому расстояние до ящика считается
 * приближённо (см. `distanceToPoint` в `tile-math.ts`).
 */
export type WorldObb = {
    center: Vec3;
    /** Три полуоси. Длина каждой = половина размера ящика вдоль этой оси. */
    halfAxes: [Vec3, Vec3, Vec3];
    /** Описанная сфера — для отсечения по фрустуму и грубых оценок. */
    sphere: BoundingSphere;
};

/** Узел дерева тайлов в рантайме. */
export type Tile = {
    /** Исходный JSON — на случай отладки и будущих расширений. */
    json: TileJson;
    parent: Tile | null;
    children: Tile[];
    /** Глубина от корня тайлсета (у корня 0). Внешний тайлсет продолжает нумерацию. */
    depth: number;

    /** Полная (накопленная от корня) трансформация тайла, без учёта трансформа сцены. */
    transform: Mat4;
    /** Габариты в мировых координатах. Пересчитываются при смене трансформа сцены. */
    obb: WorldObb;
    /** Геометрическая ошибка, пересчитанная в мировые единицы. */
    geometricError: number;
    refine: 'ADD' | 'REPLACE';

    /** Абсолютные URL контента (в 1.1 их может быть несколько). */
    contentUris: string[];
    /** URL внешнего тайлсета, если контент тайла — `tileset.json`. */
    externalTilesetUri: string | null;
    /** Корень подгруженного внешнего тайлсета. */
    externalRoot: Tile | null;

    state: TileState;
    /** Корневая entity контента; `null`, пока контент не загружен. */
    entity: Entity | null;
    /** Ассеты контента — их нужно уничтожить при выгрузке. */
    assets: unknown[];
    /** Приблизительный объём в байтах (сумма размеров скачанных файлов). */
    bytes: number;

    /** Номер кадра обхода, в котором тайл понадобился. */
    lastUsedFrame: number;
    /** Расстояние от камеры до ближайшей точки габаритов, мировые единицы. */
    distance: number;
    /** Экранная ошибка в пикселях. */
    error: number;
    inFrustum: boolean;
    /** Попадает ли тайл в конус вокруг точки внимания; вне режимов приоритета всегда `true`. */
    central: boolean;
    /** Выбран для отрисовки в текущем кадре. */
    selected: boolean;
    /** Каким по счёту доехало содержимое тайла; 0 — ещё не загружался. */
    loadSequence: number;
    /** То же, но в пределах своего уровня детализации. */
    lodSequence: number;
    /** Уточнялся ли тайл детьми в прошлом кадре — нужно для гистерезиса порога SSE. */
    wasRefined: boolean;
    /** Токен отмены текущей загрузки контента. */
    loadToken: { cancelled: boolean; controller?: AbortController } | null;

    /**
     * Узел неявного дерева, за которым стоит ещё не загруженное поддерево масок.
     * `null` у обычных узлов и у тех, чьё поддерево уже развёрнуто.
     */
    implicit: {
        info: ImplicitTilingInfo;
        coord: ImplicitCoord;
        /** Маски уже загружены и дети созданы. */
        expanded: boolean;
        /** Загрузка масок идёт прямо сейчас. */
        pending: boolean;
    } | null;
};

/** Что рантайм показывает наружу — для отладочной панели и тестов. */
export type TileStats = {
    tiles: number;
    ready: number;
    loading: number;
    queued: number;
    failed: number;
    selected: number;
    /** Сумма размеров загруженного контента, байты. */
    bytes: number;
    /** Текущий потолок кэша, байты. */
    bytesBudget: number;
    /**
     * Порог экранной ошибки, действующий сейчас, пиксели.
     *
     * Равен базовому, пока памяти хватает; под нехватку загрубляется — см.
     * `TileManager.updateErrorTargetScale`.
     */
    errorTarget: number;
    /** Во сколько раз порог загрублен относительно базового: 1 — память не мешает. */
    errorTargetScale: number;
    /** Максимальная глубина среди выбранных тайлов. */
    maxSelectedDepth: number;
    /** Сколько выбранных тайлов на каждой глубине; индекс массива — глубина. Для легенды LOD. */
    depthCounts: number[];
};
