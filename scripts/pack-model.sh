#!/bin/bash
#
# Пересборка тяжёлого GLB в формат, который вьюер открывает быстро.
#
#   scripts/pack-model.sh "путь/к/модели.glb" ["путь/к/результату.glb"]
#
# Зачем: экспорт из фотограмметрии кладёт в GLB сырую геометрию и одну огромную PNG
# (8192×8192 — это ~94 МБ файла и ~358 МБ видеопамяти вместе с мипами). Пока файл не
# скачается и не распакуется целиком, вьюер не покажет ничего: индикатор доходит до 98%
# и стоит там всё время распаковки текстуры. Тайлсеты этим не страдают, потому что
# показывают грубый уровень сразу.
#
# Что делает:
#   1. resize   — ограничивает сторону текстуры (по умолчанию 4096);
#   2. etc1s    — переводит текстуры в KTX2/Basis: на диске в разы меньше, в GPU уходит
#                 сжатой, распаковки на CPU нет вовсе. Без KTX-Software откатывается на
#                 WebP: файл тоже сильно меньше, но распаковка и видеопамять остаются;
#   3. meshopt  — сжимает геометрию (EXT_meshopt_compression).
#
# Оба расширения вьюер понимает из коробки: KHR_texture_basisu разбирает движок,
# EXT_meshopt_compression — сам вьюер (см. processBufferView в src/viewer.ts).
#
# Требуется:
#   gltf-transform  →  npm i -g @gltf-transform/cli
#   toktx           →  brew install ktx        (необязательно, но с ним результат лучше)
#
# Переменные окружения:
#   MAX_TEXTURE=4096      сторона текстуры после resize (0 — не трогать)
#   TEXTURE_MODE=etc1s    etc1s | uastc | webp  (uastc — качественнее и тяжелее)
set -euo pipefail

SRC="${1:-}"
if [[ -z "$SRC" ]]; then
    printf 'Использование: %s <модель.glb> [результат.glb]\n' "$0" >&2
    exit 2
fi
if [[ ! -f "$SRC" ]]; then
    printf 'Файл не найден: %s\n' "$SRC" >&2
    exit 2
fi

DST="${2:-${SRC%.*}.packed.glb}"
MAX_TEXTURE="${MAX_TEXTURE:-4096}"
TEXTURE_MODE="${TEXTURE_MODE:-etc1s}"

if ! command -v gltf-transform >/dev/null 2>&1; then
    printf 'Нет gltf-transform. Поставьте: npm i -g @gltf-transform/cli\n' >&2
    exit 1
fi

# KTX2 кодирует toktx из KTX-Software; без него остаётся WebP — он тоже сильно
# уменьшает файл, но текстура по-прежнему распаковывается на CPU и лежит в GPU целиком.
if [[ "$TEXTURE_MODE" != "webp" ]] && ! command -v toktx >/dev/null 2>&1; then
    printf 'Нет toktx (brew install ktx) — текстуры пойдут в WebP вместо KTX2.\n' >&2
    TEXTURE_MODE=webp
fi

human() {
    local bytes=$1
    awk -v b="$bytes" 'BEGIN { printf "%.1f МБ", b / 1048576 }'
}

size_of() {
    wc -c < "$1" | tr -d ' '
}

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
STAGE="$WORK/stage.glb"
cp "$SRC" "$STAGE"

SRC_BYTES="$(size_of "$SRC")"
printf 'Исходник: %s (%s)\n' "$SRC" "$(human "$SRC_BYTES")"

if [[ "$MAX_TEXTURE" != "0" ]]; then
    printf '1/3 resize → %s px\n' "$MAX_TEXTURE"
    gltf-transform resize "$STAGE" "$WORK/resized.glb" \
        --width "$MAX_TEXTURE" --height "$MAX_TEXTURE" >/dev/null
    mv "$WORK/resized.glb" "$STAGE"
else
    printf '1/3 resize пропущен (MAX_TEXTURE=0)\n'
fi

printf '2/3 текстуры → %s\n' "$TEXTURE_MODE"
case "$TEXTURE_MODE" in
    etc1s|uastc)
        gltf-transform "$TEXTURE_MODE" "$STAGE" "$WORK/textured.glb" >/dev/null
        ;;
    webp)
        gltf-transform webp "$STAGE" "$WORK/textured.glb" >/dev/null
        ;;
    *)
        printf 'Неизвестный TEXTURE_MODE: %s\n' "$TEXTURE_MODE" >&2
        exit 2
        ;;
esac
mv "$WORK/textured.glb" "$STAGE"

printf '3/3 геометрия → meshopt\n'
gltf-transform meshopt "$STAGE" "$WORK/packed.glb" >/dev/null
mv "$WORK/packed.glb" "$STAGE"

cp "$STAGE" "$DST"
DST_BYTES="$(size_of "$DST")"
printf '\nГотово: %s (%s)\n' "$DST" "$(human "$DST_BYTES")"
awk -v a="$SRC_BYTES" -v b="$DST_BYTES" \
    'BEGIN { printf "Стало меньше в %.1f раза\n", (b > 0 ? a / b : 0) }'
