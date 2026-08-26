import { formatDataValue, type DataRow, type InfographicConfig } from '../domain/infographic';

type Props = {
  rows: DataRow[];
  config: InfographicConfig;
  currentYear?: string;
  kicker?: string;
  statsHook?: { label: string; value: string; delta?: string };
};

type RankedRow = { region: string; value: number };

export function StatistaStoryOverlay({ rows, config, currentYear, kicker = 'DATA STORY', statsHook }: Props) {
  const scopedRows = currentYear ? rows.filter((row) => !row.year || row.year === currentYear) : rows;
  const ranked = [...new Map(scopedRows.map((row) => [row.region, { region: row.region, value: parseValue(row.value) }])).values()]
    .filter((row): row is RankedRow => Number.isFinite(row.value))
    .sort((first, second) => second.value - first.value)
    .slice(0, 5);
  const maxValue = ranked[0]?.value ?? 1;

  if (!ranked.length) return null;

  return <>
    <div className="statista-story-kicker"><span>{kicker}</span><i /><span>DATA STORY</span></div>
    {statsHook && <div className="statista-story-kpi"><span>{statsHook.label}</span><strong>{statsHook.value}</strong>{statsHook.delta && <small>{statsHook.delta}</small>}</div>}
    <aside className="statista-story-panel" aria-label="Top regions by value">
      <div className="statista-story-panel-heading"><span>Top regions</span>{currentYear && <em>{currentYear}</em>}</div>
      <div className="statista-story-rank-list">
        {ranked.map((row, index) => <div className="statista-story-rank" key={row.region}>
          <div className="statista-story-rank-label"><span>{index + 1}</span><strong>{row.region}</strong><b>{formatDataValue(row.value, config)}</b></div>
          <div className="statista-story-track" role="progressbar" aria-label={`${row.region}: ${formatDataValue(row.value, config)}`} aria-valuenow={row.value} aria-valuemin={0} aria-valuemax={maxValue}><i style={{ width: `${Math.max(5, (row.value / maxValue) * 100)}%` }} /></div>
        </div>)}
      </div>
      {config.source && <div className="statista-story-source">{config.source}</div>}
    </aside>
  </>;
}

function parseValue(value: string | number) {
  if (typeof value === 'number') return value;
  const cleaned = String(value).replace(/[₹$€£,%\s,()]/g, '');
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}
