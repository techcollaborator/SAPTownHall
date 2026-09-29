/* The filter has to catch the obvious stuff without mangling ordinary SAP vocabulary. */
import { screen, screenName } from '../src/moderation.js';

const fail = [];
const check = (c, l) => { if (!c) fail.push(l); console.log(`   ${c ? '✓' : '✗'} ${l}`); };

// Must be caught.
const BAD = ['this is shit', 'what the FUCK', 'f4ck this sprint', 'sh!t happens',
  'you are an asshole', 'f u c k', 'total bullsh1t', 'nice tits',
  'shitlord', 'f*ck this transport', 'what a fucking mess', 'total b1tch move'];
const caught = BAD.filter(t => screen(t).flagged);
check(caught.length === BAD.length, `flags obvious profanity (${caught.length}/${BAD.length})`);
check(!/fuck/i.test(screen('what the FUCK').text), `masks it in place ("${screen('what the FUCK').text}")`);

// Must NOT be caught — ordinary consulting language.
const FINE = [
  'Reassign the asset class and pass it to the analyst',
  'Assumption: the assessment passes UAT',
  'Classic scope creep, documented in the RAID log',
  'The cockpit tile needs a password reset',
  'Titan Consulting won the assignment',
  'Massive analysis of associated assets',
  'Per my previous email, this is parked',
  'Amber status, pending business sign-off',
  'Transport stuck in QA again',
  'The ABAP wizard assured us it was in scope',
  'Parse the sparse file before the dress rehearsal',
  'Scrap that and reclassify the asset',
  'Harass-free workplace training passed',
  'The cockpit needs a class assignment',
  'S4HANA migration, phase 2',
  'Upload final_v4 to the QA box',
  'Ticket INC0042 is still open',
  'BAPI2017 returned RC=4',
  'P001 P002 P003 joined the room',
  'Team T12 owns object Z1TAB',
  'Seat 4A, row 12'
];
const wrong = FINE.filter(t => screen(t).flagged);
check(wrong.length === 0, `leaves normal SAP language alone${wrong.length ? ` → flagged: ${JSON.stringify(wrong)}` : ''}`);

// Names are refused outright rather than flagged.
check(screenName('Priya').ok, 'accepts a normal name');
check(screenName('  Marcus  ').name === 'Marcus', 'trims a name');
check(!screenName('shitlord').ok, 'refuses a profane name');
check(!screenName('').ok, 'refuses an empty name');
check(screenName('Assistant Manager').ok, 'accepts a name containing an allowlisted word');
check(screen('').flagged === false && screen(null).flagged === false, 'handles empty and null safely');

console.log(fail.length ? `  FAILED (${fail.length}): ${fail.join('; ')}` : '  ALL CHECKS PASSED');
process.exit(fail.length ? 1 : 0);
