# Инспектор тайлов Streamed GSplat

Статус: **идея зафиксирована, реализация не начата** (2026-08-08).

## Зачем нужен

У 3D Tiles/GLB во вьюере уже есть Tiles Debug: контуры OBB, раскраска State/LOD, HUD,
выбор тайла, изоляция уровня, заморозка камеры и пауза очереди. Streamed SOG тоже состоит
из пространственных блоков и уровней детализации, но управляется не нашим `TileManager`, а
внутренним `GSplatWorld` PlayCanvas. Из-за этого текущий инспектор его не видит.

Практическая задача — объяснять прямо на сцене:

- какой splat-блок сейчас отображается и каким LOD;
- какой LOD движок считает оптимальным;
- какие файлы загружены, ожидаются или находятся в FIFO-очереди;
- какие блоки находятся в кадре, сбоку и за камерой;
- куда расходуется `splatBudget`;
- почему сцена проявляется отдельными блоками и почему нужный камере участок может ждать.

## Текущее устройство

`lod-meta.json` содержит иерархическое дерево, но PlayCanvas при разборе Streamed SOG
извлекает из него только листья с `lods`. Для каждого листа движок хранит:

- AABB;
- `currentLod` и `optimalLod`;
- `worldDistance` и `budgetBucket`;
- диапазон сплатов внутри файла;
- текущий file placement;
- pending/loaded resource state.

LOD выбирается по расстоянию до AABB, FOV и штрафу направления
`lodBehindPenalty`. Это не тот же алгоритм, что у GLB-тайлов:

- frustum не исключает лист из стриминга;
- projected SSE не используется;
- `GSplatAssetLoader` выдаёт только два запроса одновременно;
- очередь FIFO и не пересортировывается по актуальной камере;
- промежуточные узлы дерева не являются отображаемым coarse proxy.

Во viewer сейчас настроены:

- desktop `splatBudget = 3_000_000`, mobile `1_500_000`;
- `lodBehindPenalty = 5`;
- `lodUpdateAngle = 90`;
- `lodUnderfillLimit = 32`, чтобы разрешить грубый fallback до прихода оптимального LOD.

Тестовая JUMA на момент записи: 552 листа, 6 LOD, 273 файловых пакета. Самый грубый
LOD содержит 304 191 сплат и разделён на пять файлов, поэтому даже coarse-представление
появляется несколькими блоками, а не одним корневым объектом как в GLB REPLACE-тайлсете.

## Что можно переиспользовать из GLB-инспектора

| Возможность | Streamed GSplat | Примечание |
|---|---|---|
| Толстые AABB-контуры | Да | Переиспользовать `DebugSolid.obbEdgesThick` |
| Цвет по LOD | Да | Использовать `currentLod`/`optimalLod`, а не depth |
| Цвет по состоянию | Да | Нужен диагностический snapshot загрузчика |
| HUD статистики | Да | Поля отличаются от `TileDebugInfo` |
| Frustum и замороженная камера | Да | Геометрия камеры уже реализована |
| Глобальная фиксация LOD | Да | Через `lodRangeMin`/`lodRangeMax` компонента |
| Изоляция одного блока | Частично | Нужна фильтрация placement/interval в движке |
| Выбор блока кликом | Частично | Первый этап — ray/AABB; точный ID требует engine hook |
| Пауза загрузки | Требует hook | У `GSplatAssetLoader` нет публичного API |
| Порядок очереди | Требует hook | FIFO-очередь внутренняя |
| SSE/geometric error | Нет | Показывать distance bands и FOV-adjusted distance |

Обычные монолитные `.ply`/`.sog`/`.spz` не имеют spatial LOD-дерева и не должны получать
этот инспектор. Он включается только для ресурса с `lod-meta.json`/GSplat octree.

## Варианты реализации

### 1. Быстрый внешний инспектор

Viewer повторно читает `lod-meta.json`, извлекает AABB листьев и самостоятельно считает
frustum, расстояние и предполагаемый LOD.

Плюсы: не нужен патч PlayCanvas. Минусы: нельзя достоверно показать `currentLod`, budget
balancing, pending files и очередь. Такой режим полезен как визуализация структуры, но не
как инструмент диагностики реального стриминга.

### 2. Диагностический адаптер PlayCanvas — рекомендуемый

Добавить к движку read-only snapshot текущего GSplat octree. Минимальный контракт:

```ts
type GSplatNodeDebugInfo = {
    index: number;
    bounds: BoundingBox;
    currentLod: number;
    optimalLod: number;
    worldDistance: number;
    budgetBucket: number;
    fileIndex: number;
    splatCount: number;
    state: 'inactive' | 'queued' | 'loading' | 'ready' | 'cooldown' | 'failed';
};

type GSplatStreamingDebugSnapshot = {
    nodes: GSplatNodeDebugInfo[];
    loading: number;
    queued: number;
    activeSplats: number;
    budget: number;
};
```

Viewer должен зависеть от маленького адаптера, а не обращаться напрямую к полям вида
`_octreeInstances`/`_loadQueue`. Это локализует зависимость от внутренних API PlayCanvas и
упростит обновление версии движка.

Долгосрочно этот API стоит предложить upstream вместе с camera-priority очередью для
`GSplatAssetLoader`.

## Предлагаемая архитектура viewer

Вынести общий контракт отладчика, не пытаясь встроить splat в `TileManager`:

```ts
interface SpatialLodDebugProvider {
    getStats(): SpatialLodStats;
    getNodes(): SpatialLodNodeInfo[];
    setFrozen(value: boolean): void;
    setPaused(value: boolean): void;
    setLodIsolate(level: number | null): void;
}
```

- `TileManager` становится GLB/3D Tiles provider;
- новый `GSplatDebugProvider` оборачивает engine snapshot;
- `Viewer` и UI работают с активным provider;
- `DebugSolid`, камера-инспектор, HUD и observer-флаги остаются общими;
- форматные поля выводятся в отдельной части карточки.

Не нужно заставлять GSplat притворяться 3D Tiles: у него нет `refine`, `geometricError`,
родительского proxy и той же семантики глубины.

## Этапы

### Фаза 1 — обзор без управления

- определить Streamed SOG при загрузке;
- получить snapshot листьев;
- нарисовать AABB по `currentLod` и состоянию;
- HUD: nodes, ready/loading/queued, active splats, budget;
- режимы `By Current LOD`, `By Optimal LOD`, `By State`;
- показать frustum живой камеры.

Эта фаза уже должна наглядно подтвердить расход бюджета и неправильный порядок появления
блоков.

### Фаза 2 — сравнение решения движка с камерой

- заморозить диагностическую камеру;
- показать блоки in-frustum/out-of-frustum/behind;
- показывать `currentLod → optimalLod`, distance band и file index;
- выбрать лист кликом через ray/AABB;
- изолировать выбранный AABB в overlay без вмешательства в рендер.

### Фаза 3 — управление

- pause/resume loader;
- глобальный LOD lock через `lodRangeMin`/`lodRangeMax`;
- изоляция конкретного LOD/листа в engine placements;
- номера запросов и визуальный путь FIFO;
- при необходимости кнопка «сначала полный coarse LOD».

### Фаза 4 — исправление планировщика

Инспектор должен помочь проверить отдельную задачу: заменить FIFO на пересортируемую
очередь с приоритетами `актуален → в кадре → ближе/важнее → coarse fallback`, отменой
устаревших pending-заявок и настраиваемым параллелизмом.

## Критерии готовности первой полезной версии

- JUMA показывает 552 AABB и не создаёт новый loader;
- цвет текущего LOD совпадает с engine snapshot;
- HUD меняется при движении камеры и загрузке файлов;
- выключенный debug не добавляет кадров и сетевых запросов;
- debug всегда выключен при открытии публичного viewer;
- WebGL2 и WebGPU дают одинаковую диагностику;
- тесты проверяют включение overlay, смену LOD и отсутствие debug на монолитном SOG.

## Риски и открытые вопросы

- Диагностические поля PlayCanvas сейчас внутренние и могут меняться между версиями.
- Release-сборка не должна зависеть от `Debug.call`: snapshot нужен в обычном runtime-коде,
  но должен ничего не вычислять, пока инспектор выключен.
- Один файл может содержать диапазоны нескольких листьев; file state и node state нельзя
  считать одним и тем же.
- Ray/AABB выбирает пространственный блок, но не гарантирует попадание в видимый сплат.
- Нужно решить, оставлять ли общий UI под названием Tiles Debug или переименовать в
  Spatial LOD Debug с форматными секциями GLB/GSplat.

## Связанный код

- `src/tiles/tile-manager.ts` — GLB/3D Tiles selection и debug snapshot;
- `src/tiles/tile-request-queue.ts` — camera-priority очередь GLB;
- `src/debug-lines.ts` — контуры AABB и frustum;
- `src/viewer.ts`, `Viewer.initGSplat()` — параметры Streamed GSplat;
- PlayCanvas: `GSplatOctree`, `GSplatOctreeInstance`, `GSplatWorld`,
  `GSplatBudgetBalancer`, `GSplatAssetLoader`.

