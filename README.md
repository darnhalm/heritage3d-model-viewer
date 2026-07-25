# HERITAGE3D Viewer

Форк **[PlayCanvas Model Viewer](https://github.com/playcanvas/model-viewer)** (glTF 2.0, движок PlayCanvas, PCUI, Observer) для задач каталогов цифрового наследия, встраивания и работы со сценой. Технологическая основа сохранена; изменена продуктовая оболочка и добавлены функции ниже.

> Детальный перечень правок и заметки по безопасности — в [`docs/CHANGELOG-FORK.md`](docs/CHANGELOG-FORK.md); про постобработку — в [`docs/POST-EFFECTS.md`](docs/POST-EFFECTS.md).
>
> ⚠️ Ветка `main` содержит Heritage3D-форк; обновления upstream PlayCanvas (WebXR, новый picker) пока не влиты.

---

## Файл конфигурации сцены (`*.model-viewer-settings.json`)

**Главный механизм форка**, если нужно хранить и воспроизводить сцену «как в каталоге»: не только модель, но и камеру, свет, небо, единицы измерения, POI, оверрайды материалов, трансформ сцены и т.д. В оригинальном PlayCanvas Model Viewer **нет** такого согласованного sidecar-файла рядом с ассетом как части рабочего процесса.

| Аспект | Как устроено |
|--------|----------------|
| **Имя файла** | `{базовое-имя-модели}.model-viewer-settings.json` в **том же каталоге**, что и модель (при загрузке по URL). Варианты `…(1).json` … `…(20).json` — как при повторном скачивании в Chrome; если несколько найдено, берётся файл с **наибольшим** номером в скобках. |
| **Версия формата** | В корне JSON: `modelViewerSettingsVersion: 1`. |
| **Как получить** | Кнопка **EXPORT VIEWER SETTINGS** в панели **View & share** — скачивает JSON с именем от первой загруженной модели. |
| **Как применяется** | После загрузки модели **автоматически** запрашивается sidecar с тем же базовым именем. При отсутствии файла часть состояния сбрасывается к умолчанию. |
| **Что внутри (экспорт)** | `camera`, `skybox`, `light`, `debug`, `shadowCatcher`, `measure`, `dimensionBox`, `poi` (список точек), `enableWebGPU`, при наличии — `materialOverrides`, всегда — `sceneTransform`. В режиме **orbit** в `camera` дополнительно сохраняются `position` и `focus`. Цвета — **HEX-строки** (`#rrggbb`). |
| **Whitelist применения** | При импорте применяются только ключи из `SETTINGS_APPLY_KEYS` (`camera, skybox, light, debug, shadowCatcher, measure, dimensionBox, poi, enableWebGPU`). Постобработка (`posteffects`) в экспорт пока не входит. |
| **Ограничения** | Максимальный размер файла **10 MB**; для удалённой загрузки — таймауты и проверки (см. `src/viewer/settings-service.ts`). |

**Зачем это важно:** один GLB на CDN + один JSON рядом дают **воспроизводимый вид** (ракурс, окружение, масштаб измерений, тур) без ручного кликанья в UI.

---

## Раскладка UI

**Оригинал:** нижняя полоска с быстрым доступом к панелям Camera / Sky / Light / Settings.

**Форк:**
- **Левая сворачиваемая панель** — вкладки **Settings** (камера, небо, свет, дебаг), **Object Alignment**, **Materials**, **POI**, **Effects** (постобработка).
- **Центральная полоса внизу** — анимация, **Info**, HD/SD, **Measurement**, **View & share**, кадрирование, Orbit/Fly, полный экран; часть пунктов открывает всплывающие панели.
- Переключатель **языка** (EN / RU / ZH) на левой панели (во внешнем режиме).

Это не «те же кнопки в другом порядке», а **другая структура**: сцена и расширенные инструменты слева, быстрые действия и шаринг по центру снизу.

---

## Функции, которых нет в типичном апстриме (или они сильно проще)

1. **Режим измерений** — две точки на модели, единицы mm/cm/m, масштаб «1 unit = … m», известное расстояние и пересчёт масштаба сцены, измерение угла и площади, оверлей линии/подписи (сохраняется в файле конфигурации).
2. **Режим встраивания (embed)** — query-параметры (`embed`, `ui=full|compact|minimal`, отдельные флаги панели, измерений, info и т.д.), генератор iframe в **View & share**.
3. **Локализация** — строки через `src/i18n/translations.ts`, три языка в UI.
4. **POI / тур** — вкладка и проигрыватель точек интереса, слайд-шоу (список POI входит в файл конфигурации; в embed управляется флагами `poi` / `tour`).
5. **Выравнивание объекта** — режим alignment, gizmo move/rotate, центрирование, сброс, fit (`sceneTransform` сохраняется в JSON). Дополнительно: **ViewCube** (как в 3ds Max, виден только в режиме выравнивания), жёсткие стандартные виды (сверху/снизу/спереди/сзади/слева/справа), переключатель **орто/перспектива** с зумом колесом в ортогональном режиме. Размерный бокс (`dimensionBox`) тоже сохраняется в конфиг.
6. **Вкладка Effects** — цепочка постобработки (Bloom, SSAO, Bokeh, цветокор, FXAA, **LUT .cube 1D/3D** и др.), см. [`docs/POST-EFFECTS.md`](docs/POST-EFFECTS.md) (контракт `autoRender` / `renderNextFrame`). Параметры эффектов **пока не сериализуются** в `model-viewer-settings.json`.
7. **Расширенные материалы и дебаг** — иконки каналов, варианты glTF, texel density, UV и пр. (для gaussian splat часть вкладок скрывается).
8. **Morph targets** в панели **Info** → **Model**.
9. **Снимки** из **View & share** — PNG, обложка 1:1; кастомные HDRI-окружения.
10. **Универсальные хелперы** — обобщённые вспомогательные объекты в сцене с позицией / видимостью / редактируемостью, управляемые хостом через postMessage (`helper:set` / `helper:set-many` / `helper:clear` / `helper:visibility` / `helper:editable`). Это нейтральный механизм плеера; как его использовать (микрофоны, точки звукоизвлечения и т.п.) — решает хост-приложение.

> Метаданные (Dublin Core / ЕГРОКН / Госкаталог) **вынесены из плеера** — источник правды теперь портал-каталог (etnophonica), а не вьюер.

---

## Интеграция: встраивание и `postMessage`-API

Главное отличие форка для интеграторов: вьюер встраивается в `<iframe>` и **двусторонне** общается с хост-страницей через `window.postMessage`. В оригинале PlayCanvas такого протокола управления нет.

**Встраивание (iframe + query-параметры):** `embed`, `ui=full|compact|minimal`, флаги панелей/POI/тура/измерений/info; готовый iframe генерируется в панели **View & share**. Также URL-параметры загрузки: `assetUrl`/`load`, `id`/`efkId`, `cameraPosition`, `cameraFocus`.

**Команды хост → вьюер** (`iframe.contentWindow.postMessage({...}, '*')`):

| Группа | Команды |
|---|---|
| POI / навигация | `focus-poi`, `open-poi`, `clear-poi`, `next-poi`, `prev-poi`, `focus-system` |
| Анимация | `play-animation`, `pause-animation`, `seek-animation` (по `time`/`frame`+`fps`), `freeze-animation` |
| Звуковые триггеры | `set-trigger-note` |
| Универсальные хелперы | `helper:set`, `helper:set-many`, `helper:clear`, `helper:visibility`, `helper:editable` |
| Загрузка/камера | `load`/`assetUrl`, `id`/`efkId`, `cameraPosition`, `cameraFocus`, `dummyWebGPU` |
| Экспорт (запрос→ответ по `requestId`) | `export-settings`, `export-cover`, `export-project` |

**События вьюер → хост** (через `postMessage` на родителя):

| Событие | Когда |
|---|---|
| `init` | вьюер готов |
| `poi-selected` / `poi-cleared` | выбор/сброс точки интереса |
| `animation-time` | тик времени анимации |
| `dimensionbox-changed` | изменён размерный бокс |
| `trigger-note-set` / `audio-source` | звуковые триггеры/источник |
| `export-settings-result` / `export-cover-result` / `export-project-result` / `export-error` | результат соответствующего запроса (с `requestId`) |

> Плеер предоставляет **нейтральные** примитивы (хелперы, POI, анимация). Доменные надстройки — например, **микрофоны и пространственный звук** — реализованы на стороне хоста (etnophonica) поверх этих хелперов, а не в самом плеере.

📄 Полная спецификация: [`docs/api/EMBED-API.md`](docs/api/EMBED-API.md) (формат сообщений, примеры приёма событий), [`docs/api/API-COMMANDS-RU.md`](docs/api/API-COMMANDS-RU.md) (HTTP-API портала + postMessage + capabilities/policy), OpenAPI — [`docs/api/openapi.yaml`](docs/api/openapi.yaml).

---

## Что остаётся «как у PlayCanvas»

- Загрузка **glTF / GLB** и связанные возможности движка.
- Камера орбита / fly, небо, свет, анимации, выбор камеры из glTF.
- Базовый стек: **PlayCanvas Engine**, **Observer**, **PCUI (React)**. Лицензия — **MIT**.

📄 Расширенная версия этого сравнения: [`docs/FORK-VS-UPSTREAM.md`](docs/FORK-VS-UPSTREAM.md)

---

_Основано на [PlayCanvas Model Viewer](https://github.com/playcanvas/model-viewer) (MIT). Документация апстрима — в его репозитории._
