import { materialsStore } from '@src/infrastructure/prun-api/data/materials';
import { getMaterialName } from '@src/infrastructure/prun-ui/i18n';
import type { TickerLookup } from '@src/features/XIT/ROUTEBURNS/route-snapshot';

// APEX shows the display name of a material in the summary of a step ("Drinking Water").
// This finds the ticker of that name.
export function createTickerLookup(): TickerLookup {
  const tickers = new Map<string, string>();
  for (const material of materialsStore.all.value ?? []) {
    const name = getMaterialName(material);
    if (name !== undefined) {
      tickers.set(name.toLowerCase(), material.ticker);
    }
  }
  return name => tickers.get(name.trim().toLowerCase());
}
