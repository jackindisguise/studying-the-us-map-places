// Renders example card screenshots (docs/images/*.png) from templates/ and data/records.json, using headless Edge/Chrome.
// The documentation images are drawn inside a mock Anki window or phone screen (scripts/anki-frame.js); test shots are the bare card.
// A card's front and back are then joined into one picture with an arrow between them (scripts/pair-frame.js).
// Desktop shots use the browser's screenshot flag. Phone shots drive the browser over the DevTools protocol so they
// get mobile and touch emulation (no hover, coarse pointer), which is what makes the cards use their phone layout.
// Needs the maps in build/media (npm run render).
// Usage: node scripts/build-examples.js           the documentation images, into docs/images/
//        node scripts/build-examples.js US-PLACE-0644000 ...    a test set (desktop and phone, front and back) per city, into build/examples/
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { ankiFrame } from './anki-frame.js';
import { pairFrame } from './pair-frame.js';

const BROWSERS = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
];
const browser = BROWSERS.find((b) => fs.existsSync(b));
if (!browser) throw new Error('No Edge or Chrome found');

// [file name, card folder, side, city ID, width, height, phone?]
const DENVER = 'US-PLACE-0820000', PASADENA = 'US-PLACE-0656000';
const DOC_SHOTS = [
  ['locate-front', 'locate', 'front', DENVER, 1280, 720],
  ['locate-back', 'locate', 'back', DENVER, 1280, 720],
  ['phone-locate-front', 'locate', 'front', DENVER, 390, 844, true],
  ['phone-locate-back', 'locate', 'back', DENVER, 390, 844, true],
  ['zoom-front', 'locate', 'front', PASADENA, 1280, 720],
  ['zoom-back', 'locate', 'back', PASADENA, 1280, 720],
  ['phone-zoom-front', 'locate', 'front', PASADENA, 390, 844, true],
  ['phone-zoom-back', 'locate', 'back', PASADENA, 390, 844, true],
];
// Documentation pictures that join "<name>-front" and "<name>-back"; those two are only intermediates, kept in build/examples/.
const DOC_PAIRS = ['locate', 'phone-locate', 'zoom', 'phone-zoom'];
const testIds = process.argv.slice(2);
const SHOTS = testIds.length
  ? testIds.flatMap((id) => [
      [`${id}-locate-front`, 'locate', 'front', id, 1280, 720],
      [`${id}-locate-back`, 'locate', 'back', id, 1280, 720],
      [`${id}-phone-front`, 'locate', 'front', id, 390, 844, true],
      [`${id}-phone-back`, 'locate', 'back', id, 390, 844, true],
    ])
  : DOC_SHOTS;
const OUT_DIR = testIds.length ? 'build/examples' : 'docs/images';

const records = Object.fromEntries(JSON.parse(fs.readFileSync('data/records.json', 'utf8')).map((r) => [r.ID, r]));
const maps = JSON.parse(fs.readFileSync('build/fit/maps.json', 'utf8'));
const css = fs.readFileSync('templates/locate/style.css', 'utf8');

// Minimal Anki template engine: {{#Field}}...{{/Field}} sections and {{Field}} substitutions.
const render = (tpl, f) => {
  let out = tpl;
  for (let prev; prev !== out; ) {
    prev = out;
    out = out.replace(/\{\{#([^}]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, k, body) => (f[k] ? body : ''));
  }
  return out.replace(/\{\{([^}#/]+)\}\}/g, (_, k) => f[k] ?? '');
};

const fieldsOf = (id) => {
  const geoid = id.replace('US-PLACE-', '');
  const r = records[id];
  const { box, city, zoom } = maps[geoid];
  return {
    ...r,
    Map: `<img src="../media/us-state-${r.Abbreviation}.svg" data-box="${box.join(',')}" data-city="${city.join(',')}"><img class="city" src="../media/us-place-${geoid}.svg">`
      + (zoom ? `<img class="zoom" src="../media/us-place-zoom-${geoid}.svg">` : ''),
  };
};

// Minimal DevTools protocol client over Node's built-in WebSocket.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const startBrowser = async () => {
  const port = 9333;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'usplace-shots-'));
  const proc = spawn(browser, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  let targets;
  for (let i = 0; i < 50 && !targets; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); } catch { await sleep(200); }
  }
  const page = targets?.find((t) => t.type === 'page');
  if (!page) { proc.kill(); throw new Error('Could not connect to the browser'); }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
  };
  const send = (method, params = {}) => new Promise((res, rej) => { pending.set(++id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
  return { send, close: () => { ws.close(); proc.kill(); try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch {} } };
};

fs.mkdirSync('build/examples', { recursive: true });
fs.mkdirSync(OUT_DIR, { recursive: true });
let cdp;
const sizes = {};
// Screenshot of a page through the DevTools protocol, with or without phone emulation.
const capture = async (page, out, { width, height }, mobile) => {
  cdp ??= await startBrowser();
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
  await cdp.send('Emulation.setTouchEmulationEnabled', mobile ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
  await cdp.send('Page.enable');
  await cdp.send('Page.navigate', { url: pathToFileURL(page).href });
  await sleep(2500); // the card script re-fits at load and again after 150 and 600 ms
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(out, Buffer.from(data, 'base64'));
};
try {
  for (const [name, card, side, id, w, h, phone] of SHOTS) {
    const tpl = fs.readFileSync(`templates/${card}/${side}.html`, 'utf8');
    const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><body class="card"><div id="qa">${render(tpl, fieldsOf(id))}</div>`;
    let page = path.resolve(`build/examples/${name}.html`);
    fs.writeFileSync(page, html);
    let size = { width: w, height: h };
    if (!testIds.length) {
      const frame = ankiFrame(`${name}.html`, { side, isPhone: phone, w, h });
      page = path.resolve(`build/examples/${name}-frame.html`);
      fs.writeFileSync(page, frame.html);
      size = frame;
    }
    const paired = !testIds.length && DOC_PAIRS.includes(name.replace(/-(front|back)$/, ''));
    const out = path.resolve(`${paired ? 'build/examples' : OUT_DIR}/${name}.png`);
    sizes[name] = { w: size.width, h: size.height, isPhone: phone };
    if (phone) {
      await capture(page, out, size, true);
    } else {
      execFileSync(browser, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--screenshot=${out}`, `--window-size=${size.width},${size.height}`, '--virtual-time-budget=4000', pathToFileURL(page).href], { stdio: 'ignore' });
    }
    console.log('wrote', path.relative('.', out));
  }
  for (const pair of testIds.length ? [] : DOC_PAIRS) {
    const frame = pairFrame(`${pair}-front.png`, `${pair}-back.png`, sizes[`${pair}-front`]);
    const page = path.resolve(`build/examples/${pair}-pair.html`);
    fs.writeFileSync(page, frame.html);
    const out = path.resolve(`${OUT_DIR}/${pair}.png`);
    await capture(page, out, frame, false);
    console.log('wrote', path.relative('.', out));
  }
} finally {
  cdp?.close();
}
