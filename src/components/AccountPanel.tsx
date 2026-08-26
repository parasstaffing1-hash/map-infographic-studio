import { useCallback, useEffect, useState } from 'react';
import { CloudUpload, LogIn, LogOut, RefreshCw, UserPlus, Users } from 'lucide-react';
import { ApiError, createApiClient, DEFAULT_API_BASE_URL, type AccountUser, type ServerProject, type Workspace, type WorkspaceRole } from '../domain/apiClient';
import type { ProjectDocument } from '../domain/projectDocument';

type Props = {
  /** Documents held in the browser cache, offered for one-time migration. */
  localDocuments: () => ProjectDocument[];
  onOpenServerProject: (project: ServerProject) => void;
  onSaveCurrentToServer: (workspaceId: string) => Promise<void> | void;
  onClient: (client: ReturnType<typeof createApiClient> | null) => void;
  onToast: (message: string) => void;
};

export function AccountPanel({ localDocuments, onOpenServerProject, onSaveCurrentToServer, onClient, onToast }: Props) {
  const [apiUrl, setApiUrl] = useState(DEFAULT_API_BASE_URL);
  const [client, setClient] = useState(() => createApiClient(DEFAULT_API_BASE_URL));
  const [user, setUser] = useState<AccountUser | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspace, setActiveWorkspace] = useState<string>('');
  const [projects, setProjects] = useState<ServerProject[]>([]);
  const [members, setMembers] = useState<Array<{ userId: string; email: string; role: WorkspaceRole }>>([]);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<WorkspaceRole>('editor');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const next = createApiClient(apiUrl);
    setClient(next);
    onClient(next);
  }, [apiUrl, onClient]);

  const loadProjects = useCallback(async (workspaceId: string, api = client) => {
    if (!workspaceId) return;
    try {
      setProjects((await api.listProjects(workspaceId)).projects);
      setMembers((await api.listMembers(workspaceId)).members);
    } catch (failure) {
      setError(describe(failure));
    }
  }, [client]);

  const adopt = useCallback(async (result: { user: AccountUser; workspaces: Workspace[] }, api = client) => {
    setUser(result.user);
    setWorkspaces(result.workspaces);
    const first = result.workspaces[0]?.id ?? '';
    setActiveWorkspace(first);
    setError('');
    await loadProjects(first, api);
  }, [client, loadProjects]);

  // Restore an existing session on mount so a reload stays signed in.
  useEffect(() => {
    if (!client.isSignedIn) return;
    void client.me().then((result) => adopt(result, client)).catch(() => client.setToken(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const result = mode === 'register'
        ? await client.register(email.trim(), password, displayName.trim() || email.trim())
        : await client.login(email.trim(), password);
      await adopt(result);
      setPassword('');
      onToast(mode === 'register' ? 'Account created' : 'Signed in');
    } catch (failure) {
      setError(describe(failure));
    } finally {
      setBusy(false);
    }
  };

  const migrate = async () => {
    const documents = localDocuments();
    if (!documents.length) {
      onToast('There are no browser projects to migrate.');
      return;
    }
    setBusy(true);
    try {
      const result = await client.importProjects(documents);
      onToast(`${result.imported} browser project${result.imported === 1 ? '' : 's'} copied into your account`);
      // Imports land in the personal workspace, which may not be the selected one.
      if (result.workspaceId && result.workspaceId !== activeWorkspace) setActiveWorkspace(result.workspaceId);
      await loadProjects(result.workspaceId || activeWorkspace);
    } catch (failure) {
      setError(describe(failure));
    } finally {
      setBusy(false);
    }
  };

  if (!user) {
    return (
      <div className="account-panel">
        <div className="panel-label">Account</div>
        <p className="panel-hint">Sign in to keep projects on the server and share them with a team. Without an account everything stays in this browser.</p>
        <label className="production-field"><span>API URL</span><input value={apiUrl} onChange={(event) => setApiUrl(event.target.value)} /></label>
        <div className="chip-row">
          <button className={`chip ${mode === 'login' ? 'active' : ''}`} onClick={() => setMode('login')}>Sign in</button>
          <button className={`chip ${mode === 'register' ? 'active' : ''}`} onClick={() => setMode('register')}>Create account</button>
        </div>
        {mode === 'register' && (
          <label className="production-field"><span>Name</span><input value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoComplete="name" /></label>
        )}
        <label className="production-field"><span>Email</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" /></label>
        <label className="production-field"><span>Password</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} /></label>
        {mode === 'register' && <p className="panel-hint">At least 10 characters.</p>}
        <button className="primary-button wide" onClick={() => void submit()} disabled={busy || !email.trim() || password.length < 1}>
          {mode === 'register' ? <><UserPlus size={14} /> Create account</> : <><LogIn size={14} /> Sign in</>}
        </button>
        {error && <div className="production-error" role="alert">{error}</div>}
      </div>
    );
  }

  const role = workspaces.find((entry) => entry.id === activeWorkspace)?.role ?? 'owner';
  const canManage = role === 'owner' || role === 'admin';

  return (
    <div className="account-panel">
      <div className="panel-label">Account</div>
      <div className="account-identity">
        <strong>{user.displayName || user.email}</strong>
        <small>{user.email}</small>
      </div>

      <label className="select-row"><span>Workspace</span>
        <select value={activeWorkspace} onChange={(event) => { setActiveWorkspace(event.target.value); void loadProjects(event.target.value); }}>
          {workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
        </select>
      </label>
      <p className="panel-hint"><Users size={12} /> Your role here is {role}.</p>

      <div className="data-action-row">
        <button className="outline-button" onClick={() => void onSaveCurrentToServer(activeWorkspace)} disabled={!activeWorkspace || role === 'viewer'}>
          <CloudUpload size={14} /> Save current project
        </button>
        <button className="outline-button" onClick={() => void loadProjects(activeWorkspace)}><RefreshCw size={14} /> Refresh</button>
      </div>

      <button className="outline-button wide" onClick={() => void migrate()} disabled={busy || role === 'viewer'}>
        <CloudUpload size={14} /> Migrate browser projects into this account
      </button>

      <div className="section-title"><span>Server projects · {projects.length}</span></div>
      <ul className="project-list">
        {projects.map((project) => (
          <li key={project.id}>
            <button className="project-row" onClick={() => void client.getProject(project.id).then((result) => onOpenServerProject(result.project)).catch((failure) => setError(describe(failure)))}>
              <strong>{project.name}</strong>
              <small>{new Date(project.updatedAt).toLocaleString()}{project.archived ? ' · archived' : ''}</small>
            </button>
          </li>
        ))}
      </ul>
      {projects.length === 0 && <p className="panel-note">No server projects in this workspace yet.</p>}

      {canManage && (
        <>
          <div className="section-title"><span>Members · {members.length}</span></div>
          <ul className="project-list">
            {members.map((member) => <li key={member.userId}><span className="member-row">{member.email} · {member.role}</span></li>)}
          </ul>
          <div className="data-action-row">
            <input aria-label="Invite by email" placeholder="teammate@example.com" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} />
            <select aria-label="Role" value={inviteRole} onChange={(event) => setInviteRole(event.target.value as WorkspaceRole)}>
              <option value="viewer">Viewer</option><option value="editor">Editor</option><option value="admin">Admin</option>
            </select>
            <button className="outline-button" disabled={!inviteEmail.trim()} onClick={() => void client.addMember(activeWorkspace, inviteEmail.trim(), inviteRole).then(() => { setInviteEmail(''); onToast('Member added'); return loadProjects(activeWorkspace); }).catch((failure) => setError(describe(failure)))}>Add</button>
          </div>
        </>
      )}

      <button className="outline-button wide" onClick={() => void client.logout().then(() => { setUser(null); setProjects([]); setWorkspaces([]); onToast('Signed out'); })}>
        <LogOut size={14} /> Sign out
      </button>
      {error && <div className="production-error" role="alert">{error}</div>}
    </div>
  );
}

function describe(failure: unknown) {
  if (failure instanceof ApiError) {
    if (failure.status === 0) return `${failure.message}. Is the API running?`;
    if (failure.status === 503) return 'The server has no database configured yet.';
    return failure.message;
  }
  return failure instanceof Error ? failure.message : String(failure);
}
