// Reads and drives the route editor of APEX (the RT window).
// Ported from the extension "PrUn Route Export / Import" by the same author, which was tested in the game.
//
// Elements are found by the stable part of the CSS class names ("Waypoint__container___L2BwRfr":
// the hash after "___" changes with game updates) and by the labels shown on screen.
// If APEX changes, update the tables SEL, FORM and the label patterns below.
//
// SAFETY: this code never clicks assign, unassign, delete or remove. safeClick checks the text, the
// hidden name (title, aria-label) and the red "danger" style of every button before a click.
import { selectAddress } from '@src/infrastructure/prun-ui/utils/select-address';
import {
  changeInputValue,
  changeSelectIndex,
  clickElement,
  focusElement,
  selectMaterialInMaterialSelector,
} from '@src/util';
import { sleep } from '@src/utils/sleep';
import {
  locationQuery,
  matchesWaypoint,
  summaryToStep,
  type RouteSnapshot,
  type SnapshotStep,
  type TickerLookup,
} from '@src/features/XIT/ROUTEBURNS/route-snapshot';
import {
  describeSettings,
  describeStep,
  type Amount,
  type RouteStep,
  type WaypointSettings,
} from '@src/features/XIT/ROUTEBURNS/route-text';

export interface RouteEditor {
  // Natural id of the route, for example "RT-FYDY-8772".
  id: string;
  name: string;
  el: HTMLElement;
  // The frame of the buffer. It stays in the page while the route view inside it is redrawn.
  frame: HTMLElement;
}

// How long to wait for APEX to show a saved value. The server takes about 0.5 s.
const saveTimeout = 8000;

export const stepButtons: Record<RouteStep['type'], string> = {
  load: 'Load',
  unload: 'Unload',
  refuel: 'Refuel',
  unloadFuel: 'Unload fuel',
  wait: 'Wait',
  loadShipment: 'Load shipment',
  unloadShipment: 'Unload shipment',
};

// Never click anything with these texts, nor anything whose title or aria-label says so.
// The real delete buttons are icons without text.
const forbiddenText = /^(assign|unassign|delete|remove|x)$/i;
const forbiddenName = /\b(assign|unassign|delete|remove)\b/i;

const editWaypointLabel = /^edit waypoint$/i;
const editStepLabel = /^edit step$/i;
const loopLabel = /^loop$/i;
const addWaypointLabel = /^add waypoint$/i;
const fieldFuel = /^fuel usage$/i;
const fieldReactor = /^reactor usage$/i;
const fieldPreference = /^route preferences$/i;
const gatewaysLabel = /^use gateways$/i;
const fieldRetain = /retain/i;
const fieldDurationAmount = /^(?!.*unit)(duration|amount|time|wait)/i;
const fieldDurationUnit = /unit/i;

const durationUnits: [string, number][] = [
  ['days', 86400],
  ['hours', 3600],
  ['minutes', 60],
  ['seconds', 1],
];

const css = (name: string) => `[class*="${name}___"]`;

const SEL = {
  header: css('Route__header'),
  name: css('Route__name'),
  id: css('Route__naturalId'),
  waypoint: css('Waypoint__container'),
  destination: css('Waypoint__destination'),
  stepButtons: css('Waypoint__commandsSteps'),
  step: css('Step__container'),
  stepType: css('Step__type'),
  stepSummary: css('Step__summary'),
};

const FORM = {
  frame: css('TileFrame__body'),
  overlayForm: `${css('Overlay__overlay')} form`,
  title: css('SectionHeader__container'),
  row: '[class*="FormComponent__container"]',
  rowHidden: 'FormComponent__containerHidden',
  radio: css('RadioItem__container'),
  radioValue: css('RadioItem__value'),
  radioActive: css('RadioItem__active'),
};

const ADDRESS = { input: css('AddressSelector__input') };

// ---------- small helpers ----------

// The text content, not innerText: APEX shows some labels in capitals with CSS ("save" -> "SAVE").
export const fullText = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim();

const matches = (text: string, want: RegExp | string) =>
  want instanceof RegExp ? want.test(text) : text.toLowerCase() === want.toLowerCase();

// The DOM lib of this project cannot loop over a NodeList, and its typed selectors do not take a type
// argument. These two helpers give a plain array and a plain element.
export function qs(root: ParentNode | null | undefined, selector: string) {
  return (root?.querySelector(selector) ?? null) as HTMLElement | null;
}

export function qsa(root: ParentNode, selector: string) {
  return Array.from(root.querySelectorAll(selector)) as HTMLElement[];
}

const numberOr = (value: string | null | undefined, fallback: number) => {
  const number = Number(value);
  return Number.isFinite(number) && number !== 0 ? number : fallback;
};

export async function waitFor<T>(
  fn: () => T | null | undefined | false,
  timeout = 4000,
  every = 100,
): Promise<T | null> {
  const end = Date.now() + timeout;
  for (;;) {
    const value = fn();
    if (value !== null && value !== undefined && value !== false) {
      return value;
    }
    if (Date.now() > end) {
      return null;
    }
    await sleep(every);
  }
}

const buttonsOf = (root: Element) => qsa(root, 'button');

// The pencil buttons have no text: their name is in aria-label or title.
const findIconButton = (root: Element, label: RegExp) =>
  buttonsOf(root).find(b =>
    label.test(b.getAttribute('aria-label') ?? b.getAttribute('title') ?? ''),
  );

const findButton = (root: Element, label: RegExp) =>
  buttonsOf(root).find(b => label.test(fullText(b)));

export function isForbidden(el: Element) {
  const button = el.closest('button') ?? el;
  const names = [button.getAttribute('title'), button.getAttribute('aria-label')];
  return (
    forbiddenText.test(fullText(el)) ||
    names.some(x => x !== null && forbiddenName.test(x)) ||
    /Button__danger/.test(button.getAttribute('class') ?? '')
  );
}

async function safeClick(el: HTMLElement, what: string) {
  if (isForbidden(el)) {
    const button = el.closest('button') ?? el;
    const names = [fullText(el), button.getAttribute('aria-label'), button.getAttribute('title')];
    const name = names.find(x => x !== null && x !== '') ?? '?';
    throw new Error(`refusing to click "${name}" (${what})`);
  }
  await clickElement(el);
}

function setInput(input: HTMLInputElement, value: string) {
  focusElement(input);
  changeInputValue(input, value);
}

// ---------- route editors and waypoints ----------

export function findRouteEditors(): RouteEditor[] {
  const editors: RouteEditor[] = [];
  for (const header of qsa(document, SEL.header)) {
    const el = header.parentElement;
    if (!el) {
      continue;
    }
    editors.push({
      id: fullText(header.querySelector(SEL.id) ?? header),
      name: fullText(header.querySelector(SEL.name) ?? header),
      el,
      frame: (el.closest('[class*="TileFrame__body___"]') as HTMLElement | null) ?? document.body,
    });
  }
  return editors;
}

// The frame of the RT list ("Routes"), seen in the page structure: its command is exactly "RT".
export function findRouteListFrame() {
  return qsa(document, css('TileFrame__frame')).find(
    frame => fullText(qs(frame, css('TileFrame__cmd')) ?? frame).toUpperCase() === 'RT',
  );
}

// Natural id of a route, for example "RT-FYDY-8772".
const routeIdPattern = /\b[A-Z]{2}-[A-Z0-9]{3,5}-\d{3,5}\b/g;

// All route ids that are visible now: open route views, commands of RT tiles ("RT RT-XXXX-1234") and
// the rows of the RT list.
function visibleRouteIds() {
  const ids = new Set<string>();
  for (const editor of findRouteEditors()) {
    if (editor.id !== '') {
      ids.add(editor.id);
    }
  }
  for (const frame of qsa(document, css('TileFrame__frame'))) {
    const command = fullText(qs(frame, css('TileFrame__cmd')) ?? frame).toUpperCase();
    if (/^RT(\s|$)/.test(command)) {
      for (const id of command.match(routeIdPattern) ?? []) {
        ids.add(id);
      }
    }
  }
  // Read each link of the list alone: the cells touch each other in the text ("RT-XPPI-5752" + "0"
  // gives "RT-XPPI-57520"). Never use a regex on the text of a whole table.
  const list = findRouteListFrame();
  if (list) {
    for (const link of qsa(list, `tbody ${css('Link__link')}`)) {
      const text = fullText(link).toUpperCase();
      if (new RegExp(`^${routeIdPattern.source}$`).test(text)) {
        ids.add(text);
      }
    }
  }
  return ids;
}

export interface CreatedRoute {
  id: string;
  // The route view, if the game opened one.
  editor?: RouteEditor;
}

// Clicks "Create route" in the RT list. APEX makes a new EMPTY route ("Unnamed route") at once, with no
// form. Seen in the game: it opens no window, it only adds a row at the top of the list. The row shows the
// id because the route has no name (a named route shows its name, not its id). It returns the id of the
// new route, and its view if one is open.
export async function createRoute(): Promise<CreatedRoute> {
  const frame = findRouteListFrame();
  if (!frame) {
    throw new Error('The RT list is not open. Click OPEN RT first.');
  }
  const button = findButton(frame, /^create route$/i);
  if (!button) {
    throw new Error('The "Create route" button was not found in the RT list');
  }
  const before = visibleRouteIds();
  await safeClick(button, 'create route');
  const id = await waitFor(
    () => Array.from(visibleRouteIds()).find(x => !before.has(x)),
    saveTimeout,
  );
  if (!id) {
    throw new Error(
      `no new route appeared ${saveTimeout / 1000} s after the click: look in the RT list`,
    );
  }
  // The view of the route can come a moment after its id.
  const editor = await waitFor(() => findRouteEditors().find(x => x.id === id), 1500);
  return { id, editor: editor ?? undefined };
}

interface WaypointRow {
  row: HTMLElement;
  name: string;
}

function waypointRows(routeEl: Element): WaypointRow[] {
  return qsa(routeEl, SEL.waypoint).map(row => {
    const nameEl = row.querySelector(SEL.destination);
    return { row, name: nameEl ? fullText(nameEl) : '?' };
  });
}

interface StepLine {
  verb: string;
  rest: string;
  el: HTMLElement;
}

function stepLines(wp: WaypointRow): StepLine[] {
  return qsa(wp.row, SEL.step).map(el => ({
    verb: fullText(el.querySelector(SEL.stepType) ?? el),
    rest: fullText(el.querySelector(SEL.stepSummary) ?? el),
    el,
  }));
}

const countSteps = (wp: WaypointRow) => wp.row.querySelectorAll(SEL.step).length;

function frameOf(editor: RouteEditor) {
  if (document.body.contains(editor.frame)) {
    return editor.frame;
  }
  const frame = editor.el.closest(FORM.frame) as HTMLElement | null;
  if (!frame) {
    throw new Error(`the buffer of route ${editor.id} is closed`);
  }
  return frame;
}

// The route view of this buffer. While a step window is open, APEX replaces it by an overlay.
function routeIn(frame: Element, id: string) {
  const header = qs(frame, SEL.header);
  if (!header || !fullText(header).includes(id) || !header.parentElement) {
    return undefined;
  }
  return { id, el: header.parentElement };
}

function liveRoute(editor: RouteEditor) {
  const route = routeIn(frameOf(editor), editor.id);
  if (!route) {
    throw new Error(`route ${editor.id} is not shown in its buffer (close any open window)`);
  }
  return route;
}

function liveWaypoint(editor: RouteEditor, index: number) {
  const wp = waypointRows(liveRoute(editor).el)[index] as WaypointRow | undefined;
  if (!wp) {
    throw new Error(`waypoint ${index + 1} not found in the route`);
  }
  return wp;
}

export function countWaypoints(editor: RouteEditor) {
  return waypointRows(liveRoute(editor).el).length;
}

function findDialog(frame: ParentNode | null, title = /step$/i) {
  const forms = qsa(frame ?? document, FORM.overlayForm);
  return forms.find(f => title.test(fullText(f.querySelector(FORM.title) ?? f)));
}

function formRow(form: Element, label: RegExp | string) {
  return qsa(form, FORM.row).find(row => {
    const labelEl = row.querySelector('label');
    return labelEl !== null && matches(fullText(labelEl), label);
  });
}

// The real boxes carry a stable name: "minimum.units", "maximum.units", "retain", "amount" and "unit".
function rowByName(form: Element, name: string) {
  const el = form.querySelector(`input[name="${name}"], select[name="${name}"]`);
  return (el?.closest(FORM.row) as HTMLElement | null) ?? undefined;
}

// ---------- reading ----------

export function exportRoute(editor: RouteEditor, tickerOf: TickerLookup): RouteSnapshot {
  const route = liveRoute(editor);
  return {
    routeName: editor.name,
    loop: readLoop(route.el),
    waypoints: waypointRows(route.el).map(wp => ({
      name: wp.name,
      steps: stepLines(wp).map(line => summaryToStep(line.verb, line.rest, tickerOf)),
    })),
  };
}

// Loop is a passive row under the route header with one RadioItem "Loop" (on = RadioItem__active).
function loopItem(routeEl: Element) {
  const row = formRow(routeEl, loopLabel);
  return row ? qsa(row, FORM.radio).find(x => loopLabel.test(fullText(x))) : undefined;
}

// True or false, or undefined when the route view has no Loop row.
function readLoop(routeEl: Element) {
  const item = loopItem(routeEl);
  return item ? item.querySelector(FORM.radioActive) !== null : undefined;
}

export async function setLoop(editor: RouteEditor, on: boolean) {
  const frame = frameOf(editor);
  const item = loopItem(liveRoute(editor).el);
  if (!item) {
    throw new Error('Loop not found in the route settings');
  }
  if ((item.querySelector(FORM.radioActive) !== null) === on) {
    return;
  }
  await safeClick(item, 'loop');
  const done = await waitFor(() => {
    const route = routeIn(frame, editor.id);
    return route !== undefined && readLoop(route.el) === on;
  }, saveTimeout);
  if (!done) {
    throw new Error(`Loop did not turn ${on ? 'on' : 'off'}`);
  }
}

// ---------- action feedback ----------

// After a save, APEX shows a green "Action succeeded!" overlay over the route until the player clicks it.
// The click only closes the overlay: nothing goes to the server. XIT ACT does the same
// (waitActionFeedback with dismissSuccess). An error overlay stays, so the player sees it.
// The overlay is in the whole tile frame, not in its body: it also covers the context controls
// (RT, RTE, FLT).
function feedbackFrame(editor: RouteEditor) {
  const body = frameOf(editor);
  return body.closest(css('TileFrame__frame')) ?? body;
}

export async function dismissSuccess(editor: RouteEditor, timeout = 3000) {
  const frame = feedbackFrame(editor);
  const success = await waitFor(() => qs(frame, `.${C.ActionFeedback.success}`), timeout, 50);
  if (!success) {
    return;
  }
  await clickElement(success);
  await waitFor(() => !success.isConnected, 2000, 50);
}

// Waits for the green or the red overlay after a save. 'none' when APEX shows neither in time.
async function waitFeedback(editor: RouteEditor, timeout: number) {
  const frame = feedbackFrame(editor);
  const found = await waitFor(
    () => qs(frame, `.${C.ActionFeedback.success}`) ?? qs(frame, `.${C.ActionFeedback.error}`),
    timeout,
    50,
  );
  if (!found) {
    return { result: 'none' as const, message: '' };
  }
  const result = found.classList.contains(C.ActionFeedback.success) ? 'success' : 'error';
  const message = fullText(qs(found, `.${C.ActionFeedback.message}`) ?? found);
  return { result, message } as const;
}

// ---------- route name ----------

// Seen in the game: a click on the route name ("Unnamed route") changes it into a text box. The player
// types the name and presses Enter. The text box closes when it loses the focus (for example on a click
// on NEXT), so renameRoute does all of it in ONE action.

function nameInput(editor: RouteEditor) {
  const header = qs(frameOf(editor), SEL.header);
  return (qs(header, 'input') as HTMLInputElement | null) ?? undefined;
}

// Click on the name, type the name, Enter. If a part fails, the text box is closed with Escape.
export async function renameRoute(editor: RouteEditor, name: string) {
  try {
    await openRouteName(editor);
    await typeRouteName(editor, name);
  } catch (e) {
    try {
      await cancelRouteName(editor);
    } catch {
      // The first error is the one to show.
    }
    throw e;
  }
  await saveRouteName(editor, name);
}

async function openRouteName(editor: RouteEditor) {
  if (nameInput(editor)) {
    return;
  }
  const header = qs(liveRoute(editor).el, SEL.header);
  const nameEl = qs(header, SEL.name);
  if (!nameEl) {
    throw new Error('the route name was not found');
  }
  await safeClick(qs(nameEl, 'span') ?? nameEl, 'route name');
  if (!(await waitFor(() => nameInput(editor), 3000))) {
    throw new Error('no text box appeared after a click on the route name');
  }
}

async function typeRouteName(editor: RouteEditor, name: string) {
  const input = nameInput(editor);
  if (!input) {
    throw new Error('the text box of the route name is not open');
  }
  setInput(input, name);
  if (!(await waitFor(() => input.value === name, 1000, 20))) {
    throw new Error(`the text box shows "${input.value}", not "${name}"`);
  }
}

function pressKey(input: HTMLInputElement, key: 'Enter' | 'Escape') {
  const keyCode = key === 'Enter' ? 13 : 27;
  for (const type of ['keydown', 'keypress', 'keyup'] as const) {
    const event = new KeyboardEvent(type, { key, code: key, bubbles: true, cancelable: true });
    // Some game inputs read only the legacy codes.
    Object.defineProperty(event, 'keyCode', { get: () => keyCode });
    Object.defineProperty(event, 'which', { get: () => keyCode });
    input.dispatchEvent(event);
  }
}

// Presses Enter in the text box, then waits until the route shows the new name.
async function saveRouteName(editor: RouteEditor, name: string) {
  const input = nameInput(editor);
  if (!input) {
    throw new Error('the text box of the route name is not open');
  }
  focusElement(input);
  pressKey(input, 'Enter');
  const shown = () => {
    const header = qs(frameOf(editor), SEL.header);
    const nameEl = qs(header, SEL.name);
    return !nameInput(editor) && nameEl !== null && fullText(nameEl) === name;
  };
  if (!(await waitFor(shown, saveTimeout))) {
    throw new Error(`the route does not show the name "${name}" after Enter`);
  }
}

// Leaves the text box of the route name without saving (Escape). It does nothing when it is not open.
async function cancelRouteName(editor: RouteEditor) {
  const input = nameInput(editor);
  if (!input) {
    return;
  }
  // No blur: a blur may save the name in the game.
  pressKey(input, 'Escape');
  if (!(await waitFor(() => !nameInput(editor), 2000))) {
    throw new Error('the text box of the route name is still open: close it by hand');
  }
}

// ---------- adding a waypoint ----------

// Adds a waypoint at the end of the route: type the location, choose the suggestion, click "Add waypoint".
// It returns the name that APEX shows for the new waypoint.
export async function addWaypoint(editor: RouteEditor, wanted: string) {
  const frame = frameOf(editor);
  const route = liveRoute(editor);
  const before = waypointRows(route.el).length;
  const query = locationQuery(wanted);
  const found = await selectAddress(route.el, query);
  if (!found) {
    const input = qs(route.el, ADDRESS.input) as HTMLInputElement | null;
    if (input) {
      setInput(input, '');
    }
    throw new Error(`no location found for "${query}" (waypoint "${wanted}")`);
  }

  const addButton = await waitFor(() => {
    const current = routeIn(frame, editor.id);
    const button = current && findButton(current.el, addWaypointLabel);
    return button && !button.hasAttribute('disabled') && !/Button__disabled/.test(button.className)
      ? button
      : null;
  }, 3000);
  if (!addButton) {
    throw new Error(`"Add waypoint" stayed disabled after choosing "${query}"`);
  }
  await safeClick(addButton, 'add waypoint');

  const added = await waitFor(() => {
    const current = routeIn(frame, editor.id);
    const rows = current ? waypointRows(current.el) : [];
    return rows.length === before + 1 ? rows[before] : null;
  }, saveTimeout);
  if (!added) {
    throw new Error(
      `waypoint "${wanted}" was not added (no new waypoint after ${saveTimeout / 1000} s)`,
    );
  }
  if (!matchesWaypoint(added.name, wanted) && !matchesWaypoint(added.name, query)) {
    throw new Error(
      `added waypoint is "${added.name}", which does not match "${wanted}": check it in APEX`,
    );
  }
  return added.name;
}

// ---------- forms of the step windows ----------

async function chooseRadio(form: Element, label: string, want: RegExp | string) {
  const row = formRow(form, label);
  if (!row) {
    throw new Error(`field "${label}" not found in the step window`);
  }
  const items = qsa(row, FORM.radio);
  const item = items.find(x => matches(fullText(x.querySelector(FORM.radioValue) ?? x), want));
  if (!item) {
    throw new Error(
      `choice ${want} not found in "${label}" (choices: ${items.map(x => fullText(x)).join(', ')})`,
    );
  }
  if (!item.querySelector(FORM.radioActive)) {
    await safeClick(item, label);
    await waitFor(() => item.querySelector(FORM.radioActive), 1000);
  }
}

async function setAmount(form: Element, label: 'Minimum' | 'Maximum', amount: Amount) {
  if ('all' in amount) {
    await chooseRadio(form, label, /^(all carried|capacity)$/i);
    return;
  }
  await chooseRadio(form, label, 'units');
  const row = await waitFor(() => {
    const found =
      rowByName(form, `${label.toLowerCase()}.units`) ?? formRow(form, `${label} units`);
    return found && !found.className.includes(FORM.rowHidden) ? found : null;
  }, 1500);
  const input = row?.querySelector('input');
  if (!input) {
    throw new Error(`number box "${label} units" did not appear`);
  }
  setInput(input, String(amount.units));
  if (!(await waitFor(() => Number(input.value) === amount.units, 1000, 20))) {
    throw new Error(`"${label} units" shows ${input.value}, not ${amount.units}`);
  }
}

// Wait: the biggest unit that divides the duration exactly, for example 108000 s -> 30 hours.
async function setDuration(form: Element, seconds: number) {
  const [unit, size] = durationUnits.find(([, s]) => seconds % s === 0) ?? durationUnits[3];
  const amountRow = rowByName(form, 'amount') ?? formRow(form, fieldDurationAmount);
  const input = amountRow?.querySelector('input');
  if (!input) {
    throw new Error('no duration box in the Wait window (enter this step by hand)');
  }
  const unitRow = rowByName(form, 'unit') ?? formRow(form, fieldDurationUnit);
  if (!unitRow) {
    throw new Error('no duration unit in the Wait window (enter this step by hand)');
  }
  // "days" matches "Days", "day" and "DAYS".
  const want = new RegExp(`^${unit.slice(0, -1)}s?$`, 'i');
  const select = unitRow.querySelector('select');
  if (select) {
    const options = Array.from(select.options);
    const index = options.findIndex(o => want.test(fullText(o)) || want.test(o.value));
    if (index < 0) {
      throw new Error(
        `unit ${unit} not found (choices: ${options.map(o => fullText(o)).join(', ')})`,
      );
    }
    changeSelectIndex(select, index);
  } else {
    await chooseRadio(form, fullText(unitRow.querySelector('label') ?? unitRow), want);
  }
  setInput(input, String(seconds / size));
}

async function setMaterial(form: Element, ticker: string) {
  const row = formRow(form, 'Material');
  if (!row) {
    throw new Error('Material box not found in the step window');
  }
  const timeout = async () => {
    await sleep(10000);
    return false;
  };
  const chosen = await Promise.race([selectMaterialInMaterialSelector(row, ticker), timeout()]);
  if (!chosen) {
    throw new Error(`no suggestion for material ${ticker}`);
  }
  await sleep(100);
}

// ---------- adding and editing steps ----------

// Each exported function below is ONE action of the import: the player clicks NEXT before each one.
// Between two actions the step window stays open. Step by step:
//   addDefaultStep -> openStepWindow -> fillStepWindow -> saveStepWindow
// A step to fix starts at openStepWindow.

// How APEX adds a step: the step button of the waypoint ("Unload"...) opens NO window. It appends a step
// with default values at once. The values are then set in the "Edit <type> step" window, which the pencil
// of the step opens. It returns true if APEX opened the step window at once instead.
export async function addDefaultStep(editor: RouteEditor, waypointIndex: number, step: RouteStep) {
  const frame = frameOf(editor);
  const wp = liveWaypoint(editor, waypointIndex);
  const before = countSteps(wp);
  // The step buttons are always in the page (only hidden until hover), so no hover is needed.
  const label = stepButtons[step.type];
  const bar = wp.row.querySelector(SEL.stepButtons);
  const button = bar && buttonsOf(bar).find(b => matches(fullText(b), label));
  if (!button) {
    throw new Error(`button "${label}" not found on waypoint "${wp.name}"`);
  }
  await safeClick(button, label);

  const stepAdded = () => {
    const route = routeIn(frame, editor.id);
    return route !== undefined && countSteps(waypointRows(route.el)[waypointIndex]) === before + 1;
  };
  const appeared = await waitFor(() => stepAdded() || findDialog(frame), saveTimeout);
  if (appeared === null) {
    throw new Error(`no step appeared after clicking "${label}" on "${wp.name}"`);
  }
  return findDialog(frame) !== undefined;
}

// Clicks the pencil of the step. stepIndex is the 0-based position of the step in the waypoint.
export async function openStepWindow(
  editor: RouteEditor,
  waypointIndex: number,
  stepIndex: number,
  step: RouteStep,
  tickerOf: TickerLookup,
) {
  const frame = frameOf(editor);
  const wp = liveWaypoint(editor, waypointIndex);
  const line = stepLines(wp)[stepIndex] as StepLine | undefined;
  if (!line) {
    throw new Error(`step ${stepIndex + 1} not found on "${wp.name}"`);
  }
  const seenType = summaryToStep(line.verb, line.rest, tickerOf);
  if ('comment' in seenType || seenType.type !== step.type) {
    throw new Error(
      `step ${stepIndex + 1} of "${wp.name}" is a ${line.verb}, not a ${stepButtons[step.type]}`,
    );
  }
  const pencil = findIconButton(line.el, editStepLabel);
  if (!pencil) {
    throw new Error(`edit button not found on step ${stepIndex + 1} of "${wp.name}"`);
  }
  await safeClick(pencil, 'edit step');
  const form = await waitFor(() => findDialog(frame), 3000);
  if (!form) {
    throw new Error(`the edit window of step ${stepIndex + 1} did not open`);
  }
}

// Puts the values of the step in the open step window. It does not save.
export async function fillStepWindow(editor: RouteEditor, step: RouteStep) {
  const form = findDialog(frameOf(editor));
  if (!form) {
    throw new Error('the step window is not open');
  }
  try {
    if ('material' in step) {
      await setMaterial(form, step.material);
    }
    if ('tank' in step) {
      await chooseRadio(form, 'Tank', new RegExp(`^${step.tank} tank$`, 'i'));
    }
    if (step.type === 'refuel') {
      await chooseRadio(form, 'Fuel source', step.source === 'ship' ? 'ship store' : 'local store');
    }
    if ('min' in step) {
      await setAmount(form, 'Minimum', step.min);
      await setAmount(form, 'Maximum', step.max);
    }
    if (step.type === 'load') {
      const row = rowByName(form, 'retain') ?? formRow(form, fieldRetain);
      const input = row?.querySelector('input');
      if (input) {
        // 0 means no retain. It also clears an old value.
        setInput(input, String(step.retain ?? 0));
      } else if (step.retain !== undefined) {
        throw new Error('no retain box in the Load window');
      }
    }
    if (step.type === 'wait') {
      await setDuration(form, step.seconds);
    }
  } catch (e) {
    // Leave the game as it was: close the window without saving.
    await cancelOpenWindow(editor);
    throw e;
  }
}

// Clicks save in the open step window, then checks what APEX shows.
export async function saveStepWindow(
  editor: RouteEditor,
  waypointIndex: number,
  stepIndex: number,
  step: RouteStep,
  tickerOf: TickerLookup,
) {
  const frame = frameOf(editor);
  const form = findDialog(frame);
  if (!form) {
    throw new Error('the step window is not open');
  }
  const save = findButton(form, /^save$/i);
  if (!save) {
    throw new Error('save button not found');
  }
  await safeClick(save, 'save');
  if (!(await waitFor(() => !findDialog(frame) && routeIn(frame, editor.id), 3000))) {
    throw new Error(
      'the step window did not close after save (a value may be refused): close it with cancel',
    );
  }

  // Read the step back: it must become exactly what was asked. The window closes at once, but the route
  // shows the OLD values for about 0.5 s while the server saves, so keep reading.
  let seen = undefined as SnapshotStep | undefined;
  const ok = await waitFor(() => {
    const route = routeIn(frame, editor.id);
    const wp = route && waypointRows(route.el)[waypointIndex];
    const current = wp && stepLines(wp)[stepIndex];
    if (current) {
      seen = summaryToStep(current.verb, current.rest, tickerOf);
    }
    return seen !== undefined && !('comment' in seen) && describeStep(seen) === describeStep(step);
  }, saveTimeout);
  if (!ok) {
    const shown = seen !== undefined && !('comment' in seen) ? describeStep(seen) : '?';
    const name = liveWaypoint(editor, waypointIndex).name;
    throw new Error(
      `step ${stepIndex + 1} of "${name}" still shows "${shown}" ${saveTimeout / 1000} s ` +
        `after save, not "${describeStep(step)}"`,
    );
  }
}

async function cancelDialog(form: Element) {
  const cancel = findButton(form, /^cancel$/i);
  if (cancel) {
    await clickElement(cancel);
  }
}

// Closes the open step or waypoint window of the route with cancel. Nothing is saved.
// It does nothing when no window is open.
export async function cancelOpenWindow(editor: RouteEditor) {
  const frame = frameOf(editor);
  const form = qsa(frame, FORM.overlayForm)[0] as HTMLElement | undefined;
  if (!form) {
    return;
  }
  await cancelDialog(form);
  await waitFor(() => qsa(frame, FORM.overlayForm).length === 0 && routeIn(frame, editor.id), 3000);
}

// ---------- waypoint settings ----------

// The "Edit waypoint" window has "Fuel usage" and "Reactor usage" sliders (value in aria-valuenow, 1 to 100),
// a "Route preferences" select (LEAST_JUMPS or SHORTEST_FTL) and a "Use gateways" RadioItem.
function sliderValue(form: Element, label: RegExp) {
  const handle = formRow(form, label)?.querySelector('[role="slider"]');
  const raw = handle?.getAttribute('aria-valuenow');
  if (raw === null || raw === undefined || raw === '') {
    throw new Error(`slider ${label.source} not found in the Edit waypoint window`);
  }
  return Number(raw);
}

function gatewaysItem(form: Element) {
  const row = formRow(form, fieldPreference);
  const item = row && qsa(row, FORM.radio).find(x => gatewaysLabel.test(fullText(x)));
  return { row, item };
}

function readSettingsFrom(form: Element): Required<WaypointSettings> {
  const { row, item } = gatewaysItem(form);
  const select = row?.querySelector('select');
  if (!select) {
    throw new Error('route preference not found in the Edit waypoint window');
  }
  if (!item) {
    throw new Error('"Use gateways" not found in the Edit waypoint window');
  }
  return {
    fuel: sliderValue(form, fieldFuel),
    reactor: sliderValue(form, fieldReactor),
    preference: select.value === 'SHORTEST_FTL' ? 'shortestFtl' : 'leastJumps',
    gateways: item.querySelector(FORM.radioActive) !== null,
  };
}

async function openWaypointDialog(editor: RouteEditor, index: number) {
  const frame = frameOf(editor);
  const wp = liveWaypoint(editor, index);
  const pencil = findIconButton(wp.row, editWaypointLabel);
  if (!pencil) {
    throw new Error(`edit button not found on waypoint "${wp.name}"`);
  }
  await safeClick(pencil, 'edit waypoint');
  const form = await waitFor(() => findDialog(frame, editWaypointLabel), 3000);
  if (!form) {
    throw new Error(`the "Edit waypoint" window of "${wp.name}" did not open`);
  }
  return { frame, wp, form };
}

// Read only: it opens the pencil window, reads, and always leaves with cancel. It never saves.
export async function readWaypointSettings(editor: RouteEditor, index: number) {
  const { frame, wp, form } = await openWaypointDialog(editor, index);
  let settings: Required<WaypointSettings> | undefined;
  let error: unknown;
  try {
    settings = readSettingsFrom(form);
  } catch (e) {
    error = e;
  }
  await cancelDialog(form);
  const closed = await waitFor(
    () => !findDialog(frame, editWaypointLabel) && routeIn(frame, editor.id),
    3000,
  );
  if (error !== undefined) {
    throw error;
  }
  if (!closed || !settings) {
    throw new Error(
      `the "Edit waypoint" window of "${wp.name}" did not close: close it with cancel`,
    );
  }
  return settings;
}

function mouseAt(target: EventTarget, type: string, x: number, y: number) {
  target.dispatchEvent(
    new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: x,
      clientY: y,
      button: 0,
      buttons: type === 'mouseup' ? 0 : 1,
    }),
  );
}

// An rc-slider (1 to 100) cannot be typed into, and simulated arrow keys do not move it in the game.
// So click its bar where the value is: on mousedown rc-slider turns the click position into a value,
// as when a player clicks the bar. The click goes on the rail, not on the handle (a click on the handle
// starts a drag). Up to 4 clicks, each one corrected by the difference between the value obtained and
// the value wanted (rounding).
async function setSlider(form: Element, label: RegExp, target: number) {
  const row = () => formRow(form, label);
  const handle = () => qs(row(), '[role="slider"]') ?? null;
  const value = () => {
    const h = handle();
    return h ? Number(h.getAttribute('aria-valuenow')) : NaN;
  };
  const name = label.source.replace(/[\^$]/g, '');
  if (!handle()) {
    throw new Error(`slider ${name} not found in the Edit waypoint window`);
  }
  let aim = target;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (value() === target) {
      return;
    }
    const slider = qs(row(), '.rc-slider');
    const rail = qs(slider, '.rc-slider-rail') ?? slider;
    const rect = slider?.getBoundingClientRect();
    if (!slider || !rail || !rect || rect.width === 0) {
      throw new Error(`the ${name} slider is not visible: set it to ${target} % by hand`);
    }
    const h = handle();
    const min = numberOr(h?.getAttribute('aria-valuemin'), 1);
    const max = numberOr(h?.getAttribute('aria-valuemax'), 100);
    // The click may land a little outside the bar: rc-slider clamps to min and max.
    // This is how 1 % and 100 % are reached.
    const clamped = Math.min(max + 10, Math.max(min - 10, aim));
    const x = rect.left + (rect.width * (clamped - min)) / (max - min);
    const y = rect.top + rect.height / 2;
    const before = value();
    mouseAt(rail, 'mousedown', x, y);
    await sleep(0);
    mouseAt(rail, 'mouseup', x, y);
    mouseAt(document, 'mouseup', x, y);
    await waitFor(() => value() !== before, 1000, 20);
    if (value() === before && before !== target && attempt === 0) {
      throw new Error(
        `the ${name} slider does not move when its bar is clicked: set it to ${target} % by hand`,
      );
    }
    aim += target - value();
  }
  if (value() !== target) {
    throw new Error(`the ${name} slider shows ${value()} %, not ${target} %: set it by hand`);
  }
}

const sameSettings = (wanted: WaypointSettings, seen: Required<WaypointSettings>) =>
  (Object.keys(wanted) as (keyof WaypointSettings)[]).every(
    k => wanted[k] === undefined || wanted[k] === seen[k],
  );

// Each exported function below is ONE action of the import: the player clicks NEXT before each one.
//   openWaypointSettings -> fillWaypointSettings -> saveWaypointSettings

// Opens the "Edit waypoint" window and reads it. If the settings are already right, it closes the window
// with cancel and returns false. Else the window stays open for the next action and it returns true.
export async function openWaypointSettings(
  editor: RouteEditor,
  index: number,
  wanted: WaypointSettings,
) {
  const { form } = await openWaypointDialog(editor, index);
  let now: Required<WaypointSettings>;
  try {
    now = readSettingsFrom(form);
  } catch (e) {
    await cancelOpenWindow(editor);
    throw e;
  }
  if (!sameSettings(wanted, now)) {
    return true;
  }
  await cancelOpenWindow(editor);
  return false;
}

// Puts the settings (only the ones given) in the open "Edit waypoint" window. It does not save.
export async function fillWaypointSettings(editor: RouteEditor, wanted: WaypointSettings) {
  const form = findDialog(frameOf(editor), editWaypointLabel);
  if (!form) {
    throw new Error('the Edit waypoint window is not open');
  }
  try {
    if (wanted.fuel !== undefined) {
      await setSlider(form, fieldFuel, wanted.fuel);
    }
    if (wanted.reactor !== undefined) {
      await setSlider(form, fieldReactor, wanted.reactor);
    }
    const { row, item } = gatewaysItem(form);
    if (wanted.preference !== undefined) {
      const select = row?.querySelector('select');
      const value = wanted.preference === 'shortestFtl' ? 'SHORTEST_FTL' : 'LEAST_JUMPS';
      const optionIndex = select
        ? Array.from(select.options).findIndex(o => o.value === value)
        : -1;
      if (!select || optionIndex < 0) {
        throw new Error('route preference not found in the Edit waypoint window');
      }
      if (select.selectedIndex !== optionIndex) {
        changeSelectIndex(select, optionIndex);
      }
    }
    if (wanted.gateways !== undefined) {
      if (!item) {
        throw new Error('"Use gateways" not found in the Edit waypoint window');
      }
      const gateways = wanted.gateways;
      if ((item.querySelector(FORM.radioActive) !== null) !== gateways) {
        await safeClick(item, 'use gateways');
        const turned = await waitFor(
          () => (item.querySelector(FORM.radioActive) !== null) === gateways,
          1000,
        );
        if (!turned) {
          throw new Error(`"Use gateways" did not turn ${gateways ? 'on' : 'off'}`);
        }
      }
    }
  } catch (e) {
    await cancelOpenWindow(editor);
    throw e;
  }
}

// Clicks save in the open "Edit waypoint" window, then opens the window again to check.
export async function saveWaypointSettings(
  editor: RouteEditor,
  index: number,
  wanted: WaypointSettings,
) {
  const frame = frameOf(editor);
  const form = findDialog(frame, editWaypointLabel);
  if (!form) {
    throw new Error('the Edit waypoint window is not open');
  }
  const save = findButton(form, /^save$/i);
  if (!save) {
    throw new Error('save button not found');
  }
  await safeClick(save, 'save waypoint');
  const closed = await waitFor(
    () => !findDialog(frame, editWaypointLabel) && routeIn(frame, editor.id),
    saveTimeout,
  );
  if (!closed) {
    throw new Error('the Edit waypoint window did not close after save: close it with cancel');
  }

  // The green overlay of APEX is the answer of the server: the settings are saved. It is much faster
  // than opening the window again. Without an overlay, open the window again to check.
  const feedback = await waitFeedback(editor, 2000);
  if (feedback.result === 'success') {
    return;
  }
  if (feedback.result === 'error') {
    throw new Error(`the game refused the settings: ${feedback.message}`);
  }

  // Check, because the server may take a moment: read again until it matches.
  let seen = await readWaypointSettings(editor, index);
  const end = Date.now() + saveTimeout;
  while (!sameSettings(wanted, seen)) {
    if (Date.now() > end) {
      const name = liveWaypoint(editor, index).name;
      throw new Error(
        `"${name}" shows "${describeSettings(seen)}" after save, not "${describeSettings(wanted)}"`,
      );
    }
    await sleep(500);
    seen = await readWaypointSettings(editor, index);
  }
}
