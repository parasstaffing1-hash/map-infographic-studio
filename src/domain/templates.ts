import type { ViewMode } from './types';

export type DistrictTemplate = {
  id: string;
  label: string;
  scope?: string;
  viewMode: Extract<ViewMode, 'india-districts' | 'jammu-kashmir' | 'district' | 'usa' | 'usa-counties' | 'usa-state-house' | 'usa-congress' | 'china' | 'china-prefectures' | 'china-counties' | 'china-npc'>;
  districtCount: number;
  metricLabel?: string;
  detail: string;
  command: string;
  featured?: boolean;
};

// These templates are backed by the bundled GeoJSON sources. State/UT scopes
// use the national district file, while the dedicated J&K and Uttarakhand
// views keep their existing, current fixtures.
const stateTemplates: DistrictTemplate[] = ([
  ['Andaman and Nicobar', 'AndamanandNicobar', 3],
  ['Andhra Pradesh', 'AndhraPradesh', 13],
  ['Arunachal Pradesh', 'ArunachalPradesh', 22],
  ['Assam', 'Assam', 27],
  ['Bihar', 'Bihar', 38],
  ['Chandigarh', 'Chandigarh', 1],
  ['Chhattisgarh', 'Chhattisgarh', 27],
  ['Dadra and Nagar Haveli', 'DadraandNagarHaveli', 1],
  ['Daman and Diu', 'DamanandDiu', 2],
  ['Goa', 'Goa', 2],
  ['Gujarat', 'Gujarat', 33],
  ['Haryana', 'Haryana', 21],
  ['Himachal Pradesh', 'HimachalPradesh', 15],
  ['Jharkhand', 'Jharkhand', 24],
  ['Karnataka', 'Karnataka', 30],
  ['Kerala', 'Kerala', 14],
  ['Lakshadweep', 'Lakshadweep', 1],
  ['Madhya Pradesh', 'MadhyaPradesh', 51],
  ['Maharashtra', 'Maharashtra', 36],
  ['Manipur', 'Manipur', 9],
  ['Meghalaya', 'Meghalaya', 10],
  ['Mizoram', 'Mizoram', 8],
  ['Nagaland', 'Nagaland', 11],
  ['NCT of Delhi', 'NCTofDelhi', 11],
  ['Odisha', 'Odisha', 30],
  ['Puducherry', 'Puducherry', 4],
  ['Punjab', 'Punjab', 22],
  ['Rajasthan', 'Rajasthan', 33],
  ['Sikkim', 'Sikkim', 4],
  ['Tamil Nadu', 'TamilNadu', 32],
  ['Telangana', 'Telangana', 10],
  ['Tripura', 'Tripura', 8],
  ['Uttar Pradesh', 'UttarPradesh', 75],
  ['West Bengal', 'WestBengal', 20],
] as const).map(([label, scope, districtCount]) => ({
  id: `districts-${scope}`,
  label,
  scope,
  viewMode: 'india-districts',
  districtCount,
  detail: `${districtCount} districts · India atlas`,
  command: `Show ${label} districts`,
}));

export const districtTemplates: DistrictTemplate[] = [
  {
    id: 'india-district-atlas',
    label: 'India district atlas',
    viewMode: 'india-districts',
    districtCount: 676,
    detail: '676 districts · national atlas',
    command: 'Make an India district wise map',
    featured: true,
  },
  {
    id: 'jammu-kashmir-districts',
    label: 'Jammu and Kashmir + Ladakh',
    viewMode: 'jammu-kashmir',
    districtCount: 20,
    detail: '20 J&K districts · official J&K + Ladakh outline',
    command: 'Show Jammu and Kashmir districts',
  },
  {
    id: 'uttarakhand-districts',
    label: 'Uttarakhand',
    viewMode: 'district',
    districtCount: 16,
    detail: '16 districts · dedicated map',
    command: 'Show Uttarakhand districts',
  },
  ...stateTemplates,
];

export const countryTemplates: DistrictTemplate[] = [
  {
    id: 'usa-boundary',
    label: 'USA',
    viewMode: 'usa',
    districtCount: 51,
    metricLabel: 'states/DC',
    detail: '51 states/DC · interactive Census map',
    command: 'Make a map of USA',
    featured: true,
  },
  {
    id: 'usa-counties',
    label: 'USA counties',
    viewMode: 'usa-counties',
    districtCount: 3144,
    metricLabel: 'counties',
    detail: '3,144 county equivalents · Census 2024',
    command: 'Show USA county map',
  },
  {
    id: 'usa-state-house',
    label: 'USA State House',
    viewMode: 'usa-state-house',
    districtCount: 4834,
    metricLabel: 'districts',
    detail: '4,834 lower-chamber districts · Census 2024',
    command: 'Show USA State House map',
  },
  {
    id: 'usa-congress',
    label: 'USA Congress',
    viewMode: 'usa-congress',
    districtCount: 436,
    metricLabel: 'districts',
    detail: '436 mapped districts · 119th Congress',
    command: 'Show USA Congress map',
  },
  {
    id: 'china-boundary',
    label: 'China',
    viewMode: 'china',
    districtCount: 33,
    metricLabel: 'units',
    detail: '33 province-level units · interactive map',
    command: 'Make a map of China',
    featured: true,
  },
  {
    id: 'china-prefectures',
    label: 'China prefectures',
    viewMode: 'china-prefectures',
    districtCount: 368,
    metricLabel: 'prefectures',
    detail: '368 prefecture-level units · administrative map',
    command: 'Show China prefecture map',
  },
  {
    id: 'china-counties',
    label: 'China local congress context',
    viewMode: 'china-counties',
    districtCount: 2421,
    metricLabel: 'counties',
    detail: '2,421 county-level units · not electoral polygons',
    command: 'Show China local congress map',
  },
  {
    id: 'china-npc',
    label: 'China NPC units',
    viewMode: 'china-npc',
    districtCount: 33,
    metricLabel: 'units',
    detail: '33 province-level context units · not constituency polygons',
    command: 'Show China NPC map',
  },
];

export function templateForScope(scope?: string) {
  return scope ? districtTemplates.find((template) => template.scope === scope) : undefined;
}
