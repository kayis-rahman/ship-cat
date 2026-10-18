import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, rm, rename, mkdtemp } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';

const voiceMessageFlag = 1 << 13;
const eventTypes = new Set(['discord.message.text', 'discord.voice']);
const payloadKeys = ['channel_id', 'human_author', 'timestamp', 'message_text'];
const mlxAdapterPath = fileURLToPath(new URL('./mlx-transcribe.py', import.meta.url));

export function validateEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event) || Object.keys(event).sort().join(',') !== 'id,payload,type') return false;
  if (typeof event.id !== 'string' || !event.id || event.id.length > 200 || !eventTypes.has(event.type)) return false;
  const payload = event.payload;
  return Boolean(payload && typeof payload === 'object' && !Array.isArray(payload) &&
    Object.keys(payload).sort().join(',') === [...payloadKeys].sort().join(',') &&
    typeof payload.channel_id === 'string' && payload.channel_id.length > 0 && payload.channel_id.length <= 200 &&
    typeof payload.human_author === 'boolean' &&
    typeof payload.timestamp === 'string' && Number.isFinite(Date.parse(payload.timestamp)) &&
    typeof payload.message_text === 'string' && payload.message_text.length <= 2000 &&
    (event.type !== 'discord.voice' || (payload.human_author && payload.message_text === '')));
}

async function atomicWrite(path, contents) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, contents, { mode: 0o600, flag: 'wx' });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

export class EventQueue {
  #events = new Map();
  #ids = new Set();
  #mutationTail = Promise.resolve();
  constructor(path) { this.path = path; }
  async load() {
    try {
      const state = JSON.parse(await readFile(this.path, 'utf8'));
      if (!state || !Array.isArray(state.events) || !Array.isArray(state.ids) || !state.events.every(validateEvent) || !state.ids.every(id => typeof id === 'string' && id.length > 0 && id.length <= 200)) throw new Error('invalid queue file');
      const ids = new Set(state.ids);
      if (ids.size !== state.ids.length) throw new Error('invalid queue file');
      if (state.events.some(event => !ids.has(event.id))) throw new Error('invalid queue file');
      this.#events = new Map(state.events.map(event => [event.id, event]));
      this.#ids = ids;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  async #persist(events, ids) {
    await atomicWrite(this.path, JSON.stringify({ events: [...events.values()], ids: [...ids] }));
  }
  #serialize(operation) {
    const result = this.#mutationTail.then(operation);
    this.#mutationTail = result.catch(() => {});
    return result;
  }
  async append(event) {
    if (!validateEvent(event)) throw new TypeError('invalid event');
    const record = structuredClone(event);
    if (!validateEvent(record)) throw new TypeError('invalid event');
    return this.#serialize(async () => {
      if (this.#ids.has(record.id)) return false;
      const events = new Map(this.#events);
      const ids = new Set(this.#ids);
      events.set(record.id, record);
      ids.add(record.id);
      await this.#persist(events, ids);
      this.#events = events;
      this.#ids = ids;
      return true;
    });
  }
  page(since = '', limit = 100) {
    const all = [...this.#events.values()];
    const start = since ? Math.max(0, all.findIndex(event => event.id === since) + 1) : 0;
    const events = all.slice(start, start + limit);
    return { events: structuredClone(events), next_cursor: events.at(-1)?.id ?? since };
  }
  voiceEvent(id) {
    const event = this.#events.get(id);
    return event?.type === 'discord.voice' ? structuredClone(event) : null;
  }
  async acknowledge(ids) {
    if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string' || id.length === 0 || id.length > 200)) throw new TypeError('invalid acknowledgement IDs');
    const messageIds = [...ids];
    return this.#serialize(async () => {
      const events = new Map(this.#events);
      const seenIds = new Set(this.#ids);
      for (const id of messageIds) events.delete(id);
      await this.#persist(events, seenIds);
      this.#events = events;
      this.#ids = seenIds;
    });
  }
}

function normalizedAddress(address) {
  return typeof address === 'string' && address.startsWith('[') && address.endsWith(']') ? address.slice(1, -1) : address;
}
function isPrivateAddress(address) {
  address = normalizedAddress(address);
  const version = isIP(address);
  if (version === 4) {
    const [a, b] = address.split('.').map(Number);
    return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  return version === 6 && /^(fc|fd)/i.test(address);
}
function isLoopback(address) {
  address = normalizedAddress(address);
  return address === '::1' || (isIP(address) === 4 && address.startsWith('127.'));
}
function validateToken(token) {
  if (typeof token !== 'string' || Buffer.byteLength(token) < 32) throw new Error('a runtime-injected token of at least 32 bytes is required');
}
function permittedBridgeAddress(address) {
  return typeof address === 'string' && isIP(normalizedAddress(address)) !== 0 && (isLoopback(address) || isPrivateAddress(address));
}
function permittedAudioUrl(value) {
  const url = new URL(value);
  return url.protocol === 'https:' && ['cdn.discordapp.com', 'media.discordapp.net'].includes(url.hostname);
}

export function createBridgeServer({ queue, token, host = '127.0.0.1', port = 8765, resolveVoiceAttachment, audioFetch = fetch, privateBind = false }) {
  validateToken(token);
  if (!permittedBridgeAddress(host) || (privateBind && (isLoopback(host) || !isPrivateAddress(host)))) throw new Error('bridge host must be an explicit private-network IP address');
  if (!Number.isInteger(port) || port < 0 || port > 65535 || (port === 0 && !isLoopback(host))) throw new Error('bridge port must be between 1 and 65535, except ephemeral loopback tests');
  const server = createServer(async (req, res) => {
    const provided = req.headers.authorization?.replace(/^Bearer /, '') ?? '';
    const a = Buffer.from(provided), b = Buffer.from(token);
    if (a.length !== b.length || !timingSafeEqual(a, b)) { res.writeHead(401).end(); return; }
    const url = new URL(req.url, 'http://localhost');
    const audioMatch = req.method === 'GET' && url.pathname.match(/^\/v1\/events\/([^/]+)\/audio$/);
    if (audioMatch) {
      const id = decodeURIComponent(audioMatch[1]);
      const event = queue.voiceEvent(id);
      if (!event || !resolveVoiceAttachment) { res.writeHead(404).end(); return; }
      let response;
      try {
        const source = await resolveVoiceAttachment(event);
        if (!source) { console.warn('Discord voice source missing; dropping event'); res.writeHead(410).end(); return; }
        if (!permittedAudioUrl(source)) { res.writeHead(404).end(); return; }
        response = await audioFetch(source);
        if (response.status === 404) { console.warn('Discord voice source missing; dropping event'); res.writeHead(410).end(); return; }
        if (!response.ok || !response.body || !response.headers.get('content-type')?.toLowerCase().startsWith('audio/')) { res.writeHead(502).end(); return; }
        res.writeHead(200, { 'content-type': response.headers.get('content-type'), 'cache-control': 'no-store' });
        await pipeline(response.body, res);
      } catch { if (!res.headersSent) res.writeHead(502).end(); else res.destroy(); }
      return;
    }
    if (req.method === 'GET' && url.pathname === '/v1/events') {
      const limit = Number(url.searchParams.get('limit') ?? 100);
      if (!Number.isInteger(limit) || limit < 1 || limit > 500) { res.writeHead(400).end(); return; }
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(queue.page(url.searchParams.get('since') ?? '', limit))); return;
    }
    if (req.method === 'POST' && url.pathname === '/v1/events/ack') {
      let body = ''; for await (const part of req) { body += part; if (body.length > 16_384) { res.writeHead(413).end(); return; } }
      let ids;
      try {
        ({ ids } = JSON.parse(body));
        if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string')) throw Error();
      } catch { res.writeHead(400).end(); return; }
      try { await queue.acknowledge(ids); }
      catch { res.writeHead(500).end(); return; }
      res.writeHead(204).end();
      return;
    }
    res.writeHead(404).end();
  });
  server.listen(port, host);
  return server;
}

export class DiscordEventSource extends EventEmitter {
  constructor({ client, queue, captainUserId }) {
    super();
    if (!client || typeof client.on !== 'function' || typeof client.removeListener !== 'function') throw new TypeError('an authenticated Discord event client is required');
    if (typeof captainUserId !== 'string' || captainUserId.length === 0) throw new TypeError('captain user ID is required for voice authorization');
    this.client = client;
    this.queue = queue;
    this.captainUserId = captainUserId;
    this.listener = message => { this.ingest(message).catch(error => this.emit('sourceError', error)); };
  }
  start() { this.client.on('messageCreate', this.listener); return this; }
  stop() { this.client.removeListener('messageCreate', this.listener); }
  async ingest(message) {
    const authorId = message?.author?.id;
    if (typeof authorId !== 'string' || typeof message?.author?.bot !== 'boolean') return false;
    const isVoice = Boolean((Number(message?.flags?.bitfield ?? message?.flags) & voiceMessageFlag) !== 0);
    const humanAuthor = !message.author.bot;
    if (isVoice && (!humanAuthor || authorId !== this.captainUserId)) return false;
    const id = message?.id;
    const channelId = message?.channelId ?? message?.channel?.id;
    const date = message?.createdAt instanceof Date ? message.createdAt : new Date(message?.createdTimestamp ?? message?.createdAt ?? NaN);
    const timestamp = Number.isNaN(date.getTime()) ? '' : date.toISOString();
    const content = typeof message?.content === 'string' ? message.content : '';
    const event = { id, type: isVoice ? 'discord.voice' : 'discord.message.text', payload: { channel_id: channelId, human_author: humanAuthor, timestamp, message_text: isVoice ? '' : content } };
    if (!validateEvent(event)) return false;
    if (isVoice) {
      const attachment = [...(message.attachments?.values?.() ?? [])].find(item => typeof item.contentType === 'string' && item.contentType.toLowerCase().startsWith('audio/'));
      if (!attachment || typeof attachment.url !== 'string' || !permittedAudioUrl(attachment.url)) return false;
    }
    return this.queue.append(event);
  }
  async resolveVoiceAttachment(event) {
    if (!validateEvent(event) || event.type !== 'discord.voice' || !event.payload.human_author) return null;
    let channel;
    let message;
    try {
      channel = await this.client.channels?.fetch(event.payload.channel_id, { force: true });
      if (!channel?.messages?.fetch) return null;
      message = await channel.messages.fetch({ message: event.id, force: true });
    } catch (error) {
      if (error?.status === 404 || [10003, 10008].includes(error?.code)) return null;
      throw error;
    }
    const authorId = message?.author?.id;
    const voice = Boolean((Number(message?.flags?.bitfield ?? message?.flags) & voiceMessageFlag) !== 0);
    if (!voice || message.id !== event.id || (message.channelId ?? message.channel?.id) !== event.payload.channel_id || message.author?.bot || authorId !== this.captainUserId) return null;
    const attachment = [...(message.attachments?.values?.() ?? [])].find(item => typeof item.contentType === 'string' && item.contentType.toLowerCase().startsWith('audio/'));
    return attachment && typeof attachment.url === 'string' && permittedAudioUrl(attachment.url) ? attachment.url : null;
  }
}

export class LocalMLXTranscriber {
  constructor(modelPath) {
    if (typeof modelPath !== 'string' || !isAbsolute(modelPath)) throw new TypeError('an absolute local MLX model directory is required');
    this.modelPath = modelPath;
  }
  async validate() {
    const { stat } = await import('node:fs/promises');
    const model = await stat(this.modelPath);
    if (!model.isDirectory()) throw new Error('local MLX model path must be a directory');
  }
  async transcribe(audioPath) {
    await this.validate();
    const env = { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', TMPDIR: process.env.TMPDIR ?? '', PYTHONPATH: process.env.PYTHONPATH ?? '' };
    const { stdout } = await new Promise((resolve, reject) => {
      const child = spawn('python3', [mlxAdapterPath, audioPath, this.modelPath], { env, stdio: ['ignore', 'pipe', 'ignore'] });
      let output = '';
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', chunk => { output += chunk; if (Buffer.byteLength(output) > 1_000_000) child.kill(); });
      child.once('error', reject);
      child.once('close', code => code === 0 ? resolve({ stdout: output }) : reject(new Error(`local MLX transcription exited ${code}`)));
    });
    const transcript = stdout.trim();
    if (!transcript) throw new Error('local MLX returned an empty transcript');
    return transcript;
  }
}

export function runHandoff(command, payload, spawnProcess = spawn) {
  return new Promise((resolve, reject) => {
    const child = spawnProcess(command, [], { stdio: ['pipe', 'ignore', 'ignore'] });
    let settled = false;
    const fail = error => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(error);
    };
    child.once('error', fail);
    child.stdin.once('error', fail);
    child.once('close', code => {
      if (settled) return;
      settled = true;
      if (code === 0) resolve();
      else reject(new Error(`local handoff exited ${code}`));
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

async function downloadAudio(baseUrl, token, id, directory) {
  const response = await fetch(`${baseUrl}/v1/events/${encodeURIComponent(id)}/audio`, { headers: { authorization: `Bearer ${token}` } });
  if (response.status === 410) return null;
  if (!response.ok || !response.body || !response.headers.get('content-type')?.toLowerCase().startsWith('audio/')) throw new Error('voice audio unavailable from bridge');
  const audioPath = join(directory, 'voice-audio');
  await pipeline(response.body, createWriteStream(audioPath, { mode: 0o600, flags: 'wx' }));
  return audioPath;
}

export class MacPuller {
  constructor({ baseUrl, token, cursorStore, handoffCommand, mlxModelPath, allowLoopback = false }) {
    validateToken(token);
    const endpoint = new URL(baseUrl);
    if (endpoint.protocol !== 'http:' || endpoint.username || endpoint.password || endpoint.port === '' || !permittedBridgeAddress(endpoint.hostname) || (!allowLoopback && isLoopback(endpoint.hostname))) throw new Error('bridge URL must use HTTP to a private-network IP and explicit port');
    if (handoffCommand !== undefined && (typeof handoffCommand !== 'string' || !isAbsolute(handoffCommand))) throw new Error('handoff command must be an explicitly configured absolute path');
    this.baseUrl = endpoint.origin;
    this.token = token;
    this.cursorStore = cursorStore;
    this.handoffCommand = handoffCommand;
    this.transcriber = mlxModelPath ? new LocalMLXTranscriber(mlxModelPath) : null;
  }
  async poll() {
    if (!this.handoffCommand) return 0;
    let cursor = '';
    try { cursor = await readFile(this.cursorStore, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const headers = { authorization: `Bearer ${this.token}` };
    const response = await fetch(`${this.baseUrl}/v1/events?since=${encodeURIComponent(cursor)}`, { headers });
    if (!response.ok) throw new Error(`bridge returned ${response.status}`);
    const batch = await response.json();
    if (!Array.isArray(batch.events) || typeof batch.next_cursor !== 'string' || !batch.events.every(validateEvent)) throw new Error('invalid bridge response');
    const handled = [];
    for (const event of batch.events) {
      const payload = { message_id: event.id, ...event.payload };
      if (event.type === 'discord.voice') {
        if (!this.transcriber) throw new Error('local MLX model path is not configured');
        await this.transcriber.validate();
        const directory = await mkdtemp(join(tmpdir(), 'shipcat-mlx-'));
        try {
          const audioPath = await downloadAudio(this.baseUrl, this.token, event.id, directory);
          if (!audioPath) { handled.push(event.id); continue; }
          payload.message_text = await this.transcriber.transcribe(audioPath);
          await rm(audioPath, { force: true });
        } finally { await rm(directory, { recursive: true, force: true }); }
      }
      await runHandoff(this.handoffCommand, payload);
      handled.push(event.id);
    }
    if (handled.length) {
      const ack = await fetch(`${this.baseUrl}/v1/events/ack`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ ids: handled }) });
      if (!ack.ok) throw new Error(`bridge acknowledgement returned ${ack.status}`);
      await atomicWrite(this.cursorStore, batch.next_cursor);
    }
    return handled.length;
  }
}

export function syntheticEvent(type, payload = {}) {
  return { id: randomUUID(), type, payload: { channel_id: payload.channel_id ?? 'channel-test', human_author: payload.human_author ?? true, timestamp: payload.timestamp ?? new Date().toISOString(), message_text: payload.message_text ?? '' } };
}
