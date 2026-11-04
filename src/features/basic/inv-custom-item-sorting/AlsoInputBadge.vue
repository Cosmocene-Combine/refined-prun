<script setup lang="ts">
import fa from '@src/utils/font-awesome.module.css';

const tooltip =
  'This commodity is both an input and an output.\nEnsure a local reserve to avoid a production deadlock';
</script>

<template>
  <div :class="$style.container" :data-tooltip="tooltip">
    <div :class="[fa.solid, $style.icon]">{{ '' }}</div>
  </div>
</template>

<style module>
/* Same look as the item markers, at the top left of the commodity. */
.container {
  width: 15px;
  height: 15px;
  position: absolute;
  top: 0;
  left: 0;
  z-index: 1;
  background: #29353f;
  border: 1px solid #314b5f;
  border-radius: 0 4px 4px 4px;
  user-select: none;
}

.icon {
  margin: 1px;
  font-size: 9px;
  display: flex;
  justify-content: center;
  align-items: center;
  color: #f7a601;
  text-shadow: 1px 1px #222;
}
</style>
