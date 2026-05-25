const http = require('http');
const fs = require('fs/promises');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = __dirname;
const ZIP = process.argv[2] || 'C:/Users/Roni_Brain1/Downloads/OM ad.zip';
const WIDTH = Number(process.argv[3] || 540);
const HEIGHT = Number(process.argv[4] || 960);
const DURATION = Number(process.argv[5] || 20);
const FPS = Number(process.argv[6] || 30);
const OUT = process.argv[7] || path.join(ROOT, `chrome-export-${Date.now()}.webm`);

function startServer() {
  const server = http.createServer(async (req, res) => {
    let urlPath = decodeURIComponent(req.url.split('?')[0]);
    if (urlPath === '/') urlPath = '/index.html';
    const filePath = path.normalize(path.join(ROOT, urlPath));
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    try {
      const data = await fs.readFile(filePath);
      res.writeHead(200, {
        'Content-Type': filePath.endsWith('.html') ? 'text/html' : 'application/octet-stream'
      });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function waitForDesign(page, timeout = 30000) {
  await page.waitForFunction(() => {
    const root = document.getElementById('root');
    return root && root.children.length && typeof window.__setTime__ === 'function';
  }, null, { timeout });
}

async function encodeFrames(browser, frames, origin) {
  const page = await browser.newPage();
  await page.goto(origin, { waitUntil: 'load' });
  await page.addScriptTag({ url: 'https://cdn.jsdelivr.net/npm/webm-muxer@5.1.4/build/webm-muxer.js' });
  const chunks = [];
  for (let i = 0; i < frames.length; i += 6) {
    chunks.push(frames.slice(i, i + 6).map(buf => buf.toString('base64')));
  }
  const b64 = await page.evaluate(async ({ chunks, width, height, fps }) => {
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
    encoder.configure({ codec: 'vp8', width, height, bitrate: 8000000, framerate: fps });
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    let frameIndex = 0;
    for (const group of chunks) {
      for (const item of group) {
        const bytes = Uint8Array.from(atob(item), c => c.charCodeAt(0));
        const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(bmp, 0, 0, width, height);
        bmp.close();
        const frame = new VideoFrame(canvas, {
          timestamp: Math.round(frameIndex * 1000000 / fps),
          duration: Math.round(1000000 / fps)
        });
        encoder.encode(frame, { keyFrame: frameIndex % fps === 0 });
        frame.close();
        frameIndex++;
      }
    }
    await encoder.flush();
    encoder.close();
    muxer.finalize();
    const out = new Uint8Array(target.buffer);
    let s = '';
    for (let i = 0; i < out.length; i += 8192) {
      s += String.fromCharCode(...out.subarray(i, i + 8192));
    }
    return btoa(s);
  }, { chunks, width: WIDTH, height: HEIGHT, fps: FPS });
  await page.close();
  return Buffer.from(b64, 'base64');
}

(async () => {
  const server = await startServer();
  const port = server.address().port;
  const browser = await chromium.launch({
    headless: true,
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe'
  });
  try {
    const app = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await app.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'load' });
    await app.locator('#fi').setInputFiles(ZIP);
    await app.waitForSelector('#bprev:not([disabled])', { timeout: 30000 });
    const assembledHTML = await app.evaluate(() => assembledHTML);
    await app.close();

    const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
    await page.setContent(assembledHTML, { waitUntil: 'load' });
    await waitForDesign(page);
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
        for (let i = 0; i < 6 && playbackBar; i++) {
          if (playbackBar.querySelector('input[type="range"]')) break;
          playbackBar = playbackBar.parentElement;
        }
        if (playbackBar) playbackBar.remove();
      }
      document.querySelectorAll('input[type="range"]').forEach(el => {
        const bar = el.closest('div');
        if (bar) bar.remove();
      });
      document.documentElement.style.width = innerWidth + 'px';
      document.documentElement.style.height = innerHeight + 'px';
      document.body.style.width = innerWidth + 'px';
      document.body.style.height = innerHeight + 'px';
      document.body.style.overflow = 'hidden';
      window.__pause__ && window.__pause__();
    });

    const total = Math.ceil(DURATION * FPS);
    const frames = [];
    for (let i = 0; i < total; i++) {
      const t = i / FPS;
      await page.evaluate(time => window.__setTime__(time), t);
      await page.waitForTimeout(35);
      frames.push(await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT } }));
      if (i % Math.max(1, Math.round(FPS)) === 0) {
        console.log(`Captured ${i}/${total} frames`);
      }
    }
    await page.close();
    console.log('Encoding WebM...');
    const webm = await encodeFrames(browser, frames, `http://127.0.0.1:${port}/index.html`);
    await fs.writeFile(OUT, webm);
    console.log(`Wrote ${OUT}`);
  } finally {
    await browser.close();
    server.close();
  }
})().catch(err => {
  console.error(err);
  process.exit(1);
});
