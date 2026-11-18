import RouteBurns from '@src/features/XIT/ROUTEBURNS/RouteBurns.vue';

xit.add({
  command: 'ROUTEBURNS',
  name: 'ROUTE BURNS',
  description: 'Plans a resupply route from the burn of your bases.',
  component: () => RouteBurns,
  bufferSize: [800, 800],
});
