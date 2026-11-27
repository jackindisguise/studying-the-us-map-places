// The 50 states and their shapes (us-atlas, Census cartographic boundaries at 1:10m).
import fs from 'node:fs';
import { feature, mesh } from 'topojson-client';

const dir = new URL('../', import.meta.url);
const read = (f) => JSON.parse(fs.readFileSync(new URL(f, dir), 'utf8'));

export const STATES = read('data/states.json'); // [{ abbr, fips, name, region }]
// The county file holds the states too, so both are drawn from the same lines.
const topo = read('node_modules/us-atlas/counties-10m.json');

// Every shape in the atlas (including DC and the territories), used as the map backdrop.
export const atlas = feature(topo, topo.objects.states).features;
const byFips = new Map(atlas.map((f) => [f.id, f]));
export const shapes = new Map(STATES.map((s) => {
  const f = byFips.get(s.fips);
  if (!f) throw new Error(`No shape for ${s.abbr}`);
  return [s.abbr, f];
}));

// The county lines inside one state (a county's id starts with its state's FIPS code).
export const countyLines = (fips) => mesh(topo, topo.objects.counties,
  (a, b) => a !== b && a.id.startsWith(fips) && b.id.startsWith(fips));
