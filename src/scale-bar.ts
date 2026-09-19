/**
 * Экранная полоса масштаба — перенос плагина `openseadragon-scalebar` из двумерного плеера.
 *
 * В отличие от оригинала полоса вертикальная: горизонтальная в трёхмерной сцене спорит с самой
 * моделью — она лежит поперёк кадра и читается как часть объекта, а не как служебная шкала.
 *
 * Плагин показывает отрезок круглой длины (1, 2 или 5 на порядок) и подписывает его. Здесь
 * взята только эта арифметика: подбор круглого числа, деления и шаг. Вся обвязка OSD
 * (`viewer.scalebar()`, хендлеры `open`/`animation`/`resize`, прижатие к краю изображения)
 * в трёхмерной сцене не нужна — обновление вызывается из `onPrerender`, то есть только на
 * действительно нарисованных кадрах.
 *
 * Отличие от двумерного случая одно, зато принципиальное: там «пикселей на метр» — одно число
 * на весь кадр, здесь при перспективе оно зависит от глубины. Поэтому масштаб считается на
 * глубине точки орбиты, и в подсказке это сказано прямо. В ортографии оговорка не нужна, и
 * вызывающая сторона её не передаёт.
 */

type ScaleBarUnit = 'mm' | 'cm' | 'm';

const UNIT_IN_METERS: Record<ScaleBarUnit, number> = { mm: 0.001, cm: 0.01, m: 1 };

/**
 * Наименьшая длина полосы в пикселях экрана.
 *
 * В плагине это значение читалось из `offsetWidth` уже созданного элемента, то есть каждый
 * вызов `setMinWidth` форсировал пересчёт разметки. Нам хватает константы: полоса всё равно
 * растягивается до ближайшего круглого числа, которое не короче этой величины.
 */
const MIN_LENGTH_PX = 110;

type ScaleBarProps = {
    /** Длина полосы на экране, пиксели (по вертикали). */
    size: number;
    /** Подпись: круглая длина с единицей. */
    text: string;
    /** На сколько частей делить полосу засечками. */
    divisions: number;
    /** Длина одного деления — уходит в подсказку. */
    stepText: string;
};

/**
 * Ближайшее снизу «круглое» число вида 1, 2 или 5 на порядок.
 *
 * @param value - Длина, которую надо округлить.
 * @returns Круглая длина в тех же единицах.
 */
const niceLength = (value: number): number => {
    const exponent = Math.floor(Math.log10(value));
    const magnitude = 10 ** exponent;
    const normalized = value / magnitude;
    return (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;
};

/**
 * Подобрать длину полосы, подпись и засечки.
 *
 * @param pixelsPerUnit - Сколько пикселей экрана приходится на одну выбранную единицу.
 * @param unit - Единица подписи.
 * @returns Параметры отрисовки.
 */
const computeScaleBar = (pixelsPerUnit: number, unit: ScaleBarUnit): ScaleBarProps => {
    const value = niceLength(MIN_LENGTH_PX / pixelsPerUnit);
    const size = value * pixelsPerUnit;
    // Деления примерно по 24 пикселя, но из привычного ряда: иначе засечки то сливаются,
    // то стоят вразброс, и шаг перестаёт читаться.
    const preferred = Math.max(2, Math.min(10, Math.round(size / 24)));
    const divisions = [2, 4, 5, 10].reduce((best, candidate) => (
        Math.abs(candidate - preferred) < Math.abs(best - preferred) ? candidate : best
    ));
    return {
        size,
        text: `${value.toLocaleString('en-US')} ${unit}`,
        divisions,
        stepText: `${(value / divisions).toLocaleString('en-US', { maximumSignificantDigits: 3 })} ${unit}`
    };
};

class ScaleBar {
    private el: HTMLDivElement;

    /** Последнее записанное в DOM состояние: пока оно не изменилось, писать нечего. */
    private lastKey = '';

    private shown = false;

    constructor(container: HTMLElement) {
        this.el = document.createElement('div');
        this.el.className = 'viewer-scale-bar';
        this.el.style.display = 'none';
        container.appendChild(this.el);
    }

    hide() {
        if (!this.shown) return;
        this.shown = false;
        this.el.style.display = 'none';
    }

    /**
     * Пересчитать полосу под текущий кадр.
     *
     * Вызывается из цикла отрисовки, поэтому запись в DOM идёт только при смене подписи или
     * длины: при вращении вокруг точки орбиты расстояние до неё не меняется, и полоса стоит.
     *
     * @param pixelsPerMeter - Пикселей экрана на метр на опорной глубине.
     * @param unit - Единица подписи.
     * @param stepLabel - Локализованное слово «шаг» для подсказки.
     * @param note - Оговорка про глубину; пустая строка её убирает (ортография).
     */
    update(pixelsPerMeter: number, unit: ScaleBarUnit, stepLabel: string, note: string) {
        if (!Number.isFinite(pixelsPerMeter) || pixelsPerMeter <= 0) {
            this.hide();
            return;
        }

        const props = computeScaleBar(pixelsPerMeter * UNIT_IN_METERS[unit], unit);
        const length = Math.round(props.size);
        const key = `${length}|${props.text}|${props.divisions}|${stepLabel}|${note}`;
        if (key !== this.lastKey) {
            this.lastKey = key;
            // Полоса вертикальная: длина — это высота, ширину задаёт подпись рядом с линией.
            this.el.style.height = `${length}px`;
            this.el.style.setProperty('--scale-bar-divisions', String(props.divisions));
            this.el.textContent = props.text;
            this.el.title = note ?
                `${stepLabel}: ${props.stepText} · ${note}` :
                `${stepLabel}: ${props.stepText}`;
        }
        if (!this.shown) {
            this.shown = true;
            this.el.style.display = '';
        }
    }

    destroy() {
        this.el.remove();
    }
}

export { ScaleBar, ScaleBarUnit };
