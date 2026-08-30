const addEventListenerOnClickOnly = (element: any, callback: any, delta = 2) => {
    let startX: number;
    let startY: number;

    const mouseDownEvt = (event: any) => {
        startX = event.pageX;
        startY = event.pageY;
    };
    element.addEventListener('mousedown', mouseDownEvt);

    const mouseUpEvt = (event: any) => {
        const diffX = Math.abs(event.pageX - startX);
        const diffY = Math.abs(event.pageY - startY);

        if (diffX < delta && diffY < delta) {
            callback(event);
        }
    };
    element.addEventListener('mouseup', mouseUpEvt);

    return () => {
        element.removeEventListener('mousedown', mouseDownEvt);
        element.removeEventListener('mouseup', mouseUpEvt);
    };
};

// extract members of the object given a list of paths to extract
const extract = (obj: any, paths: string[]) => {

    const resolve = (obj: any, path: string[]) => {
        for (const p of path) {
            if (!obj.hasOwnProperty(p)) {
                return null;
            }
            obj = obj[p];
        }
        return obj;
    };

    const result: any = { };

    for (const pathString of paths) {
        const path = pathString.split('.');
        const value = resolve(obj, path);

        let parent = result;
        for (let i = 0; i < path.length; ++i) {
            const p = path[i];
            if (i < path.length - 1) {
                if (!parent.hasOwnProperty(p)) {
                    parent[p] = { };
                }
                parent = parent[p];
            } else {
                parent[p] = value;
            }
        }
    }

    return result;
};

/** Ширина, ниже которой интерфейс считается мобильным. Та же точка перелома, что в стилях. */
const MOBILE_LAYOUT_MAX_WIDTH = 950;

/**
 * Узкий ли сейчас экран.
 *
 * Меряется шириной, а не типом указателя: речь о раскладке интерфейса, и порог тот же, по
 * которому стили перестраивают панели. На сенсорном ноутбуке с широким экраном мобильная
 * раскладка не нужна.
 *
 * @returns `true`, если экран уже порога.
 */
const isMobileLayout = () => typeof matchMedia === 'function' &&
    matchMedia(`(max-width: ${MOBILE_LAYOUT_MAX_WIDTH}px)`).matches;

/**
 * Масштаб пикселя в режиме SD.
 *
 * Половина стороны — четверть пикселей. На телефоне именно это даёт кадры: мультифрейм
 * работает только на неподвижной камере и на плавность вращения не влияет вовсе.
 */
const SD_PIXEL_SCALE = 2;

// Сплаты стартуют чуть мягче полного разрешения. Ступень такого размера новые фильтры вывода
// (EASU и RCAS) сглаживают заметно лучше прежней билинейной растяжки, а выигрыш в плавности
// на сплатовых сценах ощутим — они упираются в заполнение, а не в геометрию.
const SPLAT_PIXEL_SCALE = 1.5;

export { addEventListenerOnClickOnly, extract, isMobileLayout, SD_PIXEL_SCALE, SPLAT_PIXEL_SCALE };
