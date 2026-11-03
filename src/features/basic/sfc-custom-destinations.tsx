import PrunButton from '@src/components/PrunButton.vue';
import { userData } from '@src/store/user-data';
import { showBuffer } from '@src/infrastructure/prun-ui/buffers';
import { selectAddress } from '@src/infrastructure/prun-ui/utils/select-address';
import $style from './sfc-custom-destinations.module.css';

function onTileReady(tile: PrunTile) {
  subscribe($$(tile.anchor, C.AddressSelector.container), container => {
    // Same row as the ANT / BEN / HRT / MOR buttons, after a separator.
    createFragmentApp(() => (
      <div class={$style.buttons}>
        <div class={$style.separator} />
        {userData.cosm.sfcDestinations.map(name => (
          <PrunButton
            key={name}
            dark
            inline
            class={$style.button}
            onClick={() => selectAddress(container, name)}>
            {name}
          </PrunButton>
        ))}
        <PrunButton
          dark
          inline
          class={$style.button}
          data-tooltip="Your own destination shortcuts. Edit them in XIT SET EXTRA."
          onClick={() => showBuffer('XIT SET EXTRA')}>
          +
        </PrunButton>
      </div>
    )).appendTo(container);
  });
}

function init() {
  tiles.observe('SFC', onTileReady);
}

features.add(
  import.meta.url,
  init,
  'SFC: Adds your own destination shortcut buttons (XIT SET EXTRA) next to the station buttons.',
);
