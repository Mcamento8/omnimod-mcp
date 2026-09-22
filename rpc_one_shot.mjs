// One-shot MCP tool caller: node rpc_one_shot.mjs <toolName> [jsonArgs]
// Spawns mcp/dist/index.js over stdio, performs initialize handshake,
// calls the tool, prints result text, exits. No secrets involved.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(__dirname, 'dist', 'index.js');

const toolName = process.argv[2];
// Args are read from a JSON FILE to avoid cmd.exe quoting destruction.
// Default file: mcp/rpc_args.json (same dir as this script), or pass a path.
import { readFileSync } from 'node:fs';
const argsFile = process.argv[3] || path.join(__dirname, 'rpc_args.json');
let toolArgs = {};
try { toolArgs = JSON.parse(readFileSync(argsFile, 'utf8')); } catch (e) {
  console.error('BAD_ARGS_JSON: ' + e.message); process.exit(2);
}

const child = spawn(process.execPath, [SERVER], { stdio: ['pipe', 'pipe', 'pipe'] });

let buf = '';
const pending = new Map();
let nextId = 1;

function send(obj) {
  child.stdin.write(JSON.stringify(obj) + '\n');
}

function request(method, params) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    send({ jsonrpc: '2.0', id, method, params });
  });
}

function handleLine(line) {
  line = line.trim();
  if (!line) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.id !== undefined && pending.has(msg.id)) {
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
    else p.resolve(msg.result);
  }
}

child.stdout.on('data', (d) => {
  buf += d.toString();
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx);
    buf = buf.slice(idx + 1);
    handleLine(line);
  }
});
child.stderr.on('data', (d) => { /* keep quiet */ });

const overall = setTimeout(() => {
  console.error('TIMEOUT_WAITING_RESPONSE');
  try { child.kill(); } catch {}
  process.exit(3);
}, 120000);

try {
  const init = await request('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'zb-one-shot', version: '1.0.0' }
  });
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });

  const res = await request('tools/call', { name: toolName, arguments: toolArgs });

  if (res && res.content) {
    for (const c of res.content) {
      if (c.type === 'text') process.stdout.write(c.text);
      else process.stdout.write('\n[non-text content block: ' + (c.type || '?') + ']\n');
    }
    if (res.isError) { console.error('\nTOOL_IS_ERROR=true'); }
  } else {
    console.log(JSON.stringify(res, null, 2));
  }
  clearTimeout(overall);
  child.kill();
  process.exit(0);
} catch (e) {
  console.error('RPC_ERROR: ' + e.message);
  clearTimeout(overall);
  try { child.kill(); } catch {}
  process.exit(4);
}
