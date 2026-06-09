const fs = require('fs');
const path = require('path');

const outputCanvas = 'docs/api/obsidian/site-storage-functional-map.canvas';
const outputMarkdown = 'docs/SITE-STORAGE-FUNCTIONAL-MAP-RU.md';

const METHOD_COLORS = {
  GET: '#55a2ff',
  POST: '#08bf7a',
  PUT: '#f59e0b',
  PATCH: '#a78bfa',
  DELETE: '#f2645a'
};

const storageEndpoints = {
  'storage-upload': ['POST', '/storage/v1/uploads', 'Получить uploadUrl для прямой загрузки файла.'],
  'storage-complete': ['POST', '/storage/v1/uploads/{uploadId}/complete', 'Подтвердить загрузку и создать storageAssetId.'],
  'storage-asset': ['GET', '/storage/v1/assets/{storageAssetId}', 'Получить техническую карточку файла.'],
  'storage-file-url': ['GET', '/storage/v1/assets/{storageAssetId}/file-url', 'Получить fileUrl / signed URL для viewer.'],
  'storage-delete': ['DELETE', '/storage/v1/assets/{storageAssetId}', 'Удалить технический asset.'],
  'storage-status': ['GET', '/storage/v1/assets/{storageAssetId}/status', 'Получить статус обработки.'],
  'storage-preview-get': ['GET', '/storage/v1/assets/{storageAssetId}/preview', 'Получить preview/poster/screenshot.'],
  'storage-preview-post': ['POST', '/storage/v1/assets/{storageAssetId}/preview', 'Запустить генерацию preview.'],
  'storage-poi-get': ['GET', '/storage/v1/assets/{storageAssetId}/poi', 'Получить точки интереса.'],
  'storage-poi-put': ['PUT', '/storage/v1/assets/{storageAssetId}/poi', 'Сохранить точки интереса.'],
  'storage-download': ['GET', '/storage/v1/assets/{storageAssetId}/download-url', 'Получить временную ссылку на скачивание.'],
  'storage-archive': ['POST', '/storage/v1/assets/{storageAssetId}/archive', 'Переместить файл в архивное хранение.'],
  'storage-restore': ['POST', '/storage/v1/assets/{storageAssetId}/restore', 'Восстановить из архива.'],
  'storage-embed': ['POST', '/storage/v1/embed', 'Сформировать iframeUrl / iframeHtml.'],
  'storage-webhook': ['POST', '/storage/v1/webhooks/asset-status', 'Событие статуса storage -> сайт.']
};

const siteEndpoints = {
  'site-create-object': ['POST', '/site/v1/objects', 'Создать H3DID / культурный объект.'],
  'site-create-twin': ['POST', '/site/v1/objects/{h3druObjectId}/twins', 'Создать цифровой двойник.'],
  'site-create-asset': ['POST', '/site/v1/twins/{twinId}/assets', 'Создать запись файла на сайте.'],
  'site-link-storage': ['POST', '/site/v1/assets/{h3druAssetId}/link-storage', 'Сохранить storageAssetId после загрузки.'],
  'site-get-asset': ['GET', '/site/v1/assets/{h3druAssetId}', 'Получить asset сайта вместе со storage-связкой.'],
  'site-catalog-list': ['GET', '/site/v1/catalog/objects', 'Публичный список каталога с preview.'],
  'site-catalog-page': ['GET', '/site/v1/catalog/objects/{slugOrH3DID}', 'Публичная страница объекта.'],
  'site-object-embed': ['GET', '/site/v1/objects/{h3druObjectId}/embed', 'Получить embed для публичной страницы.'],
  'site-asset-embed': ['POST', '/site/v1/assets/{h3druAssetId}/embed', 'Сформировать embed с настройками сайта.'],
  'site-poi-get': ['GET', '/site/v1/assets/{h3druAssetId}/poi', 'Получить POI через сайт.'],
  'site-poi-put': ['PUT', '/site/v1/assets/{h3druAssetId}/poi', 'Сохранить POI через сайт.'],
  'site-download': ['GET', '/site/v1/assets/{h3druAssetId}/download', 'Проверить права и получить downloadUrl.'],
  'site-archive': ['POST', '/site/v1/assets/{h3druAssetId}/archive', 'Архивировать asset через сайт.'],
  'site-restore': ['POST', '/site/v1/assets/{h3druAssetId}/restore', 'Восстановить asset через сайт.'],
  'site-delete': ['DELETE', '/site/v1/assets/{h3druAssetId}', 'Удалить asset сайта и storage asset.'],
  'site-storage-webhook': ['POST', '/site/v1/webhooks/storage/asset-status', 'Принять webhook от storage.']
};

const links = [
  ['site-create-asset', 'storage-upload', 'сайт создает запись и запрашивает uploadUrl'],
  ['storage-complete', 'site-link-storage', 'storage возвращает storageAssetId, сайт сохраняет связку'],
  ['site-get-asset', 'storage-asset', 'сайт может подтянуть технический статус файла'],
  ['site-get-asset', 'storage-status', 'сайт проверяет processing status'],
  ['site-catalog-list', 'storage-preview-get', 'каталог берет preview для карточек'],
  ['site-catalog-page', 'storage-preview-get', 'страница объекта берет preview/poster'],
  ['site-catalog-page', 'storage-file-url', 'страница/viewer получает fileUrl при необходимости'],
  ['site-object-embed', 'storage-embed', 'GET сайта внутри вызывает POST storage embed'],
  ['site-asset-embed', 'storage-embed', 'POST сайта внутри вызывает POST storage embed'],
  ['site-poi-get', 'storage-poi-get', 'GET сайта проксирует GET storage POI'],
  ['site-poi-put', 'storage-poi-put', 'PUT сайта проксирует PUT storage POI'],
  ['site-download', 'storage-download', 'сайт проверяет права и запрашивает signed downloadUrl'],
  ['site-archive', 'storage-archive', 'сайт проверяет права и отправляет в архив'],
  ['site-restore', 'storage-restore', 'сайт проверяет права и восстанавливает из архива'],
  ['site-delete', 'storage-delete', 'сайт проверяет права и удаляет storage asset'],
  ['storage-webhook', 'site-storage-webhook', 'storage сам вызывает POST endpoint сайта']
];

const groups = [
  {
    title: 'Создание и загрузка',
    y: 0,
    site: ['site-create-object', 'site-create-twin', 'site-create-asset', 'site-link-storage'],
    storage: ['storage-upload', 'storage-complete']
  },
  {
    title: 'Каталог и просмотр',
    y: 760,
    site: ['site-get-asset', 'site-catalog-list', 'site-catalog-page', 'site-object-embed', 'site-asset-embed'],
    storage: ['storage-asset', 'storage-status', 'storage-preview-get', 'storage-file-url', 'storage-embed']
  },
  {
    title: 'POI и управление просмотром',
    y: 1680,
    site: ['site-poi-get', 'site-poi-put'],
    storage: ['storage-poi-get', 'storage-poi-put', 'storage-preview-post']
  },
  {
    title: 'Скачивание и жизненный цикл',
    y: 2240,
    site: ['site-download', 'site-archive', 'site-restore', 'site-delete', 'site-storage-webhook'],
    storage: ['storage-download', 'storage-archive', 'storage-restore', 'storage-delete', 'storage-webhook']
  }
];

const nodes = [];
const edges = [];

function node(id, text, x, y, width, height, color) {
  nodes.push({ id, type: 'text', x, y, width, height, color, text });
}

function edge(id, fromNode, toNode, label, color = '#64748b') {
  edges.push({ id, fromNode, fromSide: 'right', toNode, toSide: 'left', label, color });
}

function endpointCard(prefix, id, endpoint, x, y) {
  const [method, path, description] = endpoint;
  const cardId = `${prefix}-${id}`;
  const methodId = `${prefix}-${id}-method`;
  node(cardId, `\n\n# ${path}\n\n${description}`, x, y, 640, 170, '#111827');
  node(methodId, `# ${method}`, x + 16, y + 16, 150, 54, METHOD_COLORS[method] || '#94a3b8');
  return cardId;
}

node(
  'title',
  '# Функциональная связка API сайта и API storage/player\n\nСлева endpoints сайта, справа endpoints сервера хранения/плеера. Стрелки показывают, какой endpoint сайта вызывает какой endpoint storage или какой endpoint сайта принимает событие от storage.',
  0,
  -360,
  1540,
  180,
  '#111827'
);

node(
  'site-column',
  '# API сайта\n\nРаботает с `H3DID`, культурной карточкой, каталогом, правами, публикацией и связкой `h3druAssetId -> storageAssetId`.',
  0,
  -120,
  640,
  160,
  '#e0f2fe'
);

node(
  'storage-column',
  '# API storage/player\n\nРаботает с файлами, `storageAssetId`, upload, preview, POI, embed, download, archive и webhooks.',
  980,
  -120,
  640,
  160,
  '#dcfce7'
);

const siteCardIds = {};
const storageCardIds = {};

groups.forEach((group) => {
  node(`group-${group.y}`, `# ${group.title}`, 0, group.y, 1620, 70, '#f8fafc');

  group.site.forEach((id, index) => {
    siteCardIds[id] = endpointCard('site', id, siteEndpoints[id], 0, group.y + 110 + index * 210);
  });

  group.storage.forEach((id, index) => {
    storageCardIds[id] = endpointCard('storage', id, storageEndpoints[id], 980, group.y + 110 + index * 210);
  });
});

links.forEach(([from, to, label], index) => {
  const fromId = siteCardIds[from] || storageCardIds[from];
  const toId = siteCardIds[to] || storageCardIds[to];
  const sourceMethod = siteEndpoints[from]?.[0] || storageEndpoints[from]?.[0];
  edge(`link-${index + 1}`, fromId, toId, label, METHOD_COLORS[sourceMethod] || '#64748b');
});

fs.mkdirSync(path.dirname(outputCanvas), { recursive: true });
fs.writeFileSync(outputCanvas, `${JSON.stringify({ nodes, edges }, null, 2)}\n`);

const md = [
  '# Функциональная связка API сайта и storage/player',
  '',
  'Слева endpoints сайта, справа endpoints сервера хранения/плеера. Важная идея: методы не обязаны совпадать. `GET` сайта может внутри вызывать `POST` storage, если сайт отдает готовый результат пользователю, а внутри формирует его на storage.',
  '',
  '## Связки по функциям',
  '',
  '| Endpoint сайта | Endpoint storage/player | Зачем связаны |',
  '|---|---|---|',
  ...links.map(([from, to, label]) => {
    const fromEndpoint = siteEndpoints[from] || storageEndpoints[from];
    const toEndpoint = siteEndpoints[to] || storageEndpoints[to];
    return `| \`${fromEndpoint[0]} ${fromEndpoint[1]}\` | \`${toEndpoint[0]} ${toEndpoint[1]}\` | ${label} |`;
  }),
  '',
  '## Правило',
  '',
  '```text',
  'API сайта = H3DID, карточка, каталог, права, публикация.',
  'API storage/player = storageAssetId, файлы, preview, POI, embed, download.',
  'Endpoint сайта может вызывать endpoint storage с другим HTTP-методом.',
  '```',
  ''
].join('\n');

fs.writeFileSync(outputMarkdown, md);

console.log(`Created ${outputCanvas}`);
console.log(`Created ${outputMarkdown}`);
