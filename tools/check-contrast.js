/*
 * Asserts that every segment colour of every palette carries its label at
 * WCAG AA (4.5:1) with the automatically chosen ink/paper text colour, and
 * that neighbouring segments stay visually distinct.
 *
 * Run: node tools/check-contrast.js
 */
'use strict';

const Wheel = require('../js/wheel.js');

const AA = 4.5;

// Neighbours are judged by CIE76 colour difference, not by luminance contrast:
// orange and green can be equally bright yet obviously different colours, and
// the pastel palette is deliberately uniform in brightness. ΔE ≥ 20 is a
// comfortably visible difference for adjacent areas of solid colour.
const DELTA_E_MIN = 20;

function toLab(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) { h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]; }
  const lin = (v) => {
    v = parseInt(v, 16) / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const r = lin(h.slice(0, 2)), g = lin(h.slice(2, 4)), b = lin(h.slice(4, 6));
  // sRGB → XYZ (D65), then XYZ → Lab against the D65 white point
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = (0.2126 * r + 0.7152 * g + 0.0722 * b);
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t) => t > 0.008856 ? Math.cbrt(t) : (7.787 * t + 16 / 116);
  const fx = f(x), fy = f(y), fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function deltaE(a, b) {
  const la = toLab(a), lb = toLab(b);
  return Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2]);
}

let failures = 0;

function report(ok, line) {
  if (!ok) { failures++; }
  console.log((ok ? '  ok   ' : '  FAIL ') + line);
}

for (const id of Wheel.PALETTE_IDS) {
  const pal = Wheel.PALETTES[id];
  console.log('\n' + id);

  for (const colour of pal.seg) {
    const text = Wheel.textOn(colour);
    const ratio = Wheel.contrast(colour, text);
    report(ratio >= AA,
      `${colour}  text ${text}  ${ratio.toFixed(2)}:1`);
  }

  // Walk the colours the wheel actually renders for every option count, not
  // just the palette array: cycling and the anti-collision fixup both create
  // adjacencies that never appear as consecutive entries in `pal.seg`.
  const worst = new Map();
  for (let n = 2; n <= Wheel.MAX_ITEMS; n++) {
    const cols = Wheel.segmentColours(pal.seg, n);
    for (let i = 0; i < n; i++) {
      const a = cols[i];
      const b = cols[(i + 1) % n];
      const key = a < b ? a + '|' + b : b + '|' + a;
      if (worst.has(key)) { continue; }
      worst.set(key, { a, b, n, d: a === b ? 0 : deltaE(a, b) });
    }
  }
  for (const pair of [...worst.values()].sort((x, y) => x.d - y.d)) {
    if (pair.a === pair.b) {
      report(false, `identical colours touch (${pair.a}, first at n=${pair.n})`);
    } else {
      report(pair.d >= DELTA_E_MIN,
        `neighbours ${pair.a} / ${pair.b}  ΔE ${pair.d.toFixed(1)}`);
    }
  }
}

console.log('\n' + (failures ? failures + ' failure(s)' : 'all palettes pass'));
process.exit(failures ? 1 : 0);
