import { readFileSync, existsSync } from 'node:fs';
import { Room } from './game.js';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O — too easy to misread on a TV
const IDLE_MS = 20 * 60 * 1000;

export class RoomManager {
  constructor({ onUpdate }) {
    this.rooms = new Map();
    this.onUpdate = onUpdate;
    setInterval(() => this.sweep(), 60_000).unref?.();
  }

  create(customPrompts = []) {
    let code;
    do { code = Array.from({ length: 4 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join(''); }
    while (this.rooms.has(code));
    const room = new Room(code, { onUpdate: r => this.onUpdate(r), customPrompts });
    this.rooms.set(code, room);
    return room;
  }

  get(code) { return this.rooms.get(String(code ?? '').toUpperCase().trim()); }

  sweep() {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      const busy = room.sockets?.size > 0 || room.active.length > 0;
      room.lastSeen = busy ? now : (room.lastSeen ?? room.createdAt);
      if (!busy && now - room.lastSeen > IDLE_MS) {
        room.destroy();
        this.rooms.delete(code);
      }
    }
  }
}

export function loadCustomPrompts(file) {
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    const list = Array.isArray(parsed) ? parsed : parsed.prompts;
    return (list ?? []).map(s => String(s).trim()).filter(Boolean);
  } catch (err) {
    console.warn(`[quiplash] could not read ${file}: ${err.message}`);
    return [];
  }
}
