# Inceptez Forum API (Cloudflare Worker)

This tiny Worker is the write path for Notes, Articles, and Questions on the class site.
The site itself stays static (GitHub Pages); this Worker is the only piece of "backend"
in the whole project, and its only job is: take a form submission from the page, and
commit it as JSON into `data/notes.json`, `data/articles.json`, or `data/questions.json`
in this repo, using a GitHub token that never touches a student's browser.

Reads (loading the feed) also go through this Worker (`GET /collection/:name`), so every
visitor always gets the latest data straight from GitHub — no CDN caching lag.

## One-time setup

You'll need a free Cloudflare account. These steps only need to be done once.

1. **Install wrangler** (Cloudflare's CLI) if you don't already have it:
   ```
   cd worker
   npm install
   ```

2. **Log in to Cloudflare:**
   ```
   npx wrangler login
   ```
   This opens a browser tab to authorize wrangler against your Cloudflare account.

3. **Create a GitHub token the Worker will use to commit on students' behalf.**
   Go to https://github.com/settings/personal-access-tokens/new and create a
   **fine-grained** personal access token:
   - Repository access: **Only select repositories** → `InceptezGenAI-Batch26`
   - Permissions → Repository permissions → **Contents: Read and write**
   - Everything else: no access needed
   - Set an expiration you're comfortable with (you can regenerate and re-run step 4 later)

4. **Store that token as a Worker secret** (never put it in a file that gets committed):
   ```
   npx wrangler secret put GITHUB_TOKEN
   ```
   Paste the token when prompted.

5. **Deploy:**
   ```
   npx wrangler deploy
   ```
   Wrangler will print a URL like `https://inceptez-forum-api.<your-subdomain>.workers.dev`.

6. **Wire the URL into the site.** Open `assets/collections.js` in the repo root and replace:
   ```js
   const API_BASE = "https://inceptez-forum-api.YOUR-SUBDOMAIN.workers.dev";
   ```
   with the real URL from step 5, then commit and push. GitHub Pages will redeploy
   automatically.

## Making changes later

Edit `src/index.js`, then run `npx wrangler deploy` again from the `worker/` folder.
No need to touch Cloudflare's dashboard for routine changes.

## What it does NOT do

- No login/identity verification — the "name" on a post is just what someone typed
  into the form (matches the instructor's choice: simple typed name, no OAuth).
- No spam/rate-limiting beyond basic length limits on each field. For a small class
  this is a reasonable tradeoff; if it ever becomes a problem, the Worker is the
  place to add it (e.g. a per-IP counter in Cloudflare KV).
- Likes are a simple per-browser toggle (stored as an anonymous ID in the visitor's
  `localStorage`), not tied to a verified identity — someone clearing their browser
  data or using a different browser can like the same post again.
