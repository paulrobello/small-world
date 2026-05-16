// Factory for per-regen resource pools. Each `makePool()` call returns an
// independent pool with its own namespace — flora and fauna each get one so
// their resources don't collide. `reset()` clears the pool between world
// regens so stale (disposed) Three.js handles don't leak.

export function makePool() {
  let map = new Map();
  const get = (key, factory) => {
    let v = map.get(key);
    if (v === undefined) {
      v = factory();
      map.set(key, v);
    }
    return v;
  };
  const reset = () => {
    map = new Map();
  };
  return { get, reset };
}
