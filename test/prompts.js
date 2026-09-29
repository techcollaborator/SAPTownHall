/* Cheap guard on the prompt banks — catches copy/paste duplicates and prompts too long
   to fit on the big screen. Runs in milliseconds. */
import { MAIN_PROMPTS, FINAL_PROMPTS, SAFETY_QUIPS, TEAM_NAMES } from '../src/prompts.js';
import { screen } from '../src/moderation.js';
import { loadCustomPrompts } from '../src/rooms.js';

const fail = [];
const check = (c, l) => { if (!c) fail.push(l); console.log(`   ${c ? '✓' : '✗'} ${l}`); };
const dupes = arr => {
  const seen = new Set(), d = [];
  for (const x of arr) { const k = x.toLowerCase().trim(); if (seen.has(k)) d.push(x); seen.add(k); }
  return d;
};

// 100 people at 5 a side is 20 teams, which is 10 prompts a round: 21 for a 3-round game,
// 41 for a 5-round one. The bank has to cover that several times over without repeating.
check(MAIN_PROMPTS.length >= 41, `enough prompts for a five-round town hall (${MAIN_PROMPTS.length})`);
check(MAIN_PROMPTS.length >= 120, `and enough for several town halls with no repeats (${MAIN_PROMPTS.length})`);
check(TEAM_NAMES.length >= 20, `enough team names for 20 teams (${TEAM_NAMES.length})`);
check(new Set(TEAM_NAMES.map(n => n.toLowerCase())).size === TEAM_NAMES.length, 'no duplicate team names');
check(FINAL_PROMPTS.length >= 10, `enough Last Lash prompts (${FINAL_PROMPTS.length})`);
check(SAFETY_QUIPS.length >= 8, `enough safety quips (${SAFETY_QUIPS.length})`);
check(dupes(MAIN_PROMPTS).length === 0, `no duplicate main prompts${dupes(MAIN_PROMPTS).length ? ': ' + dupes(MAIN_PROMPTS).join(' | ') : ''}`);
check(dupes(FINAL_PROMPTS).length === 0, 'no duplicate Last Lash prompts');
const long = [...MAIN_PROMPTS, ...FINAL_PROMPTS].filter(p => p.length > 95);
check(long.length === 0, `nothing too long to read off a TV${long.length ? ': ' + long[0] : ''}`);
const blank = FINAL_PROMPTS.filter(p => !p.includes('<BLANK>'));
check(blank.length === 0, `every grand-final prompt has a <BLANK> slot${blank.length ? ` (${blank.length} missing)` : ''}`);
const stray = MAIN_PROMPTS.filter(p => /<|>/.test(p.replace(/<BLANK>/g, '')));
check(stray.length === 0, 'no stray angle brackets that would render as markup');
// The prompts themselves must not trip our own filter, or every round starts flagged.
const dirty = [...MAIN_PROMPTS, ...FINAL_PROMPTS, ...SAFETY_QUIPS, ...TEAM_NAMES].filter(t => screen(t).flagged);
check(dirty.length === 0, `no built-in text trips the profanity filter${dirty.length ? `: ${dirty[0]}` : ''}`);

const custom = loadCustomPrompts(new URL('../prompts.custom.json', import.meta.url).pathname);
check(Array.isArray(custom), `prompts.custom.json parses (${custom.length} prompts)`);
check(loadCustomPrompts('/nope/does/not/exist.json').length === 0, 'a missing custom file is handled quietly');

console.log(fail.length ? `  FAILED (${fail.length}): ${fail.join('; ')}` : '  ALL CHECKS PASSED');
process.exit(fail.length ? 1 : 0);
