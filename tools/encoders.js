/*
 * Frame encoders for tools/gif-recorder.html — no dependencies, browser only.
 *
 *   GifEncoder   GIF89a with a global colour table and LZW compression.
 *   webpAnimate  wraps still WebP frames (produced by the browser itself)
 *                into an animated WebP container.
 *
 * Neither is a general-purpose library: both assume every frame has the same
 * size and that frames arrive in order.
 */
'use strict';

/* ────────────────────────── GIF ────────────────────────── */

function GifEncoder(width, height) {
  this.width = width;
  this.height = height;
  this.frames = [];       // {indices: Uint8Array, delayCs: number}
  this.palette = null;    // Uint8Array, 3 bytes per entry
  this.lookup = null;     // Uint8Array(32768): 5-5-5 rgb -> palette index
}

/*
 * Builds one global palette for the whole animation from a colour histogram of
 * the supplied frames. A wheel is mostly flat colour, so the only variety comes
 * from anti-aliased edges — a frequency-ranked palette handles that far better
 * than a generic colour cube, and it is what keeps the file small and clean.
 */
GifEncoder.prototype.buildPalette = function (samples, maxColours) {
  maxColours = Math.min(maxColours || 256, 256);
  var counts = new Map();
  for (var s = 0; s < samples.length; s++) {
    var data = samples[s];
    for (var i = 0; i < data.length; i += 4) {
      // 5 bits per channel: enough for flat art, and it collapses the halo of
      // near-identical anti-aliasing shades into single buckets
      var key = ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }

  var entries = Array.from(counts.entries()).sort(function (a, b) { return b[1] - a[1]; });
  var chosen = entries.slice(0, maxColours).map(function (e) { return e[0]; });
  if (!chosen.length) { chosen = [0]; }

  var size = 2;
  while (size < chosen.length) { size *= 2; }

  this.palette = new Uint8Array(size * 3);
  for (var c = 0; c < chosen.length; c++) {
    var k = chosen[c];
    // expand 5 bits back to 8 so the darkest/lightest ends stay true
    this.palette[c * 3] = ((k >> 10) & 31) * 255 / 31;
    this.palette[c * 3 + 1] = ((k >> 5) & 31) * 255 / 31;
    this.palette[c * 3 + 2] = (k & 31) * 255 / 31;
  }

  // Nearest-neighbour table over the whole 15-bit colour space, built once:
  // afterwards quantising a pixel is a single array read.
  this.lookup = new Uint8Array(32768);
  for (var key2 = 0; key2 < 32768; key2++) {
    var r = ((key2 >> 10) & 31) * 255 / 31;
    var g = ((key2 >> 5) & 31) * 255 / 31;
    var b = (key2 & 31) * 255 / 31;
    var best = 0, bestDist = Infinity;
    for (var p = 0; p < chosen.length; p++) {
      var dr = r - this.palette[p * 3];
      var dg = g - this.palette[p * 3 + 1];
      var db = b - this.palette[p * 3 + 2];
      var dist = dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11;
      if (dist < bestDist) { bestDist = dist; best = p; }
    }
    this.lookup[key2] = best;
  }
  return size;
};

GifEncoder.prototype.addFrame = function (rgba, delayMs) {
  var n = this.width * this.height;
  var indices = new Uint8Array(n);
  for (var i = 0, j = 0; i < n; i++, j += 4) {
    indices[i] = this.lookup[((rgba[j] >> 3) << 10) | ((rgba[j + 1] >> 3) << 5) | (rgba[j + 2] >> 3)];
  }
  this.frames.push({ indices: indices, delayCs: Math.max(2, Math.round(delayMs / 10)) });
};

GifEncoder.prototype.render = function () {
  var out = [];
  var self = this;
  function byte(v) { out.push(v & 0xff); }
  function short(v) { out.push(v & 0xff, (v >> 8) & 0xff); }
  function str(s) { for (var i = 0; i < s.length; i++) { out.push(s.charCodeAt(i)); } }

  var colours = this.palette.length / 3;
  var bits = Math.max(1, Math.log2(colours) | 0);

  str('GIF89a');
  short(this.width);
  short(this.height);
  byte(0x80 | ((bits - 1) & 0x07));   // global colour table, size 2^bits
  byte(0);                            // background colour index
  byte(0);                            // pixel aspect ratio
  for (var i = 0; i < this.palette.length; i++) { byte(this.palette[i]); }

  // NETSCAPE2.0 application extension — loop forever
  byte(0x21); byte(0xff); byte(11);
  str('NETSCAPE2.0');
  byte(3); byte(1); short(0); byte(0);

  this.frames.forEach(function (frame) {
    byte(0x21); byte(0xf9); byte(4);
    byte(0x04);                       // disposal: leave in place, no transparency
    short(frame.delayCs);
    byte(0);                          // transparent colour index (unused)
    byte(0);

    byte(0x2c);                       // image descriptor
    short(0); short(0);
    short(self.width); short(self.height);
    byte(0);                          // no local colour table, not interlaced

    var minCodeSize = Math.max(2, bits);
    byte(minCodeSize);
    var lzw = lzwEncode(frame.indices, minCodeSize);
    for (var off = 0; off < lzw.length; off += 255) {
      var chunk = lzw.subarray(off, Math.min(off + 255, lzw.length));
      byte(chunk.length);
      for (var k = 0; k < chunk.length; k++) { byte(chunk[k]); }
    }
    byte(0);                          // block terminator
  });

  byte(0x3b);                         // trailer
  return new Blob([new Uint8Array(out)], { type: 'image/gif' });
};

function lzwEncode(indices, minCodeSize) {
  var clearCode = 1 << minCodeSize;
  var eoiCode = clearCode + 1;
  var codeSize = minCodeSize + 1;
  var next = eoiCode + 1;
  var dict = new Map();

  var out = [];
  var bitBuffer = 0;
  var bitCount = 0;

  function emit(code) {
    bitBuffer |= code << bitCount;
    bitCount += codeSize;
    while (bitCount >= 8) {
      out.push(bitBuffer & 0xff);
      bitBuffer >>= 8;
      bitCount -= 8;
    }
  }

  emit(clearCode);
  var prefix = indices[0];

  for (var i = 1; i < indices.length; i++) {
    var k = indices[i];
    var key = (prefix << 8) | k;
    if (dict.has(key)) {
      prefix = dict.get(key);
      continue;
    }
    emit(prefix);
    dict.set(key, next);
    next++;
    if (next > (1 << codeSize)) {
      if (codeSize < 12) {
        codeSize++;
      } else {
        emit(clearCode);
        dict.clear();
        codeSize = minCodeSize + 1;
        next = eoiCode + 1;
      }
    }
    prefix = k;
  }

  emit(prefix);
  emit(eoiCode);
  if (bitCount > 0) { out.push(bitBuffer & 0xff); }
  return new Uint8Array(out);
}

/* ───────────────────────── WebP ─────────────────────────── */

/*
 * The browser can encode a still WebP but not an animated one. Every still is
 * itself a RIFF container, so we pull the bitstream chunk out of each and
 * re-wrap the lot as VP8X + ANIM + ANMF…, which is what an animated WebP is.
 */
function webpAnimate(stillBuffers, width, height, delayMs, loopCount) {
  var frames = stillBuffers.map(extractBitstream);
  if (frames.some(function (f) { return !f; })) {
    throw new Error('a frame was not a WebP this muxer understands');
  }

  var parts = [];
  parts.push(chunk('VP8X', vp8xPayload(width, height)));
  parts.push(chunk('ANIM', animPayload(loopCount == null ? 0 : loopCount)));
  frames.forEach(function (frame) {
    parts.push(chunk('ANMF', anmfPayload(frame, width, height, delayMs)));
  });

  var bodyLength = parts.reduce(function (sum, p) { return sum + p.length; }, 4); // + 'WEBP'
  var out = new Uint8Array(8 + bodyLength);
  var view = new DataView(out.buffer);
  writeFourCC(out, 0, 'RIFF');
  view.setUint32(4, bodyLength, true);
  writeFourCC(out, 8, 'WEBP');
  var at = 12;
  parts.forEach(function (p) { out.set(p, at); at += p.length; });

  return new Blob([out], { type: 'image/webp' });

  function writeFourCC(target, offset, cc) {
    for (var i = 0; i < 4; i++) { target[offset + i] = cc.charCodeAt(i); }
  }

  function chunk(fourCC, payload) {
    var padded = payload.length + (payload.length & 1);
    var buf = new Uint8Array(8 + padded);
    writeFourCC(buf, 0, fourCC);
    new DataView(buf.buffer).setUint32(4, payload.length, true);
    buf.set(payload, 8);
    return buf;
  }

  function write24(target, offset, value) {
    target[offset] = value & 0xff;
    target[offset + 1] = (value >> 8) & 0xff;
    target[offset + 2] = (value >> 16) & 0xff;
  }

  function vp8xPayload(w, h) {
    var p = new Uint8Array(10);
    p[0] = 0x02;              // ANIM flag
    write24(p, 4, w - 1);     // canvas dimensions are stored minus one
    write24(p, 7, h - 1);
    return p;
  }

  function animPayload(loops) {
    var p = new Uint8Array(6);
    // background colour BGRA — 0 means "unspecified", which viewers ignore
    new DataView(p.buffer).setUint16(4, loops, true);
    return p;
  }

  function anmfPayload(frame, w, h, delay) {
    var sub = chunk(frame.fourCC, frame.data);
    var p = new Uint8Array(16 + sub.length);
    write24(p, 0, 0);          // frame x/2
    write24(p, 3, 0);          // frame y/2
    write24(p, 6, w - 1);
    write24(p, 9, h - 1);
    write24(p, 12, delay);
    p[15] = 0;                 // blend with previous, do not dispose
    p.set(sub, 16);
    return p;
  }

  // Pulls 'VP8 ' or 'VP8L' out of a still WebP. A canvas without transparency
  // gives us a plain one of those; anything else (ALPH, ICC…) we refuse rather
  // than silently produce a file that only some viewers can read.
  function extractBitstream(buffer) {
    var bytes = new Uint8Array(buffer);
    var view = new DataView(buffer);
    if (fourCC(bytes, 0) !== 'RIFF' || fourCC(bytes, 8) !== 'WEBP') { return null; }
    var at = 12;
    while (at + 8 <= bytes.length) {
      var cc = fourCC(bytes, at);
      var size = view.getUint32(at + 4, true);
      if (cc === 'VP8 ' || cc === 'VP8L') {
        return { fourCC: cc, data: bytes.subarray(at + 8, at + 8 + size) };
      }
      at += 8 + size + (size & 1);
    }
    return null;
  }

  function fourCC(bytes, offset) {
    return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
  }
}
