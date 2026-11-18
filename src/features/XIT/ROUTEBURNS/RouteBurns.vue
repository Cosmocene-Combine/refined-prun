<script setup lang="ts">
import Active from '@src/components/forms/Active.vue';
import Commands from '@src/components/forms/Commands.vue';
import NumberInput from '@src/components/forms/NumberInput.vue';
import RadioItem from '@src/components/forms/RadioItem.vue';
import SelectInput from '@src/components/forms/SelectInput.vue';
import TextInput from '@src/components/forms/TextInput.vue';
import CopyButton from '@src/components/CopyButton.vue';
import FilterRow from '@src/components/FilterRow.vue';
import LoadingSpinner from '@src/components/LoadingSpinner.vue';
import MaterialIcon from '@src/components/MaterialIcon.vue';
import PrunButton from '@src/components/PrunButton.vue';
import SectionDescription from '@src/components/SectionDescription.vue';
import SectionHeader from '@src/components/SectionHeader.vue';
import { getPlanetBurn } from '@src/core/burn';
import { getRecurringOrders } from '@src/core/orders';
import { productionStore } from '@src/infrastructure/prun-api/data/production';
import { getShipSize, shipSizes } from '@src/core/ship-sizes';
import { materialsStore } from '@src/infrastructure/prun-api/data/materials';
import { sitesStore } from '@src/infrastructure/prun-api/data/sites';
import {
  showConfirmationOverlay,
  showErrorOverlay,
  showSuccessOverlay,
} from '@src/infrastructure/prun-ui/tile-overlay';
import { useClipboard } from '@src/hooks/use-clipboard';
import { userData } from '@src/store/user-data';
import { fixed0, fixed2 } from '@src/utils/format';
import LocationSelect from '@src/features/XIT/ROUTEBURNS/LocationSelect.vue';
import { shortLocationName } from '@src/features/XIT/ROUTEBURNS/locations';
import SendToRoute from '@src/features/XIT/ROUTEBURNS/SendToRoute.vue';
import { useSetting } from '@src/features/XIT/ROUTEBURNS/settings';
import {
  copyOff,
  deletePreset,
  describePreset,
  freePresetName,
  hasPreset,
  PresetSettings,
  presetFromText,
  presetToText,
  savePreset,
} from '@src/features/XIT/ROUTEBURNS/presets';
import {
  balanceFree,
  BaseBill,
  baseKey,
  BaseRates,
  fitMax,
  fitTour,
  hasHub,
  hubBill,
  hubFlags,
  legs,
  margin,
  matchBase,
  peakLoad,
  planRoute,
  Qty,
  Rate,
  ratesFromBurn,
  routeBill,
  runsFromLines,
  transferSavings,
  withoutOff,
} from '@src/features/XIT/ROUTEBURNS/route-plan';
import { formatRouteText } from '@src/features/XIT/ROUTEBURNS/route-text';

const days = useSetting('days');
const keep = useSetting('keep');
const tank = useSetting('tank');
const ship = useSetting('ship');
const balance = useSetting('balance');
const route = useSetting('route');
const hubs = useSetting('hubs');
const transfer = useSetting('transfer');
const off = useSetting('off');
const hideText = useSetting('hideText');

interface Waypoint {
  name: string;
  hub: boolean;
}

// A flag for each waypoint: true is a hub.
const flags = computed(() => hubFlags(route.value, hubs.value));

const waypoints = computed<Waypoint[]>(() =>
  route.value.map((name, i) => ({ name, hub: flags.value[i] })),
);

// The route and the hub flags go together. Always set new arrays.
function setWaypoints(list: Waypoint[]) {
  route.value = list.map(x => x.name);
  hubs.value = list.map(x => x.hub);
  editing.value = undefined;
}

// Index of the waypoint whose material list is open.
const editing = ref<number>();

const tanks = ['STL', 'FTL'];
const shipOptions = [
  { label: 'None', value: '' },
  ...shipSizes.map(x => ({ label: x.label, value: x.id })),
];

const largestWeight = Math.max(...shipSizes.map(x => x.weight));
const largestVolume = Math.max(...shipSizes.map(x => x.volume));

const planetBurns = computed(() => {
  const sites = sitesStore.all.value;
  if (!sites) {
    return undefined;
  }
  return sites
    .map(x => {
      const burn = getPlanetBurn(x);
      if (burn === undefined) {
        return undefined;
      }
      const lines = productionStore.getBySiteId(x.siteId) ?? [];
      return { ...burn, runs: runsFromLines(lines, getRecurringOrders) };
    })
    .filter(x => x !== undefined);
});

// All the materials of each base. The tour uses only the ones that are on.
const allRates = computed(() => ratesFromBurn(planetBurns.value ?? []));
const rates = computed(() => withoutOff(allRates.value, off.value));

function baseOf(name: string) {
  return matchBase(allRates.value, name);
}

function offList(base: BaseRates) {
  return off.value[baseKey(base)] ?? [];
}

type MaterialItem = ReturnType<typeof materialsOf>[number];

// The EDIT list in two groups. A group without materials is not shown.
function materialGroups(base: BaseRates) {
  const items = materialsOf(base);
  return [
    { kind: 'Supply', title: 'Supplies (the ship brings them)' },
    { kind: 'Production', title: 'Production (the ship picks it up)' },
  ]
    .map(x => ({ ...x, items: items.filter(item => item.kind === x.kind) }))
    .filter(x => x.items.length > 0);
}

// About how much of a material one tour moves.
function tourAmount(daily: number) {
  return Math.round(daily * tourDays.value);
}

function materialTooltip(item: MaterialItem) {
  const state = item.on ? 'ON: click to turn it off' : 'OFF: click to turn it on';
  return `${item.ticker}: ${fixed2(item.daily)} per day, about ${fixed0(tourAmount(item.daily))} per tour. ${state}.`;
}

// The materials of a base for its EDIT list: supplies first, then production.
function materialsOf(base: BaseRates) {
  const isOn = (ticker: string) => !offList(base).includes(ticker);
  const byTicker = (a: Rate, b: Rate) => a.ticker.localeCompare(b.ticker);
  return [
    ...base.uses
      .slice()
      .sort(byTicker)
      .map(x => ({ ...x, kind: 'Supply', on: isOn(x.ticker) })),
    ...base.makes
      .slice()
      .sort(byTicker)
      .map(x => ({ ...x, kind: 'Production', on: isOn(x.ticker) })),
  ];
}

function setMaterialOn(base: BaseRates, ticker: string, on: boolean) {
  const key = baseKey(base);
  const list = offList(base).filter(x => x !== ticker);
  if (!on) {
    list.push(ticker);
  }
  const next = { ...off.value };
  if (list.length > 0) {
    next[key] = list;
  } else {
    delete next[key];
  }
  off.value = next;
}

function editLabel(base: BaseRates) {
  const count = materialsOf(base).filter(x => !x.on).length;
  return count > 0 ? `EDIT (${count} off)` : 'EDIT';
}

function toggleEdit(index: number) {
  editing.value = editing.value === index ? undefined : index;
}

const shipSize = computed(() => (ship.value === '' ? undefined : getShipSize(ship.value)));

function sizeOf(ticker: string) {
  const material = materialsStore.getByTicker(ticker);
  return material ? { weight: material.weight, volume: material.volume } : undefined;
}

// Days of workforce supplies and of whole production runs, the same for all bases.
function billAt(tourDays: number, keepDays = 0) {
  return routeBill(rates.value, route.value, tourDays, margin, keepDays, undefined, flags.value);
}

function hasWork(bill: BaseBill[]) {
  return hasHub(bill) && bill.some(x => x.items.length > 0 || x.pickups.length > 0);
}

const canFit = computed(() => shipSize.value !== undefined && hasWork(billAt(fitMax)));

// Balance mode needs a ship. It finds the most days D that fit with some room kept free.
// All bases use D, for the workforce supplies and the production: the ship does one loop and waits
// for the production at each base, so all bases share the same loop time. A second hub helps only
// because it empties the ship: each leg carries less.
const balanceMode = computed(() => balance.value && shipSize.value !== undefined);

const balanceDays = computed(() => {
  const size = shipSize.value;
  if (!balanceMode.value || size === undefined || !canFit.value) {
    return 0;
  }
  return fitTour(x => billAt(x), sizeOf, size.weight, size.volume, balanceFree, transfer.value);
});

const tourDays = computed(() => (balanceMode.value ? balanceDays.value : days.value));

const bill = computed(() => billAt(tourDays.value, balanceMode.value ? keep.value : 0));

const plan = computed(() => {
  try {
    const planned = planRoute(bill.value, {
      loop: true,
      tank: tank.value,
      transfers: transfer.value,
    });
    return { text: formatRouteText(planned), error: undefined };
  } catch (e) {
    return { text: '', error: e instanceof Error ? e.message : String(e) };
  }
});

// Unload and load of each row of the tour table. A hub shows its segment.
const rows = computed(() =>
  bill.value.map((x, i) => {
    if (!x.hub) {
      return { stop: x, unload: x.items, load: x.pickups };
    }
    const hubRow = hubBill(bill.value, i, transfer.value);
    return { stop: x, unload: hubRow.unload, load: hubRow.load };
  }),
);
const legList = computed(() => legs(bill.value, sizeOf, transfer.value));
const peak = computed(() => peakLoad(bill.value, sizeOf, transfer.value));

// Fill of the ship on a leg: the larger of weight and volume, in percent.
function fillOf(weight: number, volume: number) {
  const size = shipSize.value;
  if (size === undefined) {
    return undefined;
  }
  const byWeight = weight / size.weight;
  const byVolume = volume / size.volume;
  return byWeight >= byVolume
    ? { percent: byWeight * 100, unit: 't' }
    : { percent: byVolume * 100, unit: 'm³' };
}

// Legs with their fill. The fullest leg of each segment sets the limit of that segment.
const legRows = computed(() => {
  const rowsWithFill = legList.value.map(x => ({ leg: x, fill: fillOf(x.weight, x.volume) }));
  const fullest = new Map<number, number>();
  for (const x of rowsWithFill) {
    const percent = x.fill?.percent ?? 0;
    fullest.set(x.leg.segment, Math.max(fullest.get(x.leg.segment) ?? 0, percent));
  }
  return rowsWithFill.map(x => ({
    ...x,
    limit:
      x.fill !== undefined && x.fill.percent > 0 && x.fill.percent === fullest.get(x.leg.segment),
  }));
});

// Transfers off: what they would save. It suggests to turn them on.
const savings = computed(() => (transfer.value ? [] : transferSavings(bill.value)));

// Balance mode: the bases keep more days than the ship brings.
const keepTooHigh = computed(() => balanceMode.value && keep.value >= tourDays.value);
const tooBig = computed(
  () => peak.value.weight > largestWeight || peak.value.volume > largestVolume,
);

const balanceFailed = computed(() => balanceMode.value && canFit.value && balanceDays.value <= 0);

function overShip(weight: number, volume: number) {
  const size = shipSize.value;
  return size !== undefined && (weight > size.weight || volume > size.volume);
}

function isPlainWaypoint(name: string) {
  return baseOf(name) === undefined;
}

function listText(list: Qty[]) {
  return list.length > 0 ? list.map(x => `${x.ticker} ${fixed0(x.qty)}`).join(', ') : '-';
}

function fit() {
  const size = shipSize.value;
  if (size === undefined || !canFit.value) {
    return;
  }
  days.value = fitTour(x => billAt(x), sizeOf, size.weight, size.volume, 0, transfer.value);
}

function addWaypoint() {
  setWaypoints([...waypoints.value, { name: '', hub: false }]);
}

function addAllBases() {
  const have = new Set(route.value.map(x => x.trim().toLowerCase()));
  const names = allRates.value.map(x => x.name).filter(x => !have.has(x.toLowerCase()));
  names.sort((a, b) => a.localeCompare(b));
  // Keep an empty hub first for the user to select when the list is empty.
  const start = route.value.length === 0 ? [{ name: '', hub: true }] : waypoints.value;
  setWaypoints([...start, ...names.map(name => ({ name, hub: false }))]);
}

function removeWaypoint(index: number) {
  setWaypoints(waypoints.value.filter((_, i) => i !== index));
}

function moveWaypoint(index: number, delta: number) {
  const target = index + delta;
  if (target < 0 || target >= route.value.length) {
    return;
  }
  const next = waypoints.value.slice();
  [next[index], next[target]] = [next[target], next[index]];
  setWaypoints(next);
}

function toggleHub(index: number) {
  setWaypoints(waypoints.value.map((x, i) => (i === index ? { ...x, hub: !x.hub } : x)));
}

function renameWaypoint(index: number, name: string) {
  const next = route.value.slice();
  next[index] = name;
  route.value = next;
}

const presetName = ref('');

// The auto name of the tour: the code of a station hub and the planet names of the bases,
// for example "HRT->Adalina->Berthier". It names the route in the game and fills the preset name.
const autoName = computed(() =>
  route.value
    .map(x => baseOf(x)?.name ?? shortLocationName(x))
    .filter(x => x !== '')
    .join('->'),
);

// The preset name follows the auto name until the player types a name of their own.
watch(
  autoName,
  (now, before) => {
    if (presetName.value.trim() === '' || presetName.value === before) {
      presetName.value = now;
    }
  },
  { immediate: true },
);
const presets = computed(() => userData.routeBurns.presets);

function currentSettings(): PresetSettings {
  return {
    tank: tank.value,
    ship: ship.value,
    days: days.value,
    keep: keep.value,
    balance: balance.value,
    route: route.value.slice(),
    hubs: flags.value.slice(),
    transfer: transfer.value,
    off: copyOff(off.value),
  };
}

function saveCurrent(ev: Event) {
  const name = presetName.value.trim();
  if (name === '') {
    return;
  }
  const replaced = hasPreset(presets.value, name);
  userData.routeBurns.presets = savePreset(presets.value, name, currentSettings());
  showSuccessOverlay(ev, replaced ? 'Preset replaced.' : 'Preset saved.');
}

function loadPreset(preset: UserData.RouteBurnsPreset) {
  tank.value = preset.tank;
  ship.value = preset.ship;
  days.value = preset.days;
  keep.value = preset.keep;
  balance.value = preset.balance;
  transfer.value = preset.transfer ?? false;
  off.value = copyOff(preset.off ?? {});
  const presetFlags = hubFlags(preset.route, preset.hubs);
  setWaypoints(preset.route.map((name, i) => ({ name, hub: presetFlags[i] })));
  presetName.value = preset.name;
}

const { copy } = useClipboard();
// Id of the preset that was copied last: its COPY button shows "Copied!".
const copiedId = ref<string>();

async function copyPreset(preset: UserData.RouteBurnsPreset) {
  await copy(presetToText(preset));
  copiedId.value = preset.id;
}

const importText = ref('');

// Adds a shared preset. It never replaces a preset: a name that exists gets a number.
function importPreset(ev: Event) {
  let read: ReturnType<typeof presetFromText>;
  try {
    read = presetFromText(importText.value);
  } catch (e) {
    showErrorOverlay(ev, e instanceof Error ? e.message : String(e));
    return;
  }
  const name = freePresetName(presets.value, read.name);
  userData.routeBurns.presets = savePreset(presets.value, name, read.settings);
  importText.value = '';
  showSuccessOverlay(ev, `Preset "${name}" imported. Click LOAD to use it.`);
}

function confirmDelete(ev: Event, preset: UserData.RouteBurnsPreset) {
  showConfirmationOverlay(
    ev,
    () => {
      userData.routeBurns.presets = deletePreset(userData.routeBurns.presets, preset.id);
    },
    { message: `Are you sure you want to delete the preset "${preset.name}"?` },
  );
}
</script>

<template>
  <LoadingSpinner v-if="planetBurns === undefined" />
  <div v-else>
    <SectionDescription>
      Plans a tour from the burn of your bases. The ship visits the waypoints in order and starts
      again. Each hub loads the supplies of the bases after it, up to the next hub, and unloads the
      production picked up since the previous hub.
    </SectionDescription>

    <SectionHeader>Presets</SectionHeader>
    <form @submit.prevent>
      <Active
        label="Name"
        tooltip="Type a name and click SAVE to keep the settings and the waypoints below. The same name replaces the old preset.">
        <TextInput v-model="presetName" />
      </Active>
      <Commands>
        <PrunButton primary :disabled="presetName.trim() === ''" @click="saveCurrent">
          SAVE
        </PrunButton>
      </Commands>
      <Active
        label="Import"
        tooltip="Paste the text of a preset that a player shared with COPY, then click IMPORT.">
        <TextInput v-model="importText" />
      </Active>
      <Commands>
        <PrunButton primary :disabled="importText.trim() === ''" @click="importPreset">
          IMPORT
        </PrunButton>
      </Commands>
    </form>
    <table v-if="presets.length > 0">
      <thead>
        <tr>
          <th>Name</th>
          <th>Plan</th>
          <th />
        </tr>
      </thead>
      <tbody>
        <tr v-for="preset in presets" :key="preset.id">
          <td>{{ preset.name }}</td>
          <td>{{ describePreset(preset) }}</td>
          <td :class="$style.buttons">
            <PrunButton
              neutral
              inline
              data-tooltip-position="top"
              :data-tooltip="
                copiedId === preset.id ? 'Copied!' : 'Copies this preset as text to share.'
              "
              @click="copyPreset(preset)">
              COPY
            </PrunButton>
            <PrunButton primary inline @click="loadPreset(preset)">LOAD</PrunButton>
            <PrunButton danger inline @click="confirmDelete($event, preset)">DELETE</PrunButton>
          </td>
        </tr>
      </tbody>
    </table>

    <SectionHeader>Settings</SectionHeader>
    <form @submit.prevent>
      <Active label="Ship fuel" tooltip="An FTL ship needs both STL and FTL fuel.">
        <SelectInput v-model="tank" :options="tanks" />
      </Active>
      <Active label="Ship size">
        <SelectInput v-model="ship" :options="shipOptions" />
      </Active>
      <Active
        label="Balance"
        tooltip="Needs a ship size. Finds the most days that fit the ship with 50 t and 50 m³ kept free. All bases use the same days for the workforce supplies and the production, because the ship does one loop. Each base keeps some days of its supplies. The days show in the Tour header.">
        <RadioItem v-model="balance" horizontal>{{ balance ? 'ON' : 'OFF' }}</RadioItem>
      </Active>
      <!-- Balance ON: the days show in the "Tour of X days burn" header. -->
      <Active
        v-if="!balanceMode"
        label="Days burn"
        tooltip="Days of burn that the ship carries for each base. Production is counted in whole orders.">
        <NumberInput v-model="days" float />
      </Active>
      <Active
        v-if="balanceMode"
        label="Keep days"
        tooltip="Days of its supplies that each base keeps. The rest stays on the ship.">
        <NumberInput v-model="keep" float />
      </Active>
      <Active
        label="Transfers"
        tooltip="A base can use what an earlier base of the same segment made. The hub then loads less of it. It needs the earlier base to make enough before the ship comes.">
        <RadioItem v-model="transfer" horizontal>{{ transfer ? 'ON' : 'OFF' }}</RadioItem>
      </Active>
      <Commands v-if="!balanceMode">
        <PrunButton primary :disabled="!canFit" @click="fit">FIT TO SHIP</PrunButton>
      </Commands>
    </form>
    <div v-if="balance && shipSize === undefined" :class="$style.warn">
      Balance needs a ship size.
    </div>
    <div v-if="balanceFailed" :class="$style.warn">
      Not even a very short tour fits this ship with 50 t and 50 m³ kept free.
    </div>
    <div v-if="keepTooHigh" :class="$style.warn">
      Keep days ({{ fixed2(keep) }}) are not less than the days burn ({{ fixed2(tourDays) }}): the
      bases keep everything and the retain steps do nothing.
    </div>
    <div v-if="savings.length > 0" :class="$style.warn">
      Transfers can save {{ listText(savings) }} in each loop: a base uses what an earlier base of
      its segment makes. Turn Transfers ON to use it.
    </div>

    <SectionHeader>Waypoints</SectionHeader>
    <form @submit.prevent>
      <template v-for="(point, i) in waypoints" :key="i">
        <Active
          :label="point.hub ? `Waypoint ${i + 1} (hub)` : `Waypoint ${i + 1}`"
          :tooltip="
            point.hub
              ? 'A hub: the ship refuels, unloads everything and loads the supplies of the bases up to the next hub. Select Custom... to type a name.'
              : undefined
          ">
          <div :class="$style.row">
            <LocationSelect
              :model-value="point.name"
              @update:model-value="renameWaypoint(i, $event)" />
            <PrunButton
              v-if="baseOf(point.name)"
              neutral
              inline
              data-tooltip-position="top"
              data-tooltip="Turns materials of this base on or off for the tour."
              @click="toggleEdit(i)">
              {{ editLabel(baseOf(point.name)!) }}
            </PrunButton>
            <PrunButton :primary="point.hub" :neutral="!point.hub" inline @click="toggleHub(i)">
              {{ point.hub ? 'HUB' : 'BASE' }}
            </PrunButton>
            <PrunButton neutral inline @click="moveWaypoint(i, -1)">▲</PrunButton>
            <PrunButton neutral inline @click="moveWaypoint(i, 1)">▼</PrunButton>
            <PrunButton danger inline @click="removeWaypoint(i)">✕</PrunButton>
          </div>
        </Active>
        <div v-if="editing === i && baseOf(point.name)" :class="$style.materials">
          <template v-for="group in materialGroups(baseOf(point.name)!)" :key="group.kind">
            <div :class="$style.groupTitle">{{ group.title }}</div>
            <div :class="$style.icons">
              <!-- The capture handler stops the click of the icon, which opens MAT. -->
              <div
                v-for="item in group.items"
                :key="item.ticker"
                :class="[$style.icon, { [$style.off]: !item.on }]"
                data-tooltip-position="top"
                :data-tooltip="materialTooltip(item)"
                @click.capture.stop="setMaterialOn(baseOf(point.name)!, item.ticker, !item.on)">
                <MaterialIcon :ticker="item.ticker" :amount="tourAmount(item.daily)" />
              </div>
            </div>
          </template>
        </div>
      </template>
      <Commands label="->">
        <PrunButton primary @click="addWaypoint">ADD WAYPOINT</PrunButton>
        <PrunButton primary @click="addAllBases">ADD ALL BASES</PrunButton>
      </Commands>
    </form>

    <template v-if="bill.length > 0">
      <SectionHeader>Tour of {{ fixed2(tourDays) }} days burn</SectionHeader>
      <table>
        <thead>
          <tr>
            <th>Days burn</th>
            <th>#</th>
            <th>Waypoint</th>
            <th>Unload</th>
            <th>Load</th>
            <th v-if="balanceMode">Keep</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, i) in rows" :key="i">
            <td>
              {{ !row.stop.hub && isPlainWaypoint(row.stop.name) ? '-' : fixed2(tourDays) }}
            </td>
            <td>{{ i + 1 }}</td>
            <td>
              {{ row.stop.name }}{{ row.stop.hub ? ' (hub)' : '' }}
              <div v-if="!row.stop.hub && isPlainWaypoint(row.stop.name)" :class="$style.warn">
                No burn data: plain waypoint
              </div>
            </td>
            <td>{{ listText(row.unload) }}</td>
            <td>{{ listText(row.load) }}</td>
            <td v-if="balanceMode">{{ row.stop.hub ? '-' : listText(row.stop.retains) }}</td>
          </tr>
        </tbody>
      </table>

      <SectionHeader>Cargo on each leg</SectionHeader>
      <table>
        <thead>
          <tr>
            <th>From</th>
            <th>To</th>
            <th>Weight</th>
            <th>Volume</th>
            <th v-if="shipSize">Ship</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, i) in legRows" :key="i">
            <td>{{ row.leg.from }}</td>
            <td>{{ row.leg.to }}</td>
            <td :class="{ [$style.bad]: overShip(row.leg.weight, 0) }">
              {{ fixed2(row.leg.weight) }}t
            </td>
            <td :class="{ [$style.bad]: overShip(0, row.leg.volume) }">
              {{ fixed2(row.leg.volume) }}m³
            </td>
            <td v-if="shipSize" :class="{ [$style.limit]: row.limit }">
              {{ row.fill ? `${fixed0(row.fill.percent)}% ${row.fill.unit}` : '-' }}
              {{ row.limit ? '(limit)' : '' }}
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="peak.missing.length > 0" :class="$style.warn">
        No size for {{ peak.missing.join(', ') }}: not counted.
      </div>
      <div v-if="tooBig" :class="$style.bad">
        Too big for the largest ship. Lower the days or use FIT TO SHIP.
      </div>
    </template>

    <SectionHeader>Route text</SectionHeader>
    <FilterRow>
      <CopyButton :copy-fn="() => plan.text" />
      <PrunButton neutral @click="hideText = !hideText">{{
        hideText ? 'SHOW' : 'HIDE'
      }}</PrunButton>
    </FilterRow>
    <div v-if="plan.error" :class="$style.warn">{{ plan.error }}</div>
    <textarea
      v-else-if="!hideText"
      :class="$style.text"
      :value="plan.text"
      readonly
      spellcheck="false" />

    <SendToRoute :text="plan.text" :error="plan.error" :name="autoName" />
  </div>
</template>

<style module>
.row {
  display: flex;
  align-items: center;
  column-gap: 3px;
}

.row > :first-child {
  flex: 1;
}

.materials {
  margin-bottom: 0.25rem;
  padding: 2px 4px 4px;
}

.groupTitle {
  margin: 4px 0 2px;
  color: #999;
  font-size: 11px;
}

.icons {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.icon {
  cursor: pointer;
}

.off {
  filter: grayscale(1);
  opacity: 0.4;
}

.buttons {
  text-align: right;
  white-space: nowrap;
}

.warn {
  margin: 0.25rem 0;
  padding: 0 4px;
  color: #f7a600;
}

.bad {
  color: rgb(217, 83, 79);
}

.limit {
  color: #f7a600;
}

div.bad {
  margin: 0.25rem 0;
  padding: 0 4px;
}

.text {
  display: block;
  box-sizing: border-box;
  width: 100%;
  height: 14rem;
  padding: 4px;
  resize: vertical;
  border: 1px solid #2b485a;
  background: #23282b !important;
  color: #ddd !important;
  font-family: monospace;
  font-size: 11px;
  white-space: pre;
}
</style>
