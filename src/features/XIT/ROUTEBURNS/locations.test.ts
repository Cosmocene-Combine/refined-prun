import { describe, expect, it } from 'vitest';
import { findLocation, locationOptions } from '@src/features/XIT/ROUTEBURNS/locations';

describe('locationOptions', () => {
  it('sorts station warehouses, then bases, then other warehouses', () => {
    const options = locationOptions([
      { name: 'Promitor', kind: 'base' },
      { name: 'Ashland', kind: 'warehouse' },
      { name: 'Hortus Station', kind: 'station' },
      { name: 'Avalon', kind: 'base' },
      { name: 'Antares Station', kind: 'station' },
    ]);
    expect(options).toEqual([
      { label: 'Antares Station Warehouse', value: 'Antares Station' },
      { label: 'Hortus Station Warehouse', value: 'Hortus Station' },
      { label: 'Avalon Base', value: 'Avalon' },
      { label: 'Promitor Base', value: 'Promitor' },
      { label: 'Ashland Warehouse', value: 'Ashland' },
    ]);
  });

  it('shows a name one time only and keeps the base', () => {
    const options = locationOptions([
      { name: 'Ashland', kind: 'warehouse' },
      { name: 'Ashland', kind: 'base' },
    ]);
    expect(options).toEqual([{ label: 'Ashland Base', value: 'Ashland' }]);
  });

  it('skips empty names', () => {
    expect(locationOptions([{ name: ' ', kind: 'base' }])).toEqual([]);
  });
});

describe('findLocation', () => {
  const options = locationOptions([{ name: 'Avalon', kind: 'base' }]);

  it('matches without case', () => {
    expect(findLocation(options, ' avalon ')?.value).toBe('Avalon');
  });

  it('returns undefined for an unknown or empty name', () => {
    expect(findLocation(options, 'Montem')).toBeUndefined();
    expect(findLocation(options, '')).toBeUndefined();
  });
});
