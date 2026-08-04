/**
 * Геометрия тайлов: габариты, расстояния, экранная ошибка.
 *
 * Все величины считаются в МИРОВЫХ координатах вьюера. Это сознательный выбор: в тайлсете
 * своя система (Z-вверх, у больших наборов — ECEF с координатами порядка 6.4e6), и если
 * считать расстояния там, а рисовать здесь, любые несовпадения масштаба сцены дадут
 * неверный LOD. Поэтому габариты и геометрическая ошибка один раз пересчитываются в мир,
 * а дальше вся математика однородна.
 */

import { BoundingSphere, Mat4, Vec3 } from 'playcanvas';

import type { TileBoundingVolumeJson, WorldObb } from './tile-types';

const tmpVecA = new Vec3();
const tmpVecB = new Vec3();

/**
 * Максимальный масштаб, который вносит матрица. Нужен для двух вещей: перевести
 * геометрическую ошибку тайла в мировые единицы и раздуть радиус описанной сферы.
 *
 * @param m - Матрица.
 * @returns Наибольшая из длин трёх базисных векторов.
 */
export function maxScaleOfMat4(m: Mat4): number {
    const d = m.data;
    const sx = Math.hypot(d[0], d[1], d[2]);
    const sy = Math.hypot(d[4], d[5], d[6]);
    const sz = Math.hypot(d[8], d[9], d[10]);
    return Math.max(sx, sy, sz);
}

/**
 * Построить мировой OBB из bounding volume тайла.
 *
 * `box` в 3D Tiles — это центр и три полуоси, которые не обязаны быть ортогональными;
 * `sphere` разворачивается в куб с полуосями по радиусу, чтобы дальше работал один код.
 *
 * @param json - Bounding volume из tileset.json.
 * @param worldMatrix - Полная трансформация тайла, включая трансформацию сцены.
 * @returns Габариты в мировых координатах или `null`, если объём не поддержан (`region`).
 */
export function makeWorldObb(json: TileBoundingVolumeJson, worldMatrix: Mat4): WorldObb | null {
    let center: Vec3;
    let halfAxes: [Vec3, Vec3, Vec3];

    if (json.box && json.box.length >= 12) {
        const b = json.box;
        center = new Vec3(b[0], b[1], b[2]);
        halfAxes = [
            new Vec3(b[3], b[4], b[5]),
            new Vec3(b[6], b[7], b[8]),
            new Vec3(b[9], b[10], b[11])
        ];
    } else if (json.sphere && json.sphere.length >= 4) {
        const s = json.sphere;
        const r = s[3];
        center = new Vec3(s[0], s[1], s[2]);
        halfAxes = [new Vec3(r, 0, 0), new Vec3(0, r, 0), new Vec3(0, 0, r)];
    } else {
        // `region` (географический объём) и всё незнакомое.
        return null;
    }

    worldMatrix.transformPoint(center, center);
    halfAxes.forEach(axis => worldMatrix.transformVector(axis, axis));

    // Описанная сфера: полусумма длин полуосей — верхняя оценка расстояния от центра до
    // любого угла ящика (для ортогональных осей это ровно длина диагонали).
    const radius = halfAxes[0].length() + halfAxes[1].length() + halfAxes[2].length();
    return {
        center,
        halfAxes,
        sphere: new BoundingSphere(center.clone(), radius)
    };
}

/**
 * Расстояние от точки до ближайшей точки OBB (0, если точка внутри).
 *
 * Именно расстояние до ближайшей точки, а не до центра: у крупного тайла центр может быть
 * в сотнях метров, пока камера стоит вплотную к его краю, и по центру LOD выбирался бы
 * слишком грубым. Так же считает 3DTilesRendererJS.
 *
 * Для неортогональных полуосей результат приближённый — проекции на оси считаются
 * независимо. На практике `box` в тайлсетах почти всегда ортогонален.
 *
 * @param obb - Габариты.
 * @param point - Точка (обычно позиция камеры).
 * @returns Расстояние в мировых единицах.
 */
export function distanceToObb(obb: WorldObb, point: Vec3): number {
    tmpVecA.sub2(point, obb.center);

    // Смещение от центра к ближайшей точке ящика.
    tmpVecB.set(0, 0, 0);
    for (let i = 0; i < 3; ++i) {
        const axis = obb.halfAxes[i];
        const extent = axis.length();
        if (extent < 1e-12) {
            continue;
        }
        const dir = axis.clone().mulScalar(1 / extent);
        const proj = tmpVecA.dot(dir);
        const clamped = Math.max(-extent, Math.min(extent, proj));
        tmpVecB.add(dir.mulScalar(clamped));
    }

    return tmpVecB.sub(tmpVecA).length();
}

/**
 * Экранная ошибка тайла в пикселях.
 *
 * `SSE = geometricError * viewportHeight / (distance * 2 * tan(fovY / 2))`
 *
 * Смысл: сколько пикселей на экране занимает погрешность геометрии этого уровня. Пока она
 * больше порога, тайл нужно уточнять детьми.
 *
 * @param geometricError - Геометрическая ошибка в мировых единицах.
 * @param distance - Расстояние до ближайшей точки габаритов.
 * @param sseDenominator - `2 * tan(fovY / 2)`, считается один раз на кадр.
 * @param viewportHeight - Высота вьюпорта в пикселях.
 * @returns Ошибка в пикселях; `Infinity`, если камера внутри габаритов.
 */
export function screenSpaceError(
    geometricError: number,
    distance: number,
    sseDenominator: number,
    viewportHeight: number
): number {
    if (geometricError <= 0) {
        return 0;
    }
    if (distance <= 1e-6) {
        return Infinity;
    }
    return (geometricError * viewportHeight) / (distance * sseDenominator);
}
