/* Shared test plumbing: child processes that always get cleaned up, a tiny CDP client,
   game clients, and a check/report helper.

   Every spawned process is tracked and killed on exit — including on a throw. Leaking a
   headless browser or a server holding stderr open is what hangs a test run. */
import { spawn } from 'node:child_process';
import { rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import WebSocket from 'ws';

export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const log = (...a) => console.log('  ', ...a);

/* ------------------------------------------------------- process bookkeeping */

const kids = new Set();
const sockets = new Set();
let reaped = false;

function reap() {
  if (reaped) return;
  reaped = true;
  for (const ws of sockets) { try { ws.terminate(); } catch { /* already gone */ } }
  for (const p of kids) { try { p.kill('SIGKILL'); } catch { /* already gone */ } }
  kids.clear(); sockets.clear();
}
process.on('exit', reap);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { reap(); process.exit(130); });
process.on('uncaughtException', err => { console.error('  ✗ test crashed:', err?.stack ?? err); reap(); process.exit(1); });
process.on('unhandledRejection', err => { console.error('  ✗ unhandled rejection:', err?.stack ?? err); reap(); process.exit(1); });

function track(proc) {
  kids.add(proc);
  proc.on('exit', () => kids.delete(proc));
  return proc;
}

/* ------------------------------------------------------------------- server */

export function startServer(port, { quiet = true } = {}) {
  // stdio must not be 'inherit': a surviving child would hold the parent's stderr open
  // and any pipe reading this run would never see EOF.
  const proc = track(spawn(process.execPath, ['server.js'], {
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe']
  }));
  proc.stderr.on('data', d => { if (!quiet) process.stderr.write(`  [server] ${d}`); });
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('server never came up')), 15_000);
    proc.stdout.on('data', d => { if (String(d).includes('live')) { clearTimeout(t); res(proc); } });
  });
}

/* ------------------------------------------------------------------ browser */

const EDGE = process.env.QS_BROWSER ?? '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';

export async function startBrowser({ cdpPort, profile }) {
  rmSync(profile, { recursive: true, force: true });
  track(spawn(EDGE, [
    '--headless=new', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars',
    '--force-device-scale-factor=1', '--mute-audio', 'about:blank'
  ], { stdio: 'ignore' }));

  let version = null;
  for (let i = 0; i < 60 && !version; i++) {
    version = await fetch(`http://127.0.0.1:${cdpPort}/json/version`).then(r => r.json()).catch(() => null);
    if (!version) await sleep(250);
  }
  if (!version) throw new Error(`no headless browser at ${EDGE} — set QS_BROWSER to a Chromium-family binary`);

  return {
    name: version.Browser,
    async open(url, { width = 1440, height = 900, mobile = false } = {}) {
      const target = await fetch(`http://127.0.0.1:${cdpPort}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })
        .then(r => r.json());
      return Page.attach(target.webSocketDebuggerUrl, { width, height, mobile });
    }
  };
}

class Page {
  constructor(ws) { this.ws = ws; this._id = 0; this._pending = new Map(); this.errors = []; }

  static async attach(wsUrl, { width, height, mobile }) {
    const ws = new WebSocket(wsUrl, { maxPayload: 256 * 1024 * 1024 });
    sockets.add(ws);
    await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
    const page = new Page(ws);
    ws.on('message', raw => {
      const m = JSON.parse(raw);
      if (m.id && page._pending.has(m.id)) { page._pending.get(m.id)(m.result ?? m); page._pending.delete(m.id); }
      if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params.exceptionDetails;
        page.errors.push(`${d.text} ${d.exception?.description ?? ''}`.trim());
      }
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        page.errors.push(m.params.args.map(a => a.value ?? a.description).join(' '));
      }
    });
    await page.send('Runtime.enable');
    await page.send('Page.enable');
    await page.send('Network.enable');
    await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
    await sleep(800);
    return page;
  }

  send(method, params = {}) {
    const id = ++this._id;
    return new Promise(res => { this._pending.set(id, res); this.ws.send(JSON.stringify({ id, method, params })); });
  }

  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    return r?.result?.value;
  }
  json(expression) { return this.evaluate(`JSON.stringify(${expression})`).then(s => (s ? JSON.parse(s) : null)); }
  text(sel) { return this.evaluate(`document.querySelector(${JSON.stringify(sel)})?.innerText ?? ''`); }
  body() { return this.evaluate('document.body.innerText'); }
  click(sel) { return this.evaluate(`document.querySelector(${JSON.stringify(sel)})?.click(), true`); }
  type(sel, value) {
    return this.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)});
      if (!el) return false; el.value = ${JSON.stringify(value)};
      el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  }
  offline(on) {
    return this.send('Network.emulateNetworkConditions',
      { offline: on, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  }
  async reload() { await this.send('Page.reload'); await sleep(1400); }
  async shot(file) {
    // A backgrounded tab has its rendering throttled, so a screenshot of it can show a
    // half-finished layout even though the DOM measures fine. Bring it forward first.
    await this.send('Page.bringToFront');
    await sleep(250);
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' });
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, Buffer.from(data, 'base64'));
    return file;
  }
}

/* -------------------------------------------------------------- game client */

export function connect(port, onMsg = () => {}) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  sockets.add(ws);
  ws.on('message', raw => onMsg(JSON.parse(raw), ws));
  ws.on('error', () => {});
  return new Promise(res => ws.on('open', () => res({
    ws, send: o => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); }
  })));
}

/** A host screen driven from Node. `.state` is always the latest host view. */
export async function startHost(port) {
  const host = { state: null, code: null, reveals: [], phases: new Set() };
  host.conn = await connect(port, m => {
    if (m.t === 'joined') host.code = m.code;
    if (m.t === 'error') log('host error:', m.error);
    if (m.t !== 'state') return;
    const prev = host.state?.phase;
    host.state = m.state;
    if (m.state.phase !== prev) {
      host.phases.add(m.state.phase);
      if (m.state.phase === 'reveal' && m.state.reveal) host.reveals.push(m.state.reveal);
    }
  });
  host.send = o => host.conn.send(o);
  host.conn.send({ t: 'host:create' });
  for (let i = 0; i < 60 && !host.code; i++) await sleep(50);
  if (!host.code) throw new Error('host never got a room code');

  host.waitFor = async (pred, label = 'condition', ms = 60_000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (pred(host.state)) return host.state; await sleep(80); }
    throw new Error(`timed out waiting for ${label} (stuck in ${host.state?.phase} round ${host.state?.round})`);
  };
  /** Bang on the skip button until we arrive somewhere. */
  host.blitzUntil = async (pred, label = 'target', ms = 60_000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (pred(host.state)) return host.state;
      host.send({ t: 'host:advance' });
      await sleep(330);
    }
    throw new Error(`could not skip to ${label} (stuck in ${host.state?.phase} round ${host.state?.round})`);
  };
  return host;
}

/**
 * A bot player. `answer` and `vote` may be false (never acts) or functions.
 *   answer: (item, state) => string | null
 *   vote:   (choices, state) => choice | null      // choices excludes their own answer
 */
export async function joinBot(port, code, name, {
  answer = () => `${name} wrote something`,
  vote = choices => choices[0],
  pace = () => 40,
  onState = null
} = {}) {
  const bot = { name, seen: new Set(), writeCounts: [], token: null, state: null };
  const handler = (m, ws) => {
    if (m.t === 'joined' && m.token) bot.token = m.token;
    if (m.t === 'error') bot.lastError = m.error;
    if (m.t !== 'state') return;
    const s = m.state;
    bot.state = s;

    if (s.phase === 'writing' && s.write) {
      if (bot.writeCounts[s.round] == null) bot.writeCounts[s.round] = s.write.length;
      if (answer) for (const item of s.write) {
        if (item.submitted || bot.seen.has(item.matchupId)) continue;
        bot.seen.add(item.matchupId);
        const text = answer(item, s);
        if (text) setTimeout(() => bot.conn.send({ t: 'answer', matchupId: item.matchupId, text }), pace());
      }
    }
    if (vote && s.phase === 'voting' && s.vote?.canVote && !s.vote.myVote && !bot.seen.has(`v${s.vote.matchupId}`)) {
      bot.seen.add(`v${s.vote.matchupId}`);
      const choice = vote(s.vote.options.filter(o => !o.mine), s);
      if (choice) setTimeout(() => bot.conn.send({ t: 'vote', matchupId: s.vote.matchupId, targetId: choice.id }), pace());
    }
    onState?.(s, bot, ws);
  };
  bot.handler = handler;
  bot.conn = await connect(port, handler);
  bot.conn.send({ t: 'player:join', code, name });
  /** Reconnect on the same token, as a phone would after a dropout. */
  bot.rejoin = async () => {
    bot.conn = await connect(port, handler);
    bot.conn.send({ t: 'player:join', code, name, token: bot.token });
  };
  return bot;
}

/* --------------------------------------------------------------- reporting */

export function reporter() {
  const failures = [];
  return {
    check(cond, label) { if (!cond) failures.push(label); log(`${cond ? '✓' : '✗'} ${label}`); return !!cond; },
    get failures() { return failures; },
    finish(okMessage = 'ALL CHECKS PASSED') {
      console.log('');
      console.log(failures.length ? `  FAILED (${failures.length}):\n     ${failures.join('\n     ')}` : `  ${okMessage}`);
      reap();
      process.exit(failures.length ? 1 : 0);
    }
  };
}
