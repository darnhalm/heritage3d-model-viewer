import { expect, test } from '@playwright/test';

test('labels compensation and author simulation in one preset list', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('h3d.tour.v1.seen', '1'));
    await page.goto('/');
    await page.waitForFunction(() => !!(window as Window & { viewer?: unknown }).viewer);

    await page.locator('#panel-toggle').click();
    const row = page.locator('.panel-option').filter({ hasText: /CVD profile|Профиль CVD/ });
    const value = row.locator('.pcui-select-input-value');

    await value.click({ force: true });
    await row.locator('#cvd-simulation-protanopia').click({ force: true });

    await expect.poll(() => page.evaluate(() => {
        const viewer = (window as Window & { viewer?: { observer?: { get: (path: string) => unknown } } }).viewer;
        return viewer?.observer?.get('camera.colorLutName');
    })).toBe('cvd-simulation-protanopia.png');
    await expect(value).toHaveText(/Protanopia — sim\.|Протанопия — сим\./);

    await value.click({ force: true });
    await row.locator('#cvd-correction-deuteranopia').click({ force: true });

    await expect.poll(() => page.evaluate(() => {
        const viewer = (window as Window & { viewer?: { observer?: { get: (path: string) => unknown } } }).viewer;
        return viewer?.observer?.get('camera.colorLutName');
    })).toBe('cvd-correction-deuteranopia.png');
    await expect(value).toHaveText(/Deuteranopia — comp\.|Дейтеранопия — комп\./);

    await value.click({ force: true });
    await row.locator('#__no_color_vision_profile__').click({ force: true });

    await expect.poll(() => page.evaluate(() => {
        const viewer = (window as Window & { viewer?: { observer?: { get: (path: string) => unknown } } }).viewer;
        return viewer?.observer?.get('camera.colorLutName');
    })).toBe('');
    await expect(value).toHaveText(/No colour vision profile|Без профиля/);
});
