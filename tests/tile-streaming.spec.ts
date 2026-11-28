import { expect, test, type Page } from '@playwright/test';

const box = [0, 0, 0, 4, 0, 0, 0, 4, 0, 0, 0, 4];
const setup = async (page: Page, failLeaf = false) => {
    let releaseBranch: () => void;
    const branchReady = new Promise<void>(resolve => { releaseBranch = resolve; });
    await page.route('**/streaming-check/*.json', async (route) => {
        const pathname = new URL(route.request().url()).pathname;
        if (!pathname.endsWith('/branch.json') && !pathname.endsWith('/tileset.json')) {
            await route.fulfill({ status: 404, body: 'no settings sidecar' });
            return;
        }
        if (route.request().url().endsWith('/branch.json')) {
            await branchReady;
            await route.fulfill({ json: { asset: { version: '1.1' }, geometricError: 0, root: {
                boundingVolume: { box }, geometricError: 0,
                children: [{ boundingVolume: { box }, geometricError: 0, content: { uri: failLeaf ? 'missing.glb' : 'right.glb' } }]
            } } });
        } else {
            await route.fulfill({ json: { asset: { version: '1.1' }, geometricError: 100, root: {
                boundingVolume: { box }, geometricError: 100, refine: 'REPLACE', content: { uri: 'parent.glb' },
                children: [
                    { boundingVolume: { box }, geometricError: 0, content: { uri: 'left.glb' } },
                    { boundingVolume: { box }, geometricError: 0, content: { uri: 'branch.json' } }
                ]
            } } });
        }
    });
    await page.route('**/streaming-check/*.glb', async (route) => {
        if (route.request().url().endsWith('/missing.glb')) {
            await route.fulfill({ status: 404, body: 'missing tile' });
        } else {
            const response = await page.request.get('/static/test-assets/BoxTextured.glb');
            await route.fulfill({ response });
        }
    });
    await page.goto('/?webgl&load=streaming-check%2Ftileset.json');
    await page.waitForFunction(() => (window as any).viewer?.tileManager?.rootTile?.state === 'ready');
    await page.evaluate(() => {
        const v = (window as any).viewer;
        const Vec3 = v.camera.getPosition().constructor;
        v.cameraControls.reset(new Vec3(), new Vec3(0, 0, 10));
        v.fitCameraClipPlanes();
        v.renderNextFrame();
    });
    await page.waitForFunction(() => (window as any).viewer.tileManager.rootTile.children[0].state === 'ready');
    return { releaseBranch: () => releaseBranch() };
};

test('REPLACE retains its parent while external metadata is pending and descends zero-error wrappers', async ({ page }) => {
    const { releaseBranch } = await setup(page);
    await expect.poll(() => page.evaluate(() => {
        const root = (window as any).viewer.tileManager.rootTile;
        return { parent: root.selected, child: root.children[0].selected };
    })).toEqual({ parent: true, child: false });
    releaseBranch();
    await page.waitForFunction(() => {
        const root = (window as any).viewer.tileManager.rootTile;
        return !root.selected && root.children[0].selected && root.children[1].externalRoot?.children[0].selected;
    });
    const state = await page.evaluate(() => {
        const m = (window as any).viewer.tileManager;
        return { stats: m.getStats(), meshes: m.getVisibleMeshInstances().length };
    });
    expect(state.stats.tiles).toBe(5);
    expect(state.stats.selected).toBe(2);
    expect(state.stats.ready).toBe(4);
    expect(state.meshes).toBe(2);
    const released = await page.evaluate(() => {
        const manager = (window as any).viewer.tileManager;
        const nested = manager.rootTile.children[1].externalRoot.children[0];
        manager.destroy();
        return { state: nested.state, entity: nested.entity, assets: nested.assets.length };
    });
    expect(released).toEqual({ state: 'unloaded', entity: null, assets: 0 });
});

test('a failed child keeps the nearest ready REPLACE parent instead of leaving a hole', async ({ page }) => {
    const { releaseBranch } = await setup(page, true);
    releaseBranch();
    await page.waitForFunction(() => (window as any).viewer.tileManager.rootTile.children[1].externalRoot?.children[0].state === 'failed');
    await expect.poll(() => page.evaluate(() => {
        const m = (window as any).viewer.tileManager;
        return { parent: m.rootTile.selected, left: m.rootTile.children[0].selected, failed: m.getStats().failed, visible: m.getVisibleMeshInstances().length };
    })).toEqual({ parent: true, left: false, failed: 1, visible: 1 });
});

test('external JSON shares the bounded load queue with geometry', async ({ page }) => {
    let active = 0;
    let peak = 0;
    let finished = 0;
    await page.route('**/fanout/*.json', async (route) => {
        if (route.request().url().endsWith('/tileset.json')) {
            await route.fulfill({ json: { asset: { version: '1.1' }, geometricError: 100, root: {
                boundingVolume: { box }, geometricError: 100, refine: 'REPLACE',
                children: Array.from({ length: 16 }, (_, i) => ({ boundingVolume: { box }, geometricError: 0, content: { uri: `${i}.json` } }))
            } } });
        } else if (/\/\d+\.json$/.test(new URL(route.request().url()).pathname)) {
            active++; peak = Math.max(peak, active);
            await new Promise(resolve => setTimeout(resolve, 120));
            await route.fulfill({ json: { asset: { version: '1.1' }, geometricError: 0, root: { boundingVolume: { box }, geometricError: 0 } } });
            active--; finished++;
        } else {
            await route.fulfill({ status: 404, body: 'no settings sidecar' });
        }
    });
    await page.goto('/?webgl&load=fanout%2Ftileset.json');
    await page.waitForFunction(() => !!(window as any).viewer?.tileManager?.rootTile);
    await page.evaluate(() => {
        const v = (window as any).viewer; const Vec3 = v.camera.getPosition().constructor;
        v.cameraControls.reset(new Vec3(), new Vec3(0, 0, 10)); v.renderNextFrame();
    });
    await expect.poll(() => finished, { timeout: 30000 }).toBe(16);
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(6);
});

test('walking stops at missing ground and resumes when streamed geometry returns', async ({ page }) => {
    await page.goto('/?webgl&load=static%2Ftest-assets%2FBoxTextured.glb');
    await page.waitForFunction(() => (window as any).viewer?.meshInstances.length > 0 && !(window as any).viewer.observer.get('ui.spinner'));
    const result = await page.evaluate(() => {
        const c = (window as any).viewer.cameraControls;
        const Vec3 = c.getPosition().constructor;
        const originalProbe = c._walkSurfaceProbe;
        c.placeOnWalkSurface(new Vec3());
        const previous = c.getPosition();
        try {
            c._walkSurfaceProbe = () => null;
            for (let i = 0; i < 120; i++) {
                c._pose.position.x += 0.1;
                c.constrainWalk(previous, 1 / 60);
            }
            const held = c.getPosition().toArray();
            c._walkSurfaceProbe = (origin: any, direction: any) => direction.y < -0.9 ? {
                point: new Vec3(origin.x, 0, origin.z), normal: new Vec3(0, 1, 0), distance: origin.y
            } : null;
            c._pose.position.x += 0.1;
            c.constrainWalk(previous, 1 / 60);
            return { previous: previous.toArray(), held, resumed: c.getPosition().toArray(), grounded: c._walkGrounded };
        } finally { c._walkSurfaceProbe = originalProbe; }
    });
    expect(result.held).toEqual(result.previous);
    expect(result.resumed[0]).toBeCloseTo(result.previous[0] + 0.1, 5);
    expect(result.resumed[1]).toBeCloseTo(result.previous[1], 5);
    expect(result.grounded).toBe(true);
});
