// Nickname and elevation from the cached Wikipedia infoboxes (see fetch-founding.js).
import fs from 'node:fs';

export const FACT_KEYS = ['nickname', 'nicknames', 'elevation_ft', 'elevation_m'];
const MAX_NICKNAMES = 3;
const MAX_LENGTH = 60;

// The raw value of each wanted infobox parameter, which may run over several lines.
export const factParams = (text) => {
  const clean = text.replace(/<!--[\s\S]*?-->/g, '').replace(/<ref[^>]*\/>/g, '').replace(/<ref[\s\S]*?<\/ref>/g, '');
  const out = {};
  for (const key of FACT_KEYS) {
    const m = clean.match(new RegExp(`\\|[ \\t]*${key}[ \\t]*=`));
    if (!m) continue;
    // The value ends at the next "|" or "}}" that is outside any template or link of its own.
    let depth = 0, i = m.index + m[0].length;
    const start = i;
    for (; i < clean.length; i++) {
      const two = clean.slice(i, i + 2);
      if (two === '{{' || two === '[[') { depth++; i++; } else if (two === '}}' || two === ']]') { if (!depth) break; depth--; i++; } else if (clean[i] === '|' && !depth) break;
    }
    const value = clean.slice(start, i).trim();
    if (value) out[key] = value;
  }
  return out;
};

const nicknames = (raw) => {
  let s = raw.replace(/&nbsp;/g, ' ').replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1');
  // Innermost templates first: notes go, lists become their items, wrappers keep their text.
  for (let prev; prev !== s; ) {
    prev = s;
    s = s.replace(/\{\{([^{}]*)\}\}/g, (_, body) => {
      const [name, ...args] = body.split('|');
      const kind = name.trim().toLowerCase();
      const items = args.filter((a) => !/^\s*[\w-]+\s*=/.test(a));
      if (/^(plain ?list|flat ?list|ubl|unbulleted list|hlist|bulleted list|collapsible list|cslist)$/.test(kind)) return `\n${items.join('\n')}\n`;
      if (/^(nowrap|nobr|small|noitalic|nobold|longitem|resize|smaller)$/.test(kind)) return items.at(-1) || '';
      if (/^lang$/.test(kind)) return items[1] || '';
      return '\n';
    });
  }
  const list = s.replace(/<br[^>]*>|<\/?li>/gi, '\n').replace(/<[^>]*>/g, '').replace(/'{2,}/g, '')
    .split(/[\n;,•*·]/)
    // Explanations in brackets and the quotation marks around a name are not part of it.
    .map((x) => x.replace(/\([^)]*\)?/g, '').replace(/\b(and )?(many )?others\b|\band more\b|\betc\b\.?/gi, '').replace(/["“”]/g, '').replace(/^[\s,:-]+|[\s,.:-]+$/g, '').replace(/\s+/g, ' '))
    // "more..." and "see list" point to a longer list; they are not nicknames.
    .filter((x) => /[A-Za-z0-9]/.test(x) && !/^(and )?(see|more)(?![A-Za-z'])/i.test(x) && x.length <= MAX_LENGTH && !/[={}[\]|]/.test(x));
  return [...new Set(list)].slice(0, MAX_NICKNAMES).join(' · ');
};

// Feet above sea level, or null.
const elevation = (p) => {
  const first = (s) => {
    const m = s?.replace(/,(?=\d{3})/g, '').replace(/−/g, '-').match(/-?\d+(\.\d+)?/);
    return m ? Number(m[0]) : null;
  };
  const feet = first(p.elevation_ft);
  const metres = first(p.elevation_m);
  if (feet !== null) return Math.round(feet);
  return metres !== null ? Math.round(metres * 3.28084) : null;
};

export function loadFacts() {
  const places = JSON.parse(fs.readFileSync('data/raw/wikidata/places.json', 'utf8'));
  const pages = JSON.parse(fs.readFileSync('data/raw/wikipedia/facts.json', 'utf8'));
  return (city) => {
    const found = (places[city.geoid] || []).map((p) => p.title);
    const titles = city.article ? [city.article] : found.length ? found : [`${city.name}, ${city.state}`];
    const params = titles.map((t) => pages[t] || {});
    return {
      nickname: params.map((p) => nicknames(p.nicknames || p.nickname || '')).find(Boolean) || '',
      elevation: params.map(elevation).find((v) => v !== null) ?? null,
    };
  };
}
