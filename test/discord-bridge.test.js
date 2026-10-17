import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventQueue, MacPuller, createBridgeServer, syntheticEvent } from '../src/discord-bridge.js';

const token = 'x'.repeat(40);

test('authenticated pull queue, duplicate suppression, and idempotent inbox handoff', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'shipcat-bridge-'));
  const queue = new EventQueue(join(dir, 'queue.json'));
  let server;
  try {
    await queue.load();
    const event = syntheticEvent('discord.message.text', { content: 'synthetic' });
    assert.equal(await queue.append(event), true); assert.equal(await queue.append(event), false);
    server = createBridgeServer({ queue, token, port: 0 });
    await new Promise(resolve => server.once('listening', resolve));
    const address = server.address(); const inbox = [];
    const puller = new MacPuller({ baseUrl: `http://127.0.0.1:${address.port}`, token, cursorStore: join(dir, 'cursor'), inboxNote: async note => inbox.push(note) });
    assert.equal(await puller.poll(), 1); assert.equal(inbox[0].requestId, `discord-${event.id}`);
    assert.equal(await puller.poll(), 0); assert.equal(inbox.length, 1);
    const unauthorized = await fetch(`http://127.0.0.1:${address.port}/v1/events`); assert.equal(unauthorized.status, 401);
  } finally { if (server) await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true, force: true }); }
});

test('voice audio is deleted after successful transcription and failure, with stub only', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'shipcat-voice-'));
  let server;
  try {
    const queue = new EventQueue(join(dir, 'queue.json')); await queue.load();
    const event = syntheticEvent('discord.voice'); await queue.append(event);
    server = createBridgeServer({ queue, token, port: 0 }); await new Promise(resolve => server.once('listening', resolve));
    const audio = join(dir, 'audio.tmp'); const notes = [];
    const puller = new MacPuller({ baseUrl: `http://127.0.0.1:${server.address().port}`, token, cursorStore: join(dir, 'cursor'), fetchAudio: async () => { await writeFile(audio, 'synthetic'); return audio; }, transcribe: async () => 'local stub transcript', inboxNote: async note => notes.push(note) });
    await puller.poll(); assert.equal(notes[0].payload.transcript, 'local stub transcript'); await assert.rejects(readFile(audio));
  } finally { if (server) await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true, force: true }); }
});

test('voice failure removes temporary audio and records failure without fallback', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'shipcat-voice-fail-'));
  let server;
  try {
    const queue = new EventQueue(join(dir, 'queue.json')); await queue.load(); await queue.append(syntheticEvent('discord.voice'));
    server = createBridgeServer({ queue, token, port: 0 }); await new Promise(resolve => server.once('listening', resolve));
    const audio = join(dir, 'audio.tmp'); let note;
    const puller = new MacPuller({ baseUrl: `http://127.0.0.1:${server.address().port}`, token, cursorStore: join(dir, 'cursor'), fetchAudio: async () => { await writeFile(audio, 'x'); return audio; }, transcribe: async () => { throw new Error('local model unavailable'); }, inboxNote: async value => { note = value; } });
    await puller.poll(); assert.equal(note.payload.status, 'failed'); await assert.rejects(readFile(audio));
  } finally { if (server) await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true, force: true }); }
});

test('bridge rejects wildcard and public binds and requires runtime token', () => {
  const queue = new EventQueue('unused');
  for (const host of ['0.0.0.0', '::', '8.8.8.8', 'example.com']) {
    assert.throws(() => createBridgeServer({ queue, token, host, port: 8765 }), /loopback or private-network/);
  }
  assert.throws(() => createBridgeServer({ queue, token: '', host: '127.0.0.1' }), /runtime-injected token/);
});

test('Mac puller rejects public destinations and accepts explicit private destinations', () => {
  const options = { token, cursorStore: 'cursor', inboxNote: async () => {} };
  assert.throws(() => new MacPuller({ ...options, baseUrl: 'http://8.8.8.8:8765' }), /loopback or private-network/);
  assert.throws(() => new MacPuller({ ...options, baseUrl: 'http://bridge.example:8765' }), /loopback or private-network/);
  assert.doesNotThrow(() => new MacPuller({ ...options, baseUrl: 'http://100.100.1.2:8765' }));
});

test('ack failure preserves cursor and allows stable-id retry', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'shipcat-ack-retry-'));
  let server;
  const originalFetch = globalThis.fetch;
  try {
    const queue = new EventQueue(join(dir, 'queue.json')); await queue.load();
    const event = syntheticEvent('discord.message.text'); await queue.append(event);
    server = createBridgeServer({ queue, token, port: 0 }); await new Promise(resolve => server.once('listening', resolve));
    const cursorStore = join(dir, 'cursor'); const notes = [];
    const puller = new MacPuller({ baseUrl: `http://127.0.0.1:${server.address().port}`, token, cursorStore, inboxNote: async note => notes.push(note) });
    let failAck = true;
    globalThis.fetch = async (url, options) => {
      if (String(url).endsWith('/v1/events/ack') && failAck) return new Response(null, { status: 503 });
      return originalFetch(url, options);
    };
    await assert.rejects(puller.poll(), /acknowledgement returned 503/);
    await assert.rejects(readFile(cursorStore));
    failAck = false;
    assert.equal(await puller.poll(), 1);
    assert.deepEqual(notes.map(note => note.requestId), [`discord-${event.id}`, `discord-${event.id}`]);
    assert.equal(await readFile(cursorStore, 'utf8'), event.id);
  } finally { globalThis.fetch = originalFetch; if (server) await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true, force: true }); }
});

test('acknowledgement succeeds before atomic cursor persistence', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'shipcat-cursor-'));
  let server;
  try {
    const queue = new EventQueue(join(dir, 'queue.json')); await queue.load();
    const event = syntheticEvent('discord.message.text'); await queue.append(event);
    server = createBridgeServer({ queue, token, port: 0 }); await new Promise(resolve => server.once('listening', resolve));
    const cursorStore = join(dir, 'state', 'cursor');
    const puller = new MacPuller({ baseUrl: `http://127.0.0.1:${server.address().port}`, token, cursorStore, inboxNote: async () => {} });
    assert.equal(await puller.poll(), 1);
    assert.equal(await readFile(cursorStore, 'utf8'), event.id);
    assert.deepEqual(queue.page().events, []);
  } finally { if (server) await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true, force: true }); }
});
