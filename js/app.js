/* dreh-das-rad — app logic */
'use strict';

(function () {
  var TAU = Math.PI * 2;
  var SPIN_MS = 3000;
  var KEY = {
    theme: 'dreh-das-rad.theme',
    sound: 'dreh-das-rad.sound',
    motion: 'dreh-das-rad.motion',
    auto: 'dreh-das-rad.autoremove',
    last: 'dreh-das-rad.last'
  };

  function $(id) { return document.getElementById(id); }

  var el = {
    wheel: $('wheel'), fx: $('fx'),
    question: $('questionInput'), options: $('optionsInput'),
    countLabel: $('countLabel'), noteBox: $('noteBox'),
    questionEcho: $('questionEcho'),
    presetRow: $('presetRow'), paletteGrid: $('paletteGrid'),
    spin: $('btnSpin'), spinStatus: $('spinStatus'),
    card: $('resultCard'), resultName: $('resultName'),
    again: $('btnAgain'), remove: $('btnRemove'), copyResult: $('btnCopyResult'),
    autoRemove: $('autoRemove'), shuffle: $('btnShuffle'), fs: $('btnFs'),
    drawnBox: $('drawnBox'), drawnList: $('drawnList'),
    resetDrawn: $('btnResetDrawn'), remaining: $('remainingLabel'),
    historyBox: $('historyBox'), historyList: $('historyList'), clearHistory: $('btnClearHistory'),
    linkOut: $('linkOut'), copy: $('btnCopy'), share: $('btnShare'),
    qr: $('btnQr'), qrWrap: $('qrWrap'), qrBox: $('qrBox'),
    sound: $('btnSound'), motionRow: $('motionRow'), motionToggle: $('motionToggle'),
    themeSelect: $('themeSelect'), langSelect: $('langSelect'),
    toast: $('toast')
  };

  var store = {
    get: function (k, fallback) {
      try { var v = localStorage.getItem(k); return v === null ? fallback : v; }
      catch (e) { return fallback; }
    },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
  };

  var state = {
    palette: 'kirmes',
    drawn: [],
    rot: -Math.PI / 2,
    spinning: false,
    winner: null,        // index into the current pool while the result is up
    winnerLabel: null,
    removedByAuto: false,
    lampMode: 'idle',
    lampT: 0,
    pointerKick: 0,
    demo: true           // the wheel still shows the untouched starter list
  };

  var reduceQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  var motionOverride = store.get(KEY.motion, '0') === '1';
  var soundOn = store.get(KEY.sound, '1') === '1';

  function motionAllowed() { return !reduceQuery.matches || motionOverride; }

  /* ── sound ──────────────────────────────────────────────────────
     Synthesised, so the repo carries no audio files and the ratchet can
     follow the wheel's speed instead of looping a fixed sample. */
  var audio = (function () {
    var ctx = null;

    function ensure() {
      if (!ctx) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) { return null; }
        try { ctx = new AC(); } catch (e) { return null; }
      }
      if (ctx.state === 'suspended') { ctx.resume(); }
      return ctx;
    }

    function blip(freq, when, dur, type, peak) {
      var c = ensure();
      if (!c) { return; }
      var t = c.currentTime + when;
      var osc = c.createOscillator();
      var gain = c.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(peak, t + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(gain);
      gain.connect(c.destination);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    }

    return {
      unlock: ensure,
      tick: function (speed) {
        // fast wheel clicks high and tight, slow wheel drops in pitch
        var f = 520 + Math.min(1, speed / 26) * 620;
        blip(f, 0, 0.035, 'square', 0.06);
      },
      fanfare: function () {
        var notes = [523.25, 659.25, 783.99, 1046.5];
        for (var i = 0; i < notes.length; i++) {
          blip(notes[i], i * 0.085, 0.28, 'triangle', 0.16);
        }
      }
    };
  })();

  /* ── randomness ─────────────────────────────────────────────────
     The winner is drawn FIRST and the wheel is then told where to stop.
     Rejection sampling removes the modulo bias, so every option really
     does have the same chance — the animation is presentation only. */
  function randomIndex(n) {
    if (n <= 1) { return 0; }
    if (window.crypto && window.crypto.getRandomValues) {
      var limit = Math.floor(4294967296 / n) * n;
      var buf = new Uint32Array(1);
      var v;
      do { window.crypto.getRandomValues(buf); v = buf[0]; } while (v >= limit);
      return v % n;
    }
    return Math.floor(Math.random() * n);
  }

  /* ── model ──────────────────────────────────────────────────────*/
  function parsed() { return Wheel.parse(el.options.value); }

  // What is actually on the wheel right now: every segment whose label has
  // not been drawn yet. Removing a weighted option removes all its segments.
  function pool() {
    var all = parsed().items;
    if (!state.drawn.length) { return all; }
    var gone = {};
    for (var i = 0; i < state.drawn.length; i++) { gone[state.drawn[i]] = true; }
    return all.filter(function (label) { return !gone[label]; });
  }

  function uniqueRemaining() {
    var seen = {}, count = 0;
    var items = pool();
    for (var i = 0; i < items.length; i++) {
      if (!seen[items[i]]) { seen[items[i]] = true; count++; }
    }
    return count;
  }

  /* ── rendering ──────────────────────────────────────────────────*/
  var ctx = el.wheel.getContext('2d');
  var fxCtx = el.fx.getContext('2d');
  var confetti = new Wheel.Confetti(Wheel.PALETTES.kirmes.seg);
  var cssW = 0, cssH = 0;

  function sizeCanvases() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    var rect = el.wheel.getBoundingClientRect();
    cssW = Math.max(1, Math.round(rect.width));
    cssH = Math.max(1, Math.round(rect.height));
    el.wheel.width = Math.round(cssW * dpr);
    el.wheel.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    el.fx.width = Math.round(window.innerWidth * dpr);
    el.fx.height = Math.round(window.innerHeight * dpr);
    fxCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function render() {
    Wheel.draw(ctx, cssW, cssH, {
      items: pool(),
      rot: state.rot,
      palette: state.palette,
      dark: isDark(),
      lampMode: state.lampMode,
      lampT: state.lampT,
      pointerKick: state.pointerKick,
      winner: state.winner,
      still: !motionAllowed()
    });

    fxCtx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    confetti.draw(fxCtx);
  }

  function isDark() {
    var forced = document.documentElement.getAttribute('data-theme');
    if (forced === 'dark') { return true; }
    if (forced === 'light') { return false; }
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  /* ── animation loop ─────────────────────────────────────────────*/
  var spin = null;      // {start, from, delta, seg, amp, lastIdx}
  var rafId = 0;
  var lastTs = 0;

  function needsFrame() {
    return state.spinning ||
      confetti.alive() ||
      state.pointerKick > 0.01 ||
      (state.lampMode === 'win' && motionAllowed() && state.lampT < 3.8);
  }

  function loop(ts) {
    var dt = lastTs ? Math.min((ts - lastTs) / 1000, 0.05) : 0.016;
    lastTs = ts;

    if (state.spinning && spin) { stepSpin(ts); }
    if (state.lampMode === 'win') { state.lampT += dt; }
    state.pointerKick *= Math.pow(0.02, dt);   // ~decays in a fifth of a second
    confetti.update(dt);

    render();

    if (needsFrame()) { rafId = requestAnimationFrame(loop); }
    else { rafId = 0; lastTs = 0; }
  }

  function kick() {
    if (!rafId) { lastTs = 0; rafId = requestAnimationFrame(loop); }
  }

  function stepSpin(ts) {
    var t = Math.min(1, (ts - spin.start) / SPIN_MS);
    var prevRot = state.rot;
    var eased = Wheel.easeSpin(t);

    // A short damped wobble in the final stretch, always back to exactly zero
    // at t = 1 and bounded well inside one segment, so it can never change
    // which option the pointer ends up on.
    var wob = 0;
    if (t > 0.88) {
      var u = (t - 0.88) / 0.12;
      wob = spin.amp * Math.sin(u * Math.PI * 3) * (1 - u);
    }
    state.rot = spin.from + spin.delta * eased + wob;

    // ratchet: fire when the pointer crosses into a new segment
    var idx = segmentUnderPointer(spin.seg);
    if (idx !== spin.lastIdx) {
      var jumped = Math.abs(idx - spin.lastIdx);
      spin.lastIdx = idx;
      if (soundOn && jumped < 40) {
        var speed = Math.abs(state.rot - prevRot) / Math.max(1e-4, (ts - spin.lastTs) / 1000);
        audio.tick(speed);
      }
      state.pointerKick = 1;
    }
    spin.lastTs = ts;

    if (t >= 1) { finishSpin(); }
  }

  function segmentUnderPointer(seg) {
    var local = -Math.PI / 2 - state.rot;
    local = ((local % TAU) + TAU) % TAU;
    return Math.floor(local / seg);
  }

  /* ── spinning ───────────────────────────────────────────────────*/
  function startSpin(extraTurns) {
    if (state.spinning) { return; }
    var items = pool();
    if (items.length < 2) { return; }

    if (soundOn) { audio.unlock(); }

    hideCard();
    state.lampMode = 'idle';
    state.lampT = 0;

    var n = items.length;
    var seg = TAU / n;
    var w = randomIndex(n);
    state.winner = w;
    state.winnerLabel = items[w];

    // land the winner under the pointer, with a little off-centre variation
    // that always stays inside its own segment
    var jitter = (Math.random() - 0.5) * seg * 0.6;
    var target = -Math.PI / 2 - (w + 0.5) * seg + jitter;
    var base = ((target - state.rot) % TAU + TAU) % TAU;
    var turns = 5 + Math.min(5, Math.max(0, extraTurns || 0));

    if (!motionAllowed()) {
      state.rot = target;
      state.winner = w;
      finishSpin();
      return;
    }

    spin = {
      start: performance.now(),
      lastTs: performance.now(),
      from: state.rot,
      delta: base + turns * TAU,
      seg: seg,
      amp: Math.min(0.014, seg * 0.15),
      lastIdx: segmentUnderPointer(seg)
    };
    state.spinning = true;
    el.spin.disabled = true;
    el.spinStatus.textContent = i18n.t('srSpinning');
    kick();
  }

  function finishSpin() {
    state.spinning = false;
    spin = null;
    el.spin.disabled = false;
    state.lampMode = 'win';
    state.lampT = 0;
    state.removedByAuto = false;

    if (soundOn) { audio.unlock(); audio.fanfare(); }

    if (motionAllowed()) {
      var rect = el.wheel.getBoundingClientRect();
      confetti.colours = Wheel.PALETTES[state.palette].seg;
      confetti.burst(rect.left + rect.width / 2, rect.top + rect.height * 0.42, 90, 2.6);
    }

    if (el.autoRemove.checked && state.winnerLabel != null) {
      state.drawn.push(state.winnerLabel);
      state.removedByAuto = true;
      renderDrawn();
      // the pool just shrank, so the stored index would highlight the WRONG
      // segment on the redrawn wheel — same reasoning as in toggleRemoved()
      state.winner = null;
    }

    showCard();
    pushHistory(state.winnerLabel);
    el.spinStatus.textContent = i18n.fmt('srResult', { a: state.winnerLabel });
    kick();
  }

  /* ── result card ────────────────────────────────────────────────*/
  function showCard() {
    el.resultName.textContent = state.winnerLabel;
    el.remove.textContent = state.removedByAuto ? i18n.t('btnRestore') : i18n.t('btnRemove');
    el.card.hidden = false;
    updateSpinAvailability();
  }

  function hideCard() {
    el.card.hidden = true;
    state.winner = null;
    state.lampMode = 'idle';
  }

  function toggleRemoved() {
    if (state.winnerLabel == null) { return; }
    if (state.removedByAuto) {
      var at = state.drawn.lastIndexOf(state.winnerLabel);
      if (at >= 0) { state.drawn.splice(at, 1); }
      state.removedByAuto = false;
    } else {
      state.drawn.push(state.winnerLabel);
      state.removedByAuto = true;
    }
    renderDrawn();
    // the pool changed underneath, so the highlighted index is meaningless now
    state.winner = null;
    el.remove.textContent = state.removedByAuto ? i18n.t('btnRestore') : i18n.t('btnRemove');
    updateSpinAvailability();
    render();
  }

  function renderDrawn() {
    el.drawnBox.hidden = state.drawn.length === 0;
    el.drawnList.innerHTML = '';
    for (var i = 0; i < state.drawn.length; i++) {
      var li = document.createElement('li');
      li.textContent = state.drawn[i];
      el.drawnList.appendChild(li);
    }
    el.remaining.textContent = i18n.fmt('remainingLabel', { n: uniqueRemaining() });
  }

  /* ── recent spins (session only, deliberately never persisted) ──*/
  var history = [];

  function pushHistory(label) {
    history.unshift({ t: new Date(), label: label });
    if (history.length > 12) { history.pop(); }
    renderHistory();
  }

  function renderHistory() {
    el.historyBox.hidden = history.length === 0;
    el.historyList.innerHTML = '';
    for (var i = 0; i < history.length; i++) {
      var li = document.createElement('li');
      var time = document.createElement('span');
      time.className = 'h-time';
      time.textContent = history[i].t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      var name = document.createElement('span');
      name.textContent = history[i].label;
      li.appendChild(time);
      li.appendChild(name);
      el.historyList.appendChild(li);
    }
  }

  /* ── input handling ─────────────────────────────────────────────*/
  function updateCount() {
    var p = parsed();
    var n = p.items.length;
    el.countLabel.textContent = n === 1 ? i18n.t('countOne') : i18n.fmt('countMany', { n: n });

    var msg = '';
    if (p.overflow) { msg = i18n.t('noteTooMany'); }
    else if (pool().length < 2) { msg = i18n.t('errTooFew'); }
    el.noteBox.textContent = msg;
    el.noteBox.hidden = !msg;
  }

  function updateSpinAvailability() {
    el.spin.disabled = state.spinning || pool().length < 2;
  }

  function updateQuestionEcho() {
    var q = el.question.value.trim();
    el.questionEcho.textContent = q;
    el.questionEcho.hidden = !q;
  }

  function onInputChanged(fromUser) {
    if (fromUser) { state.demo = false; }
    updateCount();
    updateSpinAvailability();
    updateQuestionEcho();
    updateLink();
    saveLast();
    render();
  }

  /* ── link & sharing ─────────────────────────────────────────────*/
  function shareUrl() {
    var p = new URLSearchParams();
    var q = el.question.value.trim();
    if (q) { p.set('q', q); }
    p.set('o', el.options.value.trim());
    if (state.palette !== 'kirmes') { p.set('p', state.palette); }
    return location.origin + location.pathname + '#' + p.toString();
  }

  function updateLink() {
    el.linkOut.value = shareUrl();
    if (!el.qrWrap.hidden) { renderQr(); }
  }

  function readHash() {
    // Firefox decodes location.hash differently than other browsers; reading
    // the raw href and slicing sidesteps the whole problem (bigday's lesson).
    var href = location.href;
    var at = href.indexOf('#');
    if (at < 0) { return null; }
    var raw = href.slice(at + 1);
    if (!raw) { return null; }
    var p = new URLSearchParams(raw);
    if (!p.has('o')) { return null; }
    return { q: p.get('q') || '', o: p.get('o') || '', p: p.get('p') || 'kirmes' };
  }

  function renderQr() {
    el.qrBox.innerHTML = '';
    try {
      var qr = qrcode(0, 'M');           // 0 = smallest version that fits
      qr.addData(shareUrl(), 'Byte');
      qr.make();
      var n = qr.getModuleCount();
      var scale = 4, pad = 2;
      var px = (n + pad * 2) * scale;
      var c = document.createElement('canvas');
      c.width = px;
      c.height = px;
      var g = c.getContext('2d');
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, px, px);
      g.fillStyle = '#000000';
      for (var r = 0; r < n; r++) {
        for (var col = 0; col < n; col++) {
          if (qr.isDark(r, col)) { g.fillRect((col + pad) * scale, (r + pad) * scale, scale, scale); }
        }
      }
      var shown = Math.min(px, 220);
      c.style.width = shown + 'px';
      c.style.height = shown + 'px';
      el.qrBox.appendChild(c);
      el.qrWrap.hidden = false;
    } catch (e) {
      // too many options for a QR code — the link itself still works
      el.qrWrap.hidden = true;
      toast(i18n.t('copyFailed'));
    }
  }

  function copyText(text, okMsg) {
    function fallback() {
      el.linkOut.value = text;
      el.linkOut.select();
      try {
        if (document.execCommand('copy')) { toast(okMsg); return; }
      } catch (e) { /* ignore */ }
      toast(i18n.t('copyFailed'));
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast(okMsg); }, fallback);
    } else {
      fallback();
    }
  }

  var toastTimer = 0;
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.classList.remove('show'); }, 2200);
  }

  function resultText() {
    var q = el.question.value.trim();
    return (q ? q + ' → ' : '') + state.winnerLabel + ' 🎉';
  }

  /* ── persistence ────────────────────────────────────────────────*/
  var saveTimer = 0;
  function saveLast() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      store.set(KEY.last, JSON.stringify({
        q: el.question.value,
        o: el.options.value,
        p: state.palette
      }));
    }, 400);
  }

  /* ── presets & palettes ─────────────────────────────────────────*/
  var PRESETS = [
    { name: 'pYesNo', items: 'iYesNo' },
    { name: 'pCoin', items: 'iCoin' },
    { name: 'pNumbers', items: null },
    { name: 'pFood', items: 'iFood' },
    { name: 'pWatch', items: 'iWatch' },
    { name: 'pDo', items: 'iDo' }
  ];

  function presetItems(def) {
    if (!def.items) {
      var nums = [];
      for (var i = 1; i <= 10; i++) { nums.push(String(i)); }
      return nums;
    }
    return i18n.t(def.items).slice();
  }

  function buildPresets() {
    el.presetRow.innerHTML = '';
    PRESETS.forEach(function (def) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'preset';
      b.textContent = i18n.t(def.name);
      b.addEventListener('click', function () {
        el.options.value = presetItems(def).join('\n');
        state.drawn = [];
        renderDrawn();
        hideCard();
        onInputChanged(true);
      });
      el.presetRow.appendChild(b);
    });
  }

  function buildPalettes() {
    el.paletteGrid.innerHTML = '';
    Wheel.PALETTE_IDS.forEach(function (id) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'palette-btn';
      b.setAttribute('aria-pressed', String(id === state.palette));

      var sw = document.createElement('span');
      sw.className = 'swatch';
      sw.setAttribute('aria-hidden', 'true');
      Wheel.PALETTES[id].seg.slice(0, 5).forEach(function (colour) {
        var i = document.createElement('i');
        i.style.background = colour;
        sw.appendChild(i);
      });

      var label = document.createElement('span');
      label.textContent = i18n.t('pal' + id.charAt(0).toUpperCase() + id.slice(1));

      b.appendChild(sw);
      b.appendChild(label);
      b.addEventListener('click', function () { setPalette(id); });
      el.paletteGrid.appendChild(b);
    });
  }

  function setPalette(id) {
    state.palette = id;
    document.body.setAttribute('data-palette', id);
    var buttons = el.paletteGrid.querySelectorAll('.palette-btn');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].setAttribute('aria-pressed', String(Wheel.PALETTE_IDS[i] === id));
    }
    updateLink();
    saveLast();
    render();
  }

  /* ── drag to flick ──────────────────────────────────────────────*/
  var drag = null;

  function angleAt(ev) {
    var rect = el.wheel.getBoundingClientRect();
    return Math.atan2(ev.clientY - (rect.top + rect.height / 2),
      ev.clientX - (rect.left + rect.width / 2));
  }

  el.wheel.addEventListener('pointerdown', function (ev) {
    if (state.spinning || pool().length < 2) { return; }
    el.wheel.setPointerCapture(ev.pointerId);
    drag = { startAngle: angleAt(ev), startRot: state.rot, moved: 0, samples: [] };
  });

  el.wheel.addEventListener('pointermove', function (ev) {
    if (!drag) { return; }
    var a = angleAt(ev);
    var delta = a - drag.startAngle;
    while (delta > Math.PI) { delta -= TAU; }
    while (delta < -Math.PI) { delta += TAU; }
    drag.moved = Math.max(drag.moved, Math.abs(delta));
    state.rot = drag.startRot + delta;
    drag.samples.push({ t: performance.now(), a: state.rot });
    if (drag.samples.length > 8) { drag.samples.shift(); }
    render();
  });

  function endDrag(ev) {
    if (!drag) { return; }
    try { el.wheel.releasePointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
    var d = drag;
    drag = null;

    // a tap on the wheel is just another way to press "spin"
    if (d.moved < 0.04) { startSpin(0); return; }

    var first = d.samples[0];
    var last = d.samples[d.samples.length - 1];
    var speed = 0;
    if (first && last && last.t > first.t) {
      speed = Math.abs(last.a - first.a) / ((last.t - first.t) / 1000);
    }
    if (speed > 1.6) { startSpin(speed / 3); }
  }

  el.wheel.addEventListener('pointerup', endDrag);
  el.wheel.addEventListener('pointercancel', endDrag);

  /* ── wiring ─────────────────────────────────────────────────────*/
  el.spin.addEventListener('click', function () { startSpin(0); });
  el.again.addEventListener('click', function () { startSpin(0); });
  el.remove.addEventListener('click', toggleRemoved);
  el.copyResult.addEventListener('click', function () {
    copyText(resultText(), i18n.t('copied'));
  });

  el.resetDrawn.addEventListener('click', function () {
    state.drawn = [];
    state.removedByAuto = false;
    renderDrawn();
    hideCard();
    updateCount();
    updateSpinAvailability();
    render();
  });

  el.autoRemove.addEventListener('change', function () {
    store.set(KEY.auto, el.autoRemove.checked ? '1' : '0');
  });

  el.clearHistory.addEventListener('click', function () {
    history = [];
    renderHistory();
  });

  // Shuffles the INPUT LINES (weights stay attached to their option), so the
  // new order is visible in the textarea and travels with the share link.
  // Drawn options survive — the pool filters by label, not by position.
  el.shuffle.addEventListener('click', function () {
    // mid-spin the target rotation is already fixed for the current order —
    // reshuffling now would make the wheel stop on the wrong segment
    if (state.spinning) { return; }
    var lines = el.options.value.split('\n').filter(function (l) { return l.trim(); });
    if (lines.length < 2) { return; }
    for (var i = lines.length - 1; i > 0; i--) {
      var j = randomIndex(i + 1);
      var tmp = lines[i]; lines[i] = lines[j]; lines[j] = tmp;
    }
    el.options.value = lines.join('\n');
    hideCard();
    onInputChanged(true);
  });

  /* ── fullscreen ─────────────────────────────────────────────────*/
  var stageEl = $('stage');
  var sideEl = document.querySelector('.side');

  function fsActive() {
    return document.fullscreenElement === stageEl || document.webkitFullscreenElement === stageEl;
  }

  function fsLabel() {
    el.fs.setAttribute('aria-label', i18n.t(fsActive() ? 'btnFullscreenExit' : 'btnFullscreen'));
  }

  function fsChanged() {
    el.fs.setAttribute('aria-pressed', String(fsActive()));
    fsLabel();
    // The card normally lives in the side column, which fullscreen does not
    // show — pull it onto the stage for the duration, put it back afterwards.
    if (fsActive()) { stageEl.insertBefore(el.card, el.spin); }
    else { sideEl.insertBefore(el.card, sideEl.firstElementChild); }
    // the stage resizes with the transition into/out of the top layer
    requestAnimationFrame(function () { sizeCanvases(); render(); });
  }

  // iPhones have no element fullscreen at all — the button simply stays hidden
  var fsSupported = !!(stageEl.requestFullscreen || stageEl.webkitRequestFullscreen);
  if (fsSupported) {
    el.fs.hidden = false;
    el.fs.addEventListener('click', function () {
      if (fsActive()) {
        (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      } else {
        var p = (stageEl.requestFullscreen || stageEl.webkitRequestFullscreen).call(stageEl);
        if (p && p.catch) { p.catch(function () { /* denied — nothing to clean up */ }); }
      }
    });
    document.addEventListener('fullscreenchange', fsChanged);
    document.addEventListener('webkitfullscreenchange', fsChanged);
  }

  el.question.addEventListener('input', function () { onInputChanged(true); });
  el.options.addEventListener('input', function () {
    state.drawn = [];
    renderDrawn();
    hideCard();
    onInputChanged(true);
  });

  el.copy.addEventListener('click', function () { copyText(shareUrl(), i18n.t('copied')); });

  el.qr.addEventListener('click', function () {
    var open = el.qrWrap.hidden;
    el.qr.setAttribute('aria-expanded', String(open));
    if (open) { renderQr(); } else { el.qrWrap.hidden = true; }
  });

  if (navigator.share) {
    el.share.hidden = false;
    el.share.addEventListener('click', function () {
      navigator.share({
        title: 'Dreh das Rad',
        text: i18n.t('shareText'),
        url: shareUrl()
      }).catch(function () { /* the user dismissed the sheet */ });
    });
  }

  el.sound.addEventListener('click', function () {
    soundOn = !soundOn;
    store.set(KEY.sound, soundOn ? '1' : '0');
    el.sound.setAttribute('aria-pressed', String(soundOn));
    el.sound.setAttribute('aria-label', i18n.t(soundOn ? 'soundOnLabel' : 'soundOffLabel'));
    if (soundOn) { audio.unlock(); }
  });

  el.motionToggle.addEventListener('change', function () {
    motionOverride = el.motionToggle.checked;
    store.set(KEY.motion, motionOverride ? '1' : '0');
    render();
  });

  document.addEventListener('keydown', function (ev) {
    if (ev.key !== ' ' && ev.code !== 'Space') { return; }
    var tag = (ev.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || tag === 'button') { return; }
    ev.preventDefault();
    startSpin(0);
  });

  window.addEventListener('resize', function () { sizeCanvases(); render(); });

  var colourScheme = window.matchMedia('(prefers-color-scheme: dark)');
  (colourScheme.addEventListener ? colourScheme.addEventListener.bind(colourScheme, 'change')
    : colourScheme.addListener.bind(colourScheme))(function () { render(); });

  (reduceQuery.addEventListener ? reduceQuery.addEventListener.bind(reduceQuery, 'change')
    : reduceQuery.addListener.bind(reduceQuery))(function () { syncMotionRow(); render(); });

  function syncMotionRow() {
    el.motionRow.hidden = !reduceQuery.matches;
    el.motionToggle.checked = motionOverride;
  }

  /* ── theme dropdown ─────────────────────────────────────────────*/
  (function () {
    [['system', 'themeSystem'], ['light', 'themeLight'], ['dark', 'themeDark']].forEach(function (pair) {
      var opt = document.createElement('option');
      opt.value = pair[0];
      opt.setAttribute('data-i18n', pair[1]);
      el.themeSelect.appendChild(opt);
    });
    var stored = store.get(KEY.theme, 'system');
    if (stored !== 'light' && stored !== 'dark') { stored = 'system'; }
    el.themeSelect.value = stored;

    el.themeSelect.addEventListener('change', function () {
      var v = el.themeSelect.value;
      if (v === 'light' || v === 'dark') { document.documentElement.setAttribute('data-theme', v); }
      else { document.documentElement.removeAttribute('data-theme'); }
      store.set(KEY.theme, v);
      render();
    });
  })();

  /* ── language ───────────────────────────────────────────────────*/
  (function () {
    Object.keys(I18N).forEach(function (code) {
      var opt = document.createElement('option');
      opt.value = code;
      opt.textContent = I18N[code]._name;
      el.langSelect.appendChild(opt);
    });
    el.langSelect.addEventListener('change', function () { applyLang(el.langSelect.value); });
  })();

  function applyLang(code) {
    i18n.apply(code);
    buildPresets();
    buildPalettes();
    el.sound.setAttribute('aria-label', i18n.t(soundOn ? 'soundOnLabel' : 'soundOffLabel'));
    fsLabel();
    el.remove.textContent = state.removedByAuto ? i18n.t('btnRestore') : i18n.t('btnRemove');
    // an untouched starter wheel follows the language; a wheel the visitor
    // typed themselves is theirs and stays exactly as it is
    if (state.demo) {
      el.options.value = i18n.t('iFood').join('\n');
      state.drawn = [];
      renderDrawn();
    }
    updateCount();
    updateSpinAvailability();
    renderDrawn();
    updateLink();
    render();
  }

  /* ── start ──────────────────────────────────────────────────────*/
  function boot() {
    el.autoRemove.checked = store.get(KEY.auto, '0') === '1';
    el.sound.setAttribute('aria-pressed', String(soundOn));
    syncMotionRow();

    // measure before anything can ask for a repaint
    sizeCanvases();

    var initial = i18n.detect();
    el.langSelect.value = initial;
    i18n.apply(initial);
    fsLabel();

    var fromHash = readHash();
    var restored = null;
    if (!fromHash) {
      try { restored = JSON.parse(store.get(KEY.last, 'null')); } catch (e) { restored = null; }
    }
    var source = fromHash || restored;

    if (source && String(source.o || '').trim()) {
      el.question.value = source.q || '';
      el.options.value = source.o || '';
      state.demo = false;
      setPalette(Wheel.PALETTE_IDS.indexOf(source.p) >= 0 ? source.p : 'kirmes');
    } else {
      // never greet anyone with an empty wheel — the first click must work
      el.options.value = i18n.t('iFood').join('\n');
      state.demo = true;
      setPalette('kirmes');
    }

    buildPresets();
    buildPalettes();
    setPalette(state.palette);

    sizeCanvases();
    updateCount();
    updateSpinAvailability();
    updateQuestionEcho();
    updateLink();
    renderDrawn();
    render();

    if ('serviceWorker' in navigator) {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('./sw.js').catch(function () { /* offline is a bonus */ });
      });
    }
  }

  boot();
})();
