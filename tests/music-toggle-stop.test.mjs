import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const rafCallbacks = [];

class FakeAudio {
  static instances = [];

  constructor() {
    this.loop = false;
    this.volume = 0;
    this.preload = '';
    this.paused = true;
    this._src = '';
    this.playCount = 0;
    this.pauseCount = 0;
    this.loadCount = 0;
    FakeAudio.instances.push(this);
  }

  get src() {
    return this._src;
  }

  set src(value) {
    this._src = value;
  }

  play() {
    this.paused = false;
    this.playCount += 1;
    return Promise.resolve();
  }

  pause() {
    this.paused = true;
    this.pauseCount += 1;
  }

  load() {
    this.loadCount += 1;
  }
}

const tempDir = await mkdtemp(join(tmpdir(), 'small-world-music-test-'));

try {
  const entryPath = join(tempDir, 'entry.mjs');
  const bundlePath = join(tempDir, 'bundle.mjs');
  const musicPath = fileURLToPath(new URL('../src/music.js', import.meta.url));
  const statePath = fileURLToPath(new URL('../src/state.js', import.meta.url));
  await writeFile(entryPath, [
    `export * from ${JSON.stringify(musicPath)};`,
    `export { state } from ${JSON.stringify(statePath)};`,
  ].join('\n'));
  await build({
    entryPoints: [entryPath],
    outfile: bundlePath,
    bundle: true,
    format: 'esm',
    platform: 'node',
    define: { __APP_VERSION__: '"test"' },
    logLevel: 'silent',
  });

  globalThis.Audio = FakeAudio;
  globalThis.requestAnimationFrame = (callback) => {
    rafCallbacks.push(callback);
    return rafCallbacks.length;
  };

  const { state, setMusicEnabled, switchMusic } = await import(pathToFileURL(bundlePath).href);

  state.userSettings.musicEnabled = true;
  state.userSettings.musicVolume = 0.5;
  state.userSettings.musicTrackOverrides = {};

  switchMusic({ id: 'cloud', name: 'cloud island' });

  const audio = FakeAudio.instances[0];
  assert(audio, 'switchMusic should lazily create the audio element.');
  assert.equal(audio.paused, false, 'Enabled music should start playback when a track is selected.');
  assert.equal(audio.loadCount, 1, 'Selecting a track should load the chosen stream.');
  assert(rafCallbacks.length > 0, 'Starting music should queue a fade-in frame.');

  audio.volume = 0.1;
  setMusicEnabled(false);

  assert.equal(state.userSettings.musicEnabled, false, 'setMusicEnabled(false) should update persisted state.');
  assert.equal(audio.volume, 0, 'Turning music off should silence the audio element immediately.');
  assert.equal(audio.paused, true, 'Turning music off should pause playback immediately.');
  assert.equal(audio.pauseCount, 1, 'Turning music off should call pause exactly once.');

  for (const callback of rafCallbacks) callback(performance.now() + 1000);

  assert.equal(audio.volume, 0, 'Pending fade-in frames should not restore volume after music is off.');
  assert.equal(audio.paused, true, 'Pending fade frames should not restart playback after music is off.');
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
