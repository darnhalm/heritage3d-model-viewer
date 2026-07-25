# Post-processing (Effects tab) — заметки для разработчиков

Цель этого файла — зафиксировать инварианты, чтобы правки UI/observer не ломали отображение эффектов (Bloom, SSAO, цветокор, FXAA, LUT).

## 1. Рендер не идёт сам по себе: `autoRender === false`

Во вьюере выставлено `app.autoRender = false`. Кадр рисуется только если выполняется условие движка:

`application.autoRender || application.renderNextFrame`

(см. `AppBase` в PlayCanvas: после кадра `renderNextFrame` сбрасывается в `false`).

**Следствие:** любое изменение состояния, которое должно сразу отразиться на канвасе (включая очередь post-effects), обязано вызывать **`viewer.renderNextFrame()`** (он выставляет `app.renderNextFrame = true`).

Иначе при неподвижной камере, без анимации и без других источников `renderNextFrame`, картинка **не обновится** — эффекты визуально «не работают», хотя очередь и параметры уже верные.

### Что уже сделано в коде

- Все обработчики observer для `posteffects.*` и `posteffects:set` после `rebuildPostEffectsQueue()` вызывают **`renderNextFrame()`**.
- `reloadSettings()` после пересборки очереди тоже вызывает **`renderNextFrame()`**, чтобы подхват сохранённых настроек не требовал движения камеры.

### Правило при добавлении новых путей observer

Если новое свойство влияет на post-processing или на то, что должно попасть в кадр при `autoRender === false`, после применения изменений вызывайте **`renderNextFrame()`** (или существующий код-путь, который его вызывает).

## 2. К какой камере вешать очередь: `getRenderingCamera()`

Очередь `camera.postEffects` должна относиться к **камере, которая реально рисует вьюпорт**: орбитальная камера вьюера **или** выбранная камера сцены glTF.

Используйте **`getRenderingCamera()`** для:

- проверки наличия `renderTarget` перед сборкой очереди;
- `addEffect` / `applyPostEffectsParamsFromObserver` (например, `cameraFarClip` для SSAO).

Проверять только `this.camera.camera` (орбитальная камера) при активной камере сцены неверно: у активной сцены RT может быть на другой сущности.

## 3. Multiframe (HD) и финальная текстура

В `multiframe.ts` геттер `sourceTex` при активной очереди post-effects должен брать цвет из **`postEffects.destinationRenderTarget`**, а не из «текущего» `cam.renderTarget` (во время поста он указывает на промежуточный таргет цепочки).

При изменении логики поста или камеры проверяйте согласованность с этим геттером.

## 4. События observer: целевой объект vs листья

Массовая подстановка `posteffects` (например, `mergePosteffectsDefaults` после частичного localStorage) может не породить событий вида `posteffects.bloom.enabled:set`. Поэтому обработчик **`posteffects:set`** обязателен для полной пересборки очереди.

## 5. Движок PlayCanvas (кратко)

Очередь `PostEffectQueue` при `enable()` подменяет `camera.renderTarget` на вход первого эффекта и выставляет `camera.onPostprocessing` для прохода после слоёв до `disablePostEffectsLayer` (по умолчанию UI). Менять это поведение во вьюере не нужно без веской причины.
