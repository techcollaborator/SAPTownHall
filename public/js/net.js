/* Shared client plumbing: socket with auto-reconnect, DOM helpers, timers. */
import { BACKEND_URL } from './config.js';

/** URL of something on the game server — same origin locally, Render when deployed. */
export const backend = path => `${BACKEND_URL}${path}`;
/** True when the pages and the game server are deployed in different places. */
export const SPLIT_DEPLOY = !!BACKEND_URL;

function socketUrl() {
  if (BACKEND_URL) return BACKEND_URL.replace(/^http/, 'ws') + '/ws';
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
}

export function createSocket({ onState, onJoined, onError, onStatus, hello }) {
  let ws = null, attempts = 0, closed = false, clockOffset = 0;
  const queue = [];

  function open() {
    onStatus?.(attempts ? 'reconnecting' : 'connecting');
    ws = new WebSocket(socketUrl());

    ws.onopen = () => {
      attempts = 0;
      onStatus?.('online');
      const greeting = hello?.();
      if (greeting) ws.send(JSON.stringify(greeting));
      while (queue.length) ws.send(JSON.stringify(queue.shift()));
    };

    ws.onmessage = ev => {
      const msg = JSON.parse(ev.data);
      if (msg.t === 'state') {
        if (msg.state?.serverNow) clockOffset = msg.state.serverNow - Date.now();
        onState?.(msg.state);
      } else if (msg.t === 'joined') onJoined?.(msg);
      else if (msg.t === 'error') onError?.(msg);
    };

    ws.onclose = () => {
      if (closed) return;
      onStatus?.('offline');
      attempts++;
      setTimeout(open, Math.min(500 * attempts, 4000));
    };
    ws.onerror = () => {};
  }

  open();
  const api = {
    send(obj) { if (ws?.readyState === 1) ws.send(JSON.stringify(obj)); else queue.push(obj); },
    stop() { closed = true; ws?.close(); },
    drop() { ws?.close(); },                      // pretend the wifi died (debugging + tests)
    get state() { return ws?.readyState ?? -1; },
    now: () => Date.now() + clockOffset
  };
  window.__quipsmash = api;                       // handle for poking at a live game from devtools
  return api;
}

/* ---------- DOM ---------- */

export const $ = sel => document.querySelector(sel);

export function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.setAttribute('style', v);
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

export const clear = el => { while (el.firstChild) el.removeChild(el.firstChild); return el; };

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Renders a prompt, turning <BLANK> into a styled fill-in slot. */
export function promptHtml(text) {
  return esc(text).replace(/&lt;BLANK&gt;/g, '<span class="blank">________</span>');
}

let toastTimer;
export function toast(text) {
  let box = $('#toast');
  if (!box) { box = h('div', { id: 'toast' }); document.body.append(box); }
  box.textContent = text;
  box.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => box.classList.remove('show'), 2600);
}

/* ---------- countdown ---------- */

export function startTicker(getState, render) {
  let raf, last = -1;
  const loop = () => {
    const st = getState();
    if (st?.deadline) {
      const left = Math.max(0, Math.ceil((st.deadline - st.now()) / 1000));
      if (left !== last) { last = left; render(left, st.total ?? null); }
    } else if (last !== -1) { last = -1; render(null, null); }
    raf = requestAnimationFrame(loop);
  };
  loop();
  return () => cancelAnimationFrame(raf);
}

export function paintTimer(barEl, clockEl, left, total) {
  if (left == null) {
    barEl?.parentElement?.classList.add('hidden');
    if (clockEl) { clockEl.textContent = ''; clockEl.classList.remove('low'); }
    return;
  }
  barEl?.parentElement?.classList.remove('hidden');
  const pct = total ? Math.max(0, Math.min(100, (left / total) * 100)) : 100;
  if (barEl) barEl.style.width = `${pct}%`;
  barEl?.parentElement?.classList.toggle('low', left <= 10);
  if (clockEl) {
    clockEl.textContent = left;
    clockEl.classList.toggle('low', left <= 10);
  }
}

/* ---------- little WebAudio blips (no asset files) ---------- */

let actx;
export function blip(freq = 660, ms = 110, type = 'triangle', gain = 0.06) {
  try {
    actx ??= new (window.AudioContext || window.webkitAudioContext)();
    const osc = actx.createOscillator(), amp = actx.createGain();
    osc.type = type; osc.frequency.value = freq;
    amp.gain.value = gain;
    osc.connect(amp).connect(actx.destination);
    const t = actx.currentTime;
    amp.gain.setValueAtTime(gain, t);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
    osc.start(t); osc.stop(t + ms / 1000);
  } catch { /* audio is optional */ }
}
export const fanfare = () => [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => blip(f, 220, 'square', .05), i * 110));
