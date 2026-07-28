/*
 * Asserts that every language carries the same keys as English, that no value
 * is empty, that the preset item lists all have the same length, and that
 * placeholders like {n} survive translation.
 *
 * Run: node tools/check-i18n.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'i18n.js'), 'utf8');
const sandbox = { navigator: { languages: ['en'] }, localStorage: null, document: { documentElement: {} } };
vm.createContext(sandbox);
// only the data half needs evaluating; the runtime touches document on apply()
vm.runInContext(src.slice(0, src.indexOf('var i18n = (function')), sandbox);
const I18N = sandbox.I18N;

const ARRAY_KEYS = ['iYesNo', 'iCoin', 'iFood', 'iWatch', 'iDo'];
const base = I18N.en;
const baseKeys = Object.keys(base);

let failures = 0;
const fail = (msg) => { failures++; console.log('  FAIL ' + msg); };

console.log('languages: ' + Object.keys(I18N).join(', '));
console.log('keys per language: ' + baseKeys.length + '\n');

for (const [lang, table] of Object.entries(I18N)) {
  const missing = baseKeys.filter((k) => !(k in table));
  const extra = Object.keys(table).filter((k) => !baseKeys.includes(k));
  if (missing.length) { fail(`${lang}: missing ${missing.join(', ')}`); }
  if (extra.length) { fail(`${lang}: unknown key ${extra.join(', ')}`); }

  for (const key of baseKeys) {
    const value = table[key];
    if (value === undefined) { continue; }

    if (ARRAY_KEYS.includes(key)) {
      if (!Array.isArray(value)) { fail(`${lang}.${key}: expected an array`); continue; }
      if (value.length !== base[key].length) {
        fail(`${lang}.${key}: ${value.length} items, English has ${base[key].length}`);
      }
      if (value.some((v) => typeof v !== 'string' || !v.trim())) {
        fail(`${lang}.${key}: contains an empty item`);
      }
      if (new Set(value).size !== value.length) {
        fail(`${lang}.${key}: contains duplicates`);
      }
      continue;
    }

    if (typeof value !== 'string' || !value.trim()) { fail(`${lang}.${key}: empty`); continue; }

    // a dropped {n}/{a} would silently produce a sentence with a hole in it
    const want = (base[key].match(/\{\w+\}/g) || []).sort().join(',');
    const got = (value.match(/\{\w+\}/g) || []).sort().join(',');
    if (want !== got) {
      fail(`${lang}.${key}: placeholders "${got || '—'}" should be "${want || '—'}"`);
    }
  }
}

// English is the fallback for everything, so it must be complete by definition
for (const key of baseKeys) {
  if (base[key] === undefined) { fail(`en.${key}: missing`); }
}

console.log(failures ? `\n${failures} failure(s)` : '\nall languages complete');
process.exit(failures ? 1 : 0);
