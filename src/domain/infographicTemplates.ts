import { DEFAULT_INFOGRAPHIC_CONFIG, type DataRow, type InfographicConfig } from './infographic';
import type { GeoFeature, ViewMode } from './types';

export type InfographicCategory = 'Economics' | 'Geopolitics' | 'Tech & AI' | 'Energy & Climate' | 'Demographics' | 'Fintech' | 'Space';

export type InfographicTemplate = {
  id: string;
  title: string;
  category: InfographicCategory;
  description: string;
  recommendedChart: string;
  geoScope?: string;
  tags: string[];
  aspectRatios: Array<'16:9' | '9:16' | '1:1' | '4:5'>;
  defaultDurationSeconds: number;
  previewColor: string;
  statsHook: { label: string; value: string; delta?: string };
  viewMode: Extract<ViewMode, 'world' | 'india' | 'usa' | 'china'>;
  openPanel: 'data' | 'video';
  collection?: 'library' | 'test-map' | 'test-infographic' | 'test-video';
  demoMode?: 'index' | 'percentage' | 'categorical' | 'time-series';
  featured?: boolean;
  source?: string;
  sampleRows?: DataRow[];
  suffix?: string;
  decimals?: number;
  paletteId?: string;
  customColors?: string[];
};

const cleanEnergyRows: DataRow[] = [
  ['Rajasthan', 28.4],
  ['Gujarat', 25.8],
  ['Tamil Nadu', 21.2],
  ['Karnataka', 19.6],
  ['Maharashtra', 16.4],
  ['Andhra Pradesh', 11.8],
  ['Madhya Pradesh', 9.5],
  ['Telangana', 8.2],
].map(([region, value], index) => ({
  id: `clean-energy-${index + 1}`,
  region: String(region),
  value: Number(value),
  year: '2024',
  raw: { state: String(region), capacityGW: Number(value) },
}));

// Adapted from Tools/InfoGraphics. Keep this catalog source-aligned so both
// editors expose the same story ideas, labels, formats, and headline hooks.
export const libraryInfographicTemplates: InfographicTemplate[] = [
  {
    id: 'india_clean_energy_transition_2024',
    title: 'India Clean Energy Transition (2024)',
    category: 'Energy & Climate',
    description: 'State-wise installed clean power capacity with a ready-to-edit India choropleth.',
    recommendedChart: 'map + bar + trend',
    geoScope: 'India',
    tags: ['India', 'Renewables', 'Solar', 'Wind', 'MNRE', 'Map'],
    aspectRatios: ['4:5', '16:9', '1:1'],
    defaultDurationSeconds: 60,
    previewColor: '#059669',
    statsHook: { label: 'Total installed capacity', value: '190.5 GW', delta: '+24.2% YoY' },
    viewMode: 'india',
    openPanel: 'data',
    featured: true,
    source: 'Source: MNRE, Government of India · CEA 2024 report',
    sampleRows: cleanEnergyRows,
    suffix: ' GW',
    decimals: 1,
    paletteId: 'kochi',
    customColors: ['#ecfdf5', '#a7f3d0', '#34d399', '#059669', '#047857'],
  },
  {
    id: 'chile_lithium_copper_superpower', title: 'Chile: The Global Copper & Lithium Superpower', category: 'Geopolitics',
    description: 'Geospatial breakdown of Chilean mineral reserves powering the global EV battery revolution.', recommendedChart: 'sankey', geoScope: 'Chile',
    tags: ['Chile', 'Lithium', 'Copper', 'EV Battery', 'Atacama', 'Mining'], aspectRatios: ['16:9', '9:16', '1:1'], defaultDurationSeconds: 60, previewColor: '#ef4444',
    statsHook: { label: 'Global lithium reserves share', value: '48%', delta: 'World #1' }, viewMode: 'world', openPanel: 'data', paletteId: 'delhi',
  },
  {
    id: 'latin_america_gdp_comparison', title: 'Latin American Economic Powerhouses (1990–2035)', category: 'Economics',
    description: 'Multi-decade GDP growth comparing Brazil, Mexico, Argentina, Colombia, Chile, and Peru.', recommendedChart: 'bar chart race', geoScope: 'South America',
    tags: ['Brazil', 'Mexico', 'Argentina', 'Chile', 'Colombia', 'GDP Race'], aspectRatios: ['16:9', '9:16', '1:1'], defaultDurationSeconds: 120, previewColor: '#3b82f6',
    statsHook: { label: 'Combined LatAm GDP', value: '$6.5T', delta: '+140% since 2000' }, viewMode: 'world', openPanel: 'video', paletteId: 'bengaluru',
  },
  {
    id: 'india_10_trillion_vision', title: "India's Journey to a $10 Trillion Economy", category: 'Economics',
    description: 'Macroeconomic timeline from 1991 liberalization to 2035 with state-level economic stories.', recommendedChart: 'bar chart race', geoScope: 'India',
    tags: ['India', 'GDP', 'Superpower', 'Maharashtra', 'Tamil Nadu', 'Gujarat'], aspectRatios: ['16:9', '9:16', '1:1'], defaultDurationSeconds: 180, previewColor: '#ff9933',
    statsHook: { label: 'Target 2035 GDP', value: '$11.5T', delta: 'World #3' }, viewMode: 'india', openPanel: 'video', featured: true, paletteId: 'vizag',
  },
  {
    id: 'asian_century_gdp_ascendance', title: 'The Asian Century: 1960 to 2035 GDP Race', category: 'Economics',
    description: 'Long-form chart race tracking Asian economies as they surpass global peers.', recommendedChart: 'bar chart race', geoScope: 'Asia',
    tags: ['Asia', 'China', 'India', 'Japan', 'South Korea', 'ASEAN'], aspectRatios: ['16:9', '9:16', '1:1'], defaultDurationSeconds: 300, previewColor: '#8b5cf6',
    statsHook: { label: 'Asia share of global GDP', value: '54%', delta: 'Crossing majority' }, viewMode: 'world', openPanel: 'video', paletteId: 'kolkata',
  },
  {
    id: 'india_state_gsdp_powerhouses', title: 'India State-wise Economic Rankings', category: 'Economics',
    description: 'State economic engines covering Maharashtra, Tamil Nadu, Gujarat, Karnataka, and Uttar Pradesh.', recommendedChart: 'grouped bar', geoScope: 'India',
    tags: ['India States', 'GSDP', 'Maharashtra', 'Karnataka', 'Growth'], aspectRatios: ['16:9', '9:16', '1:1'], defaultDurationSeconds: 60, previewColor: '#10b981',
    statsHook: { label: 'Maharashtra GSDP', value: '$480B', delta: 'Target $1T by 2030' }, viewMode: 'india', openPanel: 'data', featured: true, paletteId: 'kochi',
  },
  {
    id: 'tech_giants_market_cap_race', title: 'Tech Giants & AI Market Caps (2000–2035)', category: 'Tech & AI',
    description: 'Valuation progression from the dot-com crash to the multi-trillion-dollar AI era.', recommendedChart: 'bar chart race',
    tags: ['NVIDIA', 'Apple', 'Microsoft', 'Alphabet', 'TSMC', 'Market Cap'], aspectRatios: ['16:9', '9:16', '1:1'], defaultDurationSeconds: 90, previewColor: '#06b6d4',
    statsHook: { label: 'NVIDIA market cap', value: '$3.5T', delta: '+800% in 3 years' }, viewMode: 'world', openPanel: 'video', paletteId: 'jodhpur',
  },
  {
    id: 'semiconductor_foundry_dominance', title: 'Global Semiconductor Foundry Market Share', category: 'Tech & AI',
    description: 'Fabrication market share across TSMC, Samsung, Intel Foundry, and SMIC.', recommendedChart: 'donut',
    tags: ['TSMC', 'Semiconductors', 'Chips', 'Foundry', 'Taiwan', 'AI Hardware'], aspectRatios: ['16:9', '9:16', '1:1'], defaultDurationSeconds: 60, previewColor: '#ec4899',
    statsHook: { label: 'TSMC advanced-node share', value: '92%', delta: '<3nm leader' }, viewMode: 'world', openPanel: 'data', paletteId: 'jaipur',
  },
  {
    id: 'ai_llm_compute_frontier', title: 'AI Compute Scaling & Model Parameters', category: 'Tech & AI',
    description: 'Exponential scaling of FLOPs and parameter counts across frontier AI models.', recommendedChart: 'bubble',
    tags: ['AI Models', 'FLOPs', 'Deep Learning', 'LLMs', 'Compute'], aspectRatios: ['16:9', '9:16', '1:1'], defaultDurationSeconds: 60, previewColor: '#6366f1',
    statsHook: { label: 'Frontier training compute', value: '10^26 FLOPs', delta: '1000× in 4 years' }, viewMode: 'world', openPanel: 'data', paletteId: 'udaipur',
  },
  {
    id: 'global_renewable_energy_race', title: 'Global Clean & Renewable Generation Race (2000–2035)', category: 'Energy & Climate',
    description: 'Solar, wind, hydro, and nuclear capacity additions across China, USA, India, and the EU.', recommendedChart: 'bar chart race',
    tags: ['Solar', 'Wind', 'Renewables', 'China', 'India', 'Clean Power'], aspectRatios: ['16:9', '9:16', '1:1'], defaultDurationSeconds: 120, previewColor: '#10b981',
    statsHook: { label: 'Global solar additions', value: '500+ GW/yr', delta: 'Record high' }, viewMode: 'world', openPanel: 'video', featured: true, paletteId: 'kasol',
  },
  {
    id: 'ev_global_sales_revolution', title: 'Global Electric Vehicle Sales Race', category: 'Energy & Climate',
    description: 'Annual electric-car deliveries comparing BYD, Tesla, Volkswagen, Geely, and other automakers.', recommendedChart: 'bar chart race',
    tags: ['BYD', 'Tesla', 'EVs', 'Automotive', 'Batteries', 'Sales'], aspectRatios: ['16:9', '9:16', '1:1'], defaultDurationSeconds: 90, previewColor: '#f59e0b',
    statsHook: { label: 'BYD annual deliveries', value: '3.8M units', delta: 'World #1 EV maker' }, viewMode: 'world', openPanel: 'video', paletteId: 'bikaner',
  },
  {
    id: 'india_clean_energy_states', title: 'India State-wise Solar & Wind Installed Capacity', category: 'Energy & Climate',
    description: 'Rajasthan, Gujarat, and Tamil Nadu lead India toward the 500 GW clean-energy milestone.', recommendedChart: 'grouped bar', geoScope: 'India',
    tags: ['Rajasthan', 'Gujarat', 'Tamil Nadu', 'Solar Park', '500 GW'], aspectRatios: ['16:9', '9:16', '1:1'], defaultDurationSeconds: 60, previewColor: '#eab308',
    statsHook: { label: 'Rajasthan clean capacity', value: '28.4 GW', delta: 'National leader' }, viewMode: 'india', openPanel: 'data', paletteId: 'bikaner',
    source: 'Source: MNRE, Government of India · CEA 2024 report', sampleRows: cleanEnergyRows, suffix: ' GW', decimals: 1, customColors: ['#fffbe6', '#fde68a', '#facc15', '#ca8a04', '#854d0e'],
  },
  {
    id: 'india_upi_digital_payments', title: 'India UPI: The World’s Largest Real-Time Payment Rail', category: 'Fintech',
    description: 'Monthly UPI transaction volume scaling past 15 billion transactions.', recommendedChart: 'line', geoScope: 'India',
    tags: ['UPI', 'Fintech', 'PhonePe', 'Google Pay', 'Digital India'], aspectRatios: ['16:9', '9:16', '1:1'], defaultDurationSeconds: 60, previewColor: '#06b6d4',
    statsHook: { label: 'Monthly UPI volume', value: '15.8B txns', delta: '$250B+ / month' }, viewMode: 'india', openPanel: 'data', featured: true, paletteId: 'jodhpur',
  },
  {
    id: 'central_bank_gold_reserves', title: 'Central Bank Gold Reserves & De-Dollarization', category: 'Fintech',
    description: 'Sovereign bullion accumulation by central banks including China, India, Poland, and Singapore.', recommendedChart: 'bar',
    tags: ['Gold Reserves', 'Central Banks', 'RBI', 'PBoC', 'De-Dollarization'], aspectRatios: ['16:9', '9:16', '1:1'], defaultDurationSeconds: 60, previewColor: '#fbbf24',
    statsHook: { label: 'Annual central-bank purchases', value: '1,000+ tonnes', delta: '50-year record' }, viewMode: 'world', openPanel: 'data', paletteId: 'bikaner',
  },
  {
    id: 'global_space_launches_satellites', title: 'Space Supremacy: Orbit Launches & Satellites (1970–2035)', category: 'Space',
    description: 'Active satellite constellation race across SpaceX, ISRO, NASA, and CNSA.', recommendedChart: 'streamgraph',
    tags: ['ISRO', 'SpaceX', 'NASA', 'Starlink', 'Satellites', 'Chandrayaan'], aspectRatios: ['16:9', '9:16', '1:1'], defaultDurationSeconds: 90, previewColor: '#8b5cf6',
    statsHook: { label: 'Active Starlink satellites', value: '6,500+', delta: 'Megaconstellation' }, viewMode: 'world', openPanel: 'video', paletteId: 'kolkata',
  },
  {
    id: 'global_population_pyramids', title: 'The Great Demographic Shift: 1950 to 2050', category: 'Demographics',
    description: 'Comparing demographic aging in East Asia with the relative youth of India and Africa.', recommendedChart: 'population pyramid',
    tags: ['Demographics', 'Population', 'Aging', 'Median Age', 'Fertility'], aspectRatios: ['16:9', '9:16', '1:1'], defaultDurationSeconds: 90, previewColor: '#ec4899',
    statsHook: { label: 'India median age', value: '28.2 years', delta: 'Demographic dividend' }, viewMode: 'world', openPanel: 'data', paletteId: 'jaipur',
  },
  {
    id: 'world_megacities_urbanization', title: 'Rise of Global Megacities (10M+ Population)', category: 'Demographics',
    description: 'Urban growth across Tokyo, Delhi, Shanghai, São Paulo, Cairo, Mumbai, and Dhaka.', recommendedChart: 'bubble',
    tags: ['Megacities', 'Urbanization', 'Tokyo', 'Delhi', 'Mumbai', 'São Paulo'], aspectRatios: ['16:9', '9:16', '1:1'], defaultDurationSeconds: 60, previewColor: '#3b82f6',
    statsHook: { label: 'Delhi metropolitan area', value: '33M people', delta: 'World #2 urban area' }, viewMode: 'world', openPanel: 'data', paletteId: 'bengaluru',
  },
];

function demoTemplate(
  id: string,
  title: string,
  collection: 'test-map' | 'test-infographic' | 'test-video',
  viewMode: 'world' | 'india' | 'usa' | 'china',
  category: InfographicCategory,
  demoMode: NonNullable<InfographicTemplate['demoMode']>,
  previewColor: string,
  paletteId: string,
  description: string,
): InfographicTemplate {
  const geoScope = viewMode === 'world' ? 'World' : viewMode === 'usa' ? 'USA' : viewMode[0].toUpperCase() + viewMode.slice(1);
  return {
    id,
    title,
    category,
    description,
    recommendedChart: collection === 'test-video' ? 'animated choropleth' : collection === 'test-map' ? 'choropleth map' : 'map data story',
    geoScope,
    tags: ['Demo test pack', geoScope, demoMode, 'Synthetic data'],
    aspectRatios: collection === 'test-infographic' ? ['4:5', '16:9', '1:1'] : ['16:9', '9:16', '1:1'],
    defaultDurationSeconds: collection === 'test-video' ? 8 : 60,
    previewColor,
    statsHook: collection === 'test-video'
      ? { label: 'Synthetic five-year timeline', value: '2020–2024', delta: 'Video test' }
      : { label: 'Synthetic test values', value: 'DEMO', delta: 'Replace before publishing' },
    viewMode,
    openPanel: collection === 'test-video' ? 'video' : 'data',
    collection,
    demoMode,
    source: 'Synthetic demo data generated from map regions · replace in Data before publishing',
    suffix: demoMode === 'percentage' ? '%' : demoMode === 'categorical' ? '' : ' pts',
    decimals: 0,
    paletteId,
    featured: true,
  };
}

export const testMapInfographicTemplates: InfographicTemplate[] = [
  demoTemplate('test_india_growth_index', 'India State Growth Index', 'test-map', 'india', 'Economics', 'index', '#5b6ee1', 'bengaluru', 'A state-by-state economic index test with complete synthetic coverage.'),
  demoTemplate('test_india_clean_share', 'India Clean Power Share', 'test-map', 'india', 'Energy & Climate', 'percentage', '#059669', 'kochi', 'A percentage choropleth test for every mapped Indian state and Union Territory.'),
  demoTemplate('test_india_digital_access', 'India Digital Access Index', 'test-map', 'india', 'Tech & AI', 'index', '#8b5cf6', 'kolkata', 'A technology-access test map with labels, legend, and editable state values.'),
  demoTemplate('test_india_region_types', 'India Regional Categories', 'test-map', 'india', 'Demographics', 'categorical', '#ef8a62', 'delhi', 'A categorical state map test using four clearly labelled demo groups.'),
  demoTemplate('test_usa_opportunity_index', 'USA State Opportunity Index', 'test-map', 'usa', 'Economics', 'index', '#3b82f6', 'bengaluru', 'A complete state and DC choropleth test using synthetic index values.'),
  demoTemplate('test_usa_clean_power_share', 'USA Clean Power Share', 'test-map', 'usa', 'Energy & Climate', 'percentage', '#10b981', 'kasol', 'A synthetic clean-power percentage test across all mapped US states and DC.'),
  demoTemplate('test_usa_region_types', 'USA Regional Categories', 'test-map', 'usa', 'Demographics', 'categorical', '#f59e0b', 'vizag', 'A categorical US map test for legends, selection, editing, and export.'),
  demoTemplate('test_china_development_index', 'China Province Development Index', 'test-map', 'china', 'Economics', 'index', '#6366f1', 'udaipur', 'A province-level development index test with synthetic editable values.'),
  demoTemplate('test_china_urban_access', 'China Urban Access Share', 'test-map', 'china', 'Demographics', 'percentage', '#06b6d4', 'jodhpur', 'A synthetic percentage choropleth across mapped province-level units.'),
  demoTemplate('test_china_region_types', 'China Regional Categories', 'test-map', 'china', 'Geopolitics', 'categorical', '#ec4899', 'jaipur', 'A categorical province-map test using four non-factual demo groups.'),
];

export const testGeneralInfographicTemplates: InfographicTemplate[] = [
  demoTemplate('test_story_global_opportunity', 'Global Opportunity Snapshot', 'test-infographic', 'world', 'Economics', 'index', '#3b82f6', 'bengaluru', 'A portrait-ready world data-story test with editable synthetic values.'),
  demoTemplate('test_story_climate_readiness', 'Climate Readiness Scorecard', 'test-infographic', 'world', 'Energy & Climate', 'percentage', '#10b981', 'kochi', 'A climate-themed infographic test for palette, legend, labels, and export.'),
  demoTemplate('test_story_technology_adoption', 'Technology Adoption Story', 'test-infographic', 'world', 'Tech & AI', 'index', '#8b5cf6', 'kolkata', 'A technology storyboard test with a headline, statistic, map, and source line.'),
  demoTemplate('test_story_urban_futures', 'Urban Futures Infographic', 'test-infographic', 'world', 'Demographics', 'percentage', '#06b6d4', 'jodhpur', 'A portrait infographic test for percentage labels and missing-data styling.'),
  demoTemplate('test_story_global_categories', 'Global Category Explorer', 'test-infographic', 'world', 'Geopolitics', 'categorical', '#f59e0b', 'vizag', 'A categorical story test using four synthetic groups across world geometry.'),
];

export const testVideoTemplates: InfographicTemplate[] = [
  demoTemplate('test_video_india_change', 'India Change Over Time · Video Test', 'test-video', 'india', 'Economics', 'time-series', '#5b6ee1', 'udaipur', 'A five-year animated choropleth with a camera storyboard and WebM recording.'),
];

export const testInfographicTemplates = [...testMapInfographicTemplates, ...testGeneralInfographicTemplates, ...testVideoTemplates];
export const infographicTemplates = [...libraryInfographicTemplates, ...testInfographicTemplates];

export const infographicCategories: Array<'All' | InfographicCategory> = ['All', 'Economics', 'Geopolitics', 'Tech & AI', 'Energy & Climate', 'Demographics', 'Fintech', 'Space'];

export function configForInfographicTemplate(template: InfographicTemplate): InfographicConfig {
  return {
    ...DEFAULT_INFOGRAPHIC_CONFIG,
    title: template.title,
    subtitle: template.description,
    source: template.source ?? `InfoGraphics library · ${template.id} · connect a verified dataset in Data`,
    note: `${template.statsHook.label}: ${template.statsHook.value}${template.statsHook.delta ? ` · ${template.statsHook.delta}` : ''}`,
    paletteId: template.paletteId ?? 'ladakh',
    customColors: template.customColors ?? [],
    scaleMode: 'continuous',
    labelMode: template.demoMode ? 'value' : template.sampleRows?.length ? 'both' : 'name',
    suffix: template.suffix ?? '',
    decimals: template.decimals ?? 0,
    numberFormat: 'metric',
    aspect: template.aspectRatios[0],
    showTitle: true,
    showLegend: true,
    showSource: true,
  };
}

export function rowsForInfographicTemplate(template: InfographicTemplate, features: GeoFeature[] = []): DataRow[] {
  if (template.sampleRows?.length) return template.sampleRows.map((row) => ({ ...row, raw: { ...row.raw } }));
  if (!template.demoMode || !features.length) return [];
  const regions = uniqueRegions(features);
  const years = template.demoMode === 'time-series' ? ['2020', '2021', '2022', '2023', '2024'] : [undefined];
  const categories = ['Group A', 'Group B', 'Group C', 'Group D'];
  return regions.flatMap((region, regionIndex) => years.map((year, yearIndex) => {
    const seed = stableSeed(`${template.id}:${region.parent}:${region.name}`);
    const value = template.demoMode === 'categorical'
      ? categories[seed % categories.length]
      : template.demoMode === 'percentage'
        ? 25 + seed % 71
        : 20 + seed % 71 + yearIndex * (2 + seed % 4);
    return {
      id: `${template.id}-${regionIndex + 1}-${year ?? 'single'}`,
      region: region.name,
      parent: region.parent || undefined,
      year,
      value,
      raw: { demo: true, region: region.name, value, year: year ?? null },
    } satisfies DataRow;
  }));
}

export function searchInfographicTemplates(query: string, category: 'All' | InfographicCategory = 'All', collection: 'All' | 'Library' | 'Demo test pack' = 'All') {
  const normalized = query.trim().toLowerCase();
  return infographicTemplates.filter((template) => {
    const categoryMatches = category === 'All' || template.category === category;
    const collectionMatches = collection === 'All' || (collection === 'Library' ? !template.collection || template.collection === 'library' : template.collection?.startsWith('test-'));
    const textMatches = !normalized || `${template.title} ${template.description} ${template.geoScope ?? ''} ${template.tags.join(' ')}`.toLowerCase().includes(normalized);
    return categoryMatches && collectionMatches && textMatches;
  });
}

function uniqueRegions(features: GeoFeature[]) {
  const regions = new Map<string, { name: string; parent: string }>();
  for (const feature of features) {
    const name = String(feature.properties.__name ?? '').trim();
    if (!name) continue;
    const parent = String(feature.properties.SCOPE_NAME ?? feature.properties.STATE_SCOPE ?? feature.properties.NAME_1 ?? '').trim();
    const key = `${parent.toLowerCase()}::${name.toLowerCase()}`;
    if (!regions.has(key)) regions.set(key, { name, parent });
  }
  return [...regions.values()];
}

function stableSeed(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  return hash;
}
