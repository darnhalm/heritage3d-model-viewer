import { Vec3 } from 'playcanvas';

import type { WalkSurfaceHit } from '../../camera-controls';

type WalkPlacementArgs = {
    canvas: HTMLCanvasElement;
    pick: (x: number, y: number) => WalkSurfaceHit | null;
    worldToScreen: (point: Vec3) => Vec3;
    radius: () => number;
    onPlace: (point: Vec3) => void;
    onCancel: () => void;
    getHint: () => string;
    getCancelLabel: () => string;
};

/** Explicit entry into walking, with one surface pick per animation frame while choosing a floor. */
class WalkPlacementController {
    active = false;

    private readonly args: WalkPlacementArgs;

    private readonly overlay: HTMLDivElement;

    private readonly ring: SVGPolygonElement;

    private readonly hint: HTMLSpanElement;

    private readonly cancelButton: HTMLButtonElement;

    private pointer: { x: number; y: number } | null = null;

    private press: { x: number; y: number; pointerId: number; dragged: boolean; threshold: number } | null = null;

    private frame = 0;

    private hit: WalkSurfaceHit | null = null;

    private suppressDoubleClickUntil = 0;

    private readonly onMove = (event: PointerEvent) => {
        if (!this.active) return;
        if (this.press?.pointerId === event.pointerId &&
            Math.hypot(event.clientX - this.press.x, event.clientY - this.press.y) > this.press.threshold) {
            this.press.dragged = true;
        }
        const rect = this.args.canvas.getBoundingClientRect();
        this.pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
        this.scheduleRefresh();
    };

    private readonly onLeave = () => {
        this.pointer = null;
        this.press = null;
        this.hit = null;
        this.ring.setAttribute('visibility', 'hidden');
    };

    private readonly onDown = (event: PointerEvent) => {
        if (!this.active || event.button !== 0) return;
        if (!event.isPrimary) {
            if (this.press) this.press.dragged = true;
            return;
        }
        this.press = {
            x: event.clientX,
            y: event.clientY,
            pointerId: event.pointerId,
            dragged: false,
            threshold: event.pointerType === 'mouse' ? 5 : 8
        };
        this.onMove(event);
    };

    private readonly onUp = (event: PointerEvent) => {
        if (!this.active || this.press?.pointerId !== event.pointerId) return;
        if (this.press.dragged || event.target !== this.args.canvas ||
            Math.hypot(event.clientX - this.press.x, event.clientY - this.press.y) > this.press.threshold) {
            this.press = null;
        } else {
            const rect = this.args.canvas.getBoundingClientRect();
            this.pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
        }
    };

    private readonly onClick = (event: MouseEvent) => {
        if (!this.active) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!this.press) return;
        this.press = null;
        // Keep subpixel PointerEvent coordinates; legacy click events may round them,
        // shifting the destination away from the marker on a distant surface.
        this.refresh();
        if (!this.hit) return;
        const point = this.hit.point.clone();
        this.suppressDoubleClickUntil = performance.now() + 500;
        this.stop();
        this.args.onPlace(point);
    };

    private readonly onDoubleClick = (event: MouseEvent) => {
        if (!this.active && performance.now() >= this.suppressDoubleClickUntil) return;
        event.preventDefault();
        event.stopImmediatePropagation();
    };

    private readonly onKey = (event: KeyboardEvent) => {
        if (!this.active || event.key !== 'Escape') return;
        event.preventDefault();
        event.stopImmediatePropagation();
        this.cancel();
    };

    private readonly cancel = () => {
        this.stop();
        this.args.onCancel();
    };

    constructor(args: WalkPlacementArgs) {
        this.args = args;
        this.overlay = document.createElement('div');
        this.overlay.className = 'walk-placement-overlay';
        this.overlay.hidden = true;
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('aria-hidden', 'true');
        this.ring = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        this.ring.setAttribute('visibility', 'hidden');
        svg.appendChild(this.ring);
        const instruction = document.createElement('div');
        instruction.className = 'walk-placement-instruction';
        this.hint = document.createElement('span');
        this.hint.setAttribute('role', 'status');
        this.cancelButton = document.createElement('button');
        this.cancelButton.type = 'button';
        this.cancelButton.addEventListener('click', this.cancel);
        instruction.append(this.hint, this.cancelButton);
        this.overlay.append(svg, instruction);
        args.canvas.parentElement?.appendChild(this.overlay);
        args.canvas.addEventListener('pointermove', this.onMove);
        args.canvas.addEventListener('pointerleave', this.onLeave);
        args.canvas.addEventListener('pointerdown', this.onDown, true);
        document.addEventListener('pointerup', this.onUp, true);
        args.canvas.addEventListener('click', this.onClick, true);
        args.canvas.addEventListener('dblclick', this.onDoubleClick, true);
        args.canvas.addEventListener('pointercancel', this.onLeave);
        window.addEventListener('keydown', this.onKey, true);
    }

    start() {
        this.active = true;
        this.overlay.hidden = false;
        this.args.canvas.classList.add('walk-placement-active');
        this.refresh();
    }

    scheduleRefresh() {
        if (!this.active || this.frame) return;
        this.frame = requestAnimationFrame(() => {
            this.frame = 0;
            this.refresh();
        });
    }

    refresh() {
        if (!this.active) return;
        this.hint.textContent = this.args.getHint();
        this.cancelButton.textContent = this.args.getCancelLabel();
        this.hit = this.pointer ? this.args.pick(this.pointer.x, this.pointer.y) : null;
        // Match the walking controller's slope limit. Walls never become a destination.
        if (!this.hit || Math.abs(this.hit.normal.y) < 0.35) {
            this.hit = null;
            this.ring.setAttribute('visibility', 'hidden');
            return;
        }
        const normal = this.hit.normal.clone().normalize();
        const tangent = new Vec3().cross(normal, Vec3.RIGHT).normalize();
        const bitangent = new Vec3().cross(normal, tangent).normalize();
        const points: Vec3[] = [];
        const center = this.args.worldToScreen(this.hit.point);
        if (center.z <= 0) {
            this.hit = null;
            this.ring.setAttribute('visibility', 'hidden');
            return;
        }
        // A scene can be calibrated in centimetres or viewed extremely close up.
        // Bound the visual footprint so its edge cannot extend behind the camera.
        const radius = Math.min(this.args.radius(), center.z * 0.1);
        let screenRadius = 0;
        for (let i = 0; i < 32; i++) {
            const angle = i / 32 * Math.PI * 2;
            const point = this.hit.point.clone()
            .add(tangent.clone().mulScalar(Math.cos(angle) * radius))
            .add(bitangent.clone().mulScalar(Math.sin(angle) * radius));
            const screen = this.args.worldToScreen(point);
            if (screen.z <= 0 || !Number.isFinite(screen.x) || !Number.isFinite(screen.y)) {
                this.ring.setAttribute('visibility', 'hidden');
                this.hit = null;
                return;
            }
            screenRadius = Math.max(screenRadius, Math.hypot(screen.x - center.x, screen.y - center.y));
            points.push(screen);
        }
        // Keep the projected floor ring legible when choosing a distant point from an orbit view.
        const scale = Math.max(1, 12 / Math.max(screenRadius, 0.001));
        this.ring.setAttribute('points', points.map(p => (
            `${center.x + (p.x - center.x) * scale},${center.y + (p.y - center.y) * scale}`
        )).join(' '));
        this.ring.setAttribute('visibility', 'visible');
    }

    stop() {
        this.active = false;
        this.overlay.hidden = true;
        this.args.canvas.classList.remove('walk-placement-active');
        if (this.frame) cancelAnimationFrame(this.frame);
        this.frame = 0;
        this.press = null;
        this.onLeave();
    }

    dispose() {
        this.stop();
        this.cancelButton.removeEventListener('click', this.cancel);
        this.args.canvas.removeEventListener('pointermove', this.onMove);
        this.args.canvas.removeEventListener('pointerleave', this.onLeave);
        this.args.canvas.removeEventListener('pointerdown', this.onDown, true);
        document.removeEventListener('pointerup', this.onUp, true);
        this.args.canvas.removeEventListener('click', this.onClick, true);
        this.args.canvas.removeEventListener('dblclick', this.onDoubleClick, true);
        this.args.canvas.removeEventListener('pointercancel', this.onLeave);
        window.removeEventListener('keydown', this.onKey, true);
        this.overlay.remove();
    }
}

export { WalkPlacementController };
