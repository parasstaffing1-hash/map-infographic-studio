import { useMemo, useState } from 'react';
import { Activity, BarChart3, Box, DollarSign, FileText, Gauge, Globe2, GripVertical, LayoutTemplate, Leaf, Map, Megaphone, Plus, Search, Table2, Target, Trash2, Users, X } from 'lucide-react';
import type { DataRow } from '../domain/infographic';
import { DEFAULT_DASHBOARD_BLOCKS, emptyDashboardDocument, type DashboardBlock, type DashboardBlockType, type DashboardDocument } from '../domain/projectDocument';
import { ThreeScene } from './ThreeScene';

type DashboardTemplate = {
  id: string;
  name: string;
  category: string;
  description: string;
  accent: string;
  icon: typeof LayoutTemplate;
  blocks: Array<Pick<DashboardBlock, 'type' | 'title'>>;
};

const blockMeta: Record<DashboardBlockType, { label: string; icon: typeof BarChart3 }> = {
  kpi: { label: 'KPI card', icon: BarChart3 },
  chart: { label: 'Bar chart', icon: BarChart3 },
  map: { label: 'Map view', icon: Map },
  table: { label: 'Data table', icon: Table2 },
  narrative: { label: 'Narrative', icon: FileText },
  three: { label: '3D globe', icon: Box },
};

const dashboardTemplates: DashboardTemplate[] = [
  {
    id: 'executive-overview', name: 'Executive overview', category: 'Leadership', description: 'A concise pulse on growth, reach, and regional performance.', accent: 'violet', icon: Gauge,
    blocks: [{ type: 'kpi', title: 'Total performance' }, { type: 'kpi', title: 'Average growth' }, { type: 'chart', title: 'Top markets' }, { type: 'map', title: 'Global footprint' }, { type: 'narrative', title: 'Executive summary' }],
  },
  {
    id: 'sales-performance', name: 'Sales performance', category: 'Revenue', description: 'Track pipeline health, territory results, and rep momentum.', accent: 'blue', icon: Target,
    blocks: [{ type: 'kpi', title: 'Revenue' }, { type: 'kpi', title: 'Win rate' }, { type: 'chart', title: 'Revenue by territory' }, { type: 'table', title: 'Top opportunities' }, { type: 'map', title: 'Territory coverage' }],
  },
  {
    id: 'marketing-funnel', name: 'Marketing funnel', category: 'Growth', description: 'See channel contribution from awareness through conversion.', accent: 'orange', icon: Megaphone,
    blocks: [{ type: 'kpi', title: 'Qualified leads' }, { type: 'kpi', title: 'Conversion rate' }, { type: 'chart', title: 'Channel performance' }, { type: 'chart', title: 'Funnel movement' }, { type: 'narrative', title: 'Campaign notes' }],
  },
  {
    id: 'product-analytics', name: 'Product analytics', category: 'Product', description: 'Understand adoption, engagement, and feature usage patterns.', accent: 'teal', icon: Activity,
    blocks: [{ type: 'kpi', title: 'Active users' }, { type: 'kpi', title: 'Retention' }, { type: 'chart', title: 'Usage by segment' }, { type: 'table', title: 'Feature adoption' }, { type: 'three', title: 'User distribution' }],
  },
  {
    id: 'finance-revenue', name: 'Finance & revenue', category: 'Finance', description: 'A finance-ready view of revenue, margin, and regional variance.', accent: 'green', icon: DollarSign,
    blocks: [{ type: 'kpi', title: 'Net revenue' }, { type: 'kpi', title: 'Gross margin' }, { type: 'chart', title: 'Revenue trend' }, { type: 'table', title: 'Regional variance' }, { type: 'narrative', title: 'Finance commentary' }],
  },
  {
    id: 'operations-control', name: 'Operations control', category: 'Operations', description: 'Monitor volume, service levels, and exceptions across regions.', accent: 'slate', icon: Gauge,
    blocks: [{ type: 'kpi', title: 'Throughput' }, { type: 'kpi', title: 'SLA attainment' }, { type: 'map', title: 'Operations map' }, { type: 'table', title: 'Open exceptions' }, { type: 'chart', title: 'Volume by region' }],
  },
  {
    id: 'customer-success', name: 'Customer success', category: 'Customers', description: 'Surface account health, retention signals, and support demand.', accent: 'pink', icon: Users,
    blocks: [{ type: 'kpi', title: 'Healthy accounts' }, { type: 'kpi', title: 'Renewal forecast' }, { type: 'chart', title: 'Health by segment' }, { type: 'table', title: 'Accounts to watch' }, { type: 'narrative', title: 'Customer highlights' }],
  },
  {
    id: 'geographic-intelligence', name: 'Geographic intelligence', category: 'Maps', description: 'Combine geographic context, rankings, and an interactive 3D globe.', accent: 'indigo', icon: Globe2,
    blocks: [{ type: 'map', title: 'Regional intensity' }, { type: 'chart', title: 'Top locations' }, { type: 'three', title: 'Global signal' }, { type: 'table', title: 'Location ranking' }, { type: 'narrative', title: 'Geographic story' }],
  },
  {
    id: 'sustainability', name: 'Sustainability scorecard', category: 'ESG', description: 'Present environmental and social indicators in one clear scorecard.', accent: 'leaf', icon: Leaf,
    blocks: [{ type: 'kpi', title: 'Impact score' }, { type: 'kpi', title: 'Emission intensity' }, { type: 'map', title: 'Impact by region' }, { type: 'chart', title: 'Progress to target' }, { type: 'narrative', title: 'ESG narrative' }],
  },
];

const sampleRows: DataRow[] = [
  { id: 'delhi', region: 'Delhi', value: 86, raw: { region: 'Delhi', value: 86 } },
  { id: 'singapore', region: 'Singapore', value: 74, raw: { region: 'Singapore', value: 74 } },
  { id: 'new-york', region: 'New York', value: 68, raw: { region: 'New York', value: 68 } },
  { id: 'london', region: 'London', value: 62, raw: { region: 'London', value: 62 } },
  { id: 'nairobi', region: 'Nairobi', value: 51, raw: { region: 'Nairobi', value: 51 } },
];

function numberValue(value: string | number) {
  const numeric = typeof value === 'number' ? value : Number(value.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(numeric) ? numeric : 0;
}

export function DashboardCanvas({ rows, viewMode, dashboard, onDashboardChange }: { rows: DataRow[]; viewMode: string; dashboard?: DashboardDocument; onDashboardChange?: (dashboard: DashboardDocument) => void }) {
  const initialDashboard = dashboard ?? emptyDashboardDocument();
  const [name, setName] = useState(initialDashboard.name);
  const [editing, setEditing] = useState(true);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [templateSearch, setTemplateSearch] = useState('');
  const [activeTemplate, setActiveTemplate] = useState<string | null>(initialDashboard.activeTemplate ?? null);
  const [newBlock, setNewBlock] = useState<DashboardBlockType>('kpi');
  const [blocks, setBlocks] = useState<DashboardBlock[]>(initialDashboard.blocks.length ? initialDashboard.blocks : DEFAULT_DASHBOARD_BLOCKS);
  const [draggedBlockId, setDraggedBlockId] = useState<string | null>(null);
  const dashboardRows = rows.length ? rows : sampleRows;
  const values = useMemo(() => dashboardRows.map((row) => numberValue(row.value)), [dashboardRows]);
  const total = values.reduce((sum, value) => sum + value, 0);
  const average = values.length ? total / values.length : 0;
  const max = values.length ? Math.max(...values) : 0;
  const chartRows = dashboardRows.slice().sort((a, b) => numberValue(b.value) - numberValue(a.value)).slice(0, 5);
  const filteredTemplates = useMemo(() => {
    const query = templateSearch.trim().toLowerCase();
    if (!query) return dashboardTemplates;
    return dashboardTemplates.filter((template) => `${template.name} ${template.category} ${template.description}`.toLowerCase().includes(query));
  }, [templateSearch]);

  const commit = (change: Partial<DashboardDocument>) => {
    const next: DashboardDocument = { name, blocks, activeTemplate: activeTemplate ?? undefined, ...change };
    setName(next.name);
    setBlocks(next.blocks);
    setActiveTemplate(next.activeTemplate ?? null);
    onDashboardChange?.(next);
  };

  const addBlock = () => {
    const next = blocks.filter((block) => block.type === newBlock).length + 1;
    commit({ blocks: [...blocks, { id: `${newBlock}-${Date.now()}`, type: newBlock, title: `${blockMeta[newBlock].label} ${next}` }] });
  };
  const removeBlock = (id: string) => commit({ blocks: blocks.filter((block) => block.id !== id) });
  const updateTitle = (id: string, title: string) => commit({ blocks: blocks.map((block) => block.id === id ? { ...block, title } : block) });
  const loadTemplate = (template: DashboardTemplate) => {
    commit({ name: template.name, blocks: template.blocks.map((block, index) => ({ ...block, id: `${template.id}-${block.type}-${index}` })), activeTemplate: template.id });
    setLibraryOpen(false);
    setEditing(true);
  };
  const reorderBlock = (targetId: string) => {
    if (!draggedBlockId || draggedBlockId === targetId) return;
    const sourceIndex = blocks.findIndex((block) => block.id === draggedBlockId);
    const targetIndex = blocks.findIndex((block) => block.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const next = blocks.slice();
    const [moved] = next.splice(sourceIndex, 1);
    if (moved) next.splice(targetIndex, 0, moved);
    commit({ blocks: next });
    setDraggedBlockId(null);
  };

  return (
    <div className="dashboard-canvas">
      <header className="dashboard-toolbar">
        <div>
          <span className="eyebrow">DASHBOARD BUILDER</span>
          <input className="dashboard-name" value={name} onChange={(event) => commit({ name: event.target.value })} aria-label="Dashboard name" />
          <p>Compose a live story from your map data, charts, tables, and 3D views.</p>
        </div>
        <div className="dashboard-toolbar-actions">
          <button className="outline-button dashboard-library-button" type="button" onClick={() => setLibraryOpen((value) => !value)}><LayoutTemplate size={14} /> {libraryOpen ? 'Close library' : 'Template library'}</button>
          {editing && <>
            <select value={newBlock} onChange={(event) => setNewBlock(event.target.value as DashboardBlockType)} aria-label="Block type">
              {(Object.keys(blockMeta) as DashboardBlockType[]).map((type) => <option key={type} value={type}>{blockMeta[type].label}</option>)}
            </select>
            <button className="outline-button" type="button" onClick={addBlock}><Plus size={14} /> Add block</button>
          </>}
          <button className="primary-button" type="button" onClick={() => setEditing((value) => !value)}>{editing ? 'Preview dashboard' : 'Edit dashboard'}</button>
        </div>
      </header>
      {libraryOpen && <section className="dashboard-library" aria-label="Dashboard template library">
        <div className="dashboard-library-heading">
          <div><span className="eyebrow">DASHBOARD LIBRARY</span><h2>Start with a proven layout</h2><p>Choose a template, then tailor every block to your data.</p></div>
          <button className="small-button" type="button" onClick={() => setLibraryOpen(false)} aria-label="Close dashboard library"><X size={15} /></button>
        </div>
        <label className="dashboard-library-search"><Search size={14} /><input value={templateSearch} onChange={(event) => setTemplateSearch(event.target.value)} placeholder="Search templates by use case…" aria-label="Search dashboard templates" /></label>
        <div className="dashboard-template-grid">
          {filteredTemplates.map((template) => { const Icon = template.icon; return <article className={`dashboard-template-card ${template.accent} ${activeTemplate === template.id ? 'selected' : ''}`} key={template.id}>
            <div className="dashboard-template-icon"><Icon size={17} /></div>
            <div className="dashboard-template-copy"><div className="dashboard-template-topline"><span>{template.category}</span>{activeTemplate === template.id && <b>Active</b>}</div><h3>{template.name}</h3><p>{template.description}</p></div>
            <div className="dashboard-template-footer"><small>{template.blocks.length} blocks · {template.blocks.map((block) => blockMeta[block.type].label).slice(0, 3).join(' · ')}</small><button className="small-button" type="button" onClick={() => loadTemplate(template)}>Use template</button></div>
          </article>; })}
          {!filteredTemplates.length && <div className="dashboard-library-empty">No templates match “{templateSearch}”.</div>}
        </div>
      </section>}
      <div className="dashboard-meta"><span>{dashboardRows.length} data rows</span><span>·</span><span>{viewMode.replace(/-/g, ' ')}</span><span>·</span><span>{blocks.length} blocks</span></div>
      <div className="dashboard-grid">
        {blocks.map((block) => {
          const Icon = blockMeta[block.type].icon;
          return (
            <article className={`dashboard-block dashboard-block-${block.type} ${draggedBlockId === block.id ? 'is-dragging' : ''}`} key={block.id} draggable={editing} onDragStart={() => setDraggedBlockId(block.id)} onDragEnd={() => setDraggedBlockId(null)} onDragOver={(event) => { if (editing) event.preventDefault(); }} onDrop={(event) => { event.preventDefault(); if (editing) reorderBlock(block.id); }}>
              <div className="dashboard-block-header">
                <div className="dashboard-block-title">{editing && <GripVertical className="dashboard-drag-handle" size={14} aria-label="Drag to reorder" />}<Icon size={15} /><input value={block.title} onChange={(event) => updateTitle(block.id, event.target.value)} readOnly={!editing} aria-label={`${blockMeta[block.type].label} title`} /></div>
                {editing && <button className="small-button" type="button" onClick={() => removeBlock(block.id)} aria-label={`Remove ${block.title}`}><Trash2 size={14} /></button>}
              </div>
              {block.type === 'kpi' && <div className="dashboard-kpi"><strong>{total.toLocaleString(undefined, { maximumFractionDigits: 1 })}</strong><span>{dashboardRows.length} regions · average {average.toFixed(1)}</span></div>}
              {block.type === 'chart' && <div className="dashboard-bars">{chartRows.map((row) => <div className="dashboard-bar-row" key={row.id}><span>{row.region}</span><div><i style={{ width: `${max ? (numberValue(row.value) / max) * 100 : 0}%` }} /></div><b>{numberValue(row.value).toFixed(0)}</b></div>)}</div>}
              {block.type === 'map' && <div className="dashboard-map-block"><div className="dashboard-map-surface"><span className="dashboard-map-grid" />{dashboardRows.slice(0, 8).map((row, index) => <i key={row.id} style={{ left: `${18 + (index * 17) % 72}%`, top: `${22 + (index * 29) % 60}%`, opacity: 0.35 + (numberValue(row.value) / Math.max(max, 1)) * 0.65 }} title={row.region} />)}</div><small>Map layer connected · {viewMode.replace(/-/g, ' ')}</small></div>}
              {block.type === 'table' && <table className="dashboard-table"><thead><tr><th>Region</th><th>Value</th></tr></thead><tbody>{chartRows.map((row) => <tr key={row.id}><td>{row.region}</td><td>{numberValue(row.value).toFixed(0)}</td></tr>)}</tbody></table>}
              {block.type === 'narrative' && <p className="dashboard-narrative">This dashboard turns verified geographic data into a clear story. Use the editor to update the source, filters, and visual blocks.</p>}
              {block.type === 'three' && <ThreeScene />}
            </article>
          );
        })}
        {editing && <button className="dashboard-add-tile" type="button" onClick={addBlock}><Plus size={20} /><span>Add another block</span><small>Cards, charts, maps, tables, narrative, or 3D</small></button>}
      </div>
    </div>
  );
}
