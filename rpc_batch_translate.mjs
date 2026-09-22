// Batch block/item translator: node rpc_batch_translate.mjs block id1 id2 ... | item id1 ...
// Calls omni_block_translate (or omni_item_translate) once per id in one session.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(__dirname, 'dist', 'index.js');

const kind = process.argv[2]; // "block" | "item"
const ids = process.argv.slice(3);
const tool = kind === 'item' ? 'omni_item_translate' : 'omni_block_translate';

const child = spawn(process.execPath, [SERVER], { stdio: ['pipe', 'pipe', 'pipe'] });
let buf = '';
const pending = new Map();
let nextId = 1;

function request(method, params) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}

child.stdout.on('data', (d) => {
  buf += d.toString();
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.id !== undefined && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
      else p.resolve(msg.result);
    }
  }
});
child.stderr.on('data', () => {});

const overall = setTimeout(() => { console.error('TIMEOUT'); try { child.kill(); } catch {} process.exit(3); }, 180000);

(async () => {
  await request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'zb-batch-translate', version: '1.0.0' } });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  for (const id of ids) {
    const res = await request('tools/call', { name: tool, arguments: { id } });
    let text = '';
    if (res && res.content) for (const c of res.content) if (c.type === 'text') text += c.text;
    process.stdout.write(id + ' -> ' + text.replace(/\s+/g, ' ').trim() + '\n');
  }
  clearTimeout(overall);
  child.kill();
  process.exit(0);
})().catch((e) => { console.error('ERR: ' + e.message); clearTimeout(overall); try { child.kill(); } catch {} process.exit(4); });
