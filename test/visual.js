/* Plays a game in a real browser and saves screenshots of every screen to test/shots/.
   Fails if any page throws. Usage: node test/visual.js */
import { rmSync } from 'node:fs';
import { startServer, startBrowser, startHost, joinBot, reporter, sleep, log } from './harness.js';

const PORT = 4222, CDP = 9333;
const SHOTS = new URL('./shots/', import.meta.url).pathname;
const { check, finish } = reporter();

rmSync(SHOTS, { recursive: true, force: true });

await startServer(PORT);
const browser = await startBrowser({ cdpPort: CDP, profile: '/tmp/qs-profile' });
log('browser:', browser.name);
const host = await startHost(PORT);
log('room code:', host.code);

/* Answers that read like a real game rather than "Bot3 wrote a thing". */
const LINES = [
  'a suspiciously damp handshake', "my uncle's ringtone at a funeral", 'aggressively normal socks',
  'the smell of a warm laptop', 'three raccoons in a trench coat', 'unlimited breadsticks, no context',
  'my search history, printed', 'a lukewarm bowl of gravy', "the vibe of a dentist's aquarium"
];
for (const [i, name] of ['Priya', 'Marcus', 'Tomiwa', 'Ines'].entries()) {
  await joinBot(PORT, host.code, name, {
    answer: (item, s) => LINES[(i * 2 + (s.round ?? 1)) % LINES.length],
    vote: c => c[i % c.length],
    pace: () => 500 + i * 400
  });
}
await sleep(400);

const screen = await browser.open(`http://127.0.0.1:${PORT}/host?room=${host.code}`, { width: 1440, height: 900 });
const phone = await browser.open(`http://127.0.0.1:${PORT}/play?room=${host.code}&name=Sam`, { width: 390, height: 800, mobile: true });
const landing = await browser.open(`http://127.0.0.1:${PORT}/`, { width: 1440, height: 900 });
await sleep(700);

const shot = async (page, name) => { await page.shot(SHOTS + name + '.png'); log('📸', name + '.png'); };

await shot(landing, '0-landing');
await shot(screen, '1-host-lobby');
await shot(phone, '2-phone-lobby');
check((await screen.text('.code')).trim() === host.code, `the big screen shows the room code (${host.code})`);

host.send({ t: 'host:start', settings: { mode: 'solo', writeSeconds: 40, finalWriteSeconds: 40, voteSeconds: 30, revealSeconds: 25, scoreSeconds: 25 } });

await host.waitFor(s => s.phase === 'writing', 'writing');
await sleep(400);
await shot(screen, '3-host-writing');
await shot(phone, '4-phone-writing');

// Sam types like a human would, then sends it.
check(await phone.type('#answer', 'a haunted air fryer'), 'the phone has an answer box to type into');
await sleep(250);
await shot(phone, '5-phone-typing');
await phone.evaluate(`document.querySelectorAll('button')[0].click()`);

await host.waitFor(s => s.phase === 'voting', 'voting');
await sleep(500);
await shot(screen, '6-host-voting');
await shot(phone, '7-phone-voting');

await host.waitFor(s => s.phase === 'reveal', 'the reveal');
await sleep(1500);
await shot(screen, '8-host-reveal');
await shot(phone, '9-phone-reveal');

await host.blitzUntil(s => s.phase === 'scores', 'the scoreboard');
await sleep(1600);   // let the staggered rows land
await shot(screen, '10-host-scores');

host.send({ t: 'host:advance' });
await host.waitFor(s => s.round === 2, 'round 2');
await host.blitzUntil(s => s.round === 3, 'the Last Lash');
await sleep(400);
await shot(screen, '11-host-lastlash-writing');
await shot(phone, '12-phone-lastlash-writing');

await host.blitzUntil(s => s.phase === 'voting', 'the Last Lash vote');
await sleep(600);
await shot(screen, '13-host-lastlash-voting');
await shot(phone, '14-phone-lastlash-voting');

await host.blitzUntil(s => s.phase === 'final', 'the podium');
await sleep(1800);
await shot(screen, '15-host-final');
await shot(phone, '16-phone-final');

const errs = [...screen.errors, ...phone.errors, ...landing.errors];
log('');
check(errs.length === 0, errs.length ? `JS console errors: ${errs.slice(0, 3).join(' | ')}` : 'no JS console errors on any page');
log('shots written to test/shots/');
finish();
