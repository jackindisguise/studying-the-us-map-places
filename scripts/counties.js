// The county or counties each place sits in.
// Incorporated places: from the Census estimates' place-by-county rows, the county with the most residents first.
// Census-designated places have no such rows, so points spread over their outline are looked up in the county shapes.
import fs from 'node:fs';
import { feature } from 'topojson-client';
import { censusRows } from './cities.js';
import { loadBoundaries } from './boundaries.js';

const SAMPLES = 40; // grid points along each side of a place's bounding box
const MIN_SHARE = 0.05; // a county holding less of the place than this is not listed

const ringsOf = (g) => (g.type === 'MultiPolygon' ? g.coordinates.flat() : g.coordinates);
// Even-odd rule over all rings, so holes count as outside.
const inside = (rings, [x, y]) => {
  let odd = false;
  for (const r of rings) {
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i], [xj, yj] = r[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) odd = !odd;
    }
  }
  return odd;
};
const boundsOf = (rings) => rings.flat().reduce(([w, s, e, n], [x, y]) => [Math.min(w, x), Math.min(s, y), Math.max(e, x), Math.max(n, y)], [180, 90, -180, -90]);

// Map of GEOID -> county names as shown on the card.
export async function loadCounties(places) {
  const rows = censusRows();
  const names = new Map(rows.filter((r) => r.SUMLEV === '050').map((r) => [r.STATE + r.COUNTY, r.NAME]));
  const parts = new Map(); // GEOID -> [[county FIPS, residents]]
  for (const r of rows.filter((x) => x.SUMLEV === '157')) {
    const id = r.STATE + r.PLACE;
    parts.set(id, [...(parts.get(id) || []), [r.STATE + r.COUNTY, Number(r.POPESTIMATE2025)]]);
  }

  const topo = JSON.parse(fs.readFileSync('node_modules/us-atlas/counties-10m.json', 'utf8'));
  const shapes = feature(topo, topo.objects.counties).features.map((f) => {
    const rings = ringsOf(f.geometry);
    return { id: f.id, name: f.properties.name, rings, bounds: boundsOf(rings) };
  });
  const outlines = await loadBoundaries(new Set(places.filter((p) => !parts.has(p.geoid)).map((p) => p.geoid)));
  for (const [geoid, { shape }] of outlines) {
    const [w, s, e, n] = boundsOf(shape.coordinates);
    const near = shapes.filter((c) => c.id.startsWith(geoid.slice(0, 2))
      && c.bounds[0] <= e && c.bounds[2] >= w && c.bounds[1] <= n && c.bounds[3] >= s);
    const hits = new Map();
    for (let i = 0; i < SAMPLES; i++) {
      for (let j = 0; j < SAMPLES; j++) {
        const p = [w + ((i + 0.5) / SAMPLES) * (e - w), s + ((j + 0.5) / SAMPLES) * (n - s)];
        if (!inside(shape.coordinates, p)) continue;
        const county = near.find((c) => inside(c.rings, p));
        if (county) hits.set(county.id, (hits.get(county.id) || 0) + 1);
      }
    }
    parts.set(geoid, [...hits]);
  }

  return new Map(places.map((p) => {
    const list = (parts.get(p.geoid) || []).sort((a, b) => b[1] - a[1]);
    const total = list.reduce((sum, [, n]) => sum + n, 0);
    const shown = list.filter(([, n], i) => i === 0 || n >= total * MIN_SHARE).map(([id]) => {
      const name = names.get(id) || shapes.find((c) => c.id === id)?.name;
      if (!name) throw new Error(`No county name for ${id}`);
      // Virginia's cities, Baltimore, St. Louis and Carson City belong to no county.
      return / city$|^Carson City$/.test(name) ? 'None (independent city)' : name;
    });
    return [p.geoid, shown.join(', ')];
  }));
}
