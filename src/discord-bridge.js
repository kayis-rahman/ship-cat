import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID, timingSafeEqual } from 'node:crypto';

const eventTypes = new Set(['discord.message.text', 'discord.interaction', 'discord.voice', 'discord.reaction']);
export function validateEvent(event) {
  return Boolean(event && typeof event.id === 'string' && event.id.length > 0 && event.id.length <= 200 && eventTypes.has(event.type) && event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload) && typeof event.created_at === 'string');
}

export class EventQueue {
  #events = new Map();
  constructor(path) { this.path = path; }
  async load() {
    try {
      const rows = JSON.parse(await readFile(this.path, 'utf8'));
      if (!Array.isArray(rows) || !rows.every(validateEvent)) throw new Error('invalid queue file');
      this.#events = new Map(rows.map(row => [row.id, row]));
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  async #save() { await mkdir(dirname(this.path), { recursive: true }); await writeFile(this.path, JSON.stringify([...this.#events.values()]), { mode: 0o600 }); }
  async append(event) {
    if (!validateEvent(event)) throw new TypeError('invalid event');
    if (this.#events.has(event.id)) return false;
    this.#events.set(event.id, structuredClone(event)); await this.#save(); return true;
  }
  page(since = '', limit = 100) {
    const all = [...this.#events.values()];
    const start = since ? Math.max(0, all.findIndex(e => e.id === since) + 1) : 0;
    const events = all.slice(start, start + limit);
    return { events: structuredClone(events), next_cursor: events.at(-1)?.id ?? since };
  }
  async acknowledge(ids) { for (const id of ids) this.#events.delete(id); await this.#save(); }
}

export function createBridgeServer({ queue, token, host = '127.0.0.1' }) {
  if (!token || Buffer.byteLength(token) < 32) throw new Error('a 32-byte private-network token is required');
  const server = createServer(async (req, res) => {
    const provided = req.headers.authorization?.replace(/^Bearer /, '') ?? '';
    const a = Buffer.from(provided), b = Buffer.from(token);
    if (a.length !== b.length || !timingSafeEqual(a, b)) { res.writeHead(401).end(); return; }
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/v1/events') {
      const limit = Number(url.searchParams.get('limit') ?? 100);
      if (!Number.isInteger(limit) || limit < 1 || limit > 500) { res.writeHead(400).end(); return; }
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(queue.page(url.searchParams.get('since') ?? '', limit))); return;
    }
    if (req.method === 'POST' && url.pathname === '/v1/events/ack') {
      let body = ''; for await (const part of req) { body += part; if (body.length > 16_384) { res.writeHead(413).end(); return; } }
      try { const { ids } = JSON.parse(body); if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string')) throw Error(); await queue.acknowledge(ids); res.writeHead(204).end(); }
      catch { res.writeHead(400).end(); } return;
    }
    res.writeHead(404).end();
  });
  server.listen(0, host);
  return server;
}

export class MacPuller {
  constructor({ baseUrl, token, cursorStore, inboxNote, transcribe, fetchAudio }) {
    this.baseUrl = baseUrl; this.token = token; this.cursorStore = cursorStore;
    this.inboxNote = inboxNote; this.transcribe = transcribe; this.fetchAudio = fetchAudio;
  }
  async poll() {
    let cursor = ''; try { cursor = await readFile(this.cursorStore, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    const headers = { authorization: `Bearer ${this.token}` };
    const response = await fetch(`${this.baseUrl}/v1/events?since=${encodeURIComponent(cursor)}`, { headers });
    if (!response.ok) throw new Error(`bridge returned ${response.status}`);
    const batch = await response.json();
    if (!Array.isArray(batch.events) || typeof batch.next_cursor !== 'string' || !batch.events.every(validateEvent)) throw new Error('invalid bridge response');
    const handled = [];
    for (const event of batch.events) {
      let payload = event.payload;
      if (event.type === 'discord.voice') {
        let audioPath;
        try {
          audioPath = await this.fetchAudio(event);
          const transcript = await this.transcribe(audioPath);
          if (typeof transcript !== 'string' || !transcript.trim()) throw new Error('empty transcript');
          payload = { transcript, source_message_id: event.id };
        } catch (error) {
          payload = { status: 'failed', reason: error.message, source_message_id: event.id };
        } finally { if (audioPath) await rm(audioPath, { force: true }); }
      }
      await this.inboxNote({ requestId: `discord-${event.id}`, type: event.type, payload });
      handled.push(event.id);
    }
    if (handled.length) {
      await writeFile(this.cursorStore, batch.next_cursor, { mode: 0o600 });
      const ack = await fetch(`${this.baseUrl}/v1/events/ack`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ ids: handled }) });
      if (!ack.ok) throw new Error(`bridge acknowledgement returned ${ack.status}`);
    }
    return handled.length;
  }
}

export function syntheticEvent(type, payload = {}) { return { id: randomUUID(), type, payload, created_at: new Date().toISOString() }; }
