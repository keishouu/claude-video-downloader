# Claude Design Video Exporter

This project has two parts:

- `index.html`: static UI. This can be hosted on GitHub Pages.
- `export-server.js`: Chrome/Playwright render server. This cannot run on GitHub Pages because GitHub Pages only serves static files.

## Local Use

1. Run `run-export-server.cmd`.
2. Open `index.html` in Chrome.
3. Upload a Claude Design `.zip`.
4. Click `Export Video`.

The local renderer runs at:

```text
http://127.0.0.1:5175
```

## GitHub Pages + Hosted Chrome Renderer

GitHub Pages can host the UI, but Chrome render export needs a separate HTTPS backend.

1. Push this repo to GitHub.
2. Enable GitHub Pages for the repo and serve from the branch/root that contains `index.html`.
3. Deploy the backend to a Node host that supports Playwright, such as Render, Railway, Fly.io, or a VPS.
4. Open the GitHub Pages URL with your backend URL in the query string:

```text
https://YOUR_USER.github.io/YOUR_REPO/?exportServer=https%3A%2F%2FYOUR-RENDERER.example.com
```

The page saves that renderer URL in the browser, so your coworkers only need to use the query-string URL once.

If you protect the renderer with a shared token, include it once too:

```text
https://YOUR_USER.github.io/YOUR_REPO/?exportServer=https%3A%2F%2FYOUR-RENDERER.example.com&exportToken=YOUR_SHARED_TOKEN
```

## Render Deploy

This repo includes `render.yaml`. On Render, create a Blueprint from the repo, or create a Web Service manually with:

```text
Build command: npm install && npx playwright install --with-deps chromium
Start command: npm start
```

Set `EXPORT_TOKEN` in the Render environment if you want to require the shared token shown above.

After deploy, test:

```text
https://YOUR-RENDER-SERVICE.onrender.com/health
```

It should return:

```text
ok
```

Use that Render URL as the `exportServer` value for the GitHub Pages site.

## Notes

- A GitHub Pages page is HTTPS, so the shared renderer should also be HTTPS.
- Video rendering is CPU-heavy. Use a paid or always-on service for reliable coworker use.
- Very long or 4K exports may need a larger server plan.
