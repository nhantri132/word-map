'use strict';
/* Word Map — a matching puzzle game whose answers paint a hidden picture.
   No build step, no dependencies. Content lives in maps/*.json, images in images/. */

const STORE = 'wordmap.v1.';
const app = document.getElementById('app');
const $ = (sel, el = document) => el.querySelector(sel);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => String(s).trim().toLowerCase().replace(/\s+/g, ' ');
const rgb = c => `rgb(${c[0]},${c[1]},${c[2]})`;
const inkFor = c => (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) > 150 ? '#1b1830' : '#fffaf0';
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------------------------------------------------------------- haptics */
const Haptics = (() => {
  let enabled = localStorage.getItem(STORE + 'haptics') !== 'off';
  const hasVibrate = typeof navigator.vibrate === 'function';
  // iPhone Safari has no Vibration API. Since iOS 18, toggling an
  // <input type="checkbox" switch> plays the system haptic tick, so we use that as a fallback.
  let iosLabel = null;
  if (!hasVibrate) {
    iosLabel = document.createElement('label');
    iosLabel.setAttribute('aria-hidden', 'true');
    iosLabel.style.cssText = 'position:fixed;left:-200px;top:0;width:1px;height:1px;opacity:0;overflow:hidden';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('switch', '');
    input.tabIndex = -1;
    iosLabel.appendChild(input);
    document.body.appendChild(iosLabel);
  }
  const tick = () => iosLabel && iosLabel.click();
  function play(pattern, iosTicks) {
    if (!enabled) return;
    if (hasVibrate) { try { navigator.vibrate(pattern); } catch (e) {} return; }
    for (let i = 0; i < iosTicks; i++) setTimeout(tick, i * 110);
  }
  return {
    get enabled() { return enabled; },
    set enabled(v) { enabled = v; localStorage.setItem(STORE + 'haptics', v ? 'on' : 'off'); },
    correct: () => play(28, 1),                                  // small: one match
    wrong:   () => play([12, 70, 12], 0),                        // a soft "nope" (Android only)
    puzzle:  () => play([90, 70, 90, 70, 260], 3),               // large: puzzle grid done
    map:     () => play([120, 60, 120, 60, 120, 60, 500], 5),    // largest: whole Word Map
  };
})();

/* ---------------------------------------------------------------- data */
const cache = { index: null, pixels: {} };

async function loadJSON(url) {
  let r;
  try { r = await fetch(url, { cache: 'no-cache' }); }
  catch (e) {
    throw new Error(location.protocol === 'file:'
      ? 'Browsers block this page from loading its puzzles when it is opened as a file. Open it from GitHub Pages, or run a local server (see README).'
      : `Could not load ${url}`);
  }
  if (!r.ok) throw new Error(`Could not load ${url} (${r.status})`);
  try { return await r.json(); }
  catch (e) { throw new Error(`${url} is not valid JSON: ${e.message}`); }
}

function normalizeMap(raw, file) {
  const errors = [];
  const id = file.replace(/\.json$/i, '').replace(/[^\w-]/g, '-');
  const [pc, pr] = raw.puzzleSize || [4, 4];
  const [mc, mr] = raw.mapSize || [1, 1];
  const N = pc * pr;
  const puzzles = (raw.puzzles || []).map((p, pi) => {
    const pairs = (p.pairs || []).map(x => Array.isArray(x)
      ? { prompt: x[0], answer: x[1] }
      : { prompt: x.prompt, answer: x.answer });
    const theme = p.theme || `Puzzle ${pi + 1}`;
    if (pairs.length !== N) errors.push(`Puzzle ${pi + 1} (“${theme}”) has ${pairs.length} pairs but a ${pc}×${pr} grid needs ${N}.`);
    pairs.forEach((q, i) => { if (!q.prompt || !q.answer) errors.push(`Puzzle ${pi + 1}, pair ${i + 1} is missing its prompt or answer.`); });
    return { theme, pairs };
  });
  if (puzzles.length !== mc * mr) errors.push(`There are ${puzzles.length} puzzles, but a ${mc}×${mr} map needs ${mc * mr}.`);
  if (!raw.image) errors.push('No "image" given.');
  return {
    id, file, errors, puzzles, pc, pr, mc, mr, W: mc * pc, H: mr * pr,
    title: raw.title || id,
    subtitle: raw.subtitle || '',
    image: raw.image,
    palette: raw.palette ?? 8,
    background: raw.background || '#f6efe2',
    revealOriginal: raw.revealOriginal !== false,
  };
}

async function getIndex() {
  if (cache.index) return cache.index;
  const idx = await loadJSON('maps/index.json');
  cache.index = await Promise.all((idx.maps || []).map(async file => {
    try { return normalizeMap(await loadJSON('maps/' + file), file); }
    catch (e) { return { file, error: e.message }; }
  }));
  return cache.index;
}
async function getMap(id) {
  const m = (await getIndex()).find(m => m.id === id);
  if (!m) throw new Error(`There is no Word Map called “${id}”.`);
  if (m.error) throw new Error(m.error);
  return m;
}

/* ---------------------------------------------------------------- pixelation
   The source image is centre-cropped to the map's shape, averaged down to one
   colour per prompt square, then optionally reduced to a small palette so it reads as pixel art. */
function loadImage(src) {
  return new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error(`Could not load the image “${src}”.`));
    i.src = src;
  });
}

async function getPixels(map) {
  if (cache.pixels[map.id]) return cache.pixels[map.id];
  const img = await loadImage(map.image);
  const { W, H } = map, S = 6;
  const iw = img.naturalWidth, ih = img.naturalHeight, ar = W / H;
  let sw = iw, sh = ih;
  if (iw / ih > ar) sw = ih * ar; else sh = iw / ar;

  let src = document.createElement('canvas');
  src.width = Math.max(1, Math.round(sw)); src.height = Math.max(1, Math.round(sh));
  let g = src.getContext('2d');
  g.fillStyle = map.background; g.fillRect(0, 0, src.width, src.height);
  g.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, 0, 0, src.width, src.height);
  // Halve repeatedly so the browser's resampling stays a fair average.
  while (src.width / 2 >= W * S && src.height / 2 >= H * S) {
    const n = document.createElement('canvas');
    n.width = Math.round(src.width / 2); n.height = Math.round(src.height / 2);
    const ng = n.getContext('2d'); ng.imageSmoothingQuality = 'high';
    ng.drawImage(src, 0, 0, n.width, n.height); src = n;
  }
  const c = document.createElement('canvas'); c.width = W * S; c.height = H * S;
  g = c.getContext('2d'); g.imageSmoothingQuality = 'high';
  g.drawImage(src, 0, 0, c.width, c.height);
  const d = g.getImageData(0, 0, c.width, c.height).data;

  let px = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let r = 0, gg = 0, b = 0;
    for (let yy = 0; yy < S; yy++) for (let xx = 0; xx < S; xx++) {
      const k = ((y * S + yy) * c.width + (x * S + xx)) * 4;
      r += d[k]; gg += d[k + 1]; b += d[k + 2];
    }
    px.push([r / (S * S), gg / (S * S), b / (S * S)]);
  }
  if (map.palette > 0) px = quantize(px, map.palette);
  px = px.map(p => p.map(Math.round));
  return (cache.pixels[map.id] = { px });
}

function quantize(px, k) {
  const dist = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
  const cents = [px[Math.floor(px.length / 2)].slice()];
  while (cents.length < k) { // farthest-point seeding keeps small accent colours alive
    let best = null, bd = 0;
    for (const p of px) { const dd = Math.min(...cents.map(c => dist(p, c))); if (dd > bd) { bd = dd; best = p; } }
    if (!best || bd < 30) break;
    cents.push(best.slice());
  }
  const near = p => { let bi = 0, bd = Infinity; cents.forEach((c, i) => { const dd = dist(p, c); if (dd < bd) { bd = dd; bi = i; } }); return bi; };
  let assign = px.map(near);
  for (let it = 0; it < 15; it++) {
    const sum = cents.map(() => [0, 0, 0, 0]);
    px.forEach((p, i) => { const s = sum[assign[i]]; s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; s[3]++; });
    sum.forEach((s, i) => { if (s[3]) cents[i] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]]; });
    const next = px.map(near);
    if (next.every((a, i) => a === assign[i])) break;
    assign = next;
  }
  return px.map((_, i) => cents[assign[i]].slice());
}

/* ---------------------------------------------------------------- progress */
const progress = {
  get(id) { try { return JSON.parse(localStorage.getItem(STORE + 'p.' + id)) || {}; } catch (e) { return {}; } },
  set(id, p) { localStorage.setItem(STORE + 'p.' + id, JSON.stringify(p)); },
  clear(id) { localStorage.removeItem(STORE + 'p.' + id); },
};
const solvedIn = (p, pi) => new Set(p[pi] || []);
const puzzleDone = (map, p, pi) => solvedIn(p, pi).size >= map.pc * map.pr;
const mapDone = (map, p) => map.puzzles.every((_, pi) => puzzleDone(map, p, pi));
const allSolved = map => Object.fromEntries(map.puzzles.map((_, pi) => [pi, [...Array(map.pc * map.pr).keys()]]));
function pixelOf(map, pixels, pi, si) {
  const X = (pi % map.mc) * map.pc + (si % map.pc);
  const Y = Math.floor(pi / map.mc) * map.pr + Math.floor(si / map.pc);
  return pixels.px[Y * map.W + X];
}

/* ---------------------------------------------------------------- helpers */
function seededShuffle(arr, seedStr) {
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) { h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  const rand = () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

// Shrink text until it fits its square; mark the square if it still overflows.
function fitText(sq, max = 16, min = 9) {
  const box = sq.querySelector('.txt'), inner = box && box.firstElementChild;
  if (!inner) return;
  let s = max;
  inner.style.fontSize = s + 'px';
  const over = () => inner.offsetHeight > box.clientHeight + 1 || inner.scrollWidth > box.clientWidth + 1;
  while (s > min && over()) { s -= 0.5; inner.style.fontSize = s + 'px'; }
  sq.classList.toggle('clipped', over());
}

function showSheet(html) {
  const o = document.createElement('div');
  o.className = 'overlay';
  o.innerHTML = `<div class="sheet">${html}<small>Tap anywhere to close</small></div>`;
  o.addEventListener('click', () => o.remove());
  document.body.appendChild(o);
}

let viewAbort = null;
function newView() {
  if (viewAbort) viewAbort.abort();
  viewAbort = new AbortController();
  document.querySelectorAll('.overlay, .ghost').forEach(n => n.remove());
  window.scrollTo(0, 0);
  return viewAbort.signal;
}

function drawThumb(canvas, map, pixels, p) {
  const g = canvas.getContext('2d');
  map.puzzles.forEach((_, pi) => {
    const s = solvedIn(p, pi);
    for (let si = 0; si < map.pc * map.pr; si++) {
      const X = (pi % map.mc) * map.pc + (si % map.pc), Y = Math.floor(pi / map.mc) * map.pr + Math.floor(si / map.pc);
      g.fillStyle = s.has(si) ? rgb(pixelOf(map, pixels, pi, si)) : '#282c54';
      g.fillRect(X, Y, 1, 1);
    }
  });
}

/* ---------------------------------------------------------------- router */
async function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  try {
    if (parts[0] === 'm' && parts[1] && parts[2] === 'p') return await puzzleView(parts[1], parseInt(parts[3], 10));
    if (parts[0] === 'm' && parts[1]) return await mapView(parts[1]);
    if (parts[0] === 'peek' && parts[1]) return await mapView(parts[1], { peek: true });
    return await homeView();
  } catch (e) {
    newView();
    app.innerHTML = `<main><div class="err"><b>Something's off</b>${esc(e.message)}<p><a href="#/">Back home</a></p></div></main>`;
    console.error(e);
  }
}
window.addEventListener('hashchange', route);
route();

/* ---------------------------------------------------------------- home */
async function homeView() {
  const maps = await getIndex();
  newView();
  const card = m => {
    if (m.error) return `<li class="card bad"><b>${esc(m.file)}</b><p>${esc(m.error)}</p></li>`;
    const p = progress.get(m.id);
    const done = m.puzzles.filter((_, i) => puzzleDone(m, p, i)).length;
    const status = done === m.puzzles.length ? 'Complete' : `${done} of ${m.puzzles.length} puzzles`;
    return `<li><a class="card" href="#/m/${encodeURIComponent(m.id)}">
      <canvas class="thumb" data-id="${esc(m.id)}" width="${m.W}" height="${m.H}"></canvas>
      <div><h2>${esc(m.title)}</h2><p>${esc(status)}${m.subtitle ? ' · ' + esc(m.subtitle) : ''}</p>
      ${m.errors.length ? `<p class="warn">${m.errors.length} problem${m.errors.length > 1 ? 's' : ''} in this map</p>` : ''}</div></a></li>`;
  };
  app.innerHTML = `<main>
    <header class="top"><h1 class="logo">Word<span>Map</span></h1>
      <button class="chip" id="hap"></button></header>
    <ul class="cards">${maps.map(card).join('')}</ul>
    <p class="hint">Match each answer to its prompt. Every match paints one pixel of a hidden picture.</p>
  </main>`;
  const hap = $('#hap');
  const label = () => { hap.textContent = `Haptics ${Haptics.enabled ? 'on' : 'off'}`; };
  label();
  hap.addEventListener('click', () => { Haptics.enabled = !Haptics.enabled; label(); Haptics.correct(); });
  for (const m of maps) {
    if (m.error) continue;
    const cv = app.querySelector(`canvas[data-id="${CSS.escape(m.id)}"]`);
    getPixels(m).then(px => drawThumb(cv, m, px, progress.get(m.id))).catch(() => {});
  }
}

/* ---------------------------------------------------------------- word map */
async function mapView(id, { peek = false } = {}) {
  const map = await getMap(id);
  const pixels = await getPixels(map);
  const signal = newView();
  const p = peek ? allSolved(map) : progress.get(id);
  const done = map.puzzles.filter((_, i) => puzzleDone(map, p, i)).length;
  const complete = done === map.puzzles.length;
  const N = map.pc * map.pr;

  const sector = (pz, pi) => {
    const s = solvedIn(p, pi), isDone = s.size >= N;
    let cells = '';
    for (let si = 0; si < N; si++) cells += s.has(si) ? `<i style="background:${rgb(pixelOf(map, pixels, pi, si))}"></i>` : '<i></i>';
    const tag = peek ? 'div' : 'a';
    const href = peek ? '' : ` href="#/m/${encodeURIComponent(id)}/p/${pi}"`;
    const lbl = isDone ? '' : `<span class="lbl"><b>${esc(pz.theme)}</b><small>${s.size}/${N}</small></span>`;
    return `<${tag} class="sector${isDone ? ' done' : ''}"${href} data-pi="${pi}"><span class="cells">${cells}</span>${lbl}</${tag}>`;
  };

  app.innerHTML = `<main>
    <header class="bar"><a class="back" href="#/" aria-label="Back">‹</a>
      <div class="ttl"><h2>${esc(map.title)}</h2><small>${peek ? 'Peek mode · progress untouched' : `${done} of ${map.puzzles.length} puzzles`}</small></div>
      ${peek ? '' : '<button class="chip" id="reset">Reset</button>'}</header>
    ${map.errors.length ? `<div class="warnbox"><b>This map needs fixing:</b><ul>${map.errors.map(e => `<li>${esc(e)}</li>`).join('')}</ul></div>` : ''}
    <div class="mapwrap"><div class="map" style="--mc:${map.mc};--mr:${map.mr};--pc:${map.pc};--pr:${map.pr}">
      ${map.puzzles.map(sector).join('')}
      ${map.revealOriginal ? `<img class="orig" src="${esc(map.image)}" alt="">` : ''}
    </div></div>
    <div class="mapfoot" id="foot">${complete ? '' : 'Tap a section to solve it. Finish them all to reveal the picture.'}</div>
  </main>`;

  const mapEl = $('.map'), wrap = $('.mapwrap'), foot = $('#foot');
  $('#reset')?.addEventListener('click', () => {
    if (confirm(`Reset all progress on “${map.title}”?`)) { progress.clear(id); route(); }
  }, { signal });

  const from = peek ? null : sessionStorage.getItem('wm.zoomFrom');
  sessionStorage.removeItem('wm.zoomFrom');
  if (from !== null) await zoomOut(mapEl, +from);
  if (signal.aborted || !complete) return;

  if (from !== null) {               // just placed the last piece: the big reveal
    Haptics.map();
    await sleep(200);
    wrap.classList.add('merge'); mapEl.classList.add('merge');
    await sleep(1400);
    if (signal.aborted) return;
    if (map.revealOriginal) mapEl.classList.add('picture');
  } else {
    wrap.classList.add('merge', 'instant'); mapEl.classList.add('merge', 'instant');
    if (map.revealOriginal) mapEl.classList.add('picture');
    requestAnimationFrame(() => requestAnimationFrame(() => { wrap.classList.remove('instant'); mapEl.classList.remove('instant'); }));
  }
  foot.innerHTML = `<h3>${peek ? 'The finished picture' : 'Word Map complete'}</h3>` + (map.revealOriginal
    ? `<div class="seg"><button data-v="px">Pixels</button><button data-v="pic" class="on">Picture</button></div>` : '');
  foot.querySelector('.seg')?.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    mapEl.classList.toggle('picture', b.dataset.v === 'pic');
    foot.querySelectorAll('.seg button').forEach(x => x.classList.toggle('on', x === b));
  }, { signal });
}

async function zoomOut(mapEl, pi) {
  const sec = mapEl.querySelector(`[data-pi="${pi}"]`);
  if (!sec) return;
  const m = mapEl.getBoundingClientRect(), r = sec.getBoundingClientRect();
  const s = m.width / r.width;
  mapEl.style.transformOrigin = '0 0';
  mapEl.style.transition = 'none';
  mapEl.style.transform = `translate(${-(r.left - m.left) * s}px, ${-(r.top - m.top) * s}px) scale(${s})`;
  sec.classList.add('fresh');
  mapEl.getBoundingClientRect();
  await sleep(350);
  mapEl.style.transition = 'transform 1.2s cubic-bezier(.2,.7,.1,1)';
  mapEl.style.transform = '';
  await sleep(1250);
  mapEl.style.transition = '';
}

/* ---------------------------------------------------------------- puzzle */
async function puzzleView(id, pi) {
  const map = await getMap(id);
  const pz = map.puzzles[pi];
  if (!pz) throw new Error(`Puzzle ${pi + 1} doesn't exist in “${map.title}”.`);
  const pixels = await getPixels(map);
  const signal = newView();
  const p = progress.get(id);
  const solved = solvedIn(p, pi);
  const N = map.pc * map.pr;
  const order = seededShuffle([...Array(N).keys()], `${id}:${pi}`);

  app.innerHTML = `<main>
    <header class="bar"><a class="back" href="#/m/${encodeURIComponent(id)}" aria-label="Back to map">‹</a>
      <div class="ttl"><h2>${esc(pz.theme)}</h2><small id="count"></small></div></header>
    <div class="boardwrap"><div class="board" style="--cols:${map.pc};--rows:${map.pr}">
      ${pz.pairs.map((q, i) => `<button class="sq" data-i="${i}"><span class="txt prompt"><span>${esc(q.prompt)}</span></span></button>`).join('')}
    </div></div>
    <div class="tray" id="tray">${order.filter(i => !solved.has(i)).map(i =>
      `<button class="tile" data-a="${esc(pz.pairs[i].answer)}">${esc(pz.pairs[i].answer)}</button>`).join('')}
      <p class="trayhint">Drag an answer onto its prompt, or tap one then tap the square. Tap a prompt to read it in full.</p></div>
    <div class="donebar" id="donebar" hidden></div>
  </main>`;

  const board = $('.board'), tray = $('#tray'), count = $('#count'), donebar = $('#donebar');
  const squares = [...board.querySelectorAll('.sq')];
  const updateCount = () => { count.textContent = `Puzzle ${pi + 1} of ${map.puzzles.length} · ${solved.size}/${N} matched`; };
  const fill = i => {
    const sq = squares[i], c = pixelOf(map, pixels, pi, i);
    sq.classList.add('solved');
    sq.style.setProperty('--c', rgb(c));
    sq.style.setProperty('--ci', inkFor(c));
    sq.innerHTML = `<span class="txt"><span>${esc(pz.pairs[i].answer)}</span></span>`;
    fitText(sq, 15, 7);
  };
  const fitAll = () => squares.forEach(sq => sq.classList.contains('solved') ? fitText(sq, 15, 7) : fitText(sq));
  solved.forEach(fill);
  updateCount();
  requestAnimationFrame(fitAll);
  document.fonts?.ready.then(fitAll);
  let rt; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(fitAll, 120); }, { signal });

  const showDone = (last) => {
    tray.hidden = true;
    donebar.hidden = false;
    donebar.innerHTML = last
      ? `<p>That was the last piece.</p><a class="btn" href="#/m/${encodeURIComponent(id)}">Reveal the Word Map</a>`
      : `<p>Puzzle complete!</p><a class="btn" href="#/m/${encodeURIComponent(id)}">Back to the map</a>`;
  };
  if (solved.size >= N) { board.classList.add('complete'); showDone(false); return; }

  /* --- selecting (tap) --- */
  let selected = null;
  const setSelected = tile => {
    selected?.classList.remove('sel');
    selected = tile;
    selected?.classList.add('sel');
    board.classList.toggle('placing', !!selected);
  };

  /* --- matching --- */
  function attempt(tile, sq, ghost) {
    const i = +sq.dataset.i;
    if (norm(tile.dataset.a) !== norm(pz.pairs[i].answer)) {
      sq.classList.remove('shake'); void sq.offsetWidth; sq.classList.add('shake');
      Haptics.wrong();
      if (ghost) flyHome(ghost, tile);
      return false;
    }
    solved.add(i);
    p[pi] = [...solved];
    progress.set(id, p);
    ghost?.remove();
    if (selected === tile) setSelected(null);
    tile.remove();
    fill(i);
    squares[i].classList.add('pop');
    updateCount();
    if (solved.size >= N) {
      Haptics.puzzle();  // fired inside the touch event so iPhone allows it
      finish();
    } else Haptics.correct();
    return true;
  }

  async function finish() {
    const last = mapDone(map, p);
    sessionStorage.setItem('wm.zoomFrom', String(pi));
    await sleep(380);
    board.classList.add('complete');
    await sleep(900);
    if (!signal.aborted) showDone(last);
  }

  board.addEventListener('click', e => {
    const sq = e.target.closest('.sq');
    if (!sq || sq.classList.contains('solved')) return;
    if (selected) attempt(selected, sq, null);
    else showSheet(`<p>${esc(pz.pairs[+sq.dataset.i].prompt)}</p>`);
  }, { signal });

  /* --- dragging --- */
  let drag = null;
  tray.addEventListener('pointerdown', e => {
    const tile = e.target.closest('.tile');
    if (!tile || drag || (e.pointerType === 'mouse' && e.button !== 0)) return;
    drag = { tile, id: e.pointerId, x0: e.clientX, y0: e.clientY, moved: false, ghost: null, over: null };
  }, { signal });

  window.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.moved) {
      if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 8) return;
      drag.moved = true;
      if (selected) setSelected(null);
      const r = drag.tile.getBoundingClientRect();
      drag.w = r.width; drag.h = r.height;
      drag.lift = e.pointerType === 'mouse' ? 0 : r.height / 2 + 26;  // keep it above the finger
      drag.ghost = drag.tile.cloneNode(true);
      drag.ghost.classList.add('ghost');
      drag.ghost.style.width = r.width + 'px';
      document.body.appendChild(drag.ghost);
      drag.tile.classList.add('lifted');
    }
    e.preventDefault();
    const x = e.clientX, y = e.clientY - drag.lift;
    drag.ghost.style.transform = `translate(${x - drag.w / 2}px, ${y - drag.h / 2}px) scale(1.08)`;
    const hit = document.elementFromPoint(x, y)?.closest('.sq:not(.solved)') || null;
    if (hit !== drag.over) { drag.over?.classList.remove('over'); hit?.classList.add('over'); drag.over = hit; }
  }, { signal, passive: false });

  const end = e => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag; drag = null;
    d.over?.classList.remove('over');
    if (!d.moved) { if (e.type === 'pointerup') setSelected(selected === d.tile ? null : d.tile); return; }
    if (e.type === 'pointerup' && d.over) { if (attempt(d.tile, d.over, d.ghost)) return; }
    else flyHome(d.ghost, d.tile);
  };
  window.addEventListener('pointerup', end, { signal });
  window.addEventListener('pointercancel', end, { signal });
}

function flyHome(ghost, tile) {
  const r = tile.getBoundingClientRect();
  ghost.classList.add('home');
  ghost.style.transform = `translate(${r.left}px, ${r.top}px) scale(1)`;
  setTimeout(() => { ghost.remove(); tile.classList.remove('lifted'); }, 230);
}
