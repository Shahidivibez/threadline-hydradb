const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');

const PORT = Number(process.env.PORT || 3000);
const HYDRA = (process.env.HYDRADB_URL || 'http://127.0.0.1:8443').replace(/\/$/, '');
const TOKEN = process.env.HYDRADB_TOKEN || 'local-development-token-32-bytes';
const GRAPH = process.env.HYDRADB_GRAPH || 'default';
const CELL = process.env.HYDRADB_CELL || 'cell-0';
const NAMESPACE = process.env.HYDRADB_NAMESPACE || 'default';
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');

class HydraError extends Error {
  constructor(message, status = 503) { super(message); this.status = status; }
}

async function query(cypher, parameters = {}) {
  let response;
  try {
    response = await fetch(`${HYDRA}/v1/graphs/${GRAPH}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
        'X-Graph-Namespace': NAMESPACE,
        'Accept': 'application/json',
      },
      body: JSON.stringify({ cell_id: CELL, query: cypher, parameters }),
      signal: AbortSignal.timeout(12000),
    });
  } catch (err) {
    throw new HydraError(`Can't reach the local HydraDB query API at ${HYDRA}. Is graph-node running? (${err.message})`);
  }
  const text = await response.text();
  let payload;
  try { payload = JSON.parse(text); } catch { throw new HydraError(`HydraDB returned an unreadable response: ${text.slice(0, 250)}`, response.status || 502); }
  if (!response.ok || payload.error) {
    const detail = payload?.error?.message || text || `HTTP ${response.status}`;
    throw new HydraError(`HydraDB query failed: ${detail}`, response.status || 500);
  }
  if (!Array.isArray(payload.rows)) throw new HydraError('Unexpected HydraDB response: missing rows array.', 502);
  return payload.rows.map(row => Object.fromEntries((payload.columns || []).map((column, i) => [column, row[i]?.value ?? null])));
}

const mcpSchemas = {
  get_customer: { type: 'object', properties: { customer_name: { type: 'string', description: 'Account name to resolve.' } }, required: ['customer_name'] },
  find_invoices: { type: 'object', properties: { customer_id: { type: 'string' }, status: { type: 'string', enum: ['open', 'paid', 'overdue'] } }, required: ['customer_id'] },
  draft_email: { type: 'object', properties: { to: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' } }, required: ['to', 'subject', 'body'] },
  find_contracts: { type: 'object', properties: { customer_id: { type: 'string' }, status: { type: 'string' } }, required: ['customer_id'] },
  search_support_history: { type: 'object', properties: { customer_id: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 20 } }, required: ['customer_id'] },
  create_followup_task: { type: 'object', properties: { customer_id: { type: 'string' }, title: { type: 'string' }, due_date: { type: 'string', format: 'date' } }, required: ['customer_id', 'title', 'due_date'] },
  search_documents: { type: 'object', properties: { customer_id: { type: 'string' }, query: { type: 'string' } }, required: ['customer_id', 'query'] },
  find_tickets: { type: 'object', properties: { customer_id: { type: 'string' }, status: { type: 'string', enum: ['open', 'closed'] } }, required: ['customer_id'] },
  get_calendar: { type: 'object', properties: { owner_id: { type: 'string' }, range: { type: 'string', description: 'Optional date range.' } }, required: ['owner_id'] },
};

const groups = [
  { label: 'Agent', query: 'UNWIND $rows AS row CREATE (n:Agent {id: row.id, key: row.key, name: row.name, summary: row.summary})', rows: [
    { id: 100, key: 'context-router', name: 'Threadline agent', summary: 'Routes each task to the smallest useful subgraph of skills, tools, and resolved entities.' },
  ]},
  { label: 'Skill', query: 'UNWIND $rows AS row CREATE (n:Skill {id: row.id, key: row.key, name: row.name, summary: row.summary})', rows: [
    { id: 200, key: 'invoice-followup', name: 'Invoice follow-up', summary: 'Find an account and its overdue invoices, then draft a grounded follow-up.' },
    { id: 201, key: 'renewal-review', name: 'Renewal review', summary: 'Check contract timing and account signals before preparing a renewal plan.' },
    { id: 202, key: 'support-triage', name: 'Support triage', summary: 'Find open customer issues and prepare a concise, source-linked response.' },
    { id: 203, key: 'meeting-prep', name: 'Meeting preparation', summary: 'Assemble only the account facts and documents relevant to an upcoming meeting.' },
  ]},
  { label: 'MCPServer', query: 'UNWIND $rows AS row CREATE (n:MCPServer {id: row.id, key: row.key, name: row.name, summary: row.summary})', rows: [
    { id: 300, key: 'crm-mcp', name: 'CRM MCP', summary: 'Customer records, contracts, and follow-up tasks.' },
    { id: 301, key: 'billing-mcp', name: 'Billing MCP', summary: 'Invoices and payment status.' },
    { id: 302, key: 'support-mcp', name: 'Support MCP', summary: 'Tickets, knowledge base, and customer communications.' },
  ]},
  { label: 'Tool', query: 'UNWIND $rows AS row CREATE (n:Tool {id: row.id, key: row.key, name: row.name, summary: row.summary, schema: row.schema, token_estimate: row.token_estimate, risk: row.risk})', rows: [
    { id: 400, key: 'get_customer', name: 'get_customer', summary: 'Fetch the resolved CRM account profile and owner.', schema: '{"customer_name":"string"}', token_estimate: 39, risk: 'read' },
    { id: 401, key: 'find_invoices', name: 'find_invoices', summary: 'List invoices and payment status for a resolved account.', schema: '{"customer_id":"string","status":"optional string"}', token_estimate: 53, risk: 'read' },
    { id: 402, key: 'draft_email', name: 'draft_email', summary: 'Create an unsent email draft using approved account context.', schema: '{"to":"string","subject":"string","body":"string"}', token_estimate: 49, risk: 'write: draft only' },
    { id: 403, key: 'find_contracts', name: 'find_contracts', summary: 'Find active contracts and renewal dates for an account.', schema: '{"customer_id":"string","status":"optional string"}', token_estimate: 51, risk: 'read' },
    { id: 404, key: 'search_support_history', name: 'search_support_history', summary: 'Search an account’s past support conversations.', schema: '{"customer_id":"string","limit":"optional number"}', token_estimate: 45, risk: 'read' },
    { id: 405, key: 'create_followup_task', name: 'create_followup_task', summary: 'Create a CRM follow-up task; requires user confirmation.', schema: '{"customer_id":"string","title":"string","due_date":"string"}', token_estimate: 52, risk: 'write: confirm' },
    { id: 406, key: 'search_documents', name: 'search_documents', summary: 'Search approved account documents and return source snippets.', schema: '{"customer_id":"string","query":"string"}', token_estimate: 46, risk: 'read' },
    { id: 407, key: 'find_tickets', name: 'find_tickets', summary: 'List open support tickets linked to an account.', schema: '{"customer_id":"string","status":"optional string"}', token_estimate: 48, risk: 'read' },
    { id: 408, key: 'get_calendar', name: 'get_calendar', summary: 'Find upcoming meetings for an account owner.', schema: '{"owner_id":"string","range":"optional string"}', token_estimate: 42, risk: 'read' },
  ]},
  { label: 'Entity', query: 'UNWIND $rows AS row CREATE (n:Entity {id: row.id, key: row.key, name: row.name, kind: row.kind, status: row.status, summary: row.summary, amount: row.amount, due: row.due})', rows: [
    { id: 500, key: 'acme', name: 'Acme Systems', kind: 'customer', status: 'active', summary: 'Enterprise customer. Account owner: Maya Chen.' },
    { id: 501, key: 'northstar', name: 'Northstar Labs', kind: 'customer', status: 'active', summary: 'Growth customer. Account owner: Luca Meyer.' },
    { id: 502, key: 'invoice-acme-1042', name: 'Invoice INV-1042', kind: 'invoice', status: 'overdue', summary: 'Platform subscription, 18 days overdue.', amount: '$4,800', due: 'Oct 28, 2026' },
    { id: 503, key: 'invoice-acme-1088', name: 'Invoice INV-1088', kind: 'invoice', status: 'paid', summary: 'Implementation services, paid in full.', amount: '$1,200', due: 'Nov 05, 2026' },
    { id: 504, key: 'contract-acme-26', name: 'Enterprise renewal', kind: 'contract', status: 'renewal in 42 days', summary: 'Annual plan; renewal date Dec 27, 2026.' },
    { id: 505, key: 'ticket-acme-77', name: 'Ticket CS-77', kind: 'support ticket', status: 'open', summary: 'Customer asked about invoice line-item detail.' },
    { id: 506, key: 'doc-acme-qbr', name: 'QBR notes', kind: 'document', status: 'current', summary: 'QBR notes: finance team prefers a single consolidated invoice.' },
    { id: 507, key: 'invoice-northstar-301', name: 'Invoice NS-301', kind: 'invoice', status: 'paid', summary: 'Monthly analytics subscription, paid.', amount: '$890', due: 'Nov 02, 2026' },
    { id: 508, key: 'contract-northstar-11', name: 'Pilot extension', kind: 'contract', status: 'active', summary: 'Pilot extension; decision expected Jan 15, 2027.' },
    { id: 509, key: 'ticket-northstar-19', name: 'Ticket NS-19', kind: 'support ticket', status: 'open', summary: 'Intermittent export timeout under investigation.' },
    { id: 510, key: 'doc-northstar-ops', name: 'Ops handoff', kind: 'document', status: 'current', summary: 'Engineering is testing a fix for the export timeout.' },
  ]},
];

const edges = [
  { type: 'HAS_SKILL', from: 100, to: 200 }, { type: 'HAS_SKILL', from: 100, to: 201 },
  { type: 'HAS_SKILL', from: 100, to: 202 }, { type: 'HAS_SKILL', from: 100, to: 203 },
  ...[[200,400],[200,401],[200,402],[201,400],[201,403],[201,404],[201,405],[202,400],[202,407],[202,406],[202,402],[203,400],[203,406],[203,401],[203,403],[203,408]].map(([from,to]) => ({ type:'NEEDS', from, to })),
  ...[[400,300],[403,300],[404,302],[405,300],[406,302],[407,302],[408,300],[401,301],[402,302]].map(([from,to]) => ({ type:'PROVIDED_BY', from, to })),
  ...[[500,502],[500,503],[500,504],[500,505],[500,506],[501,507],[501,508],[501,509],[501,510]].map(([from,to]) => ({ type:'RELATED_TO', from, to })),
];

let seedPromise;
async function ensureSeed() {
  if (!seedPromise) seedPromise = (async () => {
    const existing = await query('MATCH (a:Agent {key: $key}) RETURN a.id AS id LIMIT 1', { key: 'context-router' });
    for (const group of groups) {
      const sourceRows = group.label === 'Tool'
        ? group.rows.map(row => {
            const schema = JSON.stringify(mcpSchemas[row.key]);
            return { ...row, schema, token_estimate: tokenCount(`${row.summary} ${schema}`) };
          })
        : group.rows;
      const keys = [...new Set(sourceRows.flatMap(row => Object.keys(row)))];
      const rows = sourceRows.map(row => Object.fromEntries(keys.map(key => [key, row[key] ?? ''])));
      const assignments = keys.filter(key => key !== 'id').map(key => `n.${key} = row.${key}`).join(', ');
      await query(`UNWIND $rows AS row MERGE (n {id: row.id}) SET n:${group.label}, ${assignments}`, { rows });
    }
    for (const type of [...new Set(edges.map(edge => edge.type))]) {
      const rows = edges.filter(edge => edge.type === type).map(({ from, to }) => ({ from, to }));
      await query(`UNWIND $rows AS row CREATE (a {id: row.from})-[:${type}]->(b {id: row.to})`, { rows });
    }
    return { seeded: existing.length === 0, nodes: groups.reduce((sum, g) => sum + g.rows.length, 0), relationships: edges.length };
  })().catch(err => { seedPromise = null; throw err; });
  return seedPromise;
}

const toolQuery = `MATCH (a:Agent {key: $agent})-[:HAS_SKILL]->(s:Skill {key: $skill})-[:NEEDS]->(t:Tool)-[:PROVIDED_BY]->(m:MCPServer)
RETURN a.name AS agent_name, s.key AS skill_key, s.name AS skill_name, s.summary AS skill_summary, t.key AS tool_key, t.name AS tool_name,
 t.summary AS summary, t.schema AS schema, t.token_estimate AS token_estimate, t.risk AS risk,
 m.key AS server_key, m.name AS server_name ORDER BY t.name`;
const allToolsQuery = 'MATCH (t:Tool) RETURN t.key AS tool_key, t.name AS tool_name, t.summary AS summary, t.schema AS schema, t.token_estimate AS token_estimate ORDER BY t.name';

function classifyTask(task) {
  const t = task.toLowerCase();
  if (/invoice|overdue|payment|billing|paid|follow.?up/.test(t)) return 'invoice-followup';
  if (/renew|contract|churn|expansion/.test(t)) return 'renewal-review';
  if (/ticket|support|issue|bug|incident/.test(t)) return 'support-triage';
  return 'meeting-prep';
}
function resolveCustomer(task) {
  if (/northstar|north star/i.test(task)) return 'northstar';
  return 'acme';
}
function tokenCount(text) { return Math.max(1, Math.ceil(String(text || '').length / 4)); }

async function buildContext(task) {
  const started = performance.now();
  const skill = classifyTask(task);
  const customerKey = resolveCustomer(task);
  const [tools, allTools, related] = await Promise.all([
    query(toolQuery, { agent: 'context-router', skill }),
    query(allToolsQuery),
    query('MATCH (c:Entity {key: $customer})-[:RELATED_TO]->(e:Entity) RETURN c.key AS customer_key, c.name AS customer_name, e.key AS entity_key, e.name AS entity_name, e.kind AS kind, e.status AS status, e.summary AS summary, e.amount AS amount, e.due AS due ORDER BY e.name', { customer: customerKey }),
  ]);
  const kindAllow = {
    'invoice-followup': ['customer', 'invoice', 'support ticket'],
    'renewal-review': ['customer', 'contract', 'support ticket', 'document'],
    'support-triage': ['customer', 'support ticket', 'document'],
    'meeting-prep': ['customer', 'invoice', 'contract', 'support ticket', 'document'],
  }[skill];
  const entities = related.filter(row => kindAllow.includes(row.kind));
  const selectedTokens = tools.reduce((sum, tool) => sum + Number(tool.token_estimate || tokenCount(`${tool.summary} ${tool.schema}`)), 0);
  const baselineTokens = allTools.reduce((sum, tool) => sum + Number(tool.token_estimate || tokenCount(`${tool.summary} ${tool.schema}`)), 0);
  const skillRow = tools[0] || { skill_key: skill, skill_name: skill };
  const graph = [
    { label: 'Agent', name: 'Threadline', kind: 'agent' },
    { label: 'Skill', name: skillRow.skill_name, kind: 'skill' },
    ...tools.map(tool => ({ label: 'Tool', name: tool.tool_name, kind: 'tool', server: tool.server_name })),
    ...entities.filter(row => row.kind !== 'customer').map(row => ({ label: row.kind, name: row.entity_name, kind: 'entity', status: row.status })),
  ];
  const elapsedMs = Math.round((performance.now() - started) * 10) / 10;
  let result;
  if (skill === 'invoice-followup') {
    const invoice = entities.find(row => row.kind === 'invoice' && String(row.status).toLowerCase() === 'overdue');
    result = invoice
      ? { title: 'Draft ready for review', text: `Hi ${entities[0]?.customer_name || 'there'} team — a quick note that ${invoice.entity_name} for ${invoice.amount} was due ${invoice.due}. Could you let us know if you need anything from us to help close it out?`, source: `${invoice.entity_name} · ${invoice.status} · ${invoice.summary}` }
      : { title: 'No overdue invoice found', text: 'The graph found no overdue invoice for this account, so no follow-up draft was created.', source: 'Account invoice relationships' };
  } else if (skill === 'renewal-review') {
    const contract = entities.find(row => row.kind === 'contract');
    result = { title: 'Renewal brief assembled', text: contract ? `${contract.entity_name}: ${contract.status}. ${contract.summary}` : 'No contract relationship was found for this account.', source: contract?.entity_name || 'Contract graph' };
  } else if (skill === 'support-triage') {
    const ticket = entities.find(row => row.kind === 'support ticket');
    result = { title: 'Support context assembled', text: ticket ? `${ticket.entity_name} is ${ticket.status}. ${ticket.summary}` : 'No open support ticket was found for this account.', source: ticket?.entity_name || 'Support graph' };
  } else {
    result = { title: 'Meeting brief assembled', text: entities.filter(row => row.kind !== 'customer').map(row => `${row.entity_name}: ${row.summary}`).slice(0, 3).join(' ') || 'No related account context found.', source: `${entities.length} connected account records` };
  }
  const customer = { key: customerKey, name: related[0]?.customer_name || customerKey };
  const contextPack = {
    task,
    skill: { key: skillRow.skill_key, name: skillRow.skill_name, instructions: skillRow.skill_summary },
    tools: tools.map(tool => ({ name: tool.tool_name, description: tool.summary, inputSchema: JSON.parse(tool.schema || '{}'), mcpServer: tool.server_name, risk: tool.risk })),
    resolvedEntities: entities.map(entity => ({ id: entity.entity_key, name: entity.entity_name, kind: entity.kind, status: entity.status, summary: entity.summary, amount: entity.amount, due: entity.due })),
  };
  return {
    task, skill: skillRow, customer, contextPack,
    tools, entities, graph, result,
    metrics: { selectedTools: tools.length, totalTools: allTools.length, selectedTokens, baselineTokens, tokenReduction: baselineTokens ? Math.round((1 - selectedTokens / baselineTokens) * 100) : 0, traversalMs: elapsedMs, traversedRelationships: tools.length * 2 + entities.length + 1 },
    trace: [`Threadline agent → ${skillRow.skill_name}`, `${skillRow.skill_name} → ${tools.length} task-relevant tools`, 'Each tool → its owning MCP server', `${related[0]?.customer_name || customerKey} → ${entities.length} connected account facts`],
  };
}

const benchmarkTasks = [
  { task: 'Find Acme’s overdue invoice and draft a follow-up.', skill: 'invoice-followup', expected: ['get_customer','find_invoices','draft_email'] },
  { task: 'Review Northstar’s renewal contract and account signals.', skill: 'renewal-review', expected: ['get_customer','find_contracts','search_support_history','create_followup_task'] },
  { task: 'Triage Acme’s open support ticket and find related notes.', skill: 'support-triage', expected: ['get_customer','find_tickets','search_documents','draft_email'] },
  { task: 'Prepare for a customer meeting with Northstar.', skill: 'meeting-prep', expected: ['get_customer','search_documents','find_invoices','find_contracts','get_calendar'] },
  { task: 'Find Northstar’s latest paid invoice.', skill: 'invoice-followup', expected: ['get_customer','find_invoices','draft_email'] },
];

async function runLoadCheck() {
  const requestCount = 20;
  const concurrency = 10;
  const latencies = [];
  const errors = [];
  let next = 0;
  async function worker() {
    while (true) {
      const index = next++;
      if (index >= requestCount) return;
      const started = performance.now();
      try {
        await buildContext(benchmarkTasks[index % benchmarkTasks.length].task);
        latencies.push(performance.now() - started);
      } catch (err) { errors.push(err.message); }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  const sorted = latencies.slice().sort((a, b) => a - b);
  const percentile = p => sorted.length ? Math.round(sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] * 10) / 10 : 0;
  return { requests: requestCount, concurrency, successes: latencies.length, p50Ms: percentile(.50), p95Ms: percentile(.95), maxMs: percentile(1), errors };
}

async function runBenchmark() {
  const rows = [];
  for (const item of benchmarkTasks) {
    const data = await buildContext(item.task);
    const actual = data.tools.map(tool => tool.tool_key).sort();
    const expected = item.expected.slice().sort();
    rows.push({ task: item.task, correct: JSON.stringify(actual) === JSON.stringify(expected), selected: data.metrics.selectedTools, contextTokens: data.metrics.selectedTokens, baselineTokens: data.metrics.baselineTokens, latencyMs: data.metrics.traversalMs });
  }
  const accuracy = Math.round(rows.filter(row => row.correct).length / rows.length * 100);
  const avgContextTokens = Math.round(rows.reduce((s, r) => s + r.contextTokens, 0) / rows.length);
  const avgBaselineTokens = Math.round(rows.reduce((s, r) => s + r.baselineTokens, 0) / rows.length);
  const avgLatencyMs = Math.round(rows.reduce((s, r) => s + r.latencyMs, 0) / rows.length * 10) / 10;
  const load = await runLoadCheck();
  return { suite: 'Curated demo tasks', accuracy, avgContextTokens, avgBaselineTokens, tokenReduction: Math.round((1 - avgContextTokens / avgBaselineTokens) * 100), avgLatencyMs, tasks: rows, load, note: 'Exact-match tool selection on a small, hand-labelled demo suite. Token estimates are derived from stored tool-description and schema length (about four characters per token). Load smoke test: 20 live context requests at concurrency 10. Prototype measurements, not a general benchmark.' };
}

function send(res, status, data, type = 'application/json; charset=utf-8') {
  const body = type.startsWith('application/json') ? JSON.stringify(data) : data;
  res.writeHead(status, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' });
  res.end(body);
}
async function readBody(req) {
  let data = '';
  for await (const chunk of req) { data += chunk; if (data.length > 1_000_000) throw new Error('Request body too large'); }
  return data ? JSON.parse(data) : {};
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (req.method === 'GET' && url.pathname === '/api/status') {
      try {
        await fetch(`${HYDRA}/healthz`, { signal: AbortSignal.timeout(2500) }).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); });
        const seed = await query('MATCH (a:Agent {key: $key}) RETURN a.id AS id LIMIT 1', { key: 'context-router' });
        return send(res, 200, { database: 'connected', seeded: seed.length > 0, engine: 'HydraDB OSS', graph: GRAPH, cell: CELL });
      } catch (err) {
        return send(res, 200, { database: 'offline', seeded: false, engine: 'HydraDB OSS', message: err.message });
      }
    }
    if (req.method === 'POST' && url.pathname === '/api/seed') {
      return send(res, 200, { ...(await ensureSeed()), status: 'ready' });
    }
    if (req.method === 'POST' && url.pathname === '/api/context') {
      const body = await readBody(req);
      const task = String(body.task || '').trim();
      if (!task) return send(res, 400, { error: 'Type a task first.' });
      await ensureSeed();
      return send(res, 200, await buildContext(task));
    }
    if (req.method === 'POST' && url.pathname === '/api/benchmark') {
      await ensureSeed();
      return send(res, 200, await runBenchmark());
    }
    if (req.method === 'POST' && url.pathname === '/api/feedback') {
      const body = await readBody(req);
      const rating = body.rating === 'useful' ? 'useful' : 'needs-work';
      const relationship = rating === 'useful' ? 'APPROVED_TOOL' : 'REJECTED_TOOL';
      const id = Number(body.toolId);
      if (!Number.isInteger(id)) return send(res, 400, { error: 'Missing tool id.' });
      await query(`MATCH (a:Agent {key: $agent}), (t:Tool {id: $id}) MERGE (a)-[:${relationship}]->(t)`, { agent: 'context-router', id });
      return send(res, 200, { saved: true, rating, message: 'Feedback recorded in the HydraDB graph.' });
    }
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      const html = fs.readFileSync(path.join(PUBLIC, 'index.html'));
      return send(res, 200, html, 'text/html; charset=utf-8');
    }
    if (req.method === 'GET' && url.pathname.startsWith('/')) {
      const file = path.normalize(path.join(PUBLIC, url.pathname));
      if (!file.startsWith(PUBLIC)) return send(res, 403, 'Forbidden', 'text/plain');
      if (fs.existsSync(file) && fs.statSync(file).isFile()) {
        const ext = path.extname(file);
        const mime = ext === '.svg' ? 'image/svg+xml' : ext === '.js' ? 'text/javascript' : ext === '.css' ? 'text/css' : 'application/octet-stream';
        return send(res, 200, fs.readFileSync(file), mime);
      }
    }
    return send(res, 404, { error: 'Not found' });
  } catch (err) {
    return send(res, err.status || 500, { error: err.message || 'Unexpected server error' });
  }
});

server.listen(PORT, '0.0.0.0', () => console.log(`Threadline running on http://0.0.0.0:${PORT} (HydraDB at ${HYDRA})`));
