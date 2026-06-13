# Размеры в сцене (Model Viewer)

Вьюер хранит координаты в **единицах сцены/модели**, а метрический смысл задаётся настройками измерений:

- `measure.unit`: единица отображения `mm`, `cm` или `m`;
- `measure.unitScale`: сколько метров соответствует **1 единице сцены/модели**.

Например, если `unitScale = 0.01`, то 1 scene unit = 1 см. Все координаты POI, камеры и размерного бокса остаются в координатах сцены, а реальные размеры считаются через `unitScale`.

**glTF 2.0:** в спецификации рекомендуется **1 unit = 1 метр**; многие экспортеры (Blender и др.) так и делают. Вьюер это не проверяет и не навязывает — если в файле куб 2×2×2, в сцене будет 2×2×2 в тех же единицах, что заложил автор модели.

---

## Дефолтная сцена (пустая)

Когда нет модели или не удаётся вычислить bounds:

- **defaultSceneBounds:** `BoundingBox(center, halfExtents)`  
  - center: `(0, 1, 0)`  
  - halfExtents: `(1, 1, 1)`  
- Фактический бокс: от **(-1, 0, -1)** до **(1, 2, 1)** — куб **2×2×2** условных единиц.
- **sceneSize** = `bbox.halfExtents.length()` = √3 ≈ **1.73** (используется для камеры и zoom).

---

## Камера

- **Стартовая позиция:** `(0, 1, 10)`.
- **FOV по умолчанию:** 75° (в коде есть константа `FOCUS_FOV = 75` для расчёта zoom).
- **Zoom range:**  
  - минимум: `ZOOM_SCALE_MIN = 0.01`;  
  - максимум: при пустой сцене — `Infinity`, после загрузки — `10 * sceneSize` (т.е. привязан к размеру сцены).
- **Сброс камеры (R):** фокус `(0,0,0)`, позиция `(2, 2, 2)`.

---

## Размер сцены после загрузки модели

- **sceneBounds** — AABB по всем mesh (и при необходимости gsplat), иначе подставляется `defaultSceneBounds`.
- **sceneSize** = `bbox.halfExtents.length()` — «радиус» сцены для:
  - расчёта дистанции камеры при фокусе;
  - `zoomRange.y = 10 * sceneSize`;
  - `moveSpeed = sceneSize * 2.5`.
- **dynamicSceneBounds** — обновляемые bounds (в т.ч. для скининга/морфов), используются для:
  - near/far плоскостей камеры;
  - shadow distance и normalOffsetBias света;
  - shadow catcher.

## Размерный бокс

В панели **Alignment** есть блок **Dimension Box**:

- **Show dimension box** включает каркас поверх модели;
- **Box from Model Bounds** строит стартовый бокс по текущим `dynamicSceneBounds` после выравнивания модели;
- поля **Width / Height / Depth** вводятся в текущих единицах `measure.unit`;
- внутри состояния бокс хранится как:
  - `dimensionBox.size` — размер `[x, y, z]` в единицах сцены;
  - `dimensionBox.center` — центр `[x, y, z]` в координатах сцены;
  - `dimensionBox.enabled` — видимость.

Реальный размер = `dimensionBox.size * measure.unitScale`, затем переводится в выбранные `mm/cm/m`.
При экспорте настроек `dimensionBox` попадает в `model.model-viewer-settings.json`, поэтому сайт и VR-клиенты могут получить эти данные через Etnophonika API.

---

## Clipping (near/far)

- Подстраиваются под сцену в `fitCameraClipPlanes()`:
  - **far** = расстояние от камеры до центра bounds + `boundRadius` (радиус сцены);
  - **near** = не меньше 0.001, обычно `(dist - boundRadius)` или `far/1024`, чтобы не резать близко.
- **shadowDistance** и **normalOffsetBias** света привязаны к этому far.

---

## Сетка (debug grid)

- Включена при `debug.grid === true`.
- **Шаг сетки:** `spacing = 10^floor(log10(sceneBounds.halfExtents.length()))` — т.е. степень 10 по размеру сцены (например, при sceneSize ≈ 1.73 → spacing = 1; при 15 → 10).
- Линии рисуются в плоскости **y = 0** в диапазоне ±10 шагов (±`numGrids * spacing`).

---

## Skybox

- Масштаб ноды скайбокса: `scale = sceneBounds.halfExtents.length() * radius` (параметр dome/radius из настроек), т.е. тоже привязан к размеру сцены.

---

## Итог

| Что | Значение / зависимость |
|-----|------------------------|
| Единицы | `measure.unit` для отображения, `measure.unitScale` для перевода scene units → метры |
| Пустая сцена | Куб 2×2×2, center (0,1,0) |
| sceneSize | Длина halfExtents AABB сцены |
| Размерный бокс | `dimensionBox.size`, `dimensionBox.center`, экспортируется в settings JSON |
| Zoom | 0.01 … 10×sceneSize (или ∞ до загрузки) |
| Камера по умолчанию | (0, 1, 10), FOV 75° |
| Сетка | Шаг = степень 10 от размера сцены, y = 0 |
