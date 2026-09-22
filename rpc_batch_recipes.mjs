// Batch recipe validator: reads recipe JSON files from the mod folder on this
// machine and calls omni_recipe_validate for each, in ONE server session.
// Usage: node rpc_batch_recipes.mjs <recipesRoot> <id1> <id2> ...
// Prints one JSON line per recipe: {name, type, problems:[...]}
import { spawn } from 'node:child_process';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(__dirname, 'dist', 'index.js');

const recipesRoot = process.argv[2];
const ids = process.argv.slice(3);
if (!recipesRoot || ids.length === 0) {
  console.error('usage: node rpc_batch_recipes.mjs <recipesRoot> <id...>');
  process.exit(2);
}

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

const overall = setTimeout(() => {
  console.error('TIMEOUT');
  try { child.kill(); } catch {}
  process.exit(3);
}, 180000);

(async () => {
  await request('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'zb-batch-recipes', version: '1.0.0' }
  });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

  for (const id of ids) {
    const file = path.join(recipesRoot, id + '.json');
    let recipe;
    try {
      recipe = JSON.parse(readFileSync(file, 'utf8'));
    } catch (e) {
      console.log(JSON.stringify({ name: 'webdisplays/' + id, readError: e.message }));
      continue;
    }
    const res = await request('tools/call', {
      name: 'omni_recipe_validate',
      arguments: { recipe, name: 'webdisplays/' + id }
    });
    let text = '';
    if (res && res.content) {
      for (const c of res.content) if (c.type === 'text') text += c.text;
    }
    process.stdout.write(text.trim() + '\n');
  }
  clearTimeout(overall);
  child.kill();
  process.exit(0);
})().catch((e) => {
  console.error('BATCH_ERROR: ' + e.message);
  clearTimeout(overall);
  try { child.kill(); } catch {}
  process.exit(4);
});
