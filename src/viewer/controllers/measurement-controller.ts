import { Observer } from '@playcanvas/observer';
import { MeshInstance, PRIMITIVE_TRIANGLES, SEMANTIC_POSITION, Vec3 } from 'playcanvas';

import { Picker } from '../../picker';

const MEASURE_CLICK_DRAG_THRESHOLD = 5;

type MeasurementControllerArgs = {
    canvas: HTMLCanvasElement;
    observer: Observer;
    picker: Picker;
    getMeshInstances: () => Array<MeshInstance>;
    getPickRay: (x: number, y: number) => { origin: Vec3; direction: Vec3 };
    renderNextFrame: () => void;
};

type CachedMeshGeometry = {
    positions: Float32Array;
    indices: Uint16Array | Uint32Array | null;
    vertexCount: number;
    primitiveBase: number;
    primitiveCount: number;
    baseVertex: number;
};

class MeasurementController {
    private canvas: HTMLCanvasElement;

    private observer: Observer;

    private picker: Picker;

    private getMeshInstances: () => Array<MeshInstance>;

    private getPickRay: (x: number, y: number) => { origin: Vec3; direction: Vec3 };

    private renderNextFrame: () => void;

    private measureOverlay: HTMLDivElement | null = null;

    private measureSvgEl: SVGSVGElement | null = null;

    private measureLineEl: SVGLineElement | null = null;

    private measureStartHX: SVGLineElement | null = null;

    private measureStartVY: SVGLineElement | null = null;

    private measureEndHX: SVGLineElement | null = null;

    private measureEndVY: SVGLineElement | null = null;

    private measureLabelEl: HTMLDivElement | null = null;

    private measureClickDown: { clientX: number; clientY: number; canvasX: number; canvasY: number } | null = null;

    private measureIsPotentialClick = false;

    private measureStart: Vec3 | null = null;

    private measureEnd: Vec3 | null = null;

    private meshGeometryCache = new WeakMap<object, CachedMeshGeometry | null>();

    constructor(args: MeasurementControllerArgs) {
        this.canvas = args.canvas;
        this.observer = args.observer;
        this.picker = args.picker;
        this.getMeshInstances = args.getMeshInstances;
        this.getPickRay = args.getPickRay;
        this.renderNextFrame = args.renderNextFrame;
        this.initOverlay();
        this.bindEvents();
    }

    private initOverlay() {
        const wrapper = this.canvas.parentElement;
        if (!wrapper) return;

        this.measureOverlay = document.createElement('div');
        this.measureOverlay.className = 'measure-overlay';
        this.measureSvgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        this.measureSvgEl.setAttribute('class', 'measure-svg');
        this.measureSvgEl.style.display = 'none';

        const mkLine = (cls: string) => {
            const el = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            el.setAttribute('class', cls);
            this.measureSvgEl?.appendChild(el);
            return el;
        };
        this.measureLineEl = mkLine('measure-line');
        this.measureStartHX = mkLine('measure-cross');
        this.measureStartVY = mkLine('measure-cross');
        this.measureEndHX = mkLine('measure-cross');
        this.measureEndVY = mkLine('measure-cross');
        this.measureOverlay.appendChild(this.measureSvgEl);

        this.measureLabelEl = document.createElement('div');
        this.measureLabelEl.className = 'measure-label';
        this.measureLabelEl.style.display = 'none';
        this.measureOverlay.appendChild(this.measureLabelEl);
        wrapper.appendChild(this.measureOverlay);
    }

    private bindEvents() {
        const onMeasureMousedown = (event: MouseEvent) => {
            if (!this.observer.get('measure.enabled')) return;
            if (event.button !== 0) return;
            if (event.target !== this.canvas) return;
            const rect = this.canvas.getBoundingClientRect();
            this.measureClickDown = {
                clientX: event.clientX,
                clientY: event.clientY,
                canvasX: event.clientX - rect.left,
                canvasY: event.clientY - rect.top
            };
            this.measureIsPotentialClick = true;
        };
        const onMeasureMousemove = (event: MouseEvent) => {
            if (!this.measureIsPotentialClick || !this.measureClickDown) return;
            const dx = event.clientX - this.measureClickDown.clientX;
            const dy = event.clientY - this.measureClickDown.clientY;
            if (Math.hypot(dx, dy) > MEASURE_CLICK_DRAG_THRESHOLD) {
                this.measureIsPotentialClick = false;
            }
        };
        const onMeasureMouseup = (event: MouseEvent) => {
            if (event.button !== 0) return;
            if (this.measureIsPotentialClick && this.measureClickDown && this.observer.get('measure.enabled')) {
                this.pickAndMeasureAt(this.measureClickDown.canvasX, this.measureClickDown.canvasY);
            }
            this.measureIsPotentialClick = false;
            this.measureClickDown = null;
        };
        this.canvas.addEventListener('mousedown', onMeasureMousedown);
        document.addEventListener('mousemove', onMeasureMousemove);
        document.addEventListener('mouseup', onMeasureMouseup);
    }

    private async pickAndMeasureAt(x: number, y: number) {
        const p = this.pickSurfacePoint(x, y) ?? await this.picker.pick(x, y);
        if (!p) return;

        const waitingSecondPoint = this.observer.get('measure.pointCount') === 1;
        if (!waitingSecondPoint || !this.measureStart) {
            this.measureStart = p.clone();
            this.measureEnd = null;
            this.observer.set('measure.pointCount', 1);
            this.observer.set('measure.lastDistance', null);
            this.renderNextFrame();
            return;
        }

        this.measureEnd = p.clone();
        const rawDistance = this.measureStart.distance(this.measureEnd);
        const unitScale = Number(this.observer.get('measure.unitScale') ?? 1);
        const distanceMeters = rawDistance * (Number.isFinite(unitScale) && unitScale > 0 ? unitScale : 1);

        this.observer.set('measure.lastDistance', distanceMeters);
        this.observer.set('measure.pointCount', 0);
        this.renderNextFrame();
    }

    private getCachedMeshGeometry(mi: MeshInstance) {
        const mesh = mi.mesh as object & {
            primitive?: Array<{ type?: number; base?: number; count?: number; indexed?: boolean; baseVertex?: number }>;
            vertexBuffer?: { getNumVertices?: () => number; numVertices?: number };
            indexBuffer?: Array<{ numIndices?: number }>;
            getVertexStream?: (semantic: string, data: Float32Array) => number;
            getIndices?: (data: Uint16Array | Uint32Array) => number;
        };
        if (!mesh) return null;

        const cached = this.meshGeometryCache.get(mesh);
        if (cached !== undefined) return cached;

        const primitive = mesh.primitive?.[0];
        const vertexCount = mesh.vertexBuffer?.getNumVertices?.() ?? mesh.vertexBuffer?.numVertices ?? 0;
        if (!primitive || primitive.type !== PRIMITIVE_TRIANGLES || vertexCount <= 0 || !mesh.getVertexStream) {
            this.meshGeometryCache.set(mesh, null);
            return null;
        }

        const positions = new Float32Array(vertexCount * 3);
        if (mesh.getVertexStream(SEMANTIC_POSITION, positions) <= 0) {
            this.meshGeometryCache.set(mesh, null);
            return null;
        }

        let indices: Uint16Array | Uint32Array | null = null;
        if (primitive.indexed) {
            const totalIndexCount = mesh.indexBuffer?.[0]?.numIndices ?? ((primitive.base ?? 0) + (primitive.count ?? 0));
            if (!totalIndexCount || !mesh.getIndices) {
                this.meshGeometryCache.set(mesh, null);
                return null;
            }
            indices = vertexCount > 65535 ? new Uint32Array(totalIndexCount) : new Uint16Array(totalIndexCount);
            if (mesh.getIndices(indices) <= 0) {
                this.meshGeometryCache.set(mesh, null);
                return null;
            }
        }

        const geometry = {
            positions,
            indices,
            vertexCount,
            primitiveBase: Math.max(0, primitive.base ?? 0),
            primitiveCount: Math.max(0, primitive.count ?? 0),
            baseVertex: primitive.baseVertex ?? 0
        } satisfies CachedMeshGeometry;
        this.meshGeometryCache.set(mesh, geometry);
        return geometry;
    }

    private intersectTriangle(origin: Vec3, direction: Vec3, a: Vec3, b: Vec3, c: Vec3) {
        const epsilon = 1e-8;
        const edge1 = new Vec3().sub2(b, a);
        const edge2 = new Vec3().sub2(c, a);
        const pvec = new Vec3().cross(direction, edge2);
        const det = edge1.dot(pvec);
        if (Math.abs(det) < epsilon) return null;

        const invDet = 1 / det;
        const tvec = new Vec3().sub2(origin, a);
        const u = tvec.dot(pvec) * invDet;
        if (u < 0 || u > 1) return null;

        const qvec = new Vec3().cross(tvec, edge1);
        const v = direction.dot(qvec) * invDet;
        if (v < 0 || u + v > 1) return null;

        const t = edge2.dot(qvec) * invDet;
        return t >= 0 ? t : null;
    }

    private pickSurfacePoint(x: number, y: number) {
        const { origin, direction } = this.getPickRay(x, y);
        let bestT = Number.POSITIVE_INFINITY;
        let bestPoint: Vec3 | null = null;
        const p0 = new Vec3();
        const p1 = new Vec3();
        const p2 = new Vec3();

        this.getMeshInstances().forEach((mi) => {
            const aabb = mi.aabb;
            if (!aabb) return;

            const min = aabb.getMin();
            const max = aabb.getMax();
            let tMin = -Infinity;
            let tMax = Infinity;

            const testAxis = (originValue: number, dirValue: number, minValue: number, maxValue: number) => {
                if (Math.abs(dirValue) <= 1e-8) {
                    return originValue >= minValue && originValue <= maxValue;
                }
                const invDir = 1 / dirValue;
                let t1 = (minValue - originValue) * invDir;
                let t2 = (maxValue - originValue) * invDir;
                if (t1 > t2) {
                    const tmp = t1;
                    t1 = t2;
                    t2 = tmp;
                }
                tMin = Math.max(tMin, t1);
                tMax = Math.min(tMax, t2);
                return tMax >= tMin;
            };

            if (!testAxis(origin.x, direction.x, min.x, max.x) ||
                !testAxis(origin.y, direction.y, min.y, max.y) ||
                !testAxis(origin.z, direction.z, min.z, max.z)) {
                return;
            }

            const geometry = this.getCachedMeshGeometry(mi);
            const world = mi.node?.getWorldTransform();
            if (!geometry || !world || geometry.primitiveCount < 3) return;

            for (let i = geometry.primitiveBase; i + 2 < geometry.primitiveBase + geometry.primitiveCount; i += 3) {
                const i0 = (geometry.indices ? geometry.indices[i] : i) + geometry.baseVertex;
                const i1 = (geometry.indices ? geometry.indices[i + 1] : i + 1) + geometry.baseVertex;
                const i2 = (geometry.indices ? geometry.indices[i + 2] : i + 2) + geometry.baseVertex;
                if (i0 < 0 || i1 < 0 || i2 < 0 || i0 >= geometry.vertexCount || i1 >= geometry.vertexCount || i2 >= geometry.vertexCount) continue;

                p0.set(geometry.positions[i0 * 3], geometry.positions[i0 * 3 + 1], geometry.positions[i0 * 3 + 2]);
                p1.set(geometry.positions[i1 * 3], geometry.positions[i1 * 3 + 1], geometry.positions[i1 * 3 + 2]);
                p2.set(geometry.positions[i2 * 3], geometry.positions[i2 * 3 + 1], geometry.positions[i2 * 3 + 2]);
                world.transformPoint(p0, p0);
                world.transformPoint(p1, p1);
                world.transformPoint(p2, p2);

                const t = this.intersectTriangle(origin, direction, p0, p1, p2);
                if (t == null || t >= bestT) continue;
                bestT = t;
                bestPoint = origin.clone().add(direction.clone().mulScalar(t));
            }
        });

        return bestPoint;
    }

    private hideOverlay() {
        if (this.measureSvgEl) this.measureSvgEl.style.display = 'none';
        if (this.measureLabelEl) this.measureLabelEl.style.display = 'none';
    }

    clearMeasurement() {
        this.measureStart = null;
        this.measureEnd = null;
        this.observer.set('measure.pointCount', 0);
        this.observer.set('measure.lastDistance', null);
        this.hideOverlay();
        this.renderNextFrame();
    }

    reset() {
        this.measureStart = null;
        this.measureEnd = null;
        this.hideOverlay();
    }

    recalculateSceneSize() {
        const lastDistance = this.observer.get('measure.lastDistance') as number | null;
        const unitScale = Number(this.observer.get('measure.unitScale') ?? 1);
        const knownDistance = Number(this.observer.get('measure.knownDistance') ?? 0);
        const unit = this.observer.get('measure.unit') as 'mm' | 'cm' | 'm';
        if (lastDistance == null || lastDistance <= 0 || !Number.isFinite(unitScale) || unitScale <= 0 || !Number.isFinite(knownDistance) || knownDistance <= 0) {
            return;
        }
        const factor = unit === 'mm' ? 0.001 : unit === 'cm' ? 0.01 : 1;
        const knownDistanceMeters = knownDistance * factor;
        const rawDistance = lastDistance / unitScale;
        const newUnitScale = knownDistanceMeters / rawDistance;
        if (!Number.isFinite(newUnitScale) || newUnitScale <= 0) return;
        this.observer.set('measure.unitScale', newUnitScale);
        this.observer.set('measure.lastDistance', knownDistanceMeters);
        this.renderNextFrame();
    }

    updateOverlay(worldToScreen: (point: Vec3) => Vec3) {
        if (!this.measureStart || !this.measureSvgEl) {
            this.hideOverlay();
            return;
        }

        this.measureSvgEl.setAttribute('viewBox', `0 0 ${this.canvas.clientWidth} ${this.canvas.clientHeight}`);

        const start = worldToScreen(this.measureStart);
        const sx = start.x;
        const sy = start.y;
        const visStart = start.z > 0;

        const crossSize = 7;
        const setCross = (hx: SVGLineElement | null, vy: SVGLineElement | null, x: number, y: number, visible: boolean) => {
            if (!hx || !vy) return;
            hx.setAttribute('x1', `${x - crossSize}`);
            hx.setAttribute('y1', `${y}`);
            hx.setAttribute('x2', `${x + crossSize}`);
            hx.setAttribute('y2', `${y}`);
            vy.setAttribute('x1', `${x}`);
            vy.setAttribute('y1', `${y - crossSize}`);
            vy.setAttribute('x2', `${x}`);
            vy.setAttribute('y2', `${y + crossSize}`);
            const disp = visible ? 'block' : 'none';
            hx.style.display = disp;
            vy.style.display = disp;
        };

        setCross(this.measureStartHX, this.measureStartVY, sx, sy, visStart);

        if (!this.measureEnd) {
            if (this.measureLineEl) this.measureLineEl.style.display = 'none';
            if (this.measureEndHX) this.measureEndHX.style.display = 'none';
            if (this.measureEndVY) this.measureEndVY.style.display = 'none';
            if (this.measureLabelEl) this.measureLabelEl.style.display = 'none';
            this.measureSvgEl.style.display = visStart ? 'block' : 'none';
            return;
        }

        const end = worldToScreen(this.measureEnd);
        const ex = end.x;
        const ey = end.y;
        const visEnd = end.z > 0;
        setCross(this.measureEndHX, this.measureEndVY, ex, ey, visEnd);

        const lineVisible = visStart && visEnd;
        if (this.measureLineEl) {
            this.measureLineEl.setAttribute('x1', `${sx}`);
            this.measureLineEl.setAttribute('y1', `${sy}`);
            this.measureLineEl.setAttribute('x2', `${ex}`);
            this.measureLineEl.setAttribute('y2', `${ey}`);
            this.measureLineEl.style.display = lineVisible ? 'block' : 'none';
        }

        if (this.measureLabelEl) {
            const lastMeters = this.observer.get('measure.lastDistance') as number | null;
            if (Number.isFinite(lastMeters) && lineVisible) {
                const unit = this.observer.get('measure.unit') as 'mm' | 'cm' | 'm';
                const factor = unit === 'mm' ? 1000 : (unit === 'cm' ? 100 : 1);
                const precision = unit === 'mm' ? 0 : 2;
                this.measureLabelEl.textContent = `${(lastMeters * factor).toFixed(precision)} ${unit}`;
                this.measureLabelEl.style.left = `${(sx + ex) * 0.5}px`;
                this.measureLabelEl.style.top = `${(sy + ey) * 0.5}px`;
                this.measureLabelEl.style.display = 'block';
            } else {
                this.measureLabelEl.style.display = 'none';
            }
        }

        this.measureSvgEl.style.display = lineVisible || visStart ? 'block' : 'none';
    }
}

export { MeasurementController };
