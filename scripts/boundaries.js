// City outlines from the Census cartographic boundary file for places (1:500k, a zipped shapefile), keyed by GEOID.
import fs from 'node:fs';
import JSZip from 'jszip';
import { geoArea, geoBounds } from 'd3-geo';

const FILE = 'data/raw/census/cb_2025_us_place_500k.zip';

// The wanted columns of each record in the .dbf table, in the order of the shapes.
const records = (dbf, wanted) => {
  const count = dbf.readUInt32LE(4), headerSize = dbf.readUInt16LE(8), recordSize = dbf.readUInt16LE(10);
  let offset = 1; // byte 0 of a record is its deletion flag
  const fields = [];
  for (let at = 32; dbf[at] !== 0x0d; at += 32) {
    const name = dbf.toString('latin1', at, at + 11).replace(/\0.*$/, '');
    if (wanted.includes(name)) fields.push({ name, offset, length: dbf[at + 16] });
    offset += dbf[at + 16];
  }
  return Array.from({ length: count }, (_, i) => Object.fromEntries(fields.map((f) => {
    const start = headerSize + i * recordSize + f.offset;
    return [f.name, dbf.toString('utf8', start, start + f.length).trim()];
  })));
};

// The rings of each polygon record in the .shp file, as [lon, lat] lists. Outer rings run clockwise, as d3 expects.
const polygons = (shp) => {
  const out = [];
  for (let at = 100; at < shp.length; at += 8 + shp.readUInt32BE(at + 4) * 2) {
    const body = at + 8, type = shp.readInt32LE(body);
    if (type !== 5) throw new Error(`Unexpected shape type ${type}`);
    const parts = shp.readInt32LE(body + 36), points = shp.readInt32LE(body + 40);
    const starts = Array.from({ length: parts }, (_, i) => shp.readInt32LE(body + 44 + i * 4));
    const first = body + 44 + parts * 4;
    out.push(starts.map((s, i) => Array.from({ length: (starts[i + 1] ?? points) - s }, (_, j) => {
      const p = first + (s + j) * 16;
      return [shp.readDoubleLE(p), shp.readDoubleLE(p + 8)];
    })));
  }
  return out;
};

const open = async () => {
  const zip = await JSZip.loadAsync(fs.readFileSync(FILE));
  return (ext) => zip.file(new RegExp(`\\.${ext}$`))[0].async('nodebuffer');
};

// Every place in the file: { GEOID, NAME, LSAD, ALAND }. LSAD 57 marks a census-designated place; ALAND is land in m².
export async function loadPlaceNames() {
  const read = await open();
  return records(await read('dbf'), ['GEOID', 'NAME', 'LSAD', 'ALAND']);
}

// Map of GEOID -> { shape, lon, lat, size } for the wanted places. lon/lat is the centre of the city's largest part and
// size that part's longer side in miles, so outlying islands (San Francisco's Farallons) do not move the city.
export async function loadBoundaries(wanted) {
  const read = await open();
  const ids = records(await read('dbf'), ['GEOID']).map((r) => r.GEOID);
  const rings = polygons(await read('shp'));
  const out = new Map();
  ids.forEach((id, i) => {
    if (!wanted.has(id)) return;
    // A ring covering more than half the globe is a hole (it runs the other way round).
    const outer = rings[i].map((r) => ({ r, area: geoArea({ type: 'Polygon', coordinates: [r] }) }))
      .filter((x) => x.area < 2 * Math.PI).sort((a, b) => b.area - a.area)[0];
    const [[west, south], [east, north]] = geoBounds({ type: 'Polygon', coordinates: [outer.r] });
    const lat = (south + north) / 2, width = (east - west + 360) % 360;
    out.set(id, {
      shape: { type: 'Polygon', coordinates: rings[i] },
      lon: ((west + width / 2 + 540) % 360) - 180,
      lat,
      size: Math.max(width * Math.cos((lat * Math.PI) / 180), north - south) * 69.17,
    });
  });
  return out;
}
