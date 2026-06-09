const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace'];
const GROUP_ORDER = ['Upload', 'Assets', 'Processing', 'Preview', 'POI', 'Download', 'Embed', 'Webhooks'];

const METHOD_COLORS = {
  GET: { fill: '#55a2ff', stroke: '#2f6fb4', text: '#05070a', card: '#101820' },
  POST: { fill: '#08bf7a', stroke: '#047a50', text: '#05070a', card: '#0f1f1a' },
  PUT: { fill: '#f59e0b', stroke: '#b45309', text: '#05070a', card: '#211a0f' },
  PATCH: { fill: '#a78bfa', stroke: '#7c3aed', text: '#05070a', card: '#1b1626' },
  DELETE: { fill: '#f2645a', stroke: '#963832', text: '#05070a', card: '#201313' }
};

const GROUP_COLORS = {
  Upload: '#eff6ff',
  Assets: '#f0fdf4',
  Processing: '#fffbeb',
  Preview: '#faf5ff',
  POI: '#fef2f2',
  Download: '#ecfeff',
  Embed: '#eef2ff',
  Webhooks: '#f8fafc'
};

const COLUMN_LAYOUT = [
  { x: 40, groups: ['Upload'] },
  { x: 660, groups: ['Assets'] },
  { x: 1280, groups: ['Processing'] },
  { x: 1900, groups: ['Preview', 'POI', 'Download'] },
  { x: 2520, groups: ['Embed', 'Webhooks'] }
];

const ENDPOINT_CARD_HEIGHT = 260;
const ENDPOINT_CARD_STEP = 300;

function escapeXml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function readSpec(filePath) {
  return yaml.load(fs.readFileSync(filePath, 'utf8'));
}

function refName(ref) {
  return String(ref || '').split('/').pop();
}

function schemaName(schema) {
  if (!schema) return '';
  if (schema.$ref) return refName(schema.$ref);
  if (schema.oneOf) return schema.oneOf.map(schemaName).filter(Boolean).join(' | ');
  if (schema.items) return `${schemaName(schema.items)}[]`;
  if (Array.isArray(schema.type)) return schema.type.join(' | ');
  return schema.type || 'object';
}

function requestSchemaName(operation) {
  return schemaName(operation?.requestBody?.content?.['application/json']?.schema) || 'нет';
}

function responseLines(operation) {
  return Object.entries(operation.responses || {}).map(([code, response]) => {
    const schema = schemaName(response?.content?.['application/json']?.schema);
    return `${code}: ${response.description || ''}${schema ? ` -> ${schema}` : ''}`;
  });
}

function parameterText(parameters = []) {
  if (!parameters.length) return 'нет';
  return parameters.map((parameter) => {
    if (parameter.$ref) return refName(parameter.$ref);
    return `${parameter.name} (${parameter.in})`;
  }).join(', ');
}

function securityText(operation) {
  if (!operation.security?.length) return 'не указана';
  return operation.security.map((entry) => Object.keys(entry).join(', ')).filter(Boolean).join(', ');
}

function collectGroups(spec) {
  const groups = new Map();

  Object.entries(spec.paths ?? {}).forEach(([endpoint, pathItem]) => {
    METHODS.forEach((method) => {
      const operation = pathItem?.[method];
      if (!operation) return;

      const block = operation.tags?.[0] || 'Other';
      if (!groups.has(block)) groups.set(block, []);
      groups.get(block).push({
        method: method.toUpperCase(),
        endpoint,
        summary: operation.summary || operation.operationId || '',
        description: operation.description || '',
        operationId: operation.operationId || '',
        auth: securityText(operation),
        parameters: parameterText(operation.parameters || []),
        request: requestSchemaName(operation),
        responses: responseLines(operation)
      });
    });
  });

  return groups;
}

function makeStyle({ fill = '#ffffff', stroke = '#cbd5e1', font = '#0f172a', rounded = true, bold = false } = {}) {
  return [
    rounded ? 'rounded=1' : 'rounded=0',
    'whiteSpace=wrap',
    'html=1',
    `fillColor=${fill}`,
    `strokeColor=${stroke}`,
    `fontColor=${font}`,
    bold ? 'fontStyle=1' : 'fontStyle=0',
    'arcSize=8',
    'spacing=12',
    'align=left',
    'verticalAlign=top'
  ].join(';');
}

function methodBadgeStyle(colors) {
  return [
    'rounded=1',
    'whiteSpace=wrap',
    'html=1',
    `fillColor=${colors.fill}`,
    `strokeColor=${colors.fill}`,
    `fontColor=${colors.text}`,
    'fontStyle=1',
    'fontSize=20',
    'arcSize=8',
    'spacing=8',
    'align=center',
    'verticalAlign=middle'
  ].join(';');
}

function cell(id, value, style, x, y, width, height) {
  const encodedValue = escapeXml(value).replaceAll('\n', '&#xa;');
  return [
    `    <mxCell id="${id}" value="${encodedValue}" style="${escapeXml(style)}" vertex="1" parent="1">`,
    `      <mxGeometry x="${x}" y="${y}" width="${width}" height="${height}" as="geometry" />`,
    '    </mxCell>'
  ].join('\n');
}

function edge(id, source, target) {
  return [
    `    <mxCell id="${id}" style="edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#64748b;strokeWidth=2;endArrow=block;endFill=1;" edge="1" parent="1" source="${source}" target="${target}">`,
    '      <mxGeometry relative="1" as="geometry" />',
    '    </mxCell>'
  ].join('\n');
}

function endpointValue(operation) {
  const responseHtml = operation.responses.map((line) => `• ${line}`).join('\n');
  return [
    '',
    '',
    '',
    operation.endpoint,
    operation.summary,
    '',
    `operationId: ${operation.operationId}`,
    `auth: ${operation.auth}`,
    `params: ${operation.parameters}`,
    `request: ${operation.request}`,
    '',
    `responses:\n${responseHtml}`
  ].join('\n');
}

function buildDrawio(spec) {
  const groups = collectGroups(spec);
  const cells = [
    '    <mxCell id="0" />',
    '    <mxCell id="1" parent="0" />'
  ];
  const links = [];
  let idCounter = 2;

  const nextId = (prefix) => `${prefix}-${idCounter++}`;

  cells.push(cell(
    'title',
    `API сервера хранения и плееров\n\n${spec.info?.summary || ''}\n\nЭто API только для хранения, обработки, preview, POI, embed, download и webhooks. Портальные метаданные, CIDOC CRM, Dublin Core, КАМИС и Госкаталог сюда не входят.`,
    makeStyle({ fill: '#111827', stroke: '#111827', font: '#ffffff', bold: true }),
    40,
    20,
    980,
    180
  ));

  const orderedNames = [
    ...GROUP_ORDER.filter((name) => groups.has(name)),
    ...[...groups.keys()].filter((name) => !GROUP_ORDER.includes(name)).sort()
  ];

  const groupIds = {};
  const endpointIds = {};

  orderedNames.forEach((name) => {
    const column = COLUMN_LAYOUT.find((candidate) => candidate.groups.includes(name)) || COLUMN_LAYOUT[0];
    const groupIndex = column.groups.indexOf(name);
    const yOffset = column.groups.slice(0, groupIndex).reduce((sum, groupName) => {
      const count = groups.get(groupName)?.length || 0;
      return sum + 92 + count * ENDPOINT_CARD_STEP + 86;
    }, 0);
    const x = column.x;
    const y = 260 + yOffset;
    const operations = groups.get(name) || [];
    const groupId = `group-${name.toLowerCase()}`;
    groupIds[name] = groupId;

    cells.push(cell(
      groupId,
      `${name}\n${spec.tags?.find((tag) => tag.name === name)?.description || `${operations.length} endpoints`}`,
      makeStyle({ fill: GROUP_COLORS[name] || '#f8fafc', stroke: '#94a3b8', bold: true }),
      x,
      y,
      560,
      74
    ));

    operations.forEach((operation, index) => {
      const methodColors = METHOD_COLORS[operation.method] || METHOD_COLORS.GET;
      const methodId = nextId('method');
      const endpointId = nextId('endpoint');
      endpointIds[`${operation.method} ${operation.endpoint}`] = endpointId;
      const cardY = y + 104 + index * ENDPOINT_CARD_STEP;

      cells.push(cell(
        endpointId,
        endpointValue(operation),
        makeStyle({ fill: methodColors.card || '#111827', stroke: methodColors.stroke, font: '#f8fafc' }),
        x,
        cardY,
        560,
        ENDPOINT_CARD_HEIGHT
      ));

      cells.push(cell(
        methodId,
        operation.method,
        methodBadgeStyle(methodColors),
        x + 12,
        cardY + 12,
        168,
        64
      ));

      if (index === 0) links.push(edge(nextId('edge'), groupId, endpointId));
    });
  });

  [
    ['Upload', 'Assets'],
    ['Assets', 'Processing'],
    ['Processing', 'Preview'],
    ['Assets', 'POI'],
    ['Assets', 'Download'],
    ['Processing', 'Embed'],
    ['Processing', 'Webhooks']
  ].forEach(([source, target]) => {
    if (groupIds[source] && groupIds[target]) links.push(edge(nextId('edge'), groupIds[source], groupIds[target]));
  });

  cells.push(cell(
    'embed-options',
    'Embed параметры PlayCanvas\n\nPOST /storage/v1/embed собирает iframeUrl и iframeHtml.\n\nload / assetUrl\nembed=1\nui=full|compact|minimal\nlang=ru|en|zh\nautoplay=0|1\npanel=0|1\npoi=0|1\ntour=0|1\nmeasure=0|1\ninfo=0|1\nmodelInfo=0|1\ncontrols=0|1\nfullscreen=0|1\nfit=0|1\nreset=0|1\ncameraPosition=x,y,z\ncameraFocus=x,y,z',
    makeStyle({ fill: '#eef2ff', stroke: '#6366f1' }),
    40,
    1900,
    680,
    360
  ));

  cells.push(cell(
    'postmessage',
    'window.postMessage API\n\nКоманды:\nfocus-poi\nopen-poi\nclear-poi\nnext-poi\nprev-poi\nseek-animation\nplay-animation\npause-animation\nfreeze-animation\n\nСобытия:\npoi-selected\npoi-cleared\nanimation-time',
    makeStyle({ fill: '#fffbeb', stroke: '#f59e0b' }),
    760,
    1900,
    680,
    360
  ));

  cells.push(cell(
    'schemas',
    'Ключевые schemas\n\nCreateUploadRequest\nUploadUrlResponse\nCompleteUploadRequest\nStorageAsset\nFileUrlResponse\nDownloadUrlResponse\nPreviewAsset\nPoiItem\nCreateStorageEmbedRequest\nStorageEmbedResponse\nAssetStatusWebhook\nStorageError\n\nSchemas описывают поля request/response, а endpoints описывают команды.',
    makeStyle({ fill: '#f8fafc', stroke: '#94a3b8' }),
    1480,
    1900,
    680,
    360
  ));

  cells.push(cell(
    'security',
    'Security и границы API\n\nserviceBearerAuth - сервисный Bearer JWT между порталом и сервером хранения.\nwebhookSignature - подпись webhook через X-H3D-Signature.\n\nНе входит:\nкарточка культурного объекта\nCIDOC CRM\nDublin Core\nКАМИС\nГоскаталог\nкаталог сайта\nмодерация\nроли пользователей портала',
    makeStyle({ fill: '#fef2f2', stroke: '#ef4444' }),
    2200,
    1900,
    680,
    360
  ));

  const diagram = [
    '<mxGraphModel dx="1600" dy="1000" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="3400" pageHeight="3600" math="0" shadow="0">',
    '  <root>',
    ...cells,
    ...links,
    '  </root>',
    '</mxGraphModel>'
  ].join('\n');

  return [
    '<mxfile host="app.diagrams.net" modified="2026-05-16T00:00:00.000Z" agent="Codex" version="24.7.17" type="device">',
    '  <diagram id="storage-player-api" name="Storage Player API">',
    diagram,
    '  </diagram>',
    '</mxfile>'
  ].join('\n');
}

const input = process.argv[2] || 'docs/api/storage-player-openapi.yaml';
const output = process.argv[3] || 'docs/api/drawio/storage-player-api.drawio';
const spec = readSpec(input);
const xml = buildDrawio(spec);

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${xml}\n`);

console.log(`Exported draw.io diagram to ${output}`);
