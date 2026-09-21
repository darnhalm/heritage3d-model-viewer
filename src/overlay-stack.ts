/**
 * Раскладка прижатых к низу оверлеев, чтобы они не лезли друг на друга.
 *
 * В левом нижнем углу вьюпорта одновременно живут полоса масштаба, окно статистики тайлов и
 * счётчик кадров, а снизу под ними могут раскрыться шкалы перемотки. Прижать их к общей сетке
 * в стилях нечем: высота у каждого своя и меняется на ходу — у счётчика её переключает сам
 * зритель кликом, у окна статистики она зависит от числа строк. Поэтому место меряется по
 * живому DOM.
 */

/**
 * На сколько поднять оверлей, чтобы он встал над уже занятым местом.
 *
 * Вертикального пересечения намеренно не проверяем: все переданные элементы прижаты к низу, а
 * тест «пересекаемся ли сейчас» дал бы качели — поднялись, перестали пересекаться, упали
 * обратно. Горизонтальный тест такой беды не знает: по горизонтали оверлеи не двигаются.
 *
 * @param el - Размещаемый оверлей; от него берётся занимаемая колонка.
 * @param container - Элемент, от низа которого считается отступ.
 * @param blockers - Прижатые к низу оверлеи, которые нельзя перекрывать.
 * @param base - Отступ от низа, ниже которого не опускаемся.
 * @param clearance - Зазор между оверлеем и тем, над что он встал.
 * @param topMargin - Отступ сверху: выше не поднимаем, иначе оверлей срежет край вьюпорта.
 * @returns Отступ от низа контейнера в пикселях.
 */
const stackedBottom = (
    el: HTMLElement,
    container: HTMLElement,
    blockers: (HTMLElement | null | undefined)[],
    base: number,
    clearance: number,
    topMargin: number
): number => {
    const self = el.getBoundingClientRect();
    const box = container.getBoundingClientRect();
    let bottom = base;
    for (const blocker of blockers) {
        if (!blocker || blocker === el) continue;
        const rect = blocker.getBoundingClientRect();
        // Нулевой прямоугольник — элемент скрыт (`display: none`) либо ещё пуст.
        if (rect.width === 0 || rect.height === 0) continue;
        // Мешает только то, что стоит в той же колонке.
        if (rect.right <= self.left || rect.left >= self.right) continue;
        bottom = Math.max(bottom, box.bottom - rect.top + clearance);
    }
    // Лучше перекрытие, чем срезанный сверху оверлей: в тесном окне поднимать уже некуда.
    return Math.max(base, Math.min(bottom, box.height - self.height - topMargin));
};

export { stackedBottom };
