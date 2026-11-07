import { burnSuggestEnabled } from '@src/features/XIT/BURN/suggest';

function init() {
  burnSuggestEnabled.value = true;
}

features.add(
  import.meta.url,
  init,
  'XIT BURN: When the name matches no base, shows "Did you mean ...?" with the closest base instead of every base.',
);
