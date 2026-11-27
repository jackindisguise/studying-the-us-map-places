// Picks each city's founding year from the cached sources (see fetch-founding.js).
// In order: an infobox date labelled "Founded"; else the earliest settlement-like date ("Settled", "Established", "Platted"...);
// else the earliest date with no label ("established"); else the earliest incorporation or charter; else Wikidata's "inception"; else the hand value in data/founding-fixes.json.
import fs from 'node:fs';

const json = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

// Infobox titles by kind, first match wins. Titles that match none (renamed, county seat...) are ignored.
const KINDS = [
  [null, /renamed|current name|named|disincorporat|extinct|annex|county|township/i],
  ['incorporated', /incorporat|charter|consolidat|cityhood|city status|became a city|home.?rule|^city\b|^town\b|^village\b|^borough\b|organi[sz]ed/i],
  ['founded', /found/i],
  ['settled', /settle|establish|plat|laid out|plotted|surveyed|develop|landing|pueblo|mission|coloni|post office|encampment|depot|rail/i],
];
const ORDER = ['founded', 'settled', 'established', 'incorporated'];

// Wiki markup of an infobox title -> plain text.
const titleText = (s) => s.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ')
  .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1').trim();

// The first year in an infobox date, ignoring footnotes and page numbers.
export const yearOf = (value) => {
  let s = value.replace(/&nbsp;/g, ' ');
  // Notes can run past the end of the line, so everything from one on is dropped when it is not closed.
  s = s.replace(/\{\{\s*(?:efn|refn|sfn|rp|r|cn|citation needed)\b(?:[^{}]|\{\{[^{}]*\}\})*(?:\}\}|$)/gi, '');
  s = s.replace(/<ref[\s\S]*$/i, '').replace(/\[https?:[^\]]*\]/g, '').replace(/\[\[[^\]|]*\|/g, '[[');
  const m = s.match(/(?<![\d,])(1[5-9]\d\d|20[0-2]\d)(?!\d)/);
  return m ? Number(m[1]) : null;
};

const fromInfobox = (lines) => {
  const param = {};
  for (const line of lines) {
    const [, key, value] = line.match(/^(\w+)=(.*)$/);
    param[key] = value;
  }
  const found = [];
  for (const key of Object.keys(param)) {
    const n = key.match(/^established_date(\d*)$/)?.[1];
    if (n === undefined) continue;
    const title = titleText(param[`established_title${n}`] || '');
    // A date with no title shows under the infobox's own "Established" label.
    const kind = title ? KINDS.find(([, re]) => re.test(title))?.[0] : 'established';
    const year = yearOf(param[key]);
    if (kind && year) found.push({ kind, year });
  }
  for (const kind of ORDER) {
    const years = found.filter((f) => f.kind === kind).map((f) => f.year);
    if (years.length) return { year: Math.min(...years), kind };
  }
  return null;
};

export function loadFounding() {
  const places = json('data/raw/wikidata/places.json');
  const boxes = json('data/raw/wikipedia/cities.json');
  const fixes = json('data/founding-fixes.json');
  return (city) => {
    if (fixes[city.geoid]) return { ...fixes[city.geoid], source: 'fix' };
    const items = places[city.geoid] || [];
    const found = items.length ? items.map((p) => p.title) : [`${city.name}, ${city.state}`];
    const titles = city.article ? [city.article] : found;
    const picks = titles.map((t) => fromInfobox(boxes[t] || [])).filter(Boolean)
      .sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || a.year - b.year);
    if (picks.length) return { ...picks[0], source: 'wikipedia' };
    // Precision 9 is a year; anything coarser (decade, century) is left out.
    const years = items.flatMap((p) => p.inception).filter((d) => d.precision >= 9).map((d) => Number(d.date.slice(0, 4)));
    return years.length ? { year: Math.min(...years), kind: 'established', source: 'wikidata' } : null;
  };
}
