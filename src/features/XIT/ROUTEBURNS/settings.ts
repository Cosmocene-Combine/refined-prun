import { userData } from '@src/store/user-data';

const defaults: UserData.RouteBurnsSettings = {
  // Length of one tour in days.
  days: 16,
  // Balance mode: days of its supplies each base keeps.
  keep: 16,
  tank: 'STL',
  // Id of a ship size from core/ship-sizes. Empty means no ship chosen.
  ship: '',
  balance: false,
  // The waypoints in the order the ship visits them.
  route: [],
  // A flag for each waypoint: true is a hub.
  hubs: [true],
  // A base can use what an earlier base of its segment made: the hub loads less.
  transfer: false,
  // Natural id of a base -> the tickers that are off for that base.
  off: {},
  // The view: the route text box and the import log can be hidden on a small screen.
  hideText: false,
  hideLog: false,
};

// A setting of the current tour. It is kept in userData, not in the tile state: a floating buffer
// loses its tile state when it is split to open RT beside it.
// Always set a new array for the route and a new object for off. The defaults are shared.
export function useSetting<K extends keyof UserData.RouteBurnsSettings>(key: K) {
  return computed({
    get: () => userData.routeBurns.work[key] ?? defaults[key],
    set: (value: UserData.RouteBurnsSettings[K]) => {
      userData.routeBurns.work[key] = value;
    },
  });
}
