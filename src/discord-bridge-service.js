import { EventQueue, DiscordEventSource, createBridgeServer } from './discord-bridge.js';
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function startBridgeService({ queuePath, token, host, port = 8765, client, captainUserId }) {
  const queue = new EventQueue(queuePath);
  await queue.load();
  const voiceSources = new Map();
  const source = new DiscordEventSource({ client, queue, captainUserId, voiceSources });
  const server = createBridgeServer({ queue, token, host, port, voiceSources, privateBind: true });
  source.start();
  return {
    queue,
    server,
    source,
    close: async () => {
      source.stop();
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  };
}

async function runConfiguredService() {
  const { SHIPCAT_BRIDGE_HOST: host, SHIPCAT_BRIDGE_PORT, SHIPCAT_BRIDGE_TOKEN: token, SHIPCAT_BRIDGE_QUEUE: queuePath, SHIPCAT_DISCORD_CLIENT_MODULE: clientModulePath } = process.env;
  if (!host || !token || !queuePath || !clientModulePath || !isAbsolute(clientModulePath)) throw new Error('private host, runtime token, queue path, and explicit Discord client module path are required');
  const port = SHIPCAT_BRIDGE_PORT === undefined ? 8765 : Number(SHIPCAT_BRIDGE_PORT);
  const clientModule = await import(pathToFileURL(clientModulePath));
  if (!clientModule.client || !clientModule.captainUserId) throw new Error('Discord client module must export its authenticated client and captainUserId');
  const running = await startBridgeService({ queuePath, token, host, port, client: clientModule.client, captainUserId: clientModule.captainUserId });
  running.server.on('error', error => { console.error(error); process.exitCode = 1; });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await runConfiguredService();
