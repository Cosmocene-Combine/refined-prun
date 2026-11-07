import {
  getEntityNameFromAddress,
  getEntityNaturalIdFromAddress,
} from '@src/infrastructure/prun-api/data/addresses';

// Turned on by the xit-burn-did-you-mean feature. When the feature is disabled in
// XIT SET FEAT, a name that matches no base shows every base, as before.
export const burnSuggestEnabled = ref(false);

function distance(a: string, b: string) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length];
}

// The base whose natural id or name is the closest to what was typed, if close enough.
export function suggestSite(query: string, sites: PrunApi.Site[]) {
  const typed = query.trim().toLowerCase();
  let best: { site: PrunApi.Site; label: string; score: number } | undefined;
  for (const site of sites) {
    const naturalId = getEntityNaturalIdFromAddress(site.address);
    const name = getEntityNameFromAddress(site.address);
    for (const label of [naturalId, name]) {
      if (!label) {
        continue;
      }
      const score = distance(typed, label.toLowerCase());
      if (best === undefined || score < best.score) {
        best = { site, label: naturalId ?? label, score };
      }
    }
  }
  if (best === undefined || best.score > Math.max(2, Math.floor(typed.length / 3))) {
    return undefined;
  }
  return best;
}
