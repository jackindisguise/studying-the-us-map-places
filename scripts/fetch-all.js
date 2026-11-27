// Downloads the source files into data/raw/ (they are kept with the project, so builds work offline),
// then the founding dates (fetch-founding.js).
// Usage: node scripts/fetch-all.js             fetches only what is missing
//        node scripts/fetch-all.js --refresh   fetches everything again
import fs from 'node:fs';
import path from 'node:path';

const census = 'https://www2.census.gov';
const SOURCES = {
  'census/sub-est2025.csv': `${census}/programs-surveys/popest/datasets/2020-2025/cities/totals/sub-est2025.csv`,
  'census/acsdt5y2024-b01003.dat': `${census}/programs-surveys/acs/summary_file/2024/table-based-SF/data/5YRData/acsdt5y2024-b01003.dat`,
  'census/cb_2025_us_place_500k.zip': `${census}/geo/tiger/GENZ2025/shp/cb_2025_us_place_500k.zip`,
  'natural-earth/ne_10m_lakes.geojson': 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_lakes.geojson',
};

const refresh = process.argv.includes('--refresh');
for (const [file, url] of Object.entries(SOURCES)) {
  const out = `data/raw/${file}`;
  if (!refresh && fs.existsSync(out)) continue;
  const res = await fetch(url, { headers: { 'User-Agent': 'anki-deck-builder/1.0' } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${url}`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.from(await res.arrayBuffer()));
  console.log('fetched', out);
}
// fetch-founding.js reads --refresh from the same command line.
await import('./fetch-founding.js');
