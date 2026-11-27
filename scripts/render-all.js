// Renders the maps into build/media/ (all states, or only the abbreviations given), plus build/fit/maps.json.
// Each state gets one big square, north-up Mercator view centred on it at a true ground scale: the state in cream with its
// county lines, the other states and countries behind it. Every city of a state
// shares that map. A city's own area is a second, see-through image in the same frame (us-place-<geoid>.svg), in red, which
// the card script lays exactly over the state map; it rings cities too small to see, using maps.json.
// A place hard to see on that map also gets a zoom box (us-place-zoom-<geoid>.svg) with a scale bar.
// The drawing is in render-worker.js; this file shares it out between worker threads, one per processor core.
// Usage: node scripts/render-all.js [CA RI ...]
//        RENDER_JOBS=4 sets the number of workers.
import fs from 'node:fs';
import os from 'node:os';
import { Worker } from 'node:worker_threads';
import { STATES } from './geo.js';
import { loadCities } from './cities.js';

const BATCH = 8; // cities per job: small enough that no worker is left with a big state at the end

const cities = (await loadCities());
const only = process.argv.slice(2);
const todo = STATES.filter((s) => !only.length || only.includes(s.abbr));
const jobs = todo.flatMap((s) => {
  const n = cities.filter((c) => c.abbr === s.abbr).length;
  return Array.from({ length: Math.ceil(n / BATCH) }, (_, i) => ({ abbr: s.abbr, from: i * BATCH, to: Math.min(n, (i + 1) * BATCH) }));
});
fs.mkdirSync('build/media', { recursive: true });
fs.mkdirSync('build/fit', { recursive: true });

const count = Math.min(Number(process.env.RENDER_JOBS) || os.availableParallelism(), jobs.length);
const results = new Array(jobs.length);
let next = 0;
// Each worker takes the next job as soon as it finishes one.
const run = () => new Promise((resolve, reject) => {
  const worker = new Worker(new URL('./render-worker.js', import.meta.url));
  let current, done = false;
  worker.on('message', (result) => {
    if (result) {
      results[current] = result;
      report(jobs[current].abbr);
    }
    if (next < jobs.length) worker.postMessage(jobs[(current = next++)]);
    else {
      done = true;
      worker.terminate();
    }
  });
  worker.on('error', reject);
  worker.on('exit', (code) => (done ? resolve() : reject(new Error(`A render worker stopped early (code ${code})`))));
});

// One line per state, when the last of its jobs is done.
function report(abbr) {
  const mine = jobs.map((j, i) => (j.abbr === abbr ? i : -1)).filter((i) => i >= 0);
  if (!mine.every((i) => results[i])) return;
  const fits = mine.flatMap((i) => Object.values(results[i].fit));
  const { canvas, kb } = results[mine[0]];
  const name = todo.find((s) => s.abbr === abbr).name;
  console.log(`${abbr} ${name.padEnd(16)} ${String(canvas).padStart(5)} mi  ${String(kb).padStart(4)} KB  ${fits.length} cities, ${fits.filter((f) => f.zoom).length} zoom boxes`);
}

const started = Date.now();
try {
  await Promise.all(Array.from({ length: count }, run));
} catch (error) {
  console.error(error);
  process.exit(1); // stops the other workers too
}

// Merged in job order, so the file does not depend on which worker finished first.
const FIT_FILE = 'build/fit/maps.json';
const fit = fs.existsSync(FIT_FILE) ? JSON.parse(fs.readFileSync(FIT_FILE, 'utf8')) : {};
for (const r of results) Object.assign(fit, r.fit);
fs.writeFileSync(FIT_FILE, JSON.stringify(fit));
console.log(`rendered ${todo.length} state maps to build/media with ${count} workers in ${((Date.now() - started) / 1000).toFixed(0)} s`);
