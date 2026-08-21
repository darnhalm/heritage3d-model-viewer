import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './tests',
    // Репозиторий лежит на внешнем томе, где macOS кладёт рядом с каждым файлом
    // AppleDouble-спутник `._имя`. Без этого фильтра Playwright пытается разобрать их как
    // тесты и падает на первом же.
    testIgnore: '**/._*',
    timeout: 30000,
    // На раннере сцены рисуются софтверным ANGLE/SwiftShader, и два воркера успевают
    // занять весь процессор: тест иногда не укладывается в таймаут ещё на создании
    // контекста. Один повтор отделяет такие затыки от настоящих поломок.
    retries: process.env.CI ? 1 : 0,
    use: {
        baseURL: 'http://127.0.0.1:4173',
        headless: true,
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        // Запись видео — это ещё один кодировщик на тот же процессор. Локально она
        // полезна, в CI её цена выше пользы: трассы и скриншотов там достаточно.
        video: process.env.CI ? 'off' : 'retain-on-failure',
        launchOptions: {
            args: [
                '--use-gl=angle',
                '--use-angle=swiftshader',
                '--enable-unsafe-swiftshader',
                '--ignore-gpu-blocklist'
            ]
        }
    },
    webServer: {
        command: 'sh -c "python3 -m http.server 4173 --directory dist >/dev/null 2>&1"',
        url: 'http://127.0.0.1:4173',
        reuseExistingServer: true,
        timeout: 30000
    }
});
