import { createMapRequest } from './mapRequest';
import { countryAliases, worldCountryNames } from './countries';
import type { EditorCommand, FilterSpec, MapRequest, ViewMode } from './types';

const knownPlaces = ['new york city', 'jammu and kashmir', 'jammu & kashmir', 'jammu kashmir', 'j&k', 'delhi', 'uttarakhand', 'nainital', 'ramnagar', 'dehradun', 'haridwar', 'almora', 'chamoli', 'tehri garhwal', 'nyc', 'new york', 'singapore', ...worldCountryNames.map((name) => name.toLowerCase()), ...Object.keys(countryAliases)];
const knownCountries = new Set([...worldCountryNames.map((name) => name.toLowerCase()), ...Object.keys(countryAliases)]);

function findPlace(query: string) {
  const lower = query.toLowerCase();
  const matches = knownPlaces.filter((place) => lower.includes(place));
  return matches.find((place) => place !== 'uttarakhand') ?? matches[0];
}

function canonicalPlace(place: string | undefined) {
  if (!place) return undefined;
  const normalized = place.toLowerCase().replace(/^the\s+/, '');
  if (normalized === 'nyc' || normalized === 'new york') return 'New York City';
  if (normalized === 'j&k' || normalized === 'jammu and kashmir' || normalized === 'jammu & kashmir' || normalized === 'jammu kashmir') return 'Jammu and Kashmir';
  if (countryAliases[normalized]) return countryAliases[normalized];
  const knownCountry = worldCountryNames.find((name) => name.toLowerCase() === normalized);
  if (knownCountry) return knownCountry;
  return titleCase(place);
}

function extractFreeformPlace(query: string) {
  const match = query.match(/(?:map\s+of|show|zoom\s+to)\s+(?:me\s+)?(?:a\s+)?(.+?)(?:\s+map)?[.!?]?$/i);
  if (!match) return undefined;
  const candidate = match[1].trim();
  if (/\b(districts?|assembly|constituencies|cities|political|election|roads|rivers|villages)\b/i.test(candidate)) return undefined;
  return candidate.length >= 2 ? candidate : undefined;
}

function extractScopedPlace(query: string) {
  const match = query.match(/(?:map\s+of|show)\s+(?:me\s+)?(?:a\s+)?(.+?)\s+(?:districts?|assembly(?:\s+constituencies?)?|constituencies|states?)(?:\s+map)?[.!?]?$/i);
  const candidate = match?.[1]?.trim();
  return candidate && candidate.length >= 2 ? candidate : undefined;
}

export function parseMapRequest(query: string): MapRequest {
  const lower = query.toLowerCase();
  const placeCandidate = canonicalPlace(findPlace(query) ?? extractScopedPlace(query) ?? extractFreeformPlace(query));
  const isUsaRequest = placeCandidate === 'USA';
  const isChinaRequest = placeCandidate === 'China';
  const isUsCounty = isUsaRequest && /count(?:y|ies)|district(?:s)?(?:\s+map)?/i.test(query);
  const isUsStateHouse = isUsaRequest && /state\s+(?:house|legislature|legislative)|\bmla\b/i.test(query);
  const isUsCongress = isUsaRequest && /congress(?:ional)?|\bmp\b/i.test(query);
  const isChinaPrefecture = isChinaRequest && /prefectures?|district(?:s)?(?:\s+map)?/i.test(query);
  const isChinaCounty = isChinaRequest && /count(?:y|ies)|local\s+(?:people'?s\s+)?congress|\bmla\b/i.test(query);
  const isChinaNpc = isChinaRequest && /\bnpc\b|national\s+people'?s\s+congress|\bmp\b/i.test(query);
  const isAssembly = /assembly|vidhan sabha|mla(?:\s+seats?)?|ac\b|constituenc(y|ies)/i.test(query);
  const isLokSabha = /lok sabha|parliamentary|mp\s+(?:seat|map)/i.test(query);
  const isTopCities = /top\s+100\s+cities|100\s+(?:largest|biggest|top)\s+cities|largest\s+cities/i.test(query);
  const isWorld = /\bworld\b|\bglobal\b.*\bmap\b|\bworld\s+countries\b/i.test(query);
  const place = isWorld && placeCandidate && !knownCountries.has(placeCandidate.toLowerCase()) ? undefined : placeCandidate;
  const isNewYork = /\bnyc\b|new york(?: city)?/i.test(query);
  const isJammuKashmir = /jammu\s*(?:and|&)\s*kashmir|jammu\s+kashmir|\bj&k\b/i.test(query);
  const isIndiaDistrictMap = /\bindia\b.*\bdistrict|\bdistrict.*\bindia\b/i.test(query);
  const isCountry = Boolean(place && knownCountries.has(place.toLowerCase()));
  const isPolitical = /political|election|party|winner|margin|turnout|constituenc|congress|legislatur|\bnpc\b/i.test(query);
  const isTourism = /tourism|tourist|travel|attraction/i.test(query);
  const isComparison = /compare|comparison|between\s+\d{4}/i.test(query);
  const output = /export\s+(?:as\s+)?png/i.test(query) ? 'png' : /export\s+(?:as\s+)?svg/i.test(query) ? 'svg' : 'interactive';
  const entityType = isTopCities ? 'city' : isUsCongress ? 'congressional_district' : isUsStateHouse ? 'state_legislative_district' : isUsCounty ? 'county' : isChinaNpc ? 'npc_electoral_unit' : isChinaCounty ? 'county' : isChinaPrefecture ? 'prefecture' : isIndiaDistrictMap ? 'district' : isLokSabha ? 'lok_sabha_constituency' : isAssembly ? 'assembly_constituency' : isWorld || isCountry ? 'country' : isNewYork ? 'city' : isJammuKashmir ? 'state' : lower.includes('district') ? 'district' : lower.includes('town') || lower.includes('city') ? 'town' : place === 'Ramnagar' ? 'town' : place ? 'city' : 'state';
  const isUttarakhandPlace = /\buttarakhand\b|\bnainital\b|\bramnagar\b|\bdehradun\b|\bharidwar\b|\balmora\b|\bchamoli\b|\btehri garhwal\b/i.test(query);
  const isAdministrativeRequest = isAssembly || isLokSabha || lower.includes('district') || lower.includes('state');
  const parentGeography = isNewYork ? 'United States' : isCountry && !isIndiaDistrictMap ? undefined : isIndiaDistrictMap ? 'India' : isJammuKashmir ? 'India' : place && place !== 'Uttarakhand' && isUttarakhandPlace ? 'Uttarakhand' : place && isAdministrativeRequest ? 'India' : undefined;
  const mapType = isTopCities ? 'demographic' : isComparison ? 'comparison' : isPolitical ? 'political' : isTourism ? 'tourism' : 'general';
  const timePeriod = query.match(/\b(20\d{2})\b/)?.[1];
  return createMapRequest(query, {
    place: place ?? undefined,
    parentGeography,
    entityType,
    mapType,
    subdivision: isUsCongress ? 'congressional_district' : isUsStateHouse ? 'state_legislative_district' : isUsCounty ? 'county' : isChinaNpc ? 'npc_electoral_unit' : isChinaCounty ? 'county' : isChinaPrefecture ? 'prefecture' : isLokSabha ? 'lok_sabha_constituency' : isAssembly ? 'assembly_constituency' : lower.includes('district') ? 'district' : undefined,
    style: isTopCities || isTourism ? 'presentation' : isPolitical ? 'political' : 'clean',
    output,
    timePeriod,
    layers: isTopCities ? ['settlements'] : isTourism ? ['boundaries', 'roads', 'water', 'settlements', 'pois'] : isPolitical ? ['boundaries', 'districts', 'political'] : ['auto'],
    viewport: place && place !== 'Uttarakhand' ? { fitEntity: place } : {},
  });
}

function titleCase(value: string) {
  return value.replace(/\b\w/g, (char) => char.toUpperCase());
}

export function parseEditorCommand(query: string): EditorCommand | null {
  const lower = query.toLowerCase();
  const margin = query.match(/margin\s+(?:under|below|less\s+than)\s+(\d+(?:\.\d+)?)\s*%?/i);
  if (margin) return { type: 'set-filter', filter: filterSpec('margin', '<', `${margin[1]}%`, `Margin < ${margin[1]}%`) };
  if (/turnout\s+(?:under|below|less\s+than).*average/i.test(lower)) return { type: 'set-filter', filter: filterSpec('turnout', '<', 'state-average', 'Turnout below state average') };
  if (/\b(?:usa|united states)\b/i.test(lower) && /state\s+(?:house|legislature|legislative)|\bmla\b/i.test(lower)) return { type: 'set-view', viewMode: 'usa-state-house' };
  if (/\b(?:usa|united states)\b/i.test(lower) && /congress(?:ional)?|\bmp\b/i.test(lower)) return { type: 'set-view', viewMode: 'usa-congress' };
  if (/\b(?:usa|united states)\b/i.test(lower) && /count(?:y|ies)|district\s+map/i.test(lower)) return { type: 'set-view', viewMode: 'usa-counties' };
  if (/\bchina\b/i.test(lower) && /\bnpc\b|national\s+people'?s\s+congress|\bmp\b/i.test(lower)) return { type: 'set-view', viewMode: 'china-npc' };
  if (/\bchina\b/i.test(lower) && /local\s+(?:people'?s\s+)?congress|count(?:y|ies)|\bmla\b/i.test(lower)) return { type: 'set-view', viewMode: 'china-counties' };
  if (/\bchina\b/i.test(lower) && /prefectures?|district\s+map/i.test(lower)) return { type: 'set-view', viewMode: 'china-prefectures' };
  if (/lok sabha|parliamentary|mp\s+(?:seat|map)/i.test(lower)) return { type: 'set-view', viewMode: 'india-parliament' };
  if (/\bdelhi\b/i.test(lower) && /districts?|district\s+boundar/i.test(lower)) return { type: 'set-view', viewMode: 'delhi-districts' };
  if (/\bdelhi\b/i.test(lower) && /assembly|mla\s+seats?|constituenc/i.test(lower)) return { type: 'set-view', viewMode: 'delhi-assembly' };
  if (/mla\s+(?:seat|map)|\bindia\b.*(?:assembly|constituenc)/i.test(lower)) return { type: 'set-view', viewMode: 'india-assembly' };
  if (/show\s+(district|districts)|district\s+boundar/i.test(lower)) return { type: 'set-view', viewMode: 'district' };
  if (/assembly|constituenc/i.test(lower)) return { type: 'set-view', viewMode: 'assembly' };
  if (/show\s+uttarakhand|state\s+view/i.test(lower)) return { type: 'set-view', viewMode: 'state' };
  if (/hide\s+roads/i.test(lower)) return { type: 'set-layer', layer: 'roads', visible: false };
  if (/show\s+roads/i.test(lower)) return { type: 'set-layer', layer: 'roads', visible: true };
  if (/change\s+selected.*(color|colour)|make.*selected.*(blue|red|green)/i.test(query)) {
    const color = lower.includes('red') ? '#dc6b65' : lower.includes('green') ? '#3da58c' : '#5b6ee1';
    return { type: 'select-color', color };
  }
  if (/zoom\s+to\s+ramnagar/i.test(lower)) return { type: 'fit-place', place: 'Ramnagar' };
  if (/presentation[- ]ready|presentation/i.test(lower)) return { type: 'presentation-ready' };
  if (/export\s+(?:this\s+)?map.*png|png/i.test(lower)) return { type: 'export', format: 'png' };
  return null;
}

function filterSpec(field: FilterSpec['field'], operator: FilterSpec['operator'], value: string, label: string): FilterSpec {
  return { id: `${field}-${value}`, field, operator, value, label, active: true };
}

export function viewModeFromRequest(request: MapRequest): ViewMode {
  if (request.place === 'USA' && request.entityType === 'county') return 'usa-counties';
  if (request.place === 'USA' && request.entityType === 'state_legislative_district') return 'usa-state-house';
  if (request.place === 'USA' && request.entityType === 'congressional_district') return 'usa-congress';
  if (request.place === 'China' && request.entityType === 'prefecture') return 'china-prefectures';
  if (request.place === 'China' && request.entityType === 'county') return 'china-counties';
  if (request.place === 'China' && request.entityType === 'npc_electoral_unit') return 'china-npc';
  if (request.place === 'India' && request.entityType === 'district') return 'india-districts';
  if (request.place === 'India' && request.entityType === 'assembly_constituency') return 'india-assembly';
  if (request.place === 'India' && request.entityType === 'lok_sabha_constituency') return 'india-parliament';
  if (request.place === 'Delhi' && request.entityType === 'district') return 'delhi-districts';
  if (request.place === 'Delhi' && request.entityType === 'assembly_constituency') return 'delhi-assembly';
  if (request.place === 'Jammu and Kashmir') return 'jammu-kashmir';
  if (request.entityType === 'country') {
    if (request.place === 'India') return 'india';
    if (request.place === 'USA') return 'usa';
    if (request.place === 'China') return 'china';
    return 'world';
  }
  if (request.entityType === 'city') return request.mapType === 'demographic' ? 'cities' : 'place';
  if (request.entityType === 'town') return 'place';
  if ((request.entityType === 'district' || request.entityType === 'county' || request.entityType === 'prefecture' || request.entityType === 'assembly_constituency' || request.entityType === 'lok_sabha_constituency' || request.entityType === 'state_legislative_district' || request.entityType === 'congressional_district' || request.entityType === 'npc_electoral_unit') && request.place && request.place !== 'Uttarakhand') return 'place';
  if (request.entityType === 'assembly_constituency') return 'assembly';
  if (request.entityType === 'district') return 'district';
  return 'state';
}
