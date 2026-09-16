import { defineConfig } from '@playwright/test';

// Hardware browser coverage: the default smoke suite deliberately uses SwiftShader.
export default defineConfig({
    testDir: './tests',
    testMatch: ['**/hdr.spec.ts', '**/material-variants.spec.ts'],
    testIgnore: '**/._*',
    timeout: 60000,
    workers: 1,
    outputDir: '/tmp/model-viewer-hdr-tests',
    use: {
        baseURL: 'http://127.0.0.1:4178',
        channel: 'chrome',
        headless: false,
        viewport: { width: 1280, height: 720 }
    },
    webServer: {
        command: 'python3 -m http.server 4178 --directory dist',
        url: 'http://127.0.0.1:4178',
        reuseExistingServer: true
    }
});
