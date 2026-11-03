# Источники данных профилей LUT «Цветовое зрение»

Профили в этой папке не скопированы из сторонних наборов LUT. Симуляционные таблицы рассчитаны скриптом `scripts/build-cvd-luts.py` по опубликованным моделям цветового зрения; коррекционные — по собственной экспериментальной эвристике HERITAGE3D. Ниже — всё, на чём основан расчёт, для указания в лицензиях и атрибуции.

Полный обзор доказательности и готовых сторонних профилей находится в
`luts/color-vision/RESEARCH.md` исходного репозитория.

## Программный код

| Компонент | Что используется | Лицензия |
|---|---|---|
| DaltonLens-Python, © 2021 DaltonLens — https://github.com/DaltonLens/DaltonLens-Python (коммит 3cba5e6a7c8f0e8199c8f83f1afb58eb6dab7a3d) | Реализация моделей симуляции (Brettel 1997, Viénot 1999, Machado 2009), модель LMS Smith & Pokorny 1975 для sRGB, преобразования sRGB ↔ линейный RGB | MIT — текст в `LICENSE-DaltonLens-MIT.txt` |

Код DaltonLens в плеер не встраивается: он нужен только для пересборки таблиц. Готовые PNG — результат расчёта.

## Научные модели

Модели описаны в публикациях и используются по ссылке; таблица матриц Machado et al. взята из DaltonLens (там она воспроизведена из статьи).

1. Machado G. M., Oliveira M. M., Fernandes L. A. F. A Physiologically-based Model for Simulation of Color Vision Deficiency // IEEE Transactions on Visualization and Computer Graphics. 2009. Vol. 15, № 6. P. 1291–1298. — симуляция протаномалии и дейтераномалии (степень 0,6). Страница авторов: https://www.inf.ufrgs.br/~oliveira/pubs_files/CVD_Simulation/CVD_Simulation.html
2. Viénot F., Brettel H., Mollon J. D. Digital Video Colourmaps for Checking the Legibility of Displays by Dichromats // Color Research and Application. 1999. Vol. 24, № 4. P. 243–252. — симуляция протанопии и дейтеранопии.
3. Brettel H., Viénot F., Mollon J. D. Computerized Simulation of Color Appearance for Dichromats // Journal of the Optical Society of America A. 1997. Vol. 14. P. 2647–2655. — симуляция тританомалии и тританопии.
4. Smith V. C., Pokorny J. Spectral sensitivity of the foveal cone photopigments between 400 and 500 nm // Vision Research. 1975. Vol. 15. P. 161–171. — колбочковые фундаменталы модели LMS (через DaltonLens).

## Стандарты

- IEC 61966-2-1:1999 — пространство sRGB (кодирование и первичные цвета D65).
- CIE 15:2004 / ISO/CIE 11664-4 — CIELAB, в котором выполняется коррекция (кодирование светлотой).
- Формат полосы LUT 256 × 16 в раскладке Unreal — по документации PlayCanvas Engine (`CameraFrame.colorLUT`), MIT.

## Коррекция

Метод коррекции (добавление потерянной оппонентной оси a\* или b\* к светлоте L\* в CIELAB, коэффициенты подобраны по тестовым палитрам) разработан для HERITAGE3D Viewer; код — функция `correct_lin()` в `scripts/build-cvd-luts.py`.

Метод не опубликован, не проходил рецензирование и не проверен на людях. Ссылки
Machado, Viénot и Brettel обосновывают симуляцию, но не эффективность коррекции.

## Что НЕ использовалось

Набор «Color Blind Color Lookup Tables» с сайта blog.eppz.eu (Geri Borbás) распространяется по лицензии **CC BY-NC 4.0** (только некоммерческое использование). Его таблицы в профили **не входят** и для расчёта не применялись; из него лишь сверена раскладка нейтральной полосы 256 × 16 (стандартная раскладка Unreal, которая сама по себе не является произведением).
