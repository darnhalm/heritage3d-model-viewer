# Элементы UI: Camera, Sky, Light, Settings, Share (View)

Документ описывает все панели и кнопки всплывающего UI (popup) в Model Viewer: **Camera**, **Sky**, **Light**, **Settings** и **Share (View)**.

---

## Где находится UI

- **Файлы:** `src/ui/popup-panel/index.tsx`, `src/ui/popup-panel/panels.tsx`
- **Кнопки панелей:** контейнер `#popup-buttons-parent`, класс кнопок `.popup-button`
- **Панели:** контейнер `#popup`, класс панелей `.popup-panel`, родитель `.popup-panel-parent`
- **Показ панели:** через `ui.active` (`'camera'` | `'skybox'` | `'light'` | `'settings'` | `'view'`)

---

## 1. Camera (Камера)

**Кнопка:** `icon='E212'`, `onClick` → `handleClick('camera')`  
**Панель:** `CameraPanel` в `panels.tsx`, показывается при `ui.active === 'camera'`.

| Элемент UI | Тип | Observer path | Описание |
|------------|-----|---------------|----------|
| Active Camera | Select | `scene.selectedCamera` | Выбор камеры: Viewer или камеры из сцены (glTF) |
| Fov | Slider (35–150) | `camera.fov` | Поле зрения (только для Viewer) |
| Tonemap | Select | `camera.tonemapping` | None, Linear, Neutral, Filmic, Hejl, ACES, ACES2 |
| Pixel Scale | Select (1,2,4,8,16) | `camera.pixelScale` | Масштаб пикселей |
| Viewport | Detail (read-only) | — | `runtime.viewportWidth x runtime.viewportHeight` |
| Multisample | Toggle | `camera.multisample` | Включение мультисэмплинга (если поддерживается) |
| High Quality | Toggle | `camera.hq` | Высокое качество (отключено при анимации/stats) |

**Кнопка переключения режима камеры (орбита / WASD):**
- **ID и класс:** `#camera-mode-button`, `.camera-mode-button`
- **Observer path:** `camera.mode` — значение `'orbit'` или `'fly'`
- **Поведение:** по клику переключает режим: **Orbit** (вращение вокруг модели, колёсико — zoom) ↔ **Fly** (свободное перемещение WASD, мышь — поворот)
- **Расположение:** в контейнере `#floating-bottom-parent` (внизу popup), не внутри панели Camera
- **В коде:** `popup-panel/index.tsx` — кнопка с `onClick` → `setProperty('camera.mode', mode === 'orbit' ? 'fly' : 'orbit')`

---

## 2. Sky (Небо / Skybox)

**Кнопка:** `icon='E200'`, `handleClick('skybox')`  
**Панель:** `SkyboxPanel`, показывается при `ui.active === 'skybox'`.

| Элемент UI | Тип | Observer path | Описание |
|------------|-----|---------------|----------|
| Environment | Select | `skybox.value` | Выбор HDR/карты окружения из списка |
| Exposure | Slider (-6 … 6) | `skybox.exposure` | Экспозиция (если не None) |
| Rotation | Slider (-180 … 180) | `skybox.rotation` | Поворот неба (если не None) |
| Background | Select | `skybox.background` | Solid Color, Infinite Sphere, Projective Dome, Projective Box |
| Background Color | ColorPicker | `skybox.backgroundColor` | Цвет фона (при None или Solid Color) |
| Blur | Slider (0–5) | `skybox.blur` | Размытие (Infinite Sphere) |
| Scale | Numeric (0–1000) | `skybox.domeProjection.domeRadius` | Масштаб для Dome/Box |
| Tripod Offset | Slider (0–1) | `skybox.domeProjection.tripodOffset` | Смещение для Dome/Box |

---

## 3. Light (Свет)

**Кнопка:** `icon='E194'`, `handleClick('light')`  
**Панель:** `LightPanel`, показывается при `ui.active === 'light'`.

| Элемент UI | Тип | Observer path | Описание |
|------------|-----|---------------|----------|
| Enabled | Toggle | `light.enabled` | Включение/выключение света |
| Follow Camera | Toggle | `light.follow` | Свет следует за камерой |
| Color | ColorPicker | `light.color` | Цвет света |
| Intensity | Slider (0–6) | `light.intensity` | Интенсивность |
| Cast Shadow | Toggle | `light.shadow` | Включение теней |
| Shadow Catcher | Toggle | `shadowCatcher.enabled` | Включение плоскости-ловушки теней |
| Catcher Intensity | Slider (0–1) | `shadowCatcher.intensity` | Интенсивность отражения теней |

---

## 4. Settings (Настройки)

**Кнопка:** `icon='E134'`, `handleClick('settings')`  
**Панель:** `SettingsPanel`, показывается при `ui.active === 'settings'`.

| Элемент UI | Тип | Observer path | Описание |
|------------|-----|---------------|----------|
| Current Device | Detail (read-only) | `runtime.activeDeviceType` | WebGPU или WebGL 2 |
| Use WebGPU | Toggle | `enableWebGPU` | Переключение на WebGPU (с перезагрузкой страницы) |
| Render Mode | Select | `debug.renderMode` | Default, Lighting, Albedo, Emissive, WorldNormal, Metalness, Gloss, Ao, Specularity, Opacity, Uv0 |
| Wireframe | ToggleColor | `debug.wireframe`, `debug.wireframeColor` | Каркас и цвет линий |
| Grid | Toggle | `debug.grid` | Сетка |
| Axes | Toggle | `debug.axes` | Оси |
| Skeleton | Toggle | `debug.skeleton` | Скелет |
| Bounds | Toggle | `debug.bounds` | Bounding box |
| Normals | Slider (0–1) | `debug.normals` | Визуализация нормалей |
| Stats | Toggle | `debug.stats` | Статистика (FPS и т.д.) |

---

## 5. Share / View (Просмотр и шаринг)

**Кнопка:** `icon='E301'`, `handleClick('view')`  
**Панель:** `ViewPanel`, контейнер `#view-panel`, показывается при `ui.active === 'view'`.

| Элемент UI | Тип | Описание |
|------------|-----|----------|
| QR code | Canvas `#share-qr` | QR-код с URL для открытия сцены на мобильном (только десктоп) |
| Share URL | TextInput (read-only) + кнопка копирования `#copy-button` | Текущий URL с параметрами `?load=...` для шаринга |
| TAKE A SNAPSHOT AS PNG | Button | Вызов `viewer.downloadPngScreenshot()` |

**Логика Share URL:**  
`shareUrl = `${location.origin}${location.pathname}?${sceneData.urls.map(url => `load=${url}`).join('&')}``

**Стили (style.scss):**  
- `#view-panel`, `#view-panel > #share-url-wrapper`, `#share-url-wrapper > .pcui-text-input > input`, `#copy-button`, `#share-qr`, `#qr-wrapper`

---

## 6. Animation (Анимация)

Отдельной кнопки «открыть панель анимации» нет: блок управления анимацией **всегда в одной строке с кнопками** Camera / Sky / Light / Settings / View (контейнер `#popup-buttons-parent`). Показывается только если у модели есть анимации (`animation.list` не пустой).

**Файл:** `src/ui/popup-panel/animation-controls.tsx`  
**Контейнер:** `.animation-controls-panel-parent`

| Элемент UI | Тип | Observer path | Описание |
|------------|-----|---------------|----------|
| Play / Pause | Button (icon E286 / E376) | `animation.playing` | Воспроизведение и пауза |
| Трек анимации | Select (`#anim-track-select`, width 160) | `animation.selectedTrack` | Выбор клипа из списка имён (`animation.list`) |
| Прогресс (скраб) | Slider (`#anim-scrub-slider`, width 240, 0–1) | `animation.progress` | Текущая позиция в клипе; при движении слайдера воспроизведение ставится на паузу |
| Скорость | Select (`#anim-speed-select`, width 60) | `animation.speed` | 0.25x, 0.5x, 1x, 1.5x, 2x |

**Левая панель:** морф-таргеты используют тот же `animation.progress` — блок `MorphTargetPanel` в `left-panel/` (панель «MORPH TARGETS»).

---

## Сводка кнопок панелей (popup-buttons-parent)

| Кнопка | ui.active | Иконка | Компонент панели |
|--------|-----------|--------|-------------------|
| Camera | `'camera'` | E212 | CameraPanel |
| Sky | `'skybox'` | E200 | SkyboxPanel |
| Light | `'light'` | E194 | LightPanel |
| Settings | `'settings'` | E134 | SettingsPanel |
| View / Share | `'view'` | E301 | ViewPanel |

Дополнительные элементы в том же UI:  
- **Панель анимации** — см. раздел «6. Animation»: Play/Pause, выбор трека, скраб, скорость; в одной строке с кнопками, без отдельного `ui.active`.  
- **Launch AR** (`#launch-ar-button`, icon E189)  
- **Fullscreen** (`#fullscreen-button`, icon E127) — сворачивает левую панель  
- **Переключение орбитальная камера / камера WASD (Fly):** `#camera-mode-button`, `.camera-mode-button` — переключает `camera.mode` между `orbit` и `fly` (орбита вокруг модели ↔ свободный полёт WASD)

---

## Привязка к viewer (viewer.ts)

Обработчики настроек подписаны в `bindControlEvents()` на observer:

- **Camera:** `camera.fov`, `camera.tonemapping`, `camera.pixelScale`, `camera.multisample`, `camera.hq`, `camera.mode`, `scene.selectedCamera`
- **Sky:** `skybox.value`, `skybox.exposure`, `skybox.rotation`, `skybox.background`, `skybox.backgroundColor`, `skybox.blur`, `skybox.domeProjection.*`
- **Light:** `light.enabled`, `light.intensity`, `light.color`, `light.follow`, `light.shadow`; shadow catcher — `shadowCatcher.enabled`, `shadowCatcher.intensity`
- **Settings:** `debug.*`, `enableWebGPU`; перезагрузка при смене WebGPU
- **Animation:** `animation.playing`, `animation.selectedTrack`, `animation.progress`, `animation.speed`, `animation.list` — обрабатываются в viewer (setAnimationProgress, setSelectedTrack, play/stop и т.д.)

Share/View не подписывается на observer для данных сцены — читает `sceneData.urls` и формирует URL в компоненте ViewPanel.
