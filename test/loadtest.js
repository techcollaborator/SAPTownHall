/**
 * Load tester for a deployed game server.
 *
 *   node test/loadtest.js <wsUrl> <roomCode> <count> <namePrefix> [holdSeconds] [startAtEpochMs] [play]
 *   node test/loadtest.js wss://host/ws ACBW 25 A 240 1790000000000 play
 *
 * Pass `play` and each connection behaves like a real phone — writing a line, voting in its
 * team, judging matchups — so the run measures the traffic an actual game generates rather
 * than idle sockets.
 *
 * Pass startAtEpochMs and the run waits for that instant before connecting, so several
 * processes on different machines can pile on simultaneously and the numbers mean something.
 *
 * Opens `count` real WebSocket connections, staggered like a room filling up, tries to
 * join the room with each, then holds them open and measures ping round-trips. Prints a
 * JSON summary so several runs can be compared or added together.
 */
import WebSocket from 'ws';

const [wsUrl, room, countArg, prefix = 'L', holdArg = '30', startAtArg, playArg] = process.argv.slice(2);
const PLAY = playArg === 'play';
if (!wsUrl || !room) {
  console.error('usage: node test/loadtest.js <wsUrl> <roomCode> <count> <namePrefix> [holdSeconds]');
  process.exit(2);
}
const COUNT = Number(countArg) || 10;
const HOLD_MS = Number(holdArg) * 1000;
const STAGGER_MS = 60;           // ~16 joins a second, close to a real room filling up

const pct = (arr, p) => {
  if (!arr.length) return null;
  const a = arr.slice().sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor((p / 100) * a.length))];
};

const conns = [];
const openMs = [], joinMs = [], stateMs = [], pingMs = [], actMs = [];
const phasesSeen = new Set();
let drafts = 0, picks = 0, votes = 0, rejected = 0;
const errors = new Map();        // message -> count
let opened = 0, joined = 0, refused = 0, failed = 0, closedEarly = 0, statesSeen = 0, bytes = 0;

const note = msg => errors.set(msg, (errors.get(msg) ?? 0) + 1);

function spawnOne(i) {
  const name = `${prefix}${String(i + 1).padStart(3, '0')}`;
  const t0 = Date.now();
  let ws;
  try { ws = new WebSocket(wsUrl); } catch (e) { failed++; note(`construct: ${e.message}`); return; }
  const rec = { ws, name, alive: true, pingSentAt: 0 };
  conns.push(rec);

  ws.on('open', () => {
    opened++;
    openMs.push(Date.now() - t0);
    rec.joinSentAt = Date.now();
    ws.send(JSON.stringify({ t: 'player:join', code: room, name }));
  });

  ws.on('message', raw => {
    bytes += raw.length;
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.t === 'joined') { joined++; joinMs.push(Date.now() - rec.joinSentAt); rec.joined = true; }
    else if (m.t === 'error') {
      if (m.fatal) { refused++; note(m.error); rec.refused = true; }
      else note(`non-fatal: ${m.error}`);
    }
    else if (m.t === 'state') {
      statesSeen++;
      if (!rec.sawState) { rec.sawState = true; stateMs.push(Date.now() - rec.joinSentAt); }
      if (PLAY) play(rec, m.state);
    }
    else if (m.t === 'pong' && rec.pingSentAt) { pingMs.push(Date.now() - rec.pingSentAt); rec.pingSentAt = 0; }
  });

  ws.on('close', () => { rec.alive = false; if (!done) closedEarly++; });
  ws.on('error', e => { failed++; note(`socket: ${e.message}`); });
}

/** Behave like a phone in someone's hand. */
function play(rec, s) {
  phasesSeen.add(s.phase);
  const send = obj => { if (rec.ws.readyState === 1) { rec.acted = Date.now(); rec.ws.send(JSON.stringify(obj)); } };
  const once = key => { if (rec[key]) return false; rec[key] = true; return true; };

  // Write a line for my team.
  if (s.phase === 'drafting' && s.draft && !s.draft.submitted && once(`d${s.round}`)) {
    setTimeout(() => { send({ t: 'draft', text: `${rec.name} reckons it is the interface` }); drafts++; }, 200 + Math.random() * 2500);
  }
  // Vote on my team's shortlist.
  if (s.phase === 'picking' && s.pick && !s.pick.myVote && once(`p${s.round}`)) {
    const other = (s.pick.options ?? []).find(o => !o.mine);
    if (other) setTimeout(() => { send({ t: 'pick', draftId: other.id }); picks++; }, 200 + Math.random() * 2000);
  }
  // Judge a matchup.
  if (s.phase === 'voting' && s.vote?.canVote && !s.vote.myVote && once(`v${s.vote.matchupId}`)) {
    const pick = (s.vote.options ?? []).filter(o => !o.mine);
    const choice = pick[Math.floor(Math.random() * pick.length)];
    if (choice) setTimeout(() => { send({ t: 'vote', matchupId: s.vote.matchupId, targetId: choice.id }); votes++; }, 150 + Math.random() * 1800);
  }
  // Round-trip: how long until the server reflects what we just did.
  if (rec.acted) { actMs.push(Date.now() - rec.acted); rec.acted = 0; }
}

let done = false;
const startDelay = startAtArg ? Math.max(0, Number(startAtArg) - Date.now()) : 0;
if (startDelay > 0) console.error(`waiting ${(startDelay / 1000).toFixed(1)}s for the synchronised start…`);

setTimeout(() => {
  for (let i = 0; i < COUNT; i++) setTimeout(() => spawnOne(i), i * STAGGER_MS);
}, startDelay);

// Ping every 8s while we hold the connections open.
const pinger = setInterval(() => {
  for (const c of conns) {
    if (c.ws.readyState === 1) { c.pingSentAt = Date.now(); c.ws.send(JSON.stringify({ t: 'ping' })); }
  }
}, 8000);

const rampMs = COUNT * STAGGER_MS;
setTimeout(() => {
  done = true;
  clearInterval(pinger);
  const stillOpen = conns.filter(c => c.ws.readyState === 1).length;
  console.log(JSON.stringify({
    prefix, room, requested: COUNT,
    opened, joined, refused, failed, closedEarly, stillOpen,
    statesReceived: statesSeen, bytesReceived: bytes,
    connectMs: { p50: pct(openMs, 50), p95: pct(openMs, 95), max: pct(openMs, 100) },
    joinAckMs: { p50: pct(joinMs, 50), p95: pct(joinMs, 95), max: pct(joinMs, 100) },
    firstStateMs: { p50: pct(stateMs, 50), p95: pct(stateMs, 95), max: pct(stateMs, 100) },
    pingMs: { n: pingMs.length, p50: pct(pingMs, 50), p95: pct(pingMs, 95), max: pct(pingMs, 100) },
    ...(PLAY ? {
      played: { drafts, picks, votes, phasesSeen: [...phasesSeen] },
      serverEchoMs: { n: actMs.length, p50: pct(actMs, 50), p95: pct(actMs, 95), max: pct(actMs, 100) },
      statesPerConn: opened ? +(statesSeen / opened).toFixed(1) : 0,
      kbPerConn: opened ? +((bytes / opened) / 1024).toFixed(1) : 0
    } : {}),
    messages: [...errors.entries()].map(([msg, n]) => `${n}× ${msg}`)
  }, null, 1));
  for (const c of conns) { try { c.ws.close(); } catch { /* going away anyway */ } }
  setTimeout(() => process.exit(0), 400);
}, startDelay + rampMs + HOLD_MS);
