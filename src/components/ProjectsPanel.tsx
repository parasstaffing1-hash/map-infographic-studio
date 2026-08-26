import { useState } from 'react';
import { Archive, ArchiveRestore, Copy, FolderOpen, History, Link2, Palette, Plus, Save, Share2 } from 'lucide-react';
import { buildShareUrl, type BrandKit, type Project, type ProjectRole } from '../domain/projects';
import type { ReactNode } from 'react';

type Props = {
  projects: Project[];
  activeId?: string;
  role: ProjectRole;
  brandKits: BrandKit[];
  activeBrandKitId?: string;
  onOpen: (projectId: string) => void;
  onCreate: (name: string) => void;
  onRename: (name: string) => void;
  onDuplicate: () => void;
  onArchive: (projectId: string, archived: boolean) => void;
  onSaveVersion: (label: string) => void;
  onRestoreVersion: (versionId: string) => void;
  onBrandKit: (kitId: string) => void;
  onToast: (message: string) => void;
  /** Account and server-workspace controls, rendered above the local projects. */
  accountSlot?: ReactNode;
};

export function ProjectsPanel({ projects, activeId, role, brandKits, activeBrandKitId, onOpen, onCreate, onRename, onDuplicate, onArchive, onSaveVersion, onRestoreVersion, onBrandKit, onToast, accountSlot }: Props) {
  const [newName, setNewName] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [shareUrl, setShareUrl] = useState('');
  const active = projects.find((project) => project.id === activeId);
  const visible = projects.filter((project) => project.archived === showArchived);

  const share = () => {
    if (!active) return;
    const link = buildShareUrl(window.location.origin, active);
    if (link.tooLong) {
      onToast('This project is too large for a link. Export the project JSON instead.');
      return;
    }
    setShareUrl(link.url);
    navigator.clipboard?.writeText(link.url).then(
      () => onToast('Read-only link copied to the clipboard'),
      () => onToast('Read-only link ready below'),
    );
  };

  return (
    <div className="panel-content projects-panel">
      <div className="panel-heading">
        <div className="panel-title">
          <span className="panel-title-icon"><FolderOpen size={16} /></span>
          <div><h2>Projects</h2><span>{projects.length} saved in this browser</span></div>
        </div>
      </div>

      {accountSlot}

      <div className="panel-label">This browser</div>
      <div className="data-action-row">
        <input aria-label="New project name" value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="New project name" onKeyDown={(event) => { if (event.key === 'Enter' && newName.trim()) { onCreate(newName.trim()); setNewName(''); } }} />
        <button className="primary-button" disabled={!newName.trim()} onClick={() => { onCreate(newName.trim()); setNewName(''); }}><Plus size={14} /> Create</button>
      </div>

      {active && (
        <div className="active-project-card">
          <label className="production-field"><span>Project name</span>
            <input value={active.name} onChange={(event) => onRename(event.target.value)} disabled={role === 'viewer'} />
          </label>
          <div className="project-meta"><span>{active.rows.length} rows</span><span>·</span><span>{active.versions.length} versions</span><span>·</span><span>Updated {new Date(active.updatedAt).toLocaleString()}</span></div>
          <div className="data-action-row">
            <button className="outline-button" onClick={() => { onSaveVersion('Manual save'); onToast('Version saved'); }} disabled={role === 'viewer'}><Save size={14} /> Save version</button>
            <button className="outline-button" onClick={onDuplicate}><Copy size={14} /> Duplicate</button>
            <button className="outline-button" onClick={() => { onArchive(active.id, !active.archived); onToast(active.archived ? 'Project restored' : 'Project archived'); }}>
              {active.archived ? <><ArchiveRestore size={14} /> Restore</> : <><Archive size={14} /> Archive</>}
            </button>
          </div>
          <button className="outline-button wide" onClick={share} disabled={role !== 'owner'}><Share2 size={14} /> Copy read-only link</button>
          {role !== 'owner' && <p className="panel-hint">Sharing is limited to the project owner. Your role here is {role}.</p>}
          {shareUrl && <textarea className="share-url" readOnly value={shareUrl} aria-label="Read-only share link" onFocus={(event) => event.target.select()} />}
        </div>
      )}

      <div className="section-title">
        <span>{showArchived ? 'Archived' : 'Active'} projects</span>
        <button className="text-button" onClick={() => setShowArchived((value) => !value)}>{showArchived ? 'Show active' : 'Show archived'}</button>
      </div>
      {visible.length === 0 && <p className="panel-note">No {showArchived ? 'archived' : 'active'} projects yet.</p>}
      <ul className="project-list">
        {visible.map((project) => (
          <li key={project.id}>
            <button className={`project-row ${project.id === activeId ? 'active' : ''}`} onClick={() => onOpen(project.id)} aria-current={project.id === activeId}>
              <strong>{project.name}</strong>
              <small>{project.rows.length} rows · {new Date(project.updatedAt).toLocaleDateString()}</small>
            </button>
          </li>
        ))}
      </ul>

      {active && active.versions.length > 0 && (
        <>
          <div className="panel-label"><History size={13} /> Version history</div>
          <ul className="version-list">
            {active.versions.slice(0, 10).map((version) => (
              <li key={version.id}>
                <button onClick={() => { onRestoreVersion(version.id); onToast(`Restored “${version.label}”`); }} disabled={role === 'viewer'}>
                  <strong>{version.label}</strong>
                  <small>{new Date(version.savedAt).toLocaleString()} · {version.rows.length} rows</small>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="panel-label"><Palette size={13} /> Brand kit</div>
      <div className="brand-kit-grid">
        {brandKits.map((kit) => (
          <button key={kit.id} className={`brand-kit-card ${kit.id === activeBrandKitId ? 'active' : ''}`} onClick={() => { onBrandKit(kit.id); onToast(`${kit.name} brand kit applied`); }} aria-pressed={kit.id === activeBrandKitId}>
            <span className="brand-kit-swatches" aria-hidden="true">{kit.colors.map((color) => <i key={color} style={{ background: color }} />)}</span>
            <strong>{kit.name}</strong>
          </button>
        ))}
      </div>

      <p className="panel-note"><Link2 size={14} /> Projects are stored in this browser. Export the project JSON from the Export panel to move a project between machines.</p>
    </div>
  );
}
