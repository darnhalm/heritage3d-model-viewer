# HERITAGE3D Viewer

> Форк [PlayCanvas Model Viewer](https://github.com/playcanvas/model-viewer) для задач цифрового наследия, музейных каталогов, аннотирования, измерений и встраивания. Технологическая основа (PlayCanvas Engine, Observer, PCUI, glTF 2.0) сохранена; изменена продуктовая оболочка и добавлены функции ниже.

## Что добавлено по сравнению с оригиналом

- **Файл конфигурации сцены** `*.model-viewer-settings.json` (sidecar рядом с моделью) — воспроизводимый вид: камера, свет, небо, единицы измерения, POI, оверрайды материалов, трансформ сцены. Кнопка **Export viewer settings** / автоподхват при загрузке. *(главный механизм форка)*
- **Режим измерений** — 2 точки, единицы mm/cm/m, калибровка масштаба по известному расстоянию, измерение угла и площади; результаты сохраняются в конфиг.
- **Встраивание (embed)** — query-параметры (`embed`, `ui=full|compact|minimal`, флаги панелей/POI/тура/measure/info), генератор iframe в **View & share**.
- **POI / тур** — точки интереса с проигрывателем, слайд-шоу; список в конфиге, в embed управляется флагами `poi`/`tour`.
- **Метаданные Dublin Core** — вкладка + панель **ID**; `metadata` можно подставлять из JSON при загрузке (для каталогов).
- **Выравнивание объекта** — режим alignment, gizmo move/rotate, центрирование/сброс/fit; **ViewCube** (как в 3ds Max, в режиме выравнивания), жёсткие стандартные виды (сверху/снизу/спереди/сзади/слева/справа), переключатель **орто/перспектива** с зумом колесом в орто.
- **Постобработка (вкладка Effects)** — Bloom, SSAO, Bokeh, цветокор, FXAA, **LUT (.cube 1D/3D)** и др.; очередь эффектов на камере (см. [`docs/POST-EFFECTS.md`](docs/POST-EFFECTS.md)).
- **Локализация UI** — EN / RU / ZH.
- **Переработанная раскладка** — левая сворачиваемая панель (Settings / Alignment / Materials / POI / Metadata / Effects) + центральная нижняя полоса быстрых действий и шаринга.
- **Расширенные материалы/дебаг, morph targets, снимки** (PNG + обложка 1:1), кастомные HDRI.
- **Брендинг** HERITAGE3D + расширенная документация в [`docs/`](docs/).

📄 Подробное сравнение: [`docs/FORK-VS-UPSTREAM.md`](docs/FORK-VS-UPSTREAM.md) · история правок: [`docs/CHANGELOG-FORK.md`](docs/CHANGELOG-FORK.md)

> ⚠️ Ветка `main` содержит Heritage3D-форк; обновления upstream PlayCanvas (WebXR, новый picker) пока не влиты.

---

# PlayCanvas Model Viewer (оригинальный README)

[![Github Release](https://img.shields.io/github/v/release/playcanvas/model-viewer)](https://github.com/playcanvas/model-viewer/releases)
[![License](https://img.shields.io/github/license/playcanvas/model-viewer)](https://github.com/playcanvas/model-viewer/blob/main/LICENSE)
[![Discord](https://img.shields.io/badge/Discord-5865F2?style=flat&logo=discord&logoColor=white&color=black)](https://discord.gg/RSaMRzg)
[![Reddit](https://img.shields.io/badge/Reddit-FF4500?style=flat&logo=reddit&logoColor=white&color=black)](https://www.reddit.com/r/PlayCanvas)
[![X](https://img.shields.io/badge/X-000000?style=flat&logo=x&logoColor=white&color=black)](https://x.com/intent/follow?screen_name=playcanvas)

| [User Manual](https://developer.playcanvas.com) | [API Reference](https://api.playcanvas.com) | [Blog](https://blog.playcanvas.com) | [Forum](https://forum.playcanvas.com) |

The PlayCanvas glTF scene viewer is blazingly fast and 100% compliant with the glTF 2.0 spec.

![PlayCanvas Viewer](https://user-images.githubusercontent.com/11276292/188189268-27d397f2-2085-4d8e-a6b2-4205fd13f0fb.png)

You can find a live version at:

https://playcanvas.com/model-viewer

## Viewing Scenes

The viewer can load any glTF 2.0 scene. Embedded glTF and binary glTF (GLB) can be dragged directly into the 3D view. To load an unpacked glTF scene, drag its parent folder into the 3D view.

You can also drag and drop images into the 3D view to set a background. Options are:

* Single file images are treated as equirectangular projections. Supported formats are PNG, JPG and HDR. Find high quality HDR images at [HDRHaven](https://hdrihaven.com/).
* Six images are treated as cube map faces. Naming should be one of the following 5 forms, where each face name below should be incorporated in the overall filename like `name_posx.png` for example:

| Face 0  | Face 1  | Face 2  | Face 3  | Face 4  | Face 5  |
|---------|---------|---------|---------|---------|---------|
| posx    |  negx   | posy    | negy    | posz    | negz    |
| px      |  nx     | py      | ny      | pz      | nz      |
| right   |  left   | up      | down    | front   | back    |
| right   |  left   | top     | bottom  | forward | backward|
| 0       |  1      | 2       | 3       | 4       | 5       |

### Supported URL Parameters

Some URL query parameters are available to override certain aspects of the viewer:

| Parameter         | Description                          | Example |
|-------------------|--------------------------------------|---------|
| `load`/`assetUrl` | Specify URL to a glTF scene to load  | [?load=URL](https://playcanvas.com/model-viewer/?load=https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/master/2.0/DamagedHelmet/glTF-Binary/DamagedHelmet.glb) |
| `cameraPosition`  | Override the initial camera position | [?cameraPosition=0,0,20](https://playcanvas.com/model-viewer/?load=https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/master/2.0/DamagedHelmet/glTF-Binary/DamagedHelmet.glb&cameraPosition=0,0,20) |

## How to build

Ensure you have [Node.js](https://nodejs.org) installed (v18.0+). Then, from a command prompt, run:

```
npm install
npm run build
```

This will invoke Rollup and output the built viewer to the `dist` folder. To invoke Rollup with the `--watch` flag (which rebuilds the viewer on saving any source file), do:

```
npm run watch
```

## How to run

Run:

    npm run serve

Open a browser and navigate to http://localhost:3000.

### Docker

The viewer is a static site (`dist/` after `npm run build`). You can serve it from a container:

```sh
docker build -t heritage3d-viewer .
docker run --rm -p 8080:80 heritage3d-viewer
```

Then open http://localhost:8080 . WebGL and GPU work in the **browser** on the client machine; the container only hosts HTML/JS/assets.

If you need **CORS** for `?load=` from other origins (like `npm run serve -- --cors`), add a custom `nginx.conf` or use a dev image that runs `npx serve --cors dist`.

### GitLab (Pages / CI)

- **GitLab Pages:** в репозитории есть [`.gitlab-ci.yml`](.gitlab-ci.yml) — пайплайн на ветке по умолчанию собирает проект и публикует содержимое `dist/` как сайт (артефакт `public/`). В проекте включите **Deploy → Pages** и при необходимости поправьте `rules` под вашу ветку.
- **Контейнер:** образ из `Dockerfile` можно собирать в GitLab CI и пушить в **Container Registry**, деплой на свой оркестратор или хостинг по желанию.
- Загрузка моделей по `?load=` с **других доменов** на Pages может потребовать CORS на стороне сервера, отдающего GLB (или прокси в том же origin).

## Development 

Run:

    npm run develop

Open a browser and navigate to http://localhost:3000.

N.B. To load local models run `npx server --cors` in the directory containing the model (disables CORS).

This fork adds developer notes under `docs/` (for example [`docs/POST-EFFECTS.md`](docs/POST-EFFECTS.md) — post-processing and the `autoRender` / `renderNextFrame` contract).

**Heritage3D fork vs upstream:** short comparison for users and integrators — [`docs/FORK-VS-UPSTREAM.md`](docs/FORK-VS-UPSTREAM.md) (Russian). Detailed change list — [`docs/CHANGELOG-FORK.md`](docs/CHANGELOG-FORK.md).

## Library integration testing

The Model Viewer is built on the following open source libraries:

| Library                                                       | Details                                     |
| ------------------------------------------------------------- | ------------------------------------------- |
| [PlayCanvas Engine](https://github.com/playcanvas/engine)     | Powers the Editor's 3D View and Launch Page |
| [Observer](https://github.com/playcanvas/playcanvas-observer) | Data binding and history                    |
| [PCUI](https://github.com/playcanvas/pcui)                    | Front-end component library                 |

To test the integration of these libraries use [npm link](https://docs.npmjs.com/cli/v9/commands/npm-link). Follow these steps:

1. Create a global link from source

    ```sh
    cd <library>
    npm link
    ```

2. Create a link to the global link

    ```sh
    cd model-viewer
    npm link <library>
    ```
