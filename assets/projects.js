(function () {
  const API_BASE = "https://inceptez-forum-api.nvlnarayen2496.workers.dev";

  // Keep in sync with worker/src/index.js PROJECTS config.
  const PROJECTS = {
    banking: { classes: ["yes", "no"], deadline: "2026-09-19T23:59:59+05:30", dailyLimit: 5 },
    industry: { classes: ["0", "1", "2", "3"], deadline: "2026-09-19T23:59:59+05:30", dailyLimit: 5 },
  };

  function getSession() {
    return window.ForumAuth ? window.ForumAuth.getSession() : null;
  }

  async function apiPost(path, payload) {
    const session = getSession();
    const headers = { "Content-Type": "application/json" };
    if (session) headers.Authorization = `Bearer ${session.token}`;
    const res = await fetch(`${API_BASE}${path}`, { method: "POST", headers, body: JSON.stringify(payload) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  async function apiGet(path) {
    const res = await fetch(`${API_BASE}${path}`, { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  function pct(x, digits) {
    if (x === null || x === undefined || Number.isNaN(x)) return "—";
    return `${(x * 100).toFixed(digits == null ? 1 : digits)}%`;
  }

  function fourDp(x) {
    if (x === null || x === undefined || Number.isNaN(x)) return "—";
    return x.toFixed(4);
  }

  function avatarFor(login) {
    return `https://github.com/${encodeURIComponent(login)}.png?size=48`;
  }

  // ---------------- Tabs ----------------

  function initTabs() {
    document.querySelectorAll(".proj-tabs").forEach((tabStrip) => {
      const project = tabStrip.dataset.project;
      const tabs = Array.from(tabStrip.querySelectorAll(".proj-tab"));
      const panels = Array.from(document.querySelectorAll(`.proj-panel[data-project="${project}"]`));

      tabs.forEach((tab) => {
        tab.addEventListener("click", () => {
          tabs.forEach((t) => t.classList.toggle("is-active", t === tab));
          panels.forEach((p) => {
            p.hidden = p.dataset.panel !== tab.dataset.panel;
          });
          if (tab.dataset.panel === "leaderboard") loadLeaderboard(project);
        });
      });
    });
  }

  // ---------------- Countdown ----------------

  function formatRemaining(ms) {
    if (ms <= 0) return "Submissions closed";
    const totalMinutes = Math.floor(ms / 60000);
    const days = Math.floor(totalMinutes / (60 * 24));
    const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
    const minutes = totalMinutes % 60;
    if (days > 0) return `${days}d ${hours}h remaining`;
    if (hours > 0) return `${hours}h ${minutes}m remaining`;
    return `${minutes}m remaining`;
  }

  function initCountdowns() {
    const els = document.querySelectorAll(".proj-countdown");
    function tick() {
      els.forEach((el) => {
        const project = el.dataset.project;
        const deadlineMs = Date.parse(PROJECTS[project].deadline);
        const remaining = deadlineMs - Date.now();
        el.textContent = formatRemaining(remaining);
        el.classList.toggle("is-closed", remaining <= 0);
      });
    }
    tick();
    setInterval(tick, 30000);
  }

  // ---------------- Submission ----------------

  function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Couldn't read that file."));
      reader.readAsText(file);
    });
  }

  function renderMetricTable(perClass, classes) {
    const rows = classes
      .map(
        (c) => `
      <tr>
        <td>${c}</td>
        <td>${fourDp(perClass[c].precision)}</td>
        <td>${fourDp(perClass[c].recall)}</td>
        <td>${fourDp(perClass[c].f1)}</td>
        <td>${perClass[c].support}</td>
      </tr>`
      )
      .join("");
    return `
      <div class="data-table-wrap">
        <table class="data-table">
          <thead><tr><th>Class</th><th>Precision</th><th>Recall</th><th>F1</th><th>Support</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  function renderConfusionMatrix(confusion, classes) {
    const header = classes.map((c) => `<th>pred: ${c}</th>`).join("");
    const rows = classes
      .map((actual) => {
        const cells = classes.map((pred) => `<td>${confusion[actual][pred]}</td>`).join("");
        return `<tr><th>actual: ${actual}</th>${cells}</tr>`;
      })
      .join("");
    return `
      <div class="data-table-wrap">
        <table class="data-table">
          <thead><tr><th></th>${header}</tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  function renderSubmitResult(box, data, classes) {
    const result = box.querySelector(".proj-submit-result");
    const s = data.public;
    result.hidden = false;
    result.innerHTML = `
      ${data.isNewBest ? '<span class="proj-new-best-badge">🏆 New personal best — leaderboard updated</span>' : ""}
      <div class="metric-tiles">
        <div class="metric-tile is-best">
          <div class="metric-value">${fourDp(s.macroF1)}</div>
          <div class="metric-label">Public Macro F1</div>
        </div>
        <div class="metric-tile">
          <div class="metric-value">${pct(s.accuracy)}</div>
          <div class="metric-label">Public Accuracy</div>
        </div>
      </div>
      <h4>Per-class breakdown (public test fold, ${s.rows} rows)</h4>
      ${renderMetricTable(s.perClass, classes)}
      <h4>Confusion matrix (public fold)</h4>
      ${renderConfusionMatrix(s.confusion, classes)}
      <p class="proj-submit-status">Submissions today: ${data.submissionsToday}/${data.submissionsToday + data.submissionsRemaining} ·
        This is your <strong>public</strong> score — it's for feedback only. Final ranking uses the hidden
        private test fold, revealed after the ${new Date(data.deadline).toLocaleString(undefined, { dateStyle: "long", timeStyle: "short" })} deadline.</p>
    `;
  }

  function initSubmitBoxes() {
    document.querySelectorAll(".proj-submit-box").forEach((box) => {
      const project = box.dataset.project;
      const classes = PROJECTS[project].classes;
      const signedOut = box.querySelector(".proj-signed-out");
      const signedIn = box.querySelector(".proj-signed-in");
      const signinBtn = box.querySelector(".proj-signin-btn");
      const fileInput = box.querySelector(".proj-file-input");
      const fileNameEl = box.querySelector(".proj-file-name");
      const submitBtn = box.querySelector(".proj-submit-btn");
      const status = box.querySelector(".proj-submit-status");

      function refreshAuthUI() {
        const session = getSession();
        signedOut.hidden = !!session;
        signedIn.hidden = !session;
      }
      refreshAuthUI();
      window.addEventListener("storage", refreshAuthUI);

      if (signinBtn) signinBtn.addEventListener("click", () => window.ForumAuth && window.ForumAuth.login());

      let chosenFile = null;
      if (fileInput) {
        fileInput.addEventListener("change", () => {
          chosenFile = fileInput.files && fileInput.files[0] ? fileInput.files[0] : null;
          fileNameEl.textContent = chosenFile ? chosenFile.name : "No file chosen";
          submitBtn.disabled = !chosenFile;
          status.textContent = "";
          status.className = "proj-submit-status";
        });
      }

      if (submitBtn) {
        submitBtn.addEventListener("click", async () => {
          if (!chosenFile) return;
          submitBtn.disabled = true;
          status.className = "proj-submit-status";
          status.textContent = "Reading file and scoring against the test set…";
          try {
            const csv = await readFileAsText(chosenFile);
            const data = await apiPost(`/projects/${project}/submit`, { csv });
            status.textContent = "";
            renderSubmitResult(box, data, classes);
            loadLeaderboard(project, true);
          } catch (e) {
            status.className = "proj-submit-status is-error";
            status.textContent = e.message || "Submission failed — please try again.";
          } finally {
            submitBtn.disabled = !chosenFile;
          }
        });
      }
    });
  }

  // ---------------- Leaderboard ----------------

  const leaderboardLoaded = {};

  async function loadLeaderboard(project, force) {
    const wrap = document.querySelector(`.proj-leaderboard[data-project="${project}"]`);
    if (!wrap) return;
    if (leaderboardLoaded[project] && !force) return;
    leaderboardLoaded[project] = true;

    const status = wrap.querySelector(".leaderboard-status");
    const table = wrap.querySelector("table.leaderboard-table");
    const tbody = table.querySelector("tbody");
    const revealNote = wrap.querySelector(".lb-reveal-note");

    status.textContent = "Loading leaderboard…";
    table.hidden = true;
    try {
      const data = await apiGet(`/projects/${project}/leaderboard`);
      const session = getSession();
      const myLogin = session ? session.login.toLowerCase() : null;

      if (!data.rows || data.rows.length === 0) {
        status.textContent = "No submissions yet — be the first!";
        revealNote.hidden = true;
        return;
      }

      revealNote.hidden = false;
      revealNote.innerHTML = data.revealed
        ? "🔓 <strong>Private leaderboard revealed.</strong> These are final rankings on the hidden private test fold."
        : "🔒 This is the <strong>public</strong> leaderboard (30% of the test set). Final ranking uses the private fold, revealed after the deadline.";

      tbody.innerHTML = data.rows
        .map((r) => {
          const isMe = myLogin && String(r.login).toLowerCase() === myLogin;
          const rankClass = r.rank === 1 ? "is-top1" : r.rank === 2 ? "is-top2" : r.rank === 3 ? "is-top3" : "";
          const scoreCol = data.revealed
            ? `${fourDp(r.privateMacroF1)} <span style="color:var(--text-dim)">(public ${fourDp(r.publicMacroF1)})</span>`
            : fourDp(r.publicMacroF1);
          return `
            <tr class="${isMe ? "is-me" : ""}">
              <td class="lb-rank ${rankClass}">${r.rank}</td>
              <td><span class="lb-user"><img class="lb-avatar" src="${avatarFor(r.login)}" width="24" height="24" alt="" />@${r.login}</span></td>
              <td>${scoreCol}</td>
              <td>${r.submissionCount}</td>
              <td>${new Date(r.submittedAt).toLocaleDateString()}</td>
            </tr>`;
        })
        .join("");

      status.textContent = "";
      table.hidden = false;
    } catch (e) {
      status.textContent = e.message || "Couldn't load the leaderboard.";
      leaderboardLoaded[project] = false;
    }
  }

  // ---------------- Isolate a single project (sidebar link or intro card) ----------------
  // Mirrors the notes/articles single-post-mode pattern: a #banking / #industry hash hides
  // everything else (intro cards, deadline banner, the other competition, the sidebar) down
  // to just that one project, with a link back to the full page. Runs on load (so a shared
  // projects.html#banking link lands isolated) and on every hashchange (so clicking a project
  // link while already on this page, or using back/forward, both work without a reload).
  function applyProjectIsolation() {
    const layout = document.querySelector(".layout");
    const intro = document.querySelector(".proj-intro-grid");
    const banner = document.querySelector(".proj-deadline-banner");
    const sections = Array.from(document.querySelectorAll(".proj-competition"));
    const pageHeader = document.querySelector(".page-header");
    const existingBack = document.querySelector(".single-post-back");

    const match = (location.hash || "").match(/^#(banking|industry)$/);
    const targetId = match ? match[1] : null;

    if (existingBack) existingBack.remove();

    if (!targetId) {
      if (layout) layout.classList.remove("single-project-mode");
      if (intro) intro.hidden = false;
      if (banner) banner.hidden = false;
      sections.forEach((s) => { s.hidden = false; });
      return;
    }

    if (layout) layout.classList.add("single-project-mode");
    if (intro) intro.hidden = true;
    if (banner) banner.hidden = true;
    sections.forEach((s) => { s.hidden = s.id !== targetId; });

    const back = document.createElement("a");
    back.className = "single-post-back";
    back.href = "projects.html";
    back.textContent = "← Back to all Projects";
    if (pageHeader) pageHeader.parentNode.insertBefore(back, pageHeader);
  }

  document.addEventListener("DOMContentLoaded", () => {
    initTabs();
    initCountdowns();
    initSubmitBoxes();
    applyProjectIsolation();
  });
  window.addEventListener("hashchange", applyProjectIsolation);
})();
