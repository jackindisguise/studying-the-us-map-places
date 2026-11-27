// The cities in the deck: places over MIN_POP, filled up to each state's TOP_PER_STATE largest. A place is either a Census
// incorporated place (SUMLEV 162, population estimate for YEAR) or a census-designated place, a community with no city
// government (population from the American Community Survey, five years ending ACS_YEAR). Both compete in the same ranking.
// Washington, D.C. counts in the national ranking but has no note.
import fs from 'node:fs';
import { STATES } from './geo.js';
import { loadPlaceNames } from './boundaries.js';

export const YEAR = 2025;
export const ACS_YEAR = 2024;
export const MIN_POP = 50000;
export const TOP_PER_STATE = 10;

// One CSV line -> fields (handles quotes).
const csvLine = (line) => [...line.matchAll(/(?:^|,)(?:"((?:[^"]|"")*)"|([^,]*))/g)].map((m) => m[1] ?? m[2]);

// Census names that are not what anyone calls the city.
const NAME_FIX = {
  '0203000': 'Anchorage',
  '0665042': 'Ventura',
  '0947515': 'Milford',
  '1303440': 'Athens',
  '1304204': 'Augusta',
  '1349008': 'Macon',
  '1571550': 'Honolulu',
  '2146027': 'Lexington',
  '2148006': 'Louisville',
  '3001675': 'Anaconda',
  '3011397': 'Butte',
  '4752006': 'Nashville',
};
// Wikipedia articles to read founding dates from, where the one found automatically is missing or the wrong one.
const ARTICLE_FIX = {
  '0947515': 'Milford, Connecticut',
  '2148006': 'Louisville, Kentucky',
  '3011397': 'Butte, Montana',
  '3633139': 'Hempstead (village), New York',
  '4752006': 'Nashville, Tennessee',
};
// Drops the legal description the Census appends ("Boise City city" -> "Boise City").
const SUFFIX = / (city and borough|metropolitan government|metro government|consolidated government|unified government|urban county|municipality|borough|village|town|city|CDP)( \(balance\))?$/;

// Every row of the estimates file, as objects keyed by column name.
export const censusRows = () => {
  const [head, ...lines] = fs.readFileSync('data/raw/census/sub-est2025.csv', 'latin1').split(/\r?\n/).filter(Boolean).map(csvLine);
  return lines.map((r) => Object.fromEntries(head.map((k, i) => [k, r[i]])));
};

const places = () => censusRows().filter((r) => r.SUMLEV === '162').map((r) => ({
  geoid: r.STATE + r.PLACE,
  fips: r.STATE,
  censusName: r.NAME,
  pop: Number(r[`POPESTIMATE${YEAR}`]),
  // Honolulu is a census-designated place that the estimates list with the incorporated ones.
  cdp: / CDP$/.test(r.NAME),
  popSource: `${YEAR} estimate`,
}));

// The census-designated places the estimates leave out, with their survey population.
const designated = async (listed, names) => {
  const survey = new Map(fs.readFileSync(`data/raw/census/acsdt5y${ACS_YEAR}-b01003.dat`, 'utf8').split(/\r?\n/)
    .filter((l) => l.startsWith('1600000US')).map((l) => l.split('|')).map(([id, pop]) => [id.slice(9), Number(pop)]));
  const states = new Set(STATES.map((s) => s.fips));
  return names
    .filter((p) => p.LSAD === '57' && states.has(p.GEOID.slice(0, 2)) && !listed.has(p.GEOID) && survey.get(p.GEOID) > 0)
    .map((p) => ({
      geoid: p.GEOID,
      fips: p.GEOID.slice(0, 2),
      censusName: `${p.NAME} CDP`,
      pop: survey.get(p.GEOID),
      cdp: true,
      popSource: `${ACS_YEAR - 4}\u2013${ACS_YEAR} survey estimate`,
    }));
};

const SQ_M_PER_SQ_MI = 2589988.11;

// Gives each place its rank by one measure among `list`: 1 = largest, ties share a rank.
const ranker = (list, key) => {
  const sorted = list.map((p) => p[key]).filter((v) => v > 0).sort((a, b) => b - a);
  const first = new Map();
  sorted.forEach((v, i) => first.has(v) || first.set(v, i + 1));
  return (p) => (p[key] > 0 ? { rank: first.get(p[key]), of: sorted.length } : null);
};

export async function loadCities() {
  const incorporated = places();
  const names = await loadPlaceNames();
  const land = new Map(names.map((p) => [p.GEOID, Number(p.ALAND) / SQ_M_PER_SQ_MI]));
  const all = incorporated.concat(await designated(new Set(incorporated.map((p) => p.geoid)), names))
    .map((p) => ({ ...p, area: land.get(p.geoid) || 0 }))
    .map((p) => ({ ...p, density: p.area ? p.pop / p.area : 0 }));
  const MEASURES = ['pop', 'area', 'density'];
  const national = MEASURES.map((k) => ranker(all, k));
  const cities = [];
  for (const s of STATES) {
    const inState = all.filter((p) => p.fips === s.fips).sort((a, b) => b.pop - a.pop || a.censusName.localeCompare(b.censusName));
    const local = MEASURES.map((k) => ranker(inState, k));
    inState.forEach((p, i) => {
      if (p.pop <= MIN_POP && i >= TOP_PER_STATE) return;
      cities.push({
        ...p, state: s.name, abbr: s.abbr,
        name: NAME_FIX[p.geoid] || p.censusName.replace(SUFFIX, ''),
        article: ARTICLE_FIX[p.geoid],
        ranks: Object.fromEntries(MEASURES.map((k, m) => [k, { state: local[m](p), us: national[m](p) }])),
      });
    });
  }
  return cities;
}
