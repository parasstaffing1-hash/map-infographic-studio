import type { ProjectDocument } from './projectDocument';

/** Where the session token lives. Cleared on logout and on a 401. */
export const SESSION_STORAGE_KEY = 'map-studio-session-v1';

export type AccountUser = { id: string; email: string; displayName?: string | null };
export type Workspace = { id: string; name: string; slug?: string; kind?: string; role?: WorkspaceRole };
export type WorkspaceRole = 'owner' | 'admin' | 'editor' | 'viewer';
export type ServerProject = {
  id: string;
  workspaceId: string;
  name: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  document?: ProjectDocument;
};

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
    this.name = 'ApiError';
  }
}

export type ApiClient = ReturnType<typeof createApiClient>;

/**
 * Thin typed wrapper over the application API.
 *
 * The session token is held in localStorage and sent as a bearer token; the
 * server also sets an httpOnly cookie, so either path authenticates. A 401
 * clears the cached token so the UI falls back to offline mode instead of
 * looping on a dead session.
 */
export function createApiClient(baseUrl: string, storage: Storage | undefined = typeof window === 'undefined' ? undefined : window.localStorage) {
  const root = baseUrl.replace(/\/$/, '');

  const readToken = () => {
    try {
      return storage?.getItem(SESSION_STORAGE_KEY) ?? null;
    } catch {
      return null;
    }
  };
  const writeToken = (token: string | null) => {
    try {
      if (token) storage?.setItem(SESSION_STORAGE_KEY, token);
      else storage?.removeItem(SESSION_STORAGE_KEY);
    } catch {
      // A blocked storage must not stop the session from working in-memory.
    }
  };

  async function request<T>(path: string, options: RequestInit & { auth?: boolean } = {}): Promise<T> {
    const token = options.auth === false ? null : readToken();
    const headers: Record<string, string> = { ...(options.headers as Record<string, string> | undefined) };
    if (options.body !== undefined) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;

    let response: Response;
    try {
      response = await fetch(`${root}${path}`, { ...options, headers, credentials: 'include' });
    } catch (error) {
      throw new ApiError(error instanceof Error ? error.message : 'The API is unreachable', 0);
    }

    if (response.status === 401 && options.auth !== false) writeToken(null);
    if (response.status === 204) return undefined as T;

    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (!response.ok) {
      const body = payload as { error?: string; message?: string; detail?: string } | null;
      throw new ApiError(body?.detail ?? body?.message ?? body?.error ?? `Request failed (${response.status})`, response.status, body?.error);
    }
    return payload as T;
  }

  return {
    get token() {
      return readToken();
    },
    get isSignedIn() {
      return Boolean(readToken());
    },
    setToken: writeToken,

    async register(email: string, password: string, displayName: string) {
      const result = await request<{ token: string; user: AccountUser; workspaces: Workspace[] }>('/v1/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, password, displayName }),
        auth: false,
      });
      writeToken(result.token);
      return result;
    },

    async login(email: string, password: string) {
      const result = await request<{ token: string; user: AccountUser; workspaces: Workspace[] }>('/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
        auth: false,
      });
      writeToken(result.token);
      return result;
    },

    async logout() {
      await request('/v1/auth/logout', { method: 'POST' }).catch(() => undefined);
      writeToken(null);
    },

    me: () => request<{ user: AccountUser; workspaces: Workspace[] }>('/v1/auth/me'),
    listWorkspaces: () => request<{ workspaces: Workspace[] }>('/v1/workspaces'),
    createWorkspace: (name: string) => request<{ workspace: Workspace }>('/v1/workspaces', { method: 'POST', body: JSON.stringify({ name }) }),
    listMembers: (workspaceId: string) => request<{ members: Array<{ userId: string; email: string; role: WorkspaceRole }> }>(`/v1/workspaces/${workspaceId}/members`),
    addMember: (workspaceId: string, email: string, role: WorkspaceRole) =>
      request(`/v1/workspaces/${workspaceId}/members`, { method: 'POST', body: JSON.stringify({ email, role }) }),

    listProjects: (workspaceId: string) => request<{ projects: ServerProject[] }>(`/v1/workspaces/${workspaceId}/projects`),
    createProject: (workspaceId: string, name: string, document: ProjectDocument) =>
      request<{ project: ServerProject }>(`/v1/workspaces/${workspaceId}/projects`, { method: 'POST', body: JSON.stringify({ name, document }) }),
    getProject: (projectId: string) => request<{ project: ServerProject; role: WorkspaceRole }>(`/v1/projects/${projectId}`),
    updateProject: (projectId: string, name: string, document: ProjectDocument) =>
      request<{ project: ServerProject }>(`/v1/projects/${projectId}`, { method: 'PUT', body: JSON.stringify({ name, document }) }),
    deleteProject: (projectId: string) => request(`/v1/projects/${projectId}`, { method: 'DELETE' }),
    duplicateProject: (projectId: string) => request<{ project: ServerProject }>(`/v1/projects/${projectId}/duplicate`, { method: 'POST' }),
    archiveProject: (projectId: string, archived: boolean) =>
      request<{ project: ServerProject }>(`/v1/projects/${projectId}/archive`, { method: 'POST', body: JSON.stringify({ archived }) }),
    listVersions: (projectId: string) => request<{ versions: Array<{ id: string; label: string; createdAt: string }> }>(`/v1/projects/${projectId}/versions`),
    saveVersion: (projectId: string, label: string) => request(`/v1/projects/${projectId}/versions`, { method: 'POST', body: JSON.stringify({ label }) }),
    restoreVersion: (projectId: string, versionId: string) => request(`/v1/projects/${projectId}/versions/${versionId}/restore`, { method: 'POST' }),

    share: (projectId: string, expiresAt?: string) =>
      request<{ id: string; token: string; url: string; expiresAt: string | null }>(`/v1/projects/${projectId}/share`, {
        method: 'POST',
        body: JSON.stringify(expiresAt ? { expiresAt } : {}),
      }),
    revokeShare: (tokenId: string) => request(`/v1/share/${tokenId}`, { method: 'DELETE' }),

    /** One-shot migration of the browser cache into the signed-in account. */
    importProjects: (documents: ProjectDocument[]) =>
      request<{ workspaceId: string; projectIds: string[]; imported: number }>('/v1/projects/import', {
        method: 'POST',
        body: JSON.stringify({ documents }),
      }),
  };
}

export const DEFAULT_API_BASE_URL = (import.meta.env?.VITE_PRODUCTION_API_URL as string | undefined) ?? 'http://127.0.0.1:8787';
