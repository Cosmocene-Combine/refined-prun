import { sitesStore } from '@src/infrastructure/prun-api/data/sites';
import { warehousesStore } from '@src/infrastructure/prun-api/data/warehouses';
import {
  getEntityNameFromAddress,
  getLocationLineFromAddress,
  isStationLine,
} from '@src/infrastructure/prun-api/data/addresses';

export type LocationKind = 'station' | 'base' | 'warehouse';

export interface LocationEntry {
  name: string;
  kind: LocationKind;
}

export interface LocationOption {
  label: string;
  value: string;
}

// The same order as the storage list of XIT BURNACT: station warehouses, bases, other warehouses.
const kindOrder: Record<LocationKind, number> = { station: 0, base: 1, warehouse: 2 };

const kindSuffix: Record<LocationKind, string> = {
  station: 'Warehouse',
  base: 'Base',
  warehouse: 'Warehouse',
};

// The value is the plain name: the route text and the burn match use it.
// A base and a warehouse on the same planet have the same name, so the name shows one time only.
export function locationOptions(entries: LocationEntry[]): LocationOption[] {
  const sorted = entries
    .filter(x => x.name.trim() !== '')
    .sort((a, b) => {
      const order = kindOrder[a.kind] - kindOrder[b.kind];
      return order !== 0 ? order : a.name.localeCompare(b.name);
    });
  const seen = new Set<string>();
  const result: LocationOption[] = [];
  for (const entry of sorted) {
    const key = entry.name.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push({ label: `${entry.name} ${kindSuffix[entry.kind]}`, value: entry.name });
  }
  return result;
}

// Finds the option that has the same name, without case. Names typed before can be in lower case.
export function findLocation(options: LocationOption[], name: string) {
  const wanted = name.trim().toLowerCase();
  if (wanted === '') {
    return undefined;
  }
  return options.find(x => x.value.toLowerCase() === wanted);
}

// The short name of a waypoint for the auto route name: the code of a station ("Hortus Station" ->
// "HRT"), else the name itself.
export function shortLocationName(name: string) {
  const wanted = name.trim().toLowerCase();
  for (const warehouse of warehousesStore.all.value ?? []) {
    const line = getLocationLineFromAddress(warehouse.address);
    const entityName = getEntityNameFromAddress(warehouse.address);
    if (isStationLine(line) && entityName?.toLowerCase() === wanted) {
      return line.entity.naturalId;
    }
  }
  return name.trim();
}

export const routeLocations = computed(() => {
  const entries: LocationEntry[] = [];
  for (const site of sitesStore.all.value ?? []) {
    const name = getEntityNameFromAddress(site.address);
    if (name) {
      entries.push({ name, kind: 'base' });
    }
  }
  for (const warehouse of warehousesStore.all.value ?? []) {
    const name = getEntityNameFromAddress(warehouse.address);
    if (name) {
      const isStation = getLocationLineFromAddress(warehouse.address)?.type === 'STATION';
      entries.push({ name, kind: isStation ? 'station' : 'warehouse' });
    }
  }
  return locationOptions(entries);
});
