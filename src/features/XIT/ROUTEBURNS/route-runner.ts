// Runs an import plan in APEX, one action after the other.
// It never assigns a ship and never deletes anything: it only adds waypoints, adds and fixes steps,
// sets waypoint settings and sets Loop.
//
// RULE of the game developers (see "Server Communication & ToS" in the Refined PrUn contributing guide):
// every action that makes the game talk to the server needs a click of the player. So the runner
// ALWAYS waits for the player before each action. There is no mode that runs all actions at once.
//
// One item of the plan can be more than one action. For example, a new step is: add the step, open its
// edit window, put in the values, save. Each of these actions waits for its own click on NEXT.
// There is no fixed pause: each action waits until APEX shows its result, then NEXT comes back.
import {
  addDefaultStep,
  addWaypoint,
  cancelOpenWindow,
  countWaypoints,
  dismissSuccess,
  fillStepWindow,
  fillWaypointSettings,
  openStepWindow,
  openWaypointSettings,
  saveStepWindow,
  saveWaypointSettings,
  renameRoute,
  setLoop,
  stepButtons,
  type RouteEditor,
} from '@src/features/XIT/ROUTEBURNS/route-driver';
import {
  todoText,
  todoWhere,
  type ImportPlan,
  type TodoItem,
} from '@src/features/XIT/ROUTEBURNS/route-import-plan';
import type { TickerLookup } from '@src/features/XIT/ROUTEBURNS/route-snapshot';
import { describeSettings, describeStep } from '@src/features/XIT/ROUTEBURNS/route-text';

export type LogKind = 'info' | 'ok' | 'warn' | 'err';

export interface RunHooks {
  say: (message: string, kind?: LogKind) => void;
  // It resolves when the player clicks Next or Skip. It is called before every action.
  waitForNext: () => Promise<'next' | 'skip'>;
  shouldStop: () => boolean;
}

export interface RunResult {
  done: number;
  skipped: number;
  stopped: boolean;
  failed: boolean;
}

// One action of an item: one click on NEXT. When run() returns false, the other actions of the item are
// not needed (for example, the waypoint settings are already right).
// server: the action saves something. Then the green "Action succeeded!" overlay of APEX is closed.
interface Action {
  text: string;
  server?: boolean;
  run: () => Promise<boolean | void>;
}

// A new step that is only a default step: it is in the route, but its values are not set.
const defaultStepWarning = (item: Extract<TodoItem, { kind: 'step' }>) =>
  `A default "${stepButtons[item.step.type]}" step is at ${todoWhere(item)}: run Preview again to fix it, ` +
  'or delete it in APEX.';

export async function runImportPlan(
  plan: ImportPlan,
  editor: RouteEditor,
  tickerOf: TickerLookup,
  hooks: RunHooks,
): Promise<RunResult> {
  const { say, shouldStop } = hooks;
  let done = 0;
  let skipped = 0;
  let stopped = false;
  // Waypoint index -> the name that APEX shows once the waypoint is added.
  const added = new Map<number, string>();
  const shown = (item: TodoItem) =>
    ('index' in item ? added.get(item.index) : undefined) ?? item.display;
  // True while an edit window, opened by an earlier action, waits for the next action.
  let windowOpen = false;
  // True when a new step was added but its values are not saved yet.
  let defaultStep = false;

  function actionsOf(item: TodoItem): Action[] {
    switch (item.kind) {
      case 'name':
        return [
          {
            // One action: the text box of the name closes when the player clicks NEXT.
            text: `click the route name, type "${item.name}" and press Enter`,
            server: true,
            run: async () => {
              await renameRoute(editor, item.name);
              say(`✓ route name: ${item.name}`, 'ok');
            },
          },
        ];
      case 'waypoint':
        return [
          {
            text: todoText(item),
            server: true,
            run: async () => {
              const name = await addWaypoint(editor, item.waypoint);
              const at = countWaypoints(editor) - 1;
              if (at !== item.index) {
                throw new Error(
                  `"${name}" was added as waypoint ${at + 1}, not ${item.index + 1}: run Preview again`,
                );
              }
              added.set(item.index, name);
              say(`✓ waypoint added: ${name}`, 'ok');
            },
          },
        ];
      case 'settings':
        return [
          {
            text: 'open the Edit waypoint window',
            run: async () => {
              const open = await openWaypointSettings(editor, item.index, item.settings);
              if (!open) {
                say(`✓ ${shown(item)}: settings already ${describeSettings(item.settings)}`, 'ok');
                return false;
              }
              windowOpen = true;
              say(`✓ ${shown(item)}: Edit waypoint window open`, 'ok');
              return true;
            },
          },
          {
            text: `put in the settings: ${describeSettings(item.settings)}`,
            run: async () => {
              await fillWaypointSettings(editor, item.settings);
              say(`✓ ${shown(item)}: settings put in (not saved yet)`, 'ok');
            },
          },
          {
            text: 'save the settings',
            server: true,
            run: async () => {
              await saveWaypointSettings(editor, item.index, item.settings);
              windowOpen = false;
              say(`✓ ${shown(item)}: settings saved: ${describeSettings(item.settings)}`, 'ok');
            },
          },
        ];
      case 'loop':
        return [
          {
            text: todoText(item),
            server: true,
            run: async () => {
              await setLoop(editor, item.on);
              say(`✓ Loop ${item.on ? 'on' : 'off'}`, 'ok');
            },
          },
        ];
      case 'step': {
        const where = `${shown(item)}, step ${item.pos}`;
        const actions: Action[] = [];
        if (!item.fix) {
          actions.push({
            text: `add a default "${stepButtons[item.step.type]}" step`,
            server: true,
            run: async () => {
              windowOpen = await addDefaultStep(editor, item.index, item.step);
              defaultStep = true;
              say(`✓ ${where}: default step added`, 'ok');
              // A shipment step has no values to set.
              if (item.step.type === 'loadShipment' || item.step.type === 'unloadShipment') {
                defaultStep = false;
                if (windowOpen) {
                  throw new Error('a window opened for a shipment step: close it with cancel');
                }
                return false;
              }
              return true;
            },
          });
        }
        actions.push(
          {
            text: 'open the edit window of the step',
            run: async () => {
              // In case APEX ever opens the window directly instead of adding a default step.
              if (!windowOpen) {
                await openStepWindow(editor, item.index, item.pos - 1, item.step, tickerOf);
                windowOpen = true;
              }
              say(`✓ ${where}: edit window open`, 'ok');
            },
          },
          {
            text: `put in the values: ${describeStep(item.step)}`,
            run: async () => {
              await fillStepWindow(editor, item.step);
              say(`✓ ${where}: values put in (not saved yet)`, 'ok');
            },
          },
          {
            text: 'save the step',
            server: true,
            run: async () => {
              await saveStepWindow(editor, item.index, item.pos - 1, item.step, tickerOf);
              windowOpen = false;
              defaultStep = false;
              say(`✓ ${where}: ${item.fix ? 'fixed, ' : ''}${describeStep(item.step)}`, 'ok');
            },
          },
        );
        return actions;
      }
    }
  }

  async function dismissInBackground() {
    try {
      await dismissSuccess(editor);
    } catch {
      // The overlay stays: the player can click it.
    }
  }

  // Leaves the route as clean as possible when an item is not finished: close the open window without
  // saving, and tell about a default step that stays in the route.
  async function abandon(item: TodoItem) {
    if (windowOpen) {
      windowOpen = false;
      try {
        await cancelOpenWindow(editor);
        say('The open window was closed with cancel: nothing of it was saved.', 'warn');
      } catch {
        say('The open window was not closed: close it with cancel.', 'warn');
      }
    }
    if (defaultStep && item.kind === 'step') {
      defaultStep = false;
      say(defaultStepWarning(item), 'warn');
    }
  }

  let current: TodoItem | undefined;
  try {
    for (const item of plan.todo) {
      current = item;
      const actions = actionsOf(item);
      let itemSkipped = false;
      for (let i = 0; i < actions.length; i++) {
        const action = actions[i];
        const count = actions.length > 1 ? ` (${i + 1}/${actions.length})` : '';
        say(`Next${count}: ${todoWhere(item)}: ${action.text}`);
        const choice = await hooks.waitForNext();
        if (shouldStop()) {
          stopped = true;
          break;
        }
        if (choice === 'skip') {
          itemSkipped = true;
          break;
        }
        const more = await action.run();
        if (action.server) {
          // Not awaited: the next action does not wait for the overlay.
          void dismissInBackground();
        }
        if (more === false) {
          break;
        }
        if (shouldStop()) {
          stopped = true;
          break;
        }
      }
      if (stopped) {
        await abandon(item);
        break;
      }
      if (itemSkipped) {
        skipped++;
        say(`Skipped: ${todoWhere(item)}: ${todoText(item)}`, 'warn');
        await abandon(item);
        continue;
      }
      done++;
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    say(`✗ Stopped at action ${done + 1}: ${message}`, 'err');
    if (current) {
      await abandon(current);
    }
    say(
      `${done} action(s) done before the error. Fix it, then run Preview again: it resumes where it stopped.`,
      'warn',
    );
    return { done, skipped, stopped: false, failed: true };
  }

  const skippedText = skipped > 0 ? `, ${skipped} skipped` : '';
  say(
    stopped
      ? `Stopped: ${done} action(s) done${skippedText}.`
      : `Done: ${done} action(s) done${skippedText}. Check the route, then assign the ship yourself.`,
    'ok',
  );
  return { done, skipped, stopped, failed: false };
}
