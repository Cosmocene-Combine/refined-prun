<script setup lang="ts">
import GridMaterialIcon from '@src/components/GridMaterialIcon.vue';
import fa from '@src/utils/font-awesome.module.css';
import { cxosStore } from '@src/infrastructure/prun-api/data/cxos';
import { cxobStore } from '@src/infrastructure/prun-api/data/cxob';
import { cxStore } from '@src/infrastructure/fio/cx';
import { showBuffer } from '@src/infrastructure/prun-ui/buffers';
import { fixed0, fixed02 } from '@src/utils/format';
import { getOnSaleItems, OnSaleItem } from './sell-order-status';

const { exchange } = defineProps<{ exchange: string }>();

const items = computed(() => {
  const orders = (cxosStore.active.value ?? [])
    .filter(x => x.type === 'SELLING' && x.exchange.code === exchange && x.amount > 0)
    .map(x => ({
      id: x.id,
      ticker: x.material.ticker,
      amount: x.amount,
      price: x.limit.amount,
    }));
  return getOnSaleItems(
    orders,
    ticker =>
      cxobStore.getByTicker(`${ticker}.${exchange}`)?.sellingOrders.map(x => ({
        id: x.id,
        price: x.limit.amount,
      })),
    ticker => cxStore.prices?.get(exchange)?.get(ticker)?.Ask ?? undefined,
  );
});

function formatPrice(value: number) {
  return value >= 100 ? fixed0(value) : fixed02(value);
}

function tooltip(item: OnSaleItem) {
  if (item.bestOther === undefined) {
    return 'No other seller found';
  }
  return item.undercut
    ? `Undercut, best ask ${formatPrice(item.bestOther)}`
    : `Cheapest, next ask ${formatPrice(item.bestOther)}`;
}
</script>

<template>
  <div :class="$style.section">
    <div :class="$style.title">
      ON SALE AT {{ exchange }} ({{ items.length }})
      <span v-if="!cxosStore.fetched.value"> · loading orders…</span>
      <span v-else-if="items.length === 0"> · no open sell order</span>
    </div>
    <!-- Same grid as the game inventory above, so sizes and spacing match. -->
    <div v-if="items.length > 0" :class="C.InventoryView.grid">
      <div
        v-for="item in items"
        :key="item.ticker"
        :class="$style.item"
        :data-tooltip="tooltip(item)"
        data-tooltip-position="top"
        @click="showBuffer(`CXPO ${item.ticker}.${exchange}`)">
        <GridMaterialIcon
          :ticker="item.ticker"
          :amount="item.amount"
          :text="formatPrice(item.price)" />
        <div :class="[$style.tag, fa.solid, item.undercut ? $style.undercut : $style.cheapest]">
          {{ item.undercut ? '\uf063' : '\uf00c' }}
        </div>
      </div>
    </div>
  </div>
</template>

<style module>
.section {
  margin-top: 8px;
  padding-top: 4px;
  border-top: 1px solid #2b485a;
}

.title {
  color: #888;
  font-size: 11px;
  margin: 0 4px 4px;
}

.item {
  position: relative;
  cursor: pointer;

  > div:first-child {
    pointer-events: none;
  }
}

/* Order status, same look as the item markers: check when cheapest, arrow when undercut. */
.tag {
  position: absolute;
  top: 0;
  left: 0;
  width: 15px;
  height: 15px;
  display: flex;
  justify-content: center;
  align-items: center;
  font-size: 9px;
  background: #29353f;
  border: 1px solid #314b5f;
  border-radius: 0 4px 4px 4px;
  text-shadow: 1px 1px #222;
  pointer-events: none;
}

.cheapest {
  color: #5cb85c;
}

.undercut {
  color: #d9534f;
}
</style>
