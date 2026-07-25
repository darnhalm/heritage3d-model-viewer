import { Observer } from '@playcanvas/observer';
import { MeshInstance, Vec3 } from 'playcanvas';

import { CachedMeshGeometry, intersectMeshTrianglesDetailed } from './mesh-raycast';
import { Picker } from '../../picker';

const MEASURE_CLICK_DRAG_THRESHOLD = 5;
const AREA_CLOSE_HIT_RADIUS = 16;
type ViewerTaggedMeshInstance = MeshInstance & { __viewerIsGsplat?: boolean };
type MeasureMode = 'distance' | 'angle' | 'area';
type ScreenPoint = { x: number; y: number; z: number };
type StoredMeasurement = {
    id: number;
    mode: MeasureMode;
    points: Vec3[];
    distance?: number;
    angle?: number;
    area?: number;
    areaPlanarity?: number;
};

const MODE_POINT_COUNT: Record<Exclude<MeasureMode, 'area'>, 2 | 3> = {
    distance: 2,
    angle: 3
};

type MeasurementControllerArgs = {
    canvas: HTMLCanvasElement;
    observer: Observer;
    picker: Picker;
    getMeshInstances: () => Array<MeshInstance>;
    getPickRay: (x: number, y: number) => { origin: Vec3; direction: Vec3 };
    renderNextFrame: () => void;
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

    private completedMeasureGroupEl: SVGGElement | null = null;

    /** One cross (two lines) per picked point. */
    private measureCrosses: Array<{ hx: SVGLineElement; vy: SVGLineElement }> = [];

    /** Invisible-ish hit circles for dragging each point. */
    private measureHandles: SVGCircleElement[] = [];

    /** Polyline drawing edges between consecutive picked points (closed for area). */
    private measurePolylineEl: SVGPolylineElement | null = null;

    /** Filled polygon for area mode. */
    private measurePolygonEl: SVGPolygonElement | null = null;

    private measureLabelEl: HTMLDivElement | null = null;

    /** Per-edge length labels. */
    private measureEdgeLabels: HTMLDivElement[] = [];

    private completedMeasureLabels: HTMLDivElement[] = [];

    private completedMeasurements: StoredMeasurement[] = [];

    private nextMeasurementId = 1;

    private measureClickDown: { clientX: number; clientY: number; canvasX: number; canvasY: number } | null = null;

    private measureIsPotentialClick = false;

    /** World-space positions of picked points in order of picking. */
    private points: Vec3[] = [];

    private lastScreenPoints: Array<{ x: number; y: number; z: number }> = [];

    /** Index of the currently dragged point (null when not dragging). */
    private dragIndex: number | null = null;

    private meshGeometryCache = new WeakMap<object, CachedMeshGeometry | null>();

    private onMeasureMousedown: ((event: MouseEvent) => void) | null = null;

    private onMeasureMousemove: ((event: MouseEvent) => void) | null = null;

    private onMeasureMouseup: ((event: MouseEvent) => void) | null = null;

    private onMeasureDblClick: ((event: MouseEvent) => void) | null = null;

    private onHandlePointerMove: ((event: PointerEvent) => void) | null = null;

    private onHandlePointerUp: ((event: PointerEvent) => void) | null = null;

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

        this.completedMeasureGroupEl = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        this.completedMeasureGroupEl.setAttribute('class', 'measure-completed-group');
        this.measureSvgEl.appendChild(this.completedMeasureGroupEl);

        // Polygon first so crosses render on top.
        this.measurePolygonEl = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        this.measurePolygonEl.setAttribute('class', 'measure-polygon');
        this.measurePolygonEl.style.display = 'none';
        this.measureSvgEl.appendChild(this.measurePolygonEl);

        this.measurePolylineEl = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
        this.measurePolylineEl.setAttribute('class', 'measure-line');
        this.measurePolylineEl.setAttribute('fill', 'none');
        this.measurePolylineEl.style.display = 'none';
        this.measureSvgEl.appendChild(this.measurePolylineEl);

        this.measureOverlay.appendChild(this.measureSvgEl);

        this.measureLabelEl = document.createElement('div');
        this.measureLabelEl.className = 'measure-label';
        this.measureLabelEl.style.display = 'none';
        this.measureOverlay.appendChild(this.measureLabelEl);

        wrapper.appendChild(this.measureOverlay);
    }

    private createMeasureCross() {
        const mkLine = (cls: string) => {
            const el = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            el.setAttribute('class', cls);
            this.measureSvgEl?.appendChild(el);
            return el;
        };
        this.measureCrosses.push({
            hx: mkLine('measure-cross'),
            vy: mkLine('measure-cross')
        });
    }

    private createMeasureHandle(index: number) {
        if (!this.measureSvgEl) return;
        const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        c.setAttribute('class', 'measure-handle');
        c.setAttribute('r', '12');
        c.style.display = 'none';
        c.addEventListener('pointerdown', (e: PointerEvent) => this.beginHandleDrag(e, index));
        this.measureSvgEl.appendChild(c);
        this.measureHandles.push(c);
    }

    private createMeasureEdgeLabel() {
        if (!this.measureOverlay) return;
        const el = document.createElement('div');
        el.className = 'measure-edge-label';
        el.style.display = 'none';
        this.measureOverlay.appendChild(el);
        this.measureEdgeLabels.push(el);
    }

    private ensureMeasureElements(count: number) {
        while (this.measureCrosses.length < count) {
            this.createMeasureCross();
        }
        while (this.measureHandles.length < count) {
            this.createMeasureHandle(this.measureHandles.length);
        }
        while (this.measureEdgeLabels.length < count) {
            this.createMeasureEdgeLabel();
        }
    }

    private bindEvents() {
        this.onMeasureMousedown = (event: MouseEvent) => {
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
        this.onMeasureMousemove = (event: MouseEvent) => {
            if (!this.measureIsPotentialClick || !this.measureClickDown) return;
            const dx = event.clientX - this.measureClickDown.clientX;
            const dy = event.clientY - this.measureClickDown.clientY;
            if (Math.hypot(dx, dy) > MEASURE_CLICK_DRAG_THRESHOLD) {
                this.measureIsPotentialClick = false;
            }
        };
        this.onMeasureMouseup = (event: MouseEvent) => {
            if (event.button !== 0) return;
            if (this.measureIsPotentialClick && this.measureClickDown && this.observer.get('measure.enabled')) {
                this.pickAndMeasureAt(this.measureClickDown.canvasX, this.measureClickDown.canvasY);
            }
            this.measureIsPotentialClick = false;
            this.measureClickDown = null;
        };
        this.onMeasureDblClick = (event: MouseEvent) => {
            if (!this.observer.get('measure.enabled')) return;
            if (event.button !== 0) return;
            if (event.target !== this.canvas) return;
            if (this.getMode() !== 'area' || this.points.length < 3) return;
            event.preventDefault();
            this.closeAreaMeasurement();
        };
        this.canvas.addEventListener('mousedown', this.onMeasureMousedown);
        this.canvas.addEventListener('dblclick', this.onMeasureDblClick);
        document.addEventListener('mousemove', this.onMeasureMousemove);
        document.addEventListener('mouseup', this.onMeasureMouseup);

        this.onHandlePointerMove = (e: PointerEvent) => this.updateHandleDrag(e);
        this.onHandlePointerUp = (e: PointerEvent) => this.endHandleDrag(e);
        document.addEventListener('pointermove', this.onHandlePointerMove);
        document.addEventListener('pointerup', this.onHandlePointerUp);
        document.addEventListener('pointercancel', this.onHandlePointerUp);
    }

    private beginHandleDrag(event: PointerEvent, index: number) {
        if (!this.observer.get('measure.enabled')) return;
        if (event.button !== 0) return;
        if (index < 0 || index >= this.points.length) return;
        event.preventDefault();
        event.stopPropagation();
        if (this.getMode() === 'area' && index === 0 && this.observer.get('measure.pointCount') !== 0 && this.points.length >= 3) {
            this.closeAreaMeasurement();
            return;
        }
        this.dragIndex = index;
        // Don't let the canvas mousedown/mouseup path treat this as a fresh click.
        this.measureIsPotentialClick = false;
        this.measureClickDown = null;
        const target = event.target as SVGCircleElement | null;
        try {
            target?.setPointerCapture?.(event.pointerId);
        } catch {
            // ignore — capture is best-effort
        }
        target?.classList.add('dragging');
    }

    private updateHandleDrag(event: PointerEvent) {
        if (this.dragIndex === null) return;
        const idx = this.dragIndex;
        if (idx >= this.points.length) {
            this.dragIndex = null;
            return;
        }
        const rect = this.canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        if (x < 0 || y < 0 || x > rect.width || y > rect.height) return;
        // Synchronous raycast only — async picker.pick would queue many rounds per drag.
        const hit = this.pickSurfacePoint(x, y);
        if (!hit) return;
        this.points[idx] = hit.clone();
        // If the measurement is already complete for the current mode, re-finalize live.
        const mode = this.getMode();
        if ((mode === 'area' && this.isAreaComplete()) || (mode !== 'area' && this.points.length === MODE_POINT_COUNT[mode])) {
            this.finalizeMeasurement(mode);
        }
        this.renderNextFrame();
    }

    private endHandleDrag(event: PointerEvent) {
        if (this.dragIndex === null) return;
        const handle = this.measureHandles[this.dragIndex];
        try {
            handle?.releasePointerCapture?.(event.pointerId);
        } catch {
            // ignore — release is best-effort
        }
        handle?.classList.remove('dragging');
        this.dragIndex = null;
    }

    dispose() {
        if (this.onMeasureMousedown) {
            this.canvas.removeEventListener('mousedown', this.onMeasureMousedown);
            this.onMeasureMousedown = null;
        }
        if (this.onMeasureMousemove) {
            document.removeEventListener('mousemove', this.onMeasureMousemove);
            this.onMeasureMousemove = null;
        }
        if (this.onMeasureMouseup) {
            document.removeEventListener('mouseup', this.onMeasureMouseup);
            this.onMeasureMouseup = null;
        }
        if (this.onMeasureDblClick) {
            this.canvas.removeEventListener('dblclick', this.onMeasureDblClick);
            this.onMeasureDblClick = null;
        }
        if (this.onHandlePointerMove) {
            document.removeEventListener('pointermove', this.onHandlePointerMove);
            this.onHandlePointerMove = null;
        }
        if (this.onHandlePointerUp) {
            document.removeEventListener('pointerup', this.onHandlePointerUp);
            document.removeEventListener('pointercancel', this.onHandlePointerUp);
            this.onHandlePointerUp = null;
        }
        this.measureOverlay?.remove();
        this.measureOverlay = null;
        this.measureSvgEl = null;
        this.completedMeasureGroupEl = null;
        this.measureCrosses = [];
        this.measureHandles = [];
        this.measurePolylineEl = null;
        this.measurePolygonEl = null;
        this.measureLabelEl = null;
        this.measureEdgeLabels = [];
        this.completedMeasureLabels = [];
        this.completedMeasurements = [];
    }

    private getMode(): MeasureMode {
        const raw = this.observer.get('measure.mode');
        if (raw === 'angle' || raw === 'area') return raw;
        return 'distance';
    }

    private async pickAndMeasureAt(x: number, y: number) {
        const mode = this.getMode();
        if (mode === 'area' && this.observer.get('measure.pointCount') !== 0 && this.points.length >= 3 && this.isNearFirstPoint(x, y)) {
            this.closeAreaMeasurement();
            return;
        }

        const p = this.pickSurfacePoint(x, y) ?? await this.picker.pick(x, y);
        if (!p) return;

        // Start a new draft after each completed measurement.
        if (this.observer.get('measure.pointCount') === 0) {
            this.points = [];
        }

        this.points.push(p.clone());

        if (mode === 'area') {
            this.observer.set('measure.pointCount', this.points.length);
            this.observer.set('measure.lastArea', null);
            this.observer.set('measure.areaPlanarity', null);
            this.observer.set('measure.lastDistance', null);
            this.observer.set('measure.lastAngle', null);
            this.renderNextFrame();
            return;
        }

        const needed = MODE_POINT_COUNT[mode];
        if (this.points.length < needed) {
            this.observer.set('measure.pointCount', this.points.length);
            this.renderNextFrame();
            return;
        }
        // Measurement complete.
        this.completeMeasurement(mode);
        this.observer.set('measure.pointCount', 0);
        this.renderNextFrame();
    }

    private isNearFirstPoint(x: number, y: number) {
        const first = this.lastScreenPoints[0];
        return !!first && first.z > 0 && Math.hypot(first.x - x, first.y - y) <= AREA_CLOSE_HIT_RADIUS;
    }

    private isAreaComplete() {
        return this.getMode() === 'area' &&
            this.points.length >= 3 &&
            this.observer.get('measure.pointCount') === 0 &&
            this.observer.get('measure.lastArea') !== null;
    }

    private closeAreaMeasurement() {
        if (this.getMode() !== 'area' || this.points.length < 3) return;
        this.completeMeasurement('area');
        this.observer.set('measure.pointCount', 0);
        this.renderNextFrame();
    }

    private completeMeasurement(mode: MeasureMode) {
        const result = this.finalizeMeasurement(mode);
        if (mode === 'distance' && this.isKnownDistanceSet()) {
            const hadDistanceMeasurement = this.completedMeasurements.some(measurement => measurement.mode === 'distance');
            this.observer.set('measure.knownDistanceWarning', hadDistanceMeasurement);
            this.completedMeasurements = this.completedMeasurements.filter(measurement => measurement.mode !== 'distance');
        } else if (mode === 'distance') {
            this.observer.set('measure.knownDistanceWarning', false);
        }
        this.completedMeasurements.push({
            id: this.nextMeasurementId++,
            mode,
            points: this.points.map(p => p.clone()),
            ...result
        });
        this.points = [];
    }

    private isKnownDistanceSet() {
        const knownDistance = Number(this.observer.get('measure.knownDistance') ?? 0);
        return Number.isFinite(knownDistance) && knownDistance > 0;
    }

    private finalizeMeasurement(mode: MeasureMode) {
        const unitScale = Number(this.observer.get('measure.unitScale') ?? 1);
        const scale = Number.isFinite(unitScale) && unitScale > 0 ? unitScale : 1;

        switch (mode) {
            case 'distance': {
                const [a, b] = this.points;
                const d = a.distance(b) * scale;
                this.observer.set('measure.lastDistance', d);
                this.observer.set('measure.lastAngle', null);
                this.observer.set('measure.lastArea', null);
                this.observer.set('measure.areaPlanarity', null);
                return { distance: d };
            }
            case 'angle': {
                const [a, vertex, b] = this.points;
                const v1 = new Vec3(a.x - vertex.x, a.y - vertex.y, a.z - vertex.z);
                const v2 = new Vec3(b.x - vertex.x, b.y - vertex.y, b.z - vertex.z);
                const l1 = v1.length();
                const l2 = v2.length();
                let deg = 0;
                if (l1 > 0 && l2 > 0) {
                    const cos = Math.max(-1, Math.min(1, (v1.x * v2.x + v1.y * v2.y + v1.z * v2.z) / (l1 * l2)));
                    deg = Math.acos(cos) * 180 / Math.PI;
                }
                this.observer.set('measure.lastAngle', deg);
                this.observer.set('measure.lastDistance', null);
                this.observer.set('measure.lastArea', null);
                this.observer.set('measure.areaPlanarity', null);
                return { angle: deg };
            }
            case 'area': {
                const { area, maxDeviation } = this.computeArea(this.points);
                const scaledArea = area * scale * scale;
                const scaledPlanarity = maxDeviation * scale;
                this.observer.set('measure.lastArea', scaledArea);
                this.observer.set('measure.areaPlanarity', scaledPlanarity);
                this.observer.set('measure.lastDistance', null);
                this.observer.set('measure.lastAngle', null);
                return { area: scaledArea, areaPlanarity: scaledPlanarity };
            }
        }
    }

    /**
     * Projects points onto their best-fit plane (via covariance eigenvectors) and
     * returns the projected polygon area plus the maximum out-of-plane deviation
     * (in unscaled scene units). Works for any simple, non-self-intersecting order
     * of picks.
     *
     * @param pts - Picked world-space points.
     * @returns Area in squared scene units and max out-of-plane deviation in scene units.
     */
    private computeArea(pts: Vec3[]) {
        if (pts.length < 3) return { area: 0, maxDeviation: 0 };

        // Centroid.
        let cx = 0;
        let cy = 0;
        let cz = 0;
        for (const p of pts) {
            cx += p.x;
            cy += p.y;
            cz += p.z;
        }
        cx /= pts.length;
        cy /= pts.length;
        cz /= pts.length;

        // Covariance matrix (3x3 symmetric).
        let xx = 0;
        let xy = 0;
        let xz = 0;
        let yy = 0;
        let yz = 0;
        let zz = 0;
        for (const p of pts) {
            const dx = p.x - cx;
            const dy = p.y - cy;
            const dz = p.z - cz;
            xx += dx * dx;
            xy += dx * dy;
            xz += dx * dz;
            yy += dy * dy;
            yz += dy * dz;
            zz += dz * dz;
        }

        // Plane normal = eigenvector of smallest eigenvalue. Cheap robust
        // approximation: cross the two axes with largest spread.
        const row0 = { x: xx, y: xy, z: xz };
        const row1 = { x: xy, y: yy, z: yz };
        const row2 = { x: xz, y: yz, z: zz };
        // Determinants of pairwise rows give candidate normals; pick the longest.
        const cross = (a: typeof row0, b: typeof row0) => ({
            x: a.y * b.z - a.z * b.y,
            y: a.z * b.x - a.x * b.z,
            z: a.x * b.y - a.y * b.x
        });
        const len2 = (v: typeof row0) => v.x * v.x + v.y * v.y + v.z * v.z;
        const candidates = [cross(row0, row1), cross(row1, row2), cross(row0, row2)];
        let normal = candidates[0];
        for (const c of candidates) {
            if (len2(c) > len2(normal)) normal = c;
        }
        const nLen = Math.sqrt(len2(normal));
        if (nLen < 1e-12) {
            // Degenerate — all points collinear. Area is 0, deviation irrelevant.
            return { area: 0, maxDeviation: 0 };
        }
        const nx = normal.x / nLen;
        const ny = normal.y / nLen;
        const nz = normal.z / nLen;

        // Build in-plane basis (u, v).
        const refX = Math.abs(nx) < 0.9 ? 1 : 0;
        const refY = Math.abs(nx) < 0.9 ? 0 : 1;
        const refZ = 0;
        let ux = ny * refZ - nz * refY;
        let uy = nz * refX - nx * refZ;
        let uz = nx * refY - ny * refX;
        const uLen = Math.sqrt(ux * ux + uy * uy + uz * uz) || 1;
        ux /= uLen; uy /= uLen; uz /= uLen;
        const vx = ny * uz - nz * uy;
        const vy = nz * ux - nx * uz;
        const vz = nx * uy - ny * ux;

        // Project onto plane and track deviation.
        const flat: Array<[number, number]> = [];
        let maxDeviation = 0;
        for (const p of pts) {
            const dx = p.x - cx;
            const dy = p.y - cy;
            const dz = p.z - cz;
            const u = dx * ux + dy * uy + dz * uz;
            const v = dx * vx + dy * vy + dz * vz;
            const dist = Math.abs(dx * nx + dy * ny + dz * nz);
            if (dist > maxDeviation) maxDeviation = dist;
            flat.push([u, v]);
        }

        // Shoelace on (possibly reordered) polygon. Pick order matches click order,
        // which already matches the spec: "area by 4 points".
        let sum = 0;
        for (let i = 0; i < flat.length; i++) {
            const [x1, y1] = flat[i];
            const [x2, y2] = flat[(i + 1) % flat.length];
            sum += x1 * y2 - x2 * y1;
        }
        const area = Math.abs(sum) * 0.5;
        return { area, maxDeviation };
    }

    private pickSurfacePoint(x: number, y: number) {
        const { origin, direction } = this.getPickRay(x, y);
        let bestT = Number.POSITIVE_INFINITY;
        let bestPoint: Vec3 | null = null;

        this.getMeshInstances().forEach((mi) => {
            if ((mi as ViewerTaggedMeshInstance).__viewerIsGsplat) return;
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

            const hit = intersectMeshTrianglesDetailed(mi, origin, direction, bestT, this.meshGeometryCache);
            if (!hit || hit.t >= bestT) return;
            bestT = hit.t;
            bestPoint = hit.point.clone();
        });

        return bestPoint;
    }

    private hideOverlay() {
        if (this.measureSvgEl) this.measureSvgEl.style.display = 'none';
        if (this.measureLabelEl) this.measureLabelEl.style.display = 'none';
        for (const el of this.measureEdgeLabels) el.style.display = 'none';
        for (const el of this.completedMeasureLabels) el.style.display = 'none';
    }

    clearMeasurement() {
        this.cancelDraft();
        this.completedMeasurements = [];
        this.completedMeasureGroupEl?.replaceChildren();
        for (const el of this.completedMeasureLabels) el.remove();
        this.completedMeasureLabels = [];
        this.hideOverlay();
        this.renderNextFrame();
    }

    cancelDraft() {
        this.points = [];
        this.observer.set('measure.pointCount', 0);
        this.observer.set('measure.lastDistance', null);
        this.observer.set('measure.lastAngle', null);
        this.observer.set('measure.lastArea', null);
        this.observer.set('measure.areaPlanarity', null);
        this.observer.set('measure.knownDistanceWarning', false);
        this.renderNextFrame();
    }

    reset() {
        this.points = [];
        this.completedMeasurements = [];
        this.completedMeasureGroupEl?.replaceChildren();
        for (const el of this.completedMeasureLabels) el.remove();
        this.completedMeasureLabels = [];
        this.hideOverlay();
    }

    limitToLatestKnownDistanceSegment() {
        if (!this.isKnownDistanceSet()) {
            this.observer.set('measure.knownDistanceWarning', false);
            return;
        }
        let latestDistance: StoredMeasurement | null = null;
        const otherMeasurements: StoredMeasurement[] = [];
        let distanceCount = 0;
        for (const measurement of this.completedMeasurements) {
            if (measurement.mode === 'distance') {
                distanceCount++;
                latestDistance = measurement;
            } else {
                otherMeasurements.push(measurement);
            }
        }
        this.observer.set('measure.knownDistanceWarning', distanceCount > 1);
        this.completedMeasurements = latestDistance ? [...otherMeasurements, latestDistance] : otherMeasurements;
        this.renderNextFrame();
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
        if (!this.observer.get('measure.enabled')) {
            this.hideOverlay();
            return;
        }

        if ((this.points.length === 0 && this.completedMeasurements.length === 0) || !this.measureSvgEl) {
            this.hideOverlay();
            return;
        }

        this.measureSvgEl.setAttribute('viewBox', `0 0 ${this.canvas.clientWidth} ${this.canvas.clientHeight}`);
        this.renderCompletedMeasurements(worldToScreen);

        if (this.points.length === 0) {
            this.hideActiveMeasurement();
            this.measureSvgEl.style.display = 'block';
            return;
        }

        const mode = this.getMode();
        const screen = this.points.map(p => worldToScreen(p));
        this.lastScreenPoints = screen;
        this.ensureMeasureElements(screen.length);
        const visible = screen.map(s => s.z > 0);
        const allVis = visible.every(Boolean);
        const areaComplete = this.isAreaComplete();

        // Crosses for each picked point.
        const crossSize = 7;
        for (let i = 0; i < this.measureCrosses.length; i++) {
            const cross = this.measureCrosses[i];
            const handle = this.measureHandles[i];
            if (i < screen.length) {
                const { x, y } = screen[i];
                cross.hx.setAttribute('x1', `${x - crossSize}`);
                cross.hx.setAttribute('y1', `${y}`);
                cross.hx.setAttribute('x2', `${x + crossSize}`);
                cross.hx.setAttribute('y2', `${y}`);
                cross.vy.setAttribute('x1', `${x}`);
                cross.vy.setAttribute('y1', `${y - crossSize}`);
                cross.vy.setAttribute('x2', `${x}`);
                cross.vy.setAttribute('y2', `${y + crossSize}`);
                const disp = visible[i] ? 'block' : 'none';
                cross.hx.style.display = disp;
                cross.vy.style.display = disp;
                if (handle) {
                    handle.setAttribute('cx', `${x}`);
                    handle.setAttribute('cy', `${y}`);
                    handle.style.display = disp;
                }
            } else {
                cross.hx.style.display = 'none';
                cross.vy.style.display = 'none';
                if (handle) handle.style.display = 'none';
            }
        }

        // Polyline/polygon between points.
        const pointsStr = screen.map(s => `${s.x},${s.y}`).join(' ');
        if (this.measurePolylineEl) {
            if (mode === 'area' && screen.length >= 2 && !areaComplete) {
                // In-progress area: show polyline.
                this.measurePolylineEl.setAttribute('points', pointsStr);
                this.measurePolylineEl.style.display = allVis ? 'block' : 'none';
            } else if (mode !== 'area' && screen.length >= 2) {
                this.measurePolylineEl.setAttribute('points', pointsStr);
                this.measurePolylineEl.style.display = allVis ? 'block' : 'none';
            } else {
                this.measurePolylineEl.style.display = 'none';
            }
        }
        if (this.measurePolygonEl) {
            if (mode === 'area' && areaComplete) {
                this.measurePolygonEl.setAttribute('points', pointsStr);
                this.measurePolygonEl.style.display = allVis ? 'block' : 'none';
            } else {
                this.measurePolygonEl.style.display = 'none';
            }
        }

        // Label.
        if (this.measureLabelEl) {
            const text = this.buildLabel(mode, allVis);
            if (text && screen.length >= 2 && allVis) {
                // Position at centroid of drawn points.
                let sx = 0;
                let sy = 0;
                for (const s of screen) {
                    sx += s.x;
                    sy += s.y;
                }
                sx /= screen.length;
                sy /= screen.length;
                this.measureLabelEl.textContent = text;
                this.measureLabelEl.style.left = `${sx}px`;
                this.measureLabelEl.style.top = `${sy}px`;
                this.measureLabelEl.style.display = 'block';
            } else {
                this.measureLabelEl.style.display = 'none';
            }
        }

        // Per-edge length labels (area mode only).
        this.renderEdgeLabels(mode, screen, visible);

        this.measureSvgEl.style.display = 'block';
    }

    private hideActiveMeasurement() {
        for (let i = 0; i < this.measureCrosses.length; i++) {
            this.measureCrosses[i].hx.style.display = 'none';
            this.measureCrosses[i].vy.style.display = 'none';
            if (this.measureHandles[i]) this.measureHandles[i].style.display = 'none';
        }
        if (this.measurePolylineEl) this.measurePolylineEl.style.display = 'none';
        if (this.measurePolygonEl) this.measurePolygonEl.style.display = 'none';
        if (this.measureLabelEl) this.measureLabelEl.style.display = 'none';
        for (const el of this.measureEdgeLabels) el.style.display = 'none';
        this.lastScreenPoints = [];
    }

    private renderCompletedMeasurements(worldToScreen: (point: Vec3) => Vec3) {
        if (!this.completedMeasureGroupEl || !this.measureOverlay) return;

        this.completedMeasureGroupEl.replaceChildren();
        for (const el of this.completedMeasureLabels) el.remove();
        this.completedMeasureLabels = [];

        for (const measurement of this.completedMeasurements) {
            const screen = measurement.points.map(p => worldToScreen(p));
            const visible = screen.map(s => s.z > 0);
            const allVis = visible.every(Boolean);
            if (!allVis || screen.length < 2) continue;

            if (measurement.mode === 'area' && screen.length >= 3) {
                const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
                polygon.setAttribute('class', 'measure-polygon measure-completed');
                polygon.setAttribute('points', this.screenPointsToSvg(screen));
                this.completedMeasureGroupEl.appendChild(polygon);
            } else {
                const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
                polyline.setAttribute('class', 'measure-line measure-completed');
                polyline.setAttribute('fill', 'none');
                polyline.setAttribute('points', this.screenPointsToSvg(screen));
                this.completedMeasureGroupEl.appendChild(polyline);
            }

            const crossSize = 6;
            for (const point of screen) {
                const hx = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                hx.setAttribute('class', 'measure-cross measure-completed-cross');
                hx.setAttribute('x1', `${point.x - crossSize}`);
                hx.setAttribute('y1', `${point.y}`);
                hx.setAttribute('x2', `${point.x + crossSize}`);
                hx.setAttribute('y2', `${point.y}`);
                this.completedMeasureGroupEl.appendChild(hx);

                const vy = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                vy.setAttribute('class', 'measure-cross measure-completed-cross');
                vy.setAttribute('x1', `${point.x}`);
                vy.setAttribute('y1', `${point.y - crossSize}`);
                vy.setAttribute('x2', `${point.x}`);
                vy.setAttribute('y2', `${point.y + crossSize}`);
                this.completedMeasureGroupEl.appendChild(vy);
            }

            if (measurement.mode === 'area') {
                this.renderStoredEdgeLabels(measurement, screen, visible);
            }

            const label = this.createCompletedMeasureLabel();
            const text = this.buildStoredLabel(measurement);
            if (!text) {
                label.style.display = 'none';
                continue;
            }
            const center = this.getScreenCentroid(screen);
            label.textContent = text;
            label.style.left = `${center.x}px`;
            label.style.top = `${center.y}px`;
            label.style.display = 'block';
        }
    }

    private renderStoredEdgeLabels(measurement: StoredMeasurement, screen: ScreenPoint[], visible: boolean[]) {
        if (!this.measureOverlay || measurement.points.length < 2) return;
        const unit = this.observer.get('measure.unit') as 'mm' | 'cm' | 'm';
        const factor = unit === 'mm' ? 1000 : (unit === 'cm' ? 100 : 1);
        const precision = unit === 'mm' ? 0 : 2;
        const n = measurement.points.length;
        for (let i = 0; i < n; i++) {
            const a = measurement.points[i];
            const b = measurement.points[(i + 1) % n];
            const sa = screen[i];
            const sb = screen[(i + 1) % n];
            if (!visible[i] || !visible[(i + 1) % n]) continue;
            const label = this.createCompletedMeasureLabel('measure-edge-label measure-completed-edge-label');
            label.textContent = `${(this.toMeters(a.distance(b)) * factor).toFixed(precision)} ${unit}`;
            label.style.left = `${(sa.x + sb.x) / 2}px`;
            label.style.top = `${(sa.y + sb.y) / 2}px`;
            label.style.display = 'block';
        }
    }

    private createCompletedMeasureLabel(className = 'measure-label measure-completed-label') {
        const el = document.createElement('div');
        el.className = className;
        el.style.display = 'none';
        this.measureOverlay?.appendChild(el);
        this.completedMeasureLabels.push(el);
        return el;
    }

    private screenPointsToSvg(screen: ScreenPoint[]) {
        return screen.map(s => `${s.x},${s.y}`).join(' ');
    }

    private getScreenCentroid(screen: ScreenPoint[]) {
        let x = 0;
        let y = 0;
        for (const point of screen) {
            x += point.x;
            y += point.y;
        }
        return { x: x / screen.length, y: y / screen.length };
    }

    private toMeters(sceneUnits: number) {
        const unitScale = Number(this.observer.get('measure.unitScale') ?? 1);
        const scale = Number.isFinite(unitScale) && unitScale > 0 ? unitScale : 1;
        return sceneUnits * scale;
    }

    private renderEdgeLabels(
        mode: MeasureMode,
        screen: Array<{ x: number; y: number; z: number }>,
        visible: boolean[]
    ) {
        const hideAll = () => {
            for (const el of this.measureEdgeLabels) el.style.display = 'none';
        };
        if (mode !== 'area' || this.points.length < 2) {
            hideAll();
            return;
        }

        const unit = this.observer.get('measure.unit') as 'mm' | 'cm' | 'm';
        const unitScale = Number(this.observer.get('measure.unitScale') ?? 1);
        const scale = Number.isFinite(unitScale) && unitScale > 0 ? unitScale : 1;
        const factor = unit === 'mm' ? 1000 : (unit === 'cm' ? 100 : 1);
        const precision = unit === 'mm' ? 0 : 2;

        const n = this.points.length;
        const areaComplete = this.isAreaComplete();
        const edgeCount = areaComplete ? n : n - 1;

        for (let i = 0; i < this.measureEdgeLabels.length; i++) {
            const el = this.measureEdgeLabels[i];
            if (i >= edgeCount) {
                el.style.display = 'none';
                continue;
            }
            const a = this.points[i];
            const b = this.points[(i + 1) % n];
            const sa = screen[i];
            const sb = screen[(i + 1) % n];
            if (!visible[i] || !visible[(i + 1) % n]) {
                el.style.display = 'none';
                continue;
            }
            const len = a.distance(b) * scale;
            el.textContent = `${(len * factor).toFixed(precision)} ${unit}`;
            el.style.left = `${(sa.x + sb.x) / 2}px`;
            el.style.top = `${(sa.y + sb.y) / 2}px`;
            el.style.display = 'block';
        }
    }

    private buildLabel(mode: MeasureMode, allVis: boolean) {
        if (!allVis) return '';
        const unit = this.observer.get('measure.unit') as 'mm' | 'cm' | 'm';
        if (mode === 'distance') {
            const meters = this.observer.get('measure.lastDistance') as number | null;
            if (!Number.isFinite(meters as number)) return '';
            const factor = unit === 'mm' ? 1000 : (unit === 'cm' ? 100 : 1);
            const precision = unit === 'mm' ? 0 : 2;
            return `${((meters as number) * factor).toFixed(precision)} ${unit}`;
        }
        if (mode === 'angle') {
            const deg = this.observer.get('measure.lastAngle') as number | null;
            if (!Number.isFinite(deg as number)) return '';
            return `${(deg as number).toFixed(1)}°`;
        }
        if (mode === 'area') {
            const m2 = this.observer.get('measure.lastArea') as number | null;
            if (!Number.isFinite(m2 as number)) return '';
            const factor2 = unit === 'mm' ? 1e6 : (unit === 'cm' ? 1e4 : 1);
            const precision = unit === 'mm' ? 0 : 2;
            return `${((m2 as number) * factor2).toFixed(precision)} ${unit}²`;
        }
        return '';
    }

    private buildStoredLabel(measurement: StoredMeasurement) {
        const unit = this.observer.get('measure.unit') as 'mm' | 'cm' | 'm';
        if (measurement.mode === 'distance' && measurement.points.length >= 2) {
            const meters = this.toMeters(measurement.points[0].distance(measurement.points[1]));
            const factor = unit === 'mm' ? 1000 : (unit === 'cm' ? 100 : 1);
            const precision = unit === 'mm' ? 0 : 2;
            return `${(meters * factor).toFixed(precision)} ${unit}`;
        }
        if (measurement.mode === 'angle') {
            const deg = measurement.angle;
            if (!Number.isFinite(deg as number)) return '';
            return `${(deg as number).toFixed(1)}°`;
        }
        if (measurement.mode === 'area' && measurement.points.length >= 3) {
            const raw = this.computeArea(measurement.points);
            const meters2 = this.toMeters(Math.sqrt(raw.area));
            const factor2 = unit === 'mm' ? 1e6 : (unit === 'cm' ? 1e4 : 1);
            const precision = unit === 'mm' ? 0 : 2;
            return `${(meters2 * meters2 * factor2).toFixed(precision)} ${unit}²`;
        }
        return '';
    }
}

export { MeasurementController };
