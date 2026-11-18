// What the route editor of APEX (the RT window) shows, as data.
// The summary line of a step is turned into a step again. These functions are pure.
import type { Amount, RouteStep, WaypointSettings } from '@src/features/XIT/ROUTEBURNS/route-text';

// A step that could not be understood becomes a comment with the reason.
export type SnapshotStep = RouteStep | { comment: string };

export interface SnapshotWaypoint {
  name: string;
  steps: SnapshotStep[];
  settings?: WaypointSettings;
}

export interface RouteSnapshot {
  routeName?: string;
  // Undefined means the route view has no Loop row.
  loop?: boolean;
  waypoints: SnapshotWaypoint[];
}

// Display name of a material in APEX -> ticker.
export type TickerLookup = (name: string) => string | undefined;

const stationNames = new Map([
  ['MOR', 'Moria Station'],
  ['HUB', 'Hubur Station'],
  ['ANT', 'Antares Station'],
  ['ARC', 'Arclight Station'],
  ['HRT', 'Hortus Station'],
  ['BEN', 'Benten Station'],
]);

export function stationName(code: string) {
  return stationNames.get(code.trim().toUpperCase());
}

function parseNumber(text: string) {
  return Number(text.replace(/[,\s]/g, ''));
}

// One side of an amount: "all carried", "capacity", "1 unit", "3,000 units".
function amountPart(part: string): Amount | undefined {
  if (/all carried|capacity/i.test(part)) {
    return { all: true };
  }
  const number = part.match(/\d[\d,]*/);
  return number ? { units: parseNumber(number[0]) } : undefined;
}

// Seen in APEX: "all carried", "capacity", "1 unit to 100 units", "100 units to capacity".
// "A to B" means minimum A and maximum B. APEX shows a minimum of 0 too ("0 units to 100 units").
// A single value means minimum = maximum.
export function amountsFromText(text: string): { min: Amount; max: Amount } {
  const parts = text.split(/\s+to\s+/i).map(amountPart);
  const [first, second] = parts;
  if (parts.length === 2 && first && second) {
    return { min: first, max: second };
  }
  if (parts.length === 1 && first) {
    return { min: { ...first }, max: first };
  }
  return { min: { units: 0 }, max: { all: true } };
}

const unitSeconds: Record<string, number> = { d: 86400, h: 3600, m: 60, s: 1 };

// The verb ("Load", "Refuel"...) and the rest of the summary line of a step.
export function summaryToStep(verb: string, rest: string, tickerOf: TickerLookup): SnapshotStep {
  switch (verb) {
    case 'Load':
    case 'Unload': {
      const [namePart, ...amountParts] = rest.split(',');
      const amount = amountParts.join(',');
      const name = namePart.trim();
      const ticker = tickerOf(name) ?? (/^[A-Z0-9]{1,4}$/.test(name) ? name : undefined);
      if (ticker === undefined) {
        return { comment: `? ${verb} ${rest}  (unknown material "${name}")` };
      }
      const step: Extract<RouteStep, { material: string }> = {
        type: verb === 'Load' ? 'load' : 'unload',
        material: ticker,
        ...amountsFromText(amount),
      };
      const retain = amount.match(/retain\D*(\d[\d,]*)/i);
      if (retain) {
        step.retain = parseNumber(retain[1]);
        Object.assign(step, amountsFromText(amount.replace(retain[0], '')));
      }
      return step;
    }
    case 'Refuel':
    case 'Unload fuel': {
      // "STL tank from local store, capacity".
      const tank = /FTL/i.test(rest) ? 'FTL' : 'STL';
      const amount = rest.includes(',') ? rest.slice(rest.lastIndexOf(',') + 1) : rest;
      const amounts = amountsFromText(amount);
      if (verb === 'Refuel') {
        return {
          type: 'refuel',
          tank,
          ...amounts,
          source: /ship store/i.test(rest) ? 'ship' : 'local',
        };
      }
      return { type: 'unloadFuel', tank, ...amounts };
    }
    case 'Wait': {
      let seconds = 0;
      const pattern = /(\d+)\s*(d|day|days|h|hour|hours|m|min|minutes?|s|sec|seconds?)\b/gi;
      for (const match of rest.matchAll(pattern)) {
        seconds += Number(match[1]) * unitSeconds[match[2][0].toLowerCase()];
      }
      return { type: 'wait', seconds };
    }
    case 'Load shipment':
    case 'Load shipments':
      return { type: 'loadShipment' };
    default:
      return { type: 'unloadShipment' };
  }
}

// What to type in "Enter location" for a waypoint written in the text:
//   "HRT" -> "Hortus Station", "Krupp - Adalina (OF-375c)" -> "OF-375c",
//   "Hortus Station (Hortus)" -> "Hortus Station", anything else as written.
export function locationQuery(wanted: string) {
  const text = wanted.trim();
  const station = stationName(text);
  if (station !== undefined) {
    return station;
  }
  const code = text.match(/\(([A-Z]{2}-\d{3}[a-z]?)\)\s*$/);
  if (code) {
    return code[1];
  }
  const named = text.match(/^(.+ Station)\s*\(/i);
  if (named) {
    return named[1];
  }
  return text.replace(/\s*\([^)]*\)\s*$/, '');
}

// Does a waypoint shown as `name` match the text's `wanted` (a part of its name, or a station code)?
export function matchesWaypoint(name: string, wanted: string) {
  const shown = name.toLowerCase();
  const part = wanted.trim().toLowerCase();
  const station = stationName(wanted);
  return shown.includes(part) || (station !== undefined && shown.includes(station.toLowerCase()));
}
