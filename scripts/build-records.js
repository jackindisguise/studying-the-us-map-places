// Combines the Census figures, founding years and infobox facts into data/records.json (one object per place with the exact
// note field values, except images) and writes the deck descriptions. Places are ordered by state name, most populous first.
// Usage: node scripts/build-records.js
import fs from 'node:fs';
import { loadCities, MIN_POP, TOP_PER_STATE } from './cities.js';
import { loadFounding } from './founding.js';
import { loadFacts } from './facts.js';
import { loadCounties } from './counties.js';

const DECK = 'Studying the US Map / Places';
const int = (n) => Math.round(n).toLocaleString('en-US');
const ranked = (r) => (r ? `#${int(r.rank)}/${int(r.of)}` : '');
const sqMiles = (a) => `${a < 10 ? a.toFixed(1) : int(a)} sq mi`;

const founding = loadFounding();
const facts = loadFacts();
const list = await loadCities();
const counties = await loadCounties(list);
const cities = list.map((c) => ({ ...c, founded: founding(c), ...facts(c) }));
const dated = cities.filter((c) => c.founded);
// 1 = oldest; places founded in the same year share a rank.
const age = (peers, c) => ranked({ rank: 1 + peers.filter((x) => x.founded.year < c.founded.year).length, of: peers.length });

cities.sort((a, b) => a.state.localeCompare(b.state) || b.pop - a.pop || a.name.localeCompare(b.name));
const records = cities.map((c) => ({
  ID: `US-PLACE-${c.geoid}`,
  Name: c.name,
  State: c.state,
  Abbreviation: c.abbr,
  'Place Type': c.cdp ? 'census-designated place' : '',
  Population: int(c.pop),
  'State Population Rank': ranked(c.ranks.pop.state),
  'US Population Rank': ranked(c.ranks.pop.us),
  'Land Area': c.area ? sqMiles(c.area) : '',
  'State Area Rank': ranked(c.ranks.area.state),
  'US Area Rank': ranked(c.ranks.area.us),
  Density: c.density ? `${int(c.density)} /sq mi` : '',
  'State Density Rank': ranked(c.ranks.density.state),
  'US Density Rank': ranked(c.ranks.density.us),
  Founded: c.founded ? String(c.founded.year) : '',
  'Founded As': c.founded?.kind || '',
  'State Founded Rank': c.founded ? age(dated.filter((x) => x.abbr === c.abbr), c) : '',
  'US Founded Rank': c.founded ? age(dated, c) : '',
  County: counties.get(c.geoid),
  Elevation: c.elevation === null ? '' : `${int(c.elevation)} ft`,
  Nickname: c.nickname,
  'As Of': c.popSource,
}));
fs.writeFileSync('data/records.json', JSON.stringify(records, null, 1) + '\n');

const descriptions = {
  [DECK]: `Find ${int(records.length)} U.S. places on their state maps: every city, town or census-designated place over `
    + `${int(MIN_POP)} people, and at least the ${TOP_PER_STATE} largest in each state.`,
};
for (const state of [...new Set(records.map((r) => r.State))]) {
  const n = records.filter((r) => r.State === state).length;
  descriptions[`${DECK}::${state}`] = n === 1 ? '1 place.' : `${n} places, most populous first.`;
}
fs.writeFileSync('data/deck-descriptions.json', JSON.stringify(descriptions, null, 1) + '\n');

console.log(records.length, 'records');
for (const k of Object.keys(records[0])) {
  const empty = records.filter((r) => !r[k]).length;
  if (empty) console.log(k.padEnd(20), 'empty in', empty);
}
