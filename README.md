# Yuxin Liu — personal website

Static site for GitHub Pages, plus one small Cloudflare Worker that powers the RoboBrain "Try now" demo.

```
index.html            Home: research, projects, publications, experience
robobrain/index.html  RoboBrain project page, architecture diagram, Try now
prefmem/index.html    PrefMem project page, diagrams, results
zh/                   Simplified Chinese pages (generated, see below)
tools/build_zh.py     Builds zh/ from the English pages
config.js             Demo settings (Worker URL, model)
assets/               CSS, JS, self-hosted fonts, images, videos, replay keyframes, CV
worker/               Cloudflare Worker that keeps the OpenAI key secret
```

## 1. Publish on GitHub Pages (5 minutes)

1. Create a **public** repository named `KasLoot.github.io`.
2. Upload everything in this folder, with `index.html` at the top level.
3. In the repository, open **Settings → Pages**, choose **Deploy from a branch**, branch `main`, folder `/ (root)`, and save.
4. After a minute or two the site is live at **https://kasloot.github.io**.

Any other repository name also works (the site then lives at `https://kasloot.github.io/<repo>/`); every link is relative.

Until step 2 is done, the Try now panel works in "use my own OpenAI key" mode only.

## 2. Turn on the demo key (optional, about 10 minutes)

The key must never appear in this repository or in the browser. It lives only as an encrypted secret in the Worker.

### a. OpenAI: a separate project with a hard spending limit

1. On platform.openai.com, create a new project, for example `website-demo`, and create an API key **in that project**.
2. In that project, open **Settings → Limits → Spend**, set a monthly limit (for example $20) and turn on **Enforce a hard limit**. When the limit is reached, OpenAI refuses further requests and the demo tells visitors to use their own key.
3. Keep the key out of chats, emails and files. You paste it only into the `wrangler secret put` prompt below.

### b. Deploy the Worker

You need Node.js and a free Cloudflare account.

```sh
cd worker
npx wrangler login
npx wrangler kv namespace create QUOTA
#   -> paste the printed id into wrangler.toml and uncomment the [[kv_namespaces]] block
npx wrangler secret put OPENAI_API_KEY      # paste the key from step a
npx wrangler secret put TICKET_SECRET       # any long random string, e.g. the output of: openssl rand -hex 32
npx wrangler deploy
```

`wrangler deploy` prints a URL like `https://robobrain-demo.<your-subdomain>.workers.dev`.

1. Open `<that URL>/health`; it should show `"ok": true`.
2. Put the URL in `config.js` as `workerUrl`, commit, and push. GitHub Pages redeploys on its own.

If your site address isn't `https://kasloot.github.io`, add it to `ALLOWED_ORIGINS` in `wrangler.toml` and deploy again.

### c. Optional bot check

In the Cloudflare dashboard, open **Turnstile**, add a widget for `kasloot.github.io`, put the site key in `config.js` as `turnstileSiteKey`, then run `npx wrangler secret put TURNSTILE_SECRET` with the secret key and deploy again.

## Limits and cost

- Defaults, in `wrangler.toml`: 3 runs per visitor per day and 40 runs per day across the site. A run is one generation plus its replay.
- Replaying the same monitor again is served from the KV cache and costs nothing.
- A run makes 1–2 Task Builder calls plus 2–4 vision calls per keyframe (10–12 keyframes). With GPT-6.1 Terra at $1 / $5 per million input / output tokens, expect roughly $0.05–0.10 per run, so a $20 hard limit covers a few hundred runs.

## How the demo works

- `assets/js/rb-core.js` is a JavaScript port of RoboBrain's Task Builder validation, specialist and progress requests, decision rule and progress tracker. The Builder system prompt and draft schema in `assets/js/rb-data.js` are copied verbatim from the RoboBrain repository.
- The Worker accepts only two operations: generate a draft for one of the two bundled clips, and evaluate one bundled keyframe with a draft it signed. It is not a general OpenAI proxy: visitors can't send their own images, and a draft edited after generation is rejected.
- The replay keyframes are masked where the original run's status text was burned into the video, so the model can't read the answer.
- In "own key" mode the visitor's key goes from their browser straight to OpenAI and is kept only in memory for that tab.

## Updating

- Text: edit the HTML files directly.
- Model: change `OPENAI_MODEL` in `wrangler.toml` (then `npx wrangler deploy`) and `model` in `config.js`.
- Replay clips: `assets/js/rb-data.js`, `assets/replay/` and `worker/src/frames.js` are generated together from the masked keyframes. Regenerate all three if you change the clips; raw clips without the burned-in overlay would remove the need for masks.

## Chinese version

The pages in `zh/` are generated from the English pages, so don't edit them by hand.

1. Edit the English page.
2. In `tools/build_zh.py`, update the Chinese text next to the English sentence you changed (or add a new pair).
3. Run `python3 tools/build_zh.py` from the repository root.

If an English sentence has no translation, the script stops and names it, so the two languages can't drift apart. It also lists any English left in the Chinese pages. The demo's interface text lives in `assets/js/trynow-i18n.js`.

Fonts: Newsreader and Inter, self-hosted under the SIL Open Font License (see `assets/fonts`).
