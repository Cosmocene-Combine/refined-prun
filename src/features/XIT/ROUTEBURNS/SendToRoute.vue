<script setup lang="ts">
import Active from '@src/components/forms/Active.vue';
import Commands from '@src/components/forms/Commands.vue';
import Passive from '@src/components/forms/Passive.vue';
import SelectInput from '@src/components/forms/SelectInput.vue';
import PrunButton from '@src/components/PrunButton.vue';
import SectionDescription from '@src/components/SectionDescription.vue';
import SectionHeader from '@src/components/SectionHeader.vue';
import {
  buildImportPlan,
  planKey,
  todoText,
  ImportPlan,
} from '@src/features/XIT/ROUTEBURNS/route-import-plan';
import {
  exportRoute,
  createRoute,
  CreatedRoute,
  findRouteEditors,
  findRouteListFrame,
  RouteEditor,
  waitFor,
} from '@src/features/XIT/ROUTEBURNS/route-driver';
import { LogKind, runImportPlan } from '@src/features/XIT/ROUTEBURNS/route-runner';
import { parseRouteText } from '@src/features/XIT/ROUTEBURNS/route-text';
import { useSetting } from '@src/features/XIT/ROUTEBURNS/settings';
import { createTickerLookup } from '@src/features/XIT/ROUTEBURNS/ticker-lookup';
import { useTile } from '@src/hooks/use-tile';
import {
  canOpenCompanion,
  openCompanionBuffer,
} from '@src/infrastructure/prun-ui/companion-buffer';
import { closePrunWindow } from '@src/infrastructure/prun-ui/utils/close-prun-window';

const tile = useTile();
const canOpenRt = canOpenCompanion(tile);

// The route text that the tile made. The import adds it to a route that is open in an RT window.
// RULE of the game developers: every action that makes the game talk to the server needs a click of the
// player. So nothing here runs by itself: CREATE ROUTE makes one empty route, and then every action of
// the import waits for a click on NEXT. The RT window is always visible. No hidden windows.
// The name prop is the auto name of the tour. The import gives it to the route.
const { text, error, name } = defineProps<{ text: string; error?: string; name?: string }>();

interface LogLine {
  message: string;
  kind: LogKind;
}

const maxLogLines = 300;

const routes = ref<{ label: string; value: string }[]>([]);
const target = ref('');
const log = ref<LogLine[]>([]);
const importPlan = ref<ImportPlan>();
// The text that the preview was made from.
const plannedText = ref('');
const running = ref(false);
const waitingNext = ref(false);
let stopAsked = false;
let nextResolve: ((choice: 'next' | 'skip') => void) | undefined;
// True while the RT list is open: only then can a route be created.
const listOpen = ref(false);
const creating = ref(false);
const knownRoutes = new Set<string>();
let pollTimer: ReturnType<typeof setInterval> | undefined;

const hasActions = computed(
  () => importPlan.value !== undefined && importPlan.value.todo.length > 0,
);
const ready = computed(() => hasActions.value && !running.value);

function say(message: string, kind: LogKind = 'info') {
  log.value.push({ message, kind });
  if (log.value.length > maxLogLines) {
    log.value.splice(0, log.value.length - maxLogLines);
  }
}

const now = () => new Date().toLocaleTimeString();

// A hidden log still shows its last line: it tells what the next click on NEXT does.
const hideLog = useSetting('hideLog');
const shownLog = computed(() => (hideLog.value ? log.value.slice(-1) : log.value));

function resetPlan() {
  importPlan.value = undefined;
}

// A plan is only valid for the text it was made from.
watch(
  () => [text, name],
  () => {
    if (!running.value) {
      resetPlan();
    }
  },
);

// Looks for the routes that are open in an RT window. A route that has just been opened is chosen.
// While the import runs, APEX replaces the route view with step windows, so nothing is read then.
function refreshRoutes() {
  listOpen.value = findRouteListFrame() !== undefined;
  if (running.value) {
    return;
  }
  const found = findRouteEditors()
    .filter(x => x.id !== '')
    .map(x => ({ label: x.name === x.id ? x.id : `${x.id} (${x.name})`, value: x.id }));
  routes.value = found;
  if (found.length === 0) {
    return;
  }
  const opened = found.find(x => !knownRoutes.has(x.value));
  for (const x of found) {
    knownRoutes.add(x.value);
  }
  if (opened) {
    target.value = opened.value;
  } else if (!found.some(x => x.value === target.value)) {
    target.value = found[0].value;
  }
}

onMounted(() => {
  refreshRoutes();
  pollTimer = setInterval(refreshRoutes, 1000);
});

onBeforeUnmount(() => {
  clearInterval(pollTimer);
  // An import that waits for NEXT must not wait for ever.
  stop();
});

// Opens RT beside this tile. You then click your route in the RT list.
async function openRt() {
  await openCompanionBuffer(tile, 'RT');
}

function targetEditor() {
  const editor = findRouteEditors().find(x => x.id === target.value);
  if (!editor) {
    throw new Error('Route not found. Open it in RT and close any step window.');
  }
  return editor;
}

// Reads the route from APEX now and compares it with the wanted text.
function makePlan(wantedText: string) {
  const editor = targetEditor();
  const current = exportRoute(editor, createTickerLookup());
  return { editor, plan: buildImportPlan(parseRouteText(wantedText), current, name) };
}

// Shows the new route in the RT tile beside this tile: the RT list in that tile is replaced by the route.
// If the game opened the route in a window of its own, that extra window is closed. The tile that this
// panel is in is never closed. If anything fails, the route stays where the game put it.
async function showInRtTile(created: CreatedRoute): Promise<RouteEditor> {
  const ownWindow = tile.frame.closest(`.${C.Window.window}`);
  // The view of a new route can come some seconds after its id.
  const fallback = async () => {
    const editor =
      created.editor ??
      (await waitFor(() => findRouteEditors().find(x => x.id === created.id), 8000));
    if (!editor) {
      throw new Error(`Route ${created.id} was created, but it is not open. Open it with RT.`);
    }
    return editor;
  };
  if (!tile.container.classList.contains(C.Node.child) || ownWindow === null) {
    say('This tile is not split: the route stays where the game put it.', 'warn');
    return await fallback();
  }
  const inOwnWindow = () =>
    findRouteEditors().find(x => x.id === created.id && ownWindow.contains(x.el));
  let shown = inOwnWindow();
  if (!shown) {
    say(`Opening ${created.id} in the RT tile...`);
    await openCompanionBuffer(tile, `RT ${created.id}`);
    shown = (await waitFor(inOwnWindow, 8000)) ?? undefined;
  }
  if (!shown) {
    say('The route did not open in the RT tile.', 'warn');
    return await fallback();
  }
  // Close the other windows that the game opened for this route.
  const extraWindows = findRouteEditors()
    .filter(x => x.id === created.id)
    .map(x => x.el.closest(`.${C.Window.window}`))
    .filter((x): x is Element => x !== null && x !== ownWindow);
  for (const win of new Set(extraWindows)) {
    try {
      closePrunWindow(win);
      await waitFor(() => !win.isConnected, 3000);
    } catch {
      say('The extra route window was not closed. Close it by hand.', 'warn');
    }
  }
  say('✓ The route is shown in the RT tile.', 'ok');
  return inOwnWindow() ?? shown;
}

// One click makes ONE new empty route in the game (the RT list must be open). Then the actions that fill
// the route (waypoints, settings, steps and Loop) wait for a click on NEXT each.
async function createNewRoute() {
  if (running.value || creating.value || !listOpen.value || error !== undefined) {
    return;
  }
  creating.value = true;
  log.value = [];
  resetPlan();
  let editor: RouteEditor | undefined;
  let planned: ImportPlan | undefined;
  try {
    say('Creating a new empty route...');
    const created = await createRoute();
    say(`✓ Route created: ${created.id}. It is empty.`, 'ok');
    editor = await showInRtTile(created);
    knownRoutes.add(editor.id);
    target.value = editor.id;
    refreshRoutes();
    plannedText.value = text;
    planned = makePlan(plannedText.value).plan;
  } catch (e) {
    say(`✗ ${e instanceof Error ? e.message : String(e)}`, 'err');
  } finally {
    creating.value = false;
  }
  if (editor && planned) {
    await execute(planned, editor);
  }
}

function preview() {
  log.value = [];
  resetPlan();
  say(`Preview (${now()}): route read from APEX now.`);
  plannedText.value = text;
  let plan: ImportPlan;
  try {
    if (error !== undefined) {
      throw new Error(error);
    }
    plan = makePlan(plannedText.value).plan;
  } catch (e) {
    say(`✗ ${e instanceof Error ? e.message : String(e)}`, 'err');
    return;
  }
  importPlan.value = plan;
  for (const note of plan.notes) {
    say(note);
  }
  let last: string | undefined;
  for (const item of plan.todo) {
    if (item.display !== last) {
      say(`— ${item.display}`);
      last = item.display;
    }
    const line = item.kind === 'step' ? `  ${item.pos}. ${todoText(item)}` : `  ${todoText(item)}`;
    say(line, item.kind !== 'step' || item.fix ? 'warn' : 'info');
  }
  say(
    plan.todo.length > 0
      ? `${plan.todo.length} action(s) (waypoints, settings, steps to add or fix, Loop): check them, then click START. Every action needs a click on NEXT: a step or the waypoint settings need one click to add, one to open the edit window, one to put in the values and one to save.`
      : 'Nothing to do: the route is already complete.',
    'ok',
  );
}

async function run() {
  const planned = importPlan.value;
  if (!planned || !ready.value) {
    return;
  }
  // The route may have been changed by hand since the preview: never import an old plan.
  let editor: RouteEditor | undefined;
  let fresh: ImportPlan | undefined;
  try {
    const made = makePlan(plannedText.value);
    editor = made.editor;
    fresh = made.plan;
  } catch {
    fresh = undefined;
  }
  if (!editor || !fresh || planKey(fresh) !== planKey(planned)) {
    resetPlan();
    say('✗ The route changed since the Preview: run Preview again before importing.', 'err');
    return;
  }

  await execute(planned, editor);
}

// Runs the actions of a plan in the route of the editor. Every action waits for a click on NEXT or SKIP.
async function execute(planned: ImportPlan, editor: RouteEditor) {
  running.value = true;
  stopAsked = false;
  say('Click NEXT to do the action that is shown, or SKIP to leave it out.', 'ok');
  try {
    await runImportPlan(planned, editor, createTickerLookup(), {
      say,
      shouldStop: () => stopAsked,
      waitForNext: () =>
        new Promise<'next' | 'skip'>(resolve => {
          nextResolve = resolve;
          waitingNext.value = true;
        }),
    });
  } finally {
    running.value = false;
    waitingNext.value = false;
    resetPlan();
  }
}

function answer(choice: 'next' | 'skip') {
  waitingNext.value = false;
  const resolve = nextResolve;
  nextResolve = undefined;
  resolve?.(choice);
}

function stop() {
  if (!running.value) {
    return;
  }
  stopAsked = true;
  say('Cancel asked: the current action finishes, then the import stops.', 'warn');
  answer('next');
}
</script>

<template>
  <SectionHeader>Send to route</SectionHeader>
  <SectionDescription>
    Fills a route with the route text above: name, waypoints, settings, steps and Loop. Click OPEN
    RT, then CREATE ROUTE (one new empty route), or open an existing route in RT and click PREVIEW
    and START. Every action needs your click on NEXT. Nothing runs by itself. It never assigns a
    ship and never deletes anything.
  </SectionDescription>
  <form @submit.prevent>
    <Active
      v-if="routes.length > 0"
      label="Route"
      tooltip="The routes that are open in an RT window. A step window must not be open.">
      <SelectInput v-model="target" :options="routes" />
    </Active>
    <Passive v-else label="Route">
      {{ canOpenRt ? 'Click OPEN RT, then click your route.' : 'Open a route with RT.' }}
    </Passive>
    <Commands>
      <PrunButton v-if="canOpenRt" primary :disabled="running" @click="openRt">OPEN RT</PrunButton>
      <PrunButton
        primary
        data-tooltip-position="top"
        :data-tooltip="
          listOpen
            ? 'Makes one new empty route in the game. Then you click NEXT for each action that fills it.'
            : 'The RT list must be open. Click OPEN RT first.'
        "
        :disabled="running || creating || !listOpen || error !== undefined"
        @click="createNewRoute">
        CREATE ROUTE
      </PrunButton>
      <PrunButton
        primary
        :disabled="running || creating || target === '' || error !== undefined"
        @click="preview()">
        PREVIEW
      </PrunButton>
    </Commands>
    <Commands label="LOG">
      <PrunButton
        neutral
        data-tooltip-position="top"
        data-tooltip="Hides the log. Its last line stays."
        @click="hideLog = !hideLog">
        {{ hideLog ? 'SHOW LOG' : 'HIDE LOG' }}
      </PrunButton>
    </Commands>
    <Commands v-if="hasActions || running" label="IMPORT">
      <PrunButton primary :disabled="!ready" @click="run()">START</PrunButton>
      <PrunButton v-if="waitingNext" success @click="answer('next')">NEXT</PrunButton>
      <PrunButton v-if="waitingNext" neutral @click="answer('skip')">SKIP</PrunButton>
      <PrunButton v-if="running" danger @click="stop">CANCEL</PrunButton>
    </Commands>
  </form>
  <div v-if="log.length > 0" :class="$style.log">
    <div v-for="(line, i) in shownLog" :key="i" :class="$style[line.kind]">{{ line.message }}</div>
  </div>
</template>

<style module>
.log {
  max-height: 16rem;
  overflow-y: auto;
  margin: 0.25rem 0;
  padding: 4px;
  background: #23282b;
  font-family: monospace;
  font-size: 11px;
  white-space: pre-wrap;
}

.info {
  color: #ddd;
}

.ok {
  color: #5cb85c;
}

.warn {
  color: #f7a600;
}

.err {
  color: rgb(217, 83, 79);
}
</style>
