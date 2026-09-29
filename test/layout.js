/* Layout guard: at every phase, on three screen sizes and a phone, nothing may overlap a
   sibling or spill off the screen. Usage: node test/layout.js [players] */
import { startServer, startBrowser, startHost, joinBot, reporter, sleep, log } from './harness.js';

const N = Number(process.argv[2] ?? 8);
const PORT = 4400 + (N % 30), CDP = 9500 + (N % 30);
const { check, finish } = reporter();

/* Anything stuck out of the viewport, or overlapping a sibling in a single-column stack? */
const PROBE = `JSON.stringify((() => {
  const out = { overflowX: document.documentElement.scrollWidth > innerWidth + 1,
                overflowY: document.documentElement.scrollHeight > innerHeight + 2, overlaps: [] };
  for (const g of document.querySelectorAll('.stack, .board, .duel, .stack-answers, .podium, .lobby-players')) {
    const cs = getComputedStyle(g);
    const oneColumn = cs.display === 'grid' && cs.gridTemplateColumns.split(' ').length === 1;
    if (!oneColumn) continue;
    const kids = [...g.children].filter(k => k.getBoundingClientRect().height > 0 &&
      (!k.checkVisibility || k.checkVisibility({ contentVisibilityAuto: true, visibilityProperty: true })));
    for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) {
      const a = kids[i].getBoundingClientRect(), b = kids[j].getBoundingClientRect();
      const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      if (oy > 3 && ox > 3) out.overlaps.push((kids[i].className || kids[i].tagName) + ' over ' +
        (kids[j].className || kids[j].tagName) + ' by ' + Math.round(oy) + 'px');
    }
  }
  const shown = e => e.checkVisibility
    ? e.checkVisibility({ contentVisibilityAuto: true, opacityProperty: true, visibilityProperty: true })
    : true;
  out.offscreen = [...document.querySelectorAll('.answer, .board .line, .plate, .podium .step, button, .prompt-big, .prompt')]
    .filter(shown)
    .map(e => ({ c: e.className, r: e.getBoundingClientRect() }))
    .filter(x => x.r.height > 0 && (x.r.right > innerWidth + 1 || x.r.left < -1 || x.r.bottom > innerHeight + 2))
    .map(x => x.c);
  out.tall = document.documentElement.scrollHeight - innerHeight;   // by how much we overflow
  return out;
})())`;

await startServer(PORT);
const browser = await startBrowser({ cdpPort: CDP, profile: `/tmp/qs-layout-${N}` });
const host = await startHost(PORT);

const NAMES = ['Priya', 'Marcus', 'Tomiwa', 'Ines', 'Wei', 'Aoife', 'Kwame', 'Sofia', 'Dimitri', 'Yara', 'Bo', 'Nils'];
const LONG = 'a suspiciously damp handshake at a family reunion nobody asked for at all';
for (let i = 0; i < N; i++) {
  // Player 0 always writes the longest answer the game allows, to stress the cards.
  await joinBot(PORT, host.code, NAMES[i], {
    answer: () => (i === 0 ? LONG : `${NAMES[i]} wrote a thing`),
    vote: c => c[i % c.length],
    pace: () => 1200
  });
}
await sleep(400);

const url = `http://127.0.0.1:${PORT}/host?room=${host.code}`;
const screens = [
  { label: 'TV 1440×900', page: await browser.open(url, { width: 1440, height: 900 }) },
  { label: 'TV 1280×720', page: await browser.open(url, { width: 1280, height: 720 }) },
  { label: 'laptop 1024×640', page: await browser.open(url, { width: 1024, height: 640 }) }
];
const phone = await browser.open(`http://127.0.0.1:${PORT}/play?room=${host.code}&name=Zoe`,
  { width: 390, height: 780, mobile: true });
await sleep(700);

async function probeAll(label) {
  const tag = `${label} [${host.state.phase}]`;
  for (const s of screens) {
    const r = JSON.parse(await s.page.evaluate(PROBE));
    const ok = !r.overflowX && !r.overflowY && !r.overlaps.length && !r.offscreen.length;
    check(ok, `${tag} · ${s.label}${ok ? '' : ` → ${JSON.stringify(r)}`}`);
  }
  const p = JSON.parse(await phone.evaluate(PROBE));
  const ok = !p.overflowX && !p.overlaps.length;
  check(ok, `${tag} · phone 390px${ok ? '' : ` → ${JSON.stringify(p)}`}`);
}

await probeAll('lobby');
host.send({ t: 'host:start', settings: { mode: 'solo', writeSeconds: 30, finalWriteSeconds: 30, voteSeconds: 30, revealSeconds: 30, scoreSeconds: 30 } });

await host.waitFor(s => s.phase === 'writing', 'writing'); await sleep(700);
await probeAll('writing');
await host.waitFor(s => s.phase === 'voting', 'voting'); await sleep(700);
await probeAll('voting');
await host.waitFor(s => s.phase === 'reveal', 'reveal'); await sleep(1400);
await probeAll('reveal');
await host.blitzUntil(s => s.phase === 'scores', 'the round-1 scoreboard'); await sleep(1600);
await probeAll(`scoreboard (${N} rows)`);
host.send({ t: 'host:advance' });
await host.waitFor(s => s.round === 2, 'round 2');
await host.blitzUntil(s => s.round === 3, 'the Last Lash');
await host.blitzUntil(s => s.phase === 'voting', 'the Last Lash vote'); await sleep(900);
await probeAll(`last lash voting (${N} answers)`);
await host.waitFor(s => s.phase === 'reveal', 'the Last Lash reveal'); await sleep(1500);
await probeAll(`last lash reveal (${N} answers)`);
await host.blitzUntil(s => s.phase === 'final', 'the podium'); await sleep(1800);
await probeAll('final podium');

const errs = screens.flatMap(s => s.page.errors).concat(phone.errors);
check(errs.length === 0, errs.length ? `no page errors → ${errs[0]}` : 'no JS errors on any screen');
finish(`ALL LAYOUTS CLEAN (${N} players)`);
