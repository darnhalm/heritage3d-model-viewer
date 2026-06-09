const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const input = 'docs/api/storage-player-openapi.yaml';
const htmlOutput = 'docs/api/miro-import/storage-player-api-table.html';
const tsvOutput = 'docs/api/miro-import/storage-player-api-table.tsv';

const METHODS = ['get', 'post', 'put', 'patch', 'delete'];
const GROUP_ORDER = ['Upload', 'Assets', 'Processing', 'Preview', 'POI', 'Download', 'Embed', 'Webhooks'];

const METHOD_META = {
  GET: { icon: '🔵', color: '#55a2ff', bg: '#eaf3ff', text: '#061525' },
  POST: { icon: '🟢', color: '#08bf7a', bg: '#e7fbf2', text: '#062116' },
  PUT: { icon: '🟠', color: '#f59e0b', bg: '#fff7e8', text: '#2b1600' },
  PATCH: { icon: '🟣', color: '#a78bfa', bg: '#f4f0ff', text: '#1b1236' },
  DELETE: { icon: '🔴', color: '#f2645a', bg: '#fff0ef', text: '#2b0806' }
};

function readSpec(filePath) {
  return yaml.load(fs.readFileSync(filePath, 'utf8'));
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function refName(ref) {
  return String(ref || '').split('/').pop();
}

function resolveRef(spec, value) {
  if (!value?.$ref) return value;
  const parts = value.$ref.replace(/^#\//, '').split('/');
  return parts.reduce((current, part) => current?.[part], spec);
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

function responseSchemaName(response) {
  return schemaName(response?.content?.['application/json']?.schema);
}

function parameterText(spec, parameters = []) {
  if (!parameters.length) return 'нет';
  return parameters.map((parameter) => {
    const resolved = resolveRef(spec, parameter) || parameter;
    return `${resolved.name || refName(parameter.$ref)}${resolved.in ? ` (${resolved.in})` : ''}`;
  }).join(', ');
}

function securityText(operation) {
  if (!operation.security?.length) return 'не указана';
  return operation.security.map((entry) => Object.keys(entry).join(', ')).filter(Boolean).join(', ');
}

function responseText(operation) {
  return Object.entries(operation.responses || {}).map(([code, response]) => {
    const resolved = response?.$ref ? { description: refName(response.$ref) } : response;
    const schema = responseSchemaName(resolved);
    return `${code}: ${resolved?.description || ''}${schema ? ` → ${schema}` : ''}`;
  }).join('\n');
}

function collectRows(spec) {
  const rows = [];

  Object.entries(spec.paths || {}).forEach(([endpoint, pathItem]) => {
    METHODS.forEach((method) => {
      const operation = pathItem?.[method];
      if (!operation) return;

      const tag = operation.tags?.[0] || 'Other';
      rows.push({
        tag,
        tagDescription: spec.tags?.find((item) => item.name === tag)?.description || '',
        method: method.toUpperCase(),
        endpoint,
        summary: operation.summary || operation.operationId || '',
        operationId: operation.operationId || '',
        auth: securityText(operation),
        parameters: parameterText(spec, operation.parameters || []),
        request: requestSchemaName(operation),
        responses: responseText(operation)
      });
    });
  });

  const order = new Map(GROUP_ORDER.map((name, index) => [name, index]));
  return rows.sort((a, b) => {
    const group = (order.get(a.tag) ?? 999) - (order.get(b.tag) ?? 999);
    if (group !== 0) return group;
    return a.endpoint.localeCompare(b.endpoint) || a.method.localeCompare(b.method);
  });
}

function renderHtml(spec, rows) {
  const grouped = Map.groupBy(rows, (row) => row.tag);
  const sections = [...grouped.entries()].map(([tag, items]) => {
    const description = items[0]?.tagDescription || '';
    const rowsHtml = items.map((row) => {
      const meta = METHOD_META[row.method] || METHOD_META.GET;
      return `
        <tr>
          <td class="method-cell" style="background:${meta.bg};">
            <span class="method-badge" style="background:${meta.color};color:${meta.text};">${meta.icon} ${row.method}</span>
          </td>
          <td class="endpoint-cell"><code>${escapeHtml(row.endpoint)}</code><div class="summary">${escapeHtml(row.summary)}</div></td>
          <td><code>${escapeHtml(row.operationId)}</code></td>
          <td>${escapeHtml(row.parameters).replaceAll('\n', '<br>')}</td>
          <td><code>${escapeHtml(row.request)}</code></td>
          <td>${escapeHtml(row.responses).replaceAll('\n', '<br>')}</td>
          <td><code>${escapeHtml(row.auth)}</code></td>
        </tr>`;
    }).join('');

    return `
      <tr class="section-row">
        <td colspan="7">
          <div class="section-title">${escapeHtml(tag)}</div>
          <div class="section-description">${escapeHtml(description)}</div>
        </td>
      </tr>
      ${rowsHtml}`;
  }).join('');

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(spec.info?.title || 'OpenAPI table')}</title>
  <style>
    :root {
      color-scheme: light;
      font-family: Inter, Arial, sans-serif;
      background: #f8fafc;
      color: #0f172a;
    }
    body {
      margin: 0;
      padding: 32px;
      background: #f8fafc;
    }
    .page {
      max-width: 1800px;
      margin: 0 auto;
    }
    h1 {
      margin: 0 0 8px;
      font-size: 30px;
      line-height: 1.15;
    }
    .lead {
      margin: 0 0 24px;
      color: #475569;
      font-size: 15px;
      max-width: 980px;
    }
    .hint {
      margin: 0 0 24px;
      padding: 12px 14px;
      background: #fffbeb;
      border: 1px solid #f59e0b;
      border-radius: 8px;
      color: #713f12;
      font-size: 14px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      background: white;
      box-shadow: 0 1px 3px rgba(15, 23, 42, 0.08);
    }
    th, td {
      border: 1px solid #cbd5e1;
      padding: 10px 12px;
      vertical-align: top;
      font-size: 13px;
      line-height: 1.35;
      white-space: normal;
      word-break: break-word;
    }
    th {
      background: #0f172a;
      color: white;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: .03em;
    }
    code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 12px;
      background: rgba(15, 23, 42, .06);
      border-radius: 4px;
      padding: 1px 4px;
    }
    .section-row td {
      background: #e2e8f0;
      border-top: 3px solid #64748b;
      padding: 14px 16px;
    }
    .section-title {
      font-size: 20px;
      font-weight: 800;
      color: #0f172a;
    }
    .section-description {
      margin-top: 3px;
      color: #475569;
      font-size: 13px;
    }
    .method-cell {
      text-align: center;
      width: 150px;
    }
    .method-badge {
      display: inline-block;
      min-width: 104px;
      padding: 8px 12px;
      border-radius: 7px;
      font-weight: 900;
      font-size: 15px;
      letter-spacing: .02em;
    }
    .endpoint-cell {
      font-weight: 700;
    }
    .summary {
      margin-top: 7px;
      color: #475569;
      font-weight: 500;
    }
    .col-method { width: 150px; }
    .col-endpoint { width: 340px; }
    .col-operation { width: 210px; }
    .col-params { width: 210px; }
    .col-request { width: 210px; }
    .col-responses { width: 390px; }
    .col-auth { width: 170px; }
  </style>
</head>
<body>
  <main class="page">
    <h1>${escapeHtml(spec.info?.title || 'OpenAPI table')}</h1>
    <p class="lead">${escapeHtml(spec.info?.summary || '')}</p>
    <p class="hint">Для Miro: открой этот HTML в браузере, выдели таблицу целиком, скопируй и вставь на доску. Если Miro упростит оформление, используй TSV-файл рядом как запасной вариант.</p>
    <table>
      <colgroup>
        <col class="col-method">
        <col class="col-endpoint">
        <col class="col-operation">
        <col class="col-params">
        <col class="col-request">
        <col class="col-responses">
        <col class="col-auth">
      </colgroup>
      <thead>
        <tr>
          <th>Method</th>
          <th>Endpoint</th>
          <th>operationId</th>
          <th>Параметры</th>
          <th>Request</th>
          <th>Responses</th>
          <th>Auth</th>
        </tr>
      </thead>
      <tbody>
        ${sections}
      </tbody>
    </table>
  </main>
</body>
</html>`;
}

function renderTsv(rows) {
  const lines = [['Группа', 'Метод', 'Endpoint', 'Описание', 'operationId', 'Параметры', 'Request', 'Responses', 'Auth']];
  rows.forEach((row) => {
    const meta = METHOD_META[row.method] || METHOD_META.GET;
    lines.push([
      row.tag,
      `${meta.icon} ${row.method}`,
      row.endpoint,
      row.summary,
      row.operationId,
      row.parameters,
      row.request,
      row.responses.replaceAll('\n', '; '),
      row.auth
    ]);
  });
  return lines.map((line) => line.map((cell) => String(cell ?? '').replaceAll('\t', ' ').replaceAll('\n', ' ')).join('\t')).join('\n');
}

const spec = readSpec(input);
const rows = collectRows(spec);

fs.mkdirSync(path.dirname(htmlOutput), { recursive: true });
fs.writeFileSync(htmlOutput, renderHtml(spec, rows));
fs.writeFileSync(tsvOutput, renderTsv(rows));

console.log(`Exported ${rows.length} endpoints to ${htmlOutput}`);
console.log(`Exported ${rows.length} endpoints to ${tsvOutput}`);
