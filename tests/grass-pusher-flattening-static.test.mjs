import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const grassSource = readFileSync(new URL('../src/grass.js', import.meta.url), 'utf8');

assert.match(
  grassSource,
  /float\s+pushCore\s*=\s*smoothstep\(0\.35,\s*0\.85,\s*ft\);/,
  'grass pusher shader should define an under-body core from the existing radial falloff'
);

assert.match(
  grassSource,
  /float\s+pushBladeWeight\s*=\s*mix\(aTipFactor \* aTipFactor,\s*aTipFactor \* \(0\.45 \+ 0\.55 \* aTipFactor\),\s*pushCore\);/,
  'grass pusher shader should strengthen mid-blade bending while keeping roots anchored at aTipFactor=0'
);

assert.match(
  grassSource,
  /float\s+pushAmp\s*=\s*pushBladeWeight \* pushFalloff \* push\.w;/,
  'grass pusher shader should apply the computed blade weight to the pusher amplitude'
);

assert.match(
  grassSource,
  /vec2\s+pushWorld\s*=\s*pdir \* pushAmp \* mix\(1\.0,\s*1\.15,\s*pushCore\);/,
  'grass pusher shader should slightly strengthen lateral lay-down in the under-body core'
);

assert.match(
  grassSource,
  /float\s+pushFlatten\s*=\s*pushFalloff \* pushCore \* 0\.65;/,
  'grass pusher shader should compute bounded vertical compression instead of subtractive sinking'
);

assert.match(
  grassSource,
  /transformed\.y\s\*=\s*1\.0 - pushFlatten;/,
  'grass pusher shader should compress blade height so grass remains visible instead of being removed below ground'
);

assert.doesNotMatch(
  grassSource,
  /transformed\.y\s-=\s*pushFlatten;/,
  'grass pusher shader should not subtract flattening, which can sink/remove grass under creatures'
);
