// The route text format of XIT ROUTEBURNS.
// One step per line, columns separated by tabs (or 2+ spaces), keyword first.
// Empty lines and lines that start with "#" are ignored.
//
//   route           Name
//   loop            on
//   waypoint        HRT       fuel 5    reactor 50    least jumps    gateways on
//   refuel          STL       0         all
//   unload fuel     FTL       0         all
//   load            DW        208       208
//   load            DW        0         all           retain 640
//   wait            1d 6h
//   load shipment
//   unload shipment

export type Amount = { all: true } | { units: number };

export type Tank = 'STL' | 'FTL';

export type RoutePreference = 'leastJumps' | 'shortestFtl';

export interface WaypointSettings {
  fuel?: number;
  reactor?: number;
  preference?: RoutePreference;
  gateways?: boolean;
}

export type RouteStep =
  | {
      type: 'load' | 'unload';
      material: string;
      min: Amount;
      max: Amount;
      retain?: number;
    }
  | { type: 'refuel'; tank: Tank; min: Amount; max: Amount; source: 'local' | 'ship' }
  | { type: 'unloadFuel'; tank: Tank; min: Amount; max: Amount }
  | { type: 'wait'; seconds: number }
  | { type: 'loadShipment' }
  | { type: 'unloadShipment' };

export interface RouteWaypoint {
  name: string;
  settings?: WaypointSettings;
  steps: RouteStep[];
}

export interface RouteText {
  routeName?: string;
  loop?: boolean;
  waypoints: RouteWaypoint[];
}

const stepTypes: Record<string, RouteStep['type']> = {
  load: 'load',
  unload: 'unload',
  refuel: 'refuel',
  unloadfuel: 'unloadFuel',
  wait: 'wait',
  loadshipment: 'loadShipment',
  loadshipments: 'loadShipment',
  unloadshipment: 'unloadShipment',
  unloadshipments: 'unloadShipment',
};

const allWords = ['all', 'all carried', 'capacity', 'cap', 'max'];

const tanks: Tank[] = ['STL', 'FTL'];

const maxWaitSeconds = 30 * 86400;

function splitColumns(line: string) {
  const columns = line.includes('\t') ? line.split('\t') : line.split(/\s{2,}/);
  return columns.map(x => x.trim()).filter(x => x !== '');
}

// "208" -> { units: 208 }, "all" or "capacity" -> { all: true }.
export function parseAmount(raw: string | undefined, lineNo: number, field: string): Amount {
  const value = (raw ?? '').trim().toLowerCase();
  if (allWords.includes(value)) {
    return { all: true };
  }
  if (/^\d+$/.test(value)) {
    return { units: Number(value) };
  }
  throw new Error(`line ${lineNo}: ${field} must be a whole number or "all", got "${raw}"`);
}

const durationUnits: Record<string, number> = { d: 86400, h: 3600, m: 60, s: 1 };

// "2d", "3h", "45m", "30s" and "1d 6h" -> seconds.
export function parseDuration(raw: string | undefined, lineNo: number) {
  const value = (raw ?? '').trim().toLowerCase();
  const pattern = /(\d+)\s*(d|h|m|s)/g;
  let total = 0;
  let found = false;
  for (const match of value.matchAll(pattern)) {
    found = true;
    total += Number(match[1]) * durationUnits[match[2]];
  }
  if (!found || value.replace(pattern, '').trim() !== '') {
    throw new Error(`line ${lineNo}: wait needs a duration like 2d, 3h, 45m, got "${raw}"`);
  }
  if (total > maxWaitSeconds) {
    throw new Error(`line ${lineNo}: wait is limited to 30 days`);
  }
  return total;
}

function parseSettings(columns: string[], lineNo: number) {
  const settings: WaypointSettings = {};
  for (const raw of columns) {
    const column = raw.trim().toLowerCase().replace(/\s+/g, ' ');
    const level = column.match(/^(fuel|reactor) (\d+) ?%?$/);
    const gateways = column.match(/^gateways (on|off)$/);
    if (level) {
      const value = Number(level[2]);
      if (value < 1 || value > 100) {
        throw new Error(`line ${lineNo}: ${level[1]} must be between 1 and 100, got ${value}`);
      }
      settings[level[1] as 'fuel' | 'reactor'] = value;
    } else if (column === 'least jumps') {
      settings.preference = 'leastJumps';
    } else if (column === 'shortest ftl' || column === 'shortest ftl route') {
      settings.preference = 'shortestFtl';
    } else if (gateways) {
      settings.gateways = gateways[1] === 'on';
    } else {
      throw new Error(
        `line ${lineNo}: unknown waypoint setting "${raw}" ` +
          '(fuel N, reactor N, least jumps, shortest ftl, gateways on/off)',
      );
    }
  }
  return settings;
}

function settingsColumns(settings: WaypointSettings) {
  const columns: string[] = [];
  if (settings.fuel !== undefined) {
    columns.push(`fuel ${settings.fuel}`);
  }
  if (settings.reactor !== undefined) {
    columns.push(`reactor ${settings.reactor}`);
  }
  if (settings.preference !== undefined) {
    columns.push(settings.preference === 'shortestFtl' ? 'shortest ftl' : 'least jumps');
  }
  if (settings.gateways !== undefined) {
    columns.push(`gateways ${settings.gateways ? 'on' : 'off'}`);
  }
  return columns;
}

// "fuel 5 %, reactor 50 %, least jumps, gateways on".
export function describeSettings(settings: WaypointSettings) {
  return settingsColumns(settings)
    .map(x => x.replace(/^(fuel|reactor) (\d+)$/, '$1 $2 %'))
    .join(', ');
}

function parseTank(raw: string | undefined, keyword: string, lineNo: number) {
  const tank = (raw ?? '').toUpperCase();
  if (!tanks.includes(tank as Tank)) {
    throw new Error(`line ${lineNo}: ${keyword} needs STL or FTL, got "${raw ?? ''}"`);
  }
  return tank as Tank;
}

function parseStep(type: RouteStep['type'], columns: string[], lineNo: number): RouteStep {
  const keyword = columns[0];
  switch (type) {
    case 'load':
    case 'unload': {
      const material = columns[1];
      if (!material || !/^[A-Z0-9]{1,4}$/.test(material)) {
        throw new Error(
          `line ${lineNo}: ${type} needs a material ticker (e.g. DW), got "${material ?? ''}"`,
        );
      }
      const step: Extract<RouteStep, { material: string }> = {
        type,
        material,
        min: parseAmount(columns[2] ?? '0', lineNo, 'minimum'),
        max: parseAmount(columns[3] ?? 'all', lineNo, 'maximum'),
      };
      const extra = columns.slice(4).join(' ');
      const retain = extra.toLowerCase().match(/^retain\s+(\d+)$/);
      if (extra !== '' && !retain) {
        throw new Error(`line ${lineNo}: unexpected "${extra}" (only "retain N" is allowed)`);
      }
      if (retain) {
        if (type !== 'load') {
          throw new Error(`line ${lineNo}: retain only exists on load steps`);
        }
        step.retain = Number(retain[1]);
      }
      return step;
    }
    case 'refuel': {
      const tank = parseTank(columns[1], keyword, lineNo);
      const source = (columns[4] ?? 'local').toLowerCase().replace(/\s*store$/, '');
      if (source !== 'local' && source !== 'ship') {
        throw new Error(`line ${lineNo}: fuel source must be "local" or "ship", got "${source}"`);
      }
      return {
        type,
        tank,
        min: parseAmount(columns[2] ?? '0', lineNo, 'minimum'),
        max: parseAmount(columns[3] ?? 'all', lineNo, 'maximum'),
        source,
      };
    }
    case 'unloadFuel':
      return {
        type,
        tank: parseTank(columns[1], keyword, lineNo),
        min: parseAmount(columns[2] ?? '0', lineNo, 'minimum'),
        max: parseAmount(columns[3] ?? 'all', lineNo, 'maximum'),
      };
    case 'wait':
      return { type, seconds: parseDuration(columns.slice(1).join(' '), lineNo) };
    default:
      return { type };
  }
}

function checkMinMax(step: RouteStep, lineNo: number) {
  if (!('min' in step)) {
    return;
  }
  if ('units' in step.min && 'units' in step.max && step.min.units > step.max.units) {
    throw new Error(
      `line ${lineNo}: minimum ${step.min.units} is bigger than maximum ${step.max.units}`,
    );
  }
}

export function parseRouteText(text: string): RouteText {
  const waypoints: RouteWaypoint[] = [];
  let current: RouteWaypoint | undefined;
  let routeName: string | undefined;
  let loop: boolean | undefined;

  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const trimmed = lines[i].trim();
    if (trimmed === '' || trimmed.startsWith('#')) {
      continue;
    }
    const columns = splitColumns(lines[i]);
    const key = columns[0].toLowerCase().replace(/[\s_-]/g, '');

    if (key === 'route') {
      routeName = columns.slice(1).join(' ');
      continue;
    }

    if (key === 'loop') {
      const value = (columns[1] ?? '').toLowerCase();
      if (value !== 'on' && value !== 'off') {
        throw new Error(`line ${lineNo}: loop must be "on" or "off", got "${columns[1] ?? ''}"`);
      }
      loop = value === 'on';
      continue;
    }

    if (key === 'waypoint') {
      if (!columns[1]) {
        throw new Error(`line ${lineNo}: waypoint needs a name`);
      }
      current = { name: columns[1], steps: [] };
      if (columns.length > 2) {
        current.settings = parseSettings(columns.slice(2), lineNo);
      }
      waypoints.push(current);
      continue;
    }

    const type = stepTypes[key];
    if (type === undefined) {
      throw new Error(`line ${lineNo}: unknown keyword "${columns[0]}"`);
    }
    if (current === undefined) {
      throw new Error(`line ${lineNo}: a step must come after a "waypoint" line`);
    }
    const step = parseStep(type, columns, lineNo);
    checkMinMax(step, lineNo);
    current.steps.push(step);
  }

  if (waypoints.length === 0) {
    throw new Error('no waypoint found');
  }

  const result: RouteText = { waypoints };
  if (routeName !== undefined) {
    result.routeName = routeName;
  }
  if (loop !== undefined) {
    result.loop = loop;
  }
  return result;
}

export function amountText(amount: Amount) {
  return 'all' in amount ? 'all' : String(amount.units);
}

// One readable line per step, used for previews and tests.
export function describeStep(step: RouteStep) {
  switch (step.type) {
    case 'load':
    case 'unload': {
      const verb = step.type === 'load' ? 'Load' : 'Unload';
      const retain = step.retain !== undefined ? ` retain ${step.retain}` : '';
      return `${verb} ${step.material} min ${amountText(step.min)} / max ${amountText(step.max)}${retain}`;
    }
    case 'refuel':
      return `Refuel ${step.tank} from ${step.source} store min ${amountText(step.min)} / max ${amountText(step.max)}`;
    case 'unloadFuel':
      return `Unload fuel ${step.tank} min ${amountText(step.min)} / max ${amountText(step.max)}`;
    case 'wait':
      return `Wait ${step.seconds}s`;
    case 'loadShipment':
      return 'Load shipment';
    case 'unloadShipment':
      return 'Unload shipment';
  }
}

const durationParts: [string, number][] = [
  ['d', 86400],
  ['h', 3600],
  ['m', 60],
  ['s', 1],
];

export function durationText(seconds: number) {
  const parts: string[] = [];
  for (const [unit, size] of durationParts) {
    if (seconds >= size) {
      parts.push(`${Math.floor(seconds / size)}${unit}`);
      seconds %= size;
    }
  }
  return parts.length > 0 ? parts.join(' ') : '0s';
}

function stepLine(step: RouteStep) {
  switch (step.type) {
    case 'load':
    case 'unload': {
      const columns = [step.type, step.material, amountText(step.min), amountText(step.max)];
      if (step.retain !== undefined) {
        columns.push(`retain ${step.retain}`);
      }
      return columns.join('\t');
    }
    case 'refuel': {
      const columns: string[] = ['refuel', step.tank, amountText(step.min), amountText(step.max)];
      if (step.source === 'ship') {
        columns.push('ship');
      }
      return columns.join('\t');
    }
    case 'unloadFuel':
      return ['unload fuel', step.tank, amountText(step.min), amountText(step.max)].join('\t');
    case 'wait':
      return `wait\t${durationText(step.seconds)}`;
    case 'loadShipment':
      return 'load shipment';
    case 'unloadShipment':
      return 'unload shipment';
  }
}

// The inverse of parseRouteText.
export function formatRouteText(route: RouteText) {
  const out: string[] = [];
  if (route.routeName) {
    out.push(`route\t${route.routeName}`);
  }
  if (route.loop !== undefined) {
    out.push(`loop\t${route.loop ? 'on' : 'off'}`);
  }
  for (const waypoint of route.waypoints) {
    if (out.length > 0) {
      out.push('');
    }
    const settings = waypoint.settings ? settingsColumns(waypoint.settings) : [];
    out.push([`waypoint\t${waypoint.name}`, ...settings].join('\t'));
    for (const step of waypoint.steps) {
      out.push(stepLine(step));
    }
  }
  return out.join('\n') + '\n';
}
