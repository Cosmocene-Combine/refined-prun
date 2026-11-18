import { describe, expect, it } from 'vitest';
import {
  amountsFromText,
  locationQuery,
  matchesWaypoint,
  summaryToStep,
  TickerLookup,
} from './route-snapshot';

const names = new Map([
  ['Drinking Water', 'DW'],
  ['Basic Rations', 'RAT'],
]);
const tickerOf: TickerLookup = name => names.get(name);

describe('amountsFromText', () => {
  it('reads ranges', () => {
    expect(amountsFromText('1 unit to 100 units')).toEqual({
      min: { units: 1 },
      max: { units: 100 },
    });
    expect(amountsFromText(' 100 units to capacity')).toEqual({
      min: { units: 100 },
      max: { all: true },
    });
    expect(amountsFromText('0 units to 100 units')).toEqual({
      min: { units: 0 },
      max: { units: 100 },
    });
  });

  it('reads one value as minimum = maximum', () => {
    expect(amountsFromText('3,000 units')).toEqual({ min: { units: 3000 }, max: { units: 3000 } });
    expect(amountsFromText('all carried')).toEqual({ min: { all: true }, max: { all: true } });
    expect(amountsFromText(' capacity')).toEqual({ min: { all: true }, max: { all: true } });
  });

  it('falls back to 0 and all', () => {
    expect(amountsFromText('')).toEqual({ min: { units: 0 }, max: { all: true } });
  });
});

describe('summaryToStep', () => {
  it('reads Load and Unload with a material name', () => {
    expect(summaryToStep('Load', 'Drinking Water, 100 units to capacity', tickerOf)).toEqual({
      type: 'load',
      material: 'DW',
      min: { units: 100 },
      max: { all: true },
    });
    expect(summaryToStep('Unload', 'Basic Rations, all carried', tickerOf)).toEqual({
      type: 'unload',
      material: 'RAT',
      min: { all: true },
      max: { all: true },
    });
  });

  it('reads retain', () => {
    expect(
      summaryToStep('Load', 'Drinking Water, 0 units to all carried, retain 5 units', tickerOf),
    ).toEqual({
      type: 'load',
      material: 'DW',
      min: { units: 0 },
      max: { all: true },
      retain: 5,
    });
  });

  it('accepts a ticker and flags an unknown name', () => {
    expect(summaryToStep('Load', 'RAT, 10 units', tickerOf)).toMatchObject({ material: 'RAT' });
    const unknown = summaryToStep('Load', 'Foo Bar, 10 units', tickerOf);
    expect('comment' in unknown && unknown.comment).toContain('unknown material');
  });

  it('reads Refuel and Unload fuel', () => {
    expect(summaryToStep('Refuel', 'STL tank from local store, capacity', tickerOf)).toEqual({
      type: 'refuel',
      tank: 'STL',
      min: { all: true },
      max: { all: true },
      source: 'local',
    });
    expect(
      summaryToStep('Refuel', 'FTL tank from ship store, 100 units to capacity', tickerOf),
    ).toEqual({
      type: 'refuel',
      tank: 'FTL',
      min: { units: 100 },
      max: { all: true },
      source: 'ship',
    });
    expect(summaryToStep('Unload fuel', 'STL tank, 1 unit to all carried', tickerOf)).toEqual({
      type: 'unloadFuel',
      tank: 'STL',
      min: { units: 1 },
      max: { all: true },
    });
  });

  it('reads Wait and the shipments', () => {
    expect(summaryToStep('Wait', '1 day 6 hours', tickerOf)).toEqual({
      type: 'wait',
      seconds: 108000,
    });
    expect(summaryToStep('Wait', '90 minutes', tickerOf)).toEqual({ type: 'wait', seconds: 5400 });
    expect(summaryToStep('Load shipment', 'bound for a later waypoint', tickerOf)).toEqual({
      type: 'loadShipment',
    });
    expect(summaryToStep('Unload shipment', 'bound for this waypoint', tickerOf)).toEqual({
      type: 'unloadShipment',
    });
  });
});

describe('waypoint names', () => {
  it('works out what to type in Enter location', () => {
    expect(locationQuery('HRT')).toBe('Hortus Station');
    expect(locationQuery('Krupp - Adalina (OF-375c)')).toBe('OF-375c');
    expect(locationQuery('Hortus Station (Hortus)')).toBe('Hortus Station');
    expect(locationQuery('Curie')).toBe('Curie');
    expect(locationQuery('Name (Something)')).toBe('Name');
  });

  it('matches a part of the name or a station code', () => {
    expect(matchesWaypoint('Hortus Station (Hortus)', 'HRT')).toBe(true);
    expect(matchesWaypoint('Krupp - Berthier (OF-375b)', 'of-375b')).toBe(true);
    expect(matchesWaypoint('Krupp - Berthier (OF-375b)', 'HRT')).toBe(false);
  });
});
