import { shipyardProjectsStore } from '@src/infrastructure/prun-api/data/shipyard-projects';
import { formatEta } from '@src/utils/format';
import { timestampEachMinute } from '@src/utils/dayjs';
import { createReactiveSpan } from '@src/utils/reactive-element';
import { keepLast } from '@src/utils/keep-last';

function onTileReady(tile: PrunTile) {
  const project = computed(() => {
    const id = tile.parameter?.toLowerCase();
    return id ? shipyardProjectsStore.all.value?.find(x => x.id.startsWith(id)) : undefined;
  });
  const eta = computed(() => {
    const end = project.value?.end?.timestamp;
    if (end === undefined || project.value?.status !== 'STARTED') {
      return undefined;
    }
    return ` (${formatEta(timestampEachMinute.value, end)})`;
  });

  subscribe($$(tile.anchor, C.FormComponent.containerPassive), row => {
    const label = _$(row, C.FormComponent.label);
    if (label?.textContent?.trim() !== 'Built') {
      return;
    }
    const value = _$(row, C.FormComponent.input);
    if (!value) {
      return;
    }
    const span = createReactiveSpan(row, eta);
    keepLast(row, () => _$(row, C.FormComponent.input), span);
  });
}

function init() {
  tiles.observe('SHYP', onTileReady);
}

features.add(
  import.meta.url,
  init,
  'SHYP: Adds the real time of the end of construction to "Built".',
);
