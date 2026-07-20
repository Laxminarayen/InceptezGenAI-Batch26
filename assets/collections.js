(function () {
  // After running `wrangler deploy` in worker/, replace this with your Worker's URL.
  const API_BASE = "https://inceptez-forum-api.nvlnarayen2496.workers.dev";
  const API_READY = !API_BASE.includes("YOUR-SUBDOMAIN");
  const NOT_READY_MSG =
    "This isn't wired up yet — the site owner needs to deploy the Worker (see worker/README.md) and set API_BASE in assets/collections.js.";

  const INSTRUCTOR_LOGIN = "laxminarayen";

  const CLASS_OPTIONS = [
    "",
    "00 · Class Introduction",
    "01 · Why Python",
    "02 · Data Types & Structures",
    "03 · Structure Ops & Loops",
    "04 · Time Complexity, Set/Dict",
    "05 · While, Break/Continue, Functions",
    "06 · Functions Adv, Classes, LEGB",
    "07 · Intro to NumPy",
    "08 · Pandas",
    "09 · Pandas Stats",
    "13 · Descriptive Statistics 1",
    "14 · Data Preprocessing",
    "15 · Multivariate Distributions",
    "16 · Inferential Stats — Voting",
    "17 · ML Foundations & Simple Linear Regression",
  ];

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

  // Turns "@name" text (outside code/links) into a styled span. Builds real DOM
  // nodes via textContent, never string concatenation, so it can't reintroduce
  // any HTML/script injection risk.
  function highlightMentions(html) {
    const container = document.createElement("div");
    container.innerHTML = html;

    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return node.parentElement && node.parentElement.closest("code, pre, a")
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT;
      },
    });
    const textNodes = [];
    let n;
    while ((n = walker.nextNode())) textNodes.push(n);

    const mentionRe = /@([a-zA-Z0-9][\w-]{0,38})/g;
    textNodes.forEach((node) => {
      const text = node.nodeValue;
      mentionRe.lastIndex = 0;
      if (!mentionRe.test(text)) return;
      mentionRe.lastIndex = 0;
      const frag = document.createDocumentFragment();
      let lastIndex = 0;
      let match;
      while ((match = mentionRe.exec(text))) {
        if (match.index > lastIndex) frag.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
        const span = document.createElement("span");
        span.className = "mention";
        span.textContent = "@" + match[1];
        frag.appendChild(span);
        lastIndex = match.index + match[0].length;
      }
      if (lastIndex < text.length) frag.appendChild(document.createTextNode(text.slice(lastIndex)));
      node.parentNode.replaceChild(frag, node);
    });

    container.querySelectorAll("a[href]").forEach((a) => {
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "noopener noreferrer");
    });

    return container.innerHTML;
  }

  const ALLOWED_TAGS = [
    "p", "br", "strong", "em", "del", "ul", "ol", "li",
    "blockquote", "code", "pre", "a", "h2", "h3", "h4", "hr", "img", "span",
  ];
  const ALLOWED_ATTR = ["href", "target", "rel", "src", "alt", "class"];

  // Markdown -> sanitized HTML. If marked/DOMPurify failed to load (e.g. CDN
  // blocked), degrades to plain escaped text rather than rendering nothing.
  function renderMarkdown(text) {
    if (!text) return "";
    if (!window.marked || !window.DOMPurify) {
      return `<p>${escapeHtml(text)}</p>`;
    }
    const rawHtml = window.marked.parse(text, { gfm: true, breaks: true });
    const clean = window.DOMPurify.sanitize(rawHtml, {
      ALLOWED_TAGS,
      ALLOWED_ATTR,
      ALLOW_DATA_ATTR: false,
    });
    return highlightMentions(clean);
  }

  function getSession() {
    return window.ForumAuth ? window.ForumAuth.getSession() : null;
  }

  async function apiPost(path, payload) {
    const session = getSession();
    const headers = { "Content-Type": "application/json" };
    if (session) headers.Authorization = `Bearer ${session.token}`;
    const res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  function avatarImg(url, size) {
    return url
      ? `<img class="note-avatar" src="${escapeHtml(url)}" alt="" loading="lazy" width="${size}" height="${size}" />`
      : "";
  }

  function renderComment(c) {
    return `
      <li class="comment-item">
        ${avatarImg(c.authorAvatar, 22)}
        <span class="comment-author">@${escapeHtml(c.author)}</span> ${instructorBadge(c.author)}
        <span class="comment-date">${formatDate(c.createdAt)}</span>
        <p class="comment-body">${escapeHtml(c.body)}</p>
      </li>`;
  }

  function renderTags(post) {
    const chips = [];
    if (post.classTag) {
      chips.push(`<button type="button" class="tag-chip tag-class" data-filter-class="${escapeHtml(post.classTag)}">${escapeHtml(post.classTag)}</button>`);
    }
    (post.topics || []).forEach((t) => {
      chips.push(`<button type="button" class="tag-chip tag-topic" data-filter-topic="${escapeHtml(t)}">#${escapeHtml(t)}</button>`);
    });
    return chips.length ? `<div class="tag-row">${chips.join("")}</div>` : "";
  }

  function renderPost(post, config) {
    const session = getSession();
    const liked = session ? (post.likes || []).some((l) => String(l).toLowerCase() === session.login.toLowerCase()) : false;
    const likeCount = (post.likes || []).length;
    const commentCount = (post.comments || []).length;
    const bodyHtml = renderMarkdown(post.body);
    const isLong = (post.body || "").length > 380 || (post.body || "").split("\n").length > 6;
    const comments = (post.comments || []).map(renderComment).join("");
    const canEdit = session && session.login.toLowerCase() === String(post.author).toLowerCase();
    const editedNote = post.editedAt ? '<span class="note-edited">(edited)</span>' : "";

    return `
      <article class="post-card" data-post-id="${escapeHtml(post.id)}" data-class-tag="${escapeHtml(post.classTag || "")}" data-topics="${escapeHtml((post.topics || []).join(","))}">
        <header class="note-header">
          ${avatarImg(post.authorAvatar, 26)}
          <span class="note-author">@${escapeHtml(post.author)}</span>
          ${instructorBadge(post.author)}
          <span class="note-date">${formatDate(post.createdAt)}</span>
          ${editedNote}
          ${canEdit ? `<button type="button" class="edit-btn" data-action="edit">✏️ Edit</button><button type="button" class="edit-btn delete-btn" data-action="delete">🗑️ Delete</button>` : ""}
        </header>
        ${renderTags(post)}
        <h3 class="post-title">${escapeHtml(post.title)}</h3>
        <div class="post-body-wrap ${isLong ? "is-clamped" : ""}">
          <div class="post-body rendered-content">${bodyHtml}</div>
        </div>
        ${isLong ? `<button type="button" class="read-more-btn" data-action="toggle-body">Read more ▾</button>` : ""}
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
            <textarea name="body" class="comment-input" placeholder="Write a reply…" maxlength="2000" rows="2" required></textarea>
            <button type="submit" class="btn btn-secondary">Reply</button>
            <span class="form-status"></span>
          </form>
        </div>
      </article>`;
  }

  function renderEditForm(post) {
    const classOptions = CLASS_OPTIONS.map(
      (v) => `<option value="${escapeHtml(v)}" ${v === (post.classTag || "") ? "selected" : ""}>${escapeHtml(v || "General (not tied to a specific class)")}</option>`
    ).join("");
    return `
      <div class="edit-form">
        <input type="text" class="form-row-input edit-title" value="${escapeHtml(post.title)}" maxlength="200" placeholder="Title" />
        <div class="edit-meta-row">
          <select class="edit-class">${classOptions}</select>
          <input type="text" class="edit-topics" value="${escapeHtml((post.topics || []).join(", "))}" placeholder="Topics, comma separated" maxlength="120" />
        </div>
        <textarea class="edit-body js-rich-editor" maxlength="8000">${escapeHtml(post.body)}</textarea>
        <div class="form-actions">
          <button type="button" class="btn btn-primary" data-action="save-edit">Save</button>
          <button type="button" class="btn btn-secondary" data-action="cancel-edit">Cancel</button>
          <span class="form-status"></span>
        </div>
      </div>`;
  }

  function enterEditMode(card, post, config) {
    if (card.querySelector(".edit-form")) return;
    const titleEl = card.querySelector(".post-title");
    const bodyWrap = card.querySelector(".post-body-wrap");
    const readMoreBtn = card.querySelector(".read-more-btn");
    const tagsRow = card.querySelector(".tag-row");

    titleEl.hidden = true;
    bodyWrap.hidden = true;
    if (readMoreBtn) readMoreBtn.hidden = true;
    if (tagsRow) tagsRow.hidden = true;

    const holder = document.createElement("div");
    holder.innerHTML = renderEditForm(post);
    const editForm = holder.firstElementChild;
    bodyWrap.insertAdjacentElement("afterend", editForm);

    const textarea = editForm.querySelector(".edit-body");
    if (window.ForumEditor) window.ForumEditor.wrap(textarea);

    function exitEditMode() {
      editForm.remove();
      titleEl.hidden = false;
      bodyWrap.hidden = false;
      if (readMoreBtn) readMoreBtn.hidden = false;
      if (tagsRow) tagsRow.hidden = false;
    }

    editForm.querySelector('[data-action="cancel-edit"]').addEventListener("click", exitEditMode);

    editForm.querySelector('[data-action="save-edit"]').addEventListener("click", async () => {
      const title = editForm.querySelector(".edit-title").value.trim();
      const body = editForm.querySelector(".edit-body").value.trim();
      const classTag = editForm.querySelector(".edit-class").value;
      const topics = editForm
        .querySelector(".edit-topics")
        .value.split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const statusEl = editForm.querySelector(".form-status");
      if (!title || !body) return;
      const saveBtn = editForm.querySelector('[data-action="save-edit"]');
      saveBtn.disabled = true;
      statusEl.textContent = "Saving…";
      try {
        const updated = await apiPost("/edit", { collection: config.collection, postId: post.id, title, body, classTag, topics });
        const holder2 = document.createElement("div");
        holder2.innerHTML = renderPost(updated, config);
        const newCard = holder2.firstElementChild;
        const app = card.closest(".forum-app");
        card.replaceWith(newCard);
        wirePostActions(newCard, updated, config);
        if (app) refreshTagFilterBar(app);
      } catch (err) {
        statusEl.textContent = err.message || "Couldn't save — try again.";
        saveBtn.disabled = false;
      }
    });
  }

  function wirePostActions(card, post, config) {
    const postId = post.id;

    const likeBtn = card.querySelector('[data-action="like"]');
    likeBtn.addEventListener("click", async () => {
      const session = getSession();
      if (!session) {
        window.ForumAuth.login();
        return;
      }
      const wasLiked = likeBtn.classList.contains("is-clapped");
      const countEl = likeBtn.querySelector(".clap-count");
      const optimisticCount = parseInt(countEl.textContent, 10) + (wasLiked ? -1 : 1);
      likeBtn.classList.toggle("is-clapped", !wasLiked);
      likeBtn.setAttribute("aria-pressed", String(!wasLiked));
      countEl.textContent = optimisticCount;
      likeBtn.disabled = true;
      try {
        const result = await apiPost("/like", { collection: config.collection, postId });
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

    const readMoreBtn = card.querySelector('[data-action="toggle-body"]');
    if (readMoreBtn) {
      const bodyWrap = card.querySelector(".post-body-wrap");
      readMoreBtn.addEventListener("click", () => {
        const expanded = bodyWrap.classList.toggle("is-clamped") === false;
        readMoreBtn.textContent = expanded ? "Show less ▴" : "Read more ▾";
      });
    }

    const editBtn = card.querySelector('[data-action="edit"]');
    if (editBtn) editBtn.addEventListener("click", () => enterEditMode(card, post, config));

    const deleteBtn = card.querySelector('[data-action="delete"]');
    if (deleteBtn) {
      deleteBtn.addEventListener("click", async () => {
        if (!confirm("Delete this post? This can't be undone.")) return;
        deleteBtn.disabled = true;
        try {
          await apiPost("/delete", { collection: config.collection, postId: post.id });
          const app = card.closest(".forum-app");
          const feed = card.closest(".forum-feed");
          card.remove();
          if (feed && !feed.querySelector(".post-card")) {
            feed.innerHTML = `<div class="feed-status">${config.emptyText}</div>`;
          }
          if (app) refreshTagFilterBar(app);
        } catch (err) {
          alert(err.message || "Couldn't delete — try again.");
          deleteBtn.disabled = false;
        }
      });
    }

    const toggleBtn = card.querySelector('[data-action="toggle-comments"]');
    const section = card.querySelector(".comment-section");
    toggleBtn.addEventListener("click", () => {
      section.hidden = !section.hidden;
    });

    const commentForm = card.querySelector(".comment-form");
    commentForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const session = getSession();
      if (!session) {
        window.ForumAuth.login();
        return;
      }
      const body = commentForm.body.value.trim();
      const statusEl = commentForm.querySelector(".form-status");
      if (!body) return;
      const submitBtn = commentForm.querySelector("button[type=submit]");
      submitBtn.disabled = true;
      statusEl.textContent = "Posting…";
      try {
        const comment = await apiPost("/comment", { collection: config.collection, postId, body });
        rememberAuthor(config, comment.author);
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

  function rememberAuthor(config, name) {
    if (!name) return;
    window.ForumKnownAuthors = window.ForumKnownAuthors || {};
    const set = (window.ForumKnownAuthors[config.collection] = window.ForumKnownAuthors[config.collection] || new Set());
    set.add(name);
  }

  // Rebuilds the filter bar from whatever .post-card elements currently exist
  // in the DOM. Safe to call repeatedly (after create/edit/delete) since it
  // derives tags live rather than relying on a snapshot array.
  function refreshTagFilterBar(app) {
    const bar = app.querySelector(".tag-filter-bar");
    if (!bar) return;
    const feed = app.querySelector(".forum-feed");
    const classes = new Set();
    const topics = new Set();
    feed.querySelectorAll(".post-card").forEach((card) => {
      if (card.dataset.classTag) classes.add(card.dataset.classTag);
      (card.dataset.topics || "")
        .split(",")
        .filter(Boolean)
        .forEach((t) => topics.add(t));
    });
    if (!classes.size && !topics.size) {
      bar.hidden = true;
      bar.innerHTML = "";
      return;
    }
    bar.hidden = false;
    const classChips = Array.from(classes)
      .sort()
      .map((c) => `<button type="button" class="tag-chip tag-class" data-filter-class="${escapeHtml(c)}">${escapeHtml(c)}</button>`)
      .join("");
    const topicChips = Array.from(topics)
      .sort()
      .map((t) => `<button type="button" class="tag-chip tag-topic" data-filter-topic="${escapeHtml(t)}">#${escapeHtml(t)}</button>`)
      .join("");
    bar.innerHTML = `<button type="button" class="tag-chip tag-all is-active" data-filter-all>All</button>${classChips}${topicChips}`;
    bar.querySelectorAll("button").forEach((btn) => btn.addEventListener("click", () => applyTagFilter(app, btn)));
  }

  function applyTagFilter(app, btn) {
    const bar = app.querySelector(".tag-filter-bar");
    bar.querySelectorAll("button").forEach((b) => b.classList.remove("is-active"));
    btn.classList.add("is-active");
    const feed = app.querySelector(".forum-feed");
    const filterClass = btn.dataset.filterClass;
    const filterTopic = btn.dataset.filterTopic;
    feed.querySelectorAll(".post-card").forEach((card) => {
      if (btn.hasAttribute("data-filter-all")) {
        card.hidden = false;
      } else if (filterClass) {
        card.hidden = card.dataset.classTag !== filterClass;
      } else if (filterTopic) {
        card.hidden = !(card.dataset.topics || "").split(",").includes(filterTopic);
      }
    });
  }

  // One-time delegated listener: clicking a tag chip inside a post card
  // (not the filter bar itself) jumps to that filter.
  function wireInCardTagClicks(app) {
    app.querySelector(".forum-feed").addEventListener("click", (e) => {
      const chip = e.target.closest("[data-filter-class], [data-filter-topic]");
      if (!chip || !chip.closest(".post-card")) return;
      const bar = app.querySelector(".tag-filter-bar");
      const selector = chip.dataset.filterClass
        ? `[data-filter-class="${CSS.escape(chip.dataset.filterClass)}"]`
        : `[data-filter-topic="${CSS.escape(chip.dataset.filterTopic)}"]`;
      const target = bar && bar.querySelector(selector);
      if (target) applyTagFilter(app, target);
    });
  }

  async function loadFeed(app, config) {
    const feed = app.querySelector(".forum-feed");
    if (!API_READY) {
      feed.innerHTML = `<div class="feed-status">${NOT_READY_MSG}</div>`;
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/collection/${config.collection}`);
      if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
      const posts = await res.json();
      posts.forEach((p) => {
        rememberAuthor(config, p.author);
        (p.comments || []).forEach((c) => rememberAuthor(config, c.author));
      });
      if (!Array.isArray(posts) || !posts.length) {
        feed.innerHTML = `<div class="feed-status">${config.emptyText}</div>`;
        const bar = app.querySelector(".tag-filter-bar");
        if (bar) bar.hidden = true;
        return;
      }
      posts.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      feed.innerHTML = posts.map((p) => renderPost(p, config)).join("");
      posts.forEach((post) => {
        const card = feed.querySelector(`[data-post-id="${CSS.escape(post.id)}"]`);
        if (card) wirePostActions(card, post, config);
      });
      wireInCardTagClicks(app);
      refreshTagFilterBar(app);
    } catch (e) {
      feed.innerHTML = `<div class="feed-status">Couldn't load ${config.collection} right now. <a href="javascript:location.reload()">Reload the page</a> to try again.</div>`;
    }
  }

  function draftKey(config) {
    return `forum-draft-${config.collection}`;
  }

  function saveDraft(config, form) {
    try {
      sessionStorage.setItem(
        draftKey(config),
        JSON.stringify({
          title: form.title.value,
          body: form.body.value,
          classTag: form.classTag ? form.classTag.value : "",
          topics: form.topics ? form.topics.value : "",
        })
      );
    } catch (e) {
      /* storage unavailable, draft just won't survive the redirect */
    }
  }

  function restoreDraft(config, form) {
    try {
      const raw = sessionStorage.getItem(draftKey(config));
      if (!raw) return;
      const draft = JSON.parse(raw);
      if (draft.title) form.title.value = draft.title;
      if (draft.body) {
        form.body.value = draft.body;
        form.body.dispatchEvent(new Event("input", { bubbles: true }));
      }
      if (form.classTag && draft.classTag) form.classTag.value = draft.classTag;
      if (form.topics && draft.topics) form.topics.value = draft.topics;
    } catch (e) {
      /* ignore */
    }
  }

  function clearDraft(config) {
    try {
      sessionStorage.removeItem(draftKey(config));
    } catch (e) {
      /* ignore */
    }
  }

  function populateClassSelect(select) {
    if (!select) return;
    select.innerHTML = CLASS_OPTIONS.map(
      (v) => `<option value="${escapeHtml(v)}">${escapeHtml(v || "General (not tied to a specific class)")}</option>`
    ).join("");
  }

  function updatePostingAsLine(app, config) {
    const el = app.querySelector(".posting-as");
    if (!el) return;
    const session = getSession();
    if (session) {
      el.innerHTML = `✍️ Posting as <strong>@${escapeHtml(session.login)}</strong>`;
    } else {
      el.innerHTML = `Sign in with GitHub (top right) to post here.`;
    }
  }

  function wirePostForm(app, config) {
    const form = app.querySelector("#post-form");
    if (!form) return;
    const statusEl = form.querySelector(".form-status");

    populateClassSelect(form.classTag);
    restoreDraft(config, form);
    updatePostingAsLine(app, config);

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!API_READY) {
        statusEl.textContent = NOT_READY_MSG;
        statusEl.className = "form-status is-error";
        return;
      }
      const session = getSession();
      if (!session) {
        saveDraft(config, form);
        statusEl.textContent = "Redirecting to sign in with GitHub…";
        statusEl.className = "form-status";
        window.ForumAuth.login();
        return;
      }

      const title = form.title.value.trim();
      const body = form.body.value.trim();
      const classTag = form.classTag ? form.classTag.value : "";
      const topics = form.topics
        ? form.topics.value.split(",").map((s) => s.trim()).filter(Boolean)
        : [];
      if (!title || !body) return;

      const submitBtn = form.querySelector("button[type=submit]");
      submitBtn.disabled = true;
      statusEl.textContent = "Publishing…";
      statusEl.className = "form-status";

      try {
        const post = await apiPost("/post", { collection: config.collection, title, body, classTag, topics });
        rememberAuthor(config, post.author);
        clearDraft(config);
        const feed = app.querySelector(".forum-feed");
        const emptyStatus = feed.querySelector(".feed-status");
        if (emptyStatus) feed.innerHTML = "";
        feed.insertAdjacentHTML("afterbegin", renderPost(post, config));
        const card = feed.querySelector(`[data-post-id="${CSS.escape(post.id)}"]`);
        if (card) wirePostActions(card, post, config);
        refreshTagFilterBar(app);
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

    loadFeed(app, config);
    wirePostForm(app, config);
  });

  window.ForumMarkdown = { render: renderMarkdown };
  window.ForumAPI = {
    ready: API_READY,
    notReadyMessage: NOT_READY_MSG,
    uploadImage(payload) {
      return apiPost("/upload", payload);
    },
  };
})();
