import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { WebSocketServer } from 'ws';
import { RoomManager, loadCustomPrompts } from './src/rooms.js';
import { sanitizeSettings } from './src/game.js';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT) || 3000;
const CUSTOM_FILE = path.join(__dirname, 'prompts.custom.json');

let qrcode = null;
try { qrcode = require('qrcode-generator'); } catch { /* QR is a nice-to-have */ }

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.map': 'application/json'
};

/* ------------------------------------------------------------------ HTTP */

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
    if (url.pathname === '/qr.svg') return sendQr(res, url.searchParams.get('d') ?? '');
    if (url.pathname === '/api/health') return sendJson(res, 200, { ok: true, rooms: rooms.rooms.size });
    if (url.pathname === '/api/net') return sendJson(res, 200, { lan: `${lanAddress()}:${PORT}` });

    let rel = decodeURIComponent(url.pathname);
    if (rel === '/') rel = '/index.html';
    if (rel === '/host') rel = '/host.html';
    if (rel === '/play' || rel === '/join') rel = '/player.html';
    if (!path.extname(rel)) rel += '.html';

    const file = path.join(PUBLIC, path.normalize(rel));
    if (!file.startsWith(PUBLIC)) return sendText(res, 403, 'Nope.');
    const info = await stat(file).catch(() => null);
    if (!info?.isFile()) return sendText(res, 404, 'Not found');

    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(body);
  } catch (err) {
    console.error(err);
    sendText(res, 500, 'Server error');
  }
});

const sendText = (res, code, body) => {
  res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(body);
};
// The pages may be served from Vercel while this runs on Render, so the small JSON
// endpoints must be readable cross-origin. (WebSockets aren't subject to CORS.)
const sendJson = (res, code, obj) => {
  res.writeHead(code, { 'Content-Type': MIME['.json'], 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(obj));
};

function sendQr(res, data) {
  if (!qrcode || !data) return sendText(res, 404, 'no qr');
  const qr = qrcode(0, 'M');
  qr.addData(data.slice(0, 300));
  qr.make();
  const n = qr.getModuleCount();
  let rects = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) rects += `<rect x="${c}" y="${r}" width="1" height="1"/>`;
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 ${n + 2} ${n + 2}" shape-rendering="crispEdges">`
    + `<rect x="-1" y="-1" width="${n + 2}" height="${n + 2}" fill="#fff"/>`
    + `<g fill="#0b0b16">${rects}</g></svg>`;
  res.writeHead(200, { 'Content-Type': MIME['.svg'], 'Cache-Control': 'public, max-age=300' });
  res.end(svg);
}

/* -------------------------------------------------------------- WebSocket */

const dirty = new Set();
let flushQueued = false;

const rooms = new RoomManager({
  onUpdate: room => {
    dirty.add(room);
    if (flushQueued) return;
    flushQueued = true;
    setImmediate(() => { flushQueued = false; for (const r of dirty) broadcast(r); dirty.clear(); });
  }
});

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', ws => {
  ws.ctx = { role: null, code: null, playerId: null };
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    try { handle(ws, msg); } catch (err) { console.error('handler', err); send(ws, { t: 'error', error: 'Something broke.' }); }
  });
  ws.on('close', () => detach(ws));
});

// Drop sockets that vanished without a close frame (phone went to sleep, wifi died).
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 25_000).unref?.();

const send = (ws, obj) => { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); };

function attach(ws, room) {
  const prev = rooms.get(ws.ctx.code);
  if (prev && prev !== room) prev.sockets?.delete(ws);   // never leave a socket in two rooms
  room.sockets ??= new Set();
  room.sockets.add(ws);
  ws.ctx.code = room.code;
}

function detach(ws) {
  const room = rooms.get(ws.ctx.code);
  if (!room) return;
  room.sockets?.delete(ws);
  if (ws.ctx.role === 'player' && ws.ctx.playerId) {
    // Only mark away if no other socket holds this player (covers fast refreshes).
    const stillHere = [...(room.sockets ?? [])].some(s => s.ctx.playerId === ws.ctx.playerId);
    if (!stillHere) room.setConnected(ws.ctx.playerId, false);
  } else if (ws.ctx.role === 'host') {
    broadcast(room);
  }
}

function viewFor(ws, room) {
  return ws.ctx.role === 'host' ? room.hostView() : room.playerView(ws.ctx.playerId);
}

function broadcast(room) {
  for (const ws of room.sockets ?? []) send(ws, { t: 'state', state: viewFor(ws, room) });
}

function handle(ws, msg) {
  const room = rooms.get(ws.ctx.code ?? msg.code);

  switch (msg.t) {
    case 'ping': return send(ws, { t: 'pong', now: Date.now() });

    case 'host:create': {
      const fresh = rooms.create(loadCustomPrompts(CUSTOM_FILE));
      ws.ctx.role = 'host';
      attach(ws, fresh);
      send(ws, { t: 'joined', role: 'host', code: fresh.code });
      return send(ws, { t: 'state', state: fresh.hostView() });
    }

    case 'host:resume': {
      if (!room) return send(ws, { t: 'error', error: 'That room has closed.', fatal: true });
      ws.ctx.role = 'host';
      attach(ws, room);
      send(ws, { t: 'joined', role: 'host', code: room.code });
      return send(ws, { t: 'state', state: room.hostView() });
    }

    case 'player:join': {
      if (!room) return send(ws, { t: 'error', error: 'No room with that code.', fatal: true });
      if (ws.ctx.role === 'host') return send(ws, { t: 'error', error: 'This screen is the host.' });
      const res = room.join(msg.name, msg.token);
      if (!res.ok) return send(ws, { t: 'error', error: res.error, fatal: true });
      // If this socket was already holding a different seat, let that one go.
      if (ws.ctx.playerId && ws.ctx.playerId !== res.player.id) {
        rooms.get(ws.ctx.code)?.setConnected(ws.ctx.playerId, false);
      }
      ws.ctx.role = 'player';
      ws.ctx.playerId = res.player.id;
      attach(ws, room);
      send(ws, { t: 'joined', role: 'player', code: room.code, token: res.token, playerId: res.player.id });
      return send(ws, { t: 'state', state: room.playerView(res.player.id) });
    }

    case 'answer': {
      if (!room || ws.ctx.role !== 'player') return;
      const res = room.submitAnswer(ws.ctx.playerId, msg.matchupId, msg.text);
      if (!res.ok) send(ws, { t: 'error', error: res.error });
      return;
    }

    case 'vote': {
      if (!room || ws.ctx.role !== 'player') return;
      const res = room.submitVote(ws.ctx.playerId, msg.matchupId, msg.targetId);
      if (!res.ok) send(ws, { t: 'error', error: res.error });
      return;
    }

    default: break;
  }

  // Everything below is host-only.
  if (!room || ws.ctx.role !== 'host') return;
  switch (msg.t) {
    case 'host:start': {
      const res = room.start(sanitizeSettings(msg.settings));
      if (!res.ok) send(ws, { t: 'error', error: res.error });
      return;
    }
    case 'host:advance': return room.advance();
    case 'host:lobby': return room.backToLobby();
    case 'host:kick': return room.kick(msg.playerId);
    case 'host:prompts': {
      const lines = String(msg.text ?? '').split('\n').map(s => s.trim()).filter(Boolean);
      room.customPrompts = lines.slice(0, 500);
      return room.touch();
    }
    case 'host:settings': {
      room.settings = { ...room.settings, ...sanitizeSettings(msg.settings) };
      return room.touch();
    }
    default: return;
  }
}

/* ----------------------------------------------------------------- listen */

/** The address phones should type in. Prefers real wifi/ethernet over VPN tunnels. */
function lanAddress() {
  const candidates = [];
  for (const [name, list] of Object.entries(networkInterfaces())) {
    for (const net of list ?? []) {
      if (net.family !== 'IPv4' || net.internal) continue;
      const priv = /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(net.address);
      const physical = /^(en|eth|wlan|wl)\d/.test(name);
      candidates.push({ address: net.address, score: (priv ? 2 : 0) + (physical ? 1 : 0) });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.address ?? 'localhost';
}

server.listen(PORT, () => {
  const lan = lanAddress();
  const customCount = loadCustomPrompts(CUSTOM_FILE).length;
  console.log('');
  console.log('  ⚡  QUIPLASH CLONE is live');
  console.log('  ─────────────────────────────────────────────');
  console.log(`  Host screen (this computer): http://localhost:${PORT}/host`);
  console.log(`  Players (phones, same wifi): http://${lan}:${PORT}`);
  if (customCount) console.log(`  Loaded ${customCount} custom prompts from prompts.custom.json`);
  console.log('');
});
