#!/usr/bin/env node
/**
 * End-to-end verification of the application API against a RUNNING server.
 *
 * Unlike the in-process `app.inject` suite, this drives real HTTP, which is how
 * the browser actually talks to the API. Run it after `docker compose up`, or
 * against a locally started `npm run production:api`.
 *
 *   node scripts/verify-app-api.mjs --api-url http://127.0.0.1:8787
 *
 * Exits non-zero when any check fails.
 */
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    'api-url': { type: 'string', default: process.env.API_URL ?? 'http://127.0.0.1:8787' },
    'api-key': { type: 'string', default: process.env.API_KEYS ?? 'local-development-key' },
    help: { type: 'boolean', default: false },
  },
});

if (values.help) {
  console.log(`verify-app-api.mjs - HTTP verification of auth, workspaces, projects and sharing

Options:
  --api-url <url>   Base URL of a running API (default: http://127.0.0.1:8787)
  --api-key <key>   Machine API key, used to prove render routes stay key-gated
  --help            Show this message`);
  process.exit(0);
}

const API = values['api-url'].replace(/\/$/, '');
const results = [];
const check = (name, pass, detail = '') => results.push({ name, pass: Boolean(pass), detail });

async function call(path, options = {}) {
  const headers = { ...(options.headers ?? {}) };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(API + path, { ...options, headers });
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { status: response.status, body };
}

const stamp = Date.now();
const password = 'correct-horse-battery';
const emailA = `verify-a-${stamp}@example.com`;
const emailB = `verify-b-${stamp}@example.com`;

const health = await call('/health');
if (health.status !== 200) {
  console.error(`The API at ${API} is not healthy (status ${health.status}). Start it first.`);
  process.exit(2);
}

const a = await call('/v1/auth/register', { method: 'POST', body: JSON.stringify({ email: emailA, password, displayName: 'Verify A' }) });
const b = await call('/v1/auth/register', { method: 'POST', body: JSON.stringify({ email: emailB, password, displayName: 'Verify B' }) });
check('register creates an account', a.status === 201, `status ${a.status}`);
check('register issues a session token', Boolean(a.body?.token) && Boolean(b.body?.token));
check('register creates a personal workspace', Array.isArray(a.body?.workspaces) && a.body.workspaces.length > 0);

const authA = { authorization: `Bearer ${a.body.token}` };
const authB = { authorization: `Bearer ${b.body.token}` };

check('duplicate email is rejected', (await call('/v1/auth/register', { method: 'POST', body: JSON.stringify({ email: emailA, password, displayName: 'Dup' }) })).status === 409);
check('a weak password is rejected', (await call('/v1/auth/register', { method: 'POST', body: JSON.stringify({ email: `weak-${stamp}@example.com`, password: 'short', displayName: 'W' }) })).status === 400);
check('a wrong password is rejected', (await call('/v1/auth/login', { method: 'POST', body: JSON.stringify({ email: emailA, password: 'not-the-password' }) })).status === 401);
check('an authenticated caller can read /me', (await call('/v1/auth/me', { headers: authA })).status === 200);
check('an anonymous caller cannot read /me', (await call('/v1/auth/me')).status === 401);

const workspaceId = (await call('/v1/workspaces', { headers: authA })).body.workspaces[0].id;

const document = {
  schemaVersion: 2,
  name: 'Verification project',
  geography: { viewMode: 'usa-counties', districtScope: '06', focusPlace: 'California', selectedIds: [] },
  presentation: { style: { fill: '#123456' }, hiddenLayers: { roads: true } },
  compositionId: 'map-ranked',
  chartOverrides: { ranked: { limit: 7 } },
  config: { title: 'Verification project' },
  rows: [{ id: 'r1', region: 'Delhi', value: 10, raw: {} }],
  annotations: [],
  datasetMeta: { publisher: 'Verification' },
  regionOverrides: {},
  filters: [],
  videoSpec: {},
};

const created = await call(`/v1/workspaces/${workspaceId}/projects`, { method: 'POST', headers: authA, body: JSON.stringify({ name: document.name, document }) });
check('a project can be created', created.status === 201, `status ${created.status}`);
const projectId = created.body?.project?.id;

const read = await call(`/v1/projects/${projectId}`, { headers: authA });
check('the document round-trips unchanged', deepEqual(read.body?.project?.document, document), 'deep compare');
check('geography is persisted server-side', read.body?.project?.document?.geography?.viewMode === 'usa-counties');
check('chart overrides are persisted server-side', read.body?.project?.document?.chartOverrides?.ranked?.limit === 7);

// Workspace isolation: another account must not even learn the project exists.
check('another user cannot read the project', (await call(`/v1/projects/${projectId}`, { headers: authB })).status === 404);
check('another user cannot update the project', (await call(`/v1/projects/${projectId}`, { method: 'PUT', headers: authB, body: JSON.stringify({ name: 'hijacked', document }) })).status === 404);
check('another user cannot delete the project', (await call(`/v1/projects/${projectId}`, { method: 'DELETE', headers: authB })).status === 404);
check('another user cannot list the workspace', (await call(`/v1/workspaces/${workspaceId}/projects`, { headers: authB })).status === 404);
check('another user cannot join the workspace', [403, 404].includes((await call(`/v1/workspaces/${workspaceId}/members`, { method: 'POST', headers: authB, body: JSON.stringify({ email: emailB, role: 'admin' }) })).status));

const versioned = await call(`/v1/projects/${projectId}/versions`, { method: 'POST', headers: authA, body: JSON.stringify({ label: 'checkpoint' }) });
check('a version can be saved', [200, 201].includes(versioned.status), `status ${versioned.status}`);
check('versions can be listed', Array.isArray((await call(`/v1/projects/${projectId}/versions`, { headers: authA })).body?.versions));
check('a project can be duplicated', [200, 201].includes((await call(`/v1/projects/${projectId}/duplicate`, { method: 'POST', headers: authA })).status));
check('a project can be archived', (await call(`/v1/projects/${projectId}/archive`, { method: 'POST', headers: authA, body: JSON.stringify({ archived: true }) })).status === 200);

const share = await call(`/v1/projects/${projectId}/share`, { method: 'POST', headers: authA, body: JSON.stringify({}) });
check('a share token can be minted', share.status === 201, `status ${share.status}`);
check('a share link works without authentication', (await call(`/v1/share/${share.body?.token}`)).status === 200);
await call(`/v1/share/${share.body?.id}`, { method: 'DELETE', headers: authA });
check('a revoked share link stops working', (await call(`/v1/share/${share.body?.token}`)).status === 404);

const imported = await call('/v1/projects/import', { method: 'POST', headers: authA, body: JSON.stringify({ documents: [document] }) });
check('browser projects can be imported', imported.status === 201 && imported.body?.imported === 1, `status ${imported.status}`);

// The machine API stays on its own key, unaffected by session auth.
check('render jobs still require the machine API key', (await call('/v1/render-jobs', { method: 'POST', body: JSON.stringify({}) })).status === 401);
check('video jobs still require the machine API key', (await call('/v1/video-jobs', { method: 'POST', body: JSON.stringify({}) })).status === 401);
check('the machine API key is still accepted', (await call('/v1/video-jobs', { method: 'POST', headers: { authorization: `Bearer ${values['api-key']}` }, body: JSON.stringify({}) })).status === 400);

const failed = results.filter((entry) => !entry.pass);
for (const entry of results) console.log(`${entry.pass ? 'PASS' : 'FAIL'}  ${entry.name}${entry.detail ? `  (${entry.detail})` : ''}`);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);

function deepEqual(first, second) {
  if (first === second) return true;
  if (typeof first !== typeof second || first === null || second === null) return false;
  if (typeof first !== 'object') return false;
  if (Array.isArray(first) !== Array.isArray(second)) return false;
  const firstKeys = Object.keys(first);
  const secondKeys = Object.keys(second);
  if (firstKeys.length !== secondKeys.length) return false;
  return firstKeys.every((key) => deepEqual(first[key], second[key]));
}
