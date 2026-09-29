/* Does the host screen actually PAINT what the server says? Vote dots, authors, points
   and the QUIPSMASH badge all have to match the server's numbers exactly. */
import { startServer, startBrowser, startHost, joinBot, reporter, sleep, log } from './harness.js';

const PORT = 4333, CDP = 9444;
const { check, finish } = reporter();

await startServer(PORT);
const browser = await startBrowser({ cdpPort: CDP, profile: '/tmp/qs-dom' });
log('browser:', browser.name);

const host = await startHost(PORT);
// Answers must not contain their author's name, or the leak check below can't tell the
// difference between a name on screen and a name inside an answer.
const LINES = ['a suspiciously damp handshake', 'three raccoons in a trench coat',
  'the smell of a warm laptop', 'unlimited breadsticks, no context', 'a lukewarm bowl of gravy'];
// Everyone piles onto the first option, which forces a shutout to check the badge against.
// The 2s pace leaves the voting screen up long enough to inspect it.
for (const [i, name] of ['Ada', 'Bo', 'Cy', 'Dee', 'Eli'].entries()) {
  await joinBot(PORT, host.code, name, { answer: () => LINES[i], vote: c => c[0], pace: () => 2000 });
}
await sleep(400);

const screen = await browser.open(`http://127.0.0.1:${PORT}/host?room=${host.code}`, { width: 1440, height: 900 });
host.send({ t: 'host:start', settings: { writeSeconds: 30, voteSeconds: 30, revealSeconds: 30, scoreSeconds: 30 } });

/* ---- while voting is open: the screen must not reveal who wrote what ---- */
await host.waitFor(s => s.phase === 'voting', 'the first vote');
await sleep(500);
const duringVote = await screen.body();
const judges = (host.state.voting?.judges ?? []).map(j => j.name);
const authorsHidden = host.state.players.filter(p => !judges.includes(p.name));
check(authorsHidden.length === 2, `the two authors are not listed as judges (${authorsHidden.map(p => p.name)})`);
check(authorsHidden.every(p => !duringVote.includes(p.name)),
  'no author name leaks onto the voting screen');
check(host.state.voting.answers.every(a => duringVote.includes(a.text)), 'both answers are shown to vote on');
check(!/\bAda\b|\bBo\b|\bCy\b/.test(await screen.text('.duel')) , 'the answer cards carry no author labels yet');

/* ---- then the reveal ---- */
await host.waitFor(s => s.phase === 'reveal', 'the first reveal');
await sleep(1500);   // let the vote-dot animations land

const truth = host.state.reveal;
const cards = await screen.json(`[...document.querySelectorAll('.answer')].map(a => ({
  dots: a.querySelectorAll('.votes i').length,
  visibleDots: [...a.querySelectorAll('.votes i')].filter(i => {
    const r = i.getBoundingClientRect(), cs = getComputedStyle(i);
    return r.width > 4 && r.height > 4 && cs.opacity !== '0' && cs.visibility !== 'hidden';
  }).length,
  who: a.querySelector('.who')?.innerText.trim(),
  text: [...a.children].find(el => !el.className)?.innerText?.trim(),
  pts: a.querySelector('.pts')?.innerText.trim(),
  badge: !!a.querySelector('.quiplash, .smash-pill'),
  badgeOnTop: (() => {
    const b = a.querySelector('.quiplash'); if (!b) return null;
    const r = b.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!hit && (hit === b || b.contains(hit));
  })(),
  inView: a.getBoundingClientRect().bottom <= innerHeight && a.getBoundingClientRect().top >= 0
}))`);

log('server says:', truth.scored.map(s => `${s.name}=${s.votes}v/+${s.points}${s.shutout ? '/SHUTOUT' : ''}`).join(', '));
log('screen shows:', cards.map(c => `${c.who}=${c.visibleDots}dots/${c.pts}${c.badge ? '/badge' : ''}`).join(', '));

check(cards.length === truth.scored.length, 'one card painted per answer');
check(cards.every((c, i) => c.dots === truth.scored[i].votes), 'dot count matches the vote count');
check(cards.every(c => c.visibleDots === c.dots), 'every dot is actually visible (no stuck animations)');
check(cards.every((c, i) => c.pts === `+${truth.scored[i].points}`), 'points on screen match the server');
check(cards.every((c, i) => c.who?.includes(truth.scored[i].name)), 'each answer is attributed to its author');
check(cards.every((c, i) => truth.scored[i].text.includes(c.text) || c.text === truth.scored[i].text),
  'the answer text on screen is the text that was submitted');
const shutouts = truth.scored.filter(s => s.shutout).length;
check(cards.filter(c => c.badge).length === shutouts, `QUIPSMASH badge shown exactly when earned (${shutouts})`);
check(cards.filter(c => c.badgeOnTop !== null).every(c => c.badgeOnTop), 'the badge sits on top, not behind the prompt');
check(cards.every(c => c.inView), 'both answer cards fit on screen without scrolling');

// The prompt, and the round/multiplier tag, must be on screen too.
const shown = await screen.body();
check(shown.includes(truth.prompt.replace('<BLANK>', '').trim().slice(0, 24)), 'the prompt is on screen');
check(/ROUND 1 OF 3 · ×1/.test(await screen.text('#round-tag')), 'round and multiplier are labelled');
check(truth.scored.every(s => shown.includes(s.name)), 'now the authors are named');

check(screen.errors.length === 0, screen.errors.length ? `page threw: ${screen.errors[0]}` : 'no JS errors on the host screen');
finish();
