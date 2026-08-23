import { Mat4, MeshInstance, PRIMITIVE_TRIANGLES, SEMANTIC_POSITION, Vec3 } from 'playcanvas';

type CachedMeshGeometry = {
    positions: Float32Array;
    indices: Uint16Array | Uint32Array | null;
    vertexCount: number;
    primitives: Array<{
        base: number;
        count: number;
        baseVertex: number;
        indexed: boolean;
    }>;
};

type MeshRaycastHit = {
    t: number;
    point: Vec3;
    normal: Vec3;
};

type MeshLike = object & {
    primitive?: Array<{ type?: number; base?: number; count?: number; indexed?: boolean; baseVertex?: number }>;
    vertexBuffer?: { getNumVertices?: () => number; numVertices?: number };
    indexBuffer?: Array<{ numIndices?: number }>;
    getVertexStream?: (semantic: string, data: Float32Array) => number;
    getIndices?: (data: Uint16Array | Uint32Array) => number;
};

const getCachedMeshGeometry = (mi: MeshInstance, cache: WeakMap<object, CachedMeshGeometry | null>) => {
    const mesh = mi.mesh as MeshLike;
    if (!mesh) return null;

    const cached = cache.get(mesh);
    if (cached !== undefined) return cached;

    const primitives = (mesh.primitive ?? [])
    .filter(primitive => primitive?.type === PRIMITIVE_TRIANGLES)
    .map(primitive => ({
        base: Math.max(0, primitive.base ?? 0),
        count: Math.max(0, primitive.count ?? 0),
        baseVertex: primitive.baseVertex ?? 0,
        indexed: Boolean(primitive.indexed)
    }))
    .filter(primitive => primitive.count >= 3);
    const vertexCount = mesh.vertexBuffer?.getNumVertices?.() ?? mesh.vertexBuffer?.numVertices ?? 0;
    if (primitives.length === 0 || vertexCount <= 0 || !mesh.getVertexStream) {
        cache.set(mesh, null);
        return null;
    }

    const positions = new Float32Array(vertexCount * 3);
    if (mesh.getVertexStream(SEMANTIC_POSITION, positions) <= 0) {
        cache.set(mesh, null);
        return null;
    }

    let indices: Uint16Array | Uint32Array | null = null;
    if (primitives.some(primitive => primitive.indexed)) {
        const totalIndexCount = mesh.indexBuffer?.[0]?.numIndices ?? Math.max(...primitives.map(primitive => primitive.base + primitive.count));
        if (!totalIndexCount || !mesh.getIndices) {
            cache.set(mesh, null);
            return null;
        }
        indices = vertexCount > 65535 ? new Uint32Array(totalIndexCount) : new Uint16Array(totalIndexCount);
        if (mesh.getIndices(indices) <= 0) {
            cache.set(mesh, null);
            return null;
        }
    }

    const geometry = { positions, indices, vertexCount, primitives } satisfies CachedMeshGeometry;
    cache.set(mesh, geometry);
    return geometry;
};

const computeTriangleNormal = (a: Vec3, b: Vec3, c: Vec3) => {
    const edge1 = new Vec3().sub2(b, a);
    const edge2 = new Vec3().sub2(c, a);
    return new Vec3().cross(edge1, edge2).normalize();
};

// Пересечение считается в ЛОКАЛЬНОМ пространстве меша: луч переносится туда один раз
// обратной мировой матрицей, вместо того чтобы гнать в мир по три вершины на каждый
// треугольник. Параметр `t` от этого не меняется — направление переносится как вектор и
// НЕ нормализуется заново, поэтому `origin + t * direction` в обоих пространствах
// описывает одну и ту же точку. На доспехе (миллион треугольников) клик занимал около
// секунды на WebGL2, и весь главный поток стоял.
const invWorld = new Mat4();
const localOrigin = new Vec3();
const localDirection = new Vec3();
const worldA = new Vec3();
const worldB = new Vec3();
const worldC = new Vec3();

/**
 * Пересечь луч с треугольником (Мёллер—Трумбор) на «сырых» числах.
 *
 * Вершины передаются координатами, а не `Vec3`, чтобы в цикле по сотням тысяч
 * треугольников не рождалось по пять временных объектов на итерацию.
 *
 * @param ox - X начала луча.
 * @param oy - Y начала луча.
 * @param oz - Z начала луча.
 * @param dx - X направления луча (не нормализуется — от этого зависит масштаб `t`).
 * @param dy - Y направления луча.
 * @param dz - Z направления луча.
 * @param ax - X первой вершины.
 * @param ay - Y первой вершины.
 * @param az - Z первой вершины.
 * @param bx - X второй вершины.
 * @param by - Y второй вершины.
 * @param bz - Z второй вершины.
 * @param cx - X третьей вершины.
 * @param cy - Y третьей вершины.
 * @param cz - Z третьей вершины.
 * @returns Параметр `t` вдоль луча или `null`, если попадания нет.
 */
const intersectTriangleRaw = (
    ox: number, oy: number, oz: number,
    dx: number, dy: number, dz: number,
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number
) => {
    const epsilon = 1e-8;

    const e1x = bx - ax;
    const e1y = by - ay;
    const e1z = bz - az;
    const e2x = cx - ax;
    const e2y = cy - ay;
    const e2z = cz - az;

    const px = dy * e2z - dz * e2y;
    const py = dz * e2x - dx * e2z;
    const pz = dx * e2y - dy * e2x;

    const det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < epsilon) return null;

    const invDet = 1 / det;
    const tx = ox - ax;
    const ty = oy - ay;
    const tz = oz - az;

    const u = (tx * px + ty * py + tz * pz) * invDet;
    if (u < 0 || u > 1) return null;

    const qx = ty * e1z - tz * e1y;
    const qy = tz * e1x - tx * e1z;
    const qz = tx * e1y - ty * e1x;

    const v = (dx * qx + dy * qy + dz * qz) * invDet;
    if (v < 0 || u + v > 1) return null;

    const t = (e2x * qx + e2y * qy + e2z * qz) * invDet;
    return t >= 0 ? t : null;
};

const intersectMeshTrianglesDetailed = (
    mi: MeshInstance,
    origin: Vec3,
    direction: Vec3,
    maxDistance: number,
    cache: WeakMap<object, CachedMeshGeometry | null>
) => {
    const geometry = getCachedMeshGeometry(mi, cache);
    if (!geometry) return null;

    const world = mi.node?.getWorldTransform();
    if (!world) return null;

    invWorld.copy(world).invert();
    invWorld.transformPoint(origin, localOrigin);
    invWorld.transformVector(direction, localDirection);

    const ox = localOrigin.x;
    const oy = localOrigin.y;
    const oz = localOrigin.z;
    const dx = localDirection.x;
    const dy = localDirection.y;
    const dz = localDirection.z;

    const positions = geometry.positions;
    let bestT = Number.POSITIVE_INFINITY;
    let bestI0 = -1;
    let bestI1 = -1;
    let bestI2 = -1;

    geometry.primitives.forEach((primitive) => {
        if (primitive.indexed && !geometry.indices) return;
        for (let i = primitive.base; i + 2 < primitive.base + primitive.count; i += 3) {
            const i0 = ((primitive.indexed ? geometry.indices?.[i] : i) ?? i) + primitive.baseVertex;
            const i1 = ((primitive.indexed ? geometry.indices?.[i + 1] : i + 1) ?? (i + 1)) + primitive.baseVertex;
            const i2 = ((primitive.indexed ? geometry.indices?.[i + 2] : i + 2) ?? (i + 2)) + primitive.baseVertex;
            if (i0 < 0 || i1 < 0 || i2 < 0 || i0 >= geometry.vertexCount || i1 >= geometry.vertexCount || i2 >= geometry.vertexCount) continue;

            const a = i0 * 3;
            const b = i1 * 3;
            const c = i2 * 3;

            const t = intersectTriangleRaw(
                ox, oy, oz,
                dx, dy, dz,
                positions[a], positions[a + 1], positions[a + 2],
                positions[b], positions[b + 1], positions[b + 2],
                positions[c], positions[c + 1], positions[c + 2]
            );
            if (t == null || t > maxDistance || t >= bestT) continue;

            bestT = t;
            bestI0 = i0;
            bestI1 = i1;
            bestI2 = i2;
        }
    });

    if (bestI0 < 0) return null;

    // Наружу точка и нормаль отдаются в мировом пространстве — на них завязаны измерения
    // и точки интереса. Переводим ровно один раз, для победившего треугольника.
    worldA.set(positions[bestI0 * 3], positions[bestI0 * 3 + 1], positions[bestI0 * 3 + 2]);
    worldB.set(positions[bestI1 * 3], positions[bestI1 * 3 + 1], positions[bestI1 * 3 + 2]);
    worldC.set(positions[bestI2 * 3], positions[bestI2 * 3 + 1], positions[bestI2 * 3 + 2]);
    world.transformPoint(worldA, worldA);
    world.transformPoint(worldB, worldB);
    world.transformPoint(worldC, worldC);

    const point = origin.clone().add(direction.clone().mulScalar(bestT));
    const normal = computeTriangleNormal(worldA, worldB, worldC);
    return { t: bestT, point, normal } satisfies MeshRaycastHit;
};

const intersectMeshTriangles = (
    mi: MeshInstance,
    origin: Vec3,
    direction: Vec3,
    maxDistance: number,
    cache: WeakMap<object, CachedMeshGeometry | null>
) => {
    return intersectMeshTrianglesDetailed(mi, origin, direction, maxDistance, cache)?.t ?? null;
};

export { getCachedMeshGeometry, intersectMeshTriangles, intersectMeshTrianglesDetailed };
export type { CachedMeshGeometry, MeshRaycastHit };
