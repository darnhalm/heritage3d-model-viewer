# Изменения после форка PlayCanvas Model Viewer

Документ описывает все новшества, добавленные после форка оригинального репозитория [playcanvas/model-viewer](https://github.com/playcanvas/model-viewer) (базовая версия 5.8.1).

---

## 1. Режим измерения (Measurement Mode)

**Описание:** Режим двухточечного измерения расстояний на поверхности 3D-модели.

**Функции:**
- Включение/выключение через Toggle **Measure Mode** в панели Settings
- Два клика по модели: первый — точка A, второй — точка B; сразу вычисляется расстояние
- Единицы отображения: **mm**, **cm**, **m** (выбор через Select)
- Редактируемый масштаб: **1 Unit = (m)** — сколько метров в одной единице координат модели (glTF часто использует 1 unit = 1 m)
- Визуализация: SVG-линия между точками, крестики на концах, подпись с расстоянием у середины линии
- Поле **Known distance** — известное реальное расстояние между двумя измеренными точками (в выбранных единицах mm/cm/m)
- Кнопка **RECALCULATE SCENE SIZE** — пересчитывает `unitScale` по формуле: если вы измерили 2 точки и знаете, что расстояние между ними = Known distance, масштаб подстраивается автоматически
- Кнопка **CLEAR MEASUREMENT** для сброса точек и результата

**Технические детали:**
- Точки не сбрасываются при orbit (левый клик + drag): порог **5 px** между `mousedown` и `mouseup` — если мышь сместилась сильнее, событие считается drag, а не кликом
- Overlay строится из SVG + DOM-элементов поверх canvas (`pointer-events: none`), чтобы не участвовать в глубине и всегда быть поверх сцены
- Проекция 3D→2D через `camera.worldToScreen()` для обновления позиций линий при движении камеры

---

## 2. Экспорт и импорт настроек вьюера

**Описание:** Сохранение и загрузка настроек сцены (камера, небо, свет, debug, measure, WebGPU и т.п.) в JSON-файл.

**Функции:**
- Кнопка **EXPORT VIEWER SETTINGS** в панели View/Share — скачивает файл `{имя-модели}.model-viewer-settings.json`
- В орбитальном режиме сохраняются `camera.position` и `camera.focus` для восстановления ракурса
- **Автоподхват настроек:** при загрузке модели по URL вьюер ищет в том же каталоге файл `имя.model-viewer-settings.json` (и варианты с `(1)`, `(2)` и т.д. в имени) и применяет их автоматически
- Таймаут запроса автоподхвата: 5 с

**Формат JSON:**
- Версия: `modelViewerSettingsVersion: 1`
- Разделы: `camera`, `skybox`, `light`, `debug`, `shadowCatcher`, `measure`, `enableWebGPU`
- Цвета сохраняются в HEX (`#rrggbb`) для однозначной сериализации

**Применение:**
- При загрузке из файла применяется whitelist путей (`SETTINGS_APPLY_KEYS`); исключаются `skybox.options`, `debug.renderMode` и подобные служебные поля

---

## 3. Документация

| Файл | Назначение |
|------|------------|
| `docs/FEATURE-WISHES.md` | Идеи и пожелания по новым функциям |
| `docs/SCENE-SIZES.md` | Размеры сцены, единицы, zoom, camera, grid |
| `docs/STATE-HIERARCHY.md` | Иерархия состояния observer для сохранения/загрузки |
| `docs/UI-ELEMENTS.md` | Описание панелей и элементов UI (Camera, Sky, Light, Settings, View) |
| `docs/model-viewer-window-design.svg` | SVG-макет окна вьюера и элементов интерфейса |

---

## 4. Вспомогательные изменения

- **Иконки во вкладке Materials:** слева от надписей отображаются иконки в `static/icons/` — `final-render-icon.svg` (Final Render), `diffuse-icon.svg` (Base Color), `metalness-icon.svg` (Metalness)
- **CameraControls:** методы `getPosition()` и `getFocus()` для экспорта позиции и фокуса камеры
- **Drop handler:** интерфейс `File` вынесен в `types.ts`, типизация `globalThis.File`
- **Стили (`style.scss`):** классы `.measure-overlay`, `.measure-svg`, `.measure-line`, `.measure-cross`, `.measure-label` для визуализации измерений

---

## Технологии и подходы

| Область | Подход / технология |
|---------|---------------------|
| **Состояние UI** | [PlayCanvas Observer](https://github.com/playcanvas/playcanvas-observer) — реактивное дерево данных, подписка на пути (`observer.set`, `observer.get`, `observer.on`) |
| **UI-компоненты** | [PCUI](https://github.com/playcanvas/pcui) (React) — Toggle, Select, Numeric, Button, Detail, Slider, ColorPicker |
| **Пикинг по модели** | Существующий `Picker` (raycast) для получения 3D-точки по экранным координатам |
| **Разделение клик / drag** | События `mousedown` → `mousemove` → `mouseup` с порогом смещения 5 px |
| **2D-оверлей измерений** | SVG + HTML поверх canvas, `pointer-events: none`, проекция `worldToScreen` |
| **Оптимизация рендера** | React `shouldComponentUpdate` с выборочным сравнением (`JSON.stringify` нужных веток observer) |
| **Сохранение настроек** | JSON export/import, whitelist путей, сериализация цветов в HEX |
| **Автоподхват настроек** | `fetch` по URL (тот же путь, что у модели, другой файл), таймаут 5 с |

---

## Анализ безопасности

### Что сделано правильно

| Область | Меры |
|---------|------|
| **Вывод измерений** | Используется `textContent`, не `innerHTML` — исключён XSS через подпись расстояния |
| **Валидация `skybox.value`** | При загрузке настроек проверка: значение должно быть `'None'` или входить в `skyboxUrls` |
| **Fetch настроек** | Таймаут 5 с (`AbortController`), только `http(s):` — `blob:` и `data:` не обрабатываются |
| **Экспорт** | Имя файла берётся из имени модели, `Blob` + `URL.createObjectURL` + `revokeObjectURL` — без записи на диск |

### Риски и методы решения

| № | Проблема | Технология | Описание технологии | Методы решения |
|---|----------|------------|---------------------|----------------|
| 1 | Prototype pollution при загрузке настроек | `Object.keys` + path-based `observer.set` | Рекурсивный обход JSON, построение путей вида `camera.__proto__.polluted` — может затронуть прототипы объектов | Фильтровать опасные ключи: `['__proto__', 'constructor', 'prototype']` — пропускать их в `loadRec` |
| 2 | localStorage без whitelist — произвольные пути в observer | `localStorage` + `JSON.parse` + `observer.set` | При XSS злоумышленник пишет в `model-viewer-uistate` любой JSON; `loadOptions` применяет все пути рекурсивно | Перейти на whitelist путей (`SETTINGS_APPLY_KEYS`), применять только разрешённые ветки |
| 3 | Автоподхват настроек — доверие origin модели | `fetch` + Same-Origin policy | Настройки загружаются с того же origin, что и модель; злонамеренный CDN может подставить свои настройки | Информирование пользователя; опция отключения автоподхвата для недоверенных источников |
| 4 | `measure.unitScale` без валидации из JSON | `applyViewerSettings` + числовые значения | Значения `Infinity`, `NaN`, отрицательные числа из JSON передаются в observer без проверки | В `applyViewerSettings` для `measure.unitScale` ограничивать: `clamp(Number(value), 0.000001, 1e6)` с fallback на 1 |
| 5 | Share URL — спецсимволы в query string | Формирование URL + `encodeURIComponent` | `sceneData.urls` с `&`, `=`, `?` ломают структуру `?load=url1&load=url2` | Использовать `encodeURIComponent(url)` для каждого значения `load=` |
