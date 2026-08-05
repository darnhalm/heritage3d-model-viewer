/**
 * Приоритетная очередь загрузки тайлов.
 *
 * Ключевое отличие от FIFO — очередь пересортировывается ПЕРЕД каждой выдачей задач, а не
 * один раз при постановке. Это прямой вывод из разбора 3DTilesRendererJS (см.
 * `docs/GLB-TILING-PLAYCANVAS.md`, «Референс: приоритеты в 3DTilesRendererJS»): если
 * приоритет фиксируется при постановке, камера уезжает, а очередь ещё десяток секунд
 * грузит то, что было актуально раньше. Ровно этим болеет `GSplatAssetLoader` в движке.
 */

import type { Tile } from './tile-types';

export type QueueEntry = {
    tile: Tile;
    run: () => Promise<void>;
};

/**
 * Сравнение тайлов по приоритету загрузки. Возвращает отрицательное, если `a` грузить
 * раньше `b`.
 *
 * Лестница (сверху вниз, каждая ступень решает при равенстве предыдущей):
 *
 * 1. попал ли тайл в обход последнего кадра — актуальные раньше устаревших;
 * 2. в кадре ли он — «за спиной» грузится позже, но не выкидывается: жёсткий фильтр даёт
 *    пустые области при резком повороте камеры, сортировка — лишь отложенную загрузку;
 * 3. больше экранная ошибка — раньше: этот тайл сильнее портит картинку;
 * 4. ближе к камере — раньше;
 * 5. мельче глубина — раньше, чтобы родитель приходил до детей и было чем закрыть дыру.
 *
 * @param a - Первый тайл.
 * @param b - Второй тайл.
 * @param frame - Номер текущего кадра обхода.
 * @returns Отрицательное, если `a` приоритетнее.
 */
export function compareTilePriority(a: Tile, b: Tile, frame: number): number {
    const usedA = a.lastUsedFrame === frame ? 1 : 0;
    const usedB = b.lastUsedFrame === frame ? 1 : 0;
    if (usedA !== usedB) {
        return usedB - usedA;
    }

    const frustumA = a.inFrustum ? 1 : 0;
    const frustumB = b.inFrustum ? 1 : 0;
    if (frustumA !== frustumB) {
        return frustumB - frustumA;
    }

    if (a.error !== b.error) {
        return b.error - a.error;
    }

    if (a.distance !== b.distance) {
        return a.distance - b.distance;
    }

    return a.depth - b.depth;
}

export class TileRequestQueue {
    private entries: QueueEntry[] = [];

    private active = 0;

    private frame = 0;

    /** На паузе новые загрузки не стартуют; уже идущие доигрываются (см. `dispatch`). */
    private paused = false;

    /**
     * @param maxConcurrent - Сколько загрузок идёт одновременно. Значение по умолчанию —
     * начальная гипотеза из документа (6 для десктопа); мобильному профилю нужно меньше.
     * @param onIdle - Вызывается, когда очередь опустела и активных загрузок не осталось.
     */
    constructor(private maxConcurrent = 6, private onIdle?: () => void) {}

    get pending(): number {
        return this.entries.length;
    }

    get running(): number {
        return this.active;
    }

    /**
     * Номер кадра обхода — используется компаратором как признак «тайл ещё нужен».
     *
     * @param frame - Номер текущего кадра.
     */
    setFrame(frame: number) {
        this.frame = frame;
    }

    /**
     * Поставить загрузку в очередь.
     *
     * @param entry - Тайл и функция загрузки.
     */
    push(entry: QueueEntry) {
        this.entries.push(entry);
        this.dispatch();
    }

    /**
     * Убрать из очереди ещё не начатые загрузки.
     *
     * @param predicate - Вернуть true для тех тайлов, чьи заявки нужно снять.
     */
    remove(predicate: (tile: Tile) => boolean) {
        this.entries = this.entries.filter(entry => !predicate(entry.tile));
    }

    /** Очистить очередь целиком (смена сцены). */
    clear() {
        this.entries = [];
    }

    /**
     * Пауза загрузки: на паузе `dispatch` не стартует новые задачи. Снятие паузы сразу
     * догоняет очередь.
     *
     * @param value - Ставить ли на паузу.
     */
    setPaused(value: boolean) {
        this.paused = value;
        if (!value) {
            this.dispatch();
        }
    }

    get isPaused(): boolean {
        return this.paused;
    }

    /**
     * Запустить ровно одну — самую приоритетную — задачу, даже на паузе (пошаговый режим).
     *
     * @returns `true`, если было что запустить.
     */
    step(): boolean {
        if (this.entries.length === 0 || this.active >= this.maxConcurrent) {
            return false;
        }
        this.entries.sort((a, b) => compareTilePriority(a.tile, b.tile, this.frame));
        const entry = this.entries.shift();
        this.active++;
        entry.run().catch(() => {}).finally(() => {
            this.active--;
            // На паузе это no-op — шаг не запускает каскад; без паузы очередь поедет дальше.
            this.dispatch();
        });
        return true;
    }

    /**
     * Запустить столько задач, сколько позволяет лимит, начиная с самых приоритетных.
     * Сортировка именно здесь — по свежим данным камеры.
     */
    dispatch() {
        if (this.paused) {
            return;
        }
        if (this.entries.length === 0) {
            if (this.active === 0) {
                this.onIdle?.();
            }
            return;
        }

        this.entries.sort((a, b) => compareTilePriority(a.tile, b.tile, this.frame));

        while (this.active < this.maxConcurrent && this.entries.length > 0) {
            const entry = this.entries.shift();
            this.active++;
            entry.run().catch(() => {
                // Ошибку обрабатывает сам `run` (помечает тайл FAILED); здесь только
                // страховка, чтобы не потерять слот параллелизма.
            }).finally(() => {
                this.active--;
                this.dispatch();
            });
        }
    }
}
