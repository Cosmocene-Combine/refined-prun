import { describe, expect, it } from 'vitest';
import {
  BaseBill,
  BaseRates,
  fitTour,
  hubBill,
  legs,
  legsFit,
  margin,
  matchBase,
  maxFittingDays,
  peakLoad,
  planRoute,
  PlanetBurnLike,
  ratesFromBurn,
  routeBill,
  Run,
  runsFromLines,
  transferSavings,
  sizeOfList,
  SizeOf,
  tourBill,
  withoutOff,
} from './route-plan';
import { formatRouteText } from './route-text';

const rates: BaseRates[] = [
  {
    name: 'Curie',
    naturalId: 'OZ-189c',
    uses: [
      { ticker: 'RAT', daily: 10 },
      { ticker: 'DW', daily: 20 },
    ],
    makes: [{ ticker: 'AL', daily: 4 }],
  },
  { name: 'Avalon', uses: [{ ticker: 'RAT', daily: 5 }], makes: [] },
];

const sizes: Record<string, { weight: number; volume: number }> = {
  A: { weight: 1, volume: 2 },
  B: { weight: 0.5, volume: 0.5 },
  RAT: { weight: 1, volume: 1 },
};
const sizeOf: SizeOf = ticker => sizes[ticker];

const settingsLine = 'fuel 5\treactor 50\tleast jumps\tgateways on';

describe('ratesFromBurn', () => {
  const planets: PlanetBurnLike[] = [
    {
      planetName: 'Curie',
      naturalId: 'OZ-189c',
      burn: {
        RAT: { input: 0, output: 0, workforce: 12, dailyAmount: -12 },
        H2O: { input: 8, output: 0, workforce: 0, dailyAmount: -8 },
        AL: { input: 0, output: 4, workforce: 0, dailyAmount: 4 },
        ZZ: { input: 1, output: 1, workforce: 0, dailyAmount: 0 },
      },
    },
    { planetName: 'Empty', naturalId: 'AA-111a', burn: {} },
  ];

  it('splits uses and makes and skips what is balanced or empty', () => {
    expect(ratesFromBurn(planets)).toEqual([
      {
        name: 'Curie',
        naturalId: 'OZ-189c',
        uses: [
          { ticker: 'RAT', daily: 12 },
          { ticker: 'H2O', daily: 8 },
        ],
        makes: [{ ticker: 'AL', daily: 4 }],
      },
    ]);
  });
});

describe('tourBill', () => {
  it('brings supplies rounded up with the margin and waits for the production rounded down', () => {
    expect(margin).toBe(1.05);
    expect(tourBill(rates, 10)).toEqual([
      {
        name: 'Curie',
        items: [
          { ticker: 'RAT', qty: 105 },
          { ticker: 'DW', qty: 210 },
        ],
        pickups: [{ ticker: 'AL', qty: 40 }],
        retains: [],
      },
      { name: 'Avalon', items: [{ ticker: 'RAT', qty: 53 }], pickups: [], retains: [] },
    ]);
  });

  it('adds retains for the days the base keeps', () => {
    const bill = tourBill(rates, 10, margin, 2);
    expect(bill[0].retains).toEqual([
      { ticker: 'RAT', qty: 20 },
      { ticker: 'DW', qty: 40 },
    ]);
    expect(bill[1].retains).toEqual([{ ticker: 'RAT', qty: 10 }]);
  });

  it('returns nothing for a tour of zero days', () => {
    expect(tourBill(rates, 0)).toEqual([]);
  });
});

describe('production in whole runs', () => {
  // FIM: 2 RAT + 1 HER -> 2 FIM, 100 runs per day. The workforce also eats 10 RAT per day.
  const fimRun: Run = {
    perDay: 100,
    inputs: [
      { ticker: 'RAT', qty: 2 },
      { ticker: 'HER', qty: 1 },
    ],
    outputs: [{ ticker: 'FIM', qty: 2 }],
  };
  const planet: PlanetBurnLike = {
    planetName: 'Avalon',
    naturalId: 'AA-111a',
    burn: {
      RAT: { input: 200, output: 0, workforce: 10, dailyAmount: -210 },
      HER: { input: 100, output: 0, workforce: 0, dailyAmount: -100 },
      FIM: { input: 0, output: 200, workforce: 0, dailyAmount: 200 },
    },
    runs: [fimRun],
  };
  const fimRates = ratesFromBurn([planet]);

  it('keeps the recipe ratio and adds the margin only to the workforce part', () => {
    expect(tourBill(fimRates, 15)[0]).toEqual({
      name: 'Avalon',
      // RAT: 2 * 1500 runs + ceil(10 * 15 * 1.05).
      items: [
        { ticker: 'RAT', qty: 3158 },
        { ticker: 'HER', qty: 1500 },
      ],
      pickups: [{ ticker: 'FIM', qty: 3000 }],
      retains: [],
    });
  });

  it('uses the production days for the runs and the workforce days for the rest', () => {
    const bill = tourBill(fimRates, 30, margin, 0, 15.009)[0];
    expect(bill.items).toEqual([
      { ticker: 'RAT', qty: 3000 + 315 },
      { ticker: 'HER', qty: 1500 },
    ]);
    expect(bill.pickups).toEqual([{ ticker: 'FIM', qty: 3000 }]);
  });

  it('builds runs from production lines', () => {
    const order = {
      duration: { millis: 86400000 / 2 },
      inputs: [{ material: { ticker: 'HER' }, amount: 1 }],
      outputs: [{ material: { ticker: 'FIM' }, amount: 2 }],
    };
    const runs = runsFromLines([{ capacity: 3 }], () => [order, order]);
    expect(runs).toHaveLength(2);
    expect(runs[0]).toEqual({
      perDay: 3,
      inputs: [{ ticker: 'HER', qty: 1 }],
      outputs: [{ ticker: 'FIM', qty: 2 }],
    });
    expect(runsFromLines([{ capacity: 3 }], () => [])).toEqual([]);
  });
});

describe('matchBase', () => {
  it('finds a base by name, by natural id or inside a full name', () => {
    expect(matchBase(rates, 'curie')?.name).toBe('Curie');
    expect(matchBase(rates, 'OZ-189c')?.name).toBe('Curie');
    expect(matchBase(rates, 'Hypatia - Curie (OZ-189c)')?.name).toBe('Curie');
  });

  it('returns undefined for a plain waypoint', () => {
    expect(matchBase(rates, 'HRT')).toBeUndefined();
    expect(matchBase(rates, '')).toBeUndefined();
  });

  it('needs a whole word and prefers the longest name', () => {
    const list: BaseRates[] = [
      { name: 'Hypatia', uses: [], makes: [] },
      { name: 'Hypatia Prime', uses: [], makes: [] },
      { name: 'Cur', uses: [], makes: [] },
    ];
    expect(matchBase(list, 'Hypatia Prime')?.name).toBe('Hypatia Prime');
    expect(matchBase(list, 'Curie')).toBeUndefined();
  });
});

describe('routeBill', () => {
  it('unloads at the first visit and loads at the last visit', () => {
    const bill = routeBill(rates, ['Curie', 'Avalon', 'Curie'], 10);
    expect(bill.map(x => x.name)).toEqual(['Curie', 'Avalon', 'Curie']);
    expect(bill[0].items).toHaveLength(2);
    expect(bill[0].pickups).toEqual([]);
    expect(bill[1].items).toEqual([{ ticker: 'RAT', qty: 53 }]);
    expect(bill[2].items).toEqual([]);
    expect(bill[2].pickups).toEqual([{ ticker: 'AL', qty: 40 }]);
  });

  it('keeps plain waypoints with nothing to do and drops empty names', () => {
    const bill = routeBill(rates, ['Curie', ' ', 'Moon'], 10);
    expect(bill.map(x => x.name)).toEqual(['Curie', 'Moon']);
    expect(bill[1]).toEqual({ name: 'Moon', items: [], pickups: [], retains: [] });
  });
});

describe('sizes and legs', () => {
  const bill: BaseBill[] = [
    { name: 'HRT', items: [], pickups: [], retains: [], hub: true },
    {
      name: 'X',
      items: [{ ticker: 'A', qty: 10 }],
      pickups: [{ ticker: 'B', qty: 20 }],
      retains: [],
    },
    { name: 'Y', items: [{ ticker: 'A', qty: 5 }], pickups: [], retains: [] },
  ];

  it('adds weight and volume and lists the tickers without a size', () => {
    expect(
      sizeOfList(
        [
          { ticker: 'A', qty: 2 },
          { ticker: 'ZZ', qty: 9 },
        ],
        sizeOf,
      ),
    ).toEqual({ weight: 2, volume: 4, missing: ['ZZ'] });
  });

  it('works out the cargo on every leg', () => {
    expect(legs(bill, sizeOf)).toEqual([
      { from: 'HRT', to: 'X', segment: 0, weight: 15, volume: 30 },
      { from: 'X', to: 'Y', segment: 0, weight: 15, volume: 20 },
      { from: 'Y', to: 'HRT', segment: 0, weight: 10, volume: 10 },
    ]);
    expect(legs(bill.slice(1), sizeOf)).toEqual([]);
    expect(peakLoad(bill, sizeOf)).toEqual({ weight: 15, volume: 30, missing: [] });
  });

  it('checks the legs against a ship', () => {
    expect(legsFit(bill, sizeOf, 15, 30)).toBe(true);
    expect(legsFit(bill, sizeOf, 14.9, 30)).toBe(false);
    expect(legsFit(bill, sizeOf, 15, 29)).toBe(false);
    expect(legsFit(bill, sizeOf, 16, 31, 1)).toBe(true);
    expect(legsFit(bill, sizeOf, 15, 31, 1)).toBe(false);
  });
});

describe('fitting a tour', () => {
  it('finds the largest value that fits', () => {
    expect(maxFittingDays(days => days <= 12.34)).toBe(12.34);
    expect(maxFittingDays(() => true)).toBe(999);
    expect(maxFittingDays(() => false)).toBe(0);
  });

  it('finds the longest tour that fills the ship', () => {
    const single: BaseRates[] = [
      { name: 'Curie', uses: [{ ticker: 'RAT', daily: 10 }], makes: [] },
    ];
    const billFor = (days: number) =>
      routeBill(single, ['HRT', 'Curie'], days, margin, 0, days, [true]);
    expect(fitTour(billFor, sizeOf, 100, 1000)).toBe(9.52);
  });
});

describe('planRoute', () => {
  const bill = routeBill(rates, ['HRT', 'Curie', 'Avalon'], 10, margin, 0, 10, [true]);

  it('makes the hub load the supplies and each base unload them', () => {
    const text = formatRouteText(planRoute(bill));
    expect(text).toBe(
      [
        'loop\ton',
        '',
        `waypoint\tHRT\t${settingsLine}`,
        'refuel\tSTL\t0\tall',
        'unload\tAL\t0\tall',
        'unload\tDW\t0\tall',
        'unload\tRAT\t0\tall',
        'load\tDW\t210\t210',
        'load\tRAT\t158\t158',
        '',
        `waypoint\tCurie\t${settingsLine}`,
        'unload\tDW\t0\t210',
        'unload\tRAT\t0\t105',
        'load\tAL\t40\tall',
        '',
        `waypoint\tAvalon\t${settingsLine}`,
        'unload\tRAT\t0\t53',
        '',
      ].join('\n'),
    );
  });

  it('refuels FTL too for an FTL ship and can switch Loop off', () => {
    const text = formatRouteText(planRoute(bill, { tank: 'FTL', loop: false }));
    expect(text).toContain('loop\toff');
    expect(text).toContain('refuel\tSTL\t0\tall\nrefuel\tFTL\t0\tall\n');
  });

  it('adds retain loads in balance mode', () => {
    const balanced = routeBill(rates, ['HRT', 'Curie', 'Avalon'], 10, margin, 2, 10, [true]);
    const text = formatRouteText(planRoute(balanced));
    expect(text).toContain(
      'load\tAL\t40\tall\nload\tDW\t0\tall\tretain 40\nload\tRAT\t0\tall\tretain 20',
    );
    expect(text).toContain('load\tRAT\t0\tall\tretain 10');
  });

  it('uses the route name when it is given', () => {
    const route = planRoute(bill, { routeName: 'Tour' });
    expect(formatRouteText(route).startsWith('route\tTour\nloop\ton\n')).toBe(true);
  });

  it('refuses a route without a hub and an empty bill', () => {
    expect(() => planRoute(bill.slice(1))).toThrow('HUB');
    expect(() => planRoute([])).toThrow('HUB');
    const hub: BaseBill = { name: 'HRT', items: [], pickups: [], retains: [], hub: true };
    expect(() => planRoute([hub, { name: 'Moon', items: [], pickups: [], retains: [] }])).toThrow(
      'Nothing to carry',
    );
  });

  it('serves each segment from its own hub', () => {
    const split = routeBill(rates, ['HRT', 'Curie', 'Hortus', 'Avalon'], 10, margin, 0, 10, [
      true,
      false,
      true,
      false,
    ]);
    expect(hubBill(split, 0)).toEqual({
      load: [
        { ticker: 'DW', qty: 210 },
        { ticker: 'RAT', qty: 105 },
      ],
      unload: [],
    });
    expect(hubBill(split, 2)).toEqual({
      load: [{ ticker: 'RAT', qty: 53 }],
      unload: [{ ticker: 'AL', qty: 40 }],
    });
    const text = formatRouteText(planRoute(split));
    expect(text).toContain('load\tDW\t210\t210\nload\tRAT\t105\t105\n\nwaypoint\tCurie');
    expect(text).toContain('load\tRAT\t53\t53\n\nwaypoint\tAvalon');
    expect(legs(split, sizeOf).map(x => `${x.from}>${x.to}`)).toEqual([
      'HRT>Curie',
      'Curie>Hortus',
      'Hortus>Avalon',
      'Avalon>HRT',
    ]);
  });

  it('treats a hub as a hub also when it is a base', () => {
    const asHub = routeBill(rates, ['Curie', 'Avalon'], 10, margin, 0, 10, [true]);
    expect(asHub[0]).toEqual({ name: 'Curie', items: [], pickups: [], retains: [], hub: true });
  });
});

describe('transfers', () => {
  // Maker makes 10 A per day, User uses 8 A per day. User comes after Maker in the segment.
  const chain: BaseRates[] = [
    { name: 'Maker', uses: [], makes: [{ ticker: 'A', daily: 10 }] },
    { name: 'User', uses: [{ ticker: 'A', daily: 8 }], makes: [] },
  ];
  const bill = routeBill(chain, ['HRT', 'Maker', 'User'], 10, margin, 0, undefined, [true]);

  it('loads at the hub without transfers', () => {
    expect(hubBill(bill, 0)).toEqual({
      load: [{ ticker: 'A', qty: 84 }],
      unload: [{ ticker: 'A', qty: 100 }],
    });
    expect(legs(bill, sizeOf).map(x => x.weight)).toEqual([84, 184, 100]);
  });

  it('lets a later base use what an earlier base made', () => {
    expect(hubBill(bill, 0, true)).toEqual({ load: [], unload: [{ ticker: 'A', qty: 16 }] });
    expect(legs(bill, sizeOf, true).map(x => x.weight)).toEqual([0, 100, 16]);
    expect(transferSavings(bill)).toEqual([{ ticker: 'A', qty: 84 }]);
    const text = formatRouteText(planRoute(bill, { transfers: true }));
    expect(text).not.toContain('load	A	84');
    expect(text).toContain('unload	A	0	84');
  });

  it('does not move cargo to an earlier base', () => {
    const back = routeBill(chain, ['HRT', 'User', 'Maker'], 10, margin, 0, undefined, [true]);
    expect(transferSavings(back)).toEqual([]);
  });
});

describe('hubBill', () => {
  it('adds the supplies to load and the production to unload by ticker', () => {
    const bill: BaseBill[] = [
      { name: 'HRT', items: [], pickups: [], retains: [], hub: true },
      {
        name: 'Curie',
        items: [
          { ticker: 'RAT', qty: 10 },
          { ticker: 'DW', qty: 5 },
        ],
        pickups: [{ ticker: 'FE', qty: 3 }],
        retains: [],
      },
      {
        name: 'Avalon',
        items: [{ ticker: 'RAT', qty: 4 }],
        pickups: [
          { ticker: 'FE', qty: 2 },
          { ticker: 'AL', qty: 1 },
        ],
        retains: [],
      },
    ];
    expect(hubBill(bill, 0)).toEqual({
      load: [
        { ticker: 'DW', qty: 5 },
        { ticker: 'RAT', qty: 14 },
      ],
      unload: [
        { ticker: 'AL', qty: 1 },
        { ticker: 'FE', qty: 5 },
      ],
    });
  });
});

describe('withoutOff', () => {
  it('removes the materials that are off, by natural id or by name', () => {
    const result = withoutOff(rates, { 'OZ-189c': ['RAT', 'AL'], Avalon: ['RAT'] });
    expect(result[0].uses).toEqual([{ ticker: 'DW', daily: 20 }]);
    expect(result[0].makes).toEqual([]);
    expect(result[1].uses).toEqual([]);
  });

  it('does not change a base without off materials', () => {
    const result = withoutOff(rates, { 'OZ-189c': [] });
    expect(result[0]).toBe(rates[0]);
    expect(result[1]).toBe(rates[1]);
  });

  it('keeps the production of a base when its input is off', () => {
    const base: BaseRates = {
      name: 'Berthier',
      naturalId: 'XX-001a',
      uses: [{ ticker: 'ALO', daily: 2 }],
      makes: [{ ticker: 'AL', daily: 1 }],
      runs: [
        { perDay: 1, inputs: [{ ticker: 'ALO', qty: 2 }], outputs: [{ ticker: 'AL', qty: 1 }] },
      ],
      workforce: {},
    };
    const [bill] = tourBill(withoutOff([base], { 'XX-001a': ['ALO'] }), 3);
    expect(bill.items).toEqual([]);
    expect(bill.pickups).toEqual([{ ticker: 'AL', qty: 3 }]);
  });
});
