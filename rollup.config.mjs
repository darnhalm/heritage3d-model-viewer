// official rollup plugins
import fs from 'fs';
import path from 'path';

import alias from '@rollup/plugin-alias';
import commonjs from '@rollup/plugin-commonjs';
import image from '@rollup/plugin-image';
import json from '@rollup/plugin-json';
import resolve from '@rollup/plugin-node-resolve';
import replace from '@rollup/plugin-replace';
import terser from '@rollup/plugin-terser';
import typescript from '@rollup/plugin-typescript';
import sass from 'rollup-plugin-sass';

// custom plugins
import { copyAndWatch } from './plugins/copy-and-watch.mjs';

// debug, profile, release
const BUILD_TYPE = process.env.BUILD_TYPE || 'release';
const ENGINE_DIR = path.resolve(`node_modules/playcanvas/build/playcanvas${BUILD_TYPE === 'debug' ? '.dbg' : ''}/src/index.js`);

const BLUE_OUT = '\x1b[34m';
const BOLD_OUT = '\x1b[1m';
const REGULAR_OUT = '\x1b[22m';
const RESET_OUT = '\x1b[0m';

/**
 * Порог встраивания иконки в CSS, байты.
 *
 * Иконки панелей — отдельные запросы, и браузер тянет их по мере того, как элементы
 * появляются в разметке. Из-за этого нижняя панель проявляется рвано: кнопки уже на месте,
 * а картинки в них доезжают одна за другой, и это читается как подтормаживание. Встроенные
 * в стиль иконки приходят вместе с ним и рисуются разом.
 *
 * Порог нужен, потому что встраивание раздувает CSS на треть от размера файла (base64 — плюс
 * 33%), а CSS грузится до первого кадра. Две иконки материалов весят 68 и 33 КБ — их
 * встраивать нельзя, они и так показываются только в открытой панели.
 */
const ICON_INLINE_LIMIT = 8 * 1024;

/**
 * Встроить мелкие SVG-иконки в CSS как data-URI.
 *
 * @param {string} css - Собранный CSS.
 * @returns {string} CSS, в котором ссылки на мелкие иконки заменены на встроенные данные.
 */
const inlineSmallIcons = (css) => {
    let inlined = 0;
    let skipped = 0;
    const out = css.replace(/url\(\.?\/?(static\/icons\/[\w-]+\.svg)\)/g, (match, rel) => {
        const file = path.resolve(rel);
        if (!fs.existsSync(file) || fs.statSync(file).size > ICON_INLINE_LIMIT) {
            skipped++;
            return match;
        }
        const svg = fs.readFileSync(file, 'utf8');
        inlined++;
        return `url("data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}")`;
    });
    console.log(`${BLUE_OUT}icons inlined ${BOLD_OUT}${inlined}${REGULAR_OUT}, left as files ${BOLD_OUT}${skipped}${REGULAR_OUT}${RESET_OUT}`);
    return out;
};

const title = [
    'Building PlayCanvas Model Viewer',
    `type ${BOLD_OUT}${BUILD_TYPE}${REGULAR_OUT}`,
    `engine ${BOLD_OUT}${ENGINE_DIR}${REGULAR_OUT}`
].map(l => `${BLUE_OUT}${l}`).join('\n');
console.log(`${BLUE_OUT}${title}${RESET_OUT}\n`);

const TARGETS = [
    { src: 'LICENSE' },
    {
        src: 'src/index.html',
        transform: (contents) => {
            return contents.toString()
            .replace('__BASE_HREF__', process.env.BASE_HREF || '')
            .replace('__');
        }
    },
    { src: 'src/manifest.json' },
    { src: 'src/fonts.css' },
    { src: 'static/' }
];

export default {
    input: 'src/index.tsx',
    output: {
        dir: 'dist',
        format: 'esm',
        sourcemap: true
    },
    treeshake: 'smallest',
    onwarn(warning, warn) {
        // Suppress "use client" directive warnings from react-intersection-observer
        if (warning.code === 'MODULE_LEVEL_DIRECTIVE' && warning.message.includes('"use client"')) {
            return;
        }
        warn(warning);
    },
    plugins: [
        copyAndWatch(TARGETS),
        replace({
            values: {
                // NOTE: this is required for react (??) - see https://github.com/rollup/rollup/issues/487#issuecomment-177596512
                'process.env.NODE_ENV': JSON.stringify(BUILD_TYPE === 'release' ? 'production' : 'development')
            },
            preventAssignment: true
        }),
        sass({
            insert: false,
            output: 'dist/style.css',
            outputStyle: 'compressed',
            api: 'modern',
            processor: inlineSmallIcons
        }),
        image({ dom: true }),
        alias({
            entries: {
                'playcanvas': ENGINE_DIR
            }
        }),
        commonjs(),
        resolve(),
        typescript({
            tsconfig: './tsconfig.json'
        }),
        json(),
        (BUILD_TYPE !== 'debug') && terser({
            mangle: {
                // script classes can't be mangeled
                reserved: ['CameraControls']
            }
        })
    ]
};
