import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';
export default defineConfig({
    testDir: '.', testMatch: 'viewer.spec.ts', workers: 1, timeout: 60000,
    outputDir: '/tmp/heritage3d-addon-browser-tests',
    use: { baseURL: 'http://127.0.0.1:4178', channel: 'chrome', headless: false, viewport: { width: 800, height: 600 } },
    webServer: { command: `python3 -m http.server 4178 --directory "${resolve(__dirname, '../../dist')}"`, url: 'http://127.0.0.1:4178', reuseExistingServer: true }
});
