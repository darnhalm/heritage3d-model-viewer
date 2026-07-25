const fs = require('fs');
const path = require('path');

const outputDrawio = 'docs/api/drawio/page-api-mindmap.drawio';

const METHOD = {
  GET: { fill: '#55A2FF', card: '#101820', stroke: '#2F6FB4' },
  POST: { fill: '#08BF7A', card: '#0F1F1A', stroke: '#047A50' },
  PUT: { fill: '#F59E0B', card: '#211A0F', stroke: '#B45309' },
  PATCH: { fill: '#A78BFA', card: '#1B1626', stroke: '#7C3AED' },
  DELETE: { fill: '#F2645A', card: '#201313', stroke: '#963832' },
  EVENT: { fill: '#CBD5E1', card: '#172033', stroke: '#64748B' },
};

const groups = [
  {
    title: 'Создание музея',
    page: 'Страница создания музея',
    site: [
      ['POST', '/site/v1/organizations', 'Создать организацию / музей.'],
      ['PUT', '/site/v1/organizations/{organizationId}/avatar', 'Загрузить или назначить логотип.'],
      ['PUT', '/site/v1/organizations/{organizationId}/cover', 'Загрузить или назначить обложку.'],
      ['POST', '/site/v1/organizations/{organizationId}/members', 'Добавить участников и роли.'],
    ],
    player: [
      ['POST', '/storage/v1/uploads', 'Загрузка avatar/cover как технических файлов.'],
    ],
  },
  {
    title: 'Страница музея',
    page: 'Публичная страница музея',
    site: [
      ['GET', '/site/v1/organizations/{organizationId}', 'Карточка музея.'],
      ['GET', '/site/v1/organizations/{organizationId}/avatar', 'Логотип музея.'],
      ['GET', '/site/v1/organizations/{organizationId}/cover', 'Обложка музея.'],
      ['GET', '/site/v1/organizations/{organizationId}/collections', 'Коллекции музея.'],
      ['GET', '/site/v1/catalog/search/objects?organizationId=...', 'Объекты музея.'],
      ['POST', '/site/v1/me/favorites/organizations/{organizationId}', 'Добавить музей в избранное.'],
    ],
    player: [
      ['GET', '/storage/v1/assets/{storageAssetId}/preview', 'Preview объектов и обложек.'],
    ],
  },
  {
    title: 'Создание каталога / коллекции',
    page: 'Страница создания каталога',
    site: [
      ['POST', '/site/v1/organizations/{organizationId}/collections', 'Создать коллекцию или подколлекцию.'],
      ['PATCH', '/site/v1/collections/{collectionId}/parent', 'Задать родительскую коллекцию.'],
      ['POST', '/site/v1/collections/{collectionId}/objects', 'Добавить объекты в коллекцию.'],
      ['PUT', '/site/v1/collections/{collectionId}/thumbnail', 'Назначить миниатюру коллекции.'],
      ['POST', '/site/v1/collections/{collectionId}/thumbnail/generate', 'Сгенерировать авто-миниатюру.'],
    ],
    player: [
      ['GET', '/storage/v1/assets/{storageAssetId}/preview', 'Взять preview объектов для обложки.'],
    ],
  },
  {
    title: 'Страница каталога / коллекции',
    page: 'Публичная страница коллекции',
    site: [
      ['GET', '/site/v1/catalog/collections/{collectionSlugOrId}', 'Публичная карточка коллекции.'],
      ['GET', '/site/v1/collections/{collectionId}/objects', 'Список объектов коллекции.'],
      ['GET', '/site/v1/collections/{collectionId}/thumbnail', 'Миниатюра коллекции.'],
      ['GET', '/site/v1/catalog/facets', 'Фильтры и фасеты.'],
      ['POST', '/site/v1/me/favorites/collections/{collectionId}', 'Добавить коллекцию в избранное.'],
    ],
    player: [
      ['GET', '/storage/v1/assets/{storageAssetId}/preview', 'Preview объектов коллекции.'],
    ],
  },
  {
    title: 'Добавление / редактирование модели',
    page: 'Страница добавления и редактирования модели',
    site: [
      ['POST', '/site/v1/objects', 'Создать H3DID / культурный объект.'],
      ['PATCH', '/site/v1/objects/{h3druObjectId}', 'Обновить карточку объекта.'],
      ['PUT', '/site/v1/objects/{h3druObjectId}/metadata/dublin-core', 'Сохранить Dublin Core.'],
      ['PUT', '/site/v1/objects/{h3druObjectId}/metadata/cidoc-crm', 'Сохранить CIDOC CRM.'],
      ['POST', '/site/v1/objects/{h3druObjectId}/twins', 'Создать цифровое представление.'],
      ['POST', '/site/v1/twins/{twinId}/assets', 'Создать asset и начать загрузку.'],
      ['GET', '/site/v1/assets/{h3druAssetId}/processing-status', 'Проверить обработку.'],
      ['PUT', '/site/v1/assets/{h3druAssetId}/poi', 'Сохранить точки интереса.'],
      ['POST', '/site/v1/objects/{h3druObjectId}/submit', 'Отправить на модерацию.'],
    ],
    player: [
      ['POST', '/storage/v1/uploads', 'Получить uploadUrl.'],
      ['POST', '/storage/v1/uploads/{uploadId}/complete', 'Завершить загрузку.'],
      ['GET', '/storage/v1/assets/{storageAssetId}/status', 'Статус processing.'],
      ['POST', '/storage/v1/assets/{storageAssetId}/preview', 'Генерация preview.'],
      ['PUT', '/storage/v1/assets/{storageAssetId}/poi', 'Сохранить POI.'],
    ],
  },
  {
    title: 'Просмотр модели',
    page: 'Публичная страница модели',
    site: [
      ['GET', '/site/v1/catalog/objects/{slugOrH3DID}', 'Публичная карточка модели.'],
      ['GET', '/site/v1/objects/{h3druObjectId}/embed', 'Получить embed для viewer.'],
      ['GET', '/site/v1/assets/{h3druAssetId}/poi', 'Получить POI через сайт.'],
      ['GET', '/site/v1/assets/{h3druAssetId}/download', 'Получить ссылку скачивания, если разрешено.'],
      ['POST', '/site/v1/me/favorites/objects/{h3druObjectId}', 'Добавить модель в избранное.'],
    ],
    player: [
      ['POST', '/storage/v1/embed', 'Сформировать iframeUrl / iframeHtml.'],
      ['GET', '/storage/v1/assets/{storageAssetId}/preview', 'Poster / screenshot.'],
      ['GET', '/storage/v1/assets/{storageAssetId}/poi', 'Точки интереса.'],
      ['GET', '/storage/v1/assets/{storageAssetId}/download-url', 'Signed download URL.'],
      ['EVENT', 'window.postMessage', 'viewer.ready / poiClick / cameraChange / error.'],
    ],
  },
  {
    title: 'Создание статьи',
    page: 'Страница создания статьи',
    site: [
      ['POST', '/site/v1/articles', 'Создать черновик статьи.'],
      ['PATCH', '/site/v1/articles/{articleId}', 'Редактировать текст и блоки.'],
      ['POST', '/site/v1/articles/{articleId}/objects', 'Добавить модель в статью.'],
      ['PATCH', '/site/v1/articles/{articleId}/objects/{h3druObjectId}', 'Настроить подпись, порядок, twinId, camera/poi.'],
      ['PUT', '/site/v1/articles/{articleId}/cover', 'Назначить обложку статьи.'],
      ['POST', '/site/v1/articles/{articleId}/submit', 'Отправить статью на модерацию.'],
    ],
    player: [
      ['GET', '/storage/v1/assets/{storageAssetId}/preview', 'Preview моделей для редактора.'],
      ['POST', '/storage/v1/embed', 'Предпросмотр встроенных моделей.'],
    ],
  },
  {
    title: 'Страница статьи',
    page: 'Публичная статья с подборкой моделей',
    site: [
      ['GET', '/site/v1/catalog/articles/{slugOrArticleId}', 'Публичная статья.'],
      ['GET', '/site/v1/objects/{h3druObjectId}/embed', 'Embed для каждой модели в статье.'],
      ['GET', '/site/v1/assets/{h3druAssetId}/poi', 'POI для модели в статье.'],
      ['GET', '/site/v1/catalog/articles', 'Список опубликованных статей.'],
    ],
    player: [
      ['POST', '/storage/v1/embed', 'iframe для каждой вставленной модели.'],
      ['GET', '/storage/v1/assets/{storageAssetId}/preview', 'Preview/обложки моделей.'],
      ['EVENT', 'window.postMessage', 'Управление viewer внутри статьи.'],
    ],
  },
];

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\n', '&#xa;');
}

function cell(id, value, style, x, y, width, height) {
  return [
    `    <mxCell id="${id}" value="${esc(value)}" style="${esc(style)}" vertex="1" parent="1">`,
    `      <mxGeometry x="${x}" y="${y}" width="${width}" height="${height}" as="geometry" />`,
    '    </mxCell>',
  ].join('\n');
}

function edge(id, source, target, label, color = '#64748B') {
  return [
    `    <mxCell id="${id}" value="${esc(label)}" style="edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=${color};strokeWidth=2;endArrow=block;endFill=1;fontSize=11;fontColor=#334155;labelBackgroundColor=#ffffff;" edge="1" parent="1" source="${source}" target="${target}">`,
    '      <mxGeometry relative="1" as="geometry" />',
    '    </mxCell>',
  ].join('\n');
}

function style(parts) {
  return parts.join(';');
}

function titleStyle(fill, stroke, font = '#0F172A') {
  return style([
    'rounded=1',
    'whiteSpace=wrap',
    'html=1',
    `fillColor=${fill}`,
    `strokeColor=${stroke}`,
    `fontColor=${font}`,
    'fontStyle=1',
    'arcSize=8',
    'spacing=12',
    'align=left',
    'verticalAlign=middle',
  ]);
}

function cardStyle(method) {
  const c = METHOD[method] || METHOD.GET;
  return style([
    'rounded=1',
    'whiteSpace=wrap',
    'html=1',
    `fillColor=${c.card}`,
    `strokeColor=${c.stroke}`,
    'fontColor=#F8FAFC',
    'arcSize=8',
    'spacing=12',
    'align=left',
    'verticalAlign=top',
  ]);
}

function badgeStyle(method) {
  const c = METHOD[method] || METHOD.GET;
  return style([
    'rounded=1',
    'whiteSpace=wrap',
    'html=1',
    `fillColor=${c.fill}`,
    `strokeColor=${c.fill}`,
    'fontColor=#05070A',
    'fontStyle=1',
    'fontSize=15',
    'arcSize=8',
    'align=center',
    'verticalAlign=middle',
  ]);
}

function endpointCells(id, endpoint, x, y, width) {
  const [method, url, description] = endpoint;
  return [
    cell(id, `\n\n${url}\n${description}`, cardStyle(method), x, y, width, 118),
    cell(`${id}-badge`, method, badgeStyle(method), x + 12, y + 12, 96, 38),
  ];
}

const cells = ['    <mxCell id="0" />', '    <mxCell id="1" parent="0" />'];
const edges = [];

cells.push(cell(
  'title',
  'Страницы Heritage3D и вызовы API\n\nСлева страницы макета. В центре API сайта. Справа API storage/player и события iframe. Стрелки показывают, какие команды нужны для конкретного сценария.',
  titleStyle('#111827', '#111827', '#FFFFFF'),
  40,
  30,
  2380,
  120,
));

cells.push(cell('legend-get', 'GET', badgeStyle('GET'), 40, 175, 110, 38));
cells.push(cell('legend-post', 'POST', badgeStyle('POST'), 170, 175, 110, 38));
cells.push(cell('legend-put', 'PUT', badgeStyle('PUT'), 300, 175, 110, 38));
cells.push(cell('legend-patch', 'PATCH', badgeStyle('PATCH'), 430, 175, 110, 38));
cells.push(cell('legend-delete', 'DELETE', badgeStyle('DELETE'), 560, 175, 110, 38));
cells.push(cell('legend-event', 'EVENT', badgeStyle('EVENT'), 690, 175, 110, 38));

cells.push(cell('header-pages', 'Страницы макета', titleStyle('#E0F2FE', '#0284C7'), 40, 245, 360, 70));
cells.push(cell('header-site', 'API сайта\nH3DID, карточки, metadata, коллекции, статьи, права', titleStyle('#DCFCE7', '#16A34A'), 470, 245, 850, 70));
cells.push(cell('header-player', 'API storage/player\nupload, preview, embed, POI, download, postMessage', titleStyle('#FEF3C7', '#D97706'), 1520, 245, 900, 70));

let y = 350;

groups.forEach((group, groupIndex) => {
  const rowHeight = Math.max(group.site.length, group.player.length, 2) * 140 + 90;
  const pageId = `page-${groupIndex}`;

  cells.push(cell(`group-bg-${groupIndex}`, '', style([
    'rounded=1',
    'whiteSpace=wrap',
    'html=1',
    'fillColor=#F8FAFC',
    'strokeColor=#CBD5E1',
    'arcSize=8',
  ]), 25, y - 20, 2410, rowHeight));

  cells.push(cell(pageId, `${group.title}\n\n${group.page}`, titleStyle('#DBEAFE', '#2563EB'), 40, y, 360, 130));

  const siteIds = [];
  group.site.forEach((endpoint, index) => {
    const id = `site-${groupIndex}-${index}`;
    siteIds.push(id);
    cells.push(...endpointCells(id, endpoint, 470, y + index * 140, 850));
    edges.push(edge(`edge-page-site-${groupIndex}-${index}`, pageId, id, 'вызывает', METHOD[endpoint[0]]?.fill || '#64748B'));
  });

  group.player.forEach((endpoint, index) => {
    const id = `player-${groupIndex}-${index}`;
    cells.push(...endpointCells(id, endpoint, 1520, y + index * 140, 900));

    const source = siteIds[Math.min(index, siteIds.length - 1)];
    const label = endpoint[0] === 'EVENT' ? 'iframe события' : 'сайт -> storage/player';
    edges.push(edge(`edge-site-player-${groupIndex}-${index}`, source, id, label, METHOD[endpoint[0]]?.fill || '#64748B'));
  });

  y += rowHeight + 45;
});

const pageHeight = y + 80;
const diagram = [
  `<mxGraphModel dx="2400" dy="1400" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="2480" pageHeight="${pageHeight}" math="0" shadow="0">`,
  '  <root>',
  ...cells,
  ...edges,
  '  </root>',
  '</mxGraphModel>',
].join('\n');

const xml = [
  '<mxfile host="app.diagrams.net" modified="2026-05-18T00:00:00.000Z" agent="Codex" version="24.7.17" type="device">',
  '  <diagram id="page-api-mindmap" name="Page API Mindmap">',
  diagram,
  '  </diagram>',
  '</mxfile>',
].join('\n');

fs.mkdirSync(path.dirname(outputDrawio), { recursive: true });
fs.writeFileSync(outputDrawio, `${xml}\n`);
console.log(`Created ${outputDrawio}`);
