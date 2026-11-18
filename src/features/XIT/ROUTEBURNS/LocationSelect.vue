<script setup lang="ts">
import SelectInput from '@src/components/forms/SelectInput.vue';
import TextInput from '@src/components/forms/TextInput.vue';
import { findLocation, routeLocations } from '@src/features/XIT/ROUTEBURNS/locations';

// A dropdown of your bases and warehouses, like the storage list of XIT BURNACT.
// "Custom..." shows a text box for a name that is not in the list.
const model = defineModel<string>({ required: true });

const { emptyLabel = '-' } = defineProps<{ emptyLabel?: string }>();

const customValue = '\u0000custom';

const customMode = ref(false);

const known = computed(() => findLocation(routeLocations.value, model.value));

// A saved name that is not in the list (an old preset, a typed name) shows in the text box.
const showText = computed(
  () => customMode.value || (model.value.trim() !== '' && known.value === undefined),
);

const options = computed(() => [
  { label: emptyLabel, value: '' },
  ...routeLocations.value,
  { label: 'Custom...', value: customValue },
]);

const selected = computed({
  get: () => (showText.value ? customValue : (known.value?.value ?? '')),
  set: (value: string | undefined) => {
    if (value === customValue) {
      customMode.value = true;
      return;
    }
    customMode.value = false;
    model.value = value ?? '';
  },
});

const text = computed({
  get: () => model.value,
  set: (value: string | undefined) => {
    model.value = value ?? '';
  },
});
</script>

<template>
  <div :class="$style.container">
    <TextInput v-if="showText" v-model="text" :class="$style.text" />
    <SelectInput v-model="selected" :options="options" />
  </div>
</template>

<style module>
.container {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  column-gap: 3px;
}

.text {
  flex: 1;
}
</style>
