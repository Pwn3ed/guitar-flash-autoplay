// Guitar Flash Bot - runs inside the guitarflash.com page (MAIN world).
// Controlled by the extension (bridge.js) through window.postMessage: {source:'gfbot-ext', cmd:'start'|'stop'}.
//
// How it works: the game (PIXI/WebGL canvas in the same-origin iframe "iframeGame") computes note positions from
// ytPlayer.getCurrentTime() quantized to 1/24 s (notes move 28 px per tick = 672 px/s near the hit line).
// Right after each frame is drawn we read the lower part of the canvas, find the gems per lane, convert each gem
// position into the song time at which it reaches the hit line, and press the key (A S J K L, synthetic
// KeyboardEvents) when the YouTube clock reaches that time. Sustains are held until their tail end passes.
(function () {
  'use strict';
  if (window.top !== window) return;
  if (window.GFBOT && window.GFBOT.stop) window.GFBOT.stop();

  const CFG = {
    Yh: 1030,          // hit line (canvas px) used for timing
    V: 672,            // note speed near the hit line (px per song-second)
    off: 0,            // press offset (s)
    tapHold: 0.030,    // how long a normal note is held (s)
    relOff: 0.010,     // extra hold after a sustain tail ends (s)
    minSus: 0.09,      // minimum sustain length to trust a tail measurement (s)
    newMaxY: 910,      // a NEW note must first appear above this y: real gems enter from the top (first seen at
                       // y~899-904, charts are aligned to the 1/24 s ticks); hit echoes / sustain glows show up lower
    Z0: 868, Z1: 1002, // gem detection zone (above the hit flames)
    KEYS: [['a', 'KeyA', 65], ['s', 'KeyS', 83], ['j', 'KeyJ', 74], ['k', 'KeyK', 75], ['l', 'KeyL', 76]],
  };

  const G = window.GFBOT = { __v: 8, cfg: CFG, bot: null, running: false, debug: false };

  function install(w) {
    // current YouTube player; remember the exact song time the game itself read for the frame being drawn
    const curP = () => {
      const P = window.ytPlayer;
      if (!P.__orig) { const ORIG = P.__orig = P.getCurrentTime; P.getCurrentTime = function () { const v = ORIG.apply(this, arguments); P.__lastS = v; return v; }; }
      return P;
    };
    const getS = () => { const P = curP(); return P.__orig.call(P); };

    const c = w.document.getElementById('gfCanvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');

    // run our code right after the game draws (same task -> drawing buffer still valid); hook each context once
    if (!w.__afterRender) { w.__afterRender = []; w.__mtq = false; }
    if (!gl.__gfHooked) {
      gl.__gfHooked = true;
      const de = gl.drawElements;
      gl.drawElements = function () {
        const r = de.apply(this, arguments);
        if (!w.__mtq) { w.__mtq = true; w.queueMicrotask(() => { w.__mtq = false; for (const fn of w.__afterRender) { try { fn(); } catch (e) { w.__perr = String(e); } } }); }
        return r;
      };
    }
    w.__afterRender.length = 0;
    w.__mtq = false;

    // All geometry below is in reference units of a 1644x1160 canvas (the size the game uses here); if the game
    // creates the canvas at another resolution on another machine, pixel reads are scaled to the real size.
    const y0 = 850, y1 = 1100, x0 = 330, x1 = 1310;
    const sx = c.width / 1644, sy = c.height / 1160;
    const ax0 = Math.floor(x0 * sx), ax1 = Math.ceil(x1 * sx), ay0 = Math.floor(y0 * sy), ay1 = Math.ceil(y1 * sy);
    const AW = ax1 - ax0, AH = ay1 - ay0;
    const buf = new Uint8Array(AW * AH * 4);
    const colOf = []; for (let x = x0; x < x1; x++) colOf[x] = Math.min(AW - 1, Math.max(0, Math.round(x * sx) - ax0));
    const rowOf = []; for (let y = y0; y < y1; y++) rowOf[y] = Math.min(AH - 1, Math.max(0, ay1 - 1 - Math.round(y * sy)));
    const LG = [];
    for (let i = 0; i < 5; i++) {
      LG[i] = [];
      for (let y = y0; y < y1; y++) {
        const xl = 719 - 0.5625 * (y - 420), wd = 188.5 + 1.125 * (y - 420);
        LG[i][y] = [Math.round(xl + wd * (i + 0.5) / 5), Math.round(wd * 0.085), Math.max(4, Math.round(wd * 0.018))];
      }
    }
    const on = (x, y) => { const k = (rowOf[y] * AW + colOf[x]) * 4; const r = buf[k], g = buf[k + 1], b = buf[k + 2]; const mx = Math.max(r, g, b), mn = Math.min(r, g, b); return (mx - mn > 80 && mx > 110) || mn > 200; };
    const wide = (i, y) => { const [cx, h] = LG[i][y]; let n = 0, t = 0; for (let x = cx - h; x <= cx + h; x += 2) { t++; if (on(x, y)) n++; } return n / t; };
    const narrow = (i, y) => { const [cx, , h] = LG[i][y]; let n = 0, t = 0; for (let x = cx - h; x <= cx + h; x++) { t++; if (on(x, y)) n++; } return n / t; };
    const hueOn = (i, k) => { const r = buf[k], g = buf[k + 1], b = buf[k + 2]; return i === 0 ? (g > 110 && g - r > 50 && g - b > 50) : (b > 110 && b - r > 50 && b - g > 20); };
    const hueWide = (i, y) => { const [cx, h] = LG[i][y]; let n = 0, t = 0; for (let x = cx - h; x <= cx + h; x += 2) { t++; if (hueOn(i, (rowOf[y] * AW + colOf[x]) * 4)) n++; } return n / t; };
    const satAvg = (i, y) => { const [cx, h] = LG[i][y]; let s = 0, t = 0; for (let x = cx - h; x <= cx + h; x += 2) { t++; const k = (rowOf[y] * AW + colOf[x]) * 4; s += Math.max(buf[k], buf[k + 1], buf[k + 2]) - Math.min(buf[k], buf[k + 1], buf[k + 2]); } return s / t; };
    // Pixel readback. WebGL2: asynchronous (pixel-pack buffer + fence), so the GPU is never stalled - synchronous
    // reads stall the pipeline, and with heavy use the game started drawing some effects as solid rectangles.
    // The result of a frame is picked up a frame or two later together with the song time of that frame.
    // WebGL1 fallback: synchronous read.
    const isGL2 = typeof w.WebGL2RenderingContext !== 'undefined' && gl instanceof w.WebGL2RenderingContext;
    // Every finished readback is processed, oldest first (none is skipped, even if the GPU returns several at once).
    const ring = isGL2 ? Array.from({ length: 10 }, () => ({ pbo: gl.createBuffer(), sync: null, alloc: false })) : [];
    let seq = 0;
    function readFrames(Sq, S, process) {
      if (!isGL2) { gl.readPixels(ax0, c.height - ay1, AW, AH, gl.RGBA, gl.UNSIGNED_BYTE, buf); process(S, Sq); return; }
      const prev = gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING);
      const done = ring.filter(r => r.sync && gl.getSyncParameter(r.sync, gl.SYNC_STATUS) === gl.SIGNALED).sort((a, b) => a.seq - b.seq);
      // queue this frame first, so a slot is always free for the newest picture
      let slot = ring.find(r => !r.sync && !done.includes(r)) || done[0];
      if (slot) {
        if (slot.sync && done.includes(slot)) { // reuse the oldest finished one after reading it
          gl.bindBuffer(gl.PIXEL_PACK_BUFFER, slot.pbo); gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, buf);
          gl.deleteSync(slot.sync); slot.sync = null; done.shift(); process(slot.S, slot.Sq);
        }
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, slot.pbo);
        if (!slot.alloc) { gl.bufferData(gl.PIXEL_PACK_BUFFER, AW * AH * 4, gl.STREAM_READ); slot.alloc = true; }
        gl.readPixels(ax0, c.height - ay1, AW, AH, gl.RGBA, gl.UNSIGNED_BYTE, 0);
        slot.sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); slot.Sq = Sq; slot.S = S; slot.seq = ++seq;
      }
      for (const r of done) {
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, r.pbo); gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, buf);
        gl.deleteSync(r.sync); r.sync = null; process(r.S, r.Sq);
      }
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, prev);
    }
    function freeReadback() { for (const r of ring) { if (r.sync) gl.deleteSync(r.sync); r.sync = null; gl.deleteBuffer(r.pbo); } ring.length = 0; }

    const bot = {
      notes: [[], [], [], [], []], down: [0, 0, 0, 0, 0], cur: [null, null, null, null, null],
      presses: 0, songPresses: 0, rejected: 0, frames: 0, ms: 0, lastS: -1, hb: performance.now(), fired: [], paused: false, lastState: -1, ignoreBefore: 0, graceUntil: 0, session: null, rej: [], seen: [], gapLog: [], lastProcS: -1, laneS: [-1, -1, -1, -1, -1],
    };
    const dispatch = w.Document.prototype.dispatchEvent;
    const send = (i, type) => { const [key, code, kc] = CFG.KEYS[i]; dispatch.call(w.document, new w.KeyboardEvent(type, { key, code, keyCode: kc, which: kc, bubbles: true, cancelable: true })); };
    const releaseAll = () => { for (let i = 0; i < 5; i++) { if (bot.down[i]) send(i, 'keyup'); bot.down[i] = 0; bot.notes[i].forEach(n => { clearTimeout(n.tp); clearTimeout(n.tr); }); bot.notes[i] = []; bot.cur[i] = null; } };

    // run fn when the song clock reaches target (s)
    function at(target, fn) { const go = () => { const dt = (target - getS()) * 1000; if (dt <= 0.5) { fn(); return null; } return setTimeout(go, dt > 6 ? dt - 3 : Math.max(0, dt - 0.5)); }; return go(); }

    function fire(i, n) {
      if (n.fired || !G.running) return;
      n.fired = 1;
      if (bot.down[i]) send(i, 'keyup');
        send(i, 'keydown'); bot.down[i] = 1; bot.cur[i] = n; bot.presses++; bot.songPresses++;
      if (bot.session) bot.session.presses++;
      if (G.debug && bot.fired.length < 5000) bot.fired.push({ S: getS(), i, nt: n.nt, y0: n.y0, sus: n.sus });
      planRelease(i, n);
    }
    function planRelease(i, n) {
      clearTimeout(n.tr); if (!n.fired) return;
      let rt = n.rel || (n.sus ? n.nt + 8 : n.nt + CFG.tapHold);
      const nx = bot.notes[i].find(m => m.nt > n.nt + 0.005);
      if (nx) rt = Math.min(rt, nx.nt + CFG.off - 0.006);
      n.tr = at(rt, () => { if (bot.cur[i] === n && bot.down[i]) { send(i, 'keyup'); bot.down[i] = 0; } n.done = 1; });
    }
    function plan(i, n) { clearTimeout(n.tp); if (n.fired) return; n.tp = at(n.nt + CFG.off, () => fire(i, n)); }

    // Background: inside the lane sampling windows the empty highway is dark gray and never counts as "on"
    // (measured 0.00 in every calibration), so a fixed zero background is used - no calibration needed, which also
    // works when notes are already on the highway at the countdown or an overlay is on screen.
    bot.base = []; bot.baseN = [];
    for (let i = 0; i < 5; i++) { bot.base[i] = []; bot.baseN[i] = []; for (let y = y0; y < y1; y++) { bot.base[i][y] = 0; bot.baseN[i][y] = 0; } }

    // Pause: release keys and cancel the scheduled presses, but keep the notes already seen.
    function pause() {
      for (let i = 0; i < 5; i++) {
        if (bot.down[i]) { send(i, 'keyup'); bot.down[i] = 0; }
        bot.notes[i].forEach(n => { clearTimeout(n.tp); clearTimeout(n.tr); });
      }
    }
    // Resume (or the clock jumped back a little): re-plan every note that has not reached the hit line yet. If the game
    // rewound the song, notes that were already played are played again. For a moment, notes already in the middle of
    // the highway are accepted as new (they did not "enter from the top" while we were not looking).
    function resume(S) {
      for (let i = 0; i < 5; i++) {
        bot.notes[i] = bot.notes[i].filter(n => n.nt > S - 0.01);
        bot.notes[i].forEach(n => { n.fired = 0; n.done = 0; n.relFinal = 0; plan(i, n); });
        bot.cur[i] = null;
      }
      bot.ignoreBefore = S; bot.graceUntil = S + 0.4; bot.laneS = [-1, -1, -1, -1, -1];
    }

    // ---- History: one session per play; results are read from the game's own results screen ----
    // The game draws its texts (HUD and results screen) with canvas 2D fillText: keep the recent ones.
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
    // Results screen: the numbers are drawn in this order: score, max combo, percentage, notes hit, overstrums,
    // notes missed, then special as "a / b" (labels are in the site's language, so only the order is used).
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
      const poll = () => {                                   // the results screen appears a moment after the song
        const r = readResults();
        if (r || ++tries > 20) { if (bot.session === s) finishSession(true, r); return; }
        setTimeout(poll, 300);
      };
      setTimeout(poll, 800);
    }
    bot.finishSession = finishSession;

    w.__afterRender.push(() => {
      const t = performance.now();
      bot.hb = t;
      if (!G.running) return;
      const Snow = getS();
      const P = curP();
      const st = P.getPlayerState ? P.getPlayerState() : 1;
      if (st === 0 && bot.lastState === 1) songEnded();                 // the song finished
      bot.lastState = st;
      if (st !== 1) {                                                      // paused / buffering / ended
        if (!bot.paused) { bot.paused = true; pause(); if (bot.session && st === 2 && Snow > 1) bot.session.pauses++; }
        return;
      }
      if (Snow < bot.lastS - 1) {                                          // new play (restart / new song)
        finishSession(false);
        releaseAll(); bot.songPresses = 0; bot.lastProcS = -1; bot.laneS = [-1, -1, -1, -1, -1];
        bot.paused = false; bot.ignoreBefore = 0; bot.graceUntil = 0;
      } else if (bot.paused || Snow < bot.lastS - 0.05) {                  // back from pause / small rewind
        bot.paused = false; resume(Snow);
      }
      bot.lastS = Snow;
      if (!bot.session && Snow < 5) startSession();
      if (bot.session) bot.session.maxS = Math.max(bot.session.maxS, Snow);
      const Sg = P.__lastS != null ? P.__lastS : Snow;
      // request this frame's pixels; every finished readback is processed with the song time of ITS frame
      readFrames(Math.floor(Sg * 24 + 1e-6) / 24, Snow, (S, Sq) => { if (S <= Snow + 0.5 && S >= bot.ignoreBefore) processFrame(S, Sq); });
      bot.frames++; bot.ms += performance.now() - t;
    });

    function processFrame(S, Sq) {
      if (S < bot.lastProcS - 1) bot.laneS = [-1, -1, -1, -1, -1];   // restart
      bot.lastProcS = S;

      for (let i = 0; i < 5; i++) {
        // Runs taller than any gem are not gems: a run covering the TOP of the lane is the game's white flash
        // (special activation) -> the note entry area is hidden ("top blind"); a tall run coming from below is the
        // hit flame of a held note -> ignored. Separate gems in the same lane are still used.
        // A gem riding on top of a hit flame merges with it into one tall run. Between them the colour saturation dips
        // (gem ~180, gap ~100, flame rising from ~130), so a strong peak followed by a dip marks a gem at the top.
        let s = -1, e = -1, topBlind = false; const cl = [];
        const gemOnTop = (top) => {
          let peak = 0;
          for (let y = top; y <= top + 52 && y < y1; y += 2) {
            const v = satAvg(i, y);
            if (y - top >= 16 && peak >= 120 && v < peak * 0.65) return (top + y) / 2;   // gem = [top, dip]
            if (v > peak) peak = v;
          }
          return 0;
        };
        // Green and blue gems can also be found INSIDE a flame (flames are red/orange/yellow, never green or blue).
        const gemsByHue = (a, b) => {
          const out = []; let hs = -1, he = -1;
          for (let y = a; y <= b + 2; y += 2) {
            if (y <= b && hueWide(i, y) > 0.35) { if (hs < 0) hs = y; he = y; }
            else if (hs >= 0 && y - he > 4) { if (he - hs >= 10 && he - hs <= 50) out.push((hs + he) / 2); hs = -1; }
          }
          return out;
        };
        const endRun = () => {
          if (e - s > 70) {
            if (s <= CFG.Z0 + 20) topBlind = true;
            else if (i === 0 || i === 3) cl.push(...gemsByHue(s, e));
            else { const g = gemOnTop(s); if (g) cl.push(g); }
          }
          else if (e - s >= 10 && s > CFG.Z0) cl.push((s + e) / 2);
          s = -1;
        };
        for (let y = CFG.Z0; y <= CFG.Z1; y += 2) {
          const g = wide(i, y) - bot.base[i][y] > 0.4;
          if (g) { if (s < 0) s = y; e = y; } else if (s >= 0 && y - e > 4) endRun();
        }
        if (s >= 0 && e - s > 70 && s <= CFG.Z0 + 20) topBlind = true;   // (a gem cut off at Z1 is not used)
        // If the entry area of this lane was not seen for a while (flash, GPU readback hiccup), a new note may first be
        // seen lower than usual: widen the "new notes enter from the top" limit by the distance notes travelled.
        const gap = bot.laneS[i] >= 0 ? Math.max(0, S - bot.laneS[i] - 0.025) : 0;
        const newMaxY = CFG.newMaxY + CFG.V * gap;
        if (G.debug && gap > 0.02 && !topBlind && bot.gapLog.length < 2000) bot.gapLog.push([S, i, Math.round((gap + 0.025) * 1000)]);
        if (!topBlind) bot.laneS[i] = S;
        const L = bot.notes[i];
        if (G.debug && cl.length && bot.seen.length < 60000) bot.seen.push([S, i, cl.map(Math.round)]);
        for (const y of cl) {
          const nt = Sq + (CFG.Yh - y) / CFG.V;
          if (nt < S - 0.02) continue;
          const hasTail = (() => { let q = 0; for (let yy = Math.round(y) - 46; yy <= Math.round(y) - 26; yy += 5) { if (yy < y0) continue; if (narrow(i, yy) - bot.baseN[i][yy] > 0.55 && wide(i, yy) - bot.base[i][yy] < 0.4) q++; } return q >= 3; })();
          const win = S < 1 ? 0.12 : 0.05;           // the YouTube clock jumps when playback starts
          let n = L.find(m => Math.abs(m.nt - nt) < win);
          if (n) {
            if (hasTail) n.sus = 1;
            if (!n.fired) {
              if (nt < n.nt - 0.02) { n.nt = nt; n.k = 1; }                       // a +1 tick late estimate came first
              else if (Math.abs(nt - n.nt) < 0.02) { n.k++; n.nt += (nt - n.nt) / n.k; }
              plan(i, n);
            }
          } else {
            if (y > newMaxY && bot.songPresses > 0 && S > bot.graceUntil) {             // hit echo / glow
              bot.rejected++;
              if (G.debug && bot.rej.length < 3000) bot.rej.push({ S, i, y, nt, lanes: cl.slice() });
              continue;
            }
            n = { nt, k: 1, rel: 0, sus: hasTail ? 1 : 0, y0: y };
            L.push(n); L.sort((a, b) => a.nt - b.nt); plan(i, n);
            const pv = L[L.indexOf(n) - 1]; if (pv && pv.fired && !pv.done) planRelease(i, pv);
          }
        }
        while (L.length && L[0].done && L[0].nt < S - 1) L.shift();

        // sustains: measure where the tail ends and hold until it reaches the hit line
        for (const n of L.filter(n => n.sus && !n.done && !n.relFinal)) {
          let seen = 0, top = -1;
          for (let y = 975; y > y0 + 2; y -= 3) { if (narrow(i, y) - bot.baseN[i][y] > 0.55) { seen++; top = y; } else if (seen > 0 && top - y > 15) break; }
          if (seen >= 3 && top > y0 + 12 && top < 975) {
            const rel = Sq + (CFG.Yh - top) / CFG.V + CFG.relOff;
            if (rel > n.nt + CFG.minSus) {
              (n.ests = n.ests || []).push(rel);
              const a = [...n.ests].sort((p, q) => p - q), med = a[a.length >> 1];
              if (a.length >= 2 && (!n.rel || Math.abs(med - n.rel) > 0.004)) { n.rel = med; planRelease(i, n); }
            }
          }
          if (seen === 0 && n.fired && n.rel && S > n.rel - 0.02) n.relFinal = 1;
        }
      }
    }

    bot.releaseAll = releaseAll;
    bot.dispose = () => { finishSession(false); releaseAll(); try { freeReadback(); } catch (e) { } };
    bot.songTime = () => { try { return getS(); } catch (e) { return 0; } };
    return bot;
  }

  // attach to the game iframe (new song -> new document/canvas; reattach if frames stop arriving)
  let watcher = null, statusTimer = null, lastDoc = null, lastCanvas = null, lastSize = '';
  function tick() {
    // replaced by a newer instance: shut down only our own timers (the render queue now belongs to the new one)
    if (window.GFBOT !== G) { G.running = false; clearInterval(watcher); clearInterval(statusTimer); return; }
    const f = [...document.querySelectorAll('iframe')].find(f => (f.src || '').includes('iframeGame'));
    const w = f && f.contentWindow;
    if (!w) return;
    try {
      const d = w.document; const cv = d.getElementById('gfCanvas');
      if (!cv || !window.ytPlayer || !window.ytPlayer.getCurrentTime) return;
      // reattach on a new document / canvas, when the canvas is resized (it starts small while the song loads),
      // or if frames stopped arriving (heartbeat older than 3 s)
      const size = cv.width + 'x' + cv.height;
      const stale = G.bot && performance.now() - G.bot.hb > 3000;
      if (d === lastDoc && cv === lastCanvas && size === lastSize && !stale) return;
      if (G.bot) G.bot.dispose();
      G.bot = install(w); lastDoc = d; lastCanvas = cv; lastSize = size;
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
  function postStatus() {
    const b = G.bot, S = b ? b.songTime() : 0, info = b ? songInfo() : {};
    window.postMessage({ source: 'gfbot-page', type: 'status', status: {
      running: G.running, attached: !!b, presses: b ? b.songPresses : 0,
      song: info.title ? info.title + (info.artist ? ' - ' + info.artist : '') : '', difficulty: info.difficulty || '',
      paused: !!(b && b.paused && S > 1),
      songTime: b && S > 0 ? Math.floor(S / 60) + ':' + String(Math.floor(S % 60)).padStart(2, '0') : '' } }, location.origin);
  }

  G.start = () => {
    if (G.running) return 'running';
    G.running = true; lastDoc = null; lastCanvas = null; lastSize = '';
    watcher = setInterval(tick, 1000); tick();
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
    if (window.GFBOT !== G) return;                 // a newer instance replaced this one: never react again
    if (e.source !== window || !e.data || e.data.source !== 'gfbot-ext') return;
    if (e.data.cmd === 'start') G.start(); else if (e.data.cmd === 'stop') G.stop();
  });
  window.postMessage({ source: 'gfbot-page', type: 'ready' }, location.origin);
})();
