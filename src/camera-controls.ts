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

    orbitSpeed = 18;

    pinchSpeed = 0.4;

    wheelSpeed = 0.06;

    gamepadDeadZone: Vec2 = new Vec2(0.3, 0.6);

    constructor(app: AppBase, camera: CameraComponent, observer: Observer) {
        this._app = app;
        this._camera = camera;
        this._observer = observer;

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

    set mode(mode: 'orbit' | 'fly') {
        // check if mode is the same
        if (this._mode === mode) {
            return;
        }
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
        this._controller.attach(pose.look(position, focus));
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

    update(dt: number) {
        // read inputs (to clear their state) even when disabled
        const { key, button, mouse, wheel } = this._desktopInput.read();
        const { touch, pinch, count } = this._orbitMobileInput.read();
        const { leftInput, rightInput } = this._flyMobileInput.read();
        const { leftStick, rightStick } = this._gamepadInput.read();

        if (!this.enabled) {
            return;
        }

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
        const pan = this._state.mouse[2] || +(button[2] === -1) || double;
        const distance = this._pose.distance;

        const { deltas } = frame;

        // desktop move
        const v = tmpV1.set(0, 0, 0);
        const keyMove = this._state.axis.clone().normalize();
        v.add(keyMove.mulScalar(fly * this.moveSpeed * (this._state.shift ? 2 : this._state.ctrl ? 0.5 : 1) * dt));
        const panMove = screenToWorld(this._camera, mouse[0], mouse[1], distance);
        v.add(panMove.mulScalar(pan));
        const wheelMove = new Vec3(0, 0, -wheel[0]);
        v.add(wheelMove.mulScalar(this.wheelSpeed * dt));
        // FIXME: need to flip z axis for orbit camera
        deltas.move.append([v.x, v.y, orbit ? -v.z : v.z]);

        // desktop rotate / sky rotate (Alt + left drag)
        const skyRotate = this._state.alt && this._state.mouse[0] > 0 && !pan && (mouse[0] !== 0 || mouse[1] !== 0);
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
            v.add(mouseRotate.mulScalar((1 - pan) * this.orbitSpeed * dt));
            deltas.rotate.append([v.x, v.y, v.z]);
        }

        // mobile move
        v.set(0, 0, 0);
        const orbitMove = screenToWorld(this._camera, touch[0], touch[1], distance);
        v.add(orbitMove.mulScalar(orbit * pan));
        const flyMove = new Vec3(leftInput[0], 0, -leftInput[1]);
        v.add(flyMove.mulScalar(fly * this.moveSpeed * dt));
        const pinchMove = new Vec3(0, 0, pinch[0]);
        v.add(pinchMove.mulScalar(orbit * double * this.pinchSpeed * dt));
        deltas.move.append([v.x, v.y, v.z]);

        // mobile rotate
        v.set(0, 0, 0);
        const orbitRotate = new Vec3(touch[0], touch[1], 0);
        v.add(orbitRotate.mulScalar(orbit * (1 - pan) * this.orbitSpeed * dt));
        const flyRotate = new Vec3(rightInput[0], rightInput[1], 0);
        v.add(flyRotate.mulScalar(fly * this.orbitSpeed * dt));
        deltas.rotate.append([v.x, v.y, v.z]);

        // gamepad move
        v.set(0, 0, 0);
        const stickMove = new Vec3(leftStick[0], 0, -leftStick[1]);
        v.add(stickMove.mulScalar(this.moveSpeed * dt));
        deltas.move.append([v.x, v.y, v.z]);

        // gamepad rotate
        v.set(0, 0, 0);
        const stickRotate = new Vec3(rightStick[0], rightStick[1], 0);
        v.add(stickRotate.mulScalar(this.orbitSpeed * dt));
        deltas.rotate.append([v.x, v.y, v.z]);

        // check if XR is active, just read frame to clear it
        if (this._app.xr?.active) {
            frame.read();
            return;
        }

        // update controller by consuming frame
        this._pose.copy(this._controller.update(frame, dt));
        this._camera.entity.setPosition(this._pose.position);
        this._camera.entity.setEulerAngles(this._pose.angles);
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
