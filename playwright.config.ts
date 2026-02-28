import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './tests',
    timeout: 30000,
    retries: 0,
    use: {
        baseURL: 'http://127.0.0.1:4173',
        headless: true,
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        video: 'retain-on-failure',
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
