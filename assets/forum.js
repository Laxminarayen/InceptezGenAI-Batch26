(function () {
  const REPO = "Laxminarayen/InceptezGenAI-Batch26";
  const API_ROOT = `https://api.github.com/repos/${REPO}`;
  const LIKE_KEY = `gh-liked-${REPO}`;

  function formatCount(n) {
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
    return String(n);
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
    return div.innerHTML;
  }

  function sessionCacheGet(key, maxAgeMs) {
    try {
      const raw = sessionStorage.getItem(key);
      if (!raw) return null;
      const { t, v } = JSON.parse(raw);
      if (Date.now() - t > maxAgeMs) return null;
      return v;
    } catch (e) {
      return null;
    }
  }

  function sessionCacheSet(key, value) {
    try {
      sessionStorage.setItem(key, JSON.stringify({ t: Date.now(), v: value }));
    } catch (e) {
      /* storage unavailable, ignore */
    }
  }

  // ---- Like / Star button ----
  function initLikeButton() {
    const likeBtn = document.getElementById("like-btn");
    const countEl = document.getElementById("star-count");
    if (!likeBtn) return;

    const liked = localStorage.getItem(LIKE_KEY) === "1";
    likeBtn.classList.toggle("is-liked", liked);
    likeBtn.setAttribute("aria-pressed", String(liked));

    likeBtn.addEventListener("click", () => {
      const nowLiked = !likeBtn.classList.contains("is-liked");
      likeBtn.classList.toggle("is-liked", nowLiked);
      likeBtn.setAttribute("aria-pressed", String(nowLiked));
      localStorage.setItem(LIKE_KEY, nowLiked ? "1" : "0");
      likeBtn.classList.remove("pop");
      void likeBtn.offsetWidth;
      likeBtn.classList.add("pop");
      window.open(`https://github.com/${REPO}`, "_blank", "noopener");
    });

    if (countEl) {
      const cached = sessionCacheGet("gh-repo-meta", 10 * 60 * 1000);
      if (cached) {
        countEl.textContent = formatCount(cached.stargazers_count);
      } else {
        fetch(API_ROOT)
          .then((res) => (res.ok ? res.json() : Promise.reject()))
          .then((data) => {
            sessionCacheSet("gh-repo-meta", { stargazers_count: data.stargazers_count });
            countEl.textContent = formatCount(data.stargazers_count);
          })
          .catch(() => {
            countEl.textContent = "—";
          });
      }
    }
  }

  // ---- Issue / question feeds ----
  function renderIssueCard(issue) {
    const isOpen = issue.state === "open";
    const date = new Date(issue.created_at).toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
    return `
      <a class="issue-card" href="${issue.html_url}" target="_blank" rel="noopener">
        <span class="issue-state ${isOpen ? "is-open" : "is-closed"}">${isOpen ? "Open" : "Answered"}</span>
        <span class="issue-body">
          <span class="issue-title">${escapeHtml(issue.title)}</span>
          <span class="issue-meta">#${issue.number} opened ${date} by ${escapeHtml(issue.user && issue.user.login)}</span>
        </span>
        <span class="issue-comments">💬 ${issue.comments}</span>
      </a>`;
  }

  // ---- Shared notes feed ----
  function previewText(body, maxLen) {
    if (!body) return "";
    const stripped = body
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/[#*_>`~-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return stripped.length > maxLen ? stripped.slice(0, maxLen).trim() + "…" : stripped;
  }

  function renderNoteCard(issue) {
    const date = new Date(issue.created_at).toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
    const author = (issue.user && issue.user.login) || "unknown";
    const avatar = (issue.user && issue.user.avatar_url) || "";
    const likes = issue.reactions ? issue.reactions["+1"] : 0;
    const preview = previewText(issue.body, 160);
    return `
      <a class="note-card" href="${issue.html_url}" target="_blank" rel="noopener">
        <img class="note-avatar" src="${avatar}" alt="" loading="lazy" width="38" height="38" />
        <span class="note-body">
          <span class="note-header">
            <span class="note-author">@${escapeHtml(author)}</span>
            <span class="note-date">${date}</span>
          </span>
          <span class="note-title">${escapeHtml(issue.title)}</span>
          ${preview ? `<span class="note-preview">${escapeHtml(preview)}</span>` : ""}
          <span class="note-stats">
            <span class="${likes > 0 ? "is-liked-count" : ""}">👍 ${likes}</span>
            <span>💬 ${issue.comments}</span>
          </span>
        </span>
      </a>`;
  }

  async function loadFeed(container) {
    if (!container) return;
    const label = container.dataset.label || "";
    const excludeLabel = container.dataset.excludeLabel || "";
    const feedType = container.dataset.feedType || "issue";
    const cacheKey = `gh-issues-${label || "all"}`;

    let data = sessionCacheGet(cacheKey, 5 * 60 * 1000);
    try {
      if (!data) {
        const params = new URLSearchParams({
          state: "all",
          per_page: "30",
          sort: "created",
          direction: "desc",
        });
        if (label) params.set("labels", label);
        const res = await fetch(`${API_ROOT}/issues?${params}`, {
          headers: { Accept: "application/vnd.github+json" },
        });
        if (!res.ok) throw new Error(`GitHub API returned ${res.status}`);
        data = await res.json();
        sessionCacheSet(cacheKey, data);
      }

      let items = data.filter((i) => !i.pull_request);
      if (excludeLabel) {
        items = items.filter((i) => !i.labels.some((l) => (l.name || l) === excludeLabel));
      }

      if (!items.length) {
        container.innerHTML = `<div class="feed-status">${container.dataset.emptyText || "Nothing here yet — be the first to post!"}</div>`;
        return;
      }

      const renderer = feedType === "notes" ? renderNoteCard : renderIssueCard;
      container.innerHTML = items.map(renderer).join("");
    } catch (e) {
      container.innerHTML = `<div class="feed-status">Couldn't load live threads right now (GitHub's public API is rate-limited). <a href="https://github.com/${REPO}/issues" target="_blank" rel="noopener">View directly on GitHub →</a></div>`;
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    initLikeButton();
    document.querySelectorAll("[data-issue-feed]").forEach(loadFeed);
  });
})();
