import type { GeoFeature, GeoFeatureCollection, ProvenanceSource, ResolvedEntity, ViewMode } from './types';

export const sourceCatalog: ProvenanceSource[] = [
  { id: 'gadm-4.1', organization: 'GADM', reference: 'geodata.ucdavis.edu/gadm/gadm4.1', license: 'GADM license', quality: 'context-only' },
  { id: 'us-census-2024', organization: 'United States Census Bureau', reference: 'census.gov/geographies/mapping-files/time-series/geo/cartographic-boundary.html', license: 'Public-domain U.S. government work', quality: '2024 state and county cartographic boundaries' },
  { id: 'us-census-2024-sldl', organization: 'United States Census Bureau · State Legislative Districts', reference: 'census.gov/geographies/mapping-files/time-series/geo/cartographic-boundary.html', license: 'Public-domain U.S. government work', quality: '2024 lower-chamber state legislative district plans' },
  { id: 'us-census-2024-cd119', organization: 'United States Census Bureau · 119th Congress', reference: 'census.gov/programs-surveys/decennial-census/about/rdo/congressional-districts.119th_Congress.html', license: 'Public-domain U.S. government work', quality: '119th Congressional Districts, January 2025–2027' },
  { id: 'gadm-4.1-china-admin', organization: 'GADM · China administrative divisions', reference: 'geodata.ucdavis.edu/gadm/gadm4.1', license: 'GADM license', quality: 'province, prefecture, and county context clipped against the Survey of India outline' },
  { id: 'npc-china-admin-context', organization: 'National People’s Congress · administrative context', reference: 'npc.gov.cn/englishnpc/constitution2019', license: 'Legal reference with GADM administrative geometry', quality: 'province-level electoral-unit context; not constituency polygons' },
  { id: 'datameet-india-ac', organization: 'DataMeet', reference: 'github.com/datameet/maps/assembly-constituencies', license: 'CC BY 4.0', quality: 'open electoral boundary source' },
  { id: 'datameet-india-pc-2019', organization: 'DataMeet · 2019 parliamentary constituencies', reference: 'github.com/datameet/maps/parliamentary-constituencies', license: 'CC BY 4.0', quality: '543-seat 2019 Lok Sabha boundary source' },
  { id: 'nwic-gsi-districts', organization: 'National Water Data Portal · Geological Survey of India', reference: 'nwdp.nwic.gov.in/dataset/district-boundary', license: 'Government of India open-data resource; access terms apply', quality: 'May 2025 published vector with Delhi\'s 11 pre-reorganisation districts' },
  { id: 'ceo-delhi-ac-reference', organization: 'Chief Electoral Officer, Delhi', reference: 'ceodelhi.gov.in/AcListEng.aspx', license: 'Government of NCT of Delhi; access terms apply', quality: 'official reference list validating Delhi\'s 70 Assembly constituencies' },
  { id: 'osm-nominatim-ramnagar', organization: 'OpenStreetMap contributors', reference: 'nominatim.openstreetmap.org', license: 'ODbL', quality: 'place resolution context' },
  { id: 'osm-nominatim-global', organization: 'OpenStreetMap contributors', reference: 'nominatim.openstreetmap.org', license: 'ODbL', quality: 'global place resolution context' },
  { id: 'census-2011-city-dataset', organization: 'IndianCities dataset', reference: 'github.com/recurze/IndianCities', license: 'Open source repository; verify terms', quality: 'Census 2011-derived ranking fixture' },
  { id: 'natural-earth-world', organization: 'Natural Earth', reference: 'holtzy/D3-graph-gallery/DATA/world.geojson', license: 'Public domain derivative', quality: 'low-resolution world country context' },
  { id: 'survey-of-india-official', organization: 'Survey of India · Government of India', reference: 'surveyofindia.gov.in/documents/Outline_of_India.zip', license: 'Government of India; access terms apply', quality: 'official generalized India outline vector at 1:16M scale' },
  { id: 'survey-of-india-jk-ladakh', organization: 'Survey of India · J&K and Ladakh', reference: 'surveyofindia.gov.in/pages/geospatial-digital-data-register · github.com/AbhinavSwami28/india-official-geojson', license: 'Source-aligned public GeoJSON; verify against current Survey of India data', quality: 'separate current Union Territory outlines for J&K and Ladakh' },
];

export const DATA_URLS: Record<Exclude<ViewMode, 'place'>, string> = {
  world: '/data/world.json',
  india: '/data/india_states.json',
  usa: '/data/usa_states.json',
  china: '/data/china_provinces.json',
  'india-districts': '/data/india_districts.json',
  'india-assembly': '/data/india_assemblies.json',
  'india-parliament': '/data/india_parliament.json',
  'usa-counties': '/data/usa_counties.json',
  'usa-state-house': '/data/usa_state_house.json',
  'usa-congress': '/data/usa_congress.json',
  'china-prefectures': '/data/china_prefectures.json',
  'china-counties': '/data/china_counties.json',
  'china-npc': '/data/china_npc.json',
  'delhi-districts': '/data/delhi_districts.json',
  'delhi-assembly': '/data/delhi_assemblies.json',
  'jammu-kashmir': '/data/jammu_kashmir.json',
  state: '/data/uttarakhand.json',
  district: '/data/districts.json',
  assembly: '/data/assemblies.json',
  cities: '/data/cities_top_100.json',
};

export const OFFICIAL_INDIA_OUTLINE_URL = '/data/india_official.json';
export const JAMMU_KASHMIR_STATE_OUTLINE_URL = '/data/jammu_kashmir_state.json';

export async function loadFeatures(viewMode: ViewMode): Promise<GeoFeatureCollection> {
  if (viewMode === 'place') return { type: 'FeatureCollection', features: [] };
  if (viewMode === 'india') {
    const [response, jammuKashmirResponse] = await Promise.all([
      fetch(DATA_URLS.india),
      fetch(JAMMU_KASHMIR_STATE_OUTLINE_URL),
    ]);
    if (!response.ok) throw new Error('Could not load india boundary source');
    if (!jammuKashmirResponse.ok) throw new Error('Could not load the separate J&K and Ladakh boundaries');
    const raw = (await response.json()) as GeoFeatureCollection;
    const jammuKashmirUts = (await jammuKashmirResponse.json()) as GeoFeatureCollection;
    const states = raw.features
      .filter((feature) => String(feature.properties.NAME_1 ?? '') !== 'JammuandKashmir')
      .map((feature, index) => normalizeFeature(feature, viewMode, index));
    const unionTerritories = jammuKashmirUts.features.map((feature, index) => normalizeOfficialUtFeature(feature, index));
    return { ...raw, features: [...states, ...unionTerritories] };
  }
  if (viewMode === 'world') {
    const [response, officialIndiaResponse] = await Promise.all([
      fetch(DATA_URLS.world),
      fetch(OFFICIAL_INDIA_OUTLINE_URL),
    ]);
    if (!response.ok) throw new Error('Could not load world boundary source');
    if (!officialIndiaResponse.ok) throw new Error('Could not load the official India boundary for the world map');
    const raw = (await response.json()) as GeoFeatureCollection;
    const officialIndia = (await officialIndiaResponse.json()) as GeoFeatureCollection;
    const indiaFeature = officialIndia.features.find((feature) => {
      const name = String(feature.properties.name ?? feature.properties.Country ?? '').trim().toLowerCase();
      return name === 'india';
    });
    if (!indiaFeature) throw new Error('Official India boundary source did not contain an India feature');
    const worldWithoutNaturalEarthIndia = raw.features
      .filter((feature) => !isIndiaWorldFeature(feature))
      .map((feature, index) => normalizeFeature(feature, viewMode, index));
    return {
      ...raw,
      features: [...worldWithoutNaturalEarthIndia, normalizeOfficialWorldIndiaFeature(indiaFeature)],
    };
  }
  const response = await fetch(DATA_URLS[viewMode]);
  if (!response.ok) throw new Error(`Could not load ${viewMode} boundary source`);
  const raw = (await response.json()) as GeoFeatureCollection;
  return { ...raw, features: raw.features.map((feature, index) => normalizeFeature(feature, viewMode, index)) };
}

function isIndiaWorldFeature(feature: GeoFeature) {
  const name = String(feature.properties.name ?? feature.properties.ADMIN ?? '').trim().toLowerCase();
  return name === 'india' || String(feature.id ?? '').trim().toUpperCase() === 'IND';
}

function normalizeOfficialWorldIndiaFeature(feature: GeoFeature): GeoFeature {
  return {
    ...feature,
    id: 'world-india-official',
    properties: {
      ...feature.properties,
      __name: 'India',
      __district: '',
      __source: 'survey-of-india-official',
      __viewMode: 'world',
      __official: true,
      __officialIndia: true,
    },
  };
}

function normalizeOfficialUtFeature(feature: GeoFeature, index: number): GeoFeature {
  const name = String(feature.properties.NAME_1 ?? feature.properties.__name ?? `Union Territory ${index + 1}`);
  return {
    ...feature,
    id: `india-official-ut-${index}`,
    properties: {
      ...feature.properties,
      __name: name,
      __district: '',
      __source: 'survey-of-india-jk-ladakh',
      __viewMode: 'india',
      __officialUt: name,
    },
  };
}

function normalizeFeature(feature: GeoFeature, viewMode: ViewMode, index: number): GeoFeature {
  const props = feature.properties;
  const isUsaLevel = viewMode === 'usa' || viewMode === 'usa-counties' || viewMode === 'usa-state-house' || viewMode === 'usa-congress';
  const isChinaLevel = viewMode === 'china' || viewMode === 'china-prefectures' || viewMode === 'china-counties' || viewMode === 'china-npc';
  const isDistrict = viewMode === 'india-districts' || viewMode === 'usa-counties' || viewMode === 'china-prefectures' || viewMode === 'china-counties' || viewMode === 'delhi-districts' || viewMode === 'jammu-kashmir' || viewMode === 'district';
  const isAssembly = viewMode === 'assembly' || viewMode === 'delhi-assembly' || viewMode === 'india-assembly' || viewMode === 'usa-state-house';
  const isParliament = viewMode === 'india-parliament' || viewMode === 'usa-congress' || viewMode === 'china-npc';
  const name = viewMode === 'world' ? String(props.name ?? props.ADMIN ?? `Country ${index + 1}`) : viewMode === 'india' ? formatIndiaName(String(props.NAME_1 ?? props.name ?? `State ${index + 1}`)) : isUsaLevel || isChinaLevel ? String(props.DISPLAY_NAME ?? props.NAME ?? props.NAME_1 ?? `Region ${index + 1}`) : isDistrict ? String(props.NAME_2 ?? props.DIST_NAME ?? props.district ?? `District ${index + 1}`) : viewMode === 'cities' ? String(props.name ?? `City ${index + 1}`) : isAssembly ? String(props.AC_NAME ?? `Assembly ${index + 1}`) : isParliament ? String(props.PC_NAME ?? `Parliamentary constituency ${index + 1}`) : 'Uttarakhand';
  const district = viewMode === 'cities' ? String(props.district ?? '') : isAssembly ? String(props.DIST_NAME ?? '') : isDistrict ? name : '';
  const source = String(props.source ?? (viewMode === 'world' ? 'natural-earth-world' : viewMode === 'delhi-districts' ? 'nwic-gsi-districts' : viewMode === 'india' || viewMode === 'india-districts' || viewMode === 'jammu-kashmir' ? 'gadm-4.1' : viewMode === 'cities' ? 'census-2011-city-dataset' : isAssembly ? 'datameet-india-ac' : isParliament ? 'datameet-india-pc-2019' : 'gadm-4.1'));
  return {
    ...feature,
    id: `${viewMode}-${String(props.GEOID ?? props.GID_3 ?? props.GID_2 ?? props.GID_1 ?? props.AC_NO ?? props.PC_NO ?? props.dtcode ?? index)}-${index}`,
    properties: { ...props, __name: name, __district: district, __source: source, __viewMode: viewMode },
  };
}

function formatIndiaName(value: string) {
  const names: Record<string, string> = {
    AndamanandNicobar: 'Andaman and Nicobar',
    AndhraPradesh: 'Andhra Pradesh',
    ArunachalPradesh: 'Arunachal Pradesh',
    DadraandNagarHaveli: 'Dadra and Nagar Haveli',
    DamanandDiu: 'Daman and Diu',
    HimachalPradesh: 'Himachal Pradesh',
    JammuandKashmir: 'Jammu and Kashmir',
    MadhyaPradesh: 'Madhya Pradesh',
    NCTofDelhi: 'NCT of Delhi',
    TamilNadu: 'Tamil Nadu',
    UttarPradesh: 'Uttar Pradesh',
    WestBengal: 'West Bengal',
  };
  return names[value] ?? value;
}

export function featureToEntity(feature: GeoFeature): ResolvedEntity {
  const props = feature.properties;
  const viewMode = String(props.__viewMode);
  const entityType = viewMode === 'world' ? 'country' : viewMode === 'india' || viewMode === 'usa' || viewMode === 'china' ? 'state' : viewMode === 'usa-counties' ? 'county' : viewMode === 'china-prefectures' ? 'prefecture' : viewMode === 'china-counties' ? 'county' : viewMode === 'usa-state-house' ? 'state_legislative_district' : viewMode === 'usa-congress' ? 'congressional_district' : viewMode === 'china-npc' ? 'npc_electoral_unit' : viewMode === 'india-districts' || viewMode === 'delhi-districts' || viewMode === 'jammu-kashmir' || viewMode === 'district' ? 'district' : viewMode === 'cities' ? 'city' : viewMode === 'assembly' || viewMode === 'delhi-assembly' || viewMode === 'india-assembly' ? 'assembly_constituency' : viewMode === 'india-parliament' ? 'lok_sabha_constituency' : 'state';
  const electionParent = viewMode === 'india-assembly' || viewMode === 'india-parliament' ? formatIndiaName(String(props.STATE_SCOPE ?? 'India')) : undefined;
  const countryParent = viewMode.startsWith('usa') ? String(props.SCOPE_NAME ?? 'USA') : viewMode.startsWith('china') ? String(props.SCOPE_NAME ?? 'China') : undefined;
  return {
    id: String(feature.id),
    name: String(props.__name ?? 'Unknown entity'),
    entityType,
    parentName: electionParent ?? countryParent ?? (viewMode === 'world' ? 'World' : viewMode === 'delhi-districts' || viewMode === 'delhi-assembly' ? 'Delhi' : viewMode === 'india' || viewMode === 'india-districts' || viewMode === 'cities' ? 'India' : viewMode === 'jammu-kashmir' ? 'Jammu and Kashmir' : 'Uttarakhand'),
    districtName: String(props.__district || '') || undefined,
    sourceId: String(props.__source),
    confidence: 0.86,
    metadata: { official_id: (props.AC_NO ?? props.PC_NO ?? props.GEOID) as number | undefined, code: String(props.GEOID ?? props.GID_3 ?? props.GID_2 ?? props.DT_CODE ?? props.dtcode ?? props.PC_CODE ?? '') },
  };
}
