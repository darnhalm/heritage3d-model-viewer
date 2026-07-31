#!/bin/bash
#
# Ставит быстрое действие Finder «Heritage3D: Make LOD» → правый клик по сплату,
# открывается Terminal с прогрессом конвертации и заливки.
#
#   scripts/install-quick-action.sh            # поставить
#   scripts/install-quick-action.sh --remove   # убрать
#
# Действие — обёртка: вся работа в scripts/make-lod.sh, путь к нему прописывается
# при установке (запустите заново, если репозиторий переехал).
#
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="${REPO}/scripts/make-lod.sh"
NAME="Heritage3D: Make LOD"
SERVICES="${HOME}/Library/Services"
BUNDLE="${SERVICES}/${NAME}.workflow"

if [ "${1:-}" = "--remove" ]; then
    rm -rf "$BUNDLE"
    /System/Library/CoreServices/pbs -flush 2>/dev/null || true
    echo "Удалено: $BUNDLE"
    exit 0
fi

[ -x "$SCRIPT" ] || { echo "не найден исполняемый $SCRIPT" >&2; exit 1; }

mkdir -p "${BUNDLE}/Contents"

# Тело действия. Файлы приходят аргументами (inputMethod = 1). Команда для Terminal
# пишется во временный скрипт: так не приходится экранировать пробелы и скобки в
# имени файла внутри AppleScript.
COMMAND_STRING=$(cat <<'BODY'
SCRIPT="__SCRIPT__"
for f in "$@"; do
    T="$(mktemp /tmp/make-lod-run-XXXXXX)"   # без суффикса: mktemp подставляет X только в конце шаблона
    {
        echo '#!/bin/bash'
        echo 'clear'
        printf '%q %q\n' "$SCRIPT" "$f"
        echo 'status=$?'
        echo 'echo'
        echo 'if [ $status -eq 0 ]; then echo "Ссылка скопирована в буфер обмена."; fi'
        echo 'read -n 1 -s -p "Нажмите любую клавишу, чтобы закрыть…"'
        printf 'rm -f %q\n' "$T"
        echo 'exit $status'
    } >"$T"
    chmod +x "$T"
    /usr/bin/osascript \
        -e 'on run argv' \
        -e 'tell application "Terminal" to activate' \
        -e 'tell application "Terminal" to do script ("bash " & quoted form of (item 1 of argv))' \
        -e 'end run' "$T"
done
BODY
)
COMMAND_STRING="${COMMAND_STRING//__SCRIPT__/$SCRIPT}"

# --------------------------------------------------------------------- Info.plist
cat >"${BUNDLE}/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>NSServices</key>
    <array>
        <dict>
            <key>NSMenuItem</key>
            <dict>
                <key>default</key>
                <string>${NAME}</string>
            </dict>
            <key>NSMessage</key>
            <string>runWorkflowAsService</string>
            <key>NSRequiredContext</key>
            <dict>
                <key>NSApplicationIdentifier</key>
                <string>com.apple.finder</string>
            </dict>
            <key>NSSendFileTypes</key>
            <array>
                <string>public.item</string>
            </array>
        </dict>
    </array>
</dict>
</plist>
PLIST

# ------------------------------------------------------------------ document.wflow
python3 - "$BUNDLE" "$COMMAND_STRING" <<'PY'
import plistlib, sys, uuid, pathlib

bundle, command = sys.argv[1], sys.argv[2]

action = {
    'action': {
        'AMAccepts': {'Container': 'List', 'Optional': True,
                      'Types': ['com.apple.cocoa.string']},
        'AMActionVersion': '2.0.3',
        'AMParameterProperties': {
            'COMMAND_STRING': {}, 'CheckedForUserDefaultShell': {},
            'inputMethod': {}, 'shell': {}, 'source': {}
        },
        'AMProvides': {'Container': 'List', 'Types': ['com.apple.cocoa.string']},
        'ActionBundlePath': '/System/Library/Automator/Run Shell Script.action',
        'ActionName': 'Run Shell Script',
        'ActionParameters': {
            'COMMAND_STRING': command,
            'CheckedForUserDefaultShell': True,
            'inputMethod': 1,          # файлы приходят как аргументы "$@"
            'shell': '/bin/bash',
            'source': ''
        },
        'BundleIdentifier': 'com.apple.RunShellScript',
        'CFBundleVersion': '2.0.3',
        'CanShowSelectedItemsWhenRun': False,
        'CanShowWhenRun': True,
        'Category': ['AMCategoryUtilities'],
        'Class Name': 'RunShellScriptAction',
        'InputUUID': str(uuid.uuid4()).upper(),
        'Keywords': ['Shell', 'Script', 'Command', 'Run', 'Unix'],
        'OutputUUID': str(uuid.uuid4()).upper(),
        'UUID': str(uuid.uuid4()).upper(),
        'UnlocalizedApplications': ['Automator'],
        'arguments': {},
        'isViewVisible': 1,
        'location': '309.000000:253.000000',
        'nibPath': '/System/Library/Automator/Run Shell Script.action/Contents/Resources/Base.lproj/main.nib'
    },
    'isViewVisible': 1
}

workflow = {
    'AMApplicationBuild': '528',
    'AMApplicationVersion': '2.10',
    'AMDocumentVersion': '2',
    'actions': [action],
    'connectors': {},
    'workflowMetaData': {
        'applicationBundleIDsByPath': {},
        'applicationPaths': [],
        'presentationMode': 15,                       # Quick Action
        'processesInput': 0,
        'serviceApplicationBundleID': 'com.apple.finder',
        'serviceApplicationPath': '/System/Library/CoreServices/Finder.app',
        'serviceInputTypeIdentifier': 'com.apple.Automator.fileSystemObject',
        'serviceOutputTypeIdentifier': 'com.apple.Automator.nothing',
        'serviceProcessesInput': 0,
        'systemImageName': 'NSActionTemplate',
        'useAutomaticInputType': 0,
        'workflowTypeIdentifier': 'com.apple.Automator.servicesMenu'
    }
}

path = pathlib.Path(bundle) / 'Contents' / 'document.wflow'
with path.open('wb') as f:
    plistlib.dump(workflow, f)
print(f'записан {path}')
PY

plutil -lint "${BUNDLE}/Contents/Info.plist" >/dev/null || { echo "Info.plist невалиден" >&2; exit 1; }
plutil -lint "${BUNDLE}/Contents/document.wflow" >/dev/null || { echo "document.wflow невалиден" >&2; exit 1; }

/System/Library/CoreServices/pbs -flush 2>/dev/null || true

echo "Установлено: $BUNDLE"
echo "Скрипт:      $SCRIPT"
echo
echo "Проверка: правый клик по .sog/.ply в Finder → Быстрые действия → «${NAME}»."
echo "Если пункта нет — Системные настройки → Клавиатура → Сочетания клавиш → Службы."
