import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { createSession, hashPassword, hashToken, resolveSession, revokeSession, verifyPassword, type SessionUser } from './auth.js';
import type { PlatformConfig } from './config.js';
import { withTransaction, type Pool } from './db.js';
import { ProjectDocumentSchema } from './project-document.js';

export const SESSION_COOKIE = 'map_studio_session';

/** Documents carry whole datasets, so the app routes get their own body limit. */
const DOCUMENT_BODY_LIMIT = 24 * 1_024 * 1_024;

export type AppRoutesOptions = {
  pool: Pool | null;
  config: PlatformConfig;
};

export type WorkspaceRole = 'owner' | 'admin' | 'editor' | 'viewer';

const ROLE_RANK: Record<WorkspaceRole, number> = { viewer: 1, editor: 2, admin: 3, owner: 4 };
const RoleSchema = z.enum(['owner', 'admin', 'editor', 'viewer']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const RegisterSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(400),
  displayName: z.string().max(200).optional(),
}).strict();

const LoginSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(400),
}).strict();

const WorkspaceCreateSchema = z.object({ name: z.string().min(1).max(200) }).strict();
const MemberInviteSchema = z.object({ email: z.string().email().max(320), role: RoleSchema.default('viewer') }).strict();
const MemberPatchSchema = z.object({ role: RoleSchema }).strict();
const ProjectCreateSchema = z.object({ name: z.string().min(1).max(300).optional(), document: ProjectDocumentSchema }).strict();
const ProjectUpdateSchema = z.object({ name: z.string().min(1).max(300).optional(), document: ProjectDocumentSchema, label: z.string().max(200).optional() }).strict();
const ArchiveSchema = z.object({ archived: z.boolean() }).strict();
const VersionCreateSchema = z.object({ label: z.string().max(200).optional() }).strict();
const DuplicateSchema = z.object({ name: z.string().min(1).max(300).optional() }).strict().optional();
const ShareCreateSchema = z.object({ expiresInHours: z.number().int().min(1).max(8_760).optional() }).strict().optional();
const BrandKitSchema = z.object({
  name: z.string().min(1).max(200),
  colors: z.array(z.string().max(120)).max(64).default([]),
  fontFamily: z.string().max(200).optional(),
  logoDataUrl: z.string().max(4_000_000).optional(),
  sourcePrefix: z.string().max(300).optional(),
}).strict();
const ImportSchema = z.union([
  z.array(ProjectDocumentSchema).max(500),
  z.object({ documents: z.array(ProjectDocumentSchema).max(500) }).strict(),
]);

type ProjectRow = {
  id: string;
  workspace_id: string;
  name: string;
  document: unknown;
  archived: boolean;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
};

const projectSummary = (row: ProjectRow) => ({
  id: row.id,
  workspaceId: row.workspace_id,
  name: row.name,
  archived: row.archived,
  createdBy: row.created_by,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const projectPayload = (row: ProjectRow) => ({ ...projectSummary(row), document: row.document });

export const appRoutes: FastifyPluginAsync<AppRoutesOptions> = async (app, options) => {
  const { pool, config } = options;

  // Without a database the app tier is inert but must not take the process down.
  app.addHook('onRequest', async (_request, reply) => {
    if (pool) return;
    return reply.code(503).send({
      error: 'database_unavailable',
      message: 'Set DATABASE_URL on the render platform to enable accounts, workspaces and projects.',
    });
  });

  const db = () => pool as Pool;

  const bearer = (request: FastifyRequest) => {
    const header = request.headers.authorization;
    if (header && /^Bearer\s+/i.test(header)) return header.replace(/^Bearer\s+/i, '').trim();
    return undefined;
  };

  const tokenOf = (request: FastifyRequest) => bearer(request) ?? (request.cookies?.[SESSION_COOKIE] as string | undefined);

  /** Resolves the session or answers 401. Returns null when it already replied. */
  const authenticate = async (request: FastifyRequest, reply: FastifyReply): Promise<SessionUser | null> => {
    const user = await resolveSession(db(), tokenOf(request));
    if (!user) {
      reply.code(401).send({ error: 'unauthorized' });
      return null;
    }
    return user;
  };

  const setSessionCookie = (reply: FastifyReply, token: string, expiresAt: Date) => {
    reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.NODE_ENV === 'production',
      path: '/',
      expires: expiresAt,
    });
  };

  const listWorkspaces = async (userId: string) => {
    const result = await db().query(
      `SELECT w.id, w.name, w.slug, w.kind, w.created_at, m.role
         FROM workspaces w
         JOIN workspace_members m ON m.workspace_id = w.id
        WHERE m.user_id = $1
        ORDER BY w.created_at ASC`,
      [userId],
    );
    return result.rows.map((row: Record<string, unknown>) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      kind: row.kind,
      role: row.role,
      createdAt: row.created_at,
    }));
  };

  /** null means "no membership" — every caller turns that into a 404, never a 403. */
  const membershipRole = async (workspaceId: string, userId: string): Promise<WorkspaceRole | null> => {
    if (!UUID.test(workspaceId)) return null;
    const result = await db().query<{ role: WorkspaceRole }>(
      'SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
      [workspaceId, userId],
    );
    return result.rows[0]?.role ?? null;
  };

  const projectAccess = async (projectId: string, userId: string): Promise<{ project: ProjectRow; role: WorkspaceRole } | null> => {
    if (!UUID.test(projectId)) return null;
    const result = await db().query<ProjectRow & { role: WorkspaceRole }>(
      `SELECT p.*, m.role FROM projects p
         JOIN workspace_members m ON m.workspace_id = p.workspace_id AND m.user_id = $2
        WHERE p.id = $1`,
      [projectId, userId],
    );
    const row = result.rows[0];
    if (!row) return null;
    const { role, ...project } = row;
    return { project: project as ProjectRow, role };
  };

  const notFound = (reply: FastifyReply) => reply.code(404).send({ error: 'not_found' });
  const allows = (role: WorkspaceRole, minimum: WorkspaceRole) => ROLE_RANK[role] >= ROLE_RANK[minimum];

  const slugify = (name: string) =>
    `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'workspace'}-${randomBytes(3).toString('hex')}`;

  const personalWorkspaceId = async (user: SessionUser): Promise<string> => {
    const existing = await db().query<{ id: string }>(
      `SELECT w.id FROM workspaces w
         JOIN workspace_members m ON m.workspace_id = w.id AND m.user_id = $1
        WHERE w.kind = 'personal'
        ORDER BY w.created_at ASC LIMIT 1`,
      [user.id],
    );
    if (existing.rows[0]) return existing.rows[0].id;
    return withTransaction(db(), async (client) => {
      const name = user.displayName ? `${user.displayName}'s workspace` : 'Personal workspace';
      const created = await client.query<{ id: string }>(
        `INSERT INTO workspaces (name, slug, kind, created_by) VALUES ($1, $2, 'personal', $3) RETURNING id`,
        [name, slugify(name), user.id],
      );
      const id = created.rows[0]!.id;
      await client.query(`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner')`, [id, user.id]);
      return id;
    });
  };

  // ---------------------------------------------------------------- auth ----

  app.post('/v1/auth/register', async (request, reply) => {
    const parsed = RegisterSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request', issues: parsed.error.issues });
    const { email, password, displayName } = parsed.data;
    if (password.length < 10) return reply.code(400).send({ error: 'weak_password', message: 'Use at least 10 characters.' });

    const normalized = email.trim().toLowerCase();
    const duplicate = await db().query('SELECT 1 FROM users WHERE lower(email) = $1', [normalized]);
    if (duplicate.rowCount) return reply.code(409).send({ error: 'email_taken' });

    const passwordHash = await hashPassword(password);
    let userId: string;
    try {
      userId = await withTransaction(db(), async (client) => {
        const inserted = await client.query<{ id: string }>(
          'INSERT INTO users (email, password_hash, display_name) VALUES ($1, $2, $3) RETURNING id',
          [normalized, passwordHash, displayName ?? null],
        );
        const id = inserted.rows[0]!.id;
        const name = displayName ? `${displayName}'s workspace` : 'Personal workspace';
        const workspace = await client.query<{ id: string }>(
          `INSERT INTO workspaces (name, slug, kind, created_by) VALUES ($1, $2, 'personal', $3) RETURNING id`,
          [name, slugify(name), id],
        );
        await client.query(`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner')`, [workspace.rows[0]!.id, id]);
        return id;
      });
    } catch (error) {
      if ((error as { code?: string }).code === '23505') return reply.code(409).send({ error: 'email_taken' });
      throw error;
    }

    const session = await createSession(db(), userId, config.SESSION_TTL_HOURS);
    setSessionCookie(reply, session.token, session.expiresAt);
    return reply.code(201).send({
      token: session.token,
      expiresAt: session.expiresAt,
      user: { id: userId, email: normalized, displayName: displayName ?? null },
      workspaces: await listWorkspaces(userId),
    });
  });

  app.post('/v1/auth/login', async (request, reply) => {
    const parsed = LoginSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request', issues: parsed.error.issues });
    const normalized = parsed.data.email.trim().toLowerCase();
    const found = await db().query<{ id: string; email: string; password_hash: string; display_name: string | null }>(
      'SELECT id, email, password_hash, display_name FROM users WHERE lower(email) = $1',
      [normalized],
    );
    const row = found.rows[0];
    // Same reply for an unknown address and a bad password: no account probing.
    if (!row || !(await verifyPassword(parsed.data.password, row.password_hash))) {
      return reply.code(401).send({ error: 'invalid_credentials' });
    }
    const session = await createSession(db(), row.id, config.SESSION_TTL_HOURS);
    setSessionCookie(reply, session.token, session.expiresAt);
    return reply.send({
      token: session.token,
      expiresAt: session.expiresAt,
      user: { id: row.id, email: row.email, displayName: row.display_name },
      workspaces: await listWorkspaces(row.id),
    });
  });

  app.post('/v1/auth/logout', async (request, reply) => {
    await revokeSession(db(), tokenOf(request));
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.send({ ok: true });
  });

  app.get('/v1/auth/me', async (request, reply) => {
    const user = await authenticate(request, reply);
    if (!user) return reply;
    return reply.send({
      user: { id: user.id, email: user.email, displayName: user.displayName },
      workspaces: await listWorkspaces(user.id),
    });
  });

  // ---------------------------------------------------------- workspaces ----

  app.get('/v1/workspaces', async (request, reply) => {
    const user = await authenticate(request, reply);
    if (!user) return reply;
    return reply.send({ workspaces: await listWorkspaces(user.id) });
  });

  app.post('/v1/workspaces', async (request, reply) => {
    const user = await authenticate(request, reply);
    if (!user) return reply;
    const parsed = WorkspaceCreateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request', issues: parsed.error.issues });
    const workspace = await withTransaction(db(), async (client) => {
      const created = await client.query(
        `INSERT INTO workspaces (name, slug, kind, created_by) VALUES ($1, $2, 'team', $3)
         RETURNING id, name, slug, kind, created_at`,
        [parsed.data.name, slugify(parsed.data.name), user.id],
      );
      const row = created.rows[0] as Record<string, unknown>;
      await client.query(`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner')`, [row.id, user.id]);
      return row;
    });
    return reply.code(201).send({ workspace: { ...workspace, role: 'owner' } });
  });

  app.get<{ Params: { id: string } }>('/v1/workspaces/:id/members', async (request, reply) => {
    const user = await authenticate(request, reply);
    if (!user) return reply;
    const role = await membershipRole(request.params.id, user.id);
    if (!role) return notFound(reply);
    const members = await db().query(
      `SELECT m.user_id, m.role, m.created_at, u.email, u.display_name
         FROM workspace_members m JOIN users u ON u.id = m.user_id
        WHERE m.workspace_id = $1 ORDER BY m.created_at ASC`,
      [request.params.id],
    );
    return reply.send({
      members: members.rows.map((row: Record<string, unknown>) => ({
        userId: row.user_id,
        role: row.role,
        email: row.email,
        displayName: row.display_name,
        createdAt: row.created_at,
      })),
    });
  });

  app.post<{ Params: { id: string } }>('/v1/workspaces/:id/members', async (request, reply) => {
    const user = await authenticate(request, reply);
    if (!user) return reply;
    const role = await membershipRole(request.params.id, user.id);
    // No membership at all reads as "no such workspace" so existence never leaks.
    if (!role) return notFound(reply);
    if (!allows(role, 'admin')) return reply.code(403).send({ error: 'forbidden' });
    const parsed = MemberInviteSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request', issues: parsed.error.issues });
    const invitee = await db().query<{ id: string; email: string; display_name: string | null }>(
      'SELECT id, email, display_name FROM users WHERE lower(email) = $1',
      [parsed.data.email.trim().toLowerCase()],
    );
    const target = invitee.rows[0];
    if (!target) return reply.code(404).send({ error: 'user_not_found' });
    // Only an owner may mint another owner.
    if (parsed.data.role === 'owner' && role !== 'owner') return reply.code(403).send({ error: 'forbidden' });
    await db().query(
      `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, $3)
       ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
      [request.params.id, target.id, parsed.data.role],
    );
    return reply.code(201).send({ member: { userId: target.id, email: target.email, displayName: target.display_name, role: parsed.data.role } });
  });

  app.patch<{ Params: { id: string; userId: string } }>('/v1/workspaces/:id/members/:userId', async (request, reply) => {
    const user = await authenticate(request, reply);
    if (!user) return reply;
    const role = await membershipRole(request.params.id, user.id);
    if (!role) return notFound(reply);
    if (!allows(role, 'admin')) return reply.code(403).send({ error: 'forbidden' });
    const parsed = MemberPatchSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request', issues: parsed.error.issues });
    if (parsed.data.role === 'owner' && role !== 'owner') return reply.code(403).send({ error: 'forbidden' });
    if (!UUID.test(request.params.userId)) return notFound(reply);
    const target = await db().query<{ role: WorkspaceRole }>(
      'SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
      [request.params.id, request.params.userId],
    );
    const current = target.rows[0]?.role;
    if (!current) return notFound(reply);
    if (current === 'owner' && role !== 'owner') return reply.code(403).send({ error: 'forbidden' });
    await db().query('UPDATE workspace_members SET role = $3 WHERE workspace_id = $1 AND user_id = $2', [
      request.params.id,
      request.params.userId,
      parsed.data.role,
    ]);
    return reply.send({ member: { userId: request.params.userId, role: parsed.data.role } });
  });

  app.delete<{ Params: { id: string; userId: string } }>('/v1/workspaces/:id/members/:userId', async (request, reply) => {
    const user = await authenticate(request, reply);
    if (!user) return reply;
    const role = await membershipRole(request.params.id, user.id);
    if (!role) return notFound(reply);
    if (!allows(role, 'admin')) return reply.code(403).send({ error: 'forbidden' });
    if (!UUID.test(request.params.userId)) return notFound(reply);
    const target = await db().query<{ role: WorkspaceRole }>(
      'SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
      [request.params.id, request.params.userId],
    );
    const current = target.rows[0]?.role;
    if (!current) return notFound(reply);
    if (current === 'owner' && role !== 'owner') return reply.code(403).send({ error: 'forbidden' });
    // Never strip a workspace of its last owner.
    if (current === 'owner') {
      const owners = await db().query<{ count: string }>(
        `SELECT count(*)::text AS count FROM workspace_members WHERE workspace_id = $1 AND role = 'owner'`,
        [request.params.id],
      );
      if (Number(owners.rows[0]?.count ?? '0') <= 1) return reply.code(409).send({ error: 'last_owner' });
    }
    await db().query('DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2', [request.params.id, request.params.userId]);
    return reply.send({ ok: true });
  });

  // ------------------------------------------------------------ projects ----

  app.get<{ Params: { id: string }; Querystring: { archived?: string } }>('/v1/workspaces/:id/projects', async (request, reply) => {
    const user = await authenticate(request, reply);
    if (!user) return reply;
    const role = await membershipRole(request.params.id, user.id);
    if (!role) return notFound(reply);
    const includeArchived = request.query?.archived === 'true';
    const result = await db().query<ProjectRow>(
      `SELECT id, workspace_id, name, '{}'::jsonb AS document, archived, created_by, created_at, updated_at
         FROM projects WHERE workspace_id = $1 AND ($2::boolean OR archived = FALSE)
        ORDER BY updated_at DESC`,
      [request.params.id, includeArchived],
    );
    return reply.send({ projects: result.rows.map(projectSummary) });
  });

  app.post<{ Params: { id: string } }>('/v1/workspaces/:id/projects', { bodyLimit: DOCUMENT_BODY_LIMIT }, async (request, reply) => {
    const user = await authenticate(request, reply);
    if (!user) return reply;
    const role = await membershipRole(request.params.id, user.id);
    if (!role) return notFound(reply);
    if (!allows(role, 'editor')) return reply.code(403).send({ error: 'forbidden' });
    const parsed = ProjectCreateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request', issues: parsed.error.issues });
    // The raw body document is stored, not the parsed copy, so a round-trip is exact.
    const document = (request.body as { document: unknown }).document;
    const name = parsed.data.name ?? parsed.data.document.name;
    const created = await db().query<ProjectRow>(
      `INSERT INTO projects (workspace_id, name, document, created_by) VALUES ($1, $2, $3, $4) RETURNING *`,
      [request.params.id, name, document, user.id],
    );
    return reply.code(201).send({ project: projectPayload(created.rows[0]!) });
  });

  app.get<{ Params: { id: string } }>('/v1/projects/:id', async (request, reply) => {
    const user = await authenticate(request, reply);
    if (!user) return reply;
    const access = await projectAccess(request.params.id, user.id);
    if (!access) return notFound(reply);
    return reply.send({ project: projectPayload(access.project), role: access.role });
  });

  app.put<{ Params: { id: string } }>('/v1/projects/:id', { bodyLimit: DOCUMENT_BODY_LIMIT }, async (request, reply) => {
    const user = await authenticate(request, reply);
    if (!user) return reply;
    const access = await projectAccess(request.params.id, user.id);
    if (!access) return notFound(reply);
    if (!allows(access.role, 'editor')) return reply.code(403).send({ error: 'forbidden' });
    const parsed = ProjectUpdateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request', issues: parsed.error.issues });
    const document = (request.body as { document: unknown }).document;
    const name = parsed.data.name ?? parsed.data.document.name;
    const updated = await withTransaction(db(), async (client) => {
      // Keep the outgoing document as an automatic version so no edit is lossy.
      await client.query('INSERT INTO project_versions (project_id, label, document, created_by) VALUES ($1, $2, $3, $4)', [
        access.project.id,
        parsed.data.label ?? 'autosave',
        access.project.document,
        user.id,
      ]);
      const result = await client.query<ProjectRow>(
        'UPDATE projects SET name = $2, document = $3, updated_at = now() WHERE id = $1 RETURNING *',
        [access.project.id, name, document],
      );
      return result.rows[0]!;
    });
    return reply.send({ project: projectPayload(updated) });
  });

  app.delete<{ Params: { id: string } }>('/v1/projects/:id', async (request, reply) => {
    const user = await authenticate(request, reply);
    if (!user) return reply;
    const access = await projectAccess(request.params.id, user.id);
    if (!access) return notFound(reply);
    if (!allows(access.role, 'admin')) return reply.code(403).send({ error: 'forbidden' });
    await db().query('DELETE FROM projects WHERE id = $1', [access.project.id]);
    return reply.send({ ok: true });
  });

  app.post<{ Params: { id: string } }>('/v1/projects/:id/duplicate', async (request, reply) => {
    const user = await authenticate(request, reply);
    if (!user) return reply;
    const access = await projectAccess(request.params.id, user.id);
    if (!access) return notFound(reply);
    if (!allows(access.role, 'editor')) return reply.code(403).send({ error: 'forbidden' });
    const parsed = DuplicateSchema.safeParse(request.body ?? undefined);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request', issues: parsed.error.issues });
    const name = parsed.data?.name ?? `${access.project.name} (copy)`;
    const created = await db().query<ProjectRow>(
      'INSERT INTO projects (workspace_id, name, document, created_by) VALUES ($1, $2, $3, $4) RETURNING *',
      [access.project.workspace_id, name, access.project.document, user.id],
    );
    return reply.code(201).send({ project: projectPayload(created.rows[0]!) });
  });

  app.post<{ Params: { id: string } }>('/v1/projects/:id/archive', async (request, reply) => {
    const user = await authenticate(request, reply);
    if (!user) return reply;
    const access = await projectAccess(request.params.id, user.id);
    if (!access) return notFound(reply);
    if (!allows(access.role, 'editor')) return reply.code(403).send({ error: 'forbidden' });
    const parsed = ArchiveSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request', issues: parsed.error.issues });
    const updated = await db().query<ProjectRow>(
      'UPDATE projects SET archived = $2, updated_at = now() WHERE id = $1 RETURNING *',
      [access.project.id, parsed.data.archived],
    );
    return reply.send({ project: projectPayload(updated.rows[0]!) });
  });

  app.get<{ Params: { id: string } }>('/v1/projects/:id/versions', async (request, reply) => {
    const user = await authenticate(request, reply);
    if (!user) return reply;
    const access = await projectAccess(request.params.id, user.id);
    if (!access) return notFound(reply);
    const versions = await db().query(
      'SELECT id, label, created_by, created_at FROM project_versions WHERE project_id = $1 ORDER BY created_at DESC, id DESC',
      [access.project.id],
    );
    return reply.send({
      versions: versions.rows.map((row: Record<string, unknown>) => ({
        id: row.id,
        label: row.label,
        createdBy: row.created_by,
        createdAt: row.created_at,
      })),
    });
  });

  app.post<{ Params: { id: string } }>('/v1/projects/:id/versions', async (request, reply) => {
    const user = await authenticate(request, reply);
    if (!user) return reply;
    const access = await projectAccess(request.params.id, user.id);
    if (!access) return notFound(reply);
    if (!allows(access.role, 'editor')) return reply.code(403).send({ error: 'forbidden' });
    const parsed = VersionCreateSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request', issues: parsed.error.issues });
    const created = await db().query(
      'INSERT INTO project_versions (project_id, label, document, created_by) VALUES ($1, $2, $3, $4) RETURNING id, label, created_at',
      [access.project.id, parsed.data.label ?? null, access.project.document, user.id],
    );
    const row = created.rows[0] as Record<string, unknown>;
    return reply.code(201).send({ version: { id: row.id, label: row.label, createdAt: row.created_at } });
  });

  app.post<{ Params: { id: string; versionId: string } }>('/v1/projects/:id/versions/:versionId/restore', async (request, reply) => {
    const user = await authenticate(request, reply);
    if (!user) return reply;
    const access = await projectAccess(request.params.id, user.id);
    if (!access) return notFound(reply);
    if (!allows(access.role, 'editor')) return reply.code(403).send({ error: 'forbidden' });
    if (!UUID.test(request.params.versionId)) return notFound(reply);
    const version = await db().query<{ document: unknown }>('SELECT document FROM project_versions WHERE id = $1 AND project_id = $2', [
      request.params.versionId,
      access.project.id,
    ]);
    const snapshot = version.rows[0];
    if (!snapshot) return notFound(reply);
    const restored = await withTransaction(db(), async (client) => {
      await client.query('INSERT INTO project_versions (project_id, label, document, created_by) VALUES ($1, $2, $3, $4)', [
        access.project.id,
        'before-restore',
        access.project.document,
        user.id,
      ]);
      const result = await client.query<ProjectRow>('UPDATE projects SET document = $2, updated_at = now() WHERE id = $1 RETURNING *', [
        access.project.id,
        snapshot.document,
      ]);
      return result.rows[0]!;
    });
    return reply.send({ project: projectPayload(restored) });
  });

  app.post('/v1/projects/import', { bodyLimit: DOCUMENT_BODY_LIMIT }, async (request, reply) => {
    const user = await authenticate(request, reply);
    if (!user) return reply;
    const parsed = ImportSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request', issues: parsed.error.issues });
    const raw = request.body as unknown;
    const documents = Array.isArray(raw) ? raw : ((raw as { documents: unknown[] }).documents ?? []);
    const parsedDocuments = Array.isArray(parsed.data) ? parsed.data : parsed.data.documents;
    const workspaceId = await personalWorkspaceId(user);
    const ids = await withTransaction(db(), async (client) => {
      const created: string[] = [];
      for (let index = 0; index < documents.length; index += 1) {
        const inserted = await client.query<{ id: string }>(
          'INSERT INTO projects (workspace_id, name, document, created_by) VALUES ($1, $2, $3, $4) RETURNING id',
          [workspaceId, parsedDocuments[index]?.name ?? 'Imported project', documents[index], user.id],
        );
        created.push(inserted.rows[0]!.id);
      }
      return created;
    });
    return reply.code(201).send({ workspaceId, projectIds: ids, imported: ids.length });
  });

  // ---------------------------------------------------------- brand kits ----

  app.get<{ Params: { id: string } }>('/v1/workspaces/:id/brand-kits', async (request, reply) => {
    const user = await authenticate(request, reply);
    if (!user) return reply;
    const role = await membershipRole(request.params.id, user.id);
    if (!role) return notFound(reply);
    const kits = await db().query('SELECT * FROM brand_kits WHERE workspace_id = $1 ORDER BY created_at ASC', [request.params.id]);
    return reply.send({ brandKits: kits.rows.map(brandKitPayload) });
  });

  app.post<{ Params: { id: string } }>('/v1/workspaces/:id/brand-kits', { bodyLimit: DOCUMENT_BODY_LIMIT }, async (request, reply) => {
    const user = await authenticate(request, reply);
    if (!user) return reply;
    const role = await membershipRole(request.params.id, user.id);
    if (!role) return notFound(reply);
    if (!allows(role, 'editor')) return reply.code(403).send({ error: 'forbidden' });
    const parsed = BrandKitSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request', issues: parsed.error.issues });
    const created = await db().query(
      `INSERT INTO brand_kits (workspace_id, name, colors, font_family, logo_data_url, source_prefix)
       VALUES ($1, $2, $3::jsonb, $4, $5, $6) RETURNING *`,
      [
        request.params.id,
        parsed.data.name,
        JSON.stringify(parsed.data.colors),
        parsed.data.fontFamily ?? null,
        parsed.data.logoDataUrl ?? null,
        parsed.data.sourcePrefix ?? null,
      ],
    );
    return reply.code(201).send({ brandKit: brandKitPayload(created.rows[0] as Record<string, unknown>) });
  });

  const brandKitAccess = async (brandKitId: string, userId: string) => {
    if (!UUID.test(brandKitId)) return null;
    const result = await db().query(
      `SELECT b.*, m.role FROM brand_kits b
         JOIN workspace_members m ON m.workspace_id = b.workspace_id AND m.user_id = $2
        WHERE b.id = $1`,
      [brandKitId, userId],
    );
    const row = result.rows[0] as (Record<string, unknown> & { role: WorkspaceRole }) | undefined;
    return row ?? null;
  };

  app.put<{ Params: { id: string } }>('/v1/brand-kits/:id', { bodyLimit: DOCUMENT_BODY_LIMIT }, async (request, reply) => {
    const user = await authenticate(request, reply);
    if (!user) return reply;
    const kit = await brandKitAccess(request.params.id, user.id);
    if (!kit) return notFound(reply);
    if (!allows(kit.role, 'editor')) return reply.code(403).send({ error: 'forbidden' });
    const parsed = BrandKitSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request', issues: parsed.error.issues });
    const updated = await db().query(
      `UPDATE brand_kits SET name = $2, colors = $3::jsonb, font_family = $4, logo_data_url = $5, source_prefix = $6
        WHERE id = $1 RETURNING *`,
      [
        request.params.id,
        parsed.data.name,
        JSON.stringify(parsed.data.colors),
        parsed.data.fontFamily ?? null,
        parsed.data.logoDataUrl ?? null,
        parsed.data.sourcePrefix ?? null,
      ],
    );
    return reply.send({ brandKit: brandKitPayload(updated.rows[0] as Record<string, unknown>) });
  });

  app.delete<{ Params: { id: string } }>('/v1/brand-kits/:id', async (request, reply) => {
    const user = await authenticate(request, reply);
    if (!user) return reply;
    const kit = await brandKitAccess(request.params.id, user.id);
    if (!kit) return notFound(reply);
    if (!allows(kit.role, 'editor')) return reply.code(403).send({ error: 'forbidden' });
    await db().query('DELETE FROM brand_kits WHERE id = $1', [request.params.id]);
    return reply.send({ ok: true });
  });

  // --------------------------------------------------------------- share ----

  app.post<{ Params: { id: string } }>('/v1/projects/:id/share', async (request, reply) => {
    const user = await authenticate(request, reply);
    if (!user) return reply;
    const access = await projectAccess(request.params.id, user.id);
    if (!access) return notFound(reply);
    if (!allows(access.role, 'editor')) return reply.code(403).send({ error: 'forbidden' });
    const parsed = ShareCreateSchema.safeParse(request.body ?? undefined);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request', issues: parsed.error.issues });
    const token = randomBytes(32).toString('base64url');
    const expiresAt = parsed.data?.expiresInHours ? new Date(Date.now() + parsed.data.expiresInHours * 3_600_000) : null;
    const created = await db().query<{ id: string; created_at: Date }>(
      'INSERT INTO share_tokens (token_hash, project_id, created_by, expires_at) VALUES ($1, $2, $3, $4) RETURNING id, created_at',
      [hashToken(token), access.project.id, user.id, expiresAt],
    );
    // The token itself is never stored, so this response is the only chance to see it.
    return reply.code(201).send({
      id: created.rows[0]!.id,
      token,
      url: `${config.APP_BASE_URL.replace(/\/$/, '')}/share/${token}`,
      expiresAt,
      createdAt: created.rows[0]!.created_at,
    });
  });

  app.delete<{ Params: { tokenId: string } }>('/v1/share/:tokenId', async (request, reply) => {
    const user = await authenticate(request, reply);
    if (!user) return reply;
    if (!UUID.test(request.params.tokenId)) return notFound(reply);
    const owned = await db().query<{ id: string }>(
      `SELECT s.id FROM share_tokens s
         JOIN projects p ON p.id = s.project_id
         JOIN workspace_members m ON m.workspace_id = p.workspace_id AND m.user_id = $2
        WHERE s.id = $1 AND m.role IN ('owner', 'admin', 'editor')`,
      [request.params.tokenId, user.id],
    );
    if (!owned.rows[0]) return notFound(reply);
    await db().query('UPDATE share_tokens SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL', [request.params.tokenId]);
    return reply.send({ ok: true, revoked: true });
  });

  // Public: no session required. Read-only, and a revoked or expired link is
  // indistinguishable from one that never existed.
  app.get<{ Params: { token: string } }>('/v1/share/:token', async (request, reply) => {
    const result = await db().query<{ name: string; document: unknown; updated_at: Date }>(
      `SELECT p.name, p.document, p.updated_at FROM share_tokens s
         JOIN projects p ON p.id = s.project_id
        WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND (s.expires_at IS NULL OR s.expires_at > now())`,
      [hashToken(request.params.token)],
    );
    const row = result.rows[0];
    if (!row) return notFound(reply);
    return reply.send({ readOnly: true, name: row.name, document: row.document, updatedAt: row.updated_at });
  });
};

function brandKitPayload(row: Record<string, unknown>) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    colors: row.colors,
    fontFamily: row.font_family,
    logoDataUrl: row.logo_data_url,
    sourcePrefix: row.source_prefix,
    createdAt: row.created_at,
  };
}
