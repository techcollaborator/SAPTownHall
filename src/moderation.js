/**
 * Keeps what reaches the big screen safe for a room full of colleagues.
 *
 * Three layers, in order of how much we trust them:
 *   1. This filter masks clear profanity and *flags* the answer.
 *   2. The host sees every team's answer, flags first, and can exclude any of them
 *      before a single word is projected.
 *   3. Players can flag anything during voting, which surfaces on the host's screen.
 *
 * The filter deliberately flags rather than silently rejects. A false positive that a
 * host waves through costs nothing; a false negative on a projector costs a lot. Equally,
 * it must not mangle ordinary words — see ALLOWLIST.
 */

// Matched as whole words, after leetspeak is normalised.
const BANNED = [
  'fuck', 'fucking', 'fucked', 'fucker', 'motherfucker', 'shit', 'shitty', 'bullshit',
  'bitch', 'asshole', 'arsehole', 'bastard', 'cunt', 'dick', 'dickhead', 'prick',
  'cock', 'pussy', 'twat', 'wanker', 'bollocks', 'slut', 'whore', 'nigger', 'nigga',
  'faggot', 'fag', 'retard', 'retarded', 'spastic', 'tranny',
  'porn', 'nude', 'nudes', 'naked', 'penis', 'vagina', 'boobs', 'tits',
  'titties', 'blowjob', 'handjob', 'orgasm', 'masturbate', 'horny', 'sexy',
  'piss', 'crap', 'damn', 'goddamn', 'arse', 'ass', 'jackass', 'dumbass'
];

/**
 * Roots matched anywhere inside a word, to catch things like "shitlord" or "fuckwit".
 * Only roots that essentially never occur inside an innocent English word belong here.
 * Notably absent: "arse" (parse, sparse, rehearsal), "crap" (scrap), "ass" (assign,
 * assessment, class) and "cock" (cockpit) — those stay word-exact.
 */
const SUBSTRING_ROOTS = [
  'fuck', 'shit', 'cunt', 'nigg', 'faggot', 'asshole', 'arsehole',
  'bitch', 'whore', 'wank', 'bollock', 'blowjob', 'pussy', 'dickhead'
];

// Vouched for even though they contain a banned word. Without this, everyday consulting
// vocabulary — assign, assessment, class, cockpit, analysis — trips the filter.
const ALLOWLIST = [
  'class', 'classic', 'classes', 'classification', 'grass', 'grasp', 'pass', 'password',
  'passed', 'passing', 'bypass', 'compass', 'assess', 'assessment', 'asset', 'assets',
  'assign', 'assigned', 'assignment', 'assist', 'assistant', 'associate', 'association',
  'assume', 'assumption', 'assure', 'assurance', 'mass', 'massive', 'embassy', 'brass',
  'glass', 'cockpit', 'peacock', 'dickinson', 'scunthorpe', 'analysis', 'analyst',
  'analytics', 'analyse', 'analyze', 'titan', 'titanic', 'title', 'titles', 'constitute',
  'substitute', 'institute', 'documentation', 'sextant', 'parse', 'parser', 'parsing',
  'parsed', 'sparse', 'coarse', 'hoarse', 'rehearse', 'rehearsal', 'rehearsals',
  'scrap', 'scrapped', 'scrapping', 'scrapbook', 'classify', 'reclassify', 'passport',
  'canvas', 'harass', 'surpass', 'bass', 'crass'
];

const ALLOW = new Set(ALLOWLIST);
// A digit or symbol standing in for a letter, as in f*ck or f4ck.
const MASK_CHARS = /[*#@%$!0-9]/;

/** Collapses leetspeak so f4ck and sh!t don't sail through. */
function deleet(text) {
  return text
    .toLowerCase()
    .replace(/[@4]/g, 'a').replace(/[3\u20ac]/g, 'e').replace(/[1!|]/g, 'i')
    .replace(/[0\u00f8]/g, 'o').replace(/[$5]/g, 's').replace(/[7]/g, 't')
    .replace(/[8]/g, 'b').replace(/[9]/g, 'g');
}

/** True if this single word is banned outright, or contains an unambiguous root. */
function wordIsBanned(word) {
  if (!word || ALLOW.has(word)) return null;
  if (BANNED.includes(word)) return word;
  for (const root of SUBSTRING_ROOTS) if (word.includes(root)) return root;
  return null;
}

/**
 * Tokens to examine: the words themselves, plus runs of single letters joined back
 * together so "f u c k" and "f.u.c.k" are read as one word.
 */
function tokensOf(text) {
  const words = deleet(text).split(/[^a-z]+/).filter(Boolean);
  const tokens = [...words];
  let run = [];
  for (const w of words) {
    if (w.length === 1) {
      run.push(w);
    } else {
      if (run.length >= 3) tokens.push(run.join(''));
      run = [];
    }
  }
  if (run.length >= 3) tokens.push(run.join(''));
  return tokens;
}

/**
 * Words written with a stand-in character ("f*ck", "f4ck", "sh#t") are compared letter by
 * letter against the banned list, treating the stand-in as any single character. Leetspeak
 * that maps cleanly to a letter is already handled by deleet; this catches the rest.
 */
function maskedHit(original) {
  for (const raw of original.split(/\s+/)) {
    const word = raw.replace(/[^A-Za-z0-9*#@%$!]/g, '');
    if (word.length < 3 || !MASK_CHARS.test(word)) continue;

    // Mostly-wildcard words are identifiers, not disguised swearing: "P001" would
    // otherwise match "piss", and "INC0042" would match anything seven long. One
    // stand-in per four characters is enough to catch f*ck and f4ck.
    const wildcards = (word.match(/[*#@%$!0-9]/g) ?? []).length;
    if (wildcards > Math.max(1, Math.floor(word.length / 4))) continue;

    const pattern = new RegExp(`^${word.replace(/[*#@%$!0-9]/g, '.').toLowerCase()}$`);
    for (const bad of BANNED) if (bad.length === word.length && pattern.test(bad)) return bad;
  }
  return null;
}

/** Looks for anything banned. Returns the matched word, or null. */
function findBanned(text) {
  if (!text) return null;
  for (const token of tokensOf(text)) {
    const hit = wordIsBanned(token);
    if (hit) return hit;
  }
  return maskedHit(String(text));
}

/** Replaces a banned word with asterisks, keeping the first letter. */
function maskWord(word) {
  return word[0] + '*'.repeat(Math.max(1, word.length - 1));
}

/**
 * Screens a player's text.
 * Returns { text, flagged, reason } — `text` is masked and always safe to show,
 * `flagged` tells the host to look closely before it goes on screen.
 */
export function screen(raw) {
  const original = String(raw ?? '');
  const hit = findBanned(original);
  if (!hit) return { text: original, flagged: false, reason: null };

  // Mask what we can see in place, so even an answer the host approves reads clean.
  let masked = original;
  for (const bad of [...BANNED].sort((a, b) => b.length - a.length)) {
    masked = masked.replace(new RegExp(`\\b${bad}\\w*`, 'gi'), m => maskWord(m));
  }
  return { text: masked, flagged: true, reason: `matched "${hit}"` };
}

/**
 * Screens a display name. Names sit on the big screen all game with no host review
 * step of their own, so a bad one is refused outright rather than flagged.
 */
export function screenName(raw) {
  const name = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!name) return { ok: false, name: '', error: 'Enter a name first.' };
  if (findBanned(name)) return { ok: false, name: '', error: 'Pick a different name — that one will not fly in a town hall.' };
  return { ok: true, name, error: null };
}

export const _internals = { findBanned, deleet, BANNED, ALLOWLIST, SUBSTRING_ROOTS };
