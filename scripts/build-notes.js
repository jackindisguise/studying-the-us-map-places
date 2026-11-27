// Writes one Anki-importable CSV note file with a row per place to build/notes.csv.
// Fields follow the Place Map note type; Map holds <img> tags that use the real file names in build/media/.
// Usage: node scripts/build-notes.js
import fs from 'node:fs';

const DECK = 'Studying the US Map / Places', MODEL = 'Place Map', TAG = 'us-places';
const FIELDS = ['ID', 'Name', 'Map', 'State', 'Abbreviation', 'Place Type', 'Population', 'State Population Rank', 'US Population Rank', 'Land Area', 'State Area Rank', 'US Area Rank', 'Density', 'State Density Rank', 'US Density Rank', 'Founded', 'Founded As', 'State Founded Rank', 'US Founded Rank', 'County', 'Elevation', 'Nickname', 'As Of'];

// records.json is ordered by state, most populous first; Anki shows new cards in this order.
const records = JSON.parse(fs.readFileSync('data/records.json', 'utf8'));
const maps = JSON.parse(fs.readFileSync('build/fit/maps.json', 'utf8'));
const csv = (v) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

const header = [
  '#separator:Comma', '#html:true', `#notetype:${MODEL}`,
  `#columns:${[...FIELDS, 'Deck', 'Tags'].join(',')}`,
  `#deck column:${FIELDS.length + 1}`, `#tags column:${FIELDS.length + 2}`,
];
const rows = records.map((r) => {
  const geoid = r.ID.replace('US-PLACE-', '');
  const { box, city, zoom } = maps[geoid];
  const f = {
    ...r,
    Map: `<img src="us-state-${r.Abbreviation}.svg" data-box="${box.join(',')}" data-city="${city.join(',')}"><img class="city" src="us-place-${geoid}.svg">`
      // Places hard to see on the state map also get a zoom box the card pins to a corner.
      + (zoom ? `<img class="zoom" src="us-place-zoom-${geoid}.svg">` : ''),
  };
  return [...FIELDS.map((k) => f[k] || ''), `${DECK}::${r.State}`, `${TAG} ${TAG}::${r.Abbreviation}`].map(csv).join(',');
});
fs.mkdirSync('build', { recursive: true });
fs.writeFileSync('build/notes.csv', [...header, ...rows].join('\n') + '\n');
console.log('wrote', rows.length, 'notes to build/notes.csv');
