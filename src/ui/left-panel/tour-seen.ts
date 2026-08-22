// Отметка «обучающий тур уже показывали» живёт отдельно от самого тура: сам тур тянет
// за собой driver.js и стилями на два десятка килобайт, а проверка нужна раньше — по
// ней и решают, грузить ли модуль вообще. Раньше они лежали вместе, и чанк приезжал
// каждому, кто просто открыл панель.
const TOUR_SEEN_KEY = 'h3d.tour.v1.seen';

/**
 * Показывали ли обучающий тур в этом браузере.
 *
 * @returns `true`, если тур уже видели (или хранилище недоступно — тогда не навязываемся).
 */
const hasSeenTour = (): boolean => {
    try {
        return window.localStorage?.getItem(TOUR_SEEN_KEY) === '1';
    } catch {
        return true;
    }
};

/** Запомнить, что тур показан. */
const markTourSeen = (): void => {
    try {
        window.localStorage?.setItem(TOUR_SEEN_KEY, '1');
    } catch {
        /* no-op */
    }
};

export { hasSeenTour, markTourSeen };
