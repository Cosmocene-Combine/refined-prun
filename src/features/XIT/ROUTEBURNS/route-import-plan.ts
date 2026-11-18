// Compares the wanted route text with the route in APEX and lists what must be done.
// This is a pure function. The rules:
//   The steps that APEX has must be the START of the text: same order, same step types.
//   A step of the right type with other values is fixed (through its pencil window).
//   Only the steps after the existing ones are added.
//   A waypoint that is not in the route is added at its END. So it can only come after every
//   waypoint of the text that is already in the route.
//   "loop on" and "loop off" set Loop, last. The extension never deletes anything.
import {
  locationQuery,
  matchesWaypoint,
  type RouteSnapshot,
} from '@src/features/XIT/ROUTEBURNS/route-snapshot';
import {
  describeSettings,
  describeStep,
  type RouteStep,
  type RouteText,
  type WaypointSettings,
} from '@src/features/XIT/ROUTEBURNS/route-text';

// Every item that targets a waypoint has its index in the route. The same place can be in the route
// twice, so a name is not enough.
interface Target {
  waypoint: string;
  index: number;
  // The name shown to the user.
  display: string;
}

export type TodoItem =
  | (Target & { kind: 'waypoint'; pos: number; query: string })
  | (Target & { kind: 'settings'; pos: 0; settings: WaypointSettings })
  | (Target & { kind: 'step'; pos: number; step: RouteStep; fix?: boolean; was?: string })
  | { kind: 'loop'; display: string; pos: 0; on: boolean }
  | { kind: 'name'; display: string; pos: 0; name: string };

export interface ImportPlan {
  todo: TodoItem[];
  notes: string[];
}

// The routeName is the name that the route must have. Undefined or empty: the name is not changed.
export function buildImportPlan(
  wanted: RouteText,
  current: RouteSnapshot,
  routeName?: string,
): ImportPlan {
  const todo: TodoItem[] = [];
  const notes: string[] = [];
  const name = routeName?.trim() ?? '';
  if (name !== '') {
    if ((current.routeName ?? '').trim() !== name) {
      todo.push({ kind: 'name', display: 'Route name', pos: 0, name });
    } else {
      notes.push(`Route name: already "${name}"`);
    }
  }
  // The first text waypoint that is not in the route.
  let missingFrom: string | undefined;
  let newPos = current.waypoints.length;
  // Text waypoints are matched to route waypoints IN ORDER, so a route may visit the same place twice:
  // the 2nd "waypoint OF-375b" line is the 2nd Berthier.
  const used = new Set<number>();
  let last = -1;

  const repeated = (name: string) =>
    wanted.waypoints.filter(x => matchesWaypoint(name, x.name)).length > 1 ||
    current.waypoints.filter(x => x.name === name).length > 1;

  for (const waypoint of wanted.waypoints) {
    const matching = current.waypoints
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => matchesWaypoint(c.name, waypoint.name));
    const names = new Set(matching.map(({ c }) => c.name));
    if (names.size > 1) {
      throw new Error(
        `"${waypoint.name}" matches ${names.size} different waypoints: be more specific`,
      );
    }
    const next = matching.find(({ i }) => !used.has(i));

    if (!next) {
      missingFrom ??= waypoint.name;
      newPos++;
      const index = newPos - 1;
      const display = repeated(waypoint.name)
        ? `${waypoint.name} (waypoint ${newPos})`
        : waypoint.name;
      const target = { waypoint: waypoint.name, index, display };
      todo.push({ ...target, kind: 'waypoint', pos: newPos, query: locationQuery(waypoint.name) });
      if (waypoint.settings) {
        todo.push({ ...target, kind: 'settings', pos: 0, settings: waypoint.settings });
      }
      for (let k = 0; k < waypoint.steps.length; k++) {
        todo.push({ ...target, kind: 'step', pos: k + 1, step: waypoint.steps[k] });
      }
      notes.push(
        `${display}: waypoint to add (position ${newPos}, at the end), ` +
          `${waypoint.steps.length} step(s) to add`,
      );
      continue;
    }

    if (missingFrom !== undefined) {
      throw new Error(
        `"${missingFrom}" is not in the route but "${waypoint.name}" (after it in the text) ` +
          'already is: a waypoint can only be added at the end. Add it at the right place in RT, ' +
          'or change the order of the text.',
      );
    }
    if (next.i < last) {
      throw new Error(
        `"${waypoint.name}" comes after "${current.waypoints[last].name}" in the text but before ` +
          "it in the route: the waypoints of the text must be in the route's order",
      );
    }
    used.add(next.i);
    last = next.i;

    const index = next.i;
    const display = repeated(next.c.name) ? `${next.c.name} (waypoint ${index + 1})` : next.c.name;
    const target = { waypoint: waypoint.name, index, display };
    const have = next.c.steps;

    // Settings are only read when the import runs (it needs the pencil window): set if different.
    if (waypoint.settings) {
      todo.push({ ...target, kind: 'settings', pos: 0, settings: waypoint.settings });
    }

    let fixes = 0;
    for (let i = 0; i < have.length; i++) {
      const existing = have[i];
      if ('comment' in existing) {
        throw new Error(`${display}, step ${i + 1}: ${existing.comment}`);
      }
      if (i >= waypoint.steps.length) {
        throw new Error(
          `${display} already has ${have.length} steps, the text only has ` +
            `${waypoint.steps.length}: delete the extra steps in APEX`,
        );
      }
      const wantedStep = waypoint.steps[i];
      if (existing.type !== wantedStep.type) {
        throw new Error(
          `${display}, step ${i + 1}: APEX has "${describeStep(existing)}", the text has ` +
            `"${describeStep(wantedStep)}". Delete this step in APEX (the extension never deletes).`,
        );
      }
      if (describeStep(existing) !== describeStep(wantedStep)) {
        fixes++;
        todo.push({
          ...target,
          kind: 'step',
          pos: i + 1,
          step: wantedStep,
          fix: true,
          was: describeStep(existing),
        });
      }
    }
    for (let k = have.length; k < waypoint.steps.length; k++) {
      todo.push({ ...target, kind: 'step', pos: k + 1, step: waypoint.steps[k] });
    }
    notes.push(
      `${display}: ${have.length} already there, ${waypoint.steps.length - have.length} to add` +
        (fixes > 0 ? `, ${fixes} to fix` : ''),
    );
  }

  if (wanted.loop !== undefined) {
    if (current.loop === undefined) {
      throw new Error('Loop not found in the route: remove the loop line from the text');
    }
    if (current.loop !== wanted.loop) {
      todo.push({ kind: 'loop', display: 'Loop', pos: 0, on: wanted.loop });
    } else {
      notes.push(`Loop: already ${wanted.loop ? 'on' : 'off'}`);
    }
  }

  return { todo, notes };
}

export function todoText(item: TodoItem) {
  switch (item.kind) {
    case 'waypoint':
      return `add the waypoint (search "${item.query}", position ${item.pos})`;
    case 'loop':
      return `Loop ${item.on ? 'on' : 'off'}`;
    case 'name':
      return `name the route "${item.name}"`;
    case 'settings':
      return `settings: ${describeSettings(item.settings)} (changed only if different)`;
    case 'step':
      return item.fix
        ? `fix: "${item.was}" -> "${describeStep(item.step)}"`
        : describeStep(item.step);
  }
}

export function todoWhere(item: TodoItem) {
  return item.kind === 'step' ? `${item.display}, step ${item.pos}` : item.display;
}

// What the plan would do, as one string. It shows that the route changed since the preview.
export function planKey(plan: ImportPlan) {
  return plan.todo
    .map(x => {
      const index = 'index' in x ? x.index : '';
      const mode = x.kind === 'step' && x.fix ? 'fix' : 'add';
      return `${x.kind}|${index}|${x.display}|${x.pos}|${mode}|${todoText(x)}`;
    })
    .join('\n');
}
