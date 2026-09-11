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

## Hackathon leaderboards (Projects tab)

The `projects.html` page runs two Kaggle-style hackathons (Banking, Industry). A submission is a
notebook (`.ipynb`) and a predictions CSV, uploaded together to `POST /projects/:id/submit`; the
Worker scores only the CSV against a hidden answer key and updates
`data/projects/:id-leaderboard.json` in this repo. The answer key itself must **never** be readable
from the public repo, so it lives in Cloudflare KV instead — a private key/value store bound only
to this Worker.

Each student's **notebook** is committed straight into the repo at
`data/projects/<id>/submissions/<github-login>.ipynb`, overwritten on every new submission so it
always reflects their latest attempt — that's where to look when grading.

### One-time setup

1. **Create the KV namespace:**
   ```
   cd worker
   npx wrangler kv namespace create SUBMISSIONS_KV
   ```
   This prints an `id`. Paste it into `wrangler.toml`, replacing `REPLACE_WITH_KV_NAMESPACE_ID`.

2. **Deploy** so the binding takes effect:
   ```
   npx wrangler deploy
   ```

3. **Generate the datasets + answer keys** (if you ever need to regenerate them — the checked-in
   `data/projects/*/train.csv`, `test.csv`, and `sample_submission.csv` were built this way):
   ```
   pip install pandas scikit-learn requests   # if not already installed
   python3 worker/scripts/build_hackathon_datasets.py
   ```
   This downloads the two UCI source datasets fresh, then writes the public CSVs into
   `data/projects/banking/` and `data/projects/industry/`, and the **private** answer keys into
   `worker/private-data/answerkey_banking.json` and `answerkey_industry.json` — that folder is
   gitignored, it must never be committed.

4. **Seed each answer key into KV** (run once per project; re-run any time you regenerate the data):
   ```
   npx wrangler kv key put --binding=SUBMISSIONS_KV "answerkey:banking" --path=private-data/answerkey_banking.json
   npx wrangler kv key put --binding=SUBMISSIONS_KV "answerkey:industry" --path=private-data/answerkey_industry.json
   ```
   Run these from the `worker/` folder. This is the one step that actually contains the "solution" —
   it goes straight from your machine into KV over Wrangler's authenticated API, the same way you
   already handle `GITHUB_TOKEN` as a secret rather than a chat-pasted value.

That's it — submissions to `/projects/:id/submit` will start scoring against the real answer key,
and `GET /projects/:id/leaderboard` will serve the public leaderboard (and reveal private scores
automatically once the deadline in `PROJECTS` inside `src/index.js` has passed).

### If you change the deadline or add a project

Update the `PROJECTS` config in `src/index.js` (deadline, allowed classes, daily submission limit)
**and** the matching `PROJECTS` object at the top of `assets/projects.js` — the front end hardcodes
its own copy so the countdown timer doesn't need an extra network round-trip. Redeploy the Worker
after any change to `src/index.js`.

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
