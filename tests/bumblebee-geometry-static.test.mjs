import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";

const creature = readFileSync("src/fauna/creature.js", "utf8");
const shared = readFileSync("src/fauna/shared.js", "utf8");

assert.match(creature, /if \(isBumblebee\) eye\.scale\.setScalar\(1\.1\)/);
assert.match(creature, /if \(isBumblebee\) pupil\.scale\.setScalar\(1\.1\)/);
assert.match(creature, /stalkHeight: isBumblebee \? 0\.4608 : 0\.32/);
assert.match(creature, /baseZ: isBumblebee \? 0\.22 : 0\.1/);
assert.match(creature, /forwardTiltAngle: isBumblebee \? THREE\.MathUtils\.degToRad\(20\) : 0/);
assert.match(creature, /new THREE\.ConeGeometry\(0\.045, 0\.45, 5\)/);
assert.match(creature, /stingerGeo\.rotateX\(-Math\.PI \/ 2\)/);
assert.match(shared, /forwardTiltAngle = 0/);
assert.match(shared, /stalk\.rotation\.x = forwardTiltAngle/);
