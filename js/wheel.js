/*
 * dreh-das-rad — the wheel renderer.
 *
 * Deliberately free of any DOM/browser-API dependency beyond a 2D context, so
 * that tools/gif-recorder.html can render frames with the very same code the
 * app uses. If the recording looks right, the app looks right.
 */
'use strict';

var Wheel = (function () {

  /* ---------- colour helpers ---------- */

  function chan(v) {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  }

  function luminance(hex) {
    var h = hex.replace('#', '');
    if (h.length === 3) { h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]; }
    var r = parseInt(h.slice(0, 2), 16);
    var g = parseInt(h.slice(2, 4), 16);
    var b = parseInt(h.slice(4, 6), 16);
    return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
  }

  function contrast(a, b) {
    var l1 = luminance(a), l2 = luminance(b);
    if (l1 < l2) { var s = l1; l1 = l2; l2 = s; }
    return (l1 + 0.05) / (l2 + 0.05);
  }

  var INK = '#14100c';
  var PAPER = '#ffffff';

  // Segment labels never get a hand-picked colour: we take whichever of ink or
  // paper contrasts better. That way a palette tweak can never silently break
  // legibility — tools/check-contrast.js asserts the winner stays above 4.5:1.
  function textOn(bg) {
    return contrast(bg, INK) >= contrast(bg, PAPER) ? INK : PAPER;
  }

  /* ---------- palettes ---------- */

  var PALETTES = {
    kirmes: {
      seg: ['#c62828', '#f5c518', '#0b7f8a', '#fdf1dd', '#e2711d', '#1b7a4b'],
      rim: '#7a2e12', rimDark: '#4a1c0b',
      rimEdge: '#a8551f', rimEdgeDark: '#6b2c11',
      lamp: '#ffe9a8', lampGlow: '#ffc93c',
      hub: '#f5c518', hubRing: '#7a2e12',
      pointer: '#c62828', pointerEdge: '#fdf1dd'
    },
    neon: {
      seg: ['#00e5ff', '#ff2fb9', '#b2ff3a', '#7c3aed', '#ffd400', '#ff5c33'],
      rim: '#131a2e', rimDark: '#080c18',
      rimEdge: '#2b3a63', rimEdgeDark: '#1b2749',
      lamp: '#ffffff', lampGlow: '#54f2ff',
      hub: '#00e5ff', hubRing: '#131a2e',
      pointer: '#ff2fb9', pointerEdge: '#ffffff'
    },
    pastell: {
      // ordered so that the two coolest tones never end up side by side
      seg: ['#9fe0cd', '#ffcbd8', '#bcd2ff', '#ffe79a', '#d9c0ff', '#ffcda6'],
      rim: '#9b8fae', rimDark: '#5f5670',
      rimEdge: '#c3b7d4', rimEdgeDark: '#7d7290',
      lamp: '#fff6de', lampGlow: '#ffd9a0',
      hub: '#ffcbd8', hubRing: '#9b8fae',
      pointer: '#e4718f', pointerEdge: '#fff6de'
    },
    tinte: {
      // muted on purpose, but not a single-hue ramp: consecutive steps of one
      // ramp are indistinguishable, so brightness and hue both alternate
      seg: ['#33445e', '#c9cfd6', '#4f6b56', '#e0d5c3', '#7a6a4a', '#8fa8bd'],
      rim: '#1f2937', rimDark: '#131a24',
      rimEdge: '#3a4657', rimEdgeDark: '#25303f',
      lamp: '#e8d9b0', lampGlow: '#c9a95f',
      hub: '#c9d3de', hubRing: '#1f2937',
      // light pointer on the dark rim — the other way round it disappears
      pointer: '#e8eef5', pointerEdge: '#1f2937'
    }
  };

  var PALETTE_IDS = ['kirmes', 'neon', 'pastell', 'tinte'];

  /* ---------- option parsing ---------- */

  var MAX_ITEMS = 100;

  // "Papa kocht x3" becomes three segments carrying the same label. The label
  // keeps its clean form so results and the drawn list never show the "x3".
  function parse(text) {
    var lines = String(text == null ? '' : text).split('\n');
    var out = [];
    var overflow = false;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) { continue; }
      var weight = 1;
      var m = line.match(/^(.*\S)\s*[x×✕]\s*(\d{1,2})$/i);
      if (m && Number(m[2]) >= 1) {
        weight = Math.min(Number(m[2]), MAX_ITEMS);
        line = m[1].trim();
      }
      if (!line) { continue; }
      for (var w = 0; w < weight; w++) {
        if (out.length >= MAX_ITEMS) { overflow = true; break; }
        out.push(line);
      }
      if (overflow) { break; }
    }
    return { items: out, overflow: overflow };
  }

  /* ---------- easing ---------- */

  // Hard launch, long creeping tail — the tail is where the suspense lives.
  function easeSpin(t) {
    if (t <= 0) { return 0; }
    if (t >= 1) { return 1; }
    return 1 - Math.pow(1 - t, 3.7);
  }

  /* ---------- lamps ---------- */

  var LAMP_COUNT = 24;

  // 0 = dark, 1 = full. `t` is seconds since the wheel stopped; `still` is the
  // reduced-motion path, where flashing lights are exactly what we must avoid.
  function lampLevel(i, t, mode, still) {
    if (mode !== 'win') { return 0.13; }
    if (still) { return 1; }
    if (t < 0.18) { return 1; }                                  // everything on at once
    if (t < 1.4) {                                               // alternating blink
      return ((i + Math.floor(t * 14)) % 2 === 0) ? 1 : 0.14;
    }
    if (t < 3.0) {                                               // running light
      var lead = (((i - Math.floor(t * 18)) % 4) + 4) % 4;
      return lead === 0 ? 1 : (lead === 1 ? 0.5 : 0.18);
    }
    var fade = Math.max(0, 1 - (t - 3.0) / 0.6);
    return 0.13 + 0.5 * fade;
  }

  /* ---------- text fitting ---------- */

  // Rounds DOWN: rounding up by a hundredth of a pixel is enough to push a
  // just-fitting label over the limit and have it truncated for no reason.
  function font(size) {
    return '600 ' + (Math.floor(size * 10) / 10) + 'px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  }

  function fitText(ctx, text, maxW) {
    if (ctx.measureText(text).width <= maxW) { return text; }
    var ell = '…';
    var lo = 0, hi = text.length;
    while (lo < hi) {
      var mid = (lo + hi + 1) >> 1;
      if (ctx.measureText(text.slice(0, mid) + ell).width <= maxW) { lo = mid; }
      else { hi = mid - 1; }
    }
    return lo > 0 ? text.slice(0, lo) + ell : '';
  }

  /* ---------- the wheel ---------- */

  /*
   * state = {
   *   items: ['Pizza', …],   rot: radians,   palette: 'kirmes',
   *   dark: bool,            lampMode: 'idle'|'win',   lampT: seconds,
   *   pointerKick: 0..1,     winner: index|null,       still: bool
   * }
   */
  function draw(ctx, W, H, state) {
    var pal = PALETTES[state.palette] || PALETTES.kirmes;
    var dark = !!state.dark;
    var items = state.items || [];
    var n = items.length;
    var cx = W / 2, cy = H / 2;
    var R = Math.min(W, H) / 2 - 2;
    // A canvas that has not been laid out yet yields a negative radius, and
    // ctx.arc() throws on that — which would abort whatever called us.
    if (!(R > 0)) { return; }

    var rRim = R;
    var rLamp = R * 0.925;
    var rFace = R * 0.855;
    var rHub = R * 0.155;

    ctx.clearRect(0, 0, W, H);

    /* --- rim --- */
    var rimGrad = ctx.createLinearGradient(0, cy - R, 0, cy + R);
    rimGrad.addColorStop(0, dark ? pal.rimEdgeDark : pal.rimEdge);
    rimGrad.addColorStop(1, dark ? pal.rimDark : pal.rim);
    ctx.beginPath();
    ctx.arc(cx, cy, rRim, 0, Math.PI * 2);
    ctx.fillStyle = rimGrad;
    ctx.fill();

    /* --- segments --- */
    if (n === 0) {
      ctx.beginPath();
      ctx.arc(cx, cy, rFace, 0, Math.PI * 2);
      ctx.fillStyle = dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)';
      ctx.fill();
    } else {
      var seg = (Math.PI * 2) / n;
      // With few options a colour must never sit next to itself; with many the
      // cycle wraps anyway, so we only nudge the last segment when it collides.
      var colours = segmentColours(pal.seg, n);

      for (var i = 0; i < n; i++) {
        var a0 = i * seg + state.rot;
        var a1 = a0 + seg;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, rFace, a0, a1);
        ctx.closePath();
        ctx.fillStyle = colours[i];
        ctx.fill();
      }

      // separators keep low-contrast neighbours (pastell!) readable as segments
      ctx.strokeStyle = dark ? 'rgba(0,0,0,0.38)' : 'rgba(255,255,255,0.55)';
      ctx.lineWidth = Math.max(1, R * 0.006);
      for (var s = 0; s < n && n > 1; s++) {
        var a = s * seg + state.rot;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(a) * rFace, cy + Math.sin(a) * rFace);
        ctx.stroke();
      }

      /* --- labels --- */
      var arc = 2 * Math.sin(Math.min(seg, Math.PI) / 2) * rFace * 0.62;
      var fontSize = Math.max(6, Math.min(R * 0.115, arc));
      var maxW = rFace * 0.92 - rHub * 1.2;

      // One shared font size for the whole wheel — shrink it until the longest
      // label fits (down to a floor), and only then start cutting words off.
      ctx.font = font(fontSize);
      var longest = 0;
      for (var m = 0; m < n; m++) {
        longest = Math.max(longest, ctx.measureText(items[m]).width);
      }
      if (longest > maxW) {
        // 0.97 keeps a hair of headroom: text width is not perfectly linear in
        // font size, and without it a label lands a fraction over and gets cut.
        fontSize = Math.max(fontSize * 0.55, fontSize * (maxW / longest) * 0.97);
      }

      if (fontSize >= 6.5) {
        ctx.font = font(fontSize);
        ctx.textBaseline = 'middle';
        for (var j = 0; j < n; j++) {
          var mid = j * seg + seg / 2 + state.rot;
          // Normalised to [-π, π): anything pointing into the left half would
          // render upside down, so it gets flipped and drawn from the rim inwards.
          var norm = ((mid + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
          var flip = norm > Math.PI / 2 || norm < -Math.PI / 2;

          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate(flip ? mid + Math.PI : mid);
          ctx.fillStyle = textOn(colours[j]);
          ctx.textAlign = flip ? 'left' : 'right';
          ctx.fillText(fitText(ctx, items[j], maxW), (flip ? -1 : 1) * rFace * 0.92, 0);
          ctx.restore();
        }
      }
    }

    /* --- winner highlight --- */
    if (state.lampMode === 'win' && state.winner != null && n > 0) {
      var wseg = (Math.PI * 2) / n;
      var wa0 = state.winner * wseg + state.rot;
      var pulse = state.still ? 0.5 : 0.5 + 0.5 * Math.sin(state.lampT * 9);
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, rFace, wa0, wa0 + wseg);
      ctx.closePath();
      ctx.strokeStyle = 'rgba(255,255,255,' + (0.55 + 0.45 * pulse).toFixed(3) + ')';
      ctx.lineWidth = Math.max(2, R * 0.016);
      ctx.stroke();
      ctx.restore();
    }

    /* --- lamps --- */
    var lampR = Math.max(2, R * 0.030);
    for (var k = 0; k < LAMP_COUNT; k++) {
      var la = (k / LAMP_COUNT) * Math.PI * 2 - Math.PI / 2;
      var lx = cx + Math.cos(la) * rLamp;
      var ly = cy + Math.sin(la) * rLamp;
      var lvl = lampLevel(k, state.lampT || 0, state.lampMode || 'idle', state.still);

      if (lvl > 0.3) {
        var glow = ctx.createRadialGradient(lx, ly, 0, lx, ly, lampR * 3.4);
        glow.addColorStop(0, hexA(pal.lampGlow, 0.75 * lvl));
        glow.addColorStop(1, hexA(pal.lampGlow, 0));
        ctx.beginPath();
        ctx.arc(lx, ly, lampR * 3.4, 0, Math.PI * 2);
        ctx.fillStyle = glow;
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(lx, ly, lampR, 0, Math.PI * 2);
      ctx.fillStyle = lvl > 0.3 ? pal.lamp : mix(pal.lamp, dark ? pal.rimDark : pal.rim, 0.58);
      ctx.fill();
      ctx.lineWidth = Math.max(0.6, R * 0.004);
      ctx.strokeStyle = 'rgba(0,0,0,0.28)';
      ctx.stroke();
    }

    /* --- hub --- */
    var hubGrad = ctx.createLinearGradient(0, cy - rHub, 0, cy + rHub);
    hubGrad.addColorStop(0, mix(pal.hub, '#ffffff', 0.35));
    hubGrad.addColorStop(1, pal.hub);
    ctx.beginPath();
    ctx.arc(cx, cy, rHub, 0, Math.PI * 2);
    ctx.fillStyle = hubGrad;
    ctx.fill();
    ctx.lineWidth = Math.max(1.5, R * 0.014);
    ctx.strokeStyle = dark ? pal.rimDark : pal.hubRing;
    ctx.stroke();

    /* --- pointer, kicked aside by every peg it passes --- */
    var kick = (state.pointerKick || 0) * 0.42;
    ctx.save();
    ctx.translate(cx, cy - R * 1.0);
    ctx.rotate(kick);
    ctx.beginPath();
    ctx.moveTo(0, R * 0.30);
    ctx.lineTo(-R * 0.085, -R * 0.075);
    ctx.lineTo(R * 0.085, -R * 0.075);
    ctx.closePath();
    ctx.fillStyle = pal.pointer;
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = R * 0.06;
    ctx.shadowOffsetY = R * 0.012;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.lineWidth = Math.max(1.5, R * 0.013);
    ctx.strokeStyle = pal.pointerEdge;
    ctx.stroke();
    ctx.restore();
  }

  // Cycling a 6-colour palette leaves the last and first segment touching when
  // n % 6 === 1 — shift the final segment to the palette's middle to break it.
  function segmentColours(base, n) {
    var out = [];
    for (var i = 0; i < n; i++) { out.push(base[i % base.length]); }
    if (n > 1 && out[n - 1] === out[0]) {
      out[n - 1] = base[Math.floor(base.length / 2) % base.length];
      if (n > 2 && out[n - 1] === out[n - 2]) {
        out[n - 1] = base[(Math.floor(base.length / 2) + 1) % base.length];
      }
    }
    return out;
  }

  function hexA(hex, a) {
    var h = hex.replace('#', '');
    if (h.length === 3) { h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]; }
    return 'rgba(' + parseInt(h.slice(0, 2), 16) + ',' + parseInt(h.slice(2, 4), 16) +
      ',' + parseInt(h.slice(4, 6), 16) + ',' + a + ')';
  }

  function mix(a, b, amount) {
    function part(hex, i) {
      var h = hex.replace('#', '');
      if (h.length === 3) { h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]; }
      return parseInt(h.slice(i * 2, i * 2 + 2), 16);
    }
    var r = Math.round(part(a, 0) * (1 - amount) + part(b, 0) * amount);
    var g = Math.round(part(a, 1) * (1 - amount) + part(b, 1) * amount);
    var bl = Math.round(part(a, 2) * (1 - amount) + part(b, 2) * amount);
    return 'rgb(' + r + ',' + g + ',' + bl + ')';
  }

  /* ---------- confetti ---------- */

  // Lives here rather than in app.js so the GIF recorder can paint the very
  // same burst onto its frames.
  function Confetti(colours) {
    this.parts = [];
    this.colours = colours || ['#f97316', '#f43f5e', '#8b5cf6', '#10b981', '#fbbf24'];
  }

  Confetti.prototype.burst = function (x, y, count, spread) {
    for (var i = 0; i < count; i++) {
      var ang = -Math.PI / 2 + (Math.random() - 0.5) * (spread || 2.4);
      var speed = 260 + Math.random() * 420;
      this.parts.push({
        x: x, y: y,
        vx: Math.cos(ang) * speed,
        vy: Math.sin(ang) * speed,
        w: 5 + Math.random() * 5,
        h: 8 + Math.random() * 7,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 9,
        life: 0,
        max: 1.6 + Math.random() * 1.2,
        colour: this.colours[(Math.random() * this.colours.length) | 0]
      });
    }
  };

  Confetti.prototype.update = function (dt) {
    for (var i = this.parts.length - 1; i >= 0; i--) {
      var p = this.parts[i];
      p.life += dt;
      if (p.life >= p.max) { this.parts.splice(i, 1); continue; }
      p.vy += 900 * dt;
      p.vx *= (1 - 1.1 * dt);
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
    }
  };

  Confetti.prototype.draw = function (ctx) {
    for (var i = 0; i < this.parts.length; i++) {
      var p = this.parts[i];
      var fade = Math.min(1, (p.max - p.life) / 0.5);
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.colour;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  };

  Confetti.prototype.alive = function () { return this.parts.length > 0; };

  return {
    PALETTES: PALETTES,
    PALETTE_IDS: PALETTE_IDS,
    MAX_ITEMS: MAX_ITEMS,
    LAMP_COUNT: LAMP_COUNT,
    parse: parse,
    draw: draw,
    easeSpin: easeSpin,
    textOn: textOn,
    contrast: contrast,
    luminance: luminance,
    segmentColours: segmentColours,
    Confetti: Confetti
  };
})();

if (typeof module !== 'undefined' && module.exports) { module.exports = Wheel; }
