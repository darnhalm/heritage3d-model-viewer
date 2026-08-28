import os from 'node:os';
import path from 'node:path';

import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './tests',
    // Артефакты прогона (видео, трассы, снимки) держим вне репозитория. Он лежит на внешнем
    // томе exFAT, где macOS кладёт рядом с каждым файлом спутник `._имя`; из-за них Playwright
    // не может очистить свой каталог перед запуском и падает с `ENOTEMPTY`, не начав работу.
    outputDir: path.join(os.tmpdir(), 'model-viewer-playwright'),
    // Репозиторий лежит на внешнем томе, где macOS кладёт рядом с каждым файлом
    // AppleDouble-спутник `._имя`. Без этого фильтра Playwright пытается разобрать их как
    // тесты и падает на первом же.
    testIgnore: '**/._*',
    timeout: 30000,
    // Сцены рисуются софтверным ANGLE/SwiftShader, и браузеры не делят процессор мирно:
    // тест не укладывается в таймаут ещё на создании контекста. Локально Playwright берёт
    // половину логических ядер (на восьми — четыре воркера), и полный прогон стабильно
    // показывал 7-8 красных, которые все до одного проходят при `--workers=1`.
    //
    // Повтор эту беду не лечит: вторая попытка идёт в том же перегруженном прогоне и
    // упирается в то же самое — проверено, все семь упали дважды. Поэтому локально
    // работает один воркер: прогон длиннее, зато его результату можно верить без ручной
    // перепроверки. На раннере воркеров и так немного, там оставлен повтор.
    workers: process.env.CI ? undefined : 1,
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
