# Элементы UI: Camera, Sky, Light, Settings, Share (View)

Документ описывает UI viewer: **центральный навигационный блок** внизу канваса, **левую панель** (в т.ч. Camera / Sky / Light внутри вкладки Settings), всплывающие панели по `ui.active` и прочее.

**Иконки в документе:** **чёрные** RGBA PNG (непрозрачные пиксели → `#000`, альфа как в оригинале), встроены как **data URI (base64)** — не зависят от путей. Файлы в `docs/icons/*.png` пересохраняются тем же скриптом. Команда: `npm run docs:embed-ui-icons` или `python3 scripts/embed-docs-ui-icons.py`.

<p align="left">
<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAABhklEQVR42sXUPWuUURAF4Mcglq6NhaDYCCIGtI6VwSImpaYSN9FCYp3eIrBrUoiWdloJIQg2sfQvSAyKQrDQmN0urjapEpsTuVx23UQEBy4v78ydjzNz5vKP5cgQ+wgu4Gz+v+ADdg+b6ARa+Ia96myhnTsHkivoxvkjHmIWC/iMjdi6uTs02A5+YCaQ92UVV6Nr4nvujv0JZjf9Waxsk1ipdJfRQweNfgHbgXIP6zgV/TG8LQZTSjM+7XrKI9gMjIu4maruYB63sDyABQ+wjdPl9EfrTHiDqSTZn/Au7mO6OC9iGy0zTUQ5U+gupek1bZ5WVd6OfkI1RRVh1/C8D8zZJCth/5aj+W7mez1VlUH3il730s/HGI/ufBmjHMpXnMSTAat1I3Af4Rle4yXe4zjO1H6tVNPsE+wc3oVCQql1zMWn1Y+HjZC0F9KW8io0KmUxFW0NIras0U6o0kwrrmXtyiHcxc9hq1cG7QTKRh6EhZB8CZ9i6xwkWAl/2PPV+K8P7F/LLyPacullOnHJAAAAAElFTkSuQmCC" width="28" height="28" alt="camera" />
<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAAA40lEQVR42u3UwSqEURjG8Z8xkeXoWyilXIIUG5GlC+AGNAtyJ9ZyDZJbwJaSS7C1mMgGqRk2z1cnzeib2I23np4657z/czrveQ8TF9PxCsdYRA8vDfOXsId93OK1nYktHBYLH3GPBzxH0ImWsYKFIucSFzWwFT/FB9awjZ0RJ3vPhmeYwUHNaH9beIXz4jo6mI/LSZ/i/YztBmgYsIx+7rM3TlFaf13lf+Dv46cqT+XJ1JInU+uzCXAT69Eq5kZs9oY73GB2GHAQPypa77pB620UrEEJrnCCbhreGJ9DN7mVyYwvyi0r7qoF2P8AAAAASUVORK5CYII=" width="28" height="28" alt="sky" />
<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAAA4ElEQVR42rXUv0oDMBDH8U9rKQouLnXrqoKLf9rJbu7ODtUn8DW0m7OCk7Mv4KB0cfANVBwFJzdBFKnLCcFFkqY/CDnC5cvvckeorLnCe5tYxyu+pjVxgUmsJyxPA9sK0A1GEZ+kCc1M4Grs97iKeKnE2WI4+kjKneAbOzmgBoZ4wSdOsYJjnP8Ha+MAR+hiG3fh5BprueMzTkp5j3KesVfyRoMAXeIw4lvM54KaZqTqJf82ZVirKaVjMygFVxvsv9oP0Ai9iM/ShFYm8CH2fnL2VvP7ekSnRrM2sIsFs9YP1fRAt//0uVcAAAAASUVORK5CYII=" width="28" height="28" alt="share" />
</p>

**Экспорт в PDF:** печать из браузера по `UI-ELEMENTS.html` или `pandoc docs/UI-ELEMENTS.md -o UI-ELEMENTS.pdf` (картинки уже внутри файла).

---

## Где находится UI

- **Центральная полоска кнопок:** `#popup-buttons-parent` внутри `#popup` → `src/ui/popup-panel/index.tsx` (`PopupButtonControls`, рядом `AnimationControls`). Стили: `src/style.scss` (`left: 50%`, `bottom: 20px`, горизонтальный `flex`).
- **Всплывающие панели к ним:** `#popup` → `PopupPanelControls` в том же файле + `src/ui/popup-panel/panels.tsx`. Переключение через **`ui.active`**: `'info'` | `'measurement'` | `'view'` | `'id'` (и `null`, если панель закрыта).
- **Поля Camera / Sky / Light / Settings (сцена):** вкладка **Settings** **левой панели** — `src/ui/left-panel/index.tsx` (`CameraPanel`, `SkyboxPanel`, `LightPanel`, `SettingsPanel` и др.).
- **Пустая сцена:** у `#popup` класс `empty` — центральный блок скрыт.

---

## Центральный навигационный блок (`#popup-buttons-parent`)

Ряд элементов **по центру внизу** канваса (`#canvas-wrapper`): `left: 50%` + `transform`, `bottom: ~20px` в `style.scss`. Внутри `#popup` (см. `popup-panel/index.tsx`). Это не левая панель: при клике по части кнопок открывается **всплывающая панель** над полоской (`ui.active`); клик вне `#popup` снимает активную панель.

### Сводная таблица (слева направо)

<table>
<thead><tr><th>Иконка</th><th>Кнопка</th><th>ID</th><th>Описание</th></tr></thead>
<tbody>
<tr><td><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAABLUlEQVR42rXUu05CQRAG4A/sbAwFnZp4aTBEC23hDbQQHsBn0DfQhsY3sdPK1lYjNlZiYRQDiXSa2IjNkJyccI5AZJPNZOfy7+zMv8M/r8If9iK2sBrnFzziZ9qLSmjhHcPU7oatNGmGdVygjDYu0QnbBg6wgz6auMnLrI5vfOAwx6+BQfjW857ZD8fKBGWphG8/6/mtqFEysyUc5TSvETGtcd3s4j6lL0fANdYyQNsRW0wqqxF4mgE4xCeOsZDyOQt7VQJ1JWQnp2aLOMctdhP655DLScDhhETPo94wCfgacj0n8Asn2MNdQj+q7du4prSnbEohqylJ2jSmoE0zizYjYvdmIHYvi9hQi+80SGU6LrPR16tNMxwecIWnsG1iH9uTDoe5jK+5DNiZ1y+0f1YCpz+uFAAAAABJRU5ErkJggg==" width="22" height="22" alt="" /></td><td>Animation</td><td>—</td><td>Play / Stop, выбор трека, скраб, скорость (<code>animation-controls.tsx</code>); только если <code>animation.list</code> не пустой. Отдельного ID у контейнера нет — блок <code>.animation-controls-panel-parent</code>.</td></tr>
<tr><td><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAABIklEQVR42rXUPU6CQRAG4EdiY0lhZ0z8aSBETwA30EI4kTacg9LYabyABxATYyUWRjGQaE8DNoP5xP0+fiKTTCa7M7P7zu47wz/Lxhx/CVXsxvoVTxgve1EZbXxgMqP98JUXRdjAFbbRxTV64TvAKY4xRAt3RcgaGOETZwVxTXxFbKOozGEEVmZ8W6FZqUTsMK/8drxRCtltaArpJHL//GYf9zno66Ep6UZuKbtZi5vOV6DeReTWZE7dCfuSk3QZmpJe9ozNBVFU55BfoPxZvIXdX6HkvbDvqU/p5iQ9hqYa49enTBGO0YkOaC6Brhk5nVR/lzHIIXY18Y5TYg/yiD3l2ygCi5C2Mq1XX2Y4POAGz+E7xAmOFh0OaxlfaxmwK8s3DFlOzDRtEZAAAAAASUVORK5CYII=" width="22" height="22" alt="" /></td><td>Info</td><td><code>#info-button</code></td><td>Всплывающая панель: <code>ui.active === 'info'</code>, контейнер <code>.info-panel-parent</code> / <code>.info-panel</code>. Вкладки Controls / Model / About — см. ниже.</td></tr>
<tr><td><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAAA0ElEQVR42uXUMWpCQRSF4S+S2MgjBLIB1yMWAW1SWFiEtFZWpggWcQfRSoR0Sekq3IP2IkgKA4kINld4CAZ9eUXAgWEuh5mfc88Mw9mNi1iv0EU5I2eKDtY7YAXvGGUENlDDeCfUMf9Dp/NgKOSd4eUB/QVP+EEbw9BbqT0TfOwfPOSwHRcFj7iN+YAlVng7xSHc4RullPaJXmjPpwKb2CDJI0OoRmuzlHYdcRTD/dHAHtZRv2IR9QA3Ud//5vT/v8OvCL+fkZMEI//P4fz+V1vnXCYzsjQImAAAAABJRU5ErkJggg==" width="22" height="22" alt="" /> / <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAAA5ElEQVR42uXUMUpDURCF4U+JCoYgQTfgCgRTCa5AS7Wx0M7aQEAsFCE2NvbaJSg2prDQyh0ILkFIGwVJEUFSaDMBEV8gL68Q3m2Ge7jzc2bmMuTuTEScwikWU3JecIT+ALiOWzRTAnewifuBsIXOGJV2gmEy6x4WEvRV7GIWbRxjHtUfb57Q+p2Y5LAWA7vDPpawgD28o4frvxKTgK9YwTI28Bx6F2c4x8wowEOc4As3WBu3h40o6zFiKfQ5HGAan6M4rOMNFVzhIe6XKKOI7WFO//8//Ig+XaTklIKR/XLI3371DacsKr+9I+5xAAAAAElFTkSuQmCC" width="22" height="22" alt="" /></td><td>HD / SD</td><td><code>#hd-button</code></td><td>Переключение <code>camera.hq</code> (классы <code>hd-mode</code> / <code>sd-mode</code>). Панель не открывается.</td></tr>
<tr><td><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAAAiElEQVR42u2SywmAMBBEHyLYhB3YiXcLsQPryV2xAivQQjx4E+JllDU3f5CDA8Oym50hmyz8iBYZ0AEr4C9ylTazhqVp6EUPTIADZtGptvc5YFBeWsPKGBaiBxqdjyKq7X1WWwEkb79d8tWnnK79RBv/yKnioljfGDsPPI7Fbh8sdhsu9o+IsAE94jwfRujhkgAAAABJRU5ErkJggg==" width="22" height="22" alt="" /></td><td>Measurement</td><td><code>#measurement-button</code></td><td>Панель измерений: <code>ui.active === 'measurement'</code>, при открытии ставится <code>measure.enabled = true</code>. Содержимое — см. ниже.</td></tr>
<tr><td><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAAAn0lEQVR42u3UoQrCYBTF8d9k+BAmiz6HxSJmEayCNl9Gi8U4fACT3acQtKrRMjDMMmGMCc4ZFDxwOfAd7v9y4fLx19cpKHjroI0rIjTQz+QX7HB6dcgKCQ6ZAUmuYkyKmmslN4qwRh1ztKoClxhigRC9qsCHtqk3PwUMngXvArupH/NBWBI0whQD3LCpChynHmOGfdXDTjKHff7/Cz+iOyfzHoJ++GRnAAAAAElFTkSuQmCC" width="22" height="22" alt="" /></td><td>ID</td><td><code>#id-button</code></td><td>Панель идентификации: <code>ui.active === 'id'</code>, <code>#id-panel</code>. Путь/имя выбранного узла, копирование пути, блок Dublin Core из метаданных — см. ниже. Только вне embed.</td></tr>
<tr><td><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAAA4ElEQVR42rXUv0oDMBDH8U9rKQouLnXrqoKLf9rJbu7ODtUn8DW0m7OCk7Mv4KB0cfANVBwFJzdBFKnLCcFFkqY/CDnC5cvvckeorLnCe5tYxyu+pjVxgUmsJyxPA9sK0A1GEZ+kCc1M4Grs97iKeKnE2WI4+kjKneAbOzmgBoZ4wSdOsYJjnP8Ha+MAR+hiG3fh5BprueMzTkp5j3KesVfyRoMAXeIw4lvM54KaZqTqJf82ZVirKaVjMygFVxvsv9oP0Ai9iM/ShFYm8CH2fnL2VvP7ekSnRrM2sIsFs9YP1fRAt//0uVcAAAAASUVORK5CYII=" width="22" height="22" alt="" /></td><td>View &amp; share</td><td><code>#view-button</code></td><td>Панель <code>#view-panel</code>, <code>ui.active === 'view'</code>: генератор embed (iframe), снимки PNG, обложка 1:1, экспорт настроек — см. ниже.</td></tr>
<tr><td><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAAApklEQVR42mNgGOyAGYntwMDAkMDAwHCVgYHhG5q6LAYGBlMGBobTaOKiDAwMZVD2A3TDGxgYGP4zMDBoY7H4KhSjA22ongaYAAuRPvEj1stM1A5DYl24CcmLVDFwKrVdOI3SMFSGxmoWlL8RimFJ6CpUDe0jhdh0iAtgpENiXZiF5H2qREo2sZEzAnMKMxr/IQMDwwEsxRcDtOg6jUX8G1TPA4YhAQCxsh3+gB3MmAAAAABJRU5ErkJggg==" width="22" height="22" alt="" /></td><td>Frame scene</td><td><code>#fit-screen-button</code></td><td><code>viewer.frameScene()</code>. Панель не открывается.</td></tr>
<tr><td><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAABi0lEQVR42qXUzUtWQRQG8J+KCIFgBZUgCvUHuIqCFpmGC0FbBP4JrVq0aWMtwl3grkWKkLhpIwSGKboS1E1iIiERUURkbvzqw+hDvG6OdHm5vM5rDxzuMHPnmXnmPOdU+Yda9KIDdVjBE2w4BhqxjCVsYharWI8DklEVMY8xnMQeJjGIW3iBy/iUStqBfbzHD3yJcX5uoJJb3se9uN0mTsd4Bp24hIVUsmpkIbvoObLcNz9fFtdK5K2XSN7Fw/j3BPpTkjKLidgAU3iE2xjHRXzF8zi056hbnsXL8N4W5vAGa7iKU7GeYSRs9gBt5UhrwtiDGMWdSM6ZOCiLeIaP+Is/6K7EAefwOkd2GK9wAYv4ja4Usma8KyBbjCeAhiD/eZR8aEErzoes75G8+gIVb/EtPJskexvTOReUogkfsFWdQNgS0lZDWhE+43p0qSQ8jvfrL1NxQ5H55K40HKR9BXYbiWzfrMRCNXgapHdzTXkMv3DjOI24NkpxP8rysBTb/QfqIuMZdnAlv3oA0/5s1vzKW6MAAAAASUVORK5CYII=" width="22" height="22" alt="" /> / <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAABW0lEQVR42q3UPUiVcRTH8c81dUlUUFxcA9HgigRCDkIgtOhQglAuphLhEk0uTkIQNKiYg6Nru5viZi+biEu7FCqiIPiS16flXHi6eH30Xs904P/jy/mflx/XRw4vVBA1ZWBf8NI9RA7LSAJah+doqxaWYB4bke+ioxpYgnPs4zX27gLNYakEluAQT0LTid/4g64sWD8GcYxLzOAMA9hKafNYw188w6+sSh9gPb7ZXUaTj/ddPMoCdsdXpzN0eRxhJQtYj01cYPgG3TgKeHubATXiW/Ty1TXvbwL2GWP4iVk0VAJNw6AVn3AafX2P2nLQphJoGtaDr6lbfxqTT7B9U6VN+B7iAhZjldrxDlcBbsXHAP64TU9nMYqWuJgD9MVQCrHsI3FpjXe994mo5ARDmMQqeqtxo6JhXGLqPizucexq8eYX0r5aUwFwB3ORn6G5Ur9Mx0N8iAn/F/8ABIBeGluOPA8AAAAASUVORK5CYII=" width="22" height="22" alt="" /></td><td>Camera mode</td><td><code>#camera-mode-button</code></td><td><code>camera.mode</code>: <code>orbit</code> ↔ <code>fly</code>. Панель не открывается.</td></tr>
<tr><td><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAAAtElEQVR42mNgGOyAEYntAMUwcJWBgWE1Dn2hDAwM2kj8A1CMAhoYGBj+I+HVeByyGk1tA0yCCYtifwYGBh0GBoZCPAYWQtX4o0uwYFF8F+pdfOAJFGMAZiS2KDRMNzIwMHwiMg7YGRgY5KDhd41hFIxAEArNATIk6JGB6gnFllO0GRgYQhgYGPhJMJAfqkcbX05RhtIfceUGqMv4kdRiBVQpHFjQiiAGtOILF1iFJn9g6KQVADNRJun5mxTRAAAAAElFTkSuQmCC" width="22" height="22" alt="" /> / <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAAAhElEQVR42mNgGKqggYGBIRSPfChUDdHgPwMDw2o88quhajAAE7W9xoTmzf+4bMbjk//I3mdBkrzKwMCwBol/HI9B6HJXGUbBCAKMaNkpDC1p9OHQV8TAwGCJxF8Fy1nI6VCbgYEhhEiHWKKpvUogqw6ivMyMJ2wPMDAwXMOj9xpUzRADANuoGv4rcHKkAAAAAElFTkSuQmCC" width="22" height="22" alt="" /></td><td>Fullscreen</td><td><code>#fullscreen-button</code></td><td>Fullscreen API для <code>#application-container</code> (вход / выход). Панель не открывается.</td></tr>
</tbody>
</table>

**Embed / узкий экран:** видимость кнопок задаётся в `PopupButtonControls` (пресет `minimal`, флаги `embed.*`) и медиаправилами в `style.scss` (например ≤950px).

### Содержимое панелей и выпадающих блоков

Панели рендерятся в `src/ui/popup-panel/panels.tsx` (кроме анимации — `animation-controls.tsx`). Визуально это блок над центральной полоской, не отдельное окно ОС.

**Animation** (в одной строке с кнопками, не `ui.active`):

- **Play / Pause** — кнопка `.anim-control-button`, иконка меняется; `animation.playing`.
- **Трек** — выпадающий список `#anim-track-select`, опции из `animation.list`, значение `animation.selectedTrack`.
- **Скраб** — слайдер `#anim-scrub-slider` 0…1, пишет в `animation.progress` и сбрасывает воспроизведение.
- **Скорость** — `#anim-speed-select`: 0.25x, 0.5x, 1x, 1.5x, 2x → `animation.speed`.

**Info** (`InfoPanel`, `ui.active === 'info'`):

- **Верхний ряд вкладок** (`.info-tab`): **Controls** | **Model** | **About** — часть вкладок может быть скрыта в embed (`embed.controls`, `embed.modelInfo`, `embed.info`).
- **Controls → подвкладки** (`.info-subtab`): **Desktop** | **Touch**.
  - **Desktop:** секции Orbit / Fly — подсказки по мыши и клавишам; **General** (если разрешено embed) — Frame scene (**F** + мини-кнопка `.fit-screen-button-inline`), Reset camera (**R** + `.reset-camera-button-inline`).
  - **Touch:** жесты Orbit / Fly для тач-интерфейса.
- **Model:** сводка (файл, mesh/material/texture counts, VRAM, load time, bounds), **Variant** (`scene.variant.selected`), дерево **Hierarchy** (выбор узла → `scene.selectedNode.path`), **Stats** — переключатель `debug.stats`, блок **Morph targets** (`MorphTargetPanel`).
- **About:** логотип, версия, ссылки на PlayCanvas Model Viewer, PCUI, Material Icons, flag-icons.

**Measurement** (`MeasurementsPanel`, `ui.active === 'measurement'`):

- **Measure Mode** — toggle `measure.enabled`.
- **Units** — mm / cm / m → `measure.unit`.
- **1 Unit = (m)** — `measure.unitScale`.
- **Known distance** (в выбранных единицах) — `measure.knownDistance`.
- Кнопка **RECALCULATE SCENE SIZE** — `viewer.recalculateSceneSize()` (активна при валидных данных).
- **Last Distance**, **Points** (подсказка первой/второй точки).
- **CLEAR MEASUREMENT** — `viewer.clearMeasurement()`.

**ID** (`IDPanel`, `ui.active === 'id'`, `#id-panel`):

- При выбранном узле: **Path**, **Name**, кнопка **Copy path** (буфер обмена).
- Если в `metadata` заполнены поля Dublin Core — секция **Metadata (Dublin Core)** со списком пар «поле — значение».

**View & share** (`ViewPanel`, `#view-panel`, `ui.active === 'view'`):

- **Embed Type** — Responsive / Fixed (`embedType`).
- **UI Preset** — Full / Compact / Minimal (подставляет набор флагов: панель, POI, tour, measure, info, modelInfo, controls, fullscreen, fit, reset).
- **Width** (только при Fixed), **Height**.
- Переключатели: левая панель, autoplay, fullscreen, POI, tour, measure, info, model info, controls, fit, reset.
- **Language** — auto / EN / RU / ZH (параметр в URL embed).
- **Generated Embed Code** — только чтение; **Copy Embed Code** (`#copy-embed-button`).
- **TAKE A SNAPSHOT AS PNG**, **COVER IMAGE (1:1)**, **EXPORT VIEWER SETTINGS** — вызовы `viewer.downloadPngScreenshot`, `downloadCoverImageScreenshot`, `exportViewerSettings`.

---

## 1. Camera (Камера)

В **текущей ветке** этот блок находится во **вкладке Settings левой панели** (`CameraPanel` в `left-panel/index.tsx`), а не в центральной полоске.

<p><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAABe0lEQVR42q3UT0uVQRQG8F9hlLhMCHJR0OIaQpugqKVBiwIXcV26tE3/NimUtIq2fgO/gBC09QvYKoigRUIQhqBLNYSwa22eF6bxvVcLDxzemTPPc86cmWdeTthOHbE+httVbBUb/1vwIX5XPjuIcLqaD8Ubu5TvUzzO+PIA/CF7jnW8xCQ+4wDDOIdeYpPBrIfTahewXbXXw3KBWU6sxGyHe8iWAujiAd7iRgvuJt4F1w1nqQZNpPIPXK1U8Agf8QUL1bl3wuklx1/EF9gPYKq65e/4lvGrrN3DLn6lUKsEZ0JqDvo9NjGCs7hedHAx8yu1TAYJ/kzGB/iJDwVmNB197ZegaXkX9xN/kh035zOOaSwWt7yY2Hi/S+lUxZ5FzKPYa3k5je8F0yqbbqRxqyrakHcwF98p4hNHCXsfK1krE84VvPkyYampLbyORBZwB2u4W7fyL1Y/9jdFK20tzw9quc1mC+BxLuX8cX+wK9lJB9f6YD/leZ6s/QHVAX8I8u/ILgAAAABJRU5ErkJggg==" width="28" height="28" alt="" /></p>

**Где открыть:** вкладка **Settings** левой панели — `CameraPanel` в `left-panel/index.tsx` (отдельной кнопки в нижней полоске и `ui.active === 'camera'` в этой ветке нет).

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

- Иконки режимов: <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAABi0lEQVR42qXUzUtWQRQG8J+KCIFgBZUgCvUHuIqCFpmGC0FbBP4JrVq0aWMtwl3grkWKkLhpIwSGKboS1E1iIiERUURkbvzqw+hDvG6OdHm5vM5rDxzuMHPnmXnmPOdU+Yda9KIDdVjBE2w4BhqxjCVsYharWI8DklEVMY8xnMQeJjGIW3iBy/iUStqBfbzHD3yJcX5uoJJb3se9uN0mTsd4Bp24hIVUsmpkIbvoObLcNz9fFtdK5K2XSN7Fw/j3BPpTkjKLidgAU3iE2xjHRXzF8zi056hbnsXL8N4W5vAGa7iKU7GeYSRs9gBt5UhrwtiDGMWdSM6ZOCiLeIaP+Is/6K7EAefwOkd2GK9wAYv4ja4Usma8KyBbjCeAhiD/eZR8aEErzoes75G8+gIVb/EtPJskexvTOReUogkfsFWdQNgS0lZDWhE+43p0qSQ8jvfrL1NxQ5H55K40HKR9BXYbiWzfrMRCNXgapHdzTXkMv3DjOI24NkpxP8rysBTb/QfqIuMZdnAlv3oA0/5s1vzKW6MAAAAASUVORK5CYII=" width="22" height="22" alt="orbit" /> Orbit · <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAABW0lEQVR42q3UPUiVcRTH8c81dUlUUFxcA9HgigRCDkIgtOhQglAuphLhEk0uTkIQNKiYg6Nru5viZi+biEu7FCqiIPiS16flXHi6eH30Xs904P/jy/mflx/XRw4vVBA1ZWBf8NI9RA7LSAJah+doqxaWYB4bke+ioxpYgnPs4zX27gLNYakEluAQT0LTid/4g64sWD8GcYxLzOAMA9hKafNYw188w6+sSh9gPb7ZXUaTj/ddPMoCdsdXpzN0eRxhJQtYj01cYPgG3TgKeHubATXiW/Ty1TXvbwL2GWP4iVk0VAJNw6AVn3AafX2P2nLQphJoGtaDr6lbfxqTT7B9U6VN+B7iAhZjldrxDlcBbsXHAP64TU9nMYqWuJgD9MVQCrHsI3FpjXe994mo5ARDmMQqeqtxo6JhXGLqPizucexq8eYX0r5aUwFwB3ORn6G5Ur9Mx0N8iAn/F/8ABIBeGluOPA8AAAAASUVORK5CYII=" width="22" height="22" alt="fly" /> Fly  
- **ID и класс:** `#camera-mode-button`, `.camera-mode-button`
- **Observer path:** `camera.mode` — значение `'orbit'` или `'fly'`
- **Поведение:** по клику переключает режим: **Orbit** (вращение вокруг модели, колёсико — zoom) ↔ **Fly** (свободное перемещение WASD, мышь — поворот)
- **Расположение:** в контейнере `#popup-buttons-parent` (центральная полоска внизу), не внутри коллапса Camera в левой панели
- **В коде:** `popup-panel/index.tsx` — кнопка с `onClick` → `setProperty('camera.mode', mode === 'orbit' ? 'fly' : 'orbit')`

---

## 2. Sky (Небо / Skybox)

<p><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAAA40lEQVR42u3UwSqEURjG8Z8xkeXoWyilXIIUG5GlC+AGNAtyJ9ZyDZJbwJaSS7C1mMgGqRk2z1cnzeib2I23np4657z/czrveQ8TF9PxCsdYRA8vDfOXsId93OK1nYktHBYLH3GPBzxH0ImWsYKFIucSFzWwFT/FB9awjZ0RJ3vPhmeYwUHNaH9beIXz4jo6mI/LSZ/i/YztBmgYsIx+7rM3TlFaf13lf+Dv46cqT+XJ1JInU+uzCXAT69Eq5kZs9oY73GB2GHAQPypa77pB620UrEEJrnCCbhreGJ9DN7mVyYwvyi0r7qoF2P8AAAAASUVORK5CYII=" width="28" height="28" alt="" /></p>

**Где открыть:** вкладка **Settings** левой панели — `SkyboxPanel` в `left-panel/index.tsx`.

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

<p><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAABFElEQVR42r3UPUoDURTF8Z9iHNDKj0awsVQrLVIkWIi6hDSxyhIkjbiZrMLC2OoSTG2jGFCEiAGTgDZXCEMymUTJhQcz55z5v3l33hv+uRZyZHawG9ctPM462SHu8Z0adziYFnaKLnpooBajEdonTvLCNvCGdxRH+MXwXrGeB3gVS6tmZM4jc5kHeIsOChmZQmRu0sbimCW30c8A9iOzmQf4gi0kGcAkMu08wCZWJ/SwGplmnh6u4Tm+ZGmEXwrvKbK56hgf+EJ5SC+H1sHRtJu7FlujMqRVQquNe2gpA/jb8Ish6HbKm6oSXGMwdI4HoSXmVZN+X/vYS2ktPMw6YX3E76v+lzdcwRmW474XZ707tx7+AGy6QGGcHn8dAAAAAElFTkSuQmCC" width="28" height="28" alt="" /></p>

**Где открыть:** вкладка **Settings** левой панели — `LightPanel` в `left-panel/index.tsx`.

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

<p><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAABSUlEQVR42r2Uv0oDQRDGf/4pzAOIhYV2QewTsEwrWIRrU6qF0TQGTax9AwubvEBA8Cm0VFArG43YCiF2Zo3Nd7DO7a2eBAeWvZ35vt2dm28WpmwzP8SXgQ3juwJe/3rgDjAxYztGmDXreY3UVjQfAE19r0bwGTsEBkAXqAEPwCdQAhYAJ19NmIE4QVsChiY9B/Q9TF8+HzMUN2M9ARKgDlwAlQCuClwKl4jTs6B1nfwOrBkV7AO3wD1wDMx58bI4Tnt8I3aADwG25N8NVLmr2CYwEqeTJ8GGSOmPvg5s+KhYW+tGTDa/FbxvLm+DNOWR0imScttewi9K2RzUBG6AO+Aopyhjw8vIJpE0qoFsKpJU3ZPN+TSF/QYsFmk9p7YrqQ3T1jsBXoBWrGK22U91iz0JfCJf7uNgX4qxWT9rPvN8TxH8/z+whe0L8mByERs/NtIAAAAASUVORK5CYII=" width="28" height="28" alt="" /></p>

**Где открыть:** вкладка **Settings** левой панели — `SettingsPanel` в `left-panel/index.tsx` (дебаг, WebGPU и т.д.).

<table>
<thead><tr><th>Элемент UI</th><th>Тип</th><th>Observer path</th><th>Описание</th></tr></thead>
<tbody>
<tr><td>Current Device</td><td>Detail (read-only)</td><td><code>runtime.activeDeviceType</code></td><td>WebGPU или WebGL 2</td></tr>
<tr><td>Use WebGPU</td><td>Toggle</td><td><code>enableWebGPU</code></td><td>Переключение на WebGPU (с перезагрузкой страницы)</td></tr>
<tr><td>Render Mode</td><td>Select</td><td><code>debug.renderMode</code></td><td>Default, Lighting, Albedo, …</td></tr>
<tr><td><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAABO0lEQVR42p3UOy8EYRTG8Z/Nsi4rEkRUhA+jFIUofQetECIiLglCtCqNzgdQ6Fx6oaAQ14aQCCFxaU4xJmN3Z59mnsx583/nPPOeF0Zxjj20ya9u7OMUQw24xGAUL/CSE9iJgfDHRZwF8AfbeMwJ7Mdk+DMo4wET6tdStFwq4BXveMoJacdI+Hs846OQWFDIAStjFUfpQjHhf3LANjAdUf1R8qu+aoC1BWwGt1kLksCPKrBWrGEW1/8tSrZcqgBriczmcFNp18I/8CzYfDVYGvieUW/GOhZqgaWB36laCZtYqZRZpQyTagrYYsx6zcrKsCkyW84LSwMb4zkWZ+2inqEuxl9sjnsNdurgdMVsNxaxi964MT6zxqmKBjAVfqsBV+iLFw94ywksoyf8CYzjDgfoqKPdHhzG0Rr+BXdXPOUfa2KEAAAAAElFTkSuQmCC" width="22" height="22" alt="" /> Wireframe</td><td>ToggleColor</td><td><code>debug.wireframe</code>, <code>debug.wireframeColor</code></td><td>Каркас и цвет линий</td></tr>
<tr><td>Grid</td><td>Toggle</td><td><code>debug.grid</code></td><td>Сетка</td></tr>
<tr><td>Axes</td><td>Toggle</td><td><code>debug.axes</code></td><td>Оси</td></tr>
<tr><td>Skeleton</td><td>Toggle</td><td><code>debug.skeleton</code></td><td>Скелет</td></tr>
<tr><td>Bounds</td><td>Toggle</td><td><code>debug.bounds</code></td><td>Bounding box</td></tr>
<tr><td><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAAByUlEQVR42q3UTYuNYRgH8N95POMlVhbEwkJJShyvQ9MMjjBNTFgMFqKUEpHsLEjZmeED+AhWFl6S1ZQskJUdiYgpIUxkhsfmOnXPPXNmzsK/nrqf639f132917TGOvRhNqr4CozhPp5qE2twHYcwdwp+DgYwhPpMxo7iTHgyE2o4hROpcFZyPo4vGMbXNqP5gPlo4JnEkzrm4U4Q50K+Fgszrxpx3owXGMEfdKYvDSbGN4anx3A3ctnEEoxGwT7jbPLQYPPSFvRnoWzFt3j9cCJfGlUewYVMpw/dBXbhXkKswpUwuChTqlBiAXpxJOEeYHsZ7o4lxDvcTP4fJueP2B+9Cc8TbhxVGQlN8R23WlS1wu1pql4Vcel/oWqGnKIDXZGrv3iMnwnfGeHBG3xKuAIuZZNRx8toiyrGrInFIfuFVzid9ehl2IkdmZcr8D4qnbfNeMgHMp0u7J3UlFiOt7gYjZ0bHMUe/MDBhLuWjnIjFAu8xtWQ92NZolTiZJz3hdHVOBCPTCjIeTyJHD1qs6rro8k3xTqbUIwb2BAh19o0uDKMDk13qTsWbG+EmKPE7sh7z1RLstXy7MG2iOJ3yDpisobjmzQU/wB2kF9GV4990wAAAABJRU5ErkJggg==" width="22" height="22" alt="" /> Normals</td><td>Slider (0–1)</td><td><code>debug.normals</code></td><td>Визуализация нормалей</td></tr>
<tr><td>Stats</td><td>Toggle</td><td><code>debug.stats</code></td><td>Статистика (FPS и т.д.)</td></tr>
<tr><td><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAAAiElEQVR42u2SywmAMBBEHyLYhB3YiXcLsQPryV2xAivQQjx4E+JllDU3f5CDA8Oym50hmyz8iBYZ0AEr4C9ylTazhqVp6EUPTIADZtGptvc5YFBeWsPKGBaiBxqdjyKq7X1WWwEkb79d8tWnnK79RBv/yKnioljfGDsPPI7Fbh8sdhsu9o+IsAE94jwfRujhkgAAAABJRU5ErkJggg==" width="22" height="22" alt="" /> Measure Mode</td><td>Toggle</td><td><code>measure.enabled</code></td><td>Режим измерений (2 клика по модели)</td></tr>
<tr><td>Units</td><td>Select</td><td><code>measure.unit</code></td><td>mm / cm / m</td></tr>
<tr><td>1 Unit = (m)</td><td>Numeric</td><td><code>measure.unitScale</code></td><td>Метров в 1 unit модели</td></tr>
<tr><td>Known distance</td><td>Numeric</td><td><code>measure.knownDistance</code></td><td>Для пересчёта масштаба</td></tr>
<tr><td>RECALCULATE SCENE SIZE</td><td>Button</td><td>—</td><td><code>viewer.recalculateSceneSize()</code></td></tr>
<tr><td>Last Distance</td><td>Detail</td><td><code>measure.lastDistance</code></td><td>Последнее измерение</td></tr>
<tr><td>Points</td><td>Detail</td><td><code>measure.pointCount</code></td><td>Подсказка по точкам</td></tr>
<tr><td>CLEAR MEASUREMENT</td><td>Button</td><td>—</td><td><code>viewer.clearMeasurement()</code></td></tr>
</tbody>
</table>

**Визуализация в сцене (Measure mode):**
- После первого клика рисуется маркер стартовой точки.
- После второго клика рисуются маркер второй точки, линия между точками и подпись расстояния у середины линии.
- Подпись отображается в выбранных единицах `measure.unit` и с учетом `measure.unitScale`.

---

## 5. Share / View (Просмотр и шаринг)

<p><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAAA4ElEQVR42rXUv0oDMBDH8U9rKQouLnXrqoKLf9rJbu7ODtUn8DW0m7OCk7Mv4KB0cfANVBwFJzdBFKnLCcFFkqY/CDnC5cvvckeorLnCe5tYxyu+pjVxgUmsJyxPA9sK0A1GEZ+kCc1M4Grs97iKeKnE2WI4+kjKneAbOzmgBoZ4wSdOsYJjnP8Ha+MAR+hiG3fh5BprueMzTkp5j3KesVfyRoMAXeIw4lvM54KaZqTqJf82ZVirKaVjMygFVxvsv9oP0Ai9iM/ShFYm8CH2fnL2VvP7ekSnRrM2sIsFs9YP1fRAt//0uVcAAAAASUVORK5CYII=" width="28" height="28" alt="" /></p>

**Кнопка:** `icon='E301'`, `handleClick('view')`  
**Панель:** `ViewPanel`, контейнер `#view-panel`, показывается при `ui.active === 'view'`.

| Элемент UI | Тип | Описание |
|------------|-----|----------|
| QR code | Canvas `#share-qr` | QR-код с URL для открытия сцены на мобильном (только десктоп) |
| Share URL | TextInput (read-only) + `#copy-button` | Текущий URL с параметрами `?load=...` |
| TAKE A SNAPSHOT AS PNG | Button | `viewer.downloadPngScreenshot()` |
| <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAABDklEQVR42uXUTyuEURQG8J+3MZQs5l2oMVKU1Wz4EKJslLLiC8xSyUZ6pyQbS18AC/kGLGzsbZRYWrCwYGFBM4nNGWmK0cxYzanTvefec56ee/5cek76Yp3HKvrbxKnjAKeQ4g0fHeor0gRFDKAajNvRKgZRTLqdw9wP5xs4xhwKjdyE/Rz2Ai4w+RfAXbxgG2eYwTBKmMI69rGHcVw3An978ntU7xyb0QEZ7pEPn5XmoGbAHYzG/hYVTAeTZnnESKscLn1zmsAWLsOvHgxLqOEON60AK5jFGo4wFIxP4n4ZD1GUBFcYi7x+STkaM+ugW7LAKCf/Mc9pjE03Rq+QwxMW43PIt0mqhsNo+l6TT87sT2dsPh1jAAAAAElFTkSuQmCC" width="22" height="22" alt="" /> EXPORT VIEWER SETTINGS | Button | `viewer.exportViewerSettings()` → JSON настроек сцены |

**Формат экспорта настроек (model-viewer-settings.json):**  
Корень: `modelViewerSettingsVersion: 1`, плюс объекты `camera`, `skybox`, `light`, `debug`, `shadowCatcher`, `measure`, скаляр `enableWebGPU`. В орбитальном режиме в `camera` добавляются массивы `position` и `focus` (три числа). Цвета фона и света сохраняются в HEX (`skybox.backgroundColor`, `light.color` — строка вида `#rrggbb`) для однозначной записи и корректного применения при загрузке.

**Автоподхват настроек из папки модели:** при загрузке модели по HTTP(S) viewer ищет в том же каталоге файл настроек: `имя.model-viewer-settings.json` или с суффиксом в скобках (как при повторном скачивании в Chrome): `имя.model-viewer-settings(1).json`, `(2).json`, … до `(20).json`. Если найдено несколько вариантов, применяется файл с **наибольшим номером в скобках** (наиболее «свежая» версия). Таймаут запросов 5 с. Подхват при одновременном перетаскивании модели и файла настроек не реализован; пожелание — в `docs/FEATURE-WISHES.md`.

**Логика Share URL:**  
`shareUrl = `${location.origin}${location.pathname}?${sceneData.urls.map(url => `load=${url}`).join('&')}``

**Стили (style.scss):**  
- `#view-panel`, `#view-panel > #share-url-wrapper`, `#share-url-wrapper > .pcui-text-input > input`, `#copy-button`, `#share-qr`, `#qr-wrapper`

---

## 6. Animation (Анимация)

<p><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAABLUlEQVR42rXUu05CQRAG4A/sbAwFnZp4aTBEC23hDbQQHsBn0DfQhsY3sdPK1lYjNlZiYRQDiXSa2IjNkJyccI5AZJPNZOfy7+zMv8M/r8If9iK2sBrnFzziZ9qLSmjhHcPU7oatNGmGdVygjDYu0QnbBg6wgz6auMnLrI5vfOAwx6+BQfjW857ZD8fKBGWphG8/6/mtqFEysyUc5TSvETGtcd3s4j6lL0fANdYyQNsRW0wqqxF4mgE4xCeOsZDyOQt7VQJ1JWQnp2aLOMctdhP655DLScDhhETPo94wCfgacj0n8Asn2MNdQj+q7du4prSnbEohqylJ2jSmoE0zizYjYvdmIHYvi9hQi+80SGU6LrPR16tNMxwecIWnsG1iH9uTDoe5jK+5DNiZ1y+0f1YCpz+uFAAAAABJRU5ErkJggg==" width="28" height="28" alt="" /></p>

Отдельной кнопки «открыть панель анимации» нет: блок **в той же горизонтальной строке, что и центральный навигационный блок** (`#popup-buttons-parent`), слева от кнопки Info. Показывается только если у модели есть анимации (`animation.list` не пустой).

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

## Сводка: где что лежит

| Зона | Контейнер / файл | Содержимое |
|------|------------------|------------|
| **Центр снизу** | `#popup-buttons-parent`, `popup-panel/index.tsx` | Анимация, Info, HD/SD, измерение, ID, View, Fit, Orbit/Fly, Fullscreen — см. раздел **«Центральный навигационный блок»** выше. |
| **Всплывающие панели** | `#popup` + `panels.tsx` | Info / Measurement / View / ID по `ui.active`. |
| **Сцена (камера, небо, свет, дебаг)** | Левая панель → вкладка **Settings** | `CameraPanel`, `SkyboxPanel`, `LightPanel`, `SettingsPanel` — разделы **1–4** ниже. |

---

## Привязка к viewer (viewer.ts)

Обработчики настроек подписаны в `bindControlEvents()` на observer:

- **Camera:** `camera.fov`, `camera.tonemapping`, `camera.pixelScale`, `camera.multisample`, `camera.hq`, `camera.mode`, `scene.selectedCamera`
- **Sky:** `skybox.value`, `skybox.exposure`, `skybox.rotation`, `skybox.background`, `skybox.backgroundColor`, `skybox.blur`, `skybox.domeProjection.*`
- **Light:** `light.enabled`, `light.intensity`, `light.color`, `light.follow`, `light.shadow`; shadow catcher — `shadowCatcher.enabled`, `shadowCatcher.intensity`
- **Settings:** `debug.*`, `enableWebGPU`; перезагрузка при смене WebGPU
- **Animation:** `animation.playing`, `animation.selectedTrack`, `animation.progress`, `animation.speed`, `animation.list` — обрабатываются в viewer (setAnimationProgress, setSelectedTrack, play/stop и т.д.)

Share/View не подписывается на observer для данных сцены — читает `sceneData.urls` и формирует URL в компоненте ViewPanel.

---

## Справка: левая панель (вкладки и иконки)

Полное описание с таблицами — в `UI-ELEMENTS.html`.

<table>
<thead><tr><th>Вкладка</th><th>Иконка</th></tr></thead>
<tbody>
<tr><td>Settings (левая)</td><td><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAABSUlEQVR42r2Uv0oDQRDGf/4pzAOIhYV2QewTsEwrWIRrU6qF0TQGTax9AwubvEBA8Cm0VFArG43YCiF2Zo3Nd7DO7a2eBAeWvZ35vt2dm28WpmwzP8SXgQ3juwJe/3rgDjAxYztGmDXreY3UVjQfAE19r0bwGTsEBkAXqAEPwCdQAhYAJ19NmIE4QVsChiY9B/Q9TF8+HzMUN2M9ARKgDlwAlQCuClwKl4jTs6B1nfwOrBkV7AO3wD1wDMx58bI4Tnt8I3aADwG25N8NVLmr2CYwEqeTJ8GGSOmPvg5s+KhYW+tGTDa/FbxvLm+DNOWR0imScttewi9K2RzUBG6AO+Aopyhjw8vIJpE0qoFsKpJU3ZPN+TSF/QYsFmk9p7YrqQ3T1jsBXoBWrGK22U91iz0JfCJf7uNgX4qxWT9rPvN8TxH8/z+whe0L8mByERs/NtIAAAAASUVORK5CYII=" width="24" height="24" alt="" /></td></tr>
<tr><td>Object Alignment</td><td><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAABOElEQVR42tXUPS+EQRAH8J8Ql6gcpU5DIgrBF1AoNKqrJQqNiNJHUIu7QiUkGhoaCYUvoJagIAoShahEnHCaeZLn1nPeGkwymd2Znf+87OzyH6kt+MfO6X411gto5GwjWERX4vOCQ6wXBejEQQBVk4CXoW/FY3mgUawFb0bUFLSB7YIkKmGrQEco+zHX4vAyrr/awwxwDz2xnsIG7jCRA6tjEEsJxnDIp6IAJVzhFkOJrfZB/87RrcV4ZEAnBbZ+lBNdHWchmwA7MRAyT/e4+GZg5Ui7VUm1ArDbaE+paLCnsRuXc5o4T0eppRzYEXoxg/3QP2Rlv5ulhLZzL6YvMiuqomkOv0o32ME8XrGFx7A19Xn8k2d1kbSpGvqD9BKzDI8xi0m0J1k9YCW3b8THkdHzn/jmfo/eAG1wX/Oxk5pyAAAAAElFTkSuQmCC" width="24" height="24" alt="" /></td></tr>
<tr><td>Materials</td><td><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAAA4UlEQVR42s3TMUoDQRgG0Ec0sFjkHGosPYMEUYmCJ/AQYmUawXukSNR7pLW3sRNyArGQtRlhmMyEzaTJ1+2w8/hmZ392PXvJ8xXGaPAZrR/hDqd4x2+0f4wPtDJYiwUG0foQS3xjlJSZhT23ubaPldgb9nPgeQX2WsLSHOILP7hIsGnUrN8Fq2nWbNssxs5wn8OOOzR7SbBReH+SAyeV2DKUWcnDhsf8x05K368pNJuvaTbsOo7Twm12ambLZoMwFGux2QbYIoztSq4rsRaXObAX0Bg7CL/Tc+YCbvBUwnY3fzg5Vh9FVTLtAAAAAElFTkSuQmCC" width="24" height="24" alt="" /></td></tr>
<tr><td>POI</td><td><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAABW0lEQVR42tXUPS+lYRAG4MvpaHx2Nuj0PhpWJ5ItsM1JZP/GoqRaFpVu/QU/gGRjK0qORDYUwpJV+grJEsXSzEkeb96Tg0TCJG/ePPdM5rln5n6Gt241OVgB/3PwbvSiHpfYxFa1C75gP4N9xh7uc749jKrAaimCrhN8IbBTfMNgMB3EDM7CP59NOB2OdbQHNhnYGpoqVNQc/nuMl8FO3GE3+gMduI0e1SYJPqAY/7LVooSbMpnFuOFTEjQfWF+GUTHwYgb/GPicYPY3M/HfOMwpsVJCOMIO/Is+pHaNleS8HDI5iIQHcV5OYlZxVXgNce/iJKfkP88s+Rg7BfxEa2YoKzHp/ieSGkBblP1INg0R0B6yKaGuimzqsJ3KBqailI1gBhOJsJsrMGvBr4j7ml0SP3KeXlmPZ5jFUDy9IXzHeaq/PBvLWQ4jVZbD8EvXVxd60IiL0GHJu7MHNT1or0tjLZUAAAAASUVORK5CYII=" width="24" height="24" alt="" /></td></tr>
<tr><td>Metadata</td><td><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAAAn0lEQVR42u3UoQrCYBTF8d9k+BAmiz6HxSJmEayCNl9Gi8U4fACT3acQtKrRMjDMMmGMCc4ZFDxwOfAd7v9y4fLx19cpKHjroI0rIjTQz+QX7HB6dcgKCQ6ZAUmuYkyKmmslN4qwRh1ztKoClxhigRC9qsCHtqk3PwUMngXvArupH/NBWBI0whQD3LCpChynHmOGfdXDTjKHff7/Cz+iOyfzHoJ++GRnAAAAAElFTkSuQmCC" width="24" height="24" alt="" /></td></tr>
</tbody>
</table>

<p><strong>Render-каналы (Materials):</strong>
<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAABk0lEQVR42q3VzYtNcRzH8dc9MxmSGc8NSdkoREaxsJMpMRmRFFl4iuytsLESyn9gq6SEBf4AC1PGU0xMeQqxQMjEAsfmc+u6jTvudd/1O51zvud8vt/f73e+n1PxJwUm4QcGsAmrMQ8l3mIYV3ENv0zAKhzES4zgSAR7MRcrcRi38CQJG3IO17E71TZiAC9wCpX64BrczLTKVLfVxMzGEE7WB/bhBO7jGZb7d2al0o3VG9PwAeuyJgc0zyBG0QF7cDuBKZjfgmAFDzDYiQ24ksC3jGYpcRFbCizFPf/PEPoK9OBTGwTfoLfAV0xvg2BRPYxiRRsEF+JdR9pqW7qkFXZhMtZjTAS/Y20LYj0xjC94VdtdZ7PTXU2s1zEswLKIPkVn9YGpeITzdaawHTNzvhgXMAN9mdVz9OM9NtdnXZSyL6E7G/Uzlc/B3vjfnVz3Z81KnGm0U8Np9p04FLN9GJPdnyQjMZMxnB7PvmrpwlF8xuuMMp/X8Zhvice1DlPb1H+jGzvy0pIk+oi7uIwb4/0CfgObXFtjZGvdsQAAAABJRU5ErkJggg==" width="22" height="22" alt="" />
<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAABz0lEQVR42pXVTYhOYRQH8N/7joSxUKLEGKUZTcLCR77KkO9JhKxlwWqQlCSUMiuFBRYW9rIgFizYaYTURGQ00TAW8pVSE695bc6t63HvO/zr1r3nPOd/Pp9zK4rRhC5sxULMwAje4TGu43bIRsVmvMJLHMVyTItnKY7gBZ5iVSOiCnrwFXtQbXC2Gmc+h4NCnMYQOvw75uBNZPIHNuE7Fvg/TI8AvqEz34D+Ii9obUDWiePxfgh9UTYb8QXNicHc6OqkEsJe7Iv38fiINXABVwoadA91XCog2xC6lTnZ5eDSi72JwfYwqOMXFif6O/iJiTnZbjwSXepKouvLEdZjiDNMxVs8SJysxVAVNYzNKRZhfnJ4PWbl0v2B8wVlqlQxiPacoqNk6NtzozKlIMIWvK/ifoSb4VkBYQ3PMQ87cBWvkzMr8CQbj1oS5cloRtaUAyHfH+n2J2TN+IQtmeAabmWDGWjDTszOyU6Fk+6E8AQGMCYTzAwPx0a5aj04mMiWYRjbFLR9OJZEUwnhuOR7dWycc2URrItIH8Z4VBoshYtR+7P5VVdk0IIzUb9B3I36jGAylsSVG8Bh3Eznqwxt2BVptWICPsRo3Igm/vUL+A0AEWeNBlWHHgAAAABJRU5ErkJggg==" width="22" height="22" alt="" />
<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAABoUlEQVR42p3Uz4tNYRgH8M8953Qnk9iQRnf+AbKzMNePSTPKj2QjUhZ2SlmIkSJLGxtrUxhLVpKakoWFjRWKsiRRklJSV8y1eU693s6513jqrec83+fX+32f53S0y04cxBr8whBF6I/wLGxjZQZ3cArrGvC1OIklzI5Ldh5XUP5D4RILuIxOk8MCjlm9HIkmCE5gT+j3/iPhA3zHfG3o4G5yzRn0cCYpmEoRWA/9xLaEogxiP+NVPMJGbMcy1uNblnAab7EXXwMfRGPTcA2TScAW7MbjOP1sAmr7LLYm2ASuF+jiRwK8iVmbj9NLsKnE/huvE2yAssJKC9kfIyiXLy3cwko1Yto3t9g3jHjxToGqqVKiVy16082GRQATGfAu6fx4JCpDF9j7LKaqN2YfjjZUexiBQ3zCh+R7ucH/EA7XQ3mrgehNeJEkqc/LeO1cbqOsl3oO23Ajc+pG9zsi2XPcx8/M73TQ9FfnF2PRVysHcLUNPIcLI+Ys3+mzuDTOsY9FnMhWspbJeO2bTT/YzojEu7A/eBwEh93g7wmeNkX9AVYbVe+AzhuUAAAAAElFTkSuQmCC" width="22" height="22" alt="" />
<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAABp0lEQVR42p3Uv29OYRQH8M9779tq0QgTC4lEDJKmhqr40QZB0zBYKiIaCQkSCRGRDrpgQDFh8gcYTLrU0sHYGCVIF0NjkhDp1KprOTdubu/t+9Y3eYbn3HO+9/z6Pg312IsRdCKLk2AJ0/igTfTiGc6iq+L7OoziKfpakV3A9cikFRq4hkt1Dhdx2tpxElfyS55JH7ox1SK4G2nJ9g7LGCgan7RR5jH0F+7bC+SN4JBiP77jcw1RE3fxCbPYg7Hw/1Hy2woT6KghW4/n2BXTvYdbhcx6SoQTSaS7VEHWiUd4GD6v8TZW6gAuY1PB/zeyJBpahXE8xm48iPX4iZfYjFeYL8VkzVBAGafwJtRyHOdxFTtwBws1SWR5yUX04Cu2BOF49HEOt1chg6QZDU7wJ4wL+IWjeBFl368or0o5ab5fR4p/iZI3xkS72lTMwYj7t5SBDUHaX9GO1TCJNC2MfAAfY4UyfFsD2Rl8wVwutxlsw6H/eBz2YWdoegVuxBPWbqnncLOV0+FQw3DIqUrbJ6Lvg1WjrluBQQzFgBbD1hHKeh9nhSj+AssHSvo8fLFmAAAAAElFTkSuQmCC" width="22" height="22" alt="" />
<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAABvElEQVR42o3UzYuNYRgG8N+MmWGSrJUdTaIYFMIcjK9pQix8hVLUNJGPZDNTZqsM27HzB4jIwtfOlrLwH8iKjZp8zdCxuU49XufMOVc9ve9zP/fHdd/PfT9dWmMjRtGHelY35vEC73SI9biHk1jS5HwxTuAuBts5O4fLYdIOXRjHhVYK53G4wyx6sC6BD2KsqjCYaCUG0F/sa5jCa8ympldydhFbS+PpRNuAp/gSg0vFBdWbrLEi/emGs204kv/t+FkY7It8Kd42cbipIDWKoW7sx/MIlxUK9aI1fuFTpSQ/8KHYv8LuntCdxzCe4DNuh+3XlOIBjsbwWxi/j10Dv0PCZJp3NixWV1rjfpHiY6xI4ONNbn8SJrIZz82WuFk4e5bAC2GikTLMNFFYme/LMJrLvg+bc6GP8DHybri1wGT0Y6QygqfwvWB+pijPFOzFHp1jVaW11kS+A4f+a8oO5ncmjuaKLoA7WNRQHE4q7TAdZw+xFmcjP5aZ/gfXsXMBZ8vxJ6PZW8i34EYro6t5wrpanA9UWuc0rrVLaygP7EieqWZP14GkX2tW5FbFr2FXij4XWW/SfpNVr1r+BaZNY2IVEEMhAAAAAElFTkSuQmCC" width="22" height="22" alt="" />
<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAABq0lEQVR42pXUzYtPYRQH8M/93Tsob6NskI2dvPST8qMxY+FlmKJmY1goRUkJJTuztjDs8QdY2IsSZT1NFoSksMJqmgWat2tzpq7r3rnXt55uzznn+T73fM85T6IeezCCFchjdTCHp5jUErtxD2NYVeFfidO4i24T2TlciT9pQoLLuFAXcB4nK+xHG4iHcals7MZtZWzGt0hzOVxEr2iYKKU5jJt4HMW4jxs4sEz6E0ub/ThVCtiC14Xq5niO/vDviOoXMYJBGEdfxa3bC2TzWB2p78UjXMXOQnyG8U787lwFYRdfcQvT2IVZjOIMbmNrIX4eeYaFGl0+B8kMHkaBcjzBEazHs9KZPIugKryPQzP4EQs+YQBrQ4JfZcKkRr8xbMADvMNi+L7Hd7riXCdDGi2zWHD0QrsUX/C25eSkCQ4H2cuCcx2molgnQs8mDERGfzdloB9rQqONLR+VO0jTQsl7eBP739EiC/jZgmwUH/BxadxeYBMO+n/sw7aKFgLX4glLWpKdxfWmoMF4YI/HOJWR4VjoPlRV6roWGMKhaKnZsPWFrq9i/TMUfwABalYUF17+mAAAAABJRU5ErkJggg==" width="22" height="22" alt="" />
<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAABo0lEQVR42o3UO2tUYRAG4GfPJioRrFeDYCNBRImNCmKiSFSiFjaJFoIQIQiC+gP8BUYrGzvBQv0DUYyNomAREDsLbxiEQKJlArm4NrPwuX7n7BkYOMx8553bO9NQLocwji1ohxZYxwvMqykHcR+T2Jbxb8UE7mG4F9gV3IhMekkD1zFV9uAqLmA3HuIrFvAEByqAz2C62zgc0fZhKelZR1dxqgL0Go6khpko820GrKML0b+y8megiaNYxkoMo0x24HW0Iid9aBUYw3PsqjGIwQrfS5woIt11fI/SquRbhW8D7QKbYVjEbMUPn/CuR8B20ZXVdEy5W9aCo53grch2IgfYSAw/cScD+ABD+IKPeIU9eIZHybuiLyZd4E8Y5zKAc/gdQAPYif3hG0io0xSEPZn83J8s/3xws9UVYG/4ziW2Yzj/DykTeZoQ+kPNo3IXzc5QZnEpca4m3ys1wC5GOzabCb/Ggu0/8B7b8Rm38asC7HDcgsc5582gR6NmmZdxq9ej47HTZyPj3M6ejr6P5K5E2fUYwWhQai1s/UHuN6H/repf6L9fpYD7uOQAAAAASUVORK5CYII=" width="22" height="22" alt="" />
<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAABq0lEQVR42o3UO2tUURAH8N9md5OsD1ACigRBgqhYhLVRIWbFBzEYLQSfoCgqiiJESRPw8QWi9hZWIn4ALRTEYms/gGBtYWUhIii6NnPheLnnbv5w4MyZOTPznzNzGvLYg+MYxSDWCH7jLT5aJabxFOcwXqEfw1k8QXeYs0u4E5kMQwO3cC1ncAUnM7pxTGZ0x3CzEIpMuujgdebSLlzN6N7hD/alDi/iWWI0hV4N3U1YSOTnOFM43I8+/iYGX7CImZB/4GvsJ/ACnxP7AT5gFh6iXZFFBy8j4Cu8CSYr2F1h3wpfHtVQm8L3pA8HuF5j/6AVBU2xgDVxPo11Jf0NfMKWkN/jW0G9FVFTbMDacNisyKKJ9diYUE1r6X4NhR34WaJ8u47ySESsmoxRLGM++rMfDbwV2zOT04QjOFRStuNljyaPczn2m6OZt5XuzOBE4flxSbkTc4ncLVoiMInTpTsrac0P43xNbcoOyzgVM/0f7uFA5kKngmKBvVjKRVqML6yxyr/zAu4OM5qND3a+1GPpiM1F3XtVT537PHs4GC31K87a0fD9WOWh8A/LQkd8bSvmEwAAAABJRU5ErkJggg==" width="22" height="22" alt="" />
<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAABfUlEQVR42pXUu2sVQRQG8N/dvfFRGLDwD7BURGKTBzEJIaISNCKiJkUgEEgQBBVbDelzY21jYW1nQBTEwkKDyT9gpSBondJHuGnOwrLZuXf9YNiZM998Z/Y8piWNC5jFEXRjZPiLt9jVEOfxDHdxrGb/KO5gE0P9xBZxP27SDy3cw3KKsITr/h9XsFosipsM4Ti2Yj2D0w0F32EfI2VjpySe41uQtnCp4e93isUo5kqb57BXymwX25GIdg/RWUzAUwxUNk9gBV8rwj+xjpM1gu3QstbDa47b+FwR3sONGv6TLGKVwj5eYQzj+BD2wXBWRTcLj03wCb9i/gOvU4KthoKncCvmz/GvhpNlcfUmnbESrfgbLxKlkxdFPN1HLMf3CM/LBGcc1w4VZQI3SxkeTnA2kBdJeYP5HoJn47uDLwmH76sV8wgXe4iO4kyNfRiPU4cexBPWNPMLeNiPNBEP7NVE77ZxOeI+WZfq1OsxiakoqT9hG4g4fYxxqCkOAL4/SnZsd8+8AAAAAElFTkSuQmCC" width="22" height="22" alt="" />
<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAABGUlEQVR42q3USyvEYRTH8Y+ZcXkHlGyUha0hK7IkWUviFdjJG7CzpCgLK2zEwk5RwsYCuZSymJWJheUMYsZl86hpGHP5z7fO5jyn3/mdes6hNEkcI4PHEBmcoF8V9CCHObT88d6M2VDTV05sCVuIVdC4AZtYK1WwjBnVM4WN4mQv1tXOCoYKE+8Vjvnf+DmIYwCnuBCNFFrhHI2ik8AlvKgf2Rge6iiYjiFfR8F8Au1oQ1dEsRt0JHCPzrC3UejGUxxpNGEyouAOrn8+5SvO8FVj7CKLeCIkpoPlZI3uDrGNj8LkPkZrcDeIo1Kd9rCA2wqE7jCPg3L2x8KxmMAiPouEVjGOt1Bb8fUYwRWew+KnwppeYjjU/OIbztVgDx73M28AAAAASUVORK5CYII=" width="22" height="22" alt="" />
<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAAAl0lEQVR42u3VMQoCMRSE4W81IGJjI/YewdrLiJfxIB7Aa9jYWtovFmJhYbGxiWAR3RUWFXQgZHj8GV5CQuCA2NLYBVRYYuOxBlipVxWS2WL9BBxrqE6aYw1XfDzQ13f4Q2dYoMTornbMcGfMchcZp+TnWIQMNMzUutjXNHdpe8vxH/jeQE0DwwsPYJoW9dDPMJObKdv8Aq7U8UFEdJFjvQAAAABJRU5ErkJggg==" width="22" height="22" alt="" />
<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAAA1ElEQVR42uXUv0oDQRDH8Y/nYQor61QhCHmEFBbmHiRv4CMELK1Mo4RAOnsrn8PGJtrnCULAIng2e7AcJLf504QMDDM7C7+Z7ywsZ209TNE+luAIJX4OEc2i/DLEW4yPIVjZCk/4OBT/MSCX+N0XP9tQn4XYxR2uUwXzDfWHEPvo4BMFFvsiwwVeoloSfrblrgyTvobzEjdNonlDwzLC7+A95IMU/DpybHX8OVq7Im/Df8awCX8UTdDkXykPdY+/HUQrn9R3UxctcJW4ijXe8H06v+o/ljBDEfXzjSAAAAAASUVORK5CYII=" width="22" height="22" alt="" />
</p>

<p><strong>Alignment:</strong>
<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAAA4ElEQVR42sWUvwrCMBCHv7oKBd9BUHRxE4fsvphLQdDNR3F1qYuDg/ogInTSulzhOJratAEPjpRr+PK7Pwn8yVLxaLAzcAFGsWCleC+ohr3FS4l1St8BBZABN/FMYi5U2VK+J7JWQB1zbZSmQA68gLGKayDAXJQ2pq9rtjX/LDABdnWNShTsCKyk+FcDnMn6MNAFMBAha+A5qFGaqIOarBolrw2Bk2w6GKhNGWAje/M2dSyk8D7gtE1TNNR5xiZRB7nQAbeDfQf2XQbbd/U+fa+ebdTPBoRC89hvYjRYkH0BMzRFgCQtsxcAAAAASUVORK5CYII=" width="22" height="22" alt="" />
<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAABCElEQVR42u3UPUoDQRjG8Z9xLYJKrAIWKRS0kngBUat0dlp4BMEDpNBTeINYiB/4dRXtguQAOYCFkti8A0F33WVbfWBYdnb4P/PO+8zy5zRX8n0NR9hAhiGe8VrHbBVjTL+NCa7QqgPtoodlLGIPjwF+qQKdR7uCUT+g12WwAd7QqQB9iPK7v8HSOZVBm9iNtWfRsCwP9jnzLIKuY4STWHuJ2xhZI6LTxF10D07RwEIO8CNKvYj3YxziPQyY2fJ5TO6ESZE6UUE6okFU+kPb4X5foSkJWghLugnXfgVouwwGKxHaKZ6wj6UId68oJmVqRYMmOVdvHNey1s9hCwfYjCgNIx4j/0r6Apu9Qlekm4wKAAAAAElFTkSuQmCC" width="22" height="22" alt="" />
<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAABBElEQVR42tXUvUrDUBgG4Meka7dCwYvo0kHE3o3QuZtrBxc7ObeDk16Fg0N/dMgtOAkieAWCxOWrhOS0RKhDXzgk5P3h5MubwzHhHAvk6OEKo4RuFFwvtIvwNjBHiQcM4n6a0E2DG4S2DG8DeUWwbhG4rmwg35JZRdjHLYpdr5AYURGefipwjBcM/zD3YXjG2wedCrnETc2wTIS01e1EF7NY3UPUaRbDLxM7ayA7dJnzFprnmPUK1/jaJz6p/QEXNX6VGHhb3W9hq2tfsZO6rPbrnUVZ26IIzzwV+IFJlHXTImwT2kl4/+dwqH7lzyAv4/qNJ7zWAjt4xyPucYo7vB3HMf0DGjVMFUnK10AAAAAASUVORK5CYII=" width="22" height="22" alt="" />
<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAABCUlEQVR42t3UsS8EURDH8U9wTiSiIDpOFBqFUiMaheIEf4PCf6GhVOgQotGrKESiI9EpkFNrVRIV51YzRC6b3Xeh4SWTX/btzHfmvdlZ/sOq4gjTvwU7RYatlIDuEtgx6gGsYD72G2j9pLoWHtGM51tMpoJqOMdIzpGHsYk3PGEiBXgRlSwWNGUZ77gqg81ENXsJiXfCd+77ZlebUz10PwF4ELpQBKyFNhKAD6GjRcBmaG8CsC/0tQh4HzqbAPz0uStyGo9P4jInWftAXEd1Y2WZt6N7u+jJeV/BYSfjWMVZBNxgFf1hazElGU4S7/qrKRt4ieCpsAzPWI9KO16DWMFQ2BIG/vbv+AOSODhC89XfRQAAAABJRU5ErkJggg==" width="22" height="22" alt="" />
<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAAApklEQVR42mNgGOyAGYntwMDAkMDAwHCVgYHhG5q6LAYGBlMGBobTaOKiDAwMZVD2A3TDGxgYGP4zMDBoY7H4KhSjA22ongaYAAuRPvEj1stM1A5DYl24CcmLVDFwKrVdOI3SMFSGxmoWlL8RimFJ6CpUDe0jhdh0iAtgpENiXZiF5H2qREo2sZEzAnMKMxr/IQMDwwEsxRcDtOg6jUX8G1TPA4YhAQCxsh3+gB3MmAAAAABJRU5ErkJggg==" width="22" height="22" alt="" />
</p>

<p><strong>POI:</strong>
<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAABJElEQVR42tXUvUoDURAF4C9BFAsFX8BAwB8QVLAQ7ZLKF0hhaSsiKiLoIxh/HsFSK1EsrESw0MZCbSWNb2CnpojNBNbFZMlWOjBwz5mZs3Pv3L38dStkxJcxmuLecJrnY6todfDNrA4L2EclgWfxihV8Bd+PE4zhKcThFjsJrBqggcfwO5R+aaIUsXZeI2oryaRakLUcR/OjtpiRPIxjvIQfYahbQTfBQdxjI85uIIbxELGeBdcxhV1MYgJ7wa3lEZzHB+oJrh7cQh7B99jqSIIbCe49j+BFxM8wjZlYF3Heqaivi+AlDrGF5+BaOMBVHkHYjm6qgW9iyrIE279MGXOpnE9cJ3A6Xk5pENei2eUxyPImxtPP1yKWYoq92Ffs4MG/sG/XHE0Vxqt5KgAAAABJRU5ErkJggg==" width="22" height="22" alt="" />
<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAABDUlEQVR42uXSvyvFURjH8VdxZ0SEgUGMZFOGm1VMLBYp081Aoe7qzzD4U0xM6iaDGBRJBj/K9aNwuZZn+Kb7vd/uvYvy1KlTz7v3+ZzzHP56tTXIj2EZZdy1evgEHlHFK2ZakY3jAW9Yi/0L8s3IRnGLd8wm0t43k3QEN/jAfI0naEg6jCt8YiGFmYzrlzFQTzaIC1SwlHHwXgwqNWUfzvCFlQzZTsgOkasFdKKEbxQyZJshK6GrFtCBo4C2MmQbwR2juxaQi9hVbGfI1oM7QU8alA9oN0NWiOc4RW89sD9G/4SpFGY1ZOfBZ9Y0niNp2rrEUOJTJ3uL0J4QHmCuznQrKIaoiP1f/Wv/s34A1EJK9OM51/YAAAAASUVORK5CYII=" width="22" height="22" alt="" />
<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAABKUlEQVR42sXUTy4EURDH8Y8/PdgKVhzBSkSMA1iydQrLwQw3YOUAOIHYOgM7cwIbhpjZicSfTU3ydHRPt0hU8lIvXS/frle/esUf20SNszNYwypm8Yj33/x0EkcY4DNZA3RqJmUcFzlQfl3Wge6OgA1Xu2p21+hVAPbRKINNYQPb4ZdxjNcS6HqR6p0SAZp4KABu/QS7jOAd9rATvpsI0CzItJkHHkbgLFoltQzniQAnOdgLpvM1G0RmWUFds8i0HzVNgZ384Y0ItEYo30oEeI79eXqj4WYu/P0I4DA+j1tc4TTA34BP4RdHAJfC97CJj7K+G0SNqtSwUeVldJKaZCUqH9QZZcM+7CZ9uJ/rw4m687Ed18q/1YMqsLGC7w2sYCEG6Q3e/Id9Acu7ez2dKkjMAAAAAElFTkSuQmCC" width="22" height="22" alt="" />
<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAABUElEQVR42r3Uv0odYRAF8J8iXNFWUKOxsFAQK0VMEy9ikRfQh7C2jcFSW/EhxD9FylQiSIKdiI2KFhamUEwEERU0NrOwuXx7714LB4ZhZ84c+GbPTIv69gG9NbnfuPRGW8K/Gl+q19DWgHAPK4lcobU2IPyDe3SjBw+4y9U70FLmqSPYSTw3831U8RNrjUincYtHrGICneETkXssO9NB3OAKk7n8l/DMPgXmCUP1CLfwjM81+aPwvFUD+72IrDcA64laihA2oudj6i/PxPd2Ezrdjp5qirAv4nkThGcR+1PCfohYSTT+KCDMsPcpwtOIY6GvvC0UEI5HPEkV2/EXByU2KBvXYfS0F4EWQ6zfmjgcX+uBKviFFywXzLMSB+MlRvMfJrWDXSGHKVxgM6fBUcxhALuYxXUZObRhPmRRexjOopY8fWVOz3DseKbRY+9pr02OUg3oreuPAAAAAElFTkSuQmCC" width="22" height="22" alt="" />
<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAAAsElEQVR42u3UsQkCQRAF0KeYHIK5iA1oqIGgbVwDlmAhFmBgoNmltqBgAWpoJlYghppscAiydxed4Icf/JnZP7MLs9QdjUh+hulH7IB9UcMFJjk9xOCj5oJzTh+x/NYgw6sks9gznAIr1TUjh4ZI0QlMQ+wrYoZpuFI/MAuxyoal8TesoWErkl9hh2vQY9yrGCYY5XR+n7uBCZ5Fpt6W2ONNke+rjTl6kcY3rPHwU3gDOl4tIWy5higAAAAASUVORK5CYII=" width="22" height="22" alt="" />
</p>
