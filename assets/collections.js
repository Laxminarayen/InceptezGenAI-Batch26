(function () {
  // After running `wrangler deploy` in worker/, replace this with your Worker's URL.
  const API_BASE = "https://inceptez-forum-api.YOUR-SUBDOMAIN.workers.dev";

  const INSTRUCTOR_LOGIN = "laxminarayen";
  const ANON_KEY = "forum-anon-id";

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
    return div.innerHTML;
  }

  function isInstructor(name) {
    return typeof name === "string" && name.trim().toLowerCase() === INSTRUCTOR_LOGIN;
  }

  function instructorBadge(name) {
    return isInstructor(name) ? '<span class="instructor-badge">🎓 Instructor</span>' : "";
  }

  function formatDate(iso) {
    return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  }

  function previewText(body, maxLen) {
    if (!body) return "";
    const stripped = body
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/[#*_>`~-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return stripped.length > maxLen ? stripped.slice(0, maxLen).trim() + "…" : stripped;
  }

  function getAnonId() {
    let id = localStorage.getItem(ANON_KEY);
    if (!id) {
      id = "anon-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
      localStorage.setItem(ANON_KEY, id);
    }
    return id;
  }

  async function apiPost(path, payload) {
    const res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  function renderComment(c) {
    return `
      <li class="comment-item">
        <span class="comment-author">@${escapeHtml(c.author)}</span> ${instructorBadge(c.author)}
        <span class="comment-date">${formatDate(c.createdAt)}</span>
        <p class="comment-body">${escapeHtml(c.body)}</p>
      </li>`;
  }

  function renderPost(post, config) {
    const anonId = getAnonId();
    const liked = (post.likes || []).includes(anonId);
    const likeCount = (post.likes || []).length;
    const commentCount = (post.comments || []).length;
    const preview = previewText(post.body, 320);
    const comments = (post.comments || []).map(renderComment).join("");

    return `
      <article class="post-card" data-post-id="${escapeHtml(post.id)}">
        <header class="note-header">
          <span class="note-author">@${escapeHtml(post.author)}</span>
          ${instructorBadge(post.author)}
          <span class="note-date">${formatDate(post.createdAt)}</span>
        </header>
        <h3 class="post-title">${escapeHtml(post.title)}</h3>
        <p class="note-preview post-body">${escapeHtml(preview)}</p>
        <footer class="article-actions">
          <button type="button" class="clap-btn ${liked ? "is-clapped" : ""}" data-action="like" aria-pressed="${liked}">
            ${config.reactionEmoji} <span class="clap-count">${likeCount}</span>
          </button>
          <button type="button" class="share-btn" data-action="share" data-title="${escapeHtml(post.title)}">
            🔗 Share
          </button>
          <button type="button" class="comment-link" data-action="toggle-comments" style="background:none;border:none;cursor:pointer;font:inherit;">
            💬 ${commentCount} ${config.answerNoun}
          </button>
        </footer>
        <div class="comment-section" hidden>
          <ul class="comment-list">${comments || `<li class="comment-empty">No ${config.answerNoun.toLowerCase()} yet.</li>`}</ul>
          <form class="comment-form">
            <input type="text" name="author" class="comment-input" placeholder="Your name" maxlength="60" required />
            <textarea name="body" class="comment-input" placeholder="Write a reply…" maxlength="2000" rows="2" required></textarea>
            <button type="submit" class="btn btn-secondary">Reply</button>
            <span class="form-status"></span>
          </form>
        </div>
      </article>`;
  }

  function wirePostActions(card, post, config, app) {
    const postId = post.id;

    const likeBtn = card.querySelector('[data-action="like"]');
    likeBtn.addEventListener("click", async () => {
      const wasLiked = likeBtn.classList.contains("is-clapped");
      const countEl = likeBtn.querySelector(".clap-count");
      const optimisticCount = parseInt(countEl.textContent, 10) + (wasLiked ? -1 : 1);
      likeBtn.classList.toggle("is-clapped", !wasLiked);
      likeBtn.setAttribute("aria-pressed", String(!wasLiked));
      countEl.textContent = optimisticCount;
      likeBtn.disabled = true;
      try {
        const result = await apiPost("/like", { collection: config.collection, postId, anonId: getAnonId() });
        countEl.textContent = result.count;
        likeBtn.classList.toggle("is-clapped", result.liked);
        likeBtn.setAttribute("aria-pressed", String(result.liked));
      } catch (e) {
        likeBtn.classList.toggle("is-clapped", wasLiked);
        likeBtn.setAttribute("aria-pressed", String(wasLiked));
        countEl.textContent = parseInt(countEl.textContent, 10) + (wasLiked ? 1 : -1);
      } finally {
        likeBtn.disabled = false;
      }
    });

    const shareBtn = card.querySelector('[data-action="share"]');
    shareBtn.addEventListener("click", async () => {
      const url = `${location.origin}${location.pathname}#post-${postId}`;
      const title = shareBtn.dataset.title;
      if (navigator.share) {
        try {
          await navigator.share({ title, url });
          return;
        } catch (e) {
          return;
        }
      }
      try {
        await navigator.clipboard.writeText(url);
        const original = shareBtn.textContent;
        shareBtn.textContent = "✅ Copied!";
        setTimeout(() => (shareBtn.textContent = original), 1500);
      } catch (e) {
        /* clipboard unavailable, nothing more we can do silently */
      }
    });

    const toggleBtn = card.querySelector('[data-action="toggle-comments"]');
    const section = card.querySelector(".comment-section");
    toggleBtn.addEventListener("click", () => {
      section.hidden = !section.hidden;
    });

    const commentForm = card.querySelector(".comment-form");
    commentForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const author = commentForm.author.value.trim();
      const body = commentForm.body.value.trim();
      const statusEl = commentForm.querySelector(".form-status");
      if (!author || !body) return;
      const submitBtn = commentForm.querySelector("button[type=submit]");
      submitBtn.disabled = true;
      statusEl.textContent = "Posting…";
      try {
        const comment = await apiPost("/comment", { collection: config.collection, postId, author, body });
        const list = card.querySelector(".comment-list");
        const empty = list.querySelector(".comment-empty");
        if (empty) empty.remove();
        list.insertAdjacentHTML("beforeend", renderComment(comment));
        const countSpan = card.querySelector('[data-action="toggle-comments"]');
        const currentCount = list.querySelectorAll(".comment-item").length;
        countSpan.innerHTML = `💬 ${currentCount} ${config.answerNoun}`;
        commentForm.reset();
        statusEl.textContent = "";
      } catch (err) {
        statusEl.textContent = err.message || "Couldn't post — try again.";
      } finally {
        submitBtn.disabled = false;
      }
    });
  }

  async function loadFeed(app, config) {
    const feed = app.querySelector(".forum-feed");
    try {
      const res = await fetch(`${API_BASE}/collection/${config.collection}`);
      if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
      const posts = await res.json();
      if (!Array.isArray(posts) || !posts.length) {
        feed.innerHTML = `<div class="feed-status">${config.emptyText}</div>`;
        return;
      }
      posts.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      feed.innerHTML = posts.map((p) => renderPost(p, config)).join("");
      posts.forEach((post) => {
        const card = feed.querySelector(`[data-post-id="${CSS.escape(post.id)}"]`);
        if (card) wirePostActions(card, post, config, app);
      });
    } catch (e) {
      feed.innerHTML = `<div class="feed-status">Couldn't load ${config.collection} right now. <a href="javascript:location.reload()">Reload the page</a> to try again.</div>`;
    }
  }

  function wirePostForm(app, config) {
    const form = app.querySelector("#post-form");
    if (!form) return;
    const statusEl = form.querySelector(".form-status");

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const author = form.author.value.trim();
      const title = form.title.value.trim();
      const body = form.body.value.trim();
      if (!author || !title || !body) return;

      const submitBtn = form.querySelector("button[type=submit]");
      submitBtn.disabled = true;
      statusEl.textContent = "Publishing…";
      statusEl.className = "form-status";

      try {
        const post = await apiPost("/post", { collection: config.collection, author, title, body });
        const feed = app.querySelector(".forum-feed");
        const emptyStatus = feed.querySelector(".feed-status");
        if (emptyStatus) feed.innerHTML = "";
        feed.insertAdjacentHTML("afterbegin", renderPost(post, config));
        const card = feed.querySelector(`[data-post-id="${CSS.escape(post.id)}"]`);
        if (card) wirePostActions(card, post, config, app);
        form.reset();
        statusEl.textContent = "Published!";
        statusEl.className = "form-status is-success";
        setTimeout(() => (statusEl.textContent = ""), 3000);
      } catch (err) {
        statusEl.textContent = err.message || "Couldn't publish — try again.";
        statusEl.className = "form-status is-error";
      } finally {
        submitBtn.disabled = false;
      }
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    const app = document.getElementById("forum-app");
    if (!app) return;

    const config = {
      collection: app.dataset.collection,
      reactionEmoji: app.dataset.reactionEmoji || "👍",
      answerNoun: app.dataset.answerNoun || "Comments",
      emptyText: app.dataset.emptyText || "Nothing here yet — be the first to post!",
    };

    if (API_BASE.includes("YOUR-SUBDOMAIN")) {
      const form = app.querySelector("#post-form");
      if (form) {
        form.querySelector(".form-status").textContent =
          "Posting isn't wired up yet — the site owner needs to deploy the Worker and set API_BASE in assets/collections.js.";
      }
    }

    loadFeed(app, config);
    wirePostForm(app, config);
  });
})();
