import { describe, expect, it } from 'vitest';
import { buildImportPlan, planKey, todoText, todoWhere } from './route-import-plan';
import type { RouteSnapshot } from './route-snapshot';
import { parseRouteText } from './route-text';

const refuel = {
  type: 'refuel',
  tank: 'STL',
  min: { units: 0 },
  max: { all: true },
  source: 'local',
} as const;

const current: RouteSnapshot = {
  loop: false,
  waypoints: [
    { name: 'Hortus Station (Hortus)', steps: [refuel] },
    { name: 'Krupp - Berthier (OF-375b)', steps: [] },
  ],
};

const text = [
  'loop\ton',
  'waypoint\tHRT',
  'refuel\tSTL\t0\tall',
  'unload\tAL\t0\tall',
  'waypoint\tOF-375b',
  'load\tDW\t10\t20',
  'waypoint\tOF-375c',
  'unload\tDW\t0\t5',
].join('\n');

describe('buildImportPlan', () => {
  it('keeps the steps that exist, adds the rest and adds missing waypoints at the end', () => {
    const plan = buildImportPlan(parseRouteText(text), current);
    expect(plan.todo.map(x => x.kind)).toEqual(['step', 'step', 'waypoint', 'step', 'loop']);
    expect(plan.todo.map(x => ('index' in x ? x.index : -1))).toEqual([0, 1, 2, 2, -1]);
    expect(plan.notes).toEqual([
      'Hortus Station (Hortus): 1 already there, 1 to add',
      'Krupp - Berthier (OF-375b): 0 already there, 1 to add',
      'OF-375c: waypoint to add (position 3, at the end), 1 step(s) to add',
    ]);
    expect(todoText(plan.todo[0])).toBe('Unload AL min 0 / max all');
    expect(todoText(plan.todo[2])).toBe('add the waypoint (search "OF-375c", position 3)');
    expect(todoText(plan.todo[4])).toBe('Loop on');
    expect(todoWhere(plan.todo[0])).toBe('Hortus Station (Hortus), step 2');
  });

  it('fixes a step of the right type with other values', () => {
    const changed: RouteSnapshot = {
      ...current,
      waypoints: [
        { name: 'Hortus Station (Hortus)', steps: [{ ...refuel, min: { units: 5 } }] },
        current.waypoints[1],
      ],
    };
    const plan = buildImportPlan(parseRouteText('waypoint\tHRT\nrefuel\tSTL\t0\tall'), changed);
    expect(plan.todo).toHaveLength(1);
    expect(plan.todo[0]).toMatchObject({ kind: 'step', fix: true, pos: 1 });
    expect(todoText(plan.todo[0])).toBe(
      'fix: "Refuel STL from local store min 5 / max all" -> "Refuel STL from local store min 0 / max all"',
    );
  });

  it('does nothing when the route is already complete', () => {
    const plan = buildImportPlan(
      parseRouteText('loop\toff\nwaypoint\tHRT\nrefuel\tSTL\t0\tall'),
      current,
    );
    expect(plan.todo).toEqual([]);
    expect(plan.notes).toContain('Loop: already off');
  });

  it('puts the settings before the steps of the waypoint', () => {
    const plan = buildImportPlan(
      parseRouteText('waypoint\tOF-375b\tfuel 5\nload\tDW\t10\t20'),
      current,
    );
    expect(plan.todo.map(x => x.kind)).toEqual(['settings', 'step']);
    expect(todoText(plan.todo[0])).toBe('settings: fuel 5 % (changed only if different)');
  });

  it('targets repeated places by index', () => {
    const twice: RouteSnapshot = {
      waypoints: [
        { name: 'Hortus Station (Hortus)', steps: [] },
        { name: 'Krupp - Berthier (OF-375b)', steps: [] },
        { name: 'Hortus Station (Hortus)', steps: [] },
      ],
    };
    const plan = buildImportPlan(
      parseRouteText(
        'waypoint\tHRT\nload shipment\nwaypoint\tOF-375b\nwaypoint\tHRT\nunload shipment',
      ),
      twice,
    );
    expect(plan.todo.map(x => ('index' in x ? x.index : -1))).toEqual([0, 2]);
    expect(plan.todo.map(x => x.display)).toEqual([
      'Hortus Station (Hortus) (waypoint 1)',
      'Hortus Station (Hortus) (waypoint 3)',
    ]);
  });

  it.each([
    [
      'waypoint\tHRT\nload\tDW\t1\t2',
      { ...current, waypoints: [{ name: 'Hortus Station (Hortus)', steps: [refuel] }] },
      'Delete this step in APEX',
    ],
    [
      'waypoint\tHRT',
      current,
      'already has 1 steps, the text only has 0: delete the extra steps in APEX',
    ],
    [
      'waypoint\tOF-375b\nwaypoint\tHRT\nrefuel\tSTL\t0\tall',
      current,
      "must be in the route's order",
    ],
    ['waypoint\tOF-375c\nwaypoint\tHRT', current, 'can only be added at the end'],
    [
      'loop\ton\nwaypoint\tHRT\nrefuel\tSTL\t0\tall',
      { waypoints: current.waypoints },
      'Loop not found',
    ],
  ])('refuses %j', (wantedText, snapshot, message) => {
    expect(() => buildImportPlan(parseRouteText(wantedText), snapshot as RouteSnapshot)).toThrow(
      message,
    );
  });

  it('refuses a step that APEX shows but the extension does not understand', () => {
    const unknown: RouteSnapshot = {
      waypoints: [{ name: 'Hortus Station (Hortus)', steps: [{ comment: '? Load Foo' }] }],
    };
    expect(() => buildImportPlan(parseRouteText('waypoint\tHRT\nload shipment'), unknown)).toThrow(
      'step 1: ? Load Foo',
    );
  });

  it('refuses a name that matches two different waypoints', () => {
    const two: RouteSnapshot = {
      waypoints: [
        { name: 'Krupp - A (OF-111a)', steps: [] },
        { name: 'Krupp - B (OF-222b)', steps: [] },
      ],
    };
    expect(() => buildImportPlan(parseRouteText('waypoint\tKrupp'), two)).toThrow(
      'matches 2 different waypoints',
    );
  });
});

describe('planKey', () => {
  it('is the same for the same plan and different when the plan changes', () => {
    const a = buildImportPlan(parseRouteText(text), current);
    const b = buildImportPlan(parseRouteText(text), current);
    const c = buildImportPlan(parseRouteText(text.replace('unload\tAL', 'unload\tDW')), current);
    expect(planKey(a)).toBe(planKey(b));
    expect(planKey(a)).not.toBe(planKey(c));
  });
});

describe('buildImportPlan route name', () => {
  it('names the route first when its name is different', () => {
    const plan = buildImportPlan(
      parseRouteText(text),
      { ...current, routeName: 'Unnamed route' },
      ' HRT->Krupp ',
    );
    expect(plan.todo[0]).toEqual({
      kind: 'name',
      display: 'Route name',
      pos: 0,
      name: 'HRT->Krupp',
    });
    expect(todoText(plan.todo[0])).toBe('name the route "HRT->Krupp"');
  });

  it('does not rename a route that already has the name', () => {
    const plan = buildImportPlan(
      parseRouteText(text),
      { ...current, routeName: 'HRT->Krupp' },
      'HRT->Krupp',
    );
    expect(plan.todo.some(x => x.kind === 'name')).toBe(false);
    expect(plan.notes[0]).toBe('Route name: already "HRT->Krupp"');
  });

  it('does not rename without a name', () => {
    const plan = buildImportPlan(parseRouteText(text), current, '  ');
    expect(plan.todo.some(x => x.kind === 'name')).toBe(false);
  });
});
