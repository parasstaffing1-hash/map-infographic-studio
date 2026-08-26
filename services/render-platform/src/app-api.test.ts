import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Real integration tests against a live PostgreSQL.
 *
 *   docker run -d --rm -p 55432:5432 -e POSTGRES_PASSWORD=test \
 *     -e POSTGRES_DB=mapstudio_test --name mapstudio-pg-test postgres:16-alpine
 *   TEST_DATABASE_URL=postgres://postgres:test@127.0.0.1:55432/mapstudio_test \
 *     npx vitest run src/app-api.test.ts
 *
 * A Redis is needed too because `buildServer` wires the render queues; point
 * TEST_REDIS_URL at one, or accept the 127.0.0.1:56379 default.
 */
const DATABASE_URL = process.env.TEST_DATABASE_URL;

const sampleDocument = (name: string) => ({
  schemaVersion: 2,
  name,
  geography: { viewMode: 'india', districtScope: 'UP', selectedIds: ['s1', 's2'] },
  presentation: { style: { fill: '#2f83b5', opacity: 0.78, theme: 'light' }, hiddenLayers: { legend: true } },
  compositionId: 'map-ranked',
  chartOverrides: { bar: { kind: 'bar', tint: '#fff' } },
  config: { title: name, subtitle: 'A subtitle', palette: ['#111', '#222'], nested: { deep: { value: 42 } } },
  rows: [
    { id: 'r1', region: 'Uttar Pradesh', value: 12.5, raw: { a: 1, b: 'two', c: null } },
    { id: 'r2', region: 'Bihar', value: 'n/a', raw: {} },
  ],
  annotations: [{ id: 'a1', text: 'note', x: 10, y: 20 }],
  currentYear: '2024',
  datasetMeta: { sourceName: 'Census', rowCount: 2 },
  regionOverrides: { 'Uttar Pradesh': { fill: '#abc' } },
  filters: [{ field: 'value', op: 'gt', value: 1 }],
  videoSpec: { format: 'mp4', fps: 30, durationSeconds: 12 },
});

describe.skipIf(!DATABASE_URL)('application API', () => {
  let app: FastifyInstance;
  let pool: import('./db.js').Pool;

  const request = async (
    method: string,
    url: string,
    options: { token?: string; body?: unknown; apiKey?: string } = {},
  ) => {
    const headers: Record<string, string> = {};
    if (options.token) headers.authorization = `Bearer ${options.token}`;
    if (options.apiKey) headers.authorization = `Bearer ${options.apiKey}`;
    const response = await app.inject({ method: method as 'GET', url, headers, payload: options.body as object | undefined });
    let json: any = undefined;
    try { json = response.json(); } catch { json = undefined; }
    return { status: response.statusCode, body: json, raw: response };
  };

  const register = async (email: string, password = 'a-very-long-password') => {
    const response = await request('POST', '/v1/auth/register', { body: { email, password, displayName: email.split('@')[0] } });
    expect(response.status).toBe(201);
    return { token: response.body.token as string, user: response.body.user, workspaces: response.body.workspaces };
  };

  const unique = (label: string) => `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = DATABASE_URL;
    process.env.REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:56379';
    process.env.API_KEYS = 'integration-test-api-key';
    process.env.APP_BASE_URL = 'http://127.0.0.1:4174';
    const { buildServer } = await import('./server.js');
    const built = await buildServer();
    app = built.app;
    await app.ready();
    const { createPool } = await import('./db.js');
    pool = createPool({ DATABASE_URL })!;
  }, 180_000);

  afterAll(async () => {
    await pool?.end().catch(() => undefined);
    await app?.close().catch(() => undefined);
  }, 60_000);

  // ------------------------------------------------------------- accounts --

  it('registers a user, creates a personal workspace and issues a session', async () => {
    const email = unique('owner');
    const response = await request('POST', '/v1/auth/register', { body: { email, password: 'correct-horse-battery', displayName: 'Owner' } });
    expect(response.status).toBe(201);
    expect(response.body.token).toBeTypeOf('string');
    expect(response.body.user.email).toBe(email.toLowerCase());
    expect(response.body.workspaces).toHaveLength(1);
    expect(response.body.workspaces[0].kind).toBe('personal');
    expect(response.body.workspaces[0].role).toBe('owner');
    expect(response.raw.headers['set-cookie']).toBeDefined();
  }, 60_000);

  it('rejects a password under 10 characters', async () => {
    const response = await request('POST', '/v1/auth/register', { body: { email: unique('short'), password: 'short' } });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe('weak_password');
  }, 60_000);

  it('rejects a duplicate email with 409', async () => {
    const email = unique('dup');
    expect((await request('POST', '/v1/auth/register', { body: { email, password: 'a-very-long-password' } })).status).toBe(201);
    const second = await request('POST', '/v1/auth/register', { body: { email: email.toUpperCase(), password: 'a-very-long-password' } });
    expect(second.status).toBe(409);
    expect(second.body.error).toBe('email_taken');
  }, 60_000);

  it('never stores the password in plaintext', async () => {
    const email = unique('hash');
    const password = 'plaintext-detector-9000';
    await register(email, password);
    const row = await pool.query<{ password_hash: string }>('SELECT password_hash FROM users WHERE lower(email) = $1', [email.toLowerCase()]);
    const stored = row.rows[0]!.password_hash;
    expect(stored).not.toContain(password);
    expect(stored.startsWith('scrypt$16384$8$1$')).toBe(true);
    expect(stored.split('$')).toHaveLength(6);
    // And nothing anywhere in the row leaks it.
    const full = await pool.query('SELECT * FROM users WHERE lower(email) = $1', [email.toLowerCase()]);
    expect(JSON.stringify(full.rows[0])).not.toContain(password);
  }, 60_000);

  it('logs in, answers /me, and rejects a wrong password', async () => {
    const email = unique('login');
    await register(email, 'the-right-password-1');

    const bad = await request('POST', '/v1/auth/login', { body: { email, password: 'the-wrong-password' } });
    expect(bad.status).toBe(401);
    expect(bad.body.error).toBe('invalid_credentials');

    const good = await request('POST', '/v1/auth/login', { body: { email, password: 'the-right-password-1' } });
    expect(good.status).toBe(200);
    const token = good.body.token as string;

    const me = await request('GET', '/v1/auth/me', { token });
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(email.toLowerCase());
    expect(me.body.workspaces).toHaveLength(1);

    expect((await request('GET', '/v1/auth/me')).status).toBe(401);
  }, 60_000);

  it('accepts the session as an httpOnly cookie as well as a bearer token', async () => {
    const email = unique('cookie');
    const login = await request('POST', '/v1/auth/register', { body: { email, password: 'a-very-long-password' } });
    const setCookie = String(login.raw.headers['set-cookie']);
    expect(setCookie).toContain('HttpOnly');
    const cookieValue = setCookie.split(';')[0]!;
    const me = await app.inject({ method: 'GET', url: '/v1/auth/me', headers: { cookie: cookieValue } });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.email).toBe(email.toLowerCase());
  }, 60_000);

  it('logs out and invalidates the session token', async () => {
    const { token } = await register(unique('logout'));
    expect((await request('GET', '/v1/auth/me', { token })).status).toBe(200);
    expect((await request('POST', '/v1/auth/logout', { token })).status).toBe(200);
    expect((await request('GET', '/v1/auth/me', { token })).status).toBe(401);
  }, 60_000);

  // -------------------------------------------------------------- tenancy --

  it('hides another user\'s workspace and project behind 404, never 403', async () => {
    const a = await register(unique('user-a'));
    const b = await register(unique('user-b'));
    const bWorkspace = b.workspaces[0].id as string;

    const created = await request('POST', `/v1/workspaces/${bWorkspace}/projects`, {
      token: b.token,
      body: { document: sampleDocument("B's project") },
    });
    expect(created.status).toBe(201);
    const projectId = created.body.project.id as string;

    // Reading, updating, deleting, listing: all 404 for User A.
    expect((await request('GET', `/v1/projects/${projectId}`, { token: a.token })).status).toBe(404);
    expect((await request('PUT', `/v1/projects/${projectId}`, { token: a.token, body: { document: sampleDocument('hijack') } })).status).toBe(404);
    expect((await request('DELETE', `/v1/projects/${projectId}`, { token: a.token })).status).toBe(404);
    expect((await request('GET', `/v1/workspaces/${bWorkspace}/projects`, { token: a.token })).status).toBe(404);
    expect((await request('GET', `/v1/workspaces/${bWorkspace}/members`, { token: a.token })).status).toBe(404);
    expect((await request('GET', `/v1/workspaces/${bWorkspace}/brand-kits`, { token: a.token })).status).toBe(404);
    expect((await request('GET', `/v1/projects/${projectId}/versions`, { token: a.token })).status).toBe(404);

    // And A cannot add themselves to B's workspace.
    const selfAdd = await request('POST', `/v1/workspaces/${bWorkspace}/members`, {
      token: a.token,
      body: { email: a.user.email, role: 'owner' },
    });
    expect(selfAdd.status).toBe(404);

    // A's own workspace list still contains only A's workspace.
    const list = await request('GET', '/v1/workspaces', { token: a.token });
    expect(list.body.workspaces.map((w: any) => w.id)).not.toContain(bWorkspace);

    // The project really did survive untouched.
    const still = await request('GET', `/v1/projects/${projectId}`, { token: b.token });
    expect(still.status).toBe(200);
    expect(still.body.project.name).toBe("B's project");
  }, 60_000);

  // ---------------------------------------------------------------- roles --

  it('enforces viewer / editor / admin / owner rules server-side', async () => {
    const owner = await register(unique('role-owner'));
    const viewer = await register(unique('role-viewer'));
    const editor = await register(unique('role-editor'));
    const admin = await register(unique('role-admin'));
    const outsider = await register(unique('role-outsider'));

    const workspace = (await request('POST', '/v1/workspaces', { token: owner.token, body: { name: 'Team space' } })).body.workspace.id as string;

    for (const [user, role] of [[viewer, 'viewer'], [editor, 'editor'], [admin, 'admin']] as const) {
      const invited = await request('POST', `/v1/workspaces/${workspace}/members`, {
        token: owner.token,
        body: { email: user.user.email, role },
      });
      expect(invited.status).toBe(201);
    }

    const project = (await request('POST', `/v1/workspaces/${workspace}/projects`, {
      token: owner.token,
      body: { document: sampleDocument('Shared project') },
    })).body.project.id as string;

    // viewer: read yes, write no.
    expect((await request('GET', `/v1/projects/${project}`, { token: viewer.token })).status).toBe(200);
    expect((await request('PUT', `/v1/projects/${project}`, { token: viewer.token, body: { document: sampleDocument('viewer edit') } })).status).toBe(403);
    expect((await request('POST', `/v1/projects/${project}/archive`, { token: viewer.token, body: { archived: true } })).status).toBe(403);

    // editor: write yes, member management no.
    expect((await request('PUT', `/v1/projects/${project}`, { token: editor.token, body: { document: sampleDocument('editor edit') } })).status).toBe(200);
    expect((await request('POST', `/v1/workspaces/${workspace}/members`, { token: editor.token, body: { email: outsider.user.email, role: 'editor' } })).status).toBe(403);
    expect((await request('PATCH', `/v1/workspaces/${workspace}/members/${viewer.user.id}`, { token: editor.token, body: { role: 'editor' } })).status).toBe(403);

    // admin: member management yes.
    expect((await request('POST', `/v1/workspaces/${workspace}/members`, { token: admin.token, body: { email: outsider.user.email, role: 'viewer' } })).status).toBe(201);
    expect((await request('PATCH', `/v1/workspaces/${workspace}/members/${outsider.user.id}`, { token: admin.token, body: { role: 'editor' } })).status).toBe(200);
    expect((await request('DELETE', `/v1/workspaces/${workspace}/members/${outsider.user.id}`, { token: admin.token })).status).toBe(200);
    // ...but an admin may not create or demote an owner.
    expect((await request('POST', `/v1/workspaces/${workspace}/members`, { token: admin.token, body: { email: outsider.user.email, role: 'owner' } })).status).toBe(403);
    expect((await request('PATCH', `/v1/workspaces/${workspace}/members/${owner.user.id}`, { token: admin.token, body: { role: 'viewer' } })).status).toBe(403);

    // owner: everything, including deleting the project.
    expect((await request('DELETE', `/v1/projects/${project}`, { token: owner.token })).status).toBe(200);
  }, 60_000);

  // ------------------------------------------------------------- projects --

  it('round-trips the document byte-for-byte through create, update, duplicate, archive and versions', async () => {
    const user = await register(unique('crud'));
    const workspace = user.workspaces[0].id as string;
    const original = sampleDocument('Original');

    const created = await request('POST', `/v1/workspaces/${workspace}/projects`, { token: user.token, body: { document: original } });
    expect(created.status).toBe(201);
    const projectId = created.body.project.id as string;
    expect(created.body.project.name).toBe('Original');

    const read = await request('GET', `/v1/projects/${projectId}`, { token: user.token });
    expect(read.status).toBe(200);
    expect(read.body.project.document).toEqual(original);

    // A snapshot before the edit.
    const snapshot = await request('POST', `/v1/projects/${projectId}/versions`, { token: user.token, body: { label: 'v1' } });
    expect(snapshot.status).toBe(201);
    const versionId = snapshot.body.version.id as string;

    const edited = { ...sampleDocument('Edited'), currentYear: '2025' };
    const updated = await request('PUT', `/v1/projects/${projectId}`, { token: user.token, body: { document: edited } });
    expect(updated.status).toBe(200);
    expect((await request('GET', `/v1/projects/${projectId}`, { token: user.token })).body.project.document).toEqual(edited);

    // Duplicate carries the current document.
    const copy = await request('POST', `/v1/projects/${projectId}/duplicate`, { token: user.token, body: {} });
    expect(copy.status).toBe(201);
    expect(copy.body.project.name).toBe('Edited (copy)');
    expect(copy.body.project.document).toEqual(edited);
    expect(copy.body.project.id).not.toBe(projectId);

    // Archive hides it from the default listing and unarchive restores it.
    expect((await request('POST', `/v1/projects/${projectId}/archive`, { token: user.token, body: { archived: true } })).body.project.archived).toBe(true);
    const active = await request('GET', `/v1/workspaces/${workspace}/projects`, { token: user.token });
    expect(active.body.projects.map((p: any) => p.id)).not.toContain(projectId);
    const all = await request('GET', `/v1/workspaces/${workspace}/projects?archived=true`, { token: user.token });
    expect(all.body.projects.map((p: any) => p.id)).toContain(projectId);
    expect((await request('POST', `/v1/projects/${projectId}/archive`, { token: user.token, body: { archived: false } })).body.project.archived).toBe(false);

    // Versions list contains the explicit snapshot plus the autosave from PUT.
    const versions = await request('GET', `/v1/projects/${projectId}/versions`, { token: user.token });
    expect(versions.body.versions.length).toBeGreaterThanOrEqual(2);
    expect(versions.body.versions.map((v: any) => v.label)).toContain('v1');

    // Restoring puts the original document back, exactly.
    const restored = await request('POST', `/v1/projects/${projectId}/versions/${versionId}/restore`, { token: user.token });
    expect(restored.status).toBe(200);
    expect(restored.body.project.document).toEqual(original);
    expect((await request('GET', `/v1/projects/${projectId}`, { token: user.token })).body.project.document).toEqual(original);
  }, 60_000);

  it('rejects a document with an unknown top-level field', async () => {
    const user = await register(unique('strict'));
    const workspace = user.workspaces[0].id as string;
    const response = await request('POST', `/v1/workspaces/${workspace}/projects`, {
      token: user.token,
      body: { document: { ...sampleDocument('Typo'), sceemaVersion: 3 } },
    });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe('invalid_request');
  }, 60_000);

  // ---------------------------------------------------------------- share --

  it('serves a share link unauthenticated and 404s once revoked or expired', async () => {
    const user = await register(unique('share'));
    const workspace = user.workspaces[0].id as string;
    const document = sampleDocument('Shared');
    const projectId = (await request('POST', `/v1/workspaces/${workspace}/projects`, { token: user.token, body: { document } })).body.project.id as string;

    const share = await request('POST', `/v1/projects/${projectId}/share`, { token: user.token, body: {} });
    expect(share.status).toBe(201);
    expect(share.body.url).toBe(`http://127.0.0.1:4174/share/${share.body.token}`);

    // The plaintext token is not what got persisted.
    const stored = await pool.query<{ token_hash: string }>('SELECT token_hash FROM share_tokens WHERE id = $1', [share.body.id]);
    expect(stored.rows[0]!.token_hash).not.toBe(share.body.token);

    // No Authorization header at all.
    const anonymous = await app.inject({ method: 'GET', url: `/v1/share/${share.body.token}` });
    expect(anonymous.statusCode).toBe(200);
    expect(anonymous.json().readOnly).toBe(true);
    expect(anonymous.json().document).toEqual(document);

    expect((await request('DELETE', `/v1/share/${share.body.id}`, { token: user.token })).status).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/v1/share/${share.body.token}` })).statusCode).toBe(404);

    // An expired token is equally invisible.
    const second = await request('POST', `/v1/projects/${projectId}/share`, { token: user.token, body: { expiresInHours: 1 } });
    await pool.query(`UPDATE share_tokens SET expires_at = now() - interval '1 hour' WHERE id = $1`, [second.body.id]);
    expect((await app.inject({ method: 'GET', url: `/v1/share/${second.body.token}` })).statusCode).toBe(404);

    // A token that never existed is also a 404.
    expect((await app.inject({ method: 'GET', url: '/v1/share/not-a-real-token' })).statusCode).toBe(404);
  }, 60_000);

  // ------------------------------------------------------------ brand kits --

  it('creates, lists, updates and deletes brand kits inside a workspace', async () => {
    const user = await register(unique('brand'));
    const workspace = user.workspaces[0].id as string;
    const created = await request('POST', `/v1/workspaces/${workspace}/brand-kits`, {
      token: user.token,
      body: { name: 'House style', colors: ['#101820', '#fee715'], fontFamily: 'Inter', sourcePrefix: 'Source: ' },
    });
    expect(created.status).toBe(201);
    expect(created.body.brandKit.colors).toEqual(['#101820', '#fee715']);
    const kitId = created.body.brandKit.id as string;

    expect((await request('GET', `/v1/workspaces/${workspace}/brand-kits`, { token: user.token })).body.brandKits).toHaveLength(1);

    const updated = await request('PUT', `/v1/brand-kits/${kitId}`, { token: user.token, body: { name: 'House style v2', colors: ['#000'] } });
    expect(updated.status).toBe(200);
    expect(updated.body.brandKit.name).toBe('House style v2');

    // Another user cannot see or touch it.
    const other = await register(unique('brand-other'));
    expect((await request('PUT', `/v1/brand-kits/${kitId}`, { token: other.token, body: { name: 'stolen', colors: [] } })).status).toBe(404);
    expect((await request('DELETE', `/v1/brand-kits/${kitId}`, { token: other.token })).status).toBe(404);

    expect((await request('DELETE', `/v1/brand-kits/${kitId}`, { token: user.token })).status).toBe(200);
    expect((await request('GET', `/v1/workspaces/${workspace}/brand-kits`, { token: user.token })).body.brandKits).toHaveLength(0);
  }, 60_000);

  // --------------------------------------------------------------- import --

  it('imports browser-cached documents into the caller\'s personal workspace', async () => {
    const user = await register(unique('import'));
    const documents = [sampleDocument('Cached one'), sampleDocument('Cached two')];
    const imported = await request('POST', '/v1/projects/import', { token: user.token, body: documents });
    expect(imported.status).toBe(201);
    expect(imported.body.imported).toBe(2);
    expect(imported.body.projectIds).toHaveLength(2);
    expect(imported.body.workspaceId).toBe(user.workspaces[0].id);

    const listed = await request('GET', `/v1/workspaces/${user.workspaces[0].id}/projects`, { token: user.token });
    expect(listed.body.projects.map((p: any) => p.name).sort()).toEqual(['Cached one', 'Cached two']);

    const first = await request('GET', `/v1/projects/${imported.body.projectIds[0]}`, { token: user.token });
    expect(first.body.project.document).toEqual(documents[0]);

    expect((await request('POST', '/v1/projects/import', { body: documents })).status).toBe(401);
  }, 60_000);

  // --------------------------------------------------------- machine tier --

  it('keeps the machine API key on /v1/render-jobs and /v1/video-jobs', async () => {
    const user = await register(unique('machine'));

    // No key at all.
    expect((await app.inject({ method: 'POST', url: '/v1/render-jobs', payload: {} })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/v1/render-jobs/abc' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/v1/video-jobs', payload: {} })).statusCode).toBe(401);

    // A valid *session* token is not a machine key.
    expect((await request('POST', '/v1/render-jobs', { token: user.token, body: {} })).status).toBe(401);

    // The real key gets past the gate and reaches validation.
    const withKey = await request('POST', '/v1/render-jobs', { apiKey: 'integration-test-api-key', body: {} });
    expect(withKey.status).toBe(400);
    expect(withKey.body.error).toBe('invalid_request');
  });
});
