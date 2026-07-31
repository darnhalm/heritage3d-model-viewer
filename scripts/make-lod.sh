#!/bin/bash
#
# Нарезка гауссова сплата на тайлы (Streamed SOG) и заливка в Object Storage.
#
#   scripts/make-lod.sh "путь/к/сцене.sog"
#
# Что делает:
#   1. splat-transform: прореживает источник на уровни детализации (промежуточные PLY);
#   2. splat-transform: собирает уровни в lod-meta.json + тайлы;
#   3. yc (или rclone, если установлен): заливает папку в бакет;
#   4. кладёт ссылку на вьюер в буфер обмена.
#
# Стриминга во вьюере включать не нужно: он включается самим фактом загрузки
# lod-meta.json в gsplat-компонент.
#
# Прогресс: на этапах конвертации показывается номер этапа, время и последняя
# строка вывода splat-transform (доля внутри этапа инструментом не сообщается);
# на заливке — честный процент по числу залитых файлов.
#
# Переменные окружения (все необязательные):
#   VIEWER_BUCKET        бакет                        (playcanvasviewer)
#   VIEWER_PREFIX        префикс моделей в бакете     (models)
#   VIEWER_URL           адрес вьюера                 (https://playcanvasviewer.website.yandexcloud.net)
#   LOD_LEVELS           доли прореживания            ("50% 25% 10%")
#   FILTER_HARMONICS     0..3 — обрезать SH; пусто = оставить как есть
#   LOD_CHUNK_COUNT      гауссиан на тайл, в тысячах  (по умолчанию решает splat-transform)
#   SPLAT_TRANSFORM_VER  версия инструмента           (3.1.7)
#   KEEP_TEMP=1          не удалять промежуточные PLY
#   DRY_RUN=1            всё сделать, но не заливать
#
set -euo pipefail

BUCKET="${VIEWER_BUCKET:-playcanvasviewer}"
PREFIX="${VIEWER_PREFIX:-models}"
VIEWER_URL="${VIEWER_URL:-https://playcanvasviewer.website.yandexcloud.net}"
LOD_LEVELS="${LOD_LEVELS:-50% 25% 10%}"
ST_VER="${SPLAT_TRANSFORM_VER:-3.1.7}"
LOG="${HOME}/Library/Logs/heritage3d-make-lod.log"

mkdir -p "$(dirname "$LOG")"
exec 3>&1                                   # fd 3 — исходный stdout (терминал), для прогресса
exec >>"$LOG" 2>&1                          # весь подробный вывод — в лог
echo "=== $(date '+%F %T') $* ==="

TTY=0
[ -t 3 ] && TTY=1                            # бар рисуем только в терминале

say() {
    echo "$1"
    [ "$TTY" = 1 ] && printf '\r\033[K' >&3   # затираем бар перед строкой
    echo "$1" >&3
}

notify() {
    osascript -e "display notification \"${1//\"/}\" with title \"Heritage3D: Make LOD\"" >/dev/null 2>&1 || true
}

fail() {
    say "ОШИБКА: $1"
    notify "Ошибка: $1"
    exit 1
}
trap 'fail "прервано на строке $LINENO — подробности в $LOG"' ERR

# ------------------------------------------------------------------- прогресс-бар
BAR_WIDTH=28

# $1 — процент 0..100, $2 — подпись слева, $3 — комментарий справа
draw_bar() {
    [ "$TTY" = 1 ] || return 0
    local pct=$1 label=$2 note=${3:-} filled empty bar=''
    [ "$pct" -gt 100 ] && pct=100
    filled=$((pct * BAR_WIDTH / 100))
    empty=$((BAR_WIDTH - filled))
    [ "$filled" -gt 0 ] && bar=$(printf '█%.0s' $(seq 1 "$filled"))
    [ "$empty" -gt 0 ] && bar="${bar}$(printf '░%.0s' $(seq 1 "$empty"))"
    printf '\r\033[K%-22s %s %3d%%  %s' "$label" "$bar" "$pct" "$note" >&3
}

fmt_time() {
    local s=$1
    printf '%d:%02d' $((s / 60)) $((s % 60))
}

# Запускает команду, пока она работает — крутит бар на общем прогрессе этапов.
# $1 — номер завершённых этапов, $2 — всего этапов, $3 — подпись, далее команда.
run_phase() {
    local done_phases=$1 total_phases=$2 label=$3
    shift 3
    local base=$((done_phases * 100 / total_phases))
    local next=$(((done_phases + 1) * 100 / total_phases))
    # спиннер массивом, а не строкой: bash 3.2 (штатный на macOS) режет строку
    # по байтам, и многобайтовый символ разваливается
    local spin=(⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏)
    local start=$SECONDS i=0 mark

    "$@" &
    local pid=$!
    while kill -0 "$pid" 2>/dev/null; do
        i=$(((i + 1) % 10))
        mark="${spin[$i]}"
        # внутри этапа доля неизвестна — показываем начало этапа, время и спиннер
        draw_bar "$base" "$label" "$mark $(fmt_time $((SECONDS - start)))"
        sleep 0.2
    done
    wait "$pid" || fail "$label — см. $LOG"
    draw_bar "$next" "$label" "готово за $(fmt_time $((SECONDS - start)))"
    [ "$TTY" = 1 ] && printf '\n' >&3
    return 0
}

# ---------------------------------------------------------------- входные данные
SRC="${1:-}"
[ -n "$SRC" ] || fail "не передан файл сцены"
[ -f "$SRC" ] || fail "файл не найден: $SRC"

case "$(echo "${SRC##*.}" | tr '[:upper:]' '[:lower:]')" in
    ply|sog|spz|splat|ksplat|json) ;;
    *) fail "не поддерживаемый формат: ${SRC##*.}" ;;
esac

command -v npx >/dev/null || fail "нужен Node.js (npx не найден)"

# Имя сцены → slug: без пробелов и скобок, иначе ссылку потом невозможно читать.
BASE="$(basename "$SRC")"
BASE="${BASE%.*}"
BASE="${BASE%.compressed}"
SLUG="$(printf '%s' "$BASE" \
    | tr '[:upper:]' '[:lower:]' \
    | sed -e 's/[^a-z0-9]\+/-/g' -e 's/^-//' -e 's/-$//')"
[ -n "$SLUG" ] || SLUG="scene"
DEST="${SLUG}-lod"

SRC_BYTES="$(stat -f%z "$SRC")"
SRC_MB=$((SRC_BYTES / 1048576))
say "Сцена: $BASE (${SRC_MB} МБ) → ${DEST}/"

# ---------------------------------------------------------------- место на диске
# Промежуточные PLY пишутся несжатыми: со сферическими гармониками это примерно
# 15–20× от .sog. Требуем запас, иначе конвертация упадёт на середине.
WORK="$(mktemp -d "${TMPDIR:-/tmp}/make-lod-XXXXXX")"
NEED_MB=$((SRC_MB * 20 + 512))
FREE_MB="$(df -m "$WORK" | awk 'NR==2 {print $4}')"
say "Нужно ~${NEED_MB} МБ на диске, свободно ${FREE_MB} МБ"
[ "$FREE_MB" -gt "$NEED_MB" ] || fail "мало места: нужно ~${NEED_MB} МБ, свободно ${FREE_MB} МБ (уменьшить: FILTER_HARMONICS=0)"

cleanup() {
    if [ "${KEEP_TEMP:-0}" = 1 ]; then
        say "промежуточные файлы оставлены: $WORK"
    else
        rm -rf "$WORK"
    fi
}
trap cleanup EXIT

ST=(npx --yes "@playcanvas/splat-transform@${ST_VER}")
COMMON_ARGS=(--filter-nan)
[ -n "${FILTER_HARMONICS:-}" ] && COMMON_ARGS+=(--filter-harmonics "$FILTER_HARMONICS")

LEVEL_COUNT=$(echo "$LOD_LEVELS" | wc -w | tr -d ' ')
PHASES=$((LEVEL_COUNT + 1))                  # прореживания + сборка тайлов

# ------------------------------------------------- шаг 1: прореженные уровни PLY
# Прореживание обязано быть последним действием вызова и писать .ply — поэтому
# уровни готовятся отдельными запусками, а собираются на шаге 2.
LEVEL_ARGS=("$SRC" -l 0)
LEVEL_NO=1
for FRACTION in $LOD_LEVELS; do
    OUT="${WORK}/lod${LEVEL_NO}.ply"
    run_phase "$((LEVEL_NO - 1))" "$PHASES" "Уровень ${LEVEL_NO}/${LEVEL_COUNT} (${FRACTION})" \
        "${ST[@]}" "$SRC" -d "$FRACTION" "$OUT" --scratch-dir "$WORK"
    LEVEL_ARGS+=("$OUT" -l "$LEVEL_NO")
    LEVEL_NO=$((LEVEL_NO + 1))
done

# --------------------------------------------------- шаг 2: сборка в Streamed SOG
OUT_DIR="${WORK}/${DEST}"
mkdir -p "$OUT_DIR"
CHUNK_ARGS=()
[ -n "${LOD_CHUNK_COUNT:-}" ] && CHUNK_ARGS+=(--lod-chunk-count "$LOD_CHUNK_COUNT")

run_phase "$LEVEL_COUNT" "$PHASES" "Сборка тайлов" \
    "${ST[@]}" "${CHUNK_ARGS[@]}" "${LEVEL_ARGS[@]}" "${OUT_DIR}/lod-meta.json" "${COMMON_ARGS[@]}"

FILES="$(find "$OUT_DIR" -type f | wc -l | tr -d ' ')"
OUT_MB="$(du -sm "$OUT_DIR" | awk '{print $1}')"
TILES="$(find "$OUT_DIR" -name 'meta.json' -not -name 'lod-meta.json' | wc -l | tr -d ' ')"
say "Сконвертировано: ${TILES} тайлов, ${FILES} файлов, ${OUT_MB} МБ"

# ------------------------------------------------------------------ шаг 3: заливка
LOAD_PATH="${PREFIX}/${DEST}/lod-meta.json"
LINK="${VIEWER_URL}/?load=${LOAD_PATH}"

if [ "${DRY_RUN:-0}" = 1 ]; then
    KEEP_TEMP=1
    say "DRY_RUN=1 — заливку пропускаем, результат в ${OUT_DIR}"
    say "$LINK"
    exit 0
fi

# Здесь прогресс честный: и yc, и rclone печатают строку на каждый залитый файл,
# а общее число файлов нам уже известно.
say "Заливка ${FILES} файлов в s3://${BUCKET}/${PREFIX}/${DEST}/"
UP_LOG="${WORK}/upload.log"
: >"$UP_LOG"

if command -v rclone >/dev/null; then
    rclone copy --transfers 32 --stats-one-line -v \
        --s3-provider Other --s3-endpoint https://storage.yandexcloud.net \
        "$OUT_DIR" ":s3:${BUCKET}/${PREFIX}/${DEST}" >>"$UP_LOG" 2>&1 &
else
    command -v yc >/dev/null || fail "нужен yc CLI или rclone для заливки"
    yc storage s3 cp --recursive "${OUT_DIR}/" "s3://${BUCKET}/${PREFIX}/${DEST}/" >>"$UP_LOG" 2>&1 &
fi
UP_PID=$!

UP_START=$SECONDS
while kill -0 "$UP_PID" 2>/dev/null; do
    SENT="$(grep -c -E '^(upload:|Copied )' "$UP_LOG" 2>/dev/null || echo 0)"
    [ "$SENT" -gt "$FILES" ] && SENT=$FILES
    draw_bar $((SENT * 100 / FILES)) "Заливка" "${SENT}/${FILES}  $(fmt_time $((SECONDS - UP_START)))"
    sleep 0.3
done
wait "$UP_PID" || fail "заливка не удалась — см. $LOG и $UP_LOG"
draw_bar 100 "Заливка" "${FILES}/${FILES}  за $(fmt_time $((SECONDS - UP_START)))"
[ "$TTY" = 1 ] && printf '\n' >&3
cat "$UP_LOG" >>"$LOG" || true

printf '%s' "$LINK" | pbcopy 2>/dev/null || true
say "Готово. Ссылка скопирована в буфер обмена:"
say "$LINK"
notify "Готово: ${TILES} тайлов, ${OUT_MB} МБ. Ссылка в буфере обмена."
