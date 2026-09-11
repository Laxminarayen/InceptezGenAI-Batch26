const OWNER = "Laxminarayen";
const REPO = "InceptezGenAI-Batch26";
const BRANCH = "main";
const SITE_ORIGIN = "https://laxminarayen.github.io";
const ALLOWED_ORIGINS = new Set([SITE_ORIGIN, "http://localhost:8000", "http://localhost:8080", "http://127.0.0.1:8000"]);
const COLLECTIONS = new Set(["notes", "articles", "questions", "tasks"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const LIMITS = { title: 200, body: 8000, comment: 2000, classTag: 80 };
const MAX_RETRIES = 5;
const IMAGE_EXT_BY_TYPE = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };
const MAX_IMAGE_BASE64_LEN = 7_000_000; // ~5MB decoded
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14; // 14 days
const MAX_SUBMISSION_CSV_LEN = 2_000_000; // ~2MB, generous for a two-column id,prediction file
const MAX_NOTEBOOK_BASE64_LEN = 20_000_000; // ~15MB decoded — notebooks with plots can get big
const MAX_NOTE_LEN = 500;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

// ---- Hackathon-style project competitions ----
const PROJECTS = {
  banking: {
    label: "Banking — Customer Campaign Response Prediction",
    classes: ["yes", "no"],
    deadline: "2026-09-19T23:59:59+05:30",
    dailyLimit: 5,
  },
  industry: {
    label: "Industry — Smart Building Occupancy Intelligence",
    classes: ["0", "1", "2", "3"],
    deadline: "2026-09-19T23:59:59+05:30",
    dailyLimit: 5,
  },
};

function istDateKey(ms) {
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
}

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.has(origin) ? origin : SITE_ORIGIN;
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    Vary: "Origin",
  };
}

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
  });
}

function clean(value, maxLen) {
  return String(value == null ? "" : value)
    .trim()
    .slice(0, maxLen);
}

function cleanTopics(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const t of raw) {
    const v = clean(t, 24).toLowerCase();
    if (v && !seen.has(v)) {
      seen.add(v);
      out.push(v);
      if (out.length >= 5) break;
    }
  }
  return out;
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function isInstructor(login) {
  return typeof login === "string" && login.toLowerCase() === OWNER.toLowerCase();
}

function toBase64Utf8(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function fromBase64Utf8(b64) {
  const binary = atob(b64.replace(/\n/g, ""));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function ghRequest(env, path, init = {}) {
  return fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      "User-Agent": "inceptez-forum-worker",
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
}

// Generic versions, keyed by an explicit repo path rather than a fixed `data/{name}.json` shape.
async function ghGetJsonFile(env, path, defaultData) {
  const res = await ghRequest(env, `${path}?ref=${BRANCH}`);
  if (res.status === 404) return { sha: null, data: defaultData };
  if (!res.ok) throw new Error(`GitHub read failed: ${res.status}`);
  const file = await res.json();
  const data = JSON.parse(fromBase64Utf8(file.content));
  return { sha: file.sha, data };
}

async function ghPutJsonFile(env, path, data, sha, message) {
  return ghRequest(env, path, {
    method: "PUT",
    body: JSON.stringify({
      message,
      content: toBase64Utf8(JSON.stringify(data, null, 2)),
      branch: BRANCH,
      ...(sha ? { sha } : {}),
    }),
  });
}

// Reads the file, applies `mutate(data)`, writes it back.
// Retries on a 409/422 SHA conflict by re-reading and re-applying the mutation.
// `mutate` returns { entry } on success, or { notFound: true } / { forbidden: true } to abort.
async function mutateJsonFile(env, path, message, mutate) {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const { sha, data } = await ghGetJsonFile(env, path, []);
    const outcome = mutate(data);
    if (outcome.notFound || outcome.forbidden) return outcome;

    const res = await ghPutJsonFile(env, path, data, sha, message);
    if (res.ok) return { entry: outcome.entry };
    if (res.status === 409 || res.status === 422) continue;
    throw new Error(`GitHub write failed: ${res.status} ${await res.text()}`);
  }
  throw new Error("Too many conflicting writes, please try again");
}

async function ghGetCollection(env, collection) {
  const { sha, data } = await ghGetJsonFile(env, `data/${collection}.json`, []);
  return { sha, data: Array.isArray(data) ? data : [] };
}

async function ghPutCollection(env, collection, data, sha, message) {
  return ghPutJsonFile(env, `data/${collection}.json`, data, sha, message);
}

async function mutateCollection(env, collection, message, mutate) {
  return mutateJsonFile(env, `data/${collection}.json`, message, mutate);
}

// ---- Auth: GitHub OAuth + signed session tokens (JWT-style HS256) ----

function base64UrlEncodeBytes(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlEncodeStr(str) {
  return base64UrlEncodeBytes(new TextEncoder().encode(str));
}

function base64UrlDecodeStr(str) {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  const binary = atob(b64 + pad);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function hmacSha256(message, secret) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return base64UrlEncodeBytes(new Uint8Array(sig));
}

async function createSessionToken(env, user) {
  const header = base64UrlEncodeStr(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const payload = base64UrlEncodeStr(
    JSON.stringify({ login: user.login, avatarUrl: user.avatar_url, iat: now, exp: now + SESSION_TTL_SECONDS })
  );
  const signingInput = `${header}.${payload}`;
  const signature = await hmacSha256(signingInput, env.SESSION_SECRET);
  return `${signingInput}.${signature}`;
}

async function verifySessionToken(token, env) {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts;
  let expected;
  try {
    expected = await hmacSha256(`${header}.${payload}`, env.SESSION_SECRET);
  } catch (e) {
    return null;
  }
  if (expected !== signature) return null;
  try {
    const data = JSON.parse(base64UrlDecodeStr(payload));
    if (!data.login || !data.exp) return null;
    if (Math.floor(Date.now() / 1000) > data.exp) return null;
    return { login: data.login, avatarUrl: data.avatarUrl };
  } catch (e) {
    return null;
  }
}

async function requireSession(request, env, origin) {
  const authHeader = request.headers.get("Authorization") || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return { error: json({ error: "Sign in with GitHub to continue." }, 401, origin) };
  const session = await verifySessionToken(match[1], env);
  if (!session) return { error: json({ error: "Your session expired — please sign in again." }, 401, origin) };
  return { session };
}

function isAllowedRedirect(urlStr) {
  try {
    const u = new URL(urlStr);
    return u.origin === SITE_ORIGIN;
  } catch (e) {
    return false;
  }
}

async function handleAuthCallback(request, env) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const stateRedirect = url.searchParams.get("state") || "";
  const fallback = `${SITE_ORIGIN}/InceptezGenAI-Batch26/index.html`;
  const redirectTo = isAllowedRedirect(stateRedirect) ? stateRedirect : fallback;

  if (!code) return Response.redirect(`${fallback}#auth-error=missing_code`, 302);

  try {
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        client_id: env.GITHUB_OAUTH_CLIENT_ID,
        client_secret: env.GITHUB_OAUTH_CLIENT_SECRET,
        code,
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      const dest = new URL(redirectTo);
      const message = tokenData.error_description || tokenData.error || `login_failed (http ${tokenRes.status})`;
      dest.hash = `auth-error=${encodeURIComponent(message)}`;
      return Response.redirect(dest.toString(), 302);
    }

    const userRes = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        "User-Agent": "inceptez-forum-worker",
        Accept: "application/vnd.github+json",
      },
    });
    if (!userRes.ok) throw new Error(`GitHub /user failed: ${userRes.status}`);
    const user = await userRes.json();

    const sessionToken = await createSessionToken(env, user);
    const dest = new URL(redirectTo);
    dest.hash = `auth=${sessionToken}`;
    return Response.redirect(dest.toString(), 302);
  } catch (e) {
    const dest = new URL(redirectTo);
    dest.hash = `auth-error=${encodeURIComponent(e.message || "login_failed")}`;
    return Response.redirect(dest.toString(), 302);
  }
}

// ---- Collection handlers ----

async function handleGetCollection(env, collection, origin) {
  if (!COLLECTIONS.has(collection)) return json({ error: "Invalid collection" }, 400, origin);
  const { data } = await ghGetCollection(env, collection);
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...corsHeaders(origin) },
  });
}

async function handlePost(request, env, origin) {
  const auth = await requireSession(request, env, origin);
  if (auth.error) return auth.error;

  const body = await request.json().catch(() => null);
  if (!body) return json({ error: "Invalid JSON" }, 400, origin);

  const collection = body.collection;
  if (!COLLECTIONS.has(collection)) return json({ error: "Invalid collection" }, 400, origin);

  if (collection === "tasks" && !isInstructor(auth.session.login)) {
    return json({ error: "Only the instructor can post tasks." }, 403, origin);
  }

  const title = clean(body.title, LIMITS.title);
  const text = clean(body.body, LIMITS.body);
  const classTag = clean(body.classTag, LIMITS.classTag);
  const topics = cleanTopics(body.topics);
  if (!title || !text) return json({ error: "title and body are required" }, 400, origin);

  let taskDate;
  if (collection === "tasks") {
    taskDate = clean(body.date, 10);
    if (!DATE_RE.test(taskDate)) return json({ error: "A valid date (YYYY-MM-DD) is required" }, 400, origin);
  }

  const entry = {
    id: genId(),
    author: auth.session.login,
    authorAvatar: auth.session.avatarUrl,
    title,
    body: text,
    classTag,
    topics,
    createdAt: new Date().toISOString(),
    likes: [],
    comments: [],
    ...(taskDate ? { date: taskDate } : {}),
  };

  const result = await mutateCollection(env, collection, `forum: add ${collection.slice(0, -1)} "${title}"`, (data) => {
    data.unshift(entry);
    return { entry };
  });

  return json(result.entry, 201, origin);
}

async function handleEdit(request, env, origin) {
  const auth = await requireSession(request, env, origin);
  if (auth.error) return auth.error;

  const body = await request.json().catch(() => null);
  if (!body) return json({ error: "Invalid JSON" }, 400, origin);

  const { collection, postId } = body;
  if (!COLLECTIONS.has(collection)) return json({ error: "Invalid collection" }, 400, origin);

  const title = clean(body.title, LIMITS.title);
  const text = clean(body.body, LIMITS.body);
  const classTag = clean(body.classTag, LIMITS.classTag);
  const topics = cleanTopics(body.topics);
  if (!title || !text) return json({ error: "title and body are required" }, 400, origin);

  let taskDate;
  if (collection === "tasks" && body.date !== undefined) {
    taskDate = clean(body.date, 10);
    if (!DATE_RE.test(taskDate)) return json({ error: "A valid date (YYYY-MM-DD) is required" }, 400, origin);
  }

  const result = await mutateCollection(env, collection, `forum: edit ${postId}`, (data) => {
    const post = data.find((p) => p.id === postId);
    if (!post) return { notFound: true };
    if (String(post.author).toLowerCase() !== auth.session.login.toLowerCase()) return { forbidden: true };
    post.title = title;
    post.body = text;
    post.classTag = classTag;
    post.topics = topics;
    if (taskDate) post.date = taskDate;
    post.editedAt = new Date().toISOString();
    return { entry: post };
  });

  if (result.notFound) return json({ error: "Post not found" }, 404, origin);
  if (result.forbidden) return json({ error: "You can only edit your own posts." }, 403, origin);
  return json(result.entry, 200, origin);
}

async function handleDelete(request, env, origin) {
  const auth = await requireSession(request, env, origin);
  if (auth.error) return auth.error;

  const body = await request.json().catch(() => null);
  if (!body) return json({ error: "Invalid JSON" }, 400, origin);

  const { collection, postId } = body;
  if (!COLLECTIONS.has(collection)) return json({ error: "Invalid collection" }, 400, origin);
  if (!postId) return json({ error: "postId is required" }, 400, origin);

  const result = await mutateCollection(env, collection, `forum: delete ${postId}`, (data) => {
    const idx = data.findIndex((p) => p.id === postId);
    if (idx === -1) return { notFound: true };
    if (String(data[idx].author).toLowerCase() !== auth.session.login.toLowerCase()) return { forbidden: true };
    data.splice(idx, 1);
    return { entry: { deleted: true, postId } };
  });

  if (result.notFound) return json({ error: "Post not found" }, 404, origin);
  if (result.forbidden) return json({ error: "You can only delete your own posts." }, 403, origin);
  return json(result.entry, 200, origin);
}

async function handleLike(request, env, origin) {
  const auth = await requireSession(request, env, origin);
  if (auth.error) return auth.error;

  const body = await request.json().catch(() => null);
  if (!body) return json({ error: "Invalid JSON" }, 400, origin);

  const { collection, postId } = body;
  if (!COLLECTIONS.has(collection)) return json({ error: "Invalid collection" }, 400, origin);
  if (!postId) return json({ error: "postId is required" }, 400, origin);

  const login = auth.session.login;
  const result = await mutateCollection(env, collection, `forum: toggle like on ${postId}`, (data) => {
    const post = data.find((p) => p.id === postId);
    if (!post) return { notFound: true };
    post.likes = post.likes || [];
    const idx = post.likes.findIndex((l) => String(l).toLowerCase() === login.toLowerCase());
    if (idx === -1) post.likes.push(login);
    else post.likes.splice(idx, 1);
    return { entry: { liked: idx === -1, count: post.likes.length } };
  });

  if (result.notFound) return json({ error: "Post not found" }, 404, origin);
  return json(result.entry, 200, origin);
}

async function handleComment(request, env, origin) {
  const auth = await requireSession(request, env, origin);
  if (auth.error) return auth.error;

  const body = await request.json().catch(() => null);
  if (!body) return json({ error: "Invalid JSON" }, 400, origin);

  const { collection, postId } = body;
  if (!COLLECTIONS.has(collection)) return json({ error: "Invalid collection" }, 400, origin);
  const text = clean(body.body, LIMITS.comment);
  if (!postId || !text) return json({ error: "postId and body are required" }, 400, origin);

  const comment = {
    id: genId(),
    author: auth.session.login,
    authorAvatar: auth.session.avatarUrl,
    body: text,
    createdAt: new Date().toISOString(),
  };

  const result = await mutateCollection(env, collection, `forum: add comment on ${postId}`, (data) => {
    const post = data.find((p) => p.id === postId);
    if (!post) return { notFound: true };
    post.comments = post.comments || [];
    post.comments.push(comment);
    return { entry: comment };
  });

  if (result.notFound) return json({ error: "Post not found" }, 404, origin);
  return json(result.entry, 201, origin);
}

async function handleUpload(request, env, origin) {
  const auth = await requireSession(request, env, origin);
  if (auth.error) return auth.error;

  const body = await request.json().catch(() => null);
  if (!body) return json({ error: "Invalid JSON" }, 400, origin);

  const { collection, filename, contentType, dataBase64 } = body;
  if (!COLLECTIONS.has(collection)) return json({ error: "Invalid collection" }, 400, origin);

  const ext = IMAGE_EXT_BY_TYPE[contentType];
  if (!ext) return json({ error: "Unsupported image type. Use PNG, JPEG, WEBP, or GIF." }, 400, origin);

  if (!dataBase64 || typeof dataBase64 !== "string" || dataBase64.length > MAX_IMAGE_BASE64_LEN) {
    return json({ error: "Image is missing or too large (max ~5MB)." }, 400, origin);
  }

  const safeName =
    clean(filename, 40)
      .toLowerCase()
      .replace(/\.[a-z0-9]+$/, "")
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "image";
  const uniqueId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const path = `data/uploads/${collection}/${uniqueId}-${safeName}.${ext}`;

  const res = await ghRequest(env, path, {
    method: "PUT",
    body: JSON.stringify({ message: `forum: upload image to ${collection}`, content: dataBase64, branch: BRANCH }),
  });
  if (!res.ok) return json({ error: `Upload failed: ${res.status} ${await res.text()}` }, 502, origin);

  const url = `https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}/${path}`;
  return json({ url }, 201, origin);
}

// ---- Hackathon project submissions ----

// Parses a two-column `id,prediction` CSV. Tolerant of an optional header row,
// CRLF/CR/LF line endings, and blank lines. Returns { preds: Map<id,rawPrediction> } or { error }.
function parseSubmissionCsv(csvText) {
  const lines = csvText
    .split(/\r\n|\r|\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return { error: "The submission file is empty." };

  let start = 0;
  const firstCols = lines[0].split(",").map((s) => s.trim().toLowerCase());
  if (firstCols[0] === "id") start = 1;

  const preds = new Map();
  for (let i = start; i < lines.length; i++) {
    const commaIdx = lines[i].indexOf(",");
    if (commaIdx === -1) continue;
    const id = lines[i].slice(0, commaIdx).trim();
    const pred = lines[i].slice(commaIdx + 1).trim();
    if (!id) continue;
    preds.set(id, pred);
  }
  if (preds.size === 0) return { error: "No id,prediction rows were found in the file." };
  return { preds };
}

// Matches a raw prediction string against the project's allowed class labels,
// case-insensitively, with a numeric fallback (e.g. "2.0" -> "2") for numeric classes.
function normalizePrediction(raw, classes) {
  const v = String(raw ?? "").trim();
  const lowerClasses = classes.map((c) => c.toLowerCase());
  const idx = lowerClasses.indexOf(v.toLowerCase());
  if (idx !== -1) return classes[idx];
  if (classes.every((c) => /^\d+$/.test(c))) {
    const n = Number(v);
    if (Number.isFinite(n)) {
      const rounded = String(Math.round(n));
      if (classes.includes(rounded)) return rounded;
    }
  }
  return null;
}

// Cross-checks a parsed submission against the full set of test ids, requiring exact
// 1:1 coverage (Kaggle-style: every test row must get exactly one valid prediction).
function validateSubmission(preds, answerKey, classes) {
  const answerIds = Object.keys(answerKey);
  const missing = [];
  const invalid = [];
  const normalized = new Map();

  for (const id of answerIds) {
    if (!preds.has(id)) {
      missing.push(id);
      continue;
    }
    const norm = normalizePrediction(preds.get(id), classes);
    if (norm === null) {
      invalid.push({ id, value: preds.get(id) });
      continue;
    }
    normalized.set(id, norm);
  }
  const extra = [...preds.keys()].filter((id) => !(id in answerKey));

  if (missing.length > 0) {
    return { error: `Missing predictions for ${missing.length} row id(s), e.g. ${missing.slice(0, 5).join(", ")}. Every id in test.csv must appear exactly once.` };
  }
  if (invalid.length > 0) {
    const sample = invalid.slice(0, 5).map((x) => `${x.id}="${x.value}"`).join(", ");
    return { error: `${invalid.length} row(s) have a prediction outside the allowed values (${classes.join(", ")}), e.g. ${sample}.` };
  }
  if (extra.length > 100) {
    return { error: `Found ${extra.length} row ids that don't belong to this project's test.csv. Make sure you're submitting the right file.` };
  }

  return { normalized };
}

// Macro-averaged precision/recall/F1 (unweighted mean across classes) plus accuracy
// and a confusion matrix. `pairs` is an array of [actualLabel, predictedLabel].
function computeScores(pairs, classes) {
  const tp = Object.fromEntries(classes.map((c) => [c, 0]));
  const fp = Object.fromEntries(classes.map((c) => [c, 0]));
  const fn = Object.fromEntries(classes.map((c) => [c, 0]));
  const confusion = Object.fromEntries(classes.map((c) => [c, Object.fromEntries(classes.map((c2) => [c2, 0]))]));
  let correct = 0;

  for (const [actual, predicted] of pairs) {
    confusion[actual][predicted] += 1;
    if (predicted === actual) {
      tp[actual] += 1;
      correct += 1;
    } else {
      fp[predicted] += 1;
      fn[actual] += 1;
    }
  }

  const perClass = {};
  let f1Sum = 0;
  for (const c of classes) {
    const precision = tp[c] + fp[c] > 0 ? tp[c] / (tp[c] + fp[c]) : 0;
    const recall = tp[c] + fn[c] > 0 ? tp[c] / (tp[c] + fn[c]) : 0;
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
    perClass[c] = { precision, recall, f1, support: tp[c] + fn[c] };
    f1Sum += f1;
  }

  return {
    rows: pairs.length,
    accuracy: pairs.length > 0 ? correct / pairs.length : 0,
    macroF1: classes.length > 0 ? f1Sum / classes.length : 0,
    perClass,
    confusion,
  };
}

// Sanity-checks that a base64 blob decodes to something structurally shaped like a
// Jupyter notebook (JSON with a `cells` array and an `nbformat` field), without fully
// validating cell contents — enough to reject an obviously wrong file (PDF export, etc).
function validateNotebookBase64(base64) {
  let text;
  try {
    text = fromBase64Utf8(base64);
  } catch (e) {
    return { error: "Couldn't read the notebook file — make sure it's a valid .ipynb." };
  }
  let nb;
  try {
    nb = JSON.parse(text);
  } catch (e) {
    return { error: "That doesn't look like a valid Jupyter notebook (.ipynb) — it isn't valid JSON." };
  }
  if (!nb || typeof nb !== "object" || !Array.isArray(nb.cells) || nb.nbformat === undefined) {
    return { error: "That doesn't look like a valid Jupyter notebook (.ipynb) — missing the expected cells/nbformat structure." };
  }
  return { ok: true };
}

async function ghGetFileSha(env, path) {
  const res = await ghRequest(env, `${path}?ref=${BRANCH}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub read failed: ${res.status}`);
  const file = await res.json();
  return file.sha;
}

async function handleSubmitProject(request, env, origin, projectId) {
  const auth = await requireSession(request, env, origin);
  if (auth.error) return auth.error;

  const project = PROJECTS[projectId];
  if (!project) return json({ error: "Unknown project" }, 404, origin);

  const body = await request.json().catch(() => null);
  if (!body || typeof body.csv !== "string") return json({ error: "Missing csv field" }, 400, origin);
  if (body.csv.length > MAX_SUBMISSION_CSV_LEN) {
    return json({ error: "Submission file is too large." }, 400, origin);
  }
  if (!body.notebookBase64 || typeof body.notebookBase64 !== "string") {
    return json({ error: "A submission needs both your notebook (.ipynb) and a predictions CSV — the notebook is missing." }, 400, origin);
  }
  if (body.notebookBase64.length > MAX_NOTEBOOK_BASE64_LEN) {
    return json({ error: "Notebook file is too large (max ~15MB)." }, 400, origin);
  }
  const notebookCheck = validateNotebookBase64(body.notebookBase64);
  if (notebookCheck.error) return json({ error: notebookCheck.error }, 400, origin);

  const now = Date.now();
  const deadlineMs = Date.parse(project.deadline);
  if (now > deadlineMs) {
    return json({ error: `Submissions for ${project.label} closed on ${project.deadline}.` }, 403, origin);
  }

  const login = auth.session.login;
  const countKey = `subcount:${projectId}:${login.toLowerCase()}:${istDateKey(now)}`;
  const countRaw = await env.SUBMISSIONS_KV.get(countKey);
  const countSoFar = countRaw ? parseInt(countRaw, 10) : 0;
  if (countSoFar >= project.dailyLimit) {
    return json({ error: `Daily submission limit reached (${project.dailyLimit}/day). Try again after midnight IST.` }, 429, origin);
  }

  const answerKeyRaw = await env.SUBMISSIONS_KV.get(`answerkey:${projectId}`);
  if (!answerKeyRaw) return json({ error: "This project's answer key isn't configured yet — ask the instructor." }, 503, origin);
  const answerKey = JSON.parse(answerKeyRaw);

  const parsed = parseSubmissionCsv(body.csv);
  if (parsed.error) return json({ error: parsed.error }, 400, origin);

  const validation = validateSubmission(parsed.preds, answerKey, project.classes);
  if (validation.error) return json({ error: validation.error }, 400, origin);

  const publicPairs = [];
  const privatePairs = [];
  for (const [id, entry] of Object.entries(answerKey)) {
    const pair = [entry.label, validation.normalized.get(id)];
    (entry.fold === "public" ? publicPairs : privatePairs).push(pair);
  }

  const publicScore = computeScores(publicPairs, project.classes);
  const privateScore = computeScores(privatePairs, project.classes);
  const nowIso = new Date(now).toISOString();

  // Save the notebook privately in KV — overwrites this student's previous attempt for this
  // project, so it always holds their latest submission. It stays hidden from the public repo
  // (and from other students) until the instructor explicitly releases it — see
  // handleReleaseNotebooks. The instructor can always view/download it via the instructor-only
  // submissions endpoints below, regardless of release state.
  const notebookRecord = {
    login,
    filename: clean(body.notebookFilename, 200) || "notebook.ipynb",
    contentBase64: body.notebookBase64,
    note: clean(body.note, MAX_NOTE_LEN),
    submittedAt: nowIso,
  };
  await env.SUBMISSIONS_KV.put(`notebook:${projectId}:${login.toLowerCase()}`, JSON.stringify(notebookRecord));

  await env.SUBMISSIONS_KV.put(countKey, String(countSoFar + 1), { expirationTtl: 60 * 60 * 24 * 2 });

  const bestKey = `best:${projectId}:${login.toLowerCase()}`;
  const prevBestRaw = await env.SUBMISSIONS_KV.get(bestKey);
  const prevBest = prevBestRaw ? JSON.parse(prevBestRaw) : null;
  const isNewBest = !prevBest || publicScore.macroF1 > prevBest.publicScore.macroF1;
  const submissionCount = (prevBest ? prevBest.submissionCount : 0) + 1;

  const bestRecord = isNewBest
    ? { login, avatarUrl: auth.session.avatarUrl, publicScore, privateScore, submittedAt: nowIso, submissionCount }
    : { ...prevBest, submissionCount };
  await env.SUBMISSIONS_KV.put(bestKey, JSON.stringify(bestRecord));

  if (isNewBest) {
    await mutateJsonFile(env, `data/projects/${projectId}-leaderboard.json`, `projects: update ${projectId} leaderboard for ${login}`, (data) => {
      const idx = data.findIndex((e) => String(e.login).toLowerCase() === login.toLowerCase());
      const entry = {
        login,
        avatarUrl: auth.session.avatarUrl,
        publicAccuracy: publicScore.accuracy,
        publicMacroF1: publicScore.macroF1,
        submissionCount,
        submittedAt: nowIso,
      };
      if (idx === -1) data.push(entry);
      else data[idx] = entry;
      return { entry };
    });
  }

  return json(
    {
      project: projectId,
      isNewBest,
      notebookSaved: true,
      submissionsToday: countSoFar + 1,
      submissionsRemaining: Math.max(0, project.dailyLimit - (countSoFar + 1)),
      deadline: project.deadline,
      public: publicScore,
    },
    200,
    origin
  );
}

async function handleProjectLeaderboard(env, origin, projectId) {
  const project = PROJECTS[projectId];
  if (!project) return json({ error: "Unknown project" }, 404, origin);

  const { data } = await ghGetJsonFile(env, `data/projects/${projectId}-leaderboard.json`, []);
  const revealed = Date.now() > Date.parse(project.deadline);

  let rows = Array.isArray(data) ? data.map((e) => ({ ...e })) : [];

  if (revealed) {
    const withPrivate = [];
    for (const e of rows) {
      const bestRaw = await env.SUBMISSIONS_KV.get(`best:${projectId}:${String(e.login).toLowerCase()}`);
      const best = bestRaw ? JSON.parse(bestRaw) : null;
      withPrivate.push({
        ...e,
        privateAccuracy: best ? best.privateScore.accuracy : null,
        privateMacroF1: best ? best.privateScore.macroF1 : null,
      });
    }
    withPrivate.sort((a, b) => (b.privateMacroF1 ?? -1) - (a.privateMacroF1 ?? -1));
    rows = withPrivate;
  } else {
    rows.sort((a, b) => b.publicMacroF1 - a.publicMacroF1);
  }

  rows = rows.map((e, i) => ({ rank: i + 1, ...e }));

  return new Response(JSON.stringify({ project: projectId, revealed, deadline: project.deadline, rows }), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...corsHeaders(origin) },
  });
}

function handleProjectsMeta(origin) {
  const meta = {};
  for (const [id, p] of Object.entries(PROJECTS)) {
    meta[id] = { label: p.label, classes: p.classes, deadline: p.deadline, dailyLimit: p.dailyLimit };
  }
  return json(meta, 200, origin);
}

// ---- Instructor-only: view/download/release student notebooks ----
// These bypass the deadline entirely — the instructor can see everything at any time.
// Only handleReleaseNotebooks actually publishes notebooks into the public repo, and only
// when the instructor deliberately calls it (never automatic).

async function requireInstructor(request, env, origin) {
  const auth = await requireSession(request, env, origin);
  if (auth.error) return { error: auth.error };
  if (!isInstructor(auth.session.login)) return { error: json({ error: "Instructor only." }, 403, origin) };
  return { session: auth.session };
}

async function handleListSubmissions(request, env, origin, projectId) {
  const project = PROJECTS[projectId];
  if (!project) return json({ error: "Unknown project" }, 404, origin);
  const authCheck = await requireInstructor(request, env, origin);
  if (authCheck.error) return authCheck.error;

  const list = await env.SUBMISSIONS_KV.list({ prefix: `notebook:${projectId}:` });
  const rows = [];
  for (const key of list.keys) {
    const raw = await env.SUBMISSIONS_KV.get(key.name);
    if (!raw) continue;
    const record = JSON.parse(raw);
    const bestRaw = await env.SUBMISSIONS_KV.get(`best:${projectId}:${record.login.toLowerCase()}`);
    const best = bestRaw ? JSON.parse(bestRaw) : null;
    const releasedSha = await ghGetFileSha(env, `data/projects/${projectId}/submissions/${record.login.toLowerCase()}.ipynb`);
    rows.push({
      login: record.login,
      filename: record.filename,
      note: record.note || "",
      submittedAt: record.submittedAt,
      publicMacroF1: best ? best.publicScore.macroF1 : null,
      privateMacroF1: best ? best.privateScore.macroF1 : null,
      submissionCount: best ? best.submissionCount : null,
      released: !!releasedSha,
    });
  }
  rows.sort((a, b) => (b.publicMacroF1 ?? -1) - (a.publicMacroF1 ?? -1));
  return json({ project: projectId, rows }, 200, origin);
}

async function handleDownloadNotebook(request, env, origin, projectId, login) {
  const project = PROJECTS[projectId];
  if (!project) return json({ error: "Unknown project" }, 404, origin);
  const authCheck = await requireInstructor(request, env, origin);
  if (authCheck.error) return authCheck.error;

  const raw = await env.SUBMISSIONS_KV.get(`notebook:${projectId}:${login.toLowerCase()}`);
  if (!raw) return json({ error: "No notebook found for that student." }, 404, origin);
  const record = JSON.parse(raw);
  const binary = atob(record.contentBase64);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": "application/x-ipynb+json",
      "Content-Disposition": `attachment; filename="${record.filename || `${login}.ipynb`}"`,
      ...corsHeaders(origin),
    },
  });
}

async function releaseAllNotebooks(env, projectId) {
  const list = await env.SUBMISSIONS_KV.list({ prefix: `notebook:${projectId}:` });
  let released = 0;
  let skipped = 0;
  for (const key of list.keys) {
    const raw = await env.SUBMISSIONS_KV.get(key.name);
    if (!raw) continue;
    const record = JSON.parse(raw);
    const notebookPath = `data/projects/${projectId}/submissions/${record.login.toLowerCase()}.ipynb`;
    const existingSha = await ghGetFileSha(env, notebookPath);
    if (existingSha) {
      skipped++;
      continue;
    }
    const res = await ghRequest(env, notebookPath, {
      method: "PUT",
      body: JSON.stringify({
        message: `projects: release ${projectId} notebook for ${record.login}`,
        content: record.contentBase64,
        branch: BRANCH,
      }),
    });
    if (res.ok) released++;
  }
  return { released, skipped };
}

async function handleReleaseNotebooks(request, env, origin, projectId) {
  const project = PROJECTS[projectId];
  if (!project) return json({ error: "Unknown project" }, 404, origin);
  const authCheck = await requireInstructor(request, env, origin);
  if (authCheck.error) return authCheck.error;

  const result = await releaseAllNotebooks(env, projectId);
  return json({ project: projectId, ...result }, 200, origin);
}

export {
  genId,
  clean,
  cleanTopics,
  toBase64Utf8,
  fromBase64Utf8,
  ghGetCollection,
  ghPutCollection,
  mutateCollection,
  createSessionToken,
  verifySessionToken,
};

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    const url = new URL(request.url);
    try {
      if (request.method === "GET" && url.pathname === "/health") {
        return json({ ok: true }, 200, origin);
      }
      if (request.method === "GET" && url.pathname === "/auth/callback") {
        return await handleAuthCallback(request, env);
      }
      const collectionMatch = url.pathname.match(/^\/collection\/([a-z]+)$/);
      if (request.method === "GET" && collectionMatch) {
        return await handleGetCollection(env, collectionMatch[1], origin);
      }
      if (request.method === "POST" && url.pathname === "/post") return await handlePost(request, env, origin);
      if (request.method === "POST" && url.pathname === "/edit") return await handleEdit(request, env, origin);
      if (request.method === "POST" && url.pathname === "/delete") return await handleDelete(request, env, origin);
      if (request.method === "POST" && url.pathname === "/like") return await handleLike(request, env, origin);
      if (request.method === "POST" && url.pathname === "/comment") return await handleComment(request, env, origin);
      if (request.method === "POST" && url.pathname === "/upload") return await handleUpload(request, env, origin);
      if (request.method === "GET" && url.pathname === "/projects/meta") return handleProjectsMeta(origin);
      const submitMatch = url.pathname.match(/^\/projects\/([a-z]+)\/submit$/);
      if (request.method === "POST" && submitMatch) return await handleSubmitProject(request, env, origin, submitMatch[1]);
      const leaderboardMatch = url.pathname.match(/^\/projects\/([a-z]+)\/leaderboard$/);
      if (request.method === "GET" && leaderboardMatch) return await handleProjectLeaderboard(env, origin, leaderboardMatch[1]);
      const submissionsMatch = url.pathname.match(/^\/projects\/([a-z]+)\/submissions$/);
      if (request.method === "GET" && submissionsMatch) return await handleListSubmissions(request, env, origin, submissionsMatch[1]);
      const notebookMatch = url.pathname.match(/^\/projects\/([a-z]+)\/submissions\/([A-Za-z0-9-]+)\/notebook$/);
      if (request.method === "GET" && notebookMatch) return await handleDownloadNotebook(request, env, origin, notebookMatch[1], notebookMatch[2]);
      const releaseMatch = url.pathname.match(/^\/projects\/([a-z]+)\/release-notebooks$/);
      if (request.method === "POST" && releaseMatch) return await handleReleaseNotebooks(request, env, origin, releaseMatch[1]);
      return json({ error: "Not found" }, 404, origin);
    } catch (e) {
      return json({ error: e.message || "Server error" }, 500, origin);
    }
  },
};
