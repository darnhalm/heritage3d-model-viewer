import { Vec3 } from 'playcanvas';

import { CameraControls } from '../../camera-controls';
import { Picker } from '../../picker';

const MOUSE_DRAG_THRESHOLD = 5;
const TOUCH_DRAG_THRESHOLD = 8;

type SurfaceInput = 'mouse' | 'touch' | 'pen';

type SurfaceGesture = 'orbit' | 'pan';

type SurfacePivotState =
    | { state: 'idle' }
    | {
        state: 'tracking' | 'picking';
        pointerId: number;
        requestId: number;
        input: SurfaceInput;
        gesture: SurfaceGesture;
        startClientX: number;
        startClientY: number;
        canvasX: number;
        canvasY: number;
        lastClientX: number;
        lastClientY: number;
    }
    | {
        state: 'active';
        pointerId: number;
        requestId: number;
        input: SurfaceInput;
        gesture: SurfaceGesture;
        worldPoint: Vec3;
        lastClientX: number;
        lastClientY: number;
    };

type SurfacePivotControllerArgs = {
    canvas: HTMLCanvasElement;
    picker: Picker;
    cameraControls: CameraControls;
    canStart: () => boolean;
    mouseButtonsInverted: () => boolean;
    worldToScreen: (point: Vec3) => Vec3;
    renderNextFrame: () => void;
    /** Синхронный пик поверхности: колесу нужен ответ в том же кадре. */
    pickSurfaceSync: (x: number, y: number) => Vec3 | null;
};

/** Как долго точка под курсором считается свежей внутри одной серии прокруток, мс. */
const ZOOM_TARGET_TTL_MS = 150;

/**
 * Resolves one depth point per drag. Orbit uses it as a temporary off-axis pivot while pan
 * translates at that point's depth so the grabbed surface stays under the pointer.
 *
 * Pointer tracking lives outside CameraControls so clicks, async pick cancellation and tool
 * priority remain explicit. CameraControls owns only the cheap transform math.
 */
class SurfacePivotController {
    private readonly canvas: HTMLCanvasElement;

    private readonly picker: Picker;

    /** Последняя точка, отданная колесу: серия прокруток не должна пикать на каждое событие. */
    private zoomTarget: { x: number; y: number; at: number } | null = null;

    private readonly cameraControls: CameraControls;

    private readonly canStart: () => boolean;

    private readonly mouseButtonsInverted: () => boolean;

    private readonly worldToScreen: (point: Vec3) => Vec3;

    private readonly renderNextFrame: () => void;

    private readonly pickSurfaceSync: (x: number, y: number) => Vec3 | null;

    private state: SurfacePivotState = { state: 'idle' };

    private requestId = 0;

    private marker: HTMLDivElement | null = null;

    private pickCount = 0;

    private lastPickLatencyMs = 0;

    private readonly onPointerDown = (event: PointerEvent) => {
        if (this.state.state !== 'idle') {
            // A second finger hands control back to the existing multitouch pan/pinch source.
            if (event.pointerId !== this.state.pointerId) this.reset();
            return;
        }
        if (event.target !== this.canvas || !this.canStart()) return;
        if (event.pointerType === 'mouse' && event.button !== 0 && event.button !== 2) return;
        if (event.pointerType !== 'mouse' && event.pointerType !== 'touch' && event.pointerType !== 'pen') return;

        const rect = this.canvas.getBoundingClientRect();
        const input = event.pointerType as SurfaceInput;
        const inverted = this.mouseButtonsInverted();
        const orbitButton = inverted ? 2 : 0;
        const gesture: SurfaceGesture = event.pointerType === 'mouse' ?
            (event.button === orbitButton ? 'orbit' : 'pan') :
            (inverted ? 'pan' : 'orbit');
        this.requestId++;
        this.state = {
            state: 'tracking',
            pointerId: event.pointerId,
            requestId: this.requestId,
            input,
            gesture,
            startClientX: event.clientX,
            startClientY: event.clientY,
            canvasX: event.clientX - rect.left,
            canvasY: event.clientY - rect.top,
            lastClientX: event.clientX,
            lastClientY: event.clientY
        };
        if (gesture === 'orbit') {
            this.cameraControls.beginSurfaceOrbit();
        } else {
            this.cameraControls.beginSurfacePan();
        }
    };

    private readonly onPointerMove = (event: PointerEvent) => {
        const state = this.state;
        if (state.state === 'idle' || event.pointerId !== state.pointerId) return;
        if (!this.canStart()) {
            this.reset();
            return;
        }

        const dx = event.clientX - state.lastClientX;
        const dy = event.clientY - state.lastClientY;
        state.lastClientX = event.clientX;
        state.lastClientY = event.clientY;

        if (state.state === 'active') {
            if (state.gesture === 'orbit') {
                this.cameraControls.queueSurfaceOrbit(dx, dy);
            } else {
                this.cameraControls.queueSurfacePan(dx, dy);
            }
            this.renderNextFrame();
            return;
        }

        const threshold = state.input === 'mouse' ? MOUSE_DRAG_THRESHOLD : TOUCH_DRAG_THRESHOLD;
        if (state.state === 'tracking' && Math.hypot(
            event.clientX - state.startClientX,
            event.clientY - state.startClientY
        ) > threshold) {
            this.pickSurface(state);
        }
    };

    private readonly onPointerUp = (event: PointerEvent) => {
        if (this.state.state !== 'idle' && event.pointerId === this.state.pointerId) this.reset();
    };

    private readonly onPointerLeave = (event: PointerEvent) => {
        if (this.state.state !== 'idle' && event.pointerId === this.state.pointerId) this.reset();
    };

    constructor(args: SurfacePivotControllerArgs) {
        this.canvas = args.canvas;
        this.picker = args.picker;
        this.pickSurfaceSync = args.pickSurfaceSync;
        this.cameraControls = args.cameraControls;
        this.canStart = args.canStart;
        this.mouseButtonsInverted = args.mouseButtonsInverted;
        this.worldToScreen = args.worldToScreen;
        this.renderNextFrame = args.renderNextFrame;
        this.initMarker();

        this.canvas.addEventListener('wheel', this.onWheel, { passive: true });
        this.canvas.addEventListener('pointerdown', this.onPointerDown);
        this.canvas.addEventListener('pointerleave', this.onPointerLeave);
        document.addEventListener('pointermove', this.onPointerMove);
        document.addEventListener('pointerup', this.onPointerUp);
        document.addEventListener('pointercancel', this.onPointerUp);
    }

    /**
     * Подсказать камере точку под курсором перед тем, как она обработает прокрутку.
     *
     * Пик синхронный и в той же серии прокруток переиспользуется: колесо шлёт события
     * пачками, а обходить треугольники на каждое из них незачем. Промах по геометрии сбрасывает
     * подсказку, и зум возвращается к прежнему поведению — к фокусу орбиты.
     *
     * @param event - Событие колеса.
     */
    private onWheel = (event: WheelEvent) => {
        if (!this.canStart()) {
            this.cameraControls.setSurfaceZoomTarget(null);
            return;
        }
        const rect = this.canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        const now = performance.now();
        const fresh = this.zoomTarget &&
            now - this.zoomTarget.at < ZOOM_TARGET_TTL_MS &&
            Math.abs(this.zoomTarget.x - x) < 2 &&
            Math.abs(this.zoomTarget.y - y) < 2;
        if (fresh) {
            this.zoomTarget.at = now;
            return;
        }
        const point = this.pickSurfaceSync(x, y);
        this.cameraControls.setSurfaceZoomTarget(point);
        this.zoomTarget = point ? { x, y, at: now } : null;
    };

    private initMarker() {
        const wrapper = this.canvas.parentElement;
        if (!wrapper) return;
        this.marker = document.createElement('div');
        this.marker.className = 'surface-pivot-marker';
        this.marker.setAttribute('aria-hidden', 'true');
        wrapper.appendChild(this.marker);
    }

    private async pickSurface(state: Extract<SurfacePivotState, { state: 'tracking' | 'picking' }>) {
        const requestId = state.requestId;
        state.state = 'picking';
        const startedAt = performance.now();
        this.pickCount++;
        let point: Vec3 | null = null;
        try {
            point = await this.picker.pick(state.canvasX, state.canvasY);
        } catch {
            const current = this.state;
            if (current.state === 'picking' && current.requestId === requestId) this.reset();
            return;
        } finally {
            this.lastPickLatencyMs = performance.now() - startedAt;
        }

        const current = this.state;
        if (current.state !== 'picking' || current.requestId !== requestId) return;
        if (!this.canStart()) {
            this.reset();
            return;
        }
        if (!point) {
            // A miss returns control to the ordinary on-axis orbit for the rest of this drag.
            this.reset();
            return;
        }

        this.state = {
            state: 'active',
            pointerId: current.pointerId,
            requestId,
            input: current.input,
            gesture: current.gesture,
            worldPoint: point.clone(),
            lastClientX: current.lastClientX,
            lastClientY: current.lastClientY
        };
        if (current.gesture === 'orbit') {
            this.cameraControls.activateSurfaceOrbit(point);
        } else {
            this.cameraControls.activateSurfacePan(
                point,
                current.lastClientX - current.startClientX,
                current.lastClientY - current.startClientY
            );
        }
        this.marker?.classList.toggle('touch', current.input !== 'mouse');
        this.marker?.classList.add('visible');
        this.updateMarker();
        this.renderNextFrame();
    }

    private updateMarker() {
        if (!this.marker || this.state.state !== 'active') return;
        const screen = this.worldToScreen(this.state.worldPoint);
        if (![screen.x, screen.y, screen.z].every(Number.isFinite)) {
            this.marker.classList.remove('visible');
            return;
        }
        this.marker.style.transform = `translate3d(${screen.x}px, ${screen.y}px, 0) translate(-50%, -50%)`;
    }

    update() {
        if (this.state.state === 'idle') return;
        if (!this.canStart()) {
            this.reset();
            return;
        }
        this.updateMarker();
    }

    reset() {
        if (this.state.state === 'idle') return;
        this.requestId++;
        this.state = { state: 'idle' };
        this.cameraControls.endSurfaceOrbit();
        this.cameraControls.endSurfacePan();
        this.marker?.classList.remove('visible', 'touch');
        this.renderNextFrame();
    }

    getDebugState() {
        return {
            state: this.state.state,
            gesture: this.state.state === 'idle' ? null : this.state.gesture,
            pickCount: this.pickCount,
            lastPickLatencyMs: this.lastPickLatencyMs,
            worldPoint: this.state.state === 'active' ? this.state.worldPoint.toArray() : null
        };
    }

    dispose() {
        this.reset();
        this.canvas.removeEventListener('wheel', this.onWheel);
        this.canvas.removeEventListener('pointerdown', this.onPointerDown);
        this.canvas.removeEventListener('pointerleave', this.onPointerLeave);
        document.removeEventListener('pointermove', this.onPointerMove);
        document.removeEventListener('pointerup', this.onPointerUp);
        document.removeEventListener('pointercancel', this.onPointerUp);
        this.marker?.remove();
        this.marker = null;
    }
}

export { SurfacePivotController };
