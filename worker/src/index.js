const OWNER = "Laxminarayen";
const REPO = "InceptezGenAI-Batch26";
const BRANCH = "main";
const SITE_ORIGIN = "https://laxminarayen.github.io";
const ALLOWED_ORIGINS = new Set([SITE_ORIGIN, "http://localhost:8000", "http://localhost:8080", "http://127.0.0.1:8000"]);
const COLLECTIONS = new Set(["notes", "articles", "questions"]);
const LIMITS = { title: 200, body: 8000, comment: 2000, classTag: 80 };
const MAX_RETRIES = 5;
const IMAGE_EXT_BY_TYPE = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };
const MAX_IMAGE_BASE64_LEN = 7_000_000; // ~5MB decoded
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14; // 14 days

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

async function ghGetCollection(env, collection) {
  const res = await ghRequest(env, `data/${collection}.json?ref=${BRANCH}`);
  if (res.status === 404) return { sha: null, data: [] };
  if (!res.ok) throw new Error(`GitHub read failed: ${res.status}`);
  const file = await res.json();
  const data = JSON.parse(fromBase64Utf8(file.content));
  return { sha: file.sha, data: Array.isArray(data) ? data : [] };
}

async function ghPutCollection(env, collection, data, sha, message) {
  return ghRequest(env, `data/${collection}.json`, {
    method: "PUT",
    body: JSON.stringify({
      message,
      content: toBase64Utf8(JSON.stringify(data, null, 2)),
      branch: BRANCH,
      ...(sha ? { sha } : {}),
    }),
  });
}

// Reads the collection, applies `mutate(data)`, writes it back.
// Retries on a 409/422 SHA conflict by re-reading and re-applying the mutation.
// `mutate` returns { entry } on success, or { notFound: true } / { forbidden: true } to abort.
async function mutateCollection(env, collection, message, mutate) {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const { sha, data } = await ghGetCollection(env, collection);
    const outcome = mutate(data);
    if (outcome.notFound || outcome.forbidden) return outcome;

    const res = await ghPutCollection(env, collection, data, sha, message);
    if (res.ok) return { entry: outcome.entry };
    if (res.status === 409 || res.status === 422) continue;
    throw new Error(`GitHub write failed: ${res.status} ${await res.text()}`);
  }
  throw new Error("Too many conflicting writes, please try again");
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

  const title = clean(body.title, LIMITS.title);
  const text = clean(body.body, LIMITS.body);
  const classTag = clean(body.classTag, LIMITS.classTag);
  const topics = cleanTopics(body.topics);
  if (!title || !text) return json({ error: "title and body are required" }, 400, origin);

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

  const result = await mutateCollection(env, collection, `forum: edit ${postId}`, (data) => {
    const post = data.find((p) => p.id === postId);
    if (!post) return { notFound: true };
    if (String(post.author).toLowerCase() !== auth.session.login.toLowerCase()) return { forbidden: true };
    post.title = title;
    post.body = text;
    post.classTag = classTag;
    post.topics = topics;
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
      return json({ error: "Not found" }, 404, origin);
    } catch (e) {
      return json({ error: e.message || "Server error" }, 500, origin);
    }
  },
};
