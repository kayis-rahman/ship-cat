import { EventQueue, createBridgeServer } from './discord-bridge.js';

const { SHIPCAT_BRIDGE_HOST: host, SHIPCAT_BRIDGE_PORT, SHIPCAT_BRIDGE_TOKEN: token, SHIPCAT_BRIDGE_QUEUE: queuePath } = process.env;
if (!host || !token || !queuePath) throw new Error('SHIPCAT_BRIDGE_HOST, SHIPCAT_BRIDGE_TOKEN, and SHIPCAT_BRIDGE_QUEUE are required');
const port = SHIPCAT_BRIDGE_PORT === undefined ? 8765 : Number(SHIPCAT_BRIDGE_PORT);
const queue = new EventQueue(queuePath);
await queue.load();
const server = createBridgeServer({ queue, token, host, port });
server.on('error', error => { console.error(error); process.exitCode = 1; });
