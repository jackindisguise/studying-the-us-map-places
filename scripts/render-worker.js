// Draws the maps for render-all.js, which runs this file in worker threads, one per processor core.
// A job is a run of one state's cities, { abbr, from, to }; the job starting at the first city also writes the state map.
// Each city gets its area (us-place-<geoid>.svg) and, if hard to see on the state map, its zoom box.
import fs from 'node:fs';
import { parentPort } from 'node:worker_threads';
import { feature } from 'topojson-client';
import { geoMercator, geoPath, geoArea, geoBounds } from 'd3-geo';
import { STATES, shapes, atlas, countyLines } from './geo.js';
import { loadCities } from './cities.js';
import { loadBoundaries } from './boundaries.js';

const SIZE = 2000; // canvas of the state map, px
const SHARE = 0.4; // the state's larger side takes at most this share of the canvas, so wide states fit a phone screen
const MIN_CANVAS_MI = 875;
const MIN_CONTEXT_MI = 160; // the card never zooms in past a view this many miles across
// A place gets a zoom box only if it would be hard to see on the state map of a desktop card: under ZOOM_UNDER_PX across.
const VIEW_PX = [1180, 660]; // the room a state is fitted into on a 1280 x 720 card
const MAX_PX_PER_MI = 1280 / MIN_CONTEXT_MI; // the card never zooms in further than this
const ZOOM_UNDER_PX = 30; // the card script rings places under this size too
const ZOOM_BOX_PX = 300; // the box's width on a desktop card
const ZOOM_TIMES = 3; // the box shows the place at least this many times larger than the map does
const ZOOM_MI = 30; // the widest a box is for the smallest places, narrower where the state map is already close up
const ZOOM_FILL = 0.4; // a larger place widens its box so that it takes at most this share of it
const COLORS = { ocean: '#7fb0d0', land: '#d8d5c9', border: '#8f897a', foreign: '#cbc8bc', state: '#fbf8ec', stateBorder: '#4d483d', county: '#cfc8b4', target: '#d9381e', targetBorder: '#8f1f0d' };
const R_MI = 3959;

const json = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const world = json('node_modules/world-atlas/countries-10m.json');
// Other countries (840 is the United States, drawn from the state shapes instead).
const foreign = feature(world, world.objects.countries).features.filter((f) => f.id !== '840' && f.geometry).map(solid);
// A few tiny islands in the atlas have zero-size rings that d3 reads as covering the whole globe, flooding the map.
function solid(f) {
  if (f.geometry.type !== 'MultiPolygon') return f;
  const coordinates = f.geometry.coordinates.filter((c) => geoArea({ type: 'Polygon', coordinates: c }) < 2 * Math.PI);
  return { ...f, geometry: { type: 'MultiPolygon', coordinates } };
}
// d3 wants exterior rings clockwise on the sphere (plain GeoJSON is the other way round).
const rewind = (g) => {
  const flip = (poly) => (geoArea({ type: 'Polygon', coordinates: poly }) > 2 * Math.PI ? poly.map((r) => r.slice().reverse()) : poly);
  return g.type === 'MultiPolygon' ? { ...g, coordinates: g.coordinates.map(flip) } : { ...g, coordinates: flip(g.coordinates) };
};
// Only the larger lakes (the Great Lakes, which the state shapes leave out, would otherwise show as Canadian land).
const lakes = json('data/raw/natural-earth/ne_10m_lakes.geojson').features
  .filter((f) => f.geometry && f.properties.scalerank <= 2)
  .map((f) => ({ ...f, geometry: rewind(f.geometry) }));
const LABELS = [['CANADA', [-104, 56]], ['MEXICO', [-102.5, 23.5]]];

// North-up frame of a fixed ground width: Mercator centred on [lon, lat], scaled so distances are true at the centre latitude.
const frame = ([lon, lat], miles, w, h) => geoMercator().rotate([-lon, 0]).center([0, lat])
  .scale((w / miles) * R_MI * Math.cos((lat * Math.PI) / 180)).translate([w / 2, h / 2])
  .clipExtent([[-20, -20], [w + 20, h + 20]]); // nothing outside the canvas is written to the SVG

// Drops vertices closer than `min` px to the previous kept one (sub-pixel detail nobody can see).
function thin(d, min = 0.5) {
  let px = 0, py = 0;
  return d.replace(/([MLZ])([^MLZ]*)/g, (m, c, rest) => {
    if (c === 'Z') return m;
    const [x, y] = rest.split(',').map(Number);
    if (c === 'L' && Math.hypot(x - px, y - py) < min) return '';
    px = x; py = y;
    return m;
  });
}

// A place's area in red. Not thinned: a small place is only a few pixels across.
const area = (proj, c, width) => `<path d="${geoPath(proj).digits(2)(c.shape) || ''}" fill="${COLORS.target}" stroke="${COLORS.targetBorder}" stroke-width="${width}" stroke-linejoin="round"/>`;

function draw(target, proj, w, h, { ui = 2, labels = false } = {}) {
  const path = geoPath(proj).digits(1);
  const d = (list) => thin(list.map((f) => path(f)).filter(Boolean).join(''));
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">`
    + `<rect width="${w}" height="${h}" fill="${COLORS.ocean}"/>`
    + `<path d="${d(foreign)}" fill="${COLORS.foreign}" stroke="${COLORS.border}" stroke-width="${0.8 * ui}"/>`
    + `<path d="${d(lakes)}" fill="${COLORS.ocean}"/>`
    + `<path d="${d(atlas.filter((f) => f.id !== target.id))}" fill="${COLORS.land}" stroke="${COLORS.border}" stroke-width="${0.8 * ui}"/>`
    + `<path d="${d([target])}" fill="${COLORS.state}"/>`
    + `<path d="${d([countyLines(target.id)])}" fill="none" stroke="${COLORS.county}" stroke-width="${0.6 * ui}"/>`
    + `<path d="${d([target])}" fill="none" stroke="${COLORS.stateBorder}" stroke-width="${1.4 * ui}" stroke-linejoin="round"/>`;
  if (labels) {
    for (const [text, at] of LABELS) {
      const p = proj(at);
      if (!p || p[0] < 0 || p[0] > w || p[1] < 0 || p[1] > h) continue;
      svg += `<text x="${p[0].toFixed(1)}" y="${p[1].toFixed(1)}" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-weight="700" font-size="${11 * ui}" letter-spacing="${2.5 * ui}" fill="#27323c" fill-opacity="0.55">${text}</text>`;
    }
  }
  return svg + '</svg>';
}

// The state's main land: its big parts only, so far-off islands do not pull the frame (Alaska's western Aleutians).
function mainLand(f) {
  if (f.geometry.type !== 'MultiPolygon') return f.geometry;
  const areas = f.geometry.coordinates.map((c) => geoArea({ type: 'Polygon', coordinates: c }));
  const max = Math.max(...areas);
  // Hawaii is all islands: keep every one that is at least 2% of the biggest.
  return { type: 'MultiPolygon', coordinates: f.geometry.coordinates.filter((_, i) => areas[i] >= max * 0.02) };
}

// Centre of a shape's bounding box, in lon/lat (handles shapes that cross the antimeridian).
function extentOf(geom) {
  const [[west, south], [east, north]] = geoBounds(geom);
  const width = (east - west + 360) % 360;
  const lon = ((west + width / 2 + 540) % 360) - 180;
  const my = (l) => Math.log(Math.tan(Math.PI / 4 + (l * Math.PI) / 360));
  const lat = ((2 * Math.atan(Math.exp((my(south) + my(north)) / 2)) - Math.PI / 2) * 180) / Math.PI;
  const miles = Math.max(width * Math.cos((lat * Math.PI) / 180) * 69.17, (north - south) * 69.17);
  return { centre: [lon, lat], miles, width: width * Math.cos((lat * Math.PI) / 180) * 69.17, height: (north - south) * 69.17 };
}

// Zoom box: the same drawing in a small frame centred on the city, with its area in red and a scale bar.
function drawZoom(target, city, scale, w = 600, h = 480) {
  // Wide enough for the city both ways (the box is wider than it is tall).
  const closest = Math.min(ZOOM_MI, ZOOM_BOX_PX / (ZOOM_TIMES * scale));
  const miles = Math.max(closest, (city.size / ZOOM_FILL) * (w / h));
  const proj = frame([city.lon, city.lat], miles, w, h);
  const svg = draw(target, proj, w, h);
  // The longest round distance that fits in about a quarter of the width.
  const bar = [100, 50, 20, 10, 5, 2].find((m) => m <= miles / 4) || 1;
  const bx = 24, by = h - 30, bx1 = +(bx + (bar / miles) * w).toFixed(1);
  const line = `M${bx} ${by - 8}V${by}H${bx1}V${by - 8}`;
  const font = 'font-family="Segoe UI, Arial, sans-serif" font-size="34" fill="#1d2a35" stroke="#ffffff" stroke-width="7" stroke-linejoin="round" paint-order="stroke"';
  return svg.replace('</svg>', area(proj, city, 2)
    + `<path d="${line}" fill="none" stroke="#ffffff" stroke-width="9"/><path d="${line}" fill="none" stroke="#1d2a35" stroke-width="5"/>`
    + `<text x="${bx}" y="${by - 16}" ${font}>${bar} mi</text></svg>`);
}

const list = (await loadCities());
const outlines = await loadBoundaries(new Set(list.map((c) => c.geoid)));
const cities = list.map((c) => {
  if (!outlines.has(c.geoid)) throw new Error(`No boundary for ${c.geoid} ${c.censusName}`);
  return { ...c, ...outlines.get(c.geoid) };
});
const round = (v) => +v.toFixed(4);

function render({ abbr, from, to }) {
  const target = shapes.get(abbr);
  const land = mainLand(target);
  const inState = cities.filter((c) => c.abbr === abbr);
  const { centre, miles: extent, width, height } = extentOf(land);
  // Pixels per mile of the state map on a desktop card.
  const scale = Math.min(VIEW_PX[0] / width, VIEW_PX[1] / height, MAX_PX_PER_MI);
  const canvas = Math.max(MIN_CANVAS_MI, Math.round(extent / SHARE));
  const proj = frame(centre, canvas, SIZE, SIZE);
  const [[x0, y0], [x1, y1]] = geoPath(proj).bounds(land);
  const points = inState.map((c) => proj([c.lon, c.lat]));
  // [left, top, right, bottom] of the state (stretched to hold every city), and the smallest view as a share of the canvas.
  const box = [
    Math.min(x0, ...points.map((p) => p[0])), Math.min(y0, ...points.map((p) => p[1])),
    Math.max(x1, ...points.map((p) => p[0])), Math.max(y1, ...points.map((p) => p[1])),
  ].map((v) => round(v / SIZE)).concat(round(Math.min(MIN_CONTEXT_MI, canvas) / canvas));
  const result = { fit: {}, canvas };
  if (from === 0) {
    const svg = draw(target, proj, SIZE, SIZE, { labels: true });
    fs.writeFileSync(`build/media/us-state-${abbr}.svg`, svg);
    result.kb = Math.round(svg.length / 1024);
  }
  for (let i = from; i < to; i++) {
    const c = inState[i];
    fs.writeFileSync(`build/media/us-place-${c.geoid}.svg`,
      `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}" preserveAspectRatio="none">`
      + `${area(proj, c, 0.8)}</svg>`);
    const file = `build/media/us-place-zoom-${c.geoid}.svg`;
    const zoom = c.size * scale < ZOOM_UNDER_PX;
    if (zoom) fs.writeFileSync(file, drawZoom(target, c, scale));
    else fs.rmSync(file, { force: true });
    // The city's centre and longer side, as shares of the canvas.
    result.fit[c.geoid] = { box, city: [round(points[i][0] / SIZE), round(points[i][1] / SIZE), +(c.size / canvas).toFixed(5)], zoom };
  }
  return result;
}

parentPort.on('message', (job) => parentPort.postMessage(render(job)));
parentPort.postMessage(null); // ready for the first job
