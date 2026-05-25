const http = require('http');
const { chromium } = require('playwright');

const PORT = Number(process.env.PORT || 5175);
const HOST = process.env.HOST || '0.0.0.0';
const CHROME = process.env.CHROME_PATH || '';
const EXPORT_TOKEN = process.env.EXPORT_TOKEN || '';
const FRAME_WAIT_MS = Number(process.env.FRAME_WAIT_MS || 5);
const FRAME_FORMAT = process.env.FRAME_FORMAT || 'jpeg';

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS, GET',
    'Access-Control-Allow-Headers': 'Content-Type, X-Export-Token',
    ...headers
  });
  res.end(body);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 80 * 1024 * 1024) throw new Error('Request too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function waitForDesign(page, timeout = 30000) {
  await page.waitForFunction(() => {
    const root = document.getElementById('root');
    return root && root.children.length && typeof window.__setTime__ === 'function';
  }, null, { timeout });
}

async function hideChrome(page) {
  await page.evaluate(() => {
    window.__VD_HIDE_CONTROLS__ = true;
    if (!document.getElementById('__vd_export_hide_controls')) {
      const style = document.createElement('style');
      style.id = '__vd_export_hide_controls';
      style.textContent = `
        .twk-panel,.tweaks-panel,[data-noncommentable]{display:none!important}
        div:has(button[title^="Return to start"]):has(input[type="range"]),
        div:has(button[title^="Play/pause"]):has(input[type="range"]){display:none!important}
        button[title^="Return to start"],button[title^="Play/pause"],input[type="range"]{display:none!important}
      `;
      document.head.appendChild(style);
    }
    document.querySelectorAll('.twk-panel,.tweaks-panel,[data-noncommentable]').forEach(el => el.remove());
    const playbackButton = document.querySelector('button[title^="Return to start"],button[title^="Play/pause"]');
    if (playbackButton) {
      let playbackBar = playbackButton.closest('div');
      for (let i = 0; i < 8 && playbackBar; i++) {
        if (playbackBar.querySelector('input[type="range"]')) break;
        playbackBar = playbackBar.parentElement;
      }
      if (playbackBar) playbackBar.remove();
    }
    document.querySelectorAll('input[type="range"]').forEach(el => {
      let bar = el.closest('div');
      for (let i = 0; i < 6 && bar; i++) {
        if (bar.querySelector('button[title^="Return to start"],button[title^="Play/pause"]')) break;
        bar = bar.parentElement;
      }
      if (bar) bar.remove();
    });
    document.documentElement.style.margin = '0';
    document.documentElement.style.width = innerWidth + 'px';
    document.documentElement.style.height = innerHeight + 'px';
    document.body.style.margin = '0';
    document.body.style.width = innerWidth + 'px';
    document.body.style.height = innerHeight + 'px';
    document.body.style.overflow = 'hidden';
    window.__pause__ && window.__pause__();
  });
}

async function createEncoder(browser, width, height, fps, bitrate) {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/encoder`, { waitUntil: 'load' });
  await page.addScriptTag({ url: 'https://cdn.jsdelivr.net/npm/webm-muxer@5.1.4/build/webm-muxer.js' });
  await page.evaluate(({ width, height, fps, bitrate }) => {
    const target = new WebMMuxer.ArrayBufferTarget();
    const muxer = new WebMMuxer.Muxer({
      target,
      video: { codec: 'V_VP8', width, height, frameRate: fps },
      firstTimestampBehavior: 'offset'
    });
    const encoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: e => { throw e; }
    });
    encoder.configure({ codec: 'vp8', width, height, bitrate, framerate: fps });
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    window.__vdEncoder = { target, muxer, encoder, canvas, ctx, width, height, fps, frameIndex: 0 };
  }, { width, height, fps, bitrate });
  return page;
}

async function encodeFrame(encoderPage, frameImage, mimeType, flush = false) {
  const item = frameImage.toString('base64');
  await encoderPage.evaluate(async ({ item, mimeType, flush }) => {
    const state = window.__vdEncoder;
    const bytes = Uint8Array.from(atob(item), c => c.charCodeAt(0));
    const bmp = await createImageBitmap(new Blob([bytes], { type: mimeType }));
    state.ctx.clearRect(0, 0, state.width, state.height);
    state.ctx.drawImage(bmp, 0, 0, state.width, state.height);
    bmp.close();
    const frame = new VideoFrame(state.canvas, {
      timestamp: Math.round(state.frameIndex * 1000000 / state.fps),
      duration: Math.round(1000000 / state.fps)
    });
    state.encoder.encode(frame, { keyFrame: state.frameIndex % Math.max(1, Math.round(state.fps)) === 0 });
    frame.close();
    state.frameIndex++;
    if (flush || state.encoder.encodeQueueSize > 12) await state.encoder.flush();
  }, { item, mimeType, flush });
}

async function finalizeEncoder(encoderPage) {
  const b64 = await encoderPage.evaluate(async () => {
    const { encoder, muxer, target } = window.__vdEncoder;
    await encoder.flush();
    encoder.close();
    muxer.finalize();
    const out = new Uint8Array(target.buffer);
    let s = '';
    for (let i = 0; i < out.length; i += 8192) s += String.fromCharCode(...out.subarray(i, i + 8192));
    return btoa(s);
  });
  await encoderPage.close();
  return Buffer.from(b64, 'base64');
}

async function renderVideo({ html, width, height, duration, fps, bitrate }) {
  const launchOptions = { headless: true };
  if (CHROME) launchOptions.executablePath = CHROME;
  const browser = await chromium.launch(launchOptions);
  try {
    const page = await browser.newPage({
      viewport: { width, height },
      deviceScaleFactor: 1
    });
    await page.setContent(html, { waitUntil: 'load' });
    await waitForDesign(page);
    await hideChrome(page);
    const total = Math.ceil(duration * fps);
    const screenshotType = FRAME_FORMAT === 'png' ? 'png' : 'jpeg';
    const mimeType = screenshotType === 'png' ? 'image/png' : 'image/jpeg';
    console.log(`Rendering ${total} frames at ${width}x${height}, ${fps}fps, ${screenshotType}`);
    const encoderPage = await createEncoder(browser, width, height, fps, bitrate);
    for (let i = 0; i < total; i++) {
      await page.evaluate(t => window.__setTime__(t), i / fps);
      if (FRAME_WAIT_MS > 0) await page.waitForTimeout(FRAME_WAIT_MS);
      const frame = await page.screenshot({
        type: screenshotType,
        quality: screenshotType === 'jpeg' ? 85 : undefined,
        clip: { x: 0, y: 0, width, height }
      });
      await encodeFrame(encoderPage, frame, mimeType, i % Math.max(1, Math.round(fps)) === 0);
      if ((i + 1) % Math.max(1, Math.round(fps * 5)) === 0 || i + 1 === total) {
        console.log(`Rendered ${i + 1}/${total} frames`);
      }
    }
    await page.close();
    return await finalizeEncoder(encoderPage);
  } finally {
    await browser.close();
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, '');
  if (req.method === 'GET' && req.url === '/health') return send(res, 200, 'ok', { 'Content-Type': 'text/plain' });
  if (req.method === 'GET' && req.url === '/encoder') return send(res, 200, '<!doctype html><title>encoder</title>', { 'Content-Type': 'text/html' });
  if (req.method !== 'POST' || req.url !== '/export') return send(res, 404, 'not found');
  if (EXPORT_TOKEN && req.headers['x-export-token'] !== EXPORT_TOKEN) {
    return send(res, 401, 'unauthorized', { 'Content-Type': 'text/plain' });
  }
  try {
    const body = await readJson(req);
    const width = Number(body.width || 1080);
    const height = Number(body.height || 1920);
    const duration = Number(body.duration || 20);
    const fps = Number(body.fps || 30);
    const bitrate = Number(body.bitrate || 8000000);
    if (!body.html) throw new Error('Missing assembled HTML');
    const webm = await renderVideo({ html: body.html, width, height, duration, fps, bitrate });
    send(res, 200, webm, {
      'Content-Type': 'video/webm',
      'Content-Disposition': 'attachment; filename="chrome-render.webm"'
    });
  } catch (err) {
    send(res, 500, String(err && err.stack || err), { 'Content-Type': 'text/plain' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Chrome render export server listening on http://127.0.0.1:${PORT}`);
});
