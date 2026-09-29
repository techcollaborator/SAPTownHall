/* The host screen's lobby: join code, QR, custom prompts, and the settings panel.
   Typing into the prompts box must survive players joining, and saved prompts must
   actually show up in the game. */
import { startServer, startBrowser, startHost, joinBot, reporter, sleep, log } from './harness.js';

const PORT = 4666, CDP = 9777;
const { check, finish } = reporter();

await startServer(PORT);
const browser = await startBrowser({ cdpPort: CDP, profile: '/tmp/qs-lobby' });
const host = await startHost(PORT);

const screen = await browser.open(`http://127.0.0.1:${PORT}/host?room=${host.code}`, { width: 1440, height: 900 });
await sleep(700);

check((await screen.text('.code')).trim() === host.code, `the room code is on screen (${host.code})`);
check(await screen.evaluate(`!!document.querySelector('.joincode img')?.complete`), 'the join QR code rendered');
check(/\d+\.\d+\.\d+\.\d+:\d+|localhost/.test(await screen.text('.url')), `an address for phones is shown ("${(await screen.text('.url')).trim()}")`);
// The first button inside #stage is the start button (the header's Skip lives outside it).
const startBtn = () => screen.text('#stage button');
check(/Need 3 more players/.test(await startBtn()), `the start button explains it needs more players ("${(await startBtn()).trim()}")`);

// Paced bots so the voting phase lingers long enough to inspect later on.
for (const n of ['Ada', 'Bo']) await joinBot(PORT, host.code, n, { pace: () => 2500 });
await sleep(500);
check(/Need 1 more player/.test(await startBtn()), 'and counts down as they arrive');

/* Open the tools panel and start typing custom prompts. */
await screen.evaluate(`document.querySelector('details.host-tools').open = true`);
await sleep(200);
// Both have a <BLANK> so whichever prompt gets drawn, the fill-in slot must render.
const MINE = "The worst thing to say at Dave's leaving do is <BLANK>\nOur team's real motto is <BLANK>";
await screen.type('#prompt-box', MINE);
check(await screen.evaluate(`document.querySelector('#prompt-box').value.length > 10`), 'the prompts box accepts typing');

// A third player joins mid-sentence — this used to wipe the box.
await joinBot(PORT, host.code, 'Cy', { pace: () => 2500 });
await sleep(600);
check(await screen.evaluate(`document.querySelector('#prompt-box')?.value`) === MINE,
  'a player joining does not wipe what the host is typing');
check((await startBtn()).includes('Start the game (3)'), `the start button is ready at 3 players ("${(await startBtn()).trim()}")`);

/* Save them, tick "only mine", and check the game actually uses them. */
await screen.evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent === 'Save prompts').click()`);
await sleep(400);
check(/2 custom prompts loaded/.test(await screen.body()), 'the saved prompt count is shown back');
await screen.evaluate(`document.querySelector('#useCustomOnly').checked = true`);
await screen.evaluate(`document.querySelector('#writeSeconds').value = 12`);
await screen.evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.startsWith('Start the game')).click()`);

await host.waitFor(s => s.phase === 'writing', 'writing');
check(host.state.settings.writeSeconds === 12, `the host's timer setting was applied (${host.state.settings.writeSeconds}s)`);

const mine = MINE.split('\n').map(p => p.replace('<BLANK>', '').trim());
check(host.state.phase !== 'lobby', 'the game started from the lobby');

await host.waitFor(s => s.phase === 'voting', 'voting');
await sleep(500);
const votingPrompt = await screen.text('.prompt-big');
check(mine.some(p => votingPrompt.includes(p)),
  `the prompt in play is one of mine ("${votingPrompt.trim().slice(0, 44)}…")`);
check(host.state.voting.prompt.includes('<BLANK>'), 'only my prompts are in the deck');

// <BLANK> renders as a slot, never as literal text.
check(await screen.evaluate(`!!document.querySelector('.prompt-big .blank')`), 'a <BLANK> prompt renders as a fill-in slot');
check(!/<BLANK>/.test(await screen.body()), 'no literal <BLANK> text leaked onto the screen');

check(screen.errors.length === 0, screen.errors.length ? `page threw: ${screen.errors[0]}` : 'no JS errors on the host screen');
finish();
