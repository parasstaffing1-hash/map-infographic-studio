import { DEFAULT_INFOGRAPHIC_CONFIG, type DataRow, type InfographicConfig, type InfographicPresentation } from './infographic';
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
  /** Mark bundled sample rows as source-backed instead of synthetic demo data. */
  dataQuality?: 'verified' | 'synthetic';
  /** Some dataset templates are complete stories and should load their bundled data on use. */
  alwaysUseSampleRows?: boolean;
  /** Composition to activate when this story is selected. */
  compositionId?: string;
  /** Prefix shown by the shared formatter, for example `$`. */
  prefix?: string;
  suffix?: string;
  decimals?: number;
  paletteId?: string;
  customColors?: string[];
  presentation?: InfographicPresentation;
  kicker?: string;
  labelMode?: InfographicConfig['labelMode'];
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

type GdpSeries = { region: string; chartLabel: string; code: string; values: Array<number | null> };

/**
 * World Bank WDI GDP (current US$), converted to trillion US dollars.
 * Values cover 1960–2024; 2025–2026 are transparent editorial extensions made
 * from each country's recent nominal trend so the video can reach the requested
 * end year without presenting forecasts as observed data.
 */
const GDP_TOP_15_SERIES: GdpSeries[] = [
  { region: 'USA', chartLabel: 'United States', code: 'USA', values: [0.542, 0.562, 0.604, 0.637, 0.684, 0.742, 0.813, 0.86, 0.94, 1.017, 1.073, 1.165, 1.279, 1.425, 1.545, 1.685, 1.873, 2.082, 2.352, 2.627, 2.857, 3.207, 3.344, 3.634, 4.038, 4.339, 4.58, 4.855, 5.236, 5.642, 5.963, 6.158, 6.52, 6.859, 7.287, 7.64, 8.073, 8.578, 9.063, 9.631, 10.251, 10.582, 10.929, 11.456, 12.217, 13.039, 13.816, 14.474, 14.77, 14.478, 15.049, 15.6, 16.254, 16.881, 17.608, 18.295, 18.805, 19.612, 20.657, 21.54, 21.375, 23.726, 26.055, 27.812, 29.298] },
  { region: 'China', chartLabel: 'China', code: 'CHN', values: [0.06, 0.05, 0.047, 0.051, 0.06, 0.071, 0.077, 0.073, 0.071, 0.08, 0.093, 0.1, 0.114, 0.139, 0.144, 0.164, 0.154, 0.175, 0.15, 0.179, 0.191, 0.196, 0.205, 0.231, 0.26, 0.31, 0.301, 0.273, 0.313, 0.348, 0.362, 0.385, 0.429, 0.447, 0.567, 0.738, 0.869, 0.968, 1.037, 1.104, 1.224, 1.355, 1.49, 1.684, 1.984, 2.318, 2.791, 3.604, 4.667, 5.19, 6.193, 7.672, 8.674, 9.743, 10.675, 11.281, 11.456, 12.538, 14.148, 14.56, 14.996, 18.202, 18.317, 18.27, 18.73] },
  { region: 'Germany', chartLabel: 'Germany', code: 'DEU', values: [0.085, 0.097, 0.106, 0.112, 0.123, 0.135, 0.143, 0.145, 0.157, 0.178, 0.217, 0.251, 0.301, 0.4, 0.447, 0.492, 0.522, 0.603, 0.743, 0.885, 0.954, 0.803, 0.779, 0.774, 0.728, 0.735, 1.05, 1.303, 1.406, 1.404, 1.778, 1.876, 2.141, 2.079, 2.215, 2.593, 2.507, 2.219, 2.248, 2.214, 1.967, 1.966, 2.102, 2.535, 2.852, 2.893, 3.046, 3.484, 3.808, 3.479, 3.467, 3.824, 3.596, 3.807, 3.965, 3.425, 3.537, 3.765, 4.055, 3.96, 3.941, 4.355, 4.201, 4.562, 4.686] },
  { region: 'Japan', chartLabel: 'Japan', code: 'JPN', values: [0.048, 0.058, 0.066, 0.076, 0.089, 0.099, 0.115, 0.135, 0.16, 0.188, 0.222, 0.251, 0.332, 0.451, 0.5, 0.544, 0.611, 0.753, 1.057, 1.101, 1.153, 1.271, 1.183, 1.298, 1.374, 1.457, 2.165, 2.635, 3.192, 3.175, 3.253, 3.725, 4.065, 4.632, 5.104, 5.64, 5.021, 4.58, 4.15, 4.689, 5.042, 4.439, 4.246, 4.573, 4.941, 4.876, 4.648, 4.625, 5.16, 5.337, 5.812, 6.279, 6.334, 5.272, 4.986, 4.534, 5.11, 5.038, 5.154, 5.246, 5.189, 5.226, 4.448, 4.385, 4.19] },
  { region: 'India', chartLabel: 'India', code: 'IND', values: [0.037, 0.039, 0.042, 0.048, 0.056, 0.06, 0.046, 0.05, 0.053, 0.058, 0.062, 0.067, 0.071, 0.086, 0.1, 0.098, 0.103, 0.121, 0.137, 0.153, 0.186, 0.193, 0.201, 0.218, 0.212, 0.233, 0.249, 0.279, 0.297, 0.296, 0.321, 0.27, 0.288, 0.279, 0.327, 0.36, 0.393, 0.416, 0.421, 0.459, 0.468, 0.485, 0.515, 0.608, 0.709, 0.82, 0.94, 1.217, 1.199, 1.342, 1.676, 1.823, 1.828, 1.857, 2.039, 2.104, 2.295, 2.651, 2.703, 2.836, 2.675, 3.167, 3.25, 3.501, 3.761] },
  { region: 'England', chartLabel: 'United Kingdom', code: 'GBR', values: [0.073, 0.078, 0.081, 0.087, 0.094, 0.102, 0.109, 0.113, 0.108, 0.116, 0.131, 0.148, 0.17, 0.193, 0.206, 0.242, 0.233, 0.263, 0.336, 0.439, 0.565, 0.541, 0.515, 0.49, 0.461, 0.489, 0.601, 0.745, 0.91, 0.927, 1.093, 1.143, 1.18, 1.061, 1.14, 1.349, 1.425, 1.569, 1.661, 1.693, 1.672, 1.656, 1.791, 2.061, 2.43, 2.551, 2.72, 3.105, 2.945, 2.429, 2.497, 2.676, 2.72, 2.797, 3.085, 2.946, 2.707, 2.699, 2.897, 2.876, 2.724, 3.195, 3.181, 3.421, 3.696] },
  { region: 'France', chartLabel: 'France', code: 'FRA', values: [0.062, 0.067, 0.075, 0.084, 0.093, 0.101, 0.109, 0.118, 0.129, 0.141, 0.147, 0.165, 0.202, 0.262, 0.283, 0.357, 0.368, 0.406, 0.502, 0.608, 0.695, 0.609, 0.578, 0.553, 0.525, 0.547, 0.765, 0.926, 1.011, 1.017, 1.258, 1.259, 1.39, 1.314, 1.386, 1.595, 1.599, 1.449, 1.497, 1.487, 1.361, 1.37, 1.492, 1.835, 2.11, 2.192, 2.318, 2.656, 2.927, 2.7, 2.646, 2.87, 2.683, 2.816, 2.861, 2.442, 2.47, 2.589, 2.782, 2.723, 2.648, 2.966, 2.795, 3.056, 3.16] },
  { region: 'Italy', chartLabel: 'Italy', code: 'ITA', values: [0.042, 0.047, 0.052, 0.06, 0.066, 0.071, 0.077, 0.084, 0.091, 0.101, 0.114, 0.125, 0.146, 0.176, 0.2, 0.228, 0.225, 0.258, 0.316, 0.395, 0.478, 0.432, 0.428, 0.444, 0.439, 0.453, 0.642, 0.808, 0.894, 0.931, 1.184, 1.249, 1.323, 1.067, 1.102, 1.177, 1.315, 1.245, 1.273, 1.255, 1.15, 1.172, 1.282, 1.583, 1.813, 1.865, 1.959, 2.223, 2.418, 2.209, 2.145, 2.307, 2.098, 2.153, 2.173, 1.845, 1.887, 1.971, 2.099, 2.02, 1.907, 2.179, 2.104, 2.317, 2.383] },
  { region: 'Canada', chartLabel: 'Canada', code: 'CAN', values: [0.041, 0.041, 0.042, 0.045, 0.05, 0.055, 0.061, 0.066, 0.072, 0.079, 0.088, 0.1, 0.113, 0.132, 0.161, 0.174, 0.207, 0.212, 0.219, 0.244, 0.275, 0.307, 0.315, 0.342, 0.357, 0.366, 0.379, 0.433, 0.509, 0.567, 0.596, 0.613, 0.594, 0.579, 0.58, 0.606, 0.631, 0.655, 0.634, 0.678, 0.745, 0.739, 0.761, 0.896, 1.027, 1.173, 1.319, 1.469, 1.553, 1.375, 1.617, 1.793, 1.828, 1.847, 1.806, 1.557, 1.528, 1.649, 1.725, 1.744, 1.656, 2.022, 2.201, 2.197, 2.27] },
  { region: 'Russia', chartLabel: 'Russian Federation', code: 'RUS', values: [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, 0.555, 0.507, 0.517, 0.518, 0.46, 0.435, 0.395, 0.396, 0.392, 0.405, 0.271, 0.196, 0.26, 0.307, 0.345, 0.43, 0.591, 0.764, 0.99, 1.3, 1.661, 1.223, 1.525, 2.046, 2.208, 2.292, 2.059, 1.363, 1.277, 1.574, 1.657, 1.693, 1.493, 1.829, 2.292, 2.046, 2.186] },
  { region: 'Brazil', chartLabel: 'Brazil', code: 'BRA', values: [0.017, 0.017, 0.019, 0.023, 0.021, 0.022, 0.028, 0.031, 0.034, 0.037, 0.042, 0.049, 0.058, 0.084, 0.11, 0.129, 0.153, 0.176, 0.2, 0.221, 0.237, 0.258, 0.271, 0.19, 0.188, 0.211, 0.256, 0.283, 0.308, 0.413, 0.385, 0.343, 0.328, 0.368, 0.525, 0.769, 0.85, 0.883, 0.864, 0.6, 0.655, 0.56, 0.51, 0.558, 0.669, 0.892, 1.108, 1.397, 1.696, 1.667, 2.209, 2.616, 2.465, 2.473, 2.456, 1.802, 1.796, 2.064, 1.917, 1.873, 1.476, 1.671, 1.952, 2.191, 2.186] },
  { region: 'South Korea', chartLabel: 'Korea, Rep.', code: 'KOR', values: [0.004, 0.002, 0.003, 0.004, 0.003, 0.003, 0.004, 0.005, 0.006, 0.008, 0.009, 0.01, 0.011, 0.014, 0.02, 0.022, 0.03, 0.039, 0.053, 0.068, 0.067, 0.074, 0.08, 0.09, 0.1, 0.104, 0.12, 0.152, 0.205, 0.254, 0.292, 0.341, 0.367, 0.406, 0.479, 0.586, 0.631, 0.589, 0.397, 0.516, 0.597, 0.568, 0.65, 0.729, 0.823, 0.972, 1.095, 1.221, 1.092, 0.983, 1.193, 1.307, 1.335, 1.435, 1.556, 1.539, 1.579, 1.71, 1.824, 1.751, 1.744, 1.942, 1.799, 1.845, 1.875] },
  { region: 'Mexico', chartLabel: 'Mexico', code: 'MEX', values: [0.013, 0.014, 0.015, 0.017, 0.02, 0.022, 0.024, 0.027, 0.029, 0.032, 0.036, 0.039, 0.045, 0.055, 0.072, 0.088, 0.089, 0.082, 0.103, 0.135, 0.206, 0.264, 0.185, 0.156, 0.184, 0.195, 0.135, 0.148, 0.182, 0.221, 0.261, 0.313, 0.363, 0.53, 0.554, 0.38, 0.432, 0.523, 0.557, 0.631, 0.742, 0.796, 0.811, 0.766, 0.819, 0.918, 1.02, 1.102, 1.162, 0.943, 1.105, 1.229, 1.255, 1.327, 1.365, 1.213, 1.112, 1.191, 1.256, 1.304, 1.121, 1.317, 1.467, 1.794, 1.83] },
  { region: 'Australia', chartLabel: 'Australia', code: 'AUS', values: [0.019, 0.02, 0.02, 0.022, 0.024, 0.026, 0.027, 0.03, 0.033, 0.037, 0.041, 0.045, 0.052, 0.064, 0.089, 0.097, 0.105, 0.111, 0.119, 0.135, 0.15, 0.177, 0.194, 0.178, 0.194, 0.181, 0.183, 0.19, 0.236, 0.3, 0.312, 0.326, 0.326, 0.313, 0.323, 0.369, 0.402, 0.436, 0.4, 0.39, 0.417, 0.38, 0.396, 0.469, 0.616, 0.697, 0.75, 0.857, 1.058, 0.932, 1.153, 1.403, 1.553, 1.584, 1.475, 1.357, 1.212, 1.331, 1.433, 1.398, 1.333, 1.561, 1.696, 1.734, 1.757] },
  { region: 'Spain', chartLabel: 'Spain', code: 'ESP', values: [0.012, 0.014, 0.017, 0.02, 0.022, 0.025, 0.03, 0.033, 0.032, 0.037, 0.041, 0.047, 0.059, 0.079, 0.097, 0.115, 0.118, 0.132, 0.16, 0.214, 0.233, 0.203, 0.196, 0.171, 0.172, 0.181, 0.251, 0.319, 0.376, 0.414, 0.536, 0.577, 0.63, 0.525, 0.53, 0.614, 0.642, 0.59, 0.619, 0.634, 0.598, 0.628, 0.709, 0.908, 1.07, 1.155, 1.262, 1.477, 1.636, 1.497, 1.428, 1.488, 1.331, 1.362, 1.38, 1.206, 1.243, 1.322, 1.432, 1.403, 1.29, 1.461, 1.449, 1.619, 1.726] },
];

const GDP_YEARS = Array.from({ length: 67 }, (_, index) => String(1960 + index));

const gdpValueAt = (series: GdpSeries, index: number) => {
  const observed = series.values[index];
  if (observed !== null && observed !== undefined) return { value: observed, projected: false };
  // Russia has no comparable World Bank series before 1990; keep those years
  // missing instead of backfilling them with a modern estimate.
  if (index < series.values.length) return null;
  const observedValues = series.values.filter((value): value is number => value !== null);
  const last = observedValues.at(-1) ?? 0;
  const previous = observedValues.at(-2) ?? last;
  const growth = Math.max(-0.06, Math.min(0.1, previous > 0 ? (last / previous) ** 0.5 - 1 : 0));
  return { value: Number((last * (1 + growth) ** (index - series.values.length + 1)).toFixed(3)), projected: true };
};

const gdpRows: DataRow[] = GDP_TOP_15_SERIES.flatMap((series) => GDP_YEARS.flatMap((year, index) => {
  const point = gdpValueAt(series, index);
  if (!point || point.value === 0) return [];
  return [{
    id: `world-gdp-top-15-${series.code}-${year}`,
    region: series.region,
    value: point.value,
    year,
    raw: { country: series.chartLabel, chartLabel: series.chartLabel, iso3: series.code, year, gdp_trillion_usd: point.value, projected: point.projected },
  } satisfies DataRow];
}));

const latestGdpValue = gdpRows.filter((row) => row.year === '2026').sort((first, second) => Number(second.value) - Number(first.value))[0]?.value ?? 0;

// Adapted from Tools/InfoGraphics. Keep this catalog source-aligned so both
// editors expose the same story ideas, labels, formats, and headline hooks.
export const libraryInfographicTemplates: InfographicTemplate[] = [
  {
    id: 'world_gdp_top_15_1960_2026',
    title: 'Top 15 Economies by GDP · 1960–2026',
    category: 'Economics',
    description: 'A five-minute animated world map and ranked bar race showing nominal GDP for the 15 largest economies across the full 1960–2026 timeline.',
    recommendedChart: 'map + ranked bar race',
    geoScope: 'World',
    tags: ['World', 'GDP', 'Top 15', 'Economies', '1960–2026', 'Bar race', 'Video'],
    aspectRatios: ['16:9', '9:16', '1:1'],
    defaultDurationSeconds: 300,
    previewColor: '#4356c9',
    statsHook: { label: 'Largest economy in the 2026 estimate', value: `$${Number(latestGdpValue).toFixed(1)}T`, delta: 'United States' },
    viewMode: 'world',
    openPanel: 'video',
    source: 'Source: World Bank WDI · GDP (current US$) through 2024 · 2025–2026 are editorial estimates based on recent nominal trend',
    sampleRows: gdpRows,
    dataQuality: 'verified',
    alwaysUseSampleRows: true,
    compositionId: 'world-gdp-race',
    prefix: '$',
    suffix: 'T',
    decimals: 2,
    paletteId: 'bengaluru',
    customColors: ['#eef2ff', '#c7d2fe', '#818cf8', '#4f46e5', '#312e81'],
    presentation: 'statista',
    kicker: 'WORLD · NOMINAL GDP · 1960–2026',
    labelMode: 'value',
    featured: true,
  },
  {
    id: 'india_clean_energy_transition_2024',
    title: 'India’s Clean-Energy Leaders',
    category: 'Energy & Climate',
    description: 'An editorial map story of selected state-level clean-power capacity, built for a feed, slide, or poster.',
    recommendedChart: 'map + bar + trend',
    geoScope: 'India',
    tags: ['India', 'Renewables', 'Solar', 'Wind', 'MNRE', 'Map'],
    aspectRatios: ['4:5', '16:9', '1:1'],
    defaultDurationSeconds: 60,
    previewColor: '#059669',
    statsHook: { label: 'Highest value in this editable sample', value: '28.4 GW', delta: 'Rajasthan' },
    viewMode: 'india',
    openPanel: 'data',
    featured: true,
    source: 'Source: MNRE, Government of India · CEA 2024 report',
    sampleRows: cleanEnergyRows,
    suffix: ' GW',
    decimals: 1,
    paletteId: 'kochi',
    customColors: ['#ecfdf5', '#a7f3d0', '#34d399', '#059669', '#047857'],
    presentation: 'editorial',
    kicker: 'INDIA · CLEAN ENERGY · 2024',
    labelMode: 'value',
  },
  {
    id: 'india_clean_energy_ranked_2024',
    title: 'India State-wise Clean Power Capacity',
    category: 'Energy & Climate',
    description: 'A publication-ready ranked map story with headline KPI, source line, and a top-state comparison panel.',
    recommendedChart: 'ranked bars + map',
    geoScope: 'India',
    tags: ['India', 'State ranking', 'Renewables', 'Clean energy', 'Statista-style', 'Map'],
    aspectRatios: ['4:5', '16:9', '1:1'],
    defaultDurationSeconds: 30,
    previewColor: '#1677b7',
    statsHook: { label: 'Highest installed capacity in sample', value: '28.4 GW', delta: 'Rajasthan' },
    viewMode: 'india',
    openPanel: 'data',
    featured: true,
    source: 'Source: MNRE, Government of India · CEA 2024 report',
    sampleRows: cleanEnergyRows,
    suffix: ' GW',
    decimals: 1,
    paletteId: 'jodhpur',
    customColors: ['#e7f3fa', '#b6d9ec', '#6eafd2', '#2f83b5', '#14577e'],
    presentation: 'statista',
    kicker: 'INDIA · STATE RANKING · 2024',
    labelMode: 'value',
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
    labelMode: template.labelMode ?? (template.demoMode ? 'value' : template.sampleRows?.length ? 'both' : 'name'),
    prefix: template.prefix ?? '',
    suffix: template.suffix ?? '',
    decimals: template.decimals ?? 0,
    numberFormat: 'metric',
    aspect: template.aspectRatios[0],
    showTitle: true,
    showLegend: true,
    showSource: true,
    presentation: template.presentation ?? 'standard',
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
