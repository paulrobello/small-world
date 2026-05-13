// Barrel — fauna entity modules live under src/fauna/. This file preserves
// the public import path "./fauna.js" used by main.js, world.js, ui.js, and
// inspect.js so consumers don't need to know about the per-entity split.
export {
  makeCreature,
  stepCreature,
  lookAtCreature,
  wakeCreature,
} from "./fauna/creature.js";
export { makeCaterpillar, stepCaterpillar } from "./fauna/caterpillar.js";
export { makeButterfly, stepButterfly } from "./fauna/butterfly.js";
export { makeBee, makeSwarm, stepBee } from "./fauna/bee.js";
