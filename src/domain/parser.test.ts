import { describe, expect, it } from 'vitest';
import { parseEditorCommand, parseMapRequest, viewModeFromRequest } from './parser';

describe('MapRequest parser', () => {
  it('resolves a state political request without sending raw text downstream', () => {
    const request = parseMapRequest('Make me a clickable political map of Uttarakhand assembly constituencies');
    expect(request.place).toBe('Uttarakhand');
    expect(request.entityType).toBe('assembly_constituency');
    expect(request.mapType).toBe('political');
    expect(request.interactionMode).toBe('interactive');
    expect(request.subdivision).toBe('assembly_constituency');
  });

  it('keeps Ramnagar scoped to its parent geography', () => {
    const request = parseMapRequest('Make me a map of Ramnagar, Uttarakhand');
    expect(request.place).toBe('Ramnagar');
    expect(request.parentGeography).toBe('Uttarakhand');
    expect(request.entityType).toBe('town');
    expect(request.viewport.fitEntity).toBe('Ramnagar');
  });

  it('recognizes tourism defaults and export intent', () => {
    const request = parseMapRequest('Create a tourism map of Ramnagar and export as PNG');
    expect(request.mapType).toBe('tourism');
    expect(request.layers).toContain('roads');
    expect(request.output).toBe('png');
  });

  it('recognizes a top-100 city ranking request as a city population map', () => {
    const request = parseMapRequest('Make a map of the top 100 cities in India');
    expect(request.entityType).toBe('city');
    expect(request.mapType).toBe('demographic');
    expect(request.layers).toEqual(['settlements']);
  });

  it('resolves NYC aliases as a global city place request', () => {
    const request = parseMapRequest('nyc map');
    expect(request.place).toBe('New York City');
    expect(request.parentGeography).toBe('United States');
    expect(request.entityType).toBe('city');
    expect(request.viewport.fitEntity).toBe('New York City');
  });

  it('routes every bundled country name to the world boundary layer', () => {
    expect(parseMapRequest('Make a map of Bangladesh')).toMatchObject({ place: 'Bangladesh', entityType: 'country' });
    expect(parseMapRequest('Show world countries')).toMatchObject({ entityType: 'country' });
  });

  it('routes India to the official India boundary layer', () => {
    const request = parseMapRequest('Make a map of India');
    expect(request).toMatchObject({ place: 'India', entityType: 'country' });
    expect(viewModeFromRequest(request)).toBe('india');
  });

  it('routes USA and China to their dedicated country boundary layers', () => {
    expect(viewModeFromRequest(parseMapRequest('Make a map of USA'))).toBe('usa');
    expect(viewModeFromRequest(parseMapRequest('Make a map of China'))).toBe('china');
    expect(viewModeFromRequest(parseMapRequest('Make a map of the United States'))).toBe('usa');
  });

  it('routes USA county, State House, and Congress requests to nationwide layers', () => {
    expect(viewModeFromRequest(parseMapRequest('Show USA county map'))).toBe('usa-counties');
    expect(viewModeFromRequest(parseMapRequest('Show USA MLA map'))).toBe('usa-state-house');
    expect(viewModeFromRequest(parseMapRequest('Show USA Congress map'))).toBe('usa-congress');
  });

  it('routes China administrative and congress context requests without inventing constituencies', () => {
    expect(viewModeFromRequest(parseMapRequest('Show China district map'))).toBe('china-prefectures');
    expect(viewModeFromRequest(parseMapRequest('Show China local congress map'))).toBe('china-counties');
    expect(viewModeFromRequest(parseMapRequest('Show China NPC map'))).toBe('china-npc');
  });

  it('routes India district-wise requests to the national district layer', () => {
    const request = parseMapRequest('Make an India district wise map');
    expect(request).toMatchObject({ place: 'India', parentGeography: 'India', entityType: 'district' });
    expect(viewModeFromRequest(request)).toBe('india-districts');
  });

  it('routes India MLA and MP requests to the nationwide election layers', () => {
    expect(viewModeFromRequest(parseMapRequest('Show India MLA map'))).toBe('india-assembly');
    expect(viewModeFromRequest(parseMapRequest('Show India MP seat map'))).toBe('india-parliament');
  });

  it('routes Delhi district and MLA requests to the dedicated drill-down layers', () => {
    expect(viewModeFromRequest(parseMapRequest('Show Delhi districts'))).toBe('delhi-districts');
    expect(viewModeFromRequest(parseMapRequest('Show Delhi assembly constituencies'))).toBe('delhi-assembly');
  });

  it('routes Jammu and Kashmir requests to the complete district map', () => {
    const request = parseMapRequest('Show Jammu and Kashmir districts');
    expect(request).toMatchObject({ place: 'Jammu and Kashmir', parentGeography: 'India', entityType: 'state' });
    expect(viewModeFromRequest(request)).toBe('jammu-kashmir');
    expect(viewModeFromRequest(parseMapRequest('Make a map of J&K'))).toBe('jammu-kashmir');
  });

  it('keeps arbitrary small-city requests in the generic place pipeline', () => {
    const request = parseMapRequest('Make a map of Kandy');
    expect(request.place).toBe('Kandy');
    expect(request.entityType).toBe('city');
    expect(request.parentGeography).toBeUndefined();
    expect(request.viewport.fitEntity).toBe('Kandy');
  });

  it('uses a place-context fallback for administrative areas without local fixtures', () => {
    const request = parseMapRequest('Show Maharashtra districts');
    expect(request).toMatchObject({ place: 'Maharashtra', parentGeography: 'India', entityType: 'district' });
    expect(viewModeFromRequest(request)).toBe('place');
  });
});

describe('editor command parser', () => {
  it('creates a typed filter for a margin threshold', () => {
    const command = parseEditorCommand('Highlight constituencies with victory margin below 5%');
    expect(command).toMatchObject({ type: 'set-filter' });
    expect(command && command.type === 'set-filter' ? command.filter.value : '').toBe('5%');
  });

  it('supports reversible layer actions', () => {
    expect(parseEditorCommand('Hide roads')).toEqual({ type: 'set-layer', layer: 'roads', visible: false });
    expect(parseEditorCommand('Show district boundaries')).toEqual({ type: 'set-view', viewMode: 'district' });
  });

  it('switches directly between Delhi district and MLA layers', () => {
    expect(parseEditorCommand('Show Delhi district boundaries')).toEqual({ type: 'set-view', viewMode: 'delhi-districts' });
    expect(parseEditorCommand('Show Delhi MLA seats')).toEqual({ type: 'set-view', viewMode: 'delhi-assembly' });
  });

  it('switches directly to nationwide MLA and MP map levels', () => {
    expect(parseEditorCommand('Show India MLA map')).toEqual({ type: 'set-view', viewMode: 'india-assembly' });
    expect(parseEditorCommand('Show MP map')).toEqual({ type: 'set-view', viewMode: 'india-parliament' });
  });

  it('switches directly between USA and China map levels', () => {
    expect(parseEditorCommand('Show USA county map')).toEqual({ type: 'set-view', viewMode: 'usa-counties' });
    expect(parseEditorCommand('Show USA Congress map')).toEqual({ type: 'set-view', viewMode: 'usa-congress' });
    expect(parseEditorCommand('Show China local congress map')).toEqual({ type: 'set-view', viewMode: 'china-counties' });
    expect(parseEditorCommand('Show China NPC map')).toEqual({ type: 'set-view', viewMode: 'china-npc' });
  });
});
