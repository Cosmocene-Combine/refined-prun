import { contsCollapseEnabled } from '@src/features/XIT/CONTS/collapse';

function init() {
  contsCollapseEnabled.value = true;
}

features.add(
  import.meta.url,
  init,
  'XIT CONTS: Shows only the first 3 entries of long contracts, with a "+N more" link.',
);
