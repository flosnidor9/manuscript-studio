import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const chrome = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const profile = await mkdtemp(join(tmpdir(), 'manuscript-studio-empty-blocks-'));
const server = createServer(async (request, response) => {
  const name = request.url === '/' ? 'index.html' : decodeURIComponent(request.url.slice(1));
  if (!['index.html', 'app.js', 'styles.css', 'sw.js'].includes(name)) { response.writeHead(404).end(); return; }
  const file = await readFile(join(root, name));
  const type = name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html';
  response.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` }).end(file);
});
await new Promise(resolveServer => server.listen(0, '127.0.0.1', resolveServer));
const port = server.address().port;
const browser = spawn(chrome, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--remote-debugging-port=0', `--user-data-dir=${profile}`, `http://127.0.0.1:${port}/`], { windowsHide: true, stdio: 'ignore' });
let socket;

async function until(action) {
  for (let tries = 0; tries < 100; tries += 1) {
    try { const value = await action(); if (value) return value; } catch (_) { /* Browser is starting. */ }
    await new Promise(resolveDelay => setTimeout(resolveDelay, 100));
  }
  throw new Error('Chrome did not become ready');
}

try {
  const debugPort = await until(async () => Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]));
  const target = await until(async () => (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).find(page => page.type === 'page' && page.url.includes(`127.0.0.1:${port}`)));
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolveOpen, rejectOpen) => { socket.addEventListener('open', resolveOpen, { once: true }); socket.addEventListener('error', rejectOpen, { once: true }); });
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (!pending.has(message.id)) return;
    const { resolveResult, rejectResult } = pending.get(message.id);
    pending.delete(message.id);
    message.error ? rejectResult(new Error(message.error.message)) : resolveResult(message.result);
  });
  const call = (method, params = {}) => new Promise((resolveResult, rejectResult) => {
    const id = ++nextId;
    pending.set(id, { resolveResult, rejectResult });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };
  await until(() => evaluate('Boolean(document.querySelector(".manuscript-page > [data-block]"))'));
  await evaluate('(()=>{const page=document.querySelector(".manuscript-page"), block=page.querySelector("[data-block]");page.focus();const range=document.createRange();range.selectNodeContents(block);range.collapse(false);getSelection().removeAllRanges();getSelection().addRange(range);})()');
  for (let index = 0; index < 2; index += 1) {
    await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
    await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  }
  const state = '(()=>({blocks:[...document.querySelectorAll(".manuscript-page > [data-block]")].map(block=>({text:block.textContent,height:block.getBoundingClientRect().height})),placeholder:document.getElementById("book-preview").dataset.empty}))()';
  const afterEnter = await evaluate(state);
  assert.equal(afterEnter.blocks.length, 3);
  assert.equal(afterEnter.placeholder, 'false');
  assert.ok(afterEnter.blocks.every(block => block.height > 0), JSON.stringify(afterEnter));
  await evaluate('document.getElementById("document-title").focus()');
  const afterBlur = await evaluate(state);
  assert.deepEqual(afterBlur.blocks.map(block => block.text), ['', '', '']);
  assert.ok(afterBlur.blocks.every(block => block.height > 0), JSON.stringify(afterBlur));
  await new Promise(resolveDelay => setTimeout(resolveDelay, 400));
  await call('Page.reload', { ignoreCache: true });
  await until(async () => (await evaluate(state)).blocks.length === 3);
  const afterReload = await evaluate(state);
  assert.ok(afterReload.blocks.every(block => block.height > 0), JSON.stringify(afterReload));
  await evaluate('(()=>{const page=document.querySelector(".manuscript-page"), block=page.querySelector("[data-block]:last-child");page.focus();const range=document.createRange();range.selectNodeContents(block);range.collapse(false);getSelection().removeAllRanges();getSelection().addRange(range);})()');
  await call('Input.insertText', { text: 'x' });
  assert.deepEqual((await evaluate(state)).blocks.map(block => block.text), ['', '', 'x']);
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  await evaluate('document.getElementById("document-title").focus()');
  assert.deepEqual((await evaluate(state)).blocks.map(block => block.text), ['', '', 'x', '']);
  assert.ok((await evaluate(state)).blocks.every(block => block.height > 0));
  await evaluate('navigator.serviceWorker.ready.then(() => true)');
  await new Promise(resolveDelay => setTimeout(resolveDelay, 400));
  await call('Network.enable');
  await call('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  await call('Page.reload', { ignoreCache: true });
  await until(async () => (await evaluate(state)).blocks.length === 4);
  assert.deepEqual((await evaluate(state)).blocks.map(block => block.text), ['', '', 'x', '']);
  assert.ok((await evaluate(state)).blocks.every(block => block.height > 0));
  const point = await evaluate('(()=>{const block=document.querySelector(".manuscript-page > [data-block]:last-child");block.scrollIntoView({block:"center"});const rect=block.getBoundingClientRect();return {x:rect.x+10,y:rect.y+rect.height/2};})()');
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });
  await call('Input.insertText', { text: 'y' });
  const afterClick = await evaluate(state);
  assert.deepEqual(afterClick.blocks.map(block => block.text), ['', '', 'x', 'y'], JSON.stringify({ point, afterClick }));
  console.log('Empty blocks survive Enter, blur, online and offline reload, and accept mouse input.');
} finally {
  socket?.close();
  browser.kill();
  await new Promise(resolveServer => server.close(resolveServer));
  if (!resolve(profile).startsWith(resolve(tmpdir()) + sep)) throw new Error('Unexpected browser profile path');
  await rm(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 });
}
