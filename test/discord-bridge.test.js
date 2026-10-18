import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { chmod, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventQueue, DiscordEventSource, MacPuller, createBridgeServer, syntheticEvent } from '../src/discord-bridge.js';
import { startBridgeService } from '../src/discord-bridge-service.js';

const token = 'x'.repeat(40);
const stamp = '2025-01-02T03:04:05.000Z';
const message = (overrides = {}) => ({
  id: 'message-1',
  channelId: 'channel-1',
  content: 'hello synthetic',
  createdAt: new Date(stamp),
  author: { id: 'human-1', bot: false, username: 'must-not-leak', avatar: 'must-not-leak' },
  attachments: new Map(),
  ...overrides
});

async function startServer(queue, options = {}) {
  const server = createBridgeServer({ queue, token, port: 0, ...options });
  await once(server, 'listening');
  return server;
}

function puller(server, dir, options = {}) {
  return new MacPuller({
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    token,
    cursorStore: join(dir, 'cursor'),
    allowLoopback: true,
    ...options
  });
}

async function makeHandoffCommand(dir) {
  const command = join(dir, 'handoff');
  const output = join(dir, 'handoff.json');
  const script = `#!${process.execPath}\nlet data=''; process.stdin.setEncoding('utf8'); process.stdin.on('data', chunk => data += chunk); process.stdin.on('end', () => require('node:fs').writeFileSync(${JSON.stringify(output)}, data));\n`;
  await writeFile(command, script, { mode: 0o700 });
  await chmod(command, 0o700);
  return { command, output };
}

async function fakeMLX(dir, fail = false) {
  const modelPath = join(dir, 'local-model');
  const modulePath = join(dir, 'python-modules');
  await mkdir(modelPath);
  await mkdir(modulePath);
  if (fail) await writeFile(join(modelPath, 'fail'), '1');
  await writeFile(join(modulePath, 'mlx_whisper.py'), [
    'from pathlib import Path',
    'def transcribe(audio, path_or_hf_repo):',
    '    model = Path(path_or_hf_repo)',
    '    (model / "observed-audio-path").write_text(audio)',
    '    if (model / "fail").exists(): raise RuntimeError("synthetic local model failure")',
    '    return {"text": "synthetic local transcript"}'
  ].join('\n'));
  const previous = process.env.PYTHONPATH;
  process.env.PYTHONPATH = [modulePath, previous].filter(Boolean).join(':');
  return { modelPath, restore: () => { if (previous === undefined) delete process.env.PYTHONPATH; else process.env.PYTHONPATH = previous; } };
}

test('Discord source minimizes message data and ignores non-voice attachments', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'shipcat-source-'));
  try {
    const queue = new EventQueue(join(dir, 'queue.json')); await queue.load();
    const client = new EventEmitter();
    const source = new DiscordEventSource({ client, queue, captainUserId: 'captain-1' }).start();
    const incoming = message({ attachments: new Map([['file', { contentType: 'image/png', url: 'https://example.invalid/private' }]]), embeds: [{ secret: 'omit' }], raw: { secret: 'omit' } });
    assert.equal(client.listenerCount('messageCreate'), 1);
    await source.ingest(incoming);
    const event = queue.page().events[0];
    assert.deepEqual(event, {
      id: 'message-1',
      type: 'discord.message.text',
      payload: { channel_id: 'channel-1', human_author: true, timestamp: stamp, message_text: 'hello synthetic' }
    });
    source.stop();
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('unconfigured handoff sends nothing and leaves events queued', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'shipcat-no-handoff-'));
  let server;
  try {
    const queue = new EventQueue(join(dir, 'queue.json')); await queue.load();
    const event = syntheticEvent('discord.message.text', { message_text: 'synthetic' }); await queue.append(event);
    server = await startServer(queue);
    const client = puller(server, dir);
    assert.equal(await client.poll(), 0);
    assert.deepEqual(queue.page().events.map(row => row.id), [event.id]);
    await assert.rejects(readFile(join(dir, 'handoff.json')));
  } finally { if (server) await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true, force: true }); }
});

test('configured handoff receives only the five approved message fields', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'shipcat-handoff-'));
  let server;
  try {
    const queue = new EventQueue(join(dir, 'queue.json')); await queue.load();
    const source = new DiscordEventSource({ client: new EventEmitter(), queue, captainUserId: 'captain-1' });
    await source.ingest(message({
      attachments: new Map([['file', { contentType: 'image/png', url: 'https://example.invalid/file' }]]),
      embeds: [{ title: 'private' }],
      author: { id: 'human-1', bot: false, username: 'private-name', avatar: 'private-avatar' },
      content: 'approved text'
    }));
    server = await startServer(queue);
    const { command, output } = await makeHandoffCommand(dir);
    const client = puller(server, dir, { handoffCommand: command });
    assert.equal(await client.poll(), 1);
    assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), {
      message_id: 'message-1', channel_id: 'channel-1', human_author: true, timestamp: stamp, message_text: 'approved text'
    });
    assert.deepEqual(queue.page().events, []);
    const persisted = JSON.parse(await readFile(join(dir, 'queue.json'), 'utf8'));
    assert.deepEqual(persisted, { events: [], ids: ['message-1'] });
  } finally { if (server) await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true, force: true }); }
});

test('only captain-authored voice messages expose transient audio to local MLX', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'shipcat-voice-'));
  let server;
  try {
    const queue = new EventQueue(join(dir, 'queue.json')); await queue.load();
    const voiceUrl = 'https://cdn.discordapp.com/attachments/synthetic/audio.ogg';
    const voiceSources = new Map();
    const source = new DiscordEventSource({ client: new EventEmitter(), queue, captainUserId: 'captain-1', voiceSources });
    const voice = message({ id: 'voice-1', author: { id: 'other-user', bot: false }, flags: { bitfield: 1 << 13 }, attachments: new Map([['a', { contentType: 'audio/ogg', url: voiceUrl }]]) });
    assert.equal(await source.ingest(voice), false);
    assert.deepEqual(queue.page().events, []);
    voice.author.id = 'captain-1';
    assert.equal(await source.ingest(voice), true);
    assert.deepEqual(queue.page().events[0], {
      id: 'voice-1', type: 'discord.voice',
      payload: { channel_id: 'channel-1', human_author: true, timestamp: stamp, message_text: '' }
    });
    assert.deepEqual([...voiceSources], [['voice-1', voiceUrl]]);
    server = await startServer(queue, { voiceSources, audioFetch: async () => new Response(Buffer.from('synthetic audio'), { headers: { 'content-type': 'audio/ogg' } }) });
    const response = await fetch(`http://127.0.0.1:${server.address().port}/v1/events/voice-1/audio`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'synthetic audio');
  } finally { if (server) await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true, force: true }); }
});

for (const fail of [false, true]) {
  test(`local MLX voice transcription deletes temporary audio (${fail ? 'failure' : 'success'})`, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'shipcat-mlx-'));
    let server;
    const mlx = await fakeMLX(dir, fail);
    try {
      const queue = new EventQueue(join(dir, 'queue.json')); await queue.load();
      const voiceSources = new Map([['voice-mlx', 'https://cdn.discordapp.com/attachments/synthetic/voice.ogg']]);
      const event = syntheticEvent('discord.voice', { channel_id: 'channel-1', human_author: true, timestamp: stamp, message_text: '' });
      event.id = 'voice-mlx'; await queue.append(event);
      server = await startServer(queue, { voiceSources, audioFetch: async () => new Response(Buffer.from('temporary synthetic audio'), { headers: { 'content-type': 'audio/ogg' } }) });
      const { command, output } = await makeHandoffCommand(dir);
      const client = puller(server, dir, { handoffCommand: command, mlxModelPath: mlx.modelPath });
      if (fail) {
        await assert.rejects(client.poll(), /local MLX transcription exited/);
        await assert.rejects(readFile(output));
        assert.equal(queue.page().events.length, 1);
      } else {
        assert.equal(await client.poll(), 1);
        assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), {
          message_id: 'voice-mlx', channel_id: 'channel-1', human_author: true, timestamp: stamp, message_text: 'synthetic local transcript'
        });
        assert.deepEqual(queue.page().events, []);
      }
      const audioPath = await readFile(join(mlx.modelPath, 'observed-audio-path'), 'utf8');
      await assert.rejects(readFile(audioPath));
    } finally { mlx.restore(); if (server) await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true, force: true }); }
  });
}

test('queue append failure does not commit candidate state', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'shipcat-append-failure-'));
  try {
    const blockedParent = join(dir, 'queue-dir');
    const queue = new EventQueue(join(blockedParent, 'queue.json')); await queue.load();
    await writeFile(blockedParent, 'block');
    const event = syntheticEvent('discord.message.text', { channel_id: 'channel-1', message_text: 'retry' });
    await assert.rejects(queue.append(event));
    assert.deepEqual(queue.page().events, []);
    await rm(blockedParent);
    assert.equal(await queue.append(event), true);
    const reloaded = new EventQueue(join(blockedParent, 'queue.json')); await reloaded.load();
    assert.deepEqual(reloaded.page().events.map(row => row.id), [event.id]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('ack persistence failure keeps events retryable in memory and on disk', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'shipcat-ack-save-failure-'));
  try {
    const store = join(dir, 'store'); const backup = join(dir, 'backup');
    await mkdir(store);
    const queuePath = join(store, 'queue.json');
    const queue = new EventQueue(queuePath); await queue.load();
    const event = syntheticEvent('discord.message.text', { message_text: 'pending' }); await queue.append(event);
    await rename(store, backup); await writeFile(store, 'block directory replacement');
    await assert.rejects(queue.acknowledge([event.id]));
    assert.deepEqual(queue.page().events.map(row => row.id), [event.id]);
    await rm(store); await rename(backup, store);
    const reloaded = new EventQueue(queuePath); await reloaded.load();
    assert.deepEqual(reloaded.page().events.map(row => row.id), [event.id]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('ack failure preserves cursor and permits stable message-id retry', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'shipcat-ack-retry-'));
  let server;
  const originalFetch = globalThis.fetch;
  try {
    const queue = new EventQueue(join(dir, 'queue.json')); await queue.load();
    const event = syntheticEvent('discord.message.text', { message_text: 'synthetic' }); await queue.append(event);
    server = await startServer(queue);
    const { command, output } = await makeHandoffCommand(dir);
    const client = puller(server, dir, { handoffCommand: command });
    let failAck = true;
    globalThis.fetch = async (url, options) => {
      if (String(url).endsWith('/v1/events/ack') && failAck) return new Response(null, { status: 503 });
      return originalFetch(url, options);
    };
    await assert.rejects(client.poll(), /acknowledgement returned 503/);
    await assert.rejects(readFile(join(dir, 'cursor')));
    failAck = false;
    assert.equal(await client.poll(), 1);
    assert.equal(JSON.parse(await readFile(output, 'utf8')).message_id, event.id);
    assert.equal(await readFile(join(dir, 'cursor'), 'utf8'), event.id);
  } finally { globalThis.fetch = originalFetch; if (server) await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true, force: true }); }
});

test('service requires a private bind and bridge rejects wildcard/public addresses', async () => {
  const queue = new EventQueue('unused');
  for (const host of ['0.0.0.0', '::', '8.8.8.8', 'example.com']) assert.throws(() => createBridgeServer({ queue, token, host, port: 8765 }), /private-network/);
  assert.throws(() => createBridgeServer({ queue, token, host: '127.0.0.1', port: 8765, privateBind: true }), /private-network/);
  const dir = await mkdtemp(join(tmpdir(), 'shipcat-private-bind-'));
  try {
    await assert.rejects(startBridgeService({ queuePath: join(dir, 'queue.json'), token, host: '127.0.0.1', client: new EventEmitter(), captainUserId: 'captain-1' }), /private-network/);
  } finally { await rm(dir, { recursive: true, force: true }); }
  assert.throws(() => createBridgeServer({ queue, token: '', host: '127.0.0.1' }), /runtime-injected token/);
  assert.throws(() => new MacPuller({ baseUrl: 'http://8.8.8.8:8765', token, cursorStore: 'x' }), /private-network/);
  assert.throws(() => new MacPuller({ baseUrl: 'http://127.0.0.1:8765', token, cursorStore: 'x' }), /private-network/);
});
