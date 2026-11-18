import { describe, expect, it } from 'vitest';
import {
  describeSettings,
  describeStep,
  durationText,
  formatRouteText,
  parseAmount,
  parseDuration,
  parseRouteText,
} from './route-text';

const sample =
  [
    'route\tTest',
    'loop\ton',
    '',
    'waypoint\tHRT\tfuel 5\treactor 50\tleast jumps\tgateways on',
    'refuel\tSTL\t0\tall',
    'unload fuel\tFTL\t0\tall',
    'unload\tAL\t0\tall',
    'load\tDW\t208\t208',
    'load\tDW\t0\tall\tretain 640',
    'wait\t1d 6h',
    'load shipment',
    'unload shipment',
  ].join('\n') + '\n';

describe('parseRouteText', () => {
  it('reads every kind of line', () => {
    const route = parseRouteText(sample);
    expect(route.routeName).toBe('Test');
    expect(route.loop).toBe(true);
    expect(route.waypoints).toHaveLength(1);
    const waypoint = route.waypoints[0];
    expect(waypoint.name).toBe('HRT');
    expect(waypoint.settings).toEqual({
      fuel: 5,
      reactor: 50,
      preference: 'leastJumps',
      gateways: true,
    });
    expect(waypoint.steps.map(x => x.type)).toEqual([
      'refuel',
      'unloadFuel',
      'unload',
      'load',
      'load',
      'wait',
      'loadShipment',
      'unloadShipment',
    ]);
    expect(waypoint.steps[3]).toEqual({
      type: 'load',
      material: 'DW',
      min: { units: 208 },
      max: { units: 208 },
    });
    expect(waypoint.steps[4]).toMatchObject({ retain: 640 });
    expect(waypoint.steps[5]).toEqual({ type: 'wait', seconds: 108000 });
  });

  it('round-trips through formatRouteText', () => {
    expect(formatRouteText(parseRouteText(sample))).toBe(sample);
  });

  it('accepts columns separated by two spaces', () => {
    const route = parseRouteText('waypoint  HRT  fuel 5\nload  DW  10  20');
    expect(route.waypoints[0].settings).toEqual({ fuel: 5 });
    expect(route.waypoints[0].steps[0]).toMatchObject({ min: { units: 10 }, max: { units: 20 } });
  });

  it('ignores empty lines and comments', () => {
    const route = parseRouteText('# Comment\n\nwaypoint\tHRT\n  \n# Another\nload shipment');
    expect(route.waypoints[0].steps).toEqual([{ type: 'loadShipment' }]);
  });

  it('keeps Loop undefined when the text has no loop line', () => {
    expect(parseRouteText('waypoint\tHRT').loop).toBeUndefined();
    expect(parseRouteText('loop\toff\nwaypoint\tHRT').loop).toBe(false);
  });

  it('reads the ship fuel source', () => {
    const route = parseRouteText('waypoint\tHRT\nrefuel\tSTL\t0\tall\tship store');
    expect(route.waypoints[0].steps[0]).toMatchObject({ source: 'ship' });
  });

  it('uses defaults for the minimum and the maximum', () => {
    const route = parseRouteText('waypoint\tHRT\nunload\tAL');
    expect(route.waypoints[0].steps[0]).toMatchObject({ min: { units: 0 }, max: { all: true } });
  });

  it.each([
    ['', 'no waypoint found'],
    ['load\tDW', 'must come after'],
    ['waypoint\tHRT\nfoo', 'unknown keyword "foo"'],
    ['waypoint\tHRT\nload\tdw', 'needs a material ticker'],
    ['waypoint\tHRT\nload\tDW\t10\t5', 'bigger than maximum'],
    ['waypoint\tHRT\nrefuel\tXYZ', 'needs STL or FTL'],
    ['waypoint\tHRT\nunload\tDW\t0\tall\tretain 5', 'retain only exists on load steps'],
    ['waypoint\tHRT\nload\tDW\t0\tall\tfoo', 'only "retain N" is allowed'],
    ['waypoint\tHRT\nwait\t31d', 'limited to 30 days'],
    ['waypoint\tHRT\nwait\tsoon', 'needs a duration'],
    ['loop\tmaybe\nwaypoint\tHRT', 'loop must be "on" or "off"'],
    ['waypoint\tHRT\tfuel 0', 'between 1 and 100'],
    ['waypoint\tHRT\tfoo', 'unknown waypoint setting'],
    ['waypoint', 'waypoint needs a name'],
  ])('rejects %j', (text, message) => {
    expect(() => parseRouteText(text)).toThrow(message);
  });

  it('names the line of the error', () => {
    expect(() => parseRouteText('waypoint\tHRT\n\nfoo')).toThrow('line 3');
  });
});

describe('parseAmount', () => {
  it('reads numbers and the words for all', () => {
    expect(parseAmount('208', 1, 'minimum')).toEqual({ units: 208 });
    expect(parseAmount('Capacity', 1, 'maximum')).toEqual({ all: true });
    expect(parseAmount('all carried', 1, 'maximum')).toEqual({ all: true });
  });

  it('rejects other values', () => {
    expect(() => parseAmount('1.5', 4, 'minimum')).toThrow('line 4: minimum must be');
  });
});

describe('durations', () => {
  it('parses and formats', () => {
    expect(parseDuration('1h 30m', 1)).toBe(5400);
    expect(parseDuration('45s', 1)).toBe(45);
    expect(durationText(90)).toBe('1m 30s');
    expect(durationText(108000)).toBe('1d 6h');
    expect(durationText(0)).toBe('0s');
  });
});

describe('descriptions', () => {
  it('describes the waypoint settings', () => {
    expect(
      describeSettings({ fuel: 5, reactor: 50, preference: 'leastJumps', gateways: true }),
    ).toBe('fuel 5 %, reactor 50 %, least jumps, gateways on');
  });

  it('describes steps', () => {
    expect(
      describeStep({
        type: 'load',
        material: 'DW',
        min: { units: 0 },
        max: { all: true },
        retain: 640,
      }),
    ).toBe('Load DW min 0 / max all retain 640');
    expect(describeStep({ type: 'wait', seconds: 60 })).toBe('Wait 60s');
  });
});
