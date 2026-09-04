(function () {
  const API_BASE = "https://inceptez-forum-api.nvlnarayen2496.workers.dev";
  const INSTRUCTOR_LOGIN = "laxminarayen";
  const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  const MAX_PILLS_PER_DAY = 2;

  const ALLOWED_TAGS = [
    "p", "br", "strong", "em", "del", "ul", "ol", "li",
    "blockquote", "code", "pre", "a", "h2", "h3", "h4", "hr", "img", "span",
  ];
  const ALLOWED_ATTR = ["href", "target", "rel", "src", "alt", "class"];

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
    return div.innerHTML;
  }

  function isInstructor(name) {
    return typeof name === "string" && name.trim().toLowerCase() === INSTRUCTOR_LOGIN;
  }

  function renderMarkdown(text) {
    if (!text) return "";
    if (!window.marked || !window.DOMPurify) return `<p>${escapeHtml(text)}</p>`;
    const rawHtml = window.marked.parse(text, { gfm: true, breaks: true });
    return window.DOMPurify.sanitize(rawHtml, { ALLOWED_TAGS, ALLOWED_ATTR, ALLOW_DATA_ATTR: false });
  }

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

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function dateStr(y, m, d) {
    return `${y}-${pad2(m + 1)}-${pad2(d)}`;
  }

  function todayStr() {
    const t = new Date();
    return dateStr(t.getFullYear(), t.getMonth(), t.getDate());
  }

  function parseDateStr(s) {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  function formatLong(s) {
    return parseDateStr(s).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  }

  function avatarFor(login) {
    return `https://github.com/${encodeURIComponent(login)}.png?size=64`;
  }

  let allTasks = [];
  let tasksByDate = new Map();
  let viewYear, viewMonth; // viewMonth is 0-indexed
  let openDate = null;

  function rebuildIndex() {
    tasksByDate = new Map();
    for (const t of allTasks) {
      if (!t.date) continue;
      if (!tasksByDate.has(t.date)) tasksByDate.set(t.date, []);
      tasksByDate.get(t.date).push(t);
    }
  }

  async function loadTasks(app) {
    const status = app.querySelector(".calendar-status");
    try {
      const res = await fetch(`${API_BASE}/collection/tasks`);
      const data = await res.json();
      if (!Array.isArray(data)) throw new Error((data && data.error) || "Couldn't load tasks");
      allTasks = data;
      rebuildIndex();
      status.hidden = true;
      app.querySelector(".calendar-grid").hidden = false;
      renderCalendar(app);
    } catch (e) {
      status.textContent = e.message || "Couldn't load tasks — try refreshing.";
    }
  }

  function renderCalendar(app) {
    const grid = app.querySelector(".calendar-grid");
    const label = app.querySelector(".tasks-month-label");
    label.textContent = `${MONTHS[viewMonth]} ${viewYear}`;

    const first = new Date(viewYear, viewMonth, 1);
    const startOffset = first.getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate();

    const cells = WEEKDAYS.map((w) => `<div class="calendar-weekday">${w}</div>`);

    const totalCells = Math.ceil((startOffset + daysInMonth) / 7) * 7;
    for (let i = 0; i < totalCells; i++) {
      const dayNum = i - startOffset + 1;
      let cellYear = viewYear;
      let cellMonth = viewMonth;
      let cellDay;
      let otherMonth = false;

      if (dayNum < 1) {
        cellDay = daysInPrevMonth + dayNum;
        cellMonth = viewMonth - 1;
        otherMonth = true;
        if (cellMonth < 0) {
          cellMonth = 11;
          cellYear -= 1;
        }
      } else if (dayNum > daysInMonth) {
        cellDay = dayNum - daysInMonth;
        cellMonth = viewMonth + 1;
        otherMonth = true;
        if (cellMonth > 11) {
          cellMonth = 0;
          cellYear += 1;
        }
      } else {
        cellDay = dayNum;
      }

      const ds = dateStr(cellYear, cellMonth, cellDay);
      const isToday = ds === todayStr();
      const dayTasks = tasksByDate.get(ds) || [];
      const visible = dayTasks.slice(0, MAX_PILLS_PER_DAY);
      const more = dayTasks.length - visible.length;

      const pills = visible
        .map(
          (t) => `
        <div class="cal-task-pill">
          <span class="cal-task-title">${escapeHtml(t.title)}</span>
          <span class="cal-task-count">${(t.likes || []).length} done</span>
        </div>`
        )
        .join("");
      const moreEl = more > 0 ? `<div class="cal-task-more">+${more} more</div>` : "";

      cells.push(`
        <div class="cal-day ${otherMonth ? "is-other-month" : ""} ${isToday ? "is-today" : ""} ${dayTasks.length ? "has-tasks" : ""}" data-date="${ds}">
          <div class="cal-day-num">${cellDay}</div>
          <div class="cal-day-tasks">${pills}${moreEl}</div>
        </div>`);
    }

    grid.innerHTML = cells.join("");
    grid.querySelectorAll(".cal-day").forEach((el) => {
      el.addEventListener("click", () => openDayPanel(el.dataset.date));
    });
  }

  function renderTaskForm(task) {
    return `
      <div class="edit-form task-form" data-collection="tasks">
        <input type="text" class="form-row-input task-form-title" value="${task ? escapeHtml(task.title) : ""}" maxlength="200" placeholder="Task title" />
        <textarea class="edit-body task-form-body js-rich-editor" maxlength="8000" placeholder="What should students do?">${task ? escapeHtml(task.body) : ""}</textarea>
        <div class="form-actions">
          <button type="button" class="btn btn-primary" data-action="save-task">${task ? "Save" : "Post Task"}</button>
          <button type="button" class="btn btn-secondary" data-action="cancel-task">Cancel</button>
          <span class="form-status"></span>
        </div>
      </div>`;
  }

  function attachTaskFormHandlers(formEl, { onSave, onCancel }) {
    formEl.querySelector('[data-action="cancel-task"]').addEventListener("click", onCancel);
    formEl.querySelector('[data-action="save-task"]').addEventListener("click", async () => {
      const title = formEl.querySelector(".task-form-title").value.trim();
      const body = formEl.querySelector(".task-form-body").value.trim();
      const statusEl = formEl.querySelector(".form-status");
      if (!title || !body) return;
      const saveBtn = formEl.querySelector('[data-action="save-task"]');
      saveBtn.disabled = true;
      statusEl.textContent = "Saving…";
      try {
        await onSave(title, body);
      } catch (e) {
        statusEl.textContent = e.message || "Couldn't save — try again.";
        saveBtn.disabled = false;
      }
    });
  }

  function refreshAfterChange() {
    rebuildIndex();
    renderDayPanel();
    const app = document.getElementById("tasks-app");
    if (app) renderCalendar(app);
  }

  function startAddTask(addBtn) {
    addBtn.hidden = true;
    const holder = document.getElementById("add-task-form-holder");
    holder.innerHTML = renderTaskForm(null);
    const formEl = holder.firstElementChild;
    const textarea = formEl.querySelector(".task-form-body");
    if (window.ForumEditor) window.ForumEditor.wrap(textarea);

    attachTaskFormHandlers(formEl, {
      onCancel: () => {
        holder.innerHTML = "";
        addBtn.hidden = false;
      },
      onSave: async (title, body) => {
        const created = await apiPost("/post", { collection: "tasks", title, body, date: openDate });
        allTasks.unshift(created);
        refreshAfterChange();
      },
    });
  }

  function enterTaskEditMode(card, task) {
    if (card.querySelector(".task-form")) return;
    const titleEl = card.querySelector(".task-card-title");
    const bodyEl = card.querySelector(".task-card-body");
    titleEl.hidden = true;
    bodyEl.hidden = true;

    const holder = document.createElement("div");
    holder.innerHTML = renderTaskForm(task);
    const formEl = holder.firstElementChild;
    bodyEl.insertAdjacentElement("afterend", formEl);
    const textarea = formEl.querySelector(".task-form-body");
    if (window.ForumEditor) window.ForumEditor.wrap(textarea);

    attachTaskFormHandlers(formEl, {
      onCancel: () => {
        formEl.remove();
        titleEl.hidden = false;
        bodyEl.hidden = false;
      },
      onSave: async (title, body) => {
        const updated = await apiPost("/edit", { collection: "tasks", postId: task.id, title, body });
        Object.assign(task, updated);
        refreshAfterChange();
      },
    });
  }

  function renderTaskCard(t, session, instr) {
    const likes = t.likes || [];
    const done = session ? likes.some((l) => String(l).toLowerCase() === session.login.toLowerCase()) : false;
    const editedNote = t.editedAt ? '<span class="note-edited">(edited)</span>' : "";
    const doneList = likes.length
      ? `<div class="done-list">${likes
          .map((l) => `<span class="done-chip"><img class="done-avatar" src="${avatarFor(l)}" alt="" width="20" height="20" loading="lazy" />@${escapeHtml(l)}</span>`)
          .join("")}</div>`
      : `<p class="done-list-empty">No one yet — be the first!</p>`;

    return `
      <article class="task-card" data-task-id="${escapeHtml(t.id)}">
        <div class="task-card-head">
          <h3 class="task-card-title">${escapeHtml(t.title)}</h3>
          ${editedNote}
          ${instr ? `<button type="button" class="edit-btn" data-action="edit-task">✏️ Edit</button><button type="button" class="edit-btn delete-btn" data-action="delete-task">🗑️ Delete</button>` : ""}
        </div>
        <div class="task-card-body rendered-content">${renderMarkdown(t.body)}</div>
        <div class="task-card-footer">
          <button type="button" class="btn ${done ? "btn-primary" : "btn-secondary"} done-toggle-btn" data-action="toggle-done" aria-pressed="${done}">
            ${done ? "✅ Done" : "☐ Mark Done"}
          </button>
          <span class="done-summary">${likes.length} done</span>
        </div>
        ${doneList}
      </article>`;
  }

  function renderDayPanel() {
    const panel = document.getElementById("task-day-panel");
    const body = panel.querySelector(".task-day-panel-body");
    if (!openDate) return;

    const session = getSession();
    const instr = !!(session && isInstructor(session.login));
    const dayTasks = (tasksByDate.get(openDate) || []).slice().sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));

    const tasksHtml = dayTasks.length
      ? dayTasks.map((t) => renderTaskCard(t, session, instr)).join("")
      : `<p class="tasks-empty-note">No tasks posted for this day yet.</p>`;

    body.innerHTML = `
      <h2 class="task-day-title">${formatLong(openDate)}</h2>
      ${tasksHtml}
      ${instr ? `<button type="button" class="btn btn-secondary" id="add-task-for-day">+ Add Task</button><div id="add-task-form-holder"></div>` : ""}
    `;

    wireDayPanel();
  }

  function wireDayPanel() {
    const panel = document.getElementById("task-day-panel");

    panel.querySelectorAll('[data-action="toggle-done"]').forEach((btn) => {
      btn.addEventListener("click", async () => {
        const session = getSession();
        if (!session) {
          window.ForumAuth.login();
          return;
        }
        const card = btn.closest(".task-card");
        const taskId = card.dataset.taskId;
        btn.disabled = true;
        try {
          const result = await apiPost("/like", { collection: "tasks", postId: taskId });
          const task = allTasks.find((t) => t.id === taskId);
          if (task) {
            task.likes = task.likes || [];
            const idx = task.likes.findIndex((l) => String(l).toLowerCase() === session.login.toLowerCase());
            if (result.liked && idx === -1) task.likes.push(session.login);
            if (!result.liked && idx !== -1) task.likes.splice(idx, 1);
          }
          refreshAfterChange();
        } catch (e) {
          alert(e.message || "Couldn't update — try again.");
          btn.disabled = false;
        }
      });
    });

    panel.querySelectorAll('[data-action="delete-task"]').forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("Delete this task? This can't be undone.")) return;
        const card = btn.closest(".task-card");
        const taskId = card.dataset.taskId;
        btn.disabled = true;
        try {
          await apiPost("/delete", { collection: "tasks", postId: taskId });
          allTasks = allTasks.filter((t) => t.id !== taskId);
          refreshAfterChange();
        } catch (e) {
          alert(e.message || "Couldn't delete — try again.");
          btn.disabled = false;
        }
      });
    });

    panel.querySelectorAll('[data-action="edit-task"]').forEach((btn) => {
      btn.addEventListener("click", () => {
        const card = btn.closest(".task-card");
        const taskId = card.dataset.taskId;
        const task = allTasks.find((t) => t.id === taskId);
        if (task) enterTaskEditMode(card, task);
      });
    });

    const addBtn = panel.querySelector("#add-task-for-day");
    if (addBtn) addBtn.addEventListener("click", () => startAddTask(addBtn));
  }

  function openDayPanel(ds) {
    openDate = ds;
    const panel = document.getElementById("task-day-panel");
    panel.hidden = false;
    renderDayPanel();
  }

  function closeDayPanel() {
    const panel = document.getElementById("task-day-panel");
    panel.hidden = true;
    openDate = null;
  }

  function shiftMonth(delta, app) {
    viewMonth += delta;
    if (viewMonth < 0) {
      viewMonth = 11;
      viewYear -= 1;
    }
    if (viewMonth > 11) {
      viewMonth = 0;
      viewYear += 1;
    }
    renderCalendar(app);
  }

  document.addEventListener("DOMContentLoaded", () => {
    const app = document.getElementById("tasks-app");
    if (!app) return;

    const now = new Date();
    viewYear = now.getFullYear();
    viewMonth = now.getMonth();

    app.querySelector('[data-action="prev-month"]').addEventListener("click", () => shiftMonth(-1, app));
    app.querySelector('[data-action="next-month"]').addEventListener("click", () => shiftMonth(1, app));
    app.querySelector('[data-action="today"]').addEventListener("click", () => {
      const t = new Date();
      viewYear = t.getFullYear();
      viewMonth = t.getMonth();
      renderCalendar(app);
    });

    const panel = document.getElementById("task-day-panel");
    panel.querySelector(".task-day-panel-backdrop").addEventListener("click", closeDayPanel);
    panel.querySelector(".task-day-panel-close").addEventListener("click", closeDayPanel);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !panel.hidden) closeDayPanel();
    });

    loadTasks(app);
  });
})();
