// Route planning for XIT ROUTEBURNS. Pure functions: no DOM and no stores.
//
// The ship does a loop of T days through the waypoints in order. Each hub loads the supplies of
// the bases after it, up to the next hub, and unloads the production picked up since the last hub.
// For each base, per day:
//   net < 0 means the base uses it: the ship brings daily * T (plus a margin).
//   net > 0 means the base makes it: the ship waits for one tour of production (daily * T)
//   and takes it home.
// The stock in the base is not subtracted: the balance is per day.
//
// When the production orders are known (runs), the production part is counted in whole runs:
// the ship brings the inputs of N runs (no margin) and picks up the outputs of the same N runs.
// N comes from the production days, which can differ from the workforce days (balance mode).
// The workforce part of a ticker keeps the margin.
import type {
  RouteStep,
  RouteText,
  WaypointSettings,
} from '@src/features/XIT/ROUTEBURNS/route-text';

export interface Rate {
  ticker: string;
  daily: number;
}

// One production order of a line. perDay is how many times the line completes it per day.
export interface Run {
  perDay: number;
  inputs: Qty[];
  outputs: Qty[];
}

export interface BaseRates {
  name: string;
  naturalId?: string;
  uses: Rate[];
  makes: Rate[];
  // The production orders. Undefined: everything uses the daily rates.
  runs?: Run[];
  // Workforce use per day of each ticker. Only set with runs.
  workforce?: Record<string, number>;
}

export interface Qty {
  ticker: string;
  qty: number;
}

export interface BaseBill {
  name: string;
  // Supplies to unload at the base.
  items: Qty[];
  // Production to wait for and load at the base.
  pickups: Qty[];
  // Balance mode only: the base keeps this much of its supplies.
  retains: Qty[];
  // A hub: the ship refuels, unloads everything and loads the supplies of the next segment.
  hub?: boolean;
}

export interface BurnRow {
  input: number;
  output: number;
  workforce: number;
  dailyAmount: number;
}

// The part of PlanetBurn (src/core/burn.ts) that this feature needs.
export interface PlanetBurnLike {
  planetName: string;
  naturalId: string;
  burn: Record<string, BurnRow>;
  runs?: Run[];
}

// The part of PrunApi.ProductionLine that this feature needs.
export interface LineLike {
  capacity: number;
}

export interface OrderLike {
  duration: { millis: number } | null;
  inputs: { material: { ticker: string }; amount: number }[];
  outputs: { material: { ticker: string }; amount: number }[];
}

// Production lines -> runs. Same cycle as the burn (src/core/burn.ts): the line does its orders
// one after the other, capacity at a time.
export function runsFromLines<L extends LineLike>(
  lines: L[],
  getOrders: (line: L) => OrderLike[],
): Run[] {
  const result: Run[] = [];
  for (const line of lines) {
    const orders = getOrders(line);
    let cycleDays = 0;
    for (const order of orders) {
      cycleDays += (order.duration?.millis ?? Infinity) / 86400000;
    }
    if (!(cycleDays > 0) || !Number.isFinite(cycleDays)) {
      continue;
    }
    const perDay = line.capacity / cycleDays;
    for (const order of orders) {
      result.push({
        perDay,
        inputs: order.inputs.map(x => ({ ticker: x.material.ticker, qty: x.amount })),
        outputs: order.outputs.map(x => ({ ticker: x.material.ticker, qty: x.amount })),
      });
    }
  }
  return result;
}

export type SizeOf = (ticker: string) => { weight: number; volume: number } | undefined;

export interface Size {
  weight: number;
  volume: number;
  // Tickers without a known size. They are not counted.
  missing: string[];
}

export interface Leg {
  from: string;
  to: string;
  // Index of the hub of the segment of this leg.
  segment: number;
  weight: number;
  volume: number;
}

export const margin = 1.05;

// Room kept free (t and m3) by the balance mode. The max mode keeps none.
export const balanceFree = 50;

export const waypointSettings: WaypointSettings = {
  fuel: 5,
  reactor: 50,
  preference: 'leastJumps',
  gateways: true,
};

const epsilon = 1e-9;
const fitStep = 0.01;
export const fitMax = 999;

// Burn of the bases -> what each base uses and makes per day.
// Each base chooses its materials with the EDIT list (see withoutOff).
export function ratesFromBurn(planets: PlanetBurnLike[]): BaseRates[] {
  const result: BaseRates[] = [];
  for (const planet of planets) {
    const uses: Rate[] = [];
    const makes: Rate[] = [];
    for (const [ticker, row] of Object.entries(planet.burn)) {
      const daily = row.dailyAmount;
      if (!Number.isFinite(daily) || daily === 0) {
        continue;
      }
      if (daily < 0) {
        uses.push({ ticker, daily: -daily });
      } else {
        makes.push({ ticker, daily });
      }
    }
    if (uses.length === 0 && makes.length === 0) {
      continue;
    }
    const base: BaseRates = { name: planet.planetName, naturalId: planet.naturalId, uses, makes };
    if (planet.runs !== undefined) {
      base.runs = planet.runs;
      base.workforce = {};
      for (const [ticker, row] of Object.entries(planet.burn)) {
        if (row.workforce > 0) {
          base.workforce[ticker] = row.workforce;
        }
      }
    }
    result.push(base);
  }
  return result;
}

// Natural id of a base -> the tickers that are off for that base.
export type OffMaterials = Record<string, string[]>;

// The key of a base in OffMaterials. The natural id does not change when a waypoint is renamed.
export const baseKey = (base: BaseRates) => base.naturalId ?? base.name;

// Removes the materials that are off for each base: the ship neither brings them nor picks them up.
// The production runs stay the same: an input that is off comes from somewhere else.
export function withoutOff(rates: BaseRates[], off: OffMaterials): BaseRates[] {
  return rates.map(base => {
    const list = off[baseKey(base)];
    if (list === undefined || list.length === 0) {
      return base;
    }
    const isOn = (x: Rate) => !list.includes(x.ticker);
    return { ...base, uses: base.uses.filter(isOn), makes: base.makes.filter(isOn) };
  });
}

// Units of each ticker that the production uses and makes in whole runs over the days.
// The same number of runs for the inputs and the outputs keeps the recipe ratio.
function productionUnits(runs: Run[], days: number) {
  const used = new Map<string, number>();
  const made = new Map<string, number>();
  for (const run of runs) {
    const count = Math.floor(run.perDay * days + epsilon);
    if (count < 1) {
      continue;
    }
    for (const x of run.inputs) {
      used.set(x.ticker, (used.get(x.ticker) ?? 0) + x.qty * count);
    }
    for (const x of run.outputs) {
      made.set(x.ticker, (made.get(x.ticker) ?? 0) + x.qty * count);
    }
  }
  return { used, made };
}

// Whole numbers. Supplies round up (never starve a base). The production to wait for rounds down.
// days is for the workforce. prodDays is for the production (whole runs, see the top comment).
export function tourBill(
  rates: BaseRates[],
  days: number,
  billMargin = margin,
  keepDays = 0,
  prodDays = days,
): BaseBill[] {
  const result: BaseBill[] = [];
  if (!(days > 0)) {
    return result;
  }
  for (const rate of rates) {
    let items: Qty[];
    let pickups: Qty[];
    if (rate.runs === undefined) {
      items = rate.uses.map(x => ({
        ticker: x.ticker,
        qty: Math.ceil(x.daily * days * billMargin - epsilon),
      }));
      pickups = rate.makes.map(x => ({
        ticker: x.ticker,
        qty: Math.floor(x.daily * days + epsilon),
      }));
    } else {
      const { used, made } = productionUnits(rate.runs, prodDays);
      const workforce = rate.workforce ?? {};
      const net = (ticker: string) => (used.get(ticker) ?? 0) - (made.get(ticker) ?? 0);
      // Production part exact, workforce part with the margin.
      items = rate.uses.map(x => ({
        ticker: x.ticker,
        qty: Math.ceil(net(x.ticker) + (workforce[x.ticker] ?? 0) * days * billMargin - epsilon),
      }));
      // What the runs make, less what the base uses itself while they run.
      pickups = rate.makes.map(x => ({
        ticker: x.ticker,
        qty: Math.floor(-net(x.ticker) - (workforce[x.ticker] ?? 0) * prodDays + epsilon),
      }));
    }
    items = items.filter(x => x.qty >= 1);
    pickups = pickups.filter(x => x.qty >= 1);
    const retains =
      keepDays > 0
        ? rate.uses
            .map(x => ({ ticker: x.ticker, qty: Math.ceil(x.daily * keepDays - epsilon) }))
            .filter(x => x.qty >= 1)
        : [];
    if (items.length > 0 || pickups.length > 0) {
      result.push({ name: rate.name, items, pickups, retains });
    }
  }
  return result;
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Which base does a waypoint of the list mean? "Curie", "OZ-189c" or "Hypatia - Curie (OZ-189c)".
// The longest name found as a whole word wins. Undefined means a plain waypoint without burn data.
export function matchBase(rates: BaseRates[], waypointName: string) {
  const wanted = waypointName.trim().toLowerCase();
  if (wanted === '') {
    return undefined;
  }
  let best: BaseRates | undefined;
  let bestLength = 0;
  for (const rate of rates) {
    for (const candidate of [rate.name, rate.naturalId]) {
      if (candidate === undefined || candidate === '') {
        continue;
      }
      const name = candidate.toLowerCase();
      const pattern = new RegExp(`(^|[^a-z0-9])${escapeRegExp(name)}([^a-z0-9]|$)`);
      if ((wanted === name || pattern.test(wanted)) && name.length > bestLength) {
        best = rate;
        bestLength = name.length;
      }
    }
  }
  return best;
}

// The bill for a list of waypoints in the order the ship visits them. The same place may come twice.
// The supplies (and retains) of a base go off at its FIRST visit. Its production is picked up at its
// LAST visit. A waypoint without burn data stays in the list with nothing to do.
// hubs[i] marks waypoint i as a hub. A hub has no burn, also when it is one of the bases.
// prodDays is for the production; missing: the same as the workforce days.
export function routeBill(
  rates: BaseRates[],
  route: string[],
  days: number,
  billMargin = margin,
  keepDays = 0,
  prodDays?: number,
  hubs: boolean[] = [],
): BaseBill[] {
  const stops = route
    .map((x, i) => ({ name: x.trim(), hub: hubs[i] ?? false }))
    .filter(x => x.name !== '');
  const perBase = new Map<string, BaseBill>();
  for (const bill of tourBill(rates, days, billMargin, keepDays, prodDays ?? days)) {
    perBase.set(bill.name, bill);
  }
  const keys = stops.map(x => (x.hub ? undefined : matchBase(rates, x.name)?.name));
  return stops.map((stop, i) => {
    const key = keys[i];
    const bill = key === undefined ? undefined : perBase.get(key);
    const first = key !== undefined && keys.indexOf(key) === i;
    const last = key !== undefined && keys.lastIndexOf(key) === i;
    const result: BaseBill = {
      name: stop.name,
      items: bill && first ? bill.items : [],
      pickups: bill && last ? bill.pickups : [],
      retains: bill && first ? bill.retains : [],
    };
    if (stop.hub) {
      result.hub = true;
    }
    return result;
  });
}

// The waypoints served from the hub at index `hub`: the ones after it up to the next hub.
// The list is a loop: after the last waypoint comes the first one.
function segmentAfter(bill: BaseBill[], hub: number) {
  const result: BaseBill[] = [];
  for (let k = 1; k < bill.length; k++) {
    const stop = bill[(hub + k) % bill.length];
    if (stop.hub) {
      break;
    }
    result.push(stop);
  }
  return result;
}

// The hub flag of each waypoint. Old data without flags: only the first waypoint is a hub.
export function hubFlags(route: string[], hubs: boolean[] | undefined) {
  const flags = hubs ?? [true];
  return route.map((_, i) => flags[i] ?? false);
}

export function hasHub(bill: BaseBill[]) {
  return bill.some(x => x.hub);
}

// Weight (t) and volume (m3) of a list of materials.
export function sizeOfList(list: Qty[], sizeOf: SizeOf): Size {
  let weight = 0;
  let volume = 0;
  const missing = new Set<string>();
  for (const item of list) {
    const size = sizeOf(item.ticker);
    if (size === undefined) {
      missing.add(item.ticker);
      continue;
    }
    weight += size.weight * item.qty;
    volume += size.volume * item.qty;
  }
  return { weight, volume, missing: [...missing] };
}

// What the ship carries to the bases (loaded at the hub): the supplies of all bases.
export function supplyTotals(bill: BaseBill[], sizeOf: SizeOf) {
  const items = bill.flatMap(x => x.items);
  return sizeOfList(items, sizeOf);
}

// Adds the quantities of each ticker. The result is sorted by ticker.
function sumByTicker(list: Qty[]): Qty[] {
  const totals = new Map<string, number>();
  for (const item of list) {
    totals.set(item.ticker, (totals.get(item.ticker) ?? 0) + item.qty);
  }
  return [...totals]
    .map(([ticker, qty]) => ({ ticker, qty }))
    .sort((a, b) => a.ticker.localeCompare(b.ticker));
}

// Walks the segment of the hub at index `hub`. With transfers, a base can use what an earlier base
// of the same segment made: the hub loads less. Gives what the hub loads and what comes back to the
// next hub.
function walkSegment(bill: BaseBill[], hub: number, transfers: boolean) {
  const need = new Map<string, number>();
  const made = new Map<string, number>();
  for (const stop of segmentAfter(bill, hub)) {
    for (const item of stop.items) {
      const available = transfers ? (made.get(item.ticker) ?? 0) : 0;
      const taken = Math.min(available, item.qty);
      if (taken > 0) {
        made.set(item.ticker, available - taken);
      }
      if (item.qty > taken) {
        need.set(item.ticker, (need.get(item.ticker) ?? 0) + item.qty - taken);
      }
    }
    for (const item of stop.pickups) {
      made.set(item.ticker, (made.get(item.ticker) ?? 0) + item.qty);
    }
  }
  const toList = (map: Map<string, number>) =>
    sumByTicker([...map].map(([ticker, qty]) => ({ ticker, qty })).filter(x => x.qty > 0));
  return { load: toList(need), back: toList(made) };
}

// The hub of the segment before the hub at index `hub` (around the loop).
function previousHub(bill: BaseBill[], hub: number) {
  for (let k = 1; k <= bill.length; k++) {
    const i = (hub - k + bill.length) % bill.length;
    if (bill[i].hub) {
      return i;
    }
  }
  return hub;
}

// What the ship does at the hub at index `hub`. It loads the supplies of the bases up to the next
// hub and unloads the production picked up since the previous hub.
export function hubBill(bill: BaseBill[], hub: number, transfers = false) {
  return {
    load: walkSegment(bill, hub, transfers).load,
    unload: walkSegment(bill, previousHub(bill, hub), transfers).back,
  };
}

// What transfers from base to base save: the hub loads this much less in one loop.
export function transferSavings(bill: BaseBill[]) {
  const saved: Qty[] = [];
  for (const [i, stop] of bill.entries()) {
    if (!stop.hub) {
      continue;
    }
    const without = new Map(hubBill(bill, i).load.map(x => [x.ticker, x.qty]));
    for (const x of hubBill(bill, i, true).load) {
      without.set(x.ticker, (without.get(x.ticker) ?? 0) - x.qty);
    }
    for (const [ticker, qty] of without) {
      saved.push({ ticker, qty });
    }
  }
  return sumByTicker(saved).filter(x => x.qty > 0);
}

// What the bases make in one tour. It comes back to the hub.
export function pickupTotals(bill: BaseBill[], sizeOf: SizeOf) {
  const items = bill.flatMap(x => x.pickups);
  return sizeOfList(items, sizeOf);
}

// Cargo on every leg of one loop, from the first hub round to it again. Empty without a hub.
// The cargo is followed by ticker. A hub unloads everything and loads the supplies of its segment.
// A base unloads its supplies from what is on board and loads its production.
// segment is the index of the hub of the leg.
export function legs(bill: BaseBill[], sizeOf: SizeOf, transfers = false): Leg[] {
  const start = bill.findIndex(x => x.hub);
  if (start < 0) {
    return [];
  }
  const cargo = new Map<string, number>();
  let segment = start;
  const result: Leg[] = [];
  for (let k = 0; k < bill.length; k++) {
    const i = (start + k) % bill.length;
    const stop = bill[i];
    if (stop.hub) {
      segment = i;
      cargo.clear();
      for (const x of hubBill(bill, i, transfers).load) {
        cargo.set(x.ticker, x.qty);
      }
    } else {
      for (const x of stop.items) {
        cargo.set(x.ticker, Math.max(0, (cargo.get(x.ticker) ?? 0) - x.qty));
      }
      for (const x of stop.pickups) {
        cargo.set(x.ticker, (cargo.get(x.ticker) ?? 0) + x.qty);
      }
    }
    const size = sizeOfList(
      [...cargo].map(([ticker, qty]) => ({ ticker, qty })),
      sizeOf,
    );
    result.push({
      from: stop.name,
      to: bill[(i + 1) % bill.length].name,
      segment,
      weight: size.weight,
      volume: size.volume,
    });
  }
  return result;
}

// The biggest load on any leg of the tour: what the ship must be able to carry.
export function peakLoad(bill: BaseBill[], sizeOf: SizeOf, transfers = false) {
  const all = legs(bill, sizeOf, transfers);
  return {
    weight: Math.max(0, ...all.map(x => x.weight)),
    volume: Math.max(0, ...all.map(x => x.volume)),
    missing: supplyTotals(bill, sizeOf).missing,
  };
}

// Does every leg fit a ship of maxWeight t and maxVolume m3, keeping `free` t and m3 empty?
export function legsFit(
  bill: BaseBill[],
  sizeOf: SizeOf,
  maxWeight: number,
  maxVolume: number,
  free = 0,
  transfers = false,
) {
  const limitWeight = maxWeight - free;
  const limitVolume = maxVolume - free;
  return legs(bill, sizeOf, transfers).every(
    x => x.weight <= limitWeight && x.volume <= limitVolume,
  );
}

// The largest value (step 0.01, max 999) for which fits(value) is true. fits must be monotonic.
export function maxFittingDays(fits: (days: number) => boolean) {
  const unit = (n: number) => Number((n * fitStep).toFixed(2));
  let low = 0;
  let high = Math.round(fitMax / fitStep);
  while (low < high) {
    const mid = low + Math.ceil((high - low) / 2);
    if (fits(unit(mid))) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return unit(low);
}

// The longest tour (days, step 0.01) whose legs all fit the ship. free = 0 fills the ship.
// billFor(days) gives the bill of the tour.
export function fitTour(
  billFor: (days: number) => BaseBill[],
  sizeOf: SizeOf,
  maxWeight: number,
  maxVolume: number,
  free = 0,
  transfers = false,
) {
  return maxFittingDays(days =>
    legsFit(billFor(days), sizeOf, maxWeight, maxVolume, free, transfers),
  );
}

export interface PlanOptions {
  // Bases of a segment use what an earlier base of it made: the hub loads less.
  transfers?: boolean;
  // Default is on: the ship goes back to the first waypoint and starts again.
  loop?: boolean;
  routeName?: string;
  // An FTL ship needs both tanks, so the hub refuels STL and FTL.
  tank?: 'STL' | 'FTL';
  settings?: WaypointSettings;
}

const byTicker = (a: Qty, b: Qty) => a.ticker.localeCompare(b.ticker);

const allCarried = { all: true } as const;

// Turns a bill into a route. The waypoints keep the order of the bill.
//   Hub:  refuel (fuel is always a full load), unload everything that can be on board,
//         load the supplies of the bases up to the next hub as fixed amounts.
//   Base: unload its supplies, load its production (the ship waits until the base has made it).
//         Balance mode adds "load X 0 all retain N": the base keeps N of its supplies.
export function planRoute(bill: BaseBill[], options: PlanOptions = {}): RouteText {
  if (!hasHub(bill)) {
    throw new Error('Mark at least one waypoint as HUB: the ship loads and unloads there');
  }
  if (!bill.some(x => x.items.length > 0 || x.pickups.length > 0)) {
    throw new Error(
      'Nothing to carry: no waypoint of the list uses or makes anything for these days',
    );
  }

  const onBoard = new Set<string>();
  for (const base of bill) {
    for (const item of [...base.items, ...base.pickups]) {
      onBoard.add(item.ticker);
    }
  }

  const hubSteps = (index: number) => {
    const steps: RouteStep[] = [
      { type: 'refuel', tank: 'STL', min: { units: 0 }, max: allCarried, source: 'local' },
    ];
    if (options.tank === 'FTL') {
      steps.push({
        type: 'refuel',
        tank: 'FTL',
        min: { units: 0 },
        max: allCarried,
        source: 'local',
      });
    }
    for (const ticker of [...onBoard].sort()) {
      steps.push({ type: 'unload', material: ticker, min: { units: 0 }, max: allCarried });
    }
    for (const x of hubBill(bill, index, options.transfers).load) {
      steps.push({
        type: 'load',
        material: x.ticker,
        min: { units: x.qty },
        max: { units: x.qty },
      });
    }
    return steps;
  };

  const settings = options.settings ?? waypointSettings;
  const route: RouteText = { loop: options.loop !== false, waypoints: [] };
  if (options.routeName) {
    route.routeName = options.routeName;
  }

  for (const [index, base] of bill.entries()) {
    if (base.hub) {
      route.waypoints.push({ name: base.name, settings: { ...settings }, steps: hubSteps(index) });
      continue;
    }
    const steps: RouteStep[] = [
      ...[...base.items].sort(byTicker).map(
        (x): RouteStep => ({
          type: 'unload',
          material: x.ticker,
          min: { units: 0 },
          max: { units: x.qty },
        }),
      ),
      ...[...base.pickups].sort(byTicker).map(
        (x): RouteStep => ({
          type: 'load',
          material: x.ticker,
          min: { units: x.qty },
          max: allCarried,
        }),
      ),
      ...[...base.retains].sort(byTicker).map(
        (x): RouteStep => ({
          type: 'load',
          material: x.ticker,
          min: { units: 0 },
          max: allCarried,
          retain: x.qty,
        }),
      ),
    ];
    route.waypoints.push({ name: base.name, settings: { ...settings }, steps });
  }
  return route;
}
