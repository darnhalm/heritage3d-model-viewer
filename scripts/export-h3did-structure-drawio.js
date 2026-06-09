const fs = require('fs');
const path = require('path');

const outputDrawio = 'docs/api/drawio/h3did-structure.drawio';

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\n', '&#xa;');
}

function style(parts) {
  return parts.join(';');
}

function cell(id, value, styleValue, x, y, width, height) {
  return [
    `    <mxCell id="${id}" value="${esc(value)}" style="${esc(styleValue)}" vertex="1" parent="1">`,
    `      <mxGeometry x="${x}" y="${y}" width="${width}" height="${height}" as="geometry" />`,
    '    </mxCell>'
  ].join('\n');
}

function edge(id, source, target, label, color = '#64748b', dashed = false) {
  const dashedPart = dashed ? 'dashed=1;dashPattern=8 4;' : '';
  return [
    `    <mxCell id="${id}" value="${esc(label)}" style="edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;${dashedPart}strokeColor=${color};strokeWidth=2;endArrow=block;endFill=1;fontColor=${color};fontStyle=1;" edge="1" parent="1" source="${source}" target="${target}">`,
    '      <mxGeometry relative="1" as="geometry" />',
    '    </mxCell>'
  ].join('\n');
}

const titleStyle = style([
  'rounded=1',
  'whiteSpace=wrap',
  'html=1',
  'fillColor=#111827',
  'strokeColor=#111827',
  'fontColor=#ffffff',
  'fontStyle=1',
  'fontSize=20',
  'arcSize=8',
  'spacing=16',
  'align=left',
  'verticalAlign=middle'
]);

const noteStyle = style([
  'rounded=1',
  'whiteSpace=wrap',
  'html=1',
  'fillColor=#f8fafc',
  'strokeColor=#cbd5e1',
  'fontColor=#334155',
  'fontSize=13',
  'arcSize=8',
  'spacing=12',
  'align=left',
  'verticalAlign=top'
]);

function entityStyle(fill, stroke = '#64748b') {
  return style([
    'rounded=1',
    'whiteSpace=wrap',
    'html=1',
    `fillColor=${fill}`,
    `strokeColor=${stroke}`,
    'fontColor=#0f172a',
    'fontSize=14',
    'fontStyle=0',
    'arcSize=8',
    'spacing=14',
    'align=left',
    'verticalAlign=top'
  ]);
}

function coreStyle(fill, stroke = '#0f172a') {
  return style([
    'rounded=1',
    'whiteSpace=wrap',
    'html=1',
    `fillColor=${fill}`,
    `strokeColor=${stroke}`,
    'fontColor=#0f172a',
    'fontSize=15',
    'fontStyle=1',
    'arcSize=8',
    'spacing=14',
    'align=left',
    'verticalAlign=top'
  ]);
}

const cells = ['    <mxCell id="0" />', '    <mxCell id="1" parent="0" />'];
const edges = [];

cells.push(cell(
  'title',
  'Структура H3DID, организаций, коллекций и цифровых двойников\n\nГлавная идея: H3DID принадлежит организации-владельцу. Рабочая группа отвечает за процесс. Коллекции группируют объекты. Файлы живут отдельно в storage.',
  titleStyle,
  40,
  30,
  1540,
  130
));

cells.push(cell(
  'identity-band',
  '1. Идентификация и владелец',
  coreStyle('#e0f2fe', '#0284c7'),
  40,
  210,
  1540,
  52
));

cells.push(cell(
  'h3did',
  'H3DID / сквозная идентификация\n\nЕдиный namespace Heritage3D.\nНе хранит сам файл и не заменяет карточку.\nСвязывает объект, двойники, ассеты и внешние ID.',
  coreStyle('#dbeafe', '#2563eb'),
  40,
  300,
  430,
  170
));

cells.push(cell(
  'organization',
  'Организация / музей\n\norganizationId\nВладелец H3DID и культурных объектов.\nЮридически стабильный владелец данных.',
  coreStyle('#dcfce7', '#16a34a'),
  560,
  300,
  430,
  170
));

cells.push(cell(
  'external-login',
  'Geoscan Login\n\nuserId приходит из внешней системы входа.\nРегистрация и пароль не реализуются внутри H3DRU.',
  entityStyle('#fef3c7', '#d97706'),
  1080,
  300,
  430,
  170
));

cells.push(cell(
  'access-band',
  '2. Доступ внутри организации',
  coreStyle('#fef3c7', '#d97706'),
  40,
  520,
  1540,
  52
));

cells.push(cell(
  'workgroup',
  'Рабочая группа\n\nworkgroupId\nКоманда внутри организации.\nМожет меняться без смены владельца H3DID.',
  entityStyle('#fef9c3', '#ca8a04'),
  40,
  620,
  430,
  160
));

cells.push(cell(
  'membership',
  'Участие пользователя\n\nuserId + organizationId + role\nили userId + workgroupId + role.\nРоли: admin, editor, moderator, viewer.',
  entityStyle('#ffedd5', '#f97316'),
  560,
  620,
  430,
  160
));

cells.push(cell(
  'permissions',
  'Проверка прав\n\nobject:create\nasset:upload\nmetadata:edit\nmoderation:approve\nasset:download\nasset:delete',
  entityStyle('#fee2e2', '#ef4444'),
  1080,
  620,
  430,
  160
));

cells.push(cell(
  'collections-band',
  '3. Коллекции и объекты',
  coreStyle('#ede9fe', '#7c3aed'),
  40,
  840,
  1540,
  52
));

cells.push(cell(
  'collection-root',
  'Коллекция верхнего уровня\n\ncollectionId\nparentCollectionId = null\nНапример: Скульптура, Архитектура, Археология.',
  entityStyle('#f3e8ff', '#8b5cf6'),
  40,
  940,
  430,
  160
));

cells.push(cell(
  'collection-child',
  'Подколлекция\n\ncollectionId\nparentCollectionId = collectionId родителя\nОбычная модель дерева, не дублирование.',
  entityStyle('#f3e8ff', '#8b5cf6'),
  560,
  940,
  430,
  160
));

cells.push(cell(
  'object',
  'Культурный объект\n\nh3druObjectId / H3DID\nownerOrganizationId\nassignedWorkgroupId\ncollectionIds[]\nstatus: draft / review / published',
  coreStyle('#e0f2fe', '#0284c7'),
  1080,
  920,
  430,
  210
));

cells.push(cell(
  'metadata',
  'Метаданные объекта\n\nCIDOC CRM / Dublin Core\nКАМИС / Госкаталог / ЕГРОКН\nexternalIds[]\nprofile: okn / museum-object / gigapixel',
  entityStyle('#f8fafc', '#64748b'),
  1080,
  1180,
  430,
  180
));

cells.push(cell(
  'digital-band',
  '4. Цифровое представление и файлы',
  coreStyle('#dcfce7', '#16a34a'),
  40,
  1420,
  1540,
  52
));

cells.push(cell(
  'twin',
  'Цифровой двойник\n\ntwinId\nТип: playcanvas_3d, geoscan_cloud, gigapixel_2d, point_cloud, panorama.\nОдин объект может иметь несколько двойников.',
  coreStyle('#dcfce7', '#16a34a'),
  40,
  1520,
  430,
  190
));

cells.push(cell(
  'site-asset',
  'Ассет сайта\n\nh3druAssetId\nЗапись файла в портале.\nХранит связь с объектом, двойником, правами и storageAssetId.',
  entityStyle('#ccfbf1', '#0d9488'),
  560,
  1520,
  430,
  190
));

cells.push(cell(
  'storage-asset',
  'Storage asset\n\nstorageAssetId\nТехнический файл на сервере хранения.\nS3 / archive / preview / signedUrl / processing status.',
  entityStyle('#d1fae5', '#059669'),
  1080,
  1520,
  430,
  190
));

cells.push(cell(
  'rule',
  'Правило разделения\n\nAPI сайта работает с H3DID, организациями, коллекциями, правами и карточками.\nAPI storage/player работает с storageAssetId, файлами, preview, embed, POI и download.',
  noteStyle,
  40,
  1780,
  1470,
  110
));

edges.push(edge('e1', 'h3did', 'organization', 'владелец namespace / ID', '#2563eb'));
edges.push(edge('e2', 'external-login', 'membership', 'userId', '#d97706'));
edges.push(edge('e3', 'organization', 'workgroup', 'создает группы', '#16a34a'));
edges.push(edge('e4', 'organization', 'membership', 'участники организации', '#16a34a'));
edges.push(edge('e5', 'workgroup', 'membership', 'участники группы', '#ca8a04'));
edges.push(edge('e6', 'membership', 'permissions', 'роль -> права', '#ef4444'));

edges.push(edge('e7', 'organization', 'collection-root', 'владеет коллекциями', '#16a34a'));
edges.push(edge('e8', 'collection-root', 'collection-child', 'parentCollectionId', '#7c3aed'));
edges.push(edge('e9', 'collection-root', 'object', 'объекты коллекции', '#7c3aed'));
edges.push(edge('e10', 'collection-child', 'object', 'объекты подколлекции', '#7c3aed'));
edges.push(edge('e11', 'organization', 'object', 'ownerOrganizationId', '#16a34a'));
edges.push(edge('e12', 'workgroup', 'object', 'assignedWorkgroupId', '#ca8a04', true));
edges.push(edge('e13', 'permissions', 'object', 'можно редактировать / модерировать', '#ef4444', true));
edges.push(edge('e14', 'object', 'metadata', 'описание и externalIds', '#64748b'));

edges.push(edge('e15', 'h3did', 'object', 'h3druObjectId', '#2563eb'));
edges.push(edge('e16', 'object', 'twin', 'имеет цифровые двойники', '#0284c7'));
edges.push(edge('e17', 'twin', 'site-asset', 'имеет ассеты', '#0d9488'));
edges.push(edge('e18', 'site-asset', 'storage-asset', 'storageAssetId', '#059669'));

const diagram = [
  '<mxGraphModel dx="1600" dy="1200" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1640" pageHeight="1980" math="0" shadow="0">',
  '  <root>',
  ...cells,
  ...edges,
  '  </root>',
  '</mxGraphModel>'
].join('\n');

const xml = [
  '<mxfile host="app.diagrams.net" modified="2026-05-17T00:00:00.000Z" agent="Codex" version="24.7.17" type="device">',
  '  <diagram id="h3did-structure" name="H3DID Structure">',
  diagram,
  '  </diagram>',
  '</mxfile>'
].join('\n');

fs.mkdirSync(path.dirname(outputDrawio), { recursive: true });
fs.writeFileSync(outputDrawio, `${xml}\n`);

console.log(`Created ${outputDrawio}`);
