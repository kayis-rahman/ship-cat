import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventQueue, MacPuller, createBridgeServer, syntheticEvent } from '../src/discord-bridge.js';

const token = 'x'.repeat(40);
test('authenticated pull queue, duplicate suppression, and idempotent inbox handoff', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'shipcat-bridge-'));
  try {
    const queue = new EventQueue(join(dir, 'queue.json')); await queue.load();
    const event = syntheticEvent('discord.message.text', { content: 'synthetic' });
    assert.equal(await queue.append(event), true); assert.equal(await queue.append(event), false);
    const server = createBridgeServer({ queue, token });
    await new Promise(resolve => server.once('listening', resolve));
    const address = server.address(); const inbox = [];
    const puller = new MacPuller({ baseUrl: `http://127.0.0.1:${address.port}`, token, cursorStore: join(dir, 'cursor'), inboxNote: async note => inbox.push(note) });
    assert.equal(await puller.poll(), 1); assert.equal(inbox[0].requestId, `discord-${event.id}`);
    assert.equal(await puller.poll(), 0); assert.equal(inbox.length, 1);
    const unauthorized = await fetch(`http://127.0.0.1:${address.port}/v1/events`); assert.equal(unauthorized.status, 401);
    await new Promise(resolve => server.close(resolve));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('voice audio is deleted after successful transcription and failure, with stub only', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'shipcat-voice-'));
  try {
    const queue = new EventQueue(join(dir, 'queue.json')); await queue.load();
    const event = syntheticEvent('discord.voice'); await queue.append(event);
    const server = createBridgeServer({ queue, token }); await new Promise(resolve => server.once('listening', resolve));
    const audio = join(dir, 'audio.tmp'); const notes = [];
    const puller = new MacPuller({ baseUrl: `http://127.0.0.1:${server.address().port}`, token, cursorStore: join(dir, 'cursor'), fetchAudio: async () => { await import('node:fs/promises').then(fs => fs.writeFile(audio, 'synthetic')); return audio; }, transcribe: async () => 'local stub transcript', inboxNote: async note => notes.push(note) });
    await puller.poll(); assert.equal(notes[0].payload.transcript, 'local stub transcript'); await assert.rejects(readFile(audio));
    await new Promise(resolve => server.close(resolve));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('voice failure removes temporary audio and records failure without fallback', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'shipcat-voice-fail-'));
  try {
    const queue = new EventQueue(join(dir, 'queue.json')); await queue.load(); await queue.append(syntheticEvent('discord.voice'));
    const server = createBridgeServer({ queue, token }); await new Promise(resolve => server.once('listening', resolve));
    const audio = join(dir, 'audio.tmp'); let note;
    const puller = new MacPuller({ baseUrl: `http://127.0.0.1:${server.address().port}`, token, cursorStore: join(dir, 'cursor'), fetchAudio: async () => { await import('node:fs/promises').then(fs => fs.writeFile(audio, 'x')); return audio; }, transcribe: async () => { throw new Error('local model unavailable'); }, inboxNote: async value => { note = value; } });
    await puller.poll(); assert.equal(note.payload.status, 'failed'); await assert.rejects(readFile(audio));
    await new Promise(resolve => server.close(resolve));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
