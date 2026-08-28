import { type Observer } from '@playcanvas/observer';
import {
    math,
    AppBase,
    DualGestureSource,
    FlyController,
    GamepadSource,
    InputFrame,
    KeyboardMouseSource,
    MultiTouchSource,
    OrbitController,
    Pose,
    PROJECTION_PERSPECTIVE,
    Quat,
    Vec2,
    Vec3,
    type CameraComponent,
    type InputController
} from 'playcanvas';

type CameraControlsState = {
    axis: Vec3;
    mouse: number[];
    shift: number;
    ctrl: number;
    touches: number;
    alt: boolean;
};

const tmpV1 = new Vec3();
const tmpV2 = new Vec3();
const surfaceOffset = new Vec3();
const surfaceAngles = new Vec3();
const surfaceOldRotation = new Quat();
const surfaceNewRotation = new Quat();
const surfaceInverseRotation = new Quat();
const surfaceDeltaRotation = new Quat();
const surfacePanRotation = new Quat();
const surfacePanForward = new Vec3();
const surfacePanMove = new Vec3();
const surfaceZoomRotation = new Quat();
const surfaceZoomForward = new Vec3();
const surfaceZoomOffset = new Vec3();

/**
 * Чувствительность зума к точке под курсором, относительно штатного шага колеса.
 *
 * Единица означает «как было»: на вход берётся ровно та же величина `wheel * wheelSpeed * dt`,
 * что и у обычного зума, поэтому ощущение прокрутки не меняется. Разница в том, что величина
 * идёт в показатель экспоненты, то есть шаг задаётся множителем расстояния до поверхности, а
 * не прибавкой к нему: одна и та же прокрутка одинаково ощущается и в метре от стены, и в
 * сотне метров. Побочный, но нужный эффект — камера приближается к поверхности асимптотически
 * и пересечь её не может.
 */
const SURFACE_ZOOM_STEP = 1;

/**
 * Предел изменения расстояния за один кадр.
 *
 * Колесо шлёт события пачками, и на трекпаде за кадр их набирается десятками. Без потолка
 * показатель экспоненты вырастает до десятков, а камера — улетает на порядки от сцены.
 */
const SURFACE_ZOOM_MAX_STEP = 0.5;

/**
 * Какая доля скорости выбега остаётся через секунду.
 *
 * Задано «за секунду», а не «за кадр», чтобы выбег не зависел от частоты кадров: на 30 и на
 * 120 кадрах он одинаковой длины. 0.02 означает, что за секунду скорость падает до двух
 * процентов — модель ощутимо доворачивается после броска и мягко встаёт.
 */
const SURFACE_ORBIT_COAST_RETENTION = 0.02;

/**
 * Скорость, ниже которой выбег прекращается, экранных пикселей в секунду.
 *
 * Выбег держит жест живым и на это время отбирает ввод у штатного контроллера, поэтому
 * висеть на неразличимой глазом скорости он не должен.
 */
const SURFACE_ORBIT_MIN_SPEED = 2;

/**
 * Окно усреднения скорости, секунды.
 *
 * Скорость для выбега берётся не из последнего кадра, а сглаженной: иначе случайное дрожание
 * руки в момент отпускания кнопки задаёт бросок, которого человек не делал.
 */
const SURFACE_ORBIT_VELOCITY_WINDOW = 0.05;

/** Keyboard fly speed: normal WASD is precise, Shift restores the former cruising speed. */
const FLY_KEYBOARD_SPEED = 1 / 3;
const FLY_KEYBOARD_BOOST_SPEED = 1;
const FLY_KEYBOARD_PRECISE_SPEED = FLY_KEYBOARD_SPEED * 0.5;

const pose = new Pose();

const frame = new InputFrame({
    move: [0, 0, 0],
    rotate: [0, 0, 0]
});

export const damp = (damping: number, dt: number) => 1 - Math.pow(damping, dt * 1000);

const applyDeadZone = (stick: number[], low: number, high: number) => {
    const mag = Math.sqrt(stick[0] * stick[0] + stick[1] * stick[1]);
    if (mag < low) {
        stick.fill(0);
        return;
    }
    const scale = (mag - low) / (high - low);
    stick[0] *= scale / mag;
    stick[1] *= scale / mag;
};

const screenToWorld = (camera: CameraComponent, dx: number, dy: number, dz: number, out: Vec3 = new Vec3()) => {
    const { system, fov, aspectRatio, horizontalFov, projection, orthoHeight } = camera;
    const { width, height } = system.app.graphicsDevice.clientRect;

    // normalize deltas to device coord space
    out.set(
        -(dx / width) * 2,
        (dy / height) * 2,
        0
    );

    // calculate half size of the view frustum at the current distance
    const halfSize = tmpV2.set(0, 0, 0);
    if (projection === PROJECTION_PERSPECTIVE) {
        const halfSlice = dz * Math.tan(0.5 * fov * math.DEG_TO_RAD);
        if (horizontalFov) {
            halfSize.set(
                halfSlice,
                halfSlice / aspectRatio,
                0
            );
        } else {
            halfSize.set(
                halfSlice * aspectRatio,
                halfSlice,
                0
            );
        }
    } else {
        halfSize.set(
            orthoHeight * aspectRatio,
            orthoHeight,
            0
        );
    }

    // scale by device coord space
    out.mul(halfSize);

    return out;
};

class CameraControls {
    private _app: AppBase;

    private _camera: CameraComponent;

    private _observer: Observer;

    private _zoomRange: Vec2 = new Vec2();

    private _desktopInput: KeyboardMouseSource = new KeyboardMouseSource();

    private _orbitMobileInput: MultiTouchSource = new MultiTouchSource();

    private _flyMobileInput: DualGestureSource = new DualGestureSource();

    private _gamepadInput: GamepadSource = new GamepadSource();

    private _flyController: FlyController = new FlyController();

    private _orbitController: OrbitController = new OrbitController();

    private _controller: InputController;

    private _pose: Pose = new Pose();

    private _mode: 'orbit' | 'fly';

    private _surfaceOrbit: { phase: 'pending' | 'active' | 'coasting'; pivot: Vec3 | null } | null = null;

    /** Угловая скорость поворота для выбега, экранных пикселей в секунду. */
    private _surfaceOrbitVelocity = new Vec2();

    private _surfaceOrbitDelta: Vec2 = new Vec2();

    private _surfacePan: { phase: 'pending' | 'active'; depth: number } | null = null;

    /**
     * Точка под курсором, к которой тянет колесо.
     *
     * `null` — работает прежний зум к фокусу орбиты. Точку кладёт сюда контроллер
     * поверхностной навигации: пик умеет он, а не эти контролы.
     */
    private _surfaceZoomPoint: Vec3 | null = null;

    private _surfacePanDelta: Vec2 = new Vec2();

    private _mouseButtonsInverted = false;

    private _state: CameraControlsState = {
        axis: new Vec3(),
        mouse: [0, 0, 0],
        shift: 0,
        ctrl: 0,
        touches: 0,
        alt: false
    };

    private _onKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Alt') this._state.alt = true;
    };

    private _onKeyUp = (e: KeyboardEvent) => {
        if (e.key === 'Alt') this._state.alt = false;
    };

    skyRotationSpeed = 0.3;

    // when false, camera controls ignore all input
    enabled = true;

    // this gets overridden by the viewer based on scene size
    moveSpeed = 1;

    // User-adjustable multiplier for movement while the fly controller is active.
    flySpeed = 1;

    orbitSpeed = 18;

    /** Degrees per CSS pixel for the event-driven off-axis surface orbit. */
    surfaceOrbitSpeed = 0.25;

    pinchSpeed = 0.4;

    wheelSpeed = 0.06;

    gamepadDeadZone: Vec2 = new Vec2(0.3, 0.6);

    constructor(app: AppBase, camera: CameraComponent, observer: Observer) {
        this._app = app;
        this._camera = camera;
        this._observer = observer;
        this._mouseButtonsInverted = observer.get('camera.mouseButtonsInverted') === true;

        // set orbit controller defaults
        this._orbitController.zoomRange = new Vec2(0, Infinity);
        this._orbitController.pitchRange = new Vec2(-90, 90);
        this._orbitController.rotateDamping = 0.97;
        this._orbitController.moveDamping = 0.97;
        this._orbitController.zoomDamping = 0.97;

        // set fly controller defaults
        this._flyController.pitchRange = new Vec2(-90, 90);
        this._flyController.rotateDamping = 0.97;
        this._flyController.moveDamping = 0.97;

        // attach input
        this._desktopInput.attach(this._app.graphicsDevice.canvas);
        this._orbitMobileInput.attach(this._app.graphicsDevice.canvas);
        this._flyMobileInput.attach(this._app.graphicsDevice.canvas);
        this._gamepadInput.attach(this._app.graphicsDevice.canvas);

        window.addEventListener('keydown', this._onKeyDown);
        window.addEventListener('keyup', this._onKeyUp);

        // pose
        this._pose.look(this._camera.entity.getPosition(), Vec3.ZERO);

        // mode
        this.mode = 'orbit';
    }

    set zoomRange(range: Vec2) {
        this._zoomRange.x = range.x;
        this._zoomRange.y = range.y <= range.x ? Infinity : range.y;
        this._orbitController.zoomRange = this._zoomRange;
    }

    get zoomRange() {
        return this._zoomRange;
    }

    set mouseButtonsInverted(value: boolean) {
        const next = !!value;
        if (next === this._mouseButtonsInverted) return;
        this._mouseButtonsInverted = next;
        this._state.mouse.fill(0);
        this.endSurfaceNavigation();
    }

    get mouseButtonsInverted() {
        return this._mouseButtonsInverted;
    }

    set mode(mode: 'orbit' | 'fly') {
        // check if mode is the same
        if (this._mode === mode) {
            return;
        }
        if (mode !== 'orbit') this.endSurfaceNavigation();
        this._mode = mode;

        // detach old controller
        if (this._controller) {
            this._controller.detach();
        }

        // attach new controller
        switch (this._mode) {
            case 'orbit': {
                this._controller = this._orbitController;
                break;
            }
            case 'fly': {
                this._controller = this._flyController;
                break;
            }
        }
        this._controller.attach(this._pose, false);

        // fire observer event
        this._observer.set('camera.mode', this._mode);
    }

    get mode() {
        return this._mode;
    }

    reset(focus: Vec3, position: Vec3) {
        this.mode = 'orbit';
        this._pose.look(position, focus);
        this._controller.attach(this._pose, false);
        this._camera.entity.setPosition(this._pose.position);
        this._camera.entity.setEulerAngles(this._pose.angles);
    }

    /**
     * Current camera position (orbit: camera entity position).
     * @param out - Optional destination vector.
     * @returns Current camera world position.
     */
    getPosition(out?: Vec3): Vec3 {
        const p = this._pose.position;
        return out ? out.copy(p) : p.clone();
    }

    /**
     * Current orbit focus point (point the camera looks at).
     * @param out - Optional destination vector.
     * @returns Current orbit focus point.
     */
    getFocus(out?: Vec3): Vec3 {
        return this._pose.getFocus(out);
    }

    beginSurfaceOrbit() {
        if (!this.enabled || this._mode !== 'orbit') return;
        this._orbitController.attach(this._pose, false);
        this._surfaceOrbit = { phase: 'pending', pivot: null };
        this._surfaceOrbitDelta.set(0, 0);
        this._surfaceOrbitVelocity.set(0, 0);
    }

    activateSurfaceOrbit(pivot: Vec3) {
        if (!this._surfaceOrbit || this._mode !== 'orbit') return;
        this._surfaceOrbit.phase = 'active';
        this._surfaceOrbit.pivot = pivot.clone();
        this._surfaceOrbitDelta.set(0, 0);
    }

    queueSurfaceOrbit(dx: number, dy: number) {
        if (this._surfaceOrbit?.phase !== 'active') return;
        this._surfaceOrbitDelta.x += dx;
        this._surfaceOrbitDelta.y += dy;
    }

    endSurfaceOrbit() {
        if (!this._surfaceOrbit) return;
        // Кнопку отпустили, но накопленный поворот ещё не отработан: доигрываем его как
        // выбег, иначе движение обрывается ровно в тот момент, когда рука уже остановилась.
        if (this._surfaceOrbit.phase === 'active' && this._surfaceOrbit.pivot &&
            this._surfaceOrbitVelocity.length() > SURFACE_ORBIT_MIN_SPEED) {
            this._surfaceOrbit.phase = 'coasting';
            return;
        }
        this.finishSurfaceOrbit();
    }

    /** Снять жест орбиты и вернуть управление штатному контроллеру. */
    private finishSurfaceOrbit() {
        this._surfaceOrbit = null;
        this._surfaceOrbitDelta.set(0, 0);
        this._surfaceOrbitVelocity.set(0, 0);
        if (this._mode === 'orbit') this._orbitController.attach(this._pose, false);
    }

    beginSurfacePan() {
        if (!this.enabled || this._mode !== 'orbit') return;
        this._orbitController.attach(this._pose, false);
        this._surfacePan = { phase: 'pending', depth: 0 };
        this._surfacePanDelta.set(0, 0);
    }

    activateSurfacePan(pivot: Vec3, dx: number, dy: number) {
        if (!this._surfacePan || this._mode !== 'orbit') return;
        surfacePanRotation.setFromEulerAngles(this._pose.angles);
        surfacePanRotation.transformVector(Vec3.FORWARD, surfacePanForward);
        this._surfacePan.phase = 'active';
        this._surfacePan.depth = Math.max(0, surfacePanForward.dot(surfacePanMove.sub2(pivot, this._pose.position)));
        this._surfacePanDelta.set(dx, dy);
    }

    queueSurfacePan(dx: number, dy: number) {
        if (this._surfacePan?.phase !== 'active') return;
        this._surfacePanDelta.x += dx;
        this._surfacePanDelta.y += dy;
    }

    /**
     * Задать точку, к которой тянет колесо.
     *
     * @param point - Мировая точка под курсором либо `null`, чтобы вернуть зум к фокусу орбиты.
     */
    setSurfaceZoomTarget(point: Vec3 | null) {
        this._surfaceZoomPoint = point ? point.clone() : null;
    }

    /**
     * Приблизить камеру к точке под курсором.
     *
     * Камера едет строго по лучу к самой точке, поэтому точка остаётся ровно под курсором —
     * то же правило, что уже работает при поверхностном перетаскивании. Дополнительно фокус
     * орбиты сажается на глубину этой точки: иначе он остаётся на прежней, более далёкой
     * глубине, и следующий поворот пойдёт вокруг места где-то внутри модели.
     *
     * @param amount - Величина прокрутки: та же `wheel * wheelSpeed * dt`, что у обычного зума.
     * @returns `true`, если зум применён и обычный шаг колеса больше не нужен.
     */
    private applySurfaceZoom(amount: number): boolean {
        const anchor = this._surfaceZoomPoint;
        if (!anchor || amount === 0) return false;

        surfaceZoomOffset.sub2(this._pose.position, anchor);
        const distance = surfaceZoomOffset.length();
        if (distance <= this._zoomRange.x) return false;

        // Знак совпадает с прокруткой: «от себя» даёт отрицательное значение и приближает.
        const step = math.clamp(
            amount * SURFACE_ZOOM_STEP,
            -SURFACE_ZOOM_MAX_STEP,
            SURFACE_ZOOM_MAX_STEP
        );
        const scale = Math.exp(step);
        // Ближе минимума не подходим: за него начинается пересечение поверхности.
        const next = Math.max(this._zoomRange.x, distance * scale);
        surfaceZoomOffset.mulScalar(next / distance).add(anchor);

        surfaceZoomRotation.setFromEulerAngles(this._pose.angles);
        surfaceZoomRotation.transformVector(Vec3.FORWARD, surfaceZoomForward);
        const focusDepth = Math.max(
            this._zoomRange.x,
            surfaceZoomForward.dot(tmpV2.sub2(anchor, surfaceZoomOffset))
        );

        this._pose.set(surfaceZoomOffset, this._pose.angles, focusDepth);
        this._orbitController.attach(this._pose, false);
        return true;
    }

    endSurfacePan() {
        if (!this._surfacePan) return;
        this._surfacePan = null;
        this._surfacePanDelta.set(0, 0);
        if (this._mode === 'orbit') this._orbitController.attach(this._pose, false);
    }

    private endSurfaceNavigation() {
        this.endSurfaceOrbit();
        this.endSurfacePan();
    }

    /**
     * Довернуть камеру вокруг найденной точки поверхности.
     *
     * Накопленный сдвиг отрабатывается не целиком за кадр, а долями — тем же законом
     * `damp`, что у штатной орбиты, и с тем же `rotateDamping`. Без этого поверхностный
     * поворот идёт жёстко, ступенька в ступеньку за движением мыши, и на фоне обычной
     * орбиты выглядит дёрганым. Остаток переносится на следующие кадры, поэтому после
     * отпускания кнопки движение не обрывается, а коротко догасает.
     *
     * @param dt - Длительность кадра, секунды.
     */
    private applySurfaceOrbit(dt: number) {
        const pivot = this._surfaceOrbit?.pivot;
        let dx = 0;
        let dy = 0;

        if (this._surfaceOrbit?.phase === 'coasting') {
            // Кнопка отпущена: крутим по запомненной скорости, гася её со временем.
            dx = this._surfaceOrbitVelocity.x * dt;
            dy = this._surfaceOrbitVelocity.y * dt;
            this._surfaceOrbitVelocity.mulScalar(Math.pow(SURFACE_ORBIT_COAST_RETENTION, dt));
            if (this._surfaceOrbitVelocity.length() < SURFACE_ORBIT_MIN_SPEED) {
                this._surfaceOrbitVelocity.set(0, 0);
            }
        } else {
            const factor = damp(this._orbitController.rotateDamping, dt);
            dx = this._surfaceOrbitDelta.x * factor;
            dy = this._surfaceOrbitDelta.y * factor;
            this._surfaceOrbitDelta.x -= dx;
            this._surfaceOrbitDelta.y -= dy;
            // Копим сглаженную скорость: по ней пойдёт выбег, когда кнопку отпустят.
            if (dt > 0) {
                const weight = Math.min(1, dt / SURFACE_ORBIT_VELOCITY_WINDOW);
                this._surfaceOrbitVelocity.x += (dx / dt - this._surfaceOrbitVelocity.x) * weight;
                this._surfaceOrbitVelocity.y += (dy / dt - this._surfaceOrbitVelocity.y) * weight;
            }
        }

        if (!pivot || (dx === 0 && dy === 0)) return;

        surfaceAngles.copy(this._pose.angles);
        surfaceAngles.x = math.clamp(
            surfaceAngles.x - dy * this.surfaceOrbitSpeed,
            this._orbitController.pitchRange.x,
            this._orbitController.pitchRange.y
        );
        surfaceAngles.y = (surfaceAngles.y - dx * this.surfaceOrbitSpeed) % 360;

        surfaceOldRotation.setFromEulerAngles(this._pose.angles);
        surfaceNewRotation.setFromEulerAngles(surfaceAngles);
        surfaceInverseRotation.copy(surfaceOldRotation).invert();
        surfaceDeltaRotation.mul2(surfaceNewRotation, surfaceInverseRotation);
        surfaceOffset.sub2(this._pose.position, pivot);
        surfaceDeltaRotation.transformVector(surfaceOffset, surfaceOffset);

        this._pose.set(surfaceOffset.add(pivot), surfaceAngles, this._pose.distance);
    }

    private applySurfacePan() {
        const pan = this._surfacePan;
        const dx = this._surfacePanDelta.x;
        const dy = this._surfacePanDelta.y;
        this._surfacePanDelta.set(0, 0);
        if (!pan || pan.phase !== 'active' || (dx === 0 && dy === 0)) return;

        // Translate at the picked point's view-space depth. Using the orbit focus distance here
        // makes nearer/farther surface points slide away from the cursor during a pan.
        screenToWorld(this._camera, dx, dy, pan.depth, surfacePanMove);
        surfacePanRotation.setFromEulerAngles(this._pose.angles);
        surfacePanRotation.transformVector(surfacePanMove, surfacePanMove);
        this._pose.position.add(surfacePanMove);
    }

    update(dt: number) {
        // read inputs (to clear their state) even when disabled
        const { key, button, mouse, wheel } = this._desktopInput.read();
        const { touch, pinch, count } = this._orbitMobileInput.read();
        const { leftInput, rightInput } = this._flyMobileInput.read();
        const { leftStick, rightStick } = this._gamepadInput.read();

        if (this._mouseButtonsInverted) {
            const leftButton = button[0];
            button[0] = button[2];
            button[2] = leftButton;
        }

        if (!this.enabled) {
            return;
        }

        if ((this._surfaceOrbit || this._surfacePan) && this._mode !== 'orbit') this.endSurfaceNavigation();

        const { keyCode } = KeyboardMouseSource;
        const el = document.activeElement as HTMLElement | null;
        const isTyping = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);

        // apply dead zone to gamepad sticks
        applyDeadZone(leftStick, this.gamepadDeadZone.x, this.gamepadDeadZone.y);
        applyDeadZone(rightStick, this.gamepadDeadZone.x, this.gamepadDeadZone.y);

        // update state (skip keyboard when focus is in text input)
        if (!isTyping) {
            this._state.axis.add(tmpV1.set(
                (key[keyCode.D] - key[keyCode.A]) + (key[keyCode.RIGHT] - key[keyCode.LEFT]),
                (key[keyCode.E] - key[keyCode.Q]),
                (key[keyCode.W] - key[keyCode.S]) + (key[keyCode.UP] - key[keyCode.DOWN])
            ));
            this._state.shift += key[keyCode.SHIFT];
            this._state.ctrl += key[keyCode.CTRL];
        }
        for (let i = 0; i < this._state.mouse.length; i++) {
            this._state.mouse[i] += button[i];
        }
        this._state.touches += count[0];

        if (this._mode !== 'fly' && this._state.axis.length() > 0) {
            // if we have any axis input, switch to fly mode
            this.mode = 'fly';
        }

        const orbit = +(this._mode === 'orbit');
        const fly = +(this._mode === 'fly');
        const double = +(this._state.touches > 1);
        const desktopPan = this._state.mouse[2] || +(button[2] === -1);
        const touchPan = this._mouseButtonsInverted ? +(this._state.touches === 1) : double;
        const distance = this._pose.distance;

        const { deltas } = frame;

        // desktop move
        const v = tmpV1.set(0, 0, 0);
        const keyMove = this._state.axis.clone().normalize();
        const keyboardSpeed = this._state.shift ?
            FLY_KEYBOARD_BOOST_SPEED :
            (this._state.ctrl ? FLY_KEYBOARD_PRECISE_SPEED : FLY_KEYBOARD_SPEED);
        v.add(keyMove.mulScalar(fly * this.moveSpeed * this.flySpeed * keyboardSpeed * dt));
        const panMove = screenToWorld(this._camera, mouse[0], mouse[1], distance);
        v.add(panMove.mulScalar(desktopPan));
        // Колесо: если контроллер поверхностной навигации подсказал точку под курсором,
        // тянем камеру к ней и гасим обычный шаг — иначе зум сработал бы дважды.
        const wheelAmount = wheel[0] * this.wheelSpeed * dt;
        const surfaceZoomed = orbit === 1 && !desktopPan && this.applySurfaceZoom(wheelAmount);
        const wheelMove = new Vec3(0, 0, surfaceZoomed ? 0 : -wheel[0]);
        v.add(wheelMove.mulScalar(this.wheelSpeed * dt));
        // FIXME: need to flip z axis for orbit camera
        deltas.move.append([v.x, v.y, orbit ? -v.z : v.z]);

        // desktop rotate / sky rotate (Alt + left drag)
        const skyRotate = this._state.alt && this._state.mouse[0] > 0 && !desktopPan && (mouse[0] !== 0 || mouse[1] !== 0);
        const skyboxValue = this._observer.get('skybox.value');
        const canSkyRotate = skyboxValue && skyboxValue !== 'None';

        if (skyRotate && canSkyRotate) {
            const current = (this._observer.get('skybox.rotation') as number) ?? 0;
            const delta = -mouse[0] * this.skyRotationSpeed;
            let next = current + delta;
            while (next > 180) next -= 360;
            while (next < -180) next += 360;
            this._observer.set('skybox.rotation', next);
            deltas.rotate.append([0, 0, 0]);
        } else {
            v.set(0, 0, 0);
            const mouseRotate = new Vec3(mouse[0], mouse[1], 0);
            v.add(mouseRotate.mulScalar((1 - desktopPan) * this.orbitSpeed * dt));
            deltas.rotate.append([v.x, v.y, v.z]);
        }

        // mobile move
        v.set(0, 0, 0);
        const orbitMove = screenToWorld(this._camera, touch[0], touch[1], distance);
        v.add(orbitMove.mulScalar(orbit * touchPan));
        const flyMove = new Vec3(leftInput[0], 0, -leftInput[1]);
        v.add(flyMove.mulScalar(fly * this.moveSpeed * this.flySpeed * dt));
        const pinchMove = new Vec3(0, 0, pinch[0]);
        v.add(pinchMove.mulScalar(orbit * double * this.pinchSpeed * dt));
        deltas.move.append([v.x, v.y, v.z]);

        // mobile rotate
        v.set(0, 0, 0);
        const orbitRotate = new Vec3(touch[0], touch[1], 0);
        v.add(orbitRotate.mulScalar(orbit * (1 - touchPan) * this.orbitSpeed * dt));
        const flyRotate = new Vec3(rightInput[0], rightInput[1], 0);
        v.add(flyRotate.mulScalar(fly * this.orbitSpeed * dt));
        deltas.rotate.append([v.x, v.y, v.z]);

        // gamepad move
        v.set(0, 0, 0);
        const stickMove = new Vec3(leftStick[0], 0, -leftStick[1]);
        v.add(stickMove.mulScalar(this.moveSpeed * (fly ? this.flySpeed : 1) * dt));
        deltas.move.append([v.x, v.y, v.z]);

        // gamepad rotate
        v.set(0, 0, 0);
        const stickRotate = new Vec3(rightStick[0], rightStick[1], 0);
        v.add(stickRotate.mulScalar(this.orbitSpeed * dt));
        deltas.rotate.append([v.x, v.y, v.z]);

        // Выбег отбирает ввод у штатного контроллера, поэтому любое нажатие кнопки мыши его
        // прерывает: иначе следующий жест пришлось бы ждать, пока модель довернётся. Через
        // `beginSurfaceOrbit` это не закрыть — при активном инструменте его не зовут вовсе.
        if (this._surfaceOrbit?.phase === 'coasting' && this._state.mouse.some(count => count > 0)) {
            this.finishSurfaceOrbit();
        }

        // Pending/active surface gestures consume ordinary input so the stock OrbitController
        // cannot rotate around its old central focus at the same time.
        if (this._surfaceOrbit || this._surfacePan) {
            frame.read();
            const orbiting = this._surfaceOrbit?.phase;
            if (orbiting === 'active' || orbiting === 'coasting') this.applySurfaceOrbit(dt);
            if (this._surfacePan?.phase === 'active') this.applySurfacePan();
            // Выбег закончился — возвращаем ввод штатному контроллеру.
            if (this._surfaceOrbit?.phase === 'coasting' && this._surfaceOrbitVelocity.length() === 0) {
                this.finishSurfaceOrbit();
            }
        } else {
            this._pose.copy(this._controller.update(frame, dt));
        }
        this._camera.entity.setPosition(this._pose.position);
        this._camera.entity.setEulerAngles(this._pose.angles);

        // Ортогональная камера: зум (колесо) меняет distance как в перспективе, а размер
        // кадра выводим из distance → orthoHeight. Иначе orthoHeight фиксирован и зум «не работает».
        if (this._camera.projection !== PROJECTION_PERSPECTIVE) {
            const half = Math.tan(0.5 * this._camera.fov * Math.PI / 180);
            this._camera.orthoHeight = Math.max(0.001, this._pose.distance * half);
        }
    }

    destroy() {
        window.removeEventListener('keydown', this._onKeyDown);
        window.removeEventListener('keyup', this._onKeyUp);
        this._desktopInput.destroy();
        this._orbitMobileInput.destroy();
        this._flyMobileInput.destroy();
        this._gamepadInput.destroy();

        this._flyController.destroy();
        this._orbitController.destroy();
    }
}

export { CameraControls };
