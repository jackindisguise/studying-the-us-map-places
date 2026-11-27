// Downloads what the founding dates and other infobox facts are read from:
//   data/raw/wikidata/places.json    Wikidata item, English Wikipedia title and "inception" for each city, matched by FIPS code
//   data/raw/wikipedia/cities.json   the "established" lines of each city's Wikipedia infobox
//   data/raw/wikipedia/facts.json    each infobox's nickname and elevation (read by facts.js)
// A city Wikidata has no FIPS code for is looked up on Wikipedia as "Name, State" (cities.js can name another article).
// Usage: node scripts/fetch-founding.js             fetches only the missing cities
//        node scripts/fetch-founding.js --refresh   fetches everything again
import fs from 'node:fs';
import path from 'node:path';
import { loadCities } from './cities.js';
import { factParams } from './facts.js';

const AGENT = { 'User-Agent': 'anki-deck-builder/1.0' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const refresh = process.argv.includes('--refresh');
const load = (f) => (!refresh && fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {});
const save = (f, data) => {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(data, null, 1) + '\n');
};
const request = async (url, options = {}) => {
  for (let tries = 0; ; tries++) {
    const res = await fetch(url, { ...options, headers: { ...AGENT, ...options.headers } });
    if (res.ok) {
      const data = await res.json();
      if (data.error?.code !== 'maxlag') {
        if (data.error) throw new Error(`${data.error.code}: ${data.error.info}`);
        return data;
      }
    } else if (res.status !== 429 && res.status < 500) throw new Error(`${res.status} ${res.statusText}: ${url}`);
    if (tries >= 5) throw new Error(`Gave up after ${tries + 1} tries: ${url}`);
    await sleep(1000 * (Number(res.headers.get('retry-after')) || 5 * (tries + 1)));
  }
};
const chunks = (list, n) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, (i + 1) * n));

// The infobox's established_title*/established_date* parameters, one per line.
const establishedLines = (text) => {
  const clean = text.replace(/<!--[\s\S]*?-->/g, '').replace(/<ref[^>]*\/>/g, '').replace(/<ref[\s\S]*?<\/ref>/g, '');
  return [...clean.matchAll(/\|[ \t]*((?:established|extinct)_(?:title|date)\d*)[ \t]*=([^\n]*)/g)].map((m) => `${m[1]}=${m[2].trim()}`);
};

const cities = (await loadCities());

// ---- Wikidata ----
const WD = 'data/raw/wikidata/places.json';
const places = load(WD);
for (const part of chunks(cities.filter((c) => !places[c.geoid]), 200)) {
  const values = part.map((c) => `"${c.fips}-${c.geoid.slice(2)}"`).join(' ');
  const query = `SELECT ?item ?code ?title ?date ?precision WHERE {
    VALUES ?code { ${values} }
    ?item wdt:P774 ?code .
    ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> ; schema:name ?title .
    OPTIONAL { ?item p:P571/psv:P571 [ wikibase:timeValue ?date ; wikibase:timePrecision ?precision ] }
  }`;
  const data = await request('https://query.wikidata.org/sparql', {
    method: 'POST', body: new URLSearchParams({ query }), headers: { Accept: 'application/sparql-results+json' },
  });
  for (const b of data.results.bindings) {
    const geoid = b.code.value.replace('-', '');
    const item = b.item.value.split('/').pop();
    places[geoid] ??= [];
    let e = places[geoid].find((x) => x.item === item);
    if (!e) places[geoid].push((e = { item, title: b.title.value, inception: [] }));
    if (b.date) e.inception.push({ date: b.date.value, precision: Number(b.precision.value) });
  }
  save(WD, places);
  console.log('wikidata', Object.keys(places).length);
  await sleep(1500);
}

// ---- Wikipedia infoboxes ----
const WP = 'data/raw/wikipedia/cities.json';
const boxes = load(WP);
const FACTS = 'data/raw/wikipedia/facts.json';
const facts = load(FACTS);
// The article each city is read from, and for the titles looked up by name, where Wikipedia redirects them to.
const titlesOf = (c) => {
  if (c.article) return [c.article];
  const found = (places[c.geoid] || []).map((p) => p.title);
  return found.length ? found : [`${c.name}, ${c.state}`];
};
const titles = [...new Set(cities.flatMap(titlesOf))].filter((t) => !(t in boxes && t in facts));
for (const part of chunks(titles, 40)) {
  let more = {};
  const alias = {}; // requested title -> the title the page came back under
  const pages = {};
  do {
    const data = await request('https://en.wikipedia.org/w/api.php', {
      method: 'POST',
      body: new URLSearchParams({
        action: 'query', format: 'json', formatversion: '2', prop: 'revisions', rvprop: 'content', rvslots: 'main',
        rvsection: '0', redirects: '1', titles: part.join('|'), maxlag: '5', ...more,
      }),
    });
    for (const r of [...(data.query.normalized || []), ...(data.query.redirects || [])]) alias[r.from] = r.to;
    for (const page of data.query.pages) {
      const text = page.revisions?.[0]?.slots.main.content;
      if (text !== undefined) pages[page.title] = { established: establishedLines(text), facts: factParams(text) };
    }
    more = data.continue;
  } while (more);
  for (const title of part) {
    let to = title;
    for (let i = 0; alias[to] && i < 5; i++) to = alias[to];
    if (pages[to]) {
      boxes[title] = pages[to].established;
      facts[title] = pages[to].facts;
    } else console.warn('no article:', title);
  }
  save(WP, boxes);
  save(FACTS, facts);
  console.log('wikipedia', Object.keys(boxes).length);
  await sleep(1000);
}
console.log('cities', cities.length, '| on Wikidata', cities.filter((c) => places[c.geoid]).length,
  '| no infobox dates:', cities.filter((c) => !titlesOf(c).some((t) => boxes[t]?.length)).map((c) => `${c.name} ${c.abbr}`).join(', '));
