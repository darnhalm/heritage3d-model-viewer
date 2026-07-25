const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const input = 'docs/api/storage-player-openapi.yaml';
const output = 'docs/api/miro-import/storage-player-api-table-data.json';

const METHODS = ['get', 'post', 'put', 'patch', 'delete'];
const GROUP_ORDER = ['Upload', 'Assets', 'Processing', 'Preview', 'POI', 'Download', 'Embed', 'Webhooks'];

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
    return `${code}: ${resolved?.description || ''}${schema ? ` -> ${schema}` : ''}`;
  }).join('\n');
}

const spec = yaml.load(fs.readFileSync(input, 'utf8'));
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
      parameters: parameterText(spec, operation.parameters || []),
      request: requestSchemaName(operation),
      responses: responseText(operation),
      auth: securityText(operation)
    });
  });
});

const order = new Map(GROUP_ORDER.map((name, index) => [name, index]));
rows.sort((a, b) => {
  const group = (order.get(a.tag) ?? 999) - (order.get(b.tag) ?? 999);
  if (group !== 0) return group;
  return a.endpoint.localeCompare(b.endpoint) || a.method.localeCompare(b.method);
});

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify({
  title: spec.info?.title || 'API',
  summary: spec.info?.summary || '',
  rows
}, null, 2));

console.log(`Exported ${rows.length} rows to ${output}`);
