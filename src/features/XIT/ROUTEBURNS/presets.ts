import { getShipSize } from '@src/core/ship-sizes';
import { createId } from '@src/store/create-id';
import { hubFlags } from '@src/features/XIT/ROUTEBURNS/route-plan';

export type PresetSettings = Omit<UserData.RouteBurnsPreset, 'id' | 'name'>;

// A plain copy. structuredClone does not take the reactive objects of userData.
export const copyOff = (off: Record<string, string[]>) =>
  Object.fromEntries(Object.entries(off).map(([key, list]) => [key, list.slice()]));

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

// Saves the settings under a name. A preset with the same name is replaced and keeps its id.
// It returns a new list: the old list and the old presets are not changed.
export function savePreset(
  presets: UserData.RouteBurnsPreset[],
  name: string,
  settings: PresetSettings,
): UserData.RouteBurnsPreset[] {
  const trimmed = name.trim();
  if (trimmed === '') {
    throw new Error('A preset needs a name');
  }
  const preset: UserData.RouteBurnsPreset = {
    id: presets.find(x => sameName(x.name, trimmed))?.id ?? createId(),
    name: trimmed,
    ...settings,
    route: settings.route.slice(),
    hubs: settings.hubs?.slice(),
    off: settings.off === undefined ? undefined : copyOff(settings.off),
  };
  if (preset.hubs === undefined) {
    delete preset.hubs;
  }
  if (preset.off === undefined) {
    delete preset.off;
  }
  const exists = presets.some(x => x.id === preset.id);
  return exists ? presets.map(x => (x.id === preset.id ? preset : x)) : [...presets, preset];
}

export function deletePreset(presets: UserData.RouteBurnsPreset[], id: string) {
  return presets.filter(x => x.id !== id);
}

export function hasPreset(presets: UserData.RouteBurnsPreset[], name: string) {
  return presets.some(x => sameName(x.name, name));
}

// One short line for the presets table.
export function describePreset(preset: UserData.RouteBurnsPreset) {
  const flags = hubFlags(preset.route, preset.hubs);
  const hubNames = preset.route.filter((x, i) => flags[i] && x.trim() !== '').map(x => x.trim());
  const hub = hubNames.length === 0 ? 'no hub' : hubNames.join(' + ');
  const stops = flags.filter(x => !x).length;
  const shipLabel = getShipSize(preset.ship)?.label ?? 'no ship';
  const days = preset.balance ? 'balance' : `${preset.days} days`;
  return `${hub}, ${stops} waypoints, ${shipLabel}, ${days}`;
}

// ---------- sharing ----------

// A shared preset is one line of text: this prefix, then JSON. The prefix tells what the text is.
const sharePrefix = 'RPRUN-ROUTEBURNS ';

// The text to share: everything of the preset except its id.
export function presetToText(preset: UserData.RouteBurnsPreset) {
  const rest: Partial<UserData.RouteBurnsPreset> = { ...preset };
  delete rest.id;
  return sharePrefix + JSON.stringify(rest);
}

const isBoolean = (x: unknown) => typeof x === 'boolean';
const isNumber = (x: unknown) => typeof x === 'number' && Number.isFinite(x) && x >= 0;
const isStringList = (x: unknown): x is string[] =>
  Array.isArray(x) && x.every(y => typeof y === 'string');

// Reads a shared preset. It throws an error that tells what is wrong.
export function presetFromText(text: string): { name: string; settings: PresetSettings } {
  const trimmed = text.trim();
  if (!trimmed.startsWith(sharePrefix.trim())) {
    throw new Error(
      `This is not a ROUTEBURNS preset: the text must start with "${sharePrefix.trim()}".`,
    );
  }
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(trimmed.slice(sharePrefix.trim().length)) as Record<string, unknown>;
  } catch {
    throw new Error('The preset text is damaged: copy it again.');
  }
  if (typeof data !== 'object' || data === null) {
    throw new Error('The preset text is damaged: copy it again.');
  }
  const bad = (field: string) => new Error(`The preset text has a bad "${field}" value.`);
  const name = data.name;
  if (typeof name !== 'string' || name.trim() === '') {
    throw bad('name');
  }
  if (data.tank !== 'STL' && data.tank !== 'FTL') {
    throw bad('tank');
  }
  if (typeof data.ship !== 'string') {
    throw bad('ship');
  }
  if (!isNumber(data.days)) {
    throw bad('days');
  }
  if (!isNumber(data.keep)) {
    throw bad('keep');
  }
  if (!isBoolean(data.balance)) {
    throw bad('balance');
  }
  if (!isStringList(data.route)) {
    throw bad('route');
  }
  if (data.hubs !== undefined && !(Array.isArray(data.hubs) && data.hubs.every(isBoolean))) {
    throw bad('hubs');
  }
  if (data.transfer !== undefined && !isBoolean(data.transfer)) {
    throw bad('transfer');
  }
  const off = data.off;
  if (
    off !== undefined &&
    (typeof off !== 'object' || off === null || !Object.values(off).every(isStringList))
  ) {
    throw bad('off');
  }
  const settings: PresetSettings = {
    tank: data.tank,
    ship: data.ship,
    days: data.days as number,
    keep: data.keep as number,
    balance: data.balance as boolean,
    route: data.route.slice(),
  };
  if (data.hubs !== undefined) {
    settings.hubs = (data.hubs as boolean[]).slice();
  }
  if (data.transfer !== undefined) {
    settings.transfer = data.transfer as boolean;
  }
  if (off !== undefined) {
    settings.off = copyOff(off as Record<string, string[]>);
  }
  return { name: name.trim(), settings };
}

// A name that no preset has yet: "Tour", "Tour (2)", "Tour (3)"...
export function freePresetName(presets: UserData.RouteBurnsPreset[], name: string) {
  const trimmed = name.trim();
  if (!hasPreset(presets, trimmed)) {
    return trimmed;
  }
  let n = 2;
  while (hasPreset(presets, `${trimmed} (${n})`)) {
    n++;
  }
  return `${trimmed} (${n})`;
}
