declare namespace UserData {
  type TimeFormat = 'DEFAULT' | '24H' | '12H';

  type CurrencyPreset = 'DEFAULT' | 'AIC' | 'CIS' | 'ICA' | 'NCC' | 'CUSTOM';
  type CurrencyPosition = 'BEFORE' | 'AFTER';
  type CurrencySpacing = 'HAS_SPACE' | 'NO_SPACE';

  type PricingMethod = 'ASK' | 'BID' | 'AVG' | 'VWAP7D' | 'VWAP30D' | 'DEFAULT' | string;

  type Exchange = 'AI1' | 'CI1' | 'CI2' | 'IC1' | 'NC1' | 'NC2';

  interface PriceOverride {
    buy?: number;
    sell?: number;
  }

  interface StoreSortingData {
    modes: SortingMode[];
    active?: string;
    cat?: boolean;
    reverse?: boolean;
  }

  interface SortingMode {
    label: string;
    categories: SortingModeCategory[];
    burn: boolean;
    zero: boolean;
  }

  interface SortingModeCategory {
    name: string;
    materials: string[];
  }

  type TileState = Record<string, unknown>;

  interface Note {
    id: string;
    name: string;
    text: string;
  }

  interface SystemMessages {
    chat: string;
    hideJoined: boolean;
    hideDeleted: boolean;
  }

  interface ActionPackageData {
    groups: MaterialGroupData[];
    actions: ActionData[];
    global: {
      name: string;
    };
  }

  type MaterialGroupType = 'Manual' | 'Resupply' | 'Repair' | 'Paste';

  interface MaterialGroupData {
    type: MaterialGroupType;
    name?: string;
    days?: number | string;
    advanceDays?: number | string;
    planet?: string;
    useBaseInv?: boolean;
    materials?: Record<string, number>;
    exclusions?: string[];
    consumablesOnly?: boolean;
    materialFilter?: 'All' | 'Workforce' | 'Production';
  }

  type ActionType = 'CX Buy' | 'MTRA' | 'Refuel' | 'CONT Ship' | 'CONT Trade' | 'GovBurn Data';

  interface ActionData {
    type: ActionType;

    name?: string;
    group?: string;
    skippable?: boolean;

    allowUnfilled?: boolean;
    buyPartial?: boolean;
    exchange?: string;
    useCXInv?: boolean;
    priceLimits?: Record<string, number>;

    buyMissingFuel?: boolean;

    // GovBurn Data: planet natural ID or name.
    planet?: string;

    origin?: string;
    dest?: string;

    // MTRA specific.
    postToAgent?: boolean;
    noSfc?: boolean;
    sfcDestination?: string;
    printOffloadJson?: boolean;
    offloadGroups?: string[];
    agentGroups?: string[];
    finishOnly?: boolean;
    // Group names whose offload packages need a braPlanet repair reminder.
    repairGroups?: string[];
    // Open BRA for this planet after transfers.
    braPlanet?: string;

    // CONT Ship specific.
    currency?: string;
    contractNote?: string;
    paymentPerTon?: number;
    daysToFulfill?: number;
    contOrigin?: string;
    contDest?: string;
    autoProvision?: boolean;

    // CONT Trade specific.
    contTradeType?: 'BUYING' | 'SELLING';
    contLocation?: string;
  }

  interface TaskList {
    id: string;
    name: string;
    tasks: Task[];
  }

  interface Task {
    id: string;
    type: TaskType;
    completed?: boolean;
    text?: string;
    dueDate?: number;
    recurring?: number;
    planet?: string;
    days?: number;
    buildingAge?: number;
    subtasks?: Task[];
  }

  type TaskType = 'Text' | 'Resupply' | 'Repair';

  interface CommandList {
    id: string;
    name: string;
    commands: Command[];
  }

  interface Command {
    id: string;
    label: string;
    command: string;
  }

  type ExchangeChartType = 'SMOOTH' | 'ALIGNED' | 'RAW';

  interface TabFolder {
    id: string;
    name: string;
    screenIds: string[];
  }

  // A saved plan of XIT ROUTEBURNS: the settings of one tour.
  interface RouteBurnsPreset {
    id: string;
    name: string;
    tank: 'STL' | 'FTL';
    // Id of a ship size from core/ship-sizes. Empty means no ship chosen.
    ship: string;
    days: number;
    keep: number;
    balance: boolean;
    // The waypoints in the order the ship visits them.
    route: string[];
    // A flag for each waypoint of the route: true is a hub. Missing: only the first one is a hub.
    hubs?: boolean[];
    // A base can use what an earlier base of its segment made. Missing: off.
    transfer?: boolean;
    // The materials that the ship neither brings to nor picks up from a base. The key is the natural id
    // of the base. Missing: all materials are on.
    off?: Record<string, string[]>;
  }

  // The settings of one tour, without a name. XIT ROUTEBURNS keeps the current ones in userData
  // because a floating buffer does not keep tile state when it is split to open RT beside it.
  // hideText and hideLog are only for the view of the tile: presets do not keep them.
  type RouteBurnsSettings = Omit<RouteBurnsPreset, 'id' | 'name'> & {
    hideText?: boolean;
    hideLog?: boolean;
  };

  interface GovBurnPlanet {
    naturalId: string;
    name: string;
    capturedAt: number;
    buildings: GovBurnBuilding[];
    cogc?: GovBurnCogc;
  }

  interface GovBurnBuilding {
    ticker: string;
    type: string;
    projectId: string;
    level: number;
    upkeeps?: GovBurnUpkeep[];
    upkeepsCapturedAt?: number;
    // Upkeep ticker -> last contribution timestamps (ms epoch).
    contribHistory?: Record<string, GovBurnContrib>;
  }

  interface GovBurnContrib {
    // Last contribution by the player's own company.
    own?: number;
    // Last contribution by anyone (including own).
    any?: number;
  }

  interface GovBurnUpkeep {
    ticker: string;
    stored: number;
    amount: number;
    duration: number;
    nextTick: number;
  }

  interface GovBurnCogc {
    dueDate: number;
    // Current-cycle bill with contributed amounts; paid when every currentAmount >= amount.
    materials: GovBurnCogcMaterial[];
  }

  interface GovBurnCogcMaterial {
    ticker: string;
    amount: number;
    currentAmount: number;
  }

  // Building ticker -> required count of supplied upkeep materials.
  // -1 (or missing): unconfigured - treat as 0 days (red).
  // 0: deliberately unsupplied - infinity days (green).
  // 1..upkeepCount: number of upkeep materials the player keeps supplied.
  type GovBurnPlanetConfig = Record<string, number>;

  // Building ticker -> chosen upkeep material tickers, in slot order.
  // Persists GOVBURNACT's slot picks; may be shorter than the configured
  // count when some slots are still unresolved.
  type GovBurnPlanetSlots = Record<string, string[]>;
}
