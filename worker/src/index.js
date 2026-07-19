const OWNER = "Laxminarayen";
const REPO = "InceptezGenAI-Batch26";
const BRANCH = "main";
const ALLOWED_ORIGINS = new Set([
  "https://laxminarayen.github.io",
  "http://localhost:8000",
  "http://localhost:8080",
  "http://127.0.0.1:8000",
]);
const COLLECTIONS = new Set(["notes", "articles", "questions"]);
const LIMITS = { author: 60, title: 200, body: 8000, comment: 2000 };
const MAX_RETRIES = 5;
const IMAGE_EXT_BY_TYPE = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };
const MAX_IMAGE_BASE64_LEN = 7_000_000; // ~5MB decoded

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.has(origin) ? origin : "https://laxminarayen.github.io";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
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
// `mutate` returns { entry } on success or { notFound: true } to abort.
async function mutateCollection(env, collection, message, mutate) {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const { sha, data } = await ghGetCollection(env, collection);
    const outcome = mutate(data);
    if (outcome.notFound) return { notFound: true };

    const res = await ghPutCollection(env, collection, data, sha, message);
    if (res.ok) return { entry: outcome.entry };
    if (res.status === 409 || res.status === 422) continue;
    throw new Error(`GitHub write failed: ${res.status} ${await res.text()}`);
  }
  throw new Error("Too many conflicting writes, please try again");
}

async function handleGetCollection(env, collection, origin) {
  if (!COLLECTIONS.has(collection)) return json({ error: "Invalid collection" }, 400, origin);
  const { data } = await ghGetCollection(env, collection);
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...corsHeaders(origin) },
  });
}

async function handlePost(request, env, origin) {
  const body = await request.json().catch(() => null);
  if (!body) return json({ error: "Invalid JSON" }, 400, origin);

  const collection = body.collection;
  if (!COLLECTIONS.has(collection)) return json({ error: "Invalid collection" }, 400, origin);

  const author = clean(body.author, LIMITS.author);
  const title = clean(body.title, LIMITS.title);
  const text = clean(body.body, LIMITS.body);
  if (!author || !title || !text) return json({ error: "author, title, and body are required" }, 400, origin);

  const entry = {
    id: genId(),
    author,
    title,
    body: text,
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

async function handleLike(request, env, origin) {
  const body = await request.json().catch(() => null);
  if (!body) return json({ error: "Invalid JSON" }, 400, origin);

  const { collection, postId, anonId } = body;
  if (!COLLECTIONS.has(collection)) return json({ error: "Invalid collection" }, 400, origin);
  if (!postId || !anonId) return json({ error: "postId and anonId are required" }, 400, origin);

  const result = await mutateCollection(env, collection, `forum: toggle like on ${postId}`, (data) => {
    const post = data.find((p) => p.id === postId);
    if (!post) return { notFound: true };
    post.likes = post.likes || [];
    const idx = post.likes.indexOf(anonId);
    if (idx === -1) post.likes.push(String(anonId));
    else post.likes.splice(idx, 1);
    return { entry: { liked: idx === -1, count: post.likes.length } };
  });

  if (result.notFound) return json({ error: "Post not found" }, 404, origin);
  return json(result.entry, 200, origin);
}

async function handleComment(request, env, origin) {
  const body = await request.json().catch(() => null);
  if (!body) return json({ error: "Invalid JSON" }, 400, origin);

  const { collection, postId } = body;
  if (!COLLECTIONS.has(collection)) return json({ error: "Invalid collection" }, 400, origin);
  const author = clean(body.author, LIMITS.author);
  const text = clean(body.body, LIMITS.comment);
  if (!postId || !author || !text) return json({ error: "postId, author, and body are required" }, 400, origin);

  const comment = { id: genId(), author, body: text, createdAt: new Date().toISOString() };

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
  const body = await request.json().catch(() => null);
  if (!body) return json({ error: "Invalid JSON" }, 400, origin);

  const { collection, filename, contentType, dataBase64 } = body;
  if (!COLLECTIONS.has(collection)) return json({ error: "Invalid collection" }, 400, origin);

  const ext = IMAGE_EXT_BY_TYPE[contentType];
  if (!ext) return json({ error: "Unsupported image type. Use PNG, JPEG, WEBP, or GIF." }, 400, origin);

  if (!dataBase64 || typeof dataBase64 !== "string" || dataBase64.length > MAX_IMAGE_BASE64_LEN) {
    return json({ error: "Image is missing or too large (max ~5MB)." }, 400, origin);
  }

  const safeName = clean(filename, 40)
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "image";
  const uniqueId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const path = `data/uploads/${collection}/${uniqueId}-${safeName}.${ext}`;

  const res = await ghRequest(env, path, {
    method: "PUT",
    body: JSON.stringify({
      message: `forum: upload image to ${collection}`,
      content: dataBase64,
      branch: BRANCH,
    }),
  });
  if (!res.ok) return json({ error: `Upload failed: ${res.status} ${await res.text()}` }, 502, origin);

  const url = `https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}/${path}`;
  return json({ url }, 201, origin);
}

export { genId, clean, toBase64Utf8, fromBase64Utf8, ghGetCollection, ghPutCollection, mutateCollection };

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
      const collectionMatch = url.pathname.match(/^\/collection\/([a-z]+)$/);
      if (request.method === "GET" && collectionMatch) {
        return await handleGetCollection(env, collectionMatch[1], origin);
      }
      if (request.method === "POST" && url.pathname === "/post") return await handlePost(request, env, origin);
      if (request.method === "POST" && url.pathname === "/like") return await handleLike(request, env, origin);
      if (request.method === "POST" && url.pathname === "/comment") return await handleComment(request, env, origin);
      if (request.method === "POST" && url.pathname === "/upload") return await handleUpload(request, env, origin);
      return json({ error: "Not found" }, 404, origin);
    } catch (e) {
      return json({ error: e.message || "Server error" }, 500, origin);
    }
  },
};
