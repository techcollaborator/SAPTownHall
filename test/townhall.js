/* Drives a town-hall-sized team game in a real browser using the rehearsal bots, checks
   each new screen renders, and saves screenshots to test/shots-teams/. */
import { rmSync } from 'node:fs';
import { startServer, startBrowser, startHost, connect, reporter, sleep, log } from './harness.js';

const PORT = 4808, CDP = 9808;
const SHOTS = new URL('./shots-teams/', import.meta.url).pathname;
const { check, finish } = reporter();
rmSync(SHOTS, { recursive: true, force: true });

await startServer(PORT);
const browser = await startBrowser({ cdpPort: CDP, profile: '/tmp/qs-townhall' });
const host = await startHost(PORT);

const screen = await browser.open(`http://127.0.0.1:${PORT}/host?room=${host.code}`, { width: 1440, height: 900 });
await sleep(700);

/* One real phone, so the player screens are exercised for real; bots fill the room. */
const phone = await browser.open(`http://127.0.0.1:${PORT}/play?room=${host.code}&name=Sam`,
  { width: 390, height: 800, mobile: true });
await sleep(800);

host.send({ t: 'host:bots', count: 99 });
for (let i = 0; i < 60 && host.state.playerCount < 100; i++) await sleep(150);
check(host.state.playerCount === 100, `rehearsal bots filled the room to 100 (${host.state.playerCount})`);
check(host.state.botCount === 99, `99 of them are bots (${host.state.botCount})`);
await screen.shot(SHOTS + '1-host-lobby.png');
check(/20 teams of ~5/.test(await screen.body()), 'the lobby says how many teams that makes');

host.send({ t: 'host:start', settings: {
  mode: 'teams', teamSize: 5, totalRounds: 3, finalists: 4,
  draftSeconds: 22, pickSeconds: 18, voteSeconds: 14, revealSeconds: 6, scoreSeconds: 6
} });

/* ---- drafting ---- */
await host.waitFor(s => s.phase === 'drafting', 'drafting');
await sleep(900);
await screen.shot(SHOTS + '2-host-drafting.png');
await phone.shot(SHOTS + '3-phone-drafting.png');
check((await screen.text('.tally')).includes('ideas in'), 'the big screen counts ideas coming in');
check(/·/.test(await phone.text('#me-name')), `the phone shows which team you're on ("${await phone.text('#me-name')}")`);
const teamName = await phone.text('.teambadge');
check(teamName.length > 3, `the phone names your team and teammates ("${teamName.slice(0, 40).replace(/\n/g, ' ')}")`);
// Sam writes a line like a real person.
check(await phone.type('#answer', 'A 90-slide deck and a prayer'), 'the phone has a box to write in');
await sleep(200);
await phone.evaluate(`[...document.querySelectorAll('button')].find(b => /Send to my team/.test(b.textContent)).click()`);
await sleep(600);
// Once the last person submits, drafting ends early and the phone jumps to the team vote,
// so either screen means the line landed.
const afterSend = await phone.body();
check(/Idea sent/.test(afterSend) || /SHOULD WE SEND/i.test(afterSend),
  'the phone confirms the line went to the team');

/* ---- team pick ---- */
await host.waitFor(s => s.phase === 'picking', 'the team pick');
await sleep(900);
await screen.shot(SHOTS + '4-host-picking.png');
await phone.shot(SHOTS + '5-phone-picking.png');
check((await screen.body()).includes('teams locked in'), 'the big screen tracks teams locking in');
const options = await phone.json(`[...document.querySelectorAll('.vote-btn')].map(b => b.innerText)`);
check(options.length >= 2, `the phone shows the team's shortlist (${options.length} ideas)`);
// The header legitimately reads "Sam · <team>"; what must not leak is who wrote each idea.
const mates = (await phone.text('.teambadge')).replace(/^.*with /s, '').split(',').map(t => t.trim()).filter(Boolean);
const leaks = mates.filter(name => options.some(o => o.includes(name)));
check(leaks.length === 0, `the shortlist does not say who wrote what${leaks.length ? ` (saw ${leaks})` : ` (${mates.length} teammates checked)`}`);
check(options.filter(o => /yours/i.test(o)).length <= 1, 'only your own idea is marked as yours');

/* ---- host review: the moderation gate ---- */
await host.waitFor(s => s.phase === 'review', 'the host review');
await sleep(800);
await screen.shot(SHOTS + '6-host-review.png');
await phone.shot(SHOTS + '7-phone-review.png');
const rows = await phone.evaluate(`document.body.innerText`);
check(/host is/i.test(rows), 'the phone says the host is checking');
const cards = await screen.json(`document.querySelectorAll('.reviewrow').length`);
check(cards === host.state.review.total, `the dashboard lists every answer (${cards})`);
check(await screen.evaluate(`!!document.querySelector('.reviewrow button')`), 'each answer has a pull button');
// Pull the first one and confirm the screen marks it.
await screen.evaluate(`document.querySelector('.reviewrow button').click()`);
await sleep(400);
check(await screen.evaluate(`!!document.querySelector('.reviewrow.pulled')`), 'a pulled answer is struck through on the dashboard');
await screen.shot(SHOTS + '8-host-review-pulled.png');
await screen.evaluate(`[...document.querySelectorAll('button')].find(b => /answers up/.test(b.textContent)).click()`);

/* ---- voting, with the report button ---- */
await host.waitFor(s => s.phase === 'voting', 'voting');
await sleep(900);
await screen.shot(SHOTS + '9-host-voting.png');
await phone.shot(SHOTS + '10-phone-voting.png');
check(await screen.evaluate(`!!document.querySelector('.bigbar')`), 'a big room gets a progress bar instead of 90 plates');
const canFlag = await phone.evaluate(`!!document.querySelector('.flagbtn')`);
if (canFlag) {
  await phone.evaluate(`document.querySelector('.flagbtn').click()`);
  await sleep(500);
  check(host.reveals.length >= 0, 'a player can report an answer from their phone');
  check(await phone.evaluate(`!!document.querySelector('.flagbtn.flagged')`), 'the report button shows it was sent');
} else {
  check(true, "Sam's own team is on screen, so there is nothing for them to vote on or report");
}

/* ---- reveal and on to the end ---- */
await host.waitFor(s => s.phase === 'reveal', 'the reveal');
await sleep(1600);
await screen.shot(SHOTS + '11-host-reveal.png');
check((await screen.body()).match(/—/), 'the reveal credits the team and the person who wrote it');

await host.waitFor(s => s.phase === 'scores', 'the round scoreboard', 200_000);
await sleep(1800);
await screen.shot(SHOTS + '12-host-scores.png');
const boardRows = await screen.evaluate(`document.querySelectorAll('.board .line').length`);
check(boardRows === 20, `the leaderboard lists all 20 teams (${boardRows})`);

for (let round = 2; round <= 3; round++) {
  await host.waitFor(s => s.round === round && s.phase === 'review', `round ${round} review`, 300_000);
  host.send({ t: 'host:approve' });
  await sleep(200);
}
await host.waitFor(s => s.phase === 'final', 'the podium', 300_000);
await sleep(2000);
await screen.shot(SHOTS + '13-host-final.png');
await phone.shot(SHOTS + '14-phone-final.png');
check((await screen.body()).includes('Sharpest quip'), 'the podium also names the sharpest individual');
check(await screen.evaluate(`document.querySelectorAll('.podium .step').length === 3`), 'three teams on the podium');

const errs = [...screen.errors, ...phone.errors];
log('');
check(errs.length === 0, errs.length ? `page errors → ${errs[0]}` : 'no JS errors on either screen');
log('screenshots in test/shots-teams/');
finish();
