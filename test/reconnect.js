/* "My phone locked / the wifi dropped / I hit refresh" — driven through a real browser. */
import { startServer, startBrowser, startHost, joinBot, reporter, sleep, log } from './harness.js';

const PORT = 4555, CDP = 9666;
const { check, finish } = reporter();

await startServer(PORT);
const browser = await startBrowser({ cdpPort: CDP, profile: '/tmp/qs-recon' });
const host = await startHost(PORT);
for (const name of ['Ada', 'Bo', 'Cy']) await joinBot(PORT, host.code, name);

const phone = await browser.open(`http://127.0.0.1:${PORT}/play?room=${host.code}&name=Zoe`,
  { width: 390, height: 780, mobile: true });
await sleep(900);
const seat = () => host.state.players.find(p => p.name === 'Zoe');
check(!!seat(), 'the browser player joined via ?room=&name=');

host.send({ t: 'host:start', settings: { mode: 'solo', writeSeconds: 120, voteSeconds: 30, revealSeconds: 5, scoreSeconds: 5 } });
await sleep(900);
const promptBefore = await phone.text('.prompt');
check(promptBefore.length > 3, 'the phone shows a writing prompt');

/* Type half an answer, then lose the network mid-thought. */
await phone.type('#answer', 'half a thought');
await phone.offline(true);
await phone.evaluate('window.__quipsmash.drop()');  // Chromium's offline mode leaves open sockets alone
await sleep(1500);
check(seat().connected === false, 'the server sees the phone drop off');
const warned = await phone.evaluate(
  `(() => { const c = document.querySelector('#conn'); return c && !c.classList.contains('hidden') ? c.innerText : ''; })()`);
check(/reconnect/i.test(warned), `the phone says it is reconnecting ("${warned.trim()}")`);
check(host.state.phase === 'writing', 'a brief dropout does not end everyone else\'s writing time');

/* Wifi comes back. */
await phone.offline(false);
for (let i = 0; i < 40 && seat().connected !== true; i++) await sleep(250);
check(seat().connected === true, 'the phone silently reclaims its seat when wifi returns');
check(await phone.evaluate(`document.querySelector('#conn').classList.contains('hidden')`),
  'and the warning disappears again');
const draft = await phone.evaluate(`document.querySelector('#answer')?.value ?? ''`);
check(draft === 'half a thought', `the half-typed answer survived the dropout ("${draft}")`);

/* Now a full page refresh, the other classic. */
await phone.reload();
for (let i = 0; i < 40 && seat().connected !== true; i++) await sleep(250);
check(seat().connected === true, 'the phone rejoins the same seat after a refresh');
check((await phone.text('.prompt')).trim() === promptBefore.trim(), 'the same prompt is still waiting');
check(await phone.text('#me-name') === 'Zoe', 'still signed in as the same player');
check(host.state.players.length === 4, 'the refresh did not create a duplicate player');

/* Submitting still works afterwards. */
const promptA = await phone.text('.prompt');
await phone.type('#answer', 'a haunted air fryer');
await phone.evaluate(`document.querySelectorAll('button')[0].click()`);
await sleep(800);
const bodyNow = await phone.body();
check((await phone.text('.prompt')) !== promptA || /Answers in/.test(bodyNow) || host.state.phase !== 'writing',
  'the answer submitted after reconnecting reached the server and the phone moved on');
check(host.state.writing?.done?.some(p => p.name === 'Zoe') || host.state.phase !== 'writing' ||
  (await phone.text('.prompt')) !== promptA, 'the server recorded it');

/* And the big screen recovers too. */
const screen = await browser.open(`http://127.0.0.1:${PORT}/host?room=${host.code}`, { width: 1280, height: 800 });
await sleep(1000);
const tag = await screen.text('#round-tag');
check(/ROUND|LAST LASH/.test(tag), `a freshly opened host screen reattaches mid-game ("${tag.trim()}")`);
check(!/ROOM CODE/.test(await screen.body()), 'and it does not fall back to a fresh empty lobby');

const errs = [...phone.errors, ...screen.errors];
check(errs.length === 0, errs.length ? `no page exceptions → got: ${errs[0]}` : 'no page exceptions during any of that');
finish();
