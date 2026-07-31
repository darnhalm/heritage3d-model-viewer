#!/bin/bash
#
# Нарезка гауссова сплата на тайлы (Streamed SOG) и заливка в Object Storage.
#
#   scripts/make-lod.sh "путь/к/сцене.sog"
#
# Что делает:
#   0. splat-transform: раскладывает источник в morton-порядке (быстрее читается дальше);
#   1. splat-transform: прореживает источник на уровни детализации (промежуточные PLY);
#   2. splat-transform: собирает уровни в lod-meta.json + тайлы;
#   3. yc (или rclone, если установлен): заливает папку в бакет;
#   4. проверяет, что сцена в бакете читается, удаляет локальные файлы;
#   5. кладёт ссылку на вьюер в буфер обмена и открывает её в браузере.
#
# Работает на том же диске, где лежит исходник (системный диск Mac обычно меньше
# и его нечем освободить), в отдельном каталоге <слаг>-lod рядом со сценой.
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
#   LOD_WORK_DIR         где работать                 (каталог исходника)
#   MORTON=1             morton-prepass               (по умолчанию 0 — см. docs)
#   KEEP_TEMP=1          ничего не удалять после себя
#   NO_OPEN=1            не открывать браузер в конце
#   DRY_RUN=1            всё сделать, но не заливать
#   FORCE=1              перезаписать существующие каталог и сцену в бакете
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

FAILED=0
fail() {
    FAILED=1
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
command -v python3 >/dev/null || fail "нужен python3 (используется для слага имени)"

# Имя сцены → slug: без пробелов, скобок и кириллицы, иначе ссылку потом
# невозможно ни прочитать, ни собрать (пробелы в ?load= требуют двойного
# кодирования). Кириллица транслитерируется, иначе от русского названия не
# осталось бы ничего и разные сцены схлопнулись бы в одно имя.
BASE="$(basename "$SRC")"
BASE="${BASE%.*}"
BASE="${BASE%.compressed}"
SLUG="$(printf '%s' "$BASE" | python3 -c '
import re, sys, unicodedata

RU = {
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "e",
    "ж": "zh", "з": "z", "и": "i", "й": "y", "к": "k", "л": "l", "м": "m",
    "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u",
    "ф": "f", "х": "h", "ц": "ts", "ч": "ch", "ш": "sh", "щ": "sch",
    "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "yu", "я": "ya"
}

text = sys.stdin.read().strip().lower()
text = "".join(RU.get(ch, ch) for ch in text)
# остальные не-ASCII (умляуты, диакритика) — через разложение Unicode
text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
print(re.sub(r"-{2,}", "-", re.sub(r"[^a-z0-9]+", "-", text)).strip("-"))
')"
[ -n "$SLUG" ] || SLUG="scene"
DEST="${SLUG}-lod"

# Слаг может совпасть у разных исходников — молча затирать чужую сцену нельзя.
if [ "${FORCE:-0}" != 1 ] && [ "${DRY_RUN:-0}" != 1 ]; then
    EXISTING="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 \
        "${VIEWER_URL}/${PREFIX}/${DEST}/lod-meta.json" || echo 000)"
    [ "$EXISTING" = 200 ] && fail "в бакете уже есть ${PREFIX}/${DEST}/ — перезапись только с FORCE=1"
fi

SRC_BYTES="$(stat -f%z "$SRC")"
SRC_MB=$((SRC_BYTES / 1048576))
say "Сцена: $BASE (${SRC_MB} МБ) → ${DEST}/"

# ------------------------------------------------------- рабочий каталог и место
# Работаем на том диске, где лежит исходник: сцены живут на внешнем томе, а
# системный диск Mac обычно и меньше, и забит — в $TMPDIR полтора гигабайта
# промежуточных файлов может не влезть. Всё по одной модели складываем в
# отдельный каталог <слаг>-lod, чтобы не сорить в каталоге с моделями.
SRC_DIR="$(cd "$(dirname "$SRC")" && pwd)"
WORK_ROOT="${LOD_WORK_DIR:-$SRC_DIR}"
if [ ! -w "$WORK_ROOT" ]; then
    say "каталог ${WORK_ROOT} недоступен на запись — работаем в ${TMPDIR:-/tmp}"
    WORK_ROOT="${TMPDIR:-/tmp}"
fi
WORK="${WORK_ROOT%/}/${DEST}"

# Каталог мы потом удаляем целиком, поэтому чужой не берём: либо его нет, либо он
# пустой, либо явный FORCE=1.
if [ -e "$WORK" ]; then
    [ -d "$WORK" ] || fail "по пути ${WORK} лежит файл — уберите его"
    if [ "${FORCE:-0}" = 1 ]; then
        say "FORCE=1 — очищаем существующий ${WORK}"
        rm -rf "$WORK"
    elif [ -n "$(ls -A "$WORK" 2>/dev/null)" ]; then
        fail "каталог ${WORK} уже существует и не пуст — удалите его или запустите с FORCE=1"
    fi
fi

TMP_DIR="${WORK}/tmp"                       # промежуточные PLY и scratch инструмента
OUT_DIR="${WORK}/tiles"                     # то, что уезжает в бакет как есть
mkdir -p "$TMP_DIR" "$OUT_DIR"

# Промежуточные PLY пишутся несжатыми: со сферическими гармониками это примерно
# 15–20× от .sog. Требуем запас, иначе конвертация упадёт на середине.
NEED_MB=$((SRC_MB * 20 + 512))
# morton-копия — это полная сцена в несжатом PLY, ещё столько же
[ "${MORTON:-0}" = 1 ] && NEED_MB=$((NEED_MB + SRC_MB * 20))
FREE_MB="$(df -m "$WORK" | awk 'NR==2 {print $4}')"
say "Работаем в ${WORK}"
say "Нужно ~${NEED_MB} МБ на диске, свободно ${FREE_MB} МБ"
[ "$FREE_MB" -gt "$NEED_MB" ] || fail "мало места: нужно ~${NEED_MB} МБ, свободно ${FREE_MB} МБ (уменьшить: FILTER_HARMONICS=0)"

# Удаляем ровно свой каталог: путь обязан оканчиваться на -lod, иначе оставляем
# как есть — лучше мусор на диске, чем rm -rf по чужой папке с моделями.
drop_work() {
    case "$WORK" in
        */*-lod) rm -rf "$WORK" ;;
        *) say "подозрительный путь, не удаляю: $WORK" ;;
    esac
}

cleanup() {
    local status=$?
    # bash при set -u (например, на пустом массиве) выходит мимо ERR-trap и молча —
    # без этого пользователь не увидел бы вообще ничего
    if [ "$status" != 0 ] && [ "$FAILED" = 0 ]; then
        say "ОШИБКА: прервано (код ${status}) — подробности в $LOG"
        notify "Ошибка: см. $LOG"
    fi
    if [ "${KEEP_TEMP:-0}" = 1 ]; then
        [ -d "$WORK" ] && say "файлы оставлены: $WORK"
        return 0
    fi
    [ -d "$WORK" ] || return 0
    drop_work
    return 0
}
trap cleanup EXIT

ST=(npx --yes "@playcanvas/splat-transform@${ST_VER}")
COMMON_ARGS=(--filter-nan)
[ -n "${FILTER_HARMONICS:-}" ] && COMMON_ARGS+=(--filter-harmonics "$FILTER_HARMONICS")

LEVEL_COUNT=$(echo "$LOD_LEVELS" | wc -w | tr -d ' ')
PHASES=$((LEVEL_COUNT + 1))                  # прореживания + сборка тайлов

# --------------------------------------------------- шаг 0: morton-порядок (prepass)
# splat-transform на неупорядоченном входе советует разовый --morton-order. По замерам
# на Ославии он себя не окупает: этап уровня ускорился с 1:38 до 1:30, а сам prepass
# стоил 13 с и 724 МБ на диске — и предупреждение о некогерентности инструмент всё
# равно продолжает печатать уже на morton-копии. Поэтому по умолчанию выключен.
# Когда включён, здесь же применяются фильтры — дальше по цепочке данные идут уже
# отфильтрованными.
MORTON_PHASE=0
SOURCE="$SRC"
if [ "${MORTON:-0}" = 1 ]; then
    MORTON_PHASE=1
    PHASES=$((PHASES + 1))
    MORTON_PLY="${TMP_DIR}/source-morton.ply"
    run_phase 0 "$PHASES" "Morton-порядок" \
        "${ST[@]}" "$SRC" "${COMMON_ARGS[@]}" --morton-order "$MORTON_PLY"
    SOURCE="$MORTON_PLY"
    MORTON_MB="$(du -sm "$MORTON_PLY" | awk '{print $1}')"
    say "Morton-копия: ${MORTON_MB} МБ"
fi

# ------------------------------------------------- шаг 1: прореженные уровни PLY
# Прореживание обязано быть последним действием вызова и писать .ply — поэтому
# уровни готовятся отдельными запусками, а собираются на шаге 2.
LEVEL_ARGS=("$SOURCE" -l 0)
LEVEL_NO=1
for FRACTION in $LOD_LEVELS; do
    OUT="${TMP_DIR}/lod${LEVEL_NO}.ply"
    # без prepass фильтры не применялись нигде до сборки — ставим их перед -d
    # (сам -d обязан быть последним действием)
    FILTER_ARGS=()
    [ "$MORTON_PHASE" = 0 ] && FILTER_ARGS=("${COMMON_ARGS[@]}")
    run_phase "$((LEVEL_NO - 1 + MORTON_PHASE))" "$PHASES" "Уровень ${LEVEL_NO}/${LEVEL_COUNT} (${FRACTION})" \
        "${ST[@]}" "$SOURCE" ${FILTER_ARGS[@]+"${FILTER_ARGS[@]}"} -d "$FRACTION" "$OUT" --scratch-dir "$TMP_DIR"
    LEVEL_ARGS+=("$OUT" -l "$LEVEL_NO")
    LEVEL_NO=$((LEVEL_NO + 1))
done

# --------------------------------------------------- шаг 2: сборка в Streamed SOG
CHUNK_ARGS=()
[ -n "${LOD_CHUNK_COUNT:-}" ] && CHUNK_ARGS+=(--lod-chunk-count "$LOD_CHUNK_COUNT")

# ${A[@]+"${A[@]}"} — иначе bash 3.2 с set -u ругается на пустой массив
run_phase "$((LEVEL_COUNT + MORTON_PHASE))" "$PHASES" "Сборка тайлов" \
    "${ST[@]}" ${CHUNK_ARGS[@]+"${CHUNK_ARGS[@]}"} "${LEVEL_ARGS[@]}" \
    "${OUT_DIR}/lod-meta.json" "${COMMON_ARGS[@]}"

FILES="$(find "$OUT_DIR" -type f | wc -l | tr -d ' ')"
OUT_MB="$(du -sm "$OUT_DIR" | awk '{print $1}')"
TILES="$(find "$OUT_DIR" -name 'meta.json' -not -name 'lod-meta.json' | wc -l | tr -d ' ')"
say "Сконвертировано: ${TILES} тайлов, ${FILES} файлов, ${OUT_MB} МБ"

# Промежуточные PLY больше не нужны — на них приходится почти весь занятый объём,
# и держать его во время заливки незачем.
if [ "${KEEP_TEMP:-0}" != 1 ] && [ -d "$TMP_DIR" ]; then
    TMP_MB="$(du -sm "$TMP_DIR" | awk '{print $1}')"
    rm -rf "$TMP_DIR"
    say "Промежуточные файлы удалены, освобождено ${TMP_MB} МБ"
fi

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
UP_LOG="${WORK}/upload.log"        # рядом с tiles/, а не внутри: иначе уедет в бакет
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
    # без совпадений grep печатает 0 и возвращает 1 — с `|| echo 0` в SENT
    # попадало бы «0\n0», и дальше всё ломалось на арифметике
    SENT="$(grep -c -E '^(upload:|Copied )' "$UP_LOG" 2>/dev/null || true)"
    [ -n "$SENT" ] || SENT=0
    [ "$SENT" -gt "$FILES" ] && SENT=$FILES
    draw_bar $((SENT * 100 / FILES)) "Заливка" "${SENT}/${FILES}  $(fmt_time $((SECONDS - UP_START)))"
    sleep 0.3
done
wait "$UP_PID" || fail "заливка не удалась — см. $LOG и $UP_LOG"
draw_bar 100 "Заливка" "${FILES}/${FILES}  за $(fmt_time $((SECONDS - UP_START)))"
[ "$TTY" = 1 ] && printf '\n' >&3
cat "$UP_LOG" >>"$LOG" || true

# ------------------------------------------------- шаг 4: проверка и чистка диска
# Локальную копию удаляем только убедившись, что сцена читается из бакета: иначе
# «успешная» заливка без результата унесла бы с собой часы конвертации.
CHECK="$(curl -s -o /dev/null -w '%{http_code}' --max-time 30 "${VIEWER_URL}/${LOAD_PATH}" || echo 000)"
if [ "$CHECK" = 200 ]; then
    if [ "${KEEP_TEMP:-0}" = 1 ]; then
        say "KEEP_TEMP=1 — локальная копия оставлена: $WORK"
    else
        drop_work
        say "Локальная копия удалена, освобождено ${OUT_MB} МБ"
    fi
else
    KEEP_TEMP=1                          # cleanup на выходе тоже ничего не тронет
    say "ВНИМАНИЕ: ${LOAD_PATH} в бакете не читается (HTTP ${CHECK}) — локальные файлы оставлены в ${WORK}"
fi

printf '%s' "$LINK" | pbcopy 2>/dev/null || true
say "Готово. Ссылка скопирована в буфер обмена:"
say "$LINK"
notify "Готово: ${TILES} тайлов, ${OUT_MB} МБ. Ссылка в буфере обмена."

# ------------------------------------------------------- шаг 5: открыть во вьюере
if [ "${NO_OPEN:-0}" != 1 ]; then
    open "$LINK" >/dev/null 2>&1 || say "не удалось открыть браузер — ссылка выше"
fi
