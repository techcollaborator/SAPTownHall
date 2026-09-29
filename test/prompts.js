/* Cheap guard on the prompt banks — catches copy/paste duplicates and prompts too long
   to fit on the big screen. Runs in milliseconds. */
import { MAIN_PROMPTS, FINAL_PROMPTS, SAFETY_QUIPS } from '../src/prompts.js';
import { loadCustomPrompts } from '../src/rooms.js';

const fail = [];
const check = (c, l) => { if (!c) fail.push(l); console.log(`   ${c ? '✓' : '✗'} ${l}`); };
const dupes = arr => {
  const seen = new Set(), d = [];
  for (const x of arr) { const k = x.toLowerCase().trim(); if (seen.has(k)) d.push(x); seen.add(k); }
  return d;
};

check(MAIN_PROMPTS.length >= 60, `enough main prompts for a long night (${MAIN_PROMPTS.length})`);
check(FINAL_PROMPTS.length >= 10, `enough Last Lash prompts (${FINAL_PROMPTS.length})`);
check(SAFETY_QUIPS.length >= 8, `enough safety quips (${SAFETY_QUIPS.length})`);
check(dupes(MAIN_PROMPTS).length === 0, `no duplicate main prompts${dupes(MAIN_PROMPTS).length ? ': ' + dupes(MAIN_PROMPTS).join(' | ') : ''}`);
check(dupes(FINAL_PROMPTS).length === 0, 'no duplicate Last Lash prompts');
const long = [...MAIN_PROMPTS, ...FINAL_PROMPTS].filter(p => p.length > 95);
check(long.length === 0, `nothing too long to read off a TV${long.length ? ': ' + long[0] : ''}`);
const blank = FINAL_PROMPTS.filter(p => !p.includes('<BLANK>'));
check(blank.length === 0, `every Last Lash prompt has a <BLANK> slot${blank.length ? ` (${blank.length} missing)` : ''}`);
const stray = MAIN_PROMPTS.filter(p => /<|>/.test(p.replace(/<BLANK>/g, '')));
check(stray.length === 0, 'no stray angle brackets that would render as markup');
const custom = loadCustomPrompts(new URL('../prompts.custom.json', import.meta.url).pathname);
check(Array.isArray(custom), `prompts.custom.json parses (${custom.length} prompts)`);
check(loadCustomPrompts('/nope/does/not/exist.json').length === 0, 'a missing custom file is handled quietly');

console.log(fail.length ? `  FAILED (${fail.length}): ${fail.join('; ')}` : '  ALL CHECKS PASSED');
process.exit(fail.length ? 1 : 0);
