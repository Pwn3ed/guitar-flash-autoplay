// Guitar Flash Bot - runs inside the guitarflash.com page (MAIN world).
// Controlled by the extension (bridge.js) through window.postMessage: {source:'gfbot-ext', cmd:'start'|'stop'}.
//
// How it works ("scene reader"):
//  - The game is a PIXI/WebGL app in the same-origin iframe "iframeGame". Every frame it uploads its sprites to the
//    GPU (bufferSubData: x, y, u, v, colour, texture per vertex) and draws them (drawElements). We hook both on the
//    WebGL prototypes and read that data directly - no pixels are read, so flashes, flames and hit effects do not
//    hide anything.
//  - Notes are the sprites whose texture region is "notaL-v.png" in the game's atlas (image2.json). The lane is taken
//    from the sprite's position on the highway (with the Special active every note uses the same texture).
//  - A note keeps its identity from frame to frame by position (all notes move down by the same number of steps).
//  - Note positions sit on a fixed lattice: y(i) = Q0 + Q1*i + Q2*i^2, one step per 1/24 s of song time, i = 0 at the
//    top of the highway and 38 at the frets. With the game clock (ytPlayer.getCurrentTime, quantized to 1/24 s and
//    the renderer snaps to floor(clock * 24)) every note gets an exact time: noteTime = (X - N) / 24, N = i - tick.
//  - A sustain is drawn as a lane-shaped stencil triangle followed by a quad; the quad's top edge is the sustain end,
//    on the same lattice, which gives the release time.
//  - Keys (A S J K L) are synthetic KeyboardEvents, pressed when the YouTube clock reaches each note time.
(function () {
  'use strict';
  if (window.top !== window) return;
  if (window.GFBOT && window.GFBOT.stop) window.GFBOT.stop();

  const CFG = {
    X: 38.6,                          // note time in ticks = X - N (calibrated against the game's own hit timing)
    edge: 0.06,                       // frames at least this close (in ticks) to a game tick boundary are skipped
    phDecay: 0.985,                   // memory of the clock phase estimator (per frame)
    Q: [203.0929, 0.90768, 0.186434], // highway lattice: y(i) = Q0 + Q1*i + Q2*i^2 (game world units, 822x580)
    fretX: [228.5, 318.5, 407.5, 497.5, 587.5], // lane centres at the frets (sustain triangles -> lane)
    laneX: [407.7, 0.2332, 125.7],    // perspective: lane = round((x - c) / (s * (y - y0))) + 2 (c = middle lane)
    tapHold: 0.030,                   // how long a normal note is held (s)
    relOff: 0.015,                    // hold a sustain this much past its end (s); holding a bit long costs nothing
    newMaxI: 30,                      // new notes are only accepted above this lattice step (38 = frets)...
    reacqMaxI: 39.4,                  // ... except in the first frame after a pause: up to the frets (a note can be right
                                      //     there when the game pauses; keys are released, so no press sprites)
    pauseGap: 0.065,                  // the pause key waits until no note is due within this time (s)...
    pauseMax: 5,                      // ... but never longer than this (s)
    voteDecay: 0.7,                   // weight kept by a note's older tick votes at each new sighting
    KEYS: [['a', 'KeyA', 65], ['s', 'KeyS', 83], ['j', 'KeyJ', 74], ['k', 'KeyK', 75], ['l', 'KeyL', 76]],
  };
  const [Q0, Q1, Q2] = CFG.Q;
  const yTop = Q0 - Q1 * Q1 / (4 * Q2);                         // lowest y the lattice formula can invert
  const indexOf = (y) => (y <= yTop ? NaN : (-Q1 + Math.sqrt(Q1 * Q1 + 4 * Q2 * (y - Q0))) / (2 * Q2));

  const G = window.GFBOT = { __v: 10, cfg: CFG, bot: null, running: false, debug: false, atlas: null };

  // ---- atlas: texture regions of the note sprites, from the game's own image2.json ----
  let atlasLoading = null;
  function loadAtlas(w) {
    if (G.atlas || atlasLoading) return;
    const entry = w.performance.getEntriesByType('resource').find((e) => /image2\.json/.test(e.name));
    const url = entry ? entry.name : new URL('img/image2.json', w.location.href).href;
    atlasLoading = fetch(url).then((r) => r.json()).then((j) => {
      const W = j.meta.size.w, H = j.meta.size.h, notes = [];
      for (const [name, f] of Object.entries(j.frames)) {
        const m = /^nota(\d)-(\d)\.png$/.exec(name);
        if (m) notes.push({ lane: +m[1] - 1, k: name, u: f.frame.x / W, v: f.frame.y / H });
      }
      if (notes.length) G.atlas = { notes };
    }).catch(() => { }).finally(() => { atlasLoading = null; });
  }

  // ---- hooks on the game's WebGL prototypes (never creates a context) ----
  function hookGL(w) {
    if (!w.__afterRender) { w.__afterRender = []; w.__mtq = false; }
    for (const name of ['WebGL2RenderingContext', 'WebGLRenderingContext']) {
      const proto = w[name] && w[name].prototype;
      if (!proto || proto.__gfScene) continue;
      proto.__gfScene = true;
      const bsd = proto.bufferSubData, de = proto.drawElements;
      proto.bufferSubData = function (target, off, data) {
        if (target === this.ARRAY_BUFFER && data && data.byteLength && this.canvas && this.canvas.id === 'gfCanvas') {
          w.__gfUp = data.buffer ? new Float32Array(data.buffer, data.byteOffset, data.byteLength >> 2) : new Float32Array(data);
        }
        return bsd.apply(this, arguments);
      };
      proto.drawElements = function (mode, count) {
        if (this.canvas && this.canvas.id === 'gfCanvas') {
          w.__gfGL = this;
          if (w.__gfParse && w.__gfUp) { try { w.__gfParse(w.__gfUp, count); } catch (e) { w.__perr = String(e); } }
          w.__gfUp = null;
          if (!w.__mtq) { w.__mtq = true; w.queueMicrotask(() => { w.__mtq = false; for (const fn of w.__afterRender) { try { fn(); } catch (e) { w.__perr = String(e); } } }); }
        }
        return de.apply(this, arguments);
      };
    }
  }

  function install(w) {
    const curP = () => {
      const P = window.ytPlayer;
      if (!P.__orig) { const ORIG = P.__orig = P.getCurrentTime; P.getCurrentTime = function () { const v = ORIG.apply(this, arguments); P.__lastS = v; return v; }; }
      return P;
    };
    const getS = () => { const P = curP(); return P.__orig.call(P); };
    // The game's clock: the video clock, except while the video buffers. Then the video clock freezes but the game keeps
    // running in real time (notes keep moving and are judged), and the video jumps ahead when it resumes. So during
    // buffering the clock is extrapolated from the last moment the video clock was live.
    // If the notes stop moving too (C.still frames without a step), the game clock is frozen as well: no extrapolation.
    const C = { v: -1, t: 0, still: 0 };
    const clk = () => {
      const v = getS(), now = performance.now(), P = curP();
      if (v !== C.v || C.still >= 4 || (P.getPlayerState && P.getPlayerState() !== 3)) { C.v = v; C.t = now; return v; }
      return v + (now - C.t) / 1000;
    };

    const bot = {
      notes: [[], [], [], [], []], down: [0, 0, 0, 0, 0], cur: [null, null, null, null, null],
      presses: 0, songPresses: 0, frames: 0, ms: 0, lastS: -1, hb: performance.now(), fired: [], events: [],
      paused: false, lastState: -1, session: null, reacq: false, trace: [], born: [], fid: 0, lastT: null, lastFire: -1, holds: [],
    };
    const dispatch = w.Document.prototype.dispatchEvent;
    const send = (i, type) => { const [key, code, kc] = CFG.KEYS[i]; dispatch.call(w.document, new w.KeyboardEvent(type, { key, code, keyCode: kc, which: kc, bubbles: true, cancelable: true })); };
    const releaseAll = () => { for (let i = 0; i < 5; i++) { if (bot.down[i]) send(i, 'keyup'); bot.down[i] = 0; bot.notes[i].forEach((n) => { cancel(n.tp); cancel(n.tr); }); bot.notes[i] = []; bot.cur[i] = null; } };

    // run fn when the song clock reaches target (s)
    // (re-arms itself until the clock is there; the returned handle cancels the whole chain)
    function at(target, fn) {
      const h = { id: 0, off: false };
      const go = () => { if (h.off) return; const dt = (target - clk()) * 1000; if (dt <= 0.5) { h.off = true; fn(); return; } h.id = setTimeout(go, dt > 6 ? dt - 3 : Math.max(0, dt - 0.5)); };
      go(); return h;
    }
    const cancel = (h) => { if (h) { h.off = true; clearTimeout(h.id); } };

    function fire(i, n) {
      if (n.fired || !G.running) return;
      n.fired = 1;
      if (bot.down[i]) send(i, 'keyup');
      send(i, 'keydown'); bot.down[i] = 1; bot.cur[i] = n; bot.presses++; bot.songPresses++; bot.lastFire = clk();
      if (bot.session) bot.session.presses++;
      if (G.debug && bot.fired.length < 5000) bot.fired.push({ t: performance.now(), S: clk(), i, nt: n.nt, sus: n.sus, rel: n.rel });
      planRelease(i, n);
    }
    function planRelease(i, n) {
      cancel(n.tr); if (!n.fired) return;
      let rt = n.rel || (n.sus ? n.nt + 8 : n.nt + CFG.tapHold);
      const nx = bot.notes[i].find((m) => m.nt > n.nt + 0.005);
      if (nx) rt = Math.min(rt, nx.nt - 0.006);
      // let go before the video ends: a key still held when the song is over is counted as an overstrum
      const dur = curP().getDuration ? curP().getDuration() : 0;
      if (dur > 1) rt = Math.min(rt, Math.max(n.nt + 0.02, dur - 0.05));
      n.tr = at(rt, () => { if (bot.cur[i] === n && bot.down[i]) { send(i, 'keyup'); bot.down[i] = 0; } n.done = 1; });
    }
    function plan(i, n) { cancel(n.tp); if (n.fired) return; n.tp = at(n.nt, () => fire(i, n)); }

    // ---- per-frame scene: collected by the drawElements hook, processed after the frame ----
    let frameNotes = [], frameTrails = [], lastTri = -1;
    const fretX = CFG.fretX, atlasNotes = G.atlas.notes;
    w.__gfParse = (fl, count) => {
      if (count === 3) {                                        // stencil triangle of a sustain: remember its lane
        const ys = [fl[1], fl[7], fl[13]], xs = [fl[0], fl[6], fl[12]];
        const top = ys.indexOf(Math.min(...ys)); let cx = 0, k = 0;
        for (let j = 0; j < 3; j++) if (j !== top) { cx += xs[j]; k++; }
        cx /= k; let lane = 0, bd = 1e9;
        fretX.forEach((x, j) => { const d = Math.abs(x - cx); if (d < bd) { bd = d; lane = j; } });
        lastTri = lane; return;
      }
      const nq = Math.min(count / 6, fl.length / 24) | 0;
      for (let q = 0; q < nq; q++) {
        const b = q * 24;
        const u0 = Math.min(fl[b + 2], fl[b + 8], fl[b + 14], fl[b + 20]), v0 = Math.min(fl[b + 3], fl[b + 9], fl[b + 15], fl[b + 21]);
        const ymin = Math.min(fl[b + 1], fl[b + 7], fl[b + 13], fl[b + 19]), ymax = Math.max(fl[b + 1], fl[b + 7], fl[b + 13], fl[b + 19]);
        if (lastTri >= 0 && nq === 1 && u0 === 0 && v0 === 0) { frameTrails.push({ lane: lastTri, y0: ymin, y1: ymax }); continue; }
        for (const a of atlasNotes) {
          if (Math.abs(a.u - u0) < 0.002 && Math.abs(a.v - v0) < 0.002) {
            // the lane comes from the position, not the texture: with the Special active every note is drawn with the
            // same (green) texture
            const x = (fl[b] + fl[b + 6] + fl[b + 12] + fl[b + 18]) / 4, y = (ymin + ymax) / 2;
            const lane = Math.round((x - CFG.laneX[0]) / (CFG.laneX[1] * (y - CFG.laneX[2]))) + 2;
            if (lane >= 0 && lane <= 4) frameNotes.push({ lane, y, x, k: a.k });
            break;
          }
        }
      }
      lastTri = -1;
    };

    // ---- game clock phase ----
    // The game keeps its own clock: it snaps notes to floor(gameTime * 24) and re-syncs gameTime to the video now and
    // then (start, hitches, pauses), so gameTime = videoTime - b/24 with an offset b (in ticks) that is ~0 at the start
    // but can change. b is measured from the scene: between two frames all notes step down the highway by the number of
    // game ticks that passed, and that count must equal floor(T1 - b) - floor(T0 - b) (T = video time * 24). Every
    // frame pair votes against the phases it rules out; the least-contradicted phase interval wins.
    const PH = { pen: new Float32Array(100), prev: null, b: 0, half: 0.5 };
    function updatePhase(T, cells) {
      const prev = PH.prev; PH.prev = { T, cells }; PH.steps = null;
      if (!prev || cells.length < 2 || prev.cells.length < 2) return;
      const old = new Set(prev.cells);
      let best = -1, bc = 0, sc = 0;
      for (let st = 0; st <= 4; st++) {
        let c = 0; for (const k of cells) if (old.has(k - st)) c++;
        if (c > bc) { sc = bc; bc = c; best = st; } else if (c > sc) sc = c;
      }
      if (bc < 2 || bc === sc || bc < 0.6 * Math.min(cells.length, prev.cells.length)) return;   // ambiguous motion
      PH.steps = best;                                                  // game ticks since the previous frame
      if (!(T > prev.T) || T - prev.T > 3) return;
      const pen = PH.pen;
      for (let k = 0; k < 100; k++) {
        const b = (k + 0.5) / 100;
        pen[k] = pen[k] * CFG.phDecay + ((Math.floor(T - b) - Math.floor(prev.T - b)) === best ? 0 : 1);
      }
      let m = 0; for (let k = 1; k < 100; k++) if (pen[k] < pen[m]) m = k;
      const lim = pen[m] + 0.5; let lo = 0, hi = 0;
      while (lo < 99 && pen[(m - lo - 1 + 100) % 100] <= lim) lo++;
      while (hi < 99 && pen[(m + hi + 1) % 100] <= lim) hi++;
      const c = ((m + (hi - lo) / 2 + 0.5) / 100 + 1) % 1;
      PH.half = (lo + hi + 1) / 200;
      PH.b = c + Math.round(PH.b - c);                                  // keep b continuous (no whole-tick jumps)
    }

    function processScene(S, Sg) {
      const T = Sg * 24;
      // lattice cell of every note sprite on the open highway (the fret row is excluded: hit/press sprites stay there)
      const sprites = [];
      // (one sprite per lane and step: some notes, like the Special ones, are drawn as two sprites in the same place)
      const seenCell = new Set();
      for (const fn of frameNotes) {
        const i = indexOf(fn.y); if (!(i >= -0.5)) continue;
        const r = Math.round(i), key = fn.lane * 1000 + r;
        if (!seenCell.has(key)) { seenCell.add(key); sprites.push({ lane: fn.lane, i, r, x: fn.x, k: fn.k }); }
      }
      updatePhase(T, sprites.filter((p) => p.r >= 1 && p.r <= 35).map((p) => p.lane * 1000 + p.r));
      const b = PH.b, gt = Math.floor(T - b), fr = T - b - gt;
      // Visual tracking: between two frames every note moves down by the same number of steps, so a note seen last
      // frame at row r is the sprite at r + steps now. This keeps a note's identity even when a clock jumps (the game
      // re-syncing, or the video clock after buffering), which would otherwise turn the same note into a new one.
      const fid = ++bot.fid, T0 = bot.lastT; bot.lastT = T;
      let steps = PH.steps != null ? PH.steps : (T0 != null && T > T0 ? Math.floor(T - b) - Math.floor(T0 - b) : null);
      if (bot.reacq) {                  // first frame after a pause: the shift since the last frame before it, by overlap
        let bc = 0; steps = null;
        for (let st = 0; st <= 3; st++) {          // (the game comes back 1-2 ticks further on)
          let c = 0; for (const p of sprites) if (bot.notes[p.lane].some((m) => m.seen === fid - 1 && m.r + st === p.r)) c++;
          if (c > bc) { bc = c; steps = st; }
        }
      }
      const claimed = new Set();
      if (steps != null) {
        for (const p of sprites) {
          const n = bot.notes[p.lane].find((m) => m.seen === fid - 1 && m.r + steps === p.r && !claimed.has(m));
          if (n) { p.n = n; claimed.add(n); }
        }
      }
      for (const p of sprites) if (p.n) { p.n.r = p.r; p.n.seen = fid; }
      // near a game tick boundary the phase is uncertain: this frame could be one tick off, so it is not used
      const margin = Math.min(0.3, Math.max(CFG.edge, PH.half + 0.02));
      if (G.debug) { bot.trace.push([performance.now() | 0, +S.toFixed(4), +b.toFixed(3), +PH.half.toFixed(3), PH.steps, gt, +fr.toFixed(2), sprites.map((p) => p.lane + ':' + p.i.toFixed(2) + ':' + p.x.toFixed(1) + ':' + p.k).join(' ')]); if (bot.trace.length > 20000) bot.trace.splice(0, 5000); }
      // (except the first frame after a pause: notes at the frets must be taken now; votes fix their tick later)
      if (!bot.reacq && (fr < margin || fr > 1 - margin)) return;
      const timeOf = (i) => (CFG.X - (i - gt) + b) / 24;
      for (const p of sprites) {
        const N = p.r - gt, nt = timeOf(p.r);
        if (nt < S - (bot.reacq ? 0.045 : 0.03)) continue;
        const L = bot.notes[p.lane];
        // the same note: tracked from the last frame, or else within one tick of a known note
        let n = p.n || null, bd = 2;
        if (!n) for (const m of L) { const d = Math.abs(m.N - N); if (d <= 1 && d < bd) { bd = d; n = m; } }
        // A NEW note must be seen well above the frets: real notes come down from the top of the highway, while the
        // game also draws a note sprite on the fret when a key is pressed (press feedback) - that must never become
        // a note, or every press would schedule another one.
        // (right after a resume nothing is pressed, so the first frame takes every note down to the frets)
        if (!n && p.i > (bot.reacq ? CFG.reacqMaxI : CFG.newMaxI)) continue;
        if (!n) {
          n = { N, v: {}, nt, rel: 0, sus: 0 };
          L.push(n);
          if (G.debug) bot.born.push([performance.now() | 0, +S.toFixed(4), p.lane, N, +p.i.toFixed(2), +nt.toFixed(4), bot.reacq ? 1 : 0]);
        }
        claimed.add(n); n.r = p.r; n.seen = fid;
        // votes for the note's tick (they fix a frame that was one tick off); old votes fade so that after a clock jump
        // the note follows the new clock within a few frames
        for (const k in n.v) n.v[k] *= CFG.voteDecay;
        n.v[N] = (n.v[N] || 0) + 1;
        let mN = n.N, mc = -1; for (const k in n.v) if (n.v[k] > mc) { mc = n.v[k]; mN = +k; }
        n.N = mN;
        const want = (CFG.X - mN + b) / 24;
        if (!n.fired && (n.tp === undefined || Math.abs(want - n.nt) > 0.0015)) {
          n.nt = want; L.sort((x, y) => x.nt - y.nt); plan(p.lane, n);
          const pv = L[L.indexOf(n) - 1]; if (pv && pv.fired && !pv.done) planRelease(p.lane, pv);
        }
      }
      bot.reacq = false;
      for (const tr of frameTrails) {
        const L = bot.notes[tr.lane];
        // the trail starts at its note (bottom edge); while held, the bottom stays at the frets
        const ib = indexOf(tr.y1); const ntb = isNaN(ib) ? NaN : timeOf(Math.round(ib));
        let n = L.find((m) => Math.abs(m.nt - ntb) < 0.05);
        if (!n) n = L.filter((m) => m.fired && !m.done).pop();      // the sustain being held now
        if (!n) continue;
        n.sus = 1;
        const it = indexOf(tr.y0);
        if (!isNaN(it)) {                                            // the end of the sustain is visible
          const rel = timeOf(it) + CFG.relOff;
          if (rel > n.nt + 0.05 && (!n.rel || Math.abs(rel - n.rel) > 0.004)) { n.rel = rel; planRelease(tr.lane, n); }
        } else if (n.rel) { n.rel = 0; planRelease(tr.lane, n); }  // end above the top again: keep holding
      }
      for (const L of bot.notes) while (L.length && L[0].done && L[0].nt < S - 1) L.shift();
    }

    // ---- pause / buffering ----
    function pause() {
      C.v = -1;
      for (let i = 0; i < 5; i++) {
        if (bot.down[i]) { send(i, 'keyup'); bot.down[i] = 0; }
        bot.notes[i].forEach((n) => { cancel(n.tp); cancel(n.tr); });
      }
    }
    // Resume (or the clock jumped back): after the pause countdown the game re-syncs its own clock, which can move it by
    // whole ticks relative to the video, so every note's time is measured again from scratch (fresh votes, the phase
    // estimator starts over). The notes themselves are kept: the first frame finds them again by how far the highway
    // moved, so a note already played before the pause is not played again. That frame may also take new notes down
    // to the frets.
    function resume() {
      for (let i = 0; i < 5; i++) {
        bot.notes[i].forEach((n) => { cancel(n.tp); cancel(n.tr); if (!n.fired) { n.v = {}; n.tp = undefined; } });
        bot.cur[i] = null;
      }
      PH.pen.fill(0); PH.prev = null; PH.half = 0.5;
      bot.reacq = true; bot.lastT = null;
    }

    // When the player pauses, the game's clock comes back ~60-70 ms further on after the countdown, so a note that was
    // that close to the frets is counted as missed at once; and a key pressed right before the pause is swallowed (the
    // game reads keys once per frame). So the pause key is held back until there is a gap: the last press is at least
    // a frame old and no note is due in the next ~65 ms (at most CFG.pauseMax s, then the key goes through anyway).
    let held = null;
    const gap = () => { const now = clk(); if (now - bot.lastFire < 0.025) return false; for (const L of bot.notes) for (const n of L) if (!n.fired && n.nt > now - 0.03 && n.nt < now + CFG.pauseGap) return false; return true; };
    const onKey = (e) => {
      if (e.__gfbot || !/^(p|P|Escape)$/.test(e.key)) return;
      if (held) { held.push(e); e.stopImmediatePropagation(); e.preventDefault(); return; }
      if (e.type !== 'keydown' || !G.running || bot.paused || gap()) return;
      held = [e]; e.stopImmediatePropagation(); e.preventDefault();
      const t0 = performance.now();
      const check = () => {
        if (!gap() && performance.now() - t0 < CFG.pauseMax * 1000) { setTimeout(check, 4); return; }
        const evs = held; held = null;
        if (G.debug) bot.holds.push([+clk().toFixed(3), Math.round(performance.now() - t0), gap() ? 1 : 0]);
        for (const o of evs) { const c = new w.KeyboardEvent(o.type, o); c.__gfbot = true; o.target.dispatchEvent(c); }
      };
      setTimeout(check, 4);
    };
    w.addEventListener('keydown', onKey, true); w.addEventListener('keyup', onKey, true);

    // ---- history: one session per play; results are read from the game's own results screen ----
    const texts = [];
    try {
      const C2 = w.CanvasRenderingContext2D.prototype;
      if (!C2.__gfTexts) {
        C2.__gfTexts = true; const ft = C2.fillText;
        C2.fillText = function (txt) { try { if (w.__gfTextSink) w.__gfTextSink(String(txt)); } catch (e) { } return ft.apply(this, arguments); };
      }
      w.__gfTextSink = (s) => { texts.push([performance.now(), s]); if (texts.length > 600) texts.splice(0, 200); };
    } catch (e) { }
    function startSession() {
      const info = songInfo();
      bot.session = { id: Date.now() + '-' + Math.random().toString(36).slice(2, 7), startedAt: new Date().toISOString(),
        title: info.title, artist: info.artist, difficulty: info.difficulty, mode: info.mode,
        duration: Math.round((curP().getDuration && curP().getDuration()) || 0), presses: 0, maxS: 0, pauses: 0 };
    }
    // Results screen numbers, in drawing order: score, max combo, percentage, notes hit, overstrums, notes missed,
    // then special as "a / b" (labels are in the site's language, so only the order is used).
    function readResults() {
      for (let k = texts.length - 1; k >= 0; k--) {
        const m = /^(\d+)\s*\/\s*(\d+)$/.exec(texts[k][1].trim());
        if (!m) continue;
        const nums = [];
        for (let j = k - 1; j >= 0 && texts[k][0] - texts[j][0] < 50 && nums.length < 6; j--) {
          const v = texts[j][1].trim().replace('%', '');
          if (/^\d+$/.test(v)) nums.unshift(+v);
        }
        if (nums.length === 6) return { score: nums[0], maxCombo: nums[1], percentage: nums[2], notesHit: nums[3], overstrums: nums[4], notesMissed: nums[5], special: m[1] + '/' + m[2] };
      }
      return null;
    }
    function finishSession(completed, results) {
      const s = bot.session; bot.session = null;
      if (!s || (!completed && s.presses === 0)) return;
      const entry = Object.assign(s, { endedAt: new Date().toISOString(), completed: !!completed, reached: Math.round(s.maxS) }, results || {});
      delete entry.maxS;
      window.postMessage({ source: 'gfbot-page', type: 'history', entry }, location.origin);
    }
    function songEnded() {
      const s = bot.session; if (!s) return;
      let tries = 0;
      const poll = () => {
        const r = readResults();
        if (r || ++tries > 20) { if (bot.session === s) finishSession(true, r); return; }
        setTimeout(poll, 300);
      };
      setTimeout(poll, 800);
    }

    w.__afterRender.length = 0;
    w.__mtq = false;
    w.__afterRender.push(() => {
      const t = performance.now();
      bot.hb = t;
      const notes = frameNotes, trails = frameTrails; frameNotes = []; frameTrails = []; lastTri = -1;
      if (!G.running) return;
      const S = getS(); const P = curP();
      const Sc = clk();                                         // also keeps the buffering clock anchored
      const st = P.getPlayerState ? P.getPlayerState() : 1;
      if (G.debug && st !== bot.lastState && bot.events.length < 500) bot.events.push([+S.toFixed(3), st]);
      if (st === 0 && bot.lastState === 1) songEnded();
      bot.lastState = st;
      // paused / ended / not started (buffering = 3 is not a pause: the music goes on and the clock catches up)
      if (st !== 1 && st !== 3) {
        if (!bot.paused) { bot.paused = true; pause(); if (bot.session && st === 2 && S > 1) bot.session.pauses++; }
        return;
      }
      if (S < bot.lastS - 1) {                                    // new play (restart / new song)
        finishSession(false); releaseAll(); bot.songPresses = 0; bot.paused = false;
      } else if (bot.paused || S < bot.lastS - 0.05) {             // back from pause / small rewind
        bot.paused = false; resume();
      }
      bot.lastS = S;
      if (!bot.session && S < 5) startSession();
      if (bot.session) bot.session.maxS = Math.max(bot.session.maxS, S);
      frameNotes = notes; frameTrails = trails;
      // notes were positioned with the clock the game read this frame (extrapolated while buffering)
      processScene(Sc, st === 3 ? Sc : (P.__lastS != null ? P.__lastS : S));
      frameNotes = []; frameTrails = [];
      if (st === 3) { if (PH.steps === 0) C.still++; else if (PH.steps > 0) C.still = 0; } else C.still = 0;
      bot.frames++; bot.ms += performance.now() - t;
    });

    bot.releaseAll = releaseAll; bot.PH = PH;
    bot.dispose = () => { finishSession(false); releaseAll(); w.__gfParse = null; w.removeEventListener('keydown', onKey, true); w.removeEventListener('keyup', onKey, true); };
    bot.songTime = () => { try { return getS(); } catch (e) { return 0; } };
    return bot;
  }

  // attach to the game iframe (a new song = a new document)
  let watcher = null, statusTimer = null, lastDoc = null;
  function tick() {
    if (window.GFBOT !== G) { G.running = false; clearInterval(watcher); clearInterval(statusTimer); return; }
    const f = [...document.querySelectorAll('iframe')].find((f) => (f.src || '').includes('iframeGame'));
    const w = f && f.contentWindow;
    if (!w) return;
    try {
      hookGL(w);
      const d = w.document, gl = w.__gfGL;
      if (!gl || !gl.canvas || !gl.canvas.isConnected || gl.isContextLost()) return;   // the game has not drawn yet
      if (!window.ytPlayer || !window.ytPlayer.getCurrentTime) return;
      if (!G.atlas) { loadAtlas(w); return; }
      if (d === lastDoc) return;
      if (G.bot) G.bot.dispose();
      G.bot = install(w); lastDoc = d;
    } catch (e) { /* not ready yet */ }
  }
  // Song info from the page's fixed elements (works in every language of the site):
  //   #jogoTituloMusica -> <b>title</b> by/por/de <b>artist</b>;  #colunaInfo -> "Mode: ...", "Difficulty: ..."
  function songInfo() {
    const out = { title: '', artist: '', difficulty: '', mode: '' };
    try {
      const b = document.querySelectorAll('#jogoTituloMusica b');
      if (b[0]) out.title = b[0].textContent.trim();
      if (b[1]) out.artist = b[1].textContent.trim();
      const val = (el) => { if (!el) return ''; const c = el.cloneNode(true); const s = c.querySelector('strong'); if (s) s.remove(); return c.textContent.trim(); };
      const info = document.querySelectorAll('#colunaInfo .dadosInfo1');
      out.mode = val(info[0]); out.difficulty = val(info[1]);
    } catch (e) { }
    return out;
  }
  G.songInfo = songInfo;
  // Brave's fingerprinting protection (Shields, on by default) slightly changes what a page reads back from canvas and
  // audio. The game now uses those reads before it unlocks a song's notes, so with the protection on every song ends at
  // once with 0 notes ("You Rock", 0/0). The bot cannot change Shields; it detects the case so the popup can explain
  // how to turn it off for guitarflash.com. Test: paint a solid colour and read it back - unchanged without the protection.
  function fingerprintBlocked() {
    try {
      if (!navigator.brave) return false;
      const c = document.createElement('canvas'); c.width = 64; c.height = 16;
      const x = c.getContext('2d'); x.fillStyle = 'rgb(10,200,30)'; x.fillRect(0, 0, 64, 16);
      const d = x.getImageData(0, 0, 64, 16).data;
      for (let i = 0; i < d.length; i += 4) if (d[i] !== 10 || d[i + 1] !== 200 || d[i + 2] !== 30) return true;
    } catch (e) { }
    return false;
  }
  const FP_BLOCKED = fingerprintBlocked();
  G.fpBlocked = FP_BLOCKED;
  function postStatus() {
    const b = G.bot, S = b ? b.songTime() : 0, info = b ? songInfo() : {};
    window.postMessage({ source: 'gfbot-page', type: 'status', status: {
      running: G.running, attached: !!b, fpBlocked: FP_BLOCKED, presses: b ? b.songPresses : 0,
      song: info.title ? info.title + (info.artist ? ' - ' + info.artist : '') : '', difficulty: info.difficulty || '',
      paused: !!(b && b.paused && S > 1),
      songTime: b && S > 0 ? Math.floor(S / 60) + ':' + String(Math.floor(S % 60)).padStart(2, '0') : '' } }, location.origin);
  }

  G.start = () => {
    if (G.running) return 'running';
    G.running = true; lastDoc = null;
    watcher = setInterval(tick, 250); tick();
    statusTimer = setInterval(postStatus, 1000); postStatus();
    return 'running';
  };
  G.stop = () => {
    G.running = false;
    clearInterval(watcher); clearInterval(statusTimer); watcher = statusTimer = null;
    if (G.bot) G.bot.dispose();
    try { const f = document.querySelector('iframe[src*="iframeGame"]'); if (f && f.contentWindow.__afterRender) f.contentWindow.__afterRender.length = 0; } catch (e) { }
    G.bot = null; postStatus();
    return 'stopped';
  };

  window.addEventListener('message', (e) => {
    if (window.GFBOT !== G) return;
    if (e.source !== window || !e.data || e.data.source !== 'gfbot-ext') return;
    if (e.data.cmd === 'start') G.start(); else if (e.data.cmd === 'stop') G.stop();
  });
  window.postMessage({ source: 'gfbot-page', type: 'ready' }, location.origin);
})();
