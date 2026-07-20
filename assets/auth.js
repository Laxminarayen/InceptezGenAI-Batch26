(function () {
  const API_BASE = "https://inceptez-forum-api.nvlnarayen2496.workers.dev";
  // Public GitHub OAuth App client ID (not secret — safe to embed).
  const GITHUB_CLIENT_ID = "Ov23liAgv7WXEm2yjRyw";
  const SESSION_KEY = "forum-session";

  function base64UrlDecode(str) {
    const b64 = str.replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
    return decodeURIComponent(
      atob(b64 + pad)
        .split("")
        .map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
        .join("")
    );
  }

  function decodeSession(token) {
    try {
      const parts = token.split(".");
      if (parts.length !== 3) return null;
      const payload = JSON.parse(base64UrlDecode(parts[1]));
      if (!payload.login || !payload.exp) return null;
      if (Math.floor(Date.now() / 1000) > payload.exp) return null;
      return { token, login: payload.login, avatarUrl: payload.avatarUrl };
    } catch (e) {
      return null;
    }
  }

  function loadSession() {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const session = decodeSession(raw);
    if (!session) localStorage.removeItem(SESSION_KEY);
    return session;
  }

  function saveSession(token) {
    localStorage.setItem(SESSION_KEY, token);
  }

  function clearSession() {
    localStorage.removeItem(SESSION_KEY);
  }

  function login() {
    const redirectUri = `${API_BASE}/auth/callback`;
    const state = encodeURIComponent(location.href.split("#")[0]);
    const authUrl =
      `https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(GITHUB_CLIENT_ID)}` +
      `&scope=read:user&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;
    location.href = authUrl;
  }

  function logout() {
    clearSession();
    location.reload();
  }

  function consumeHashToken() {
    const hash = location.hash || "";
    const authMatch = hash.match(/(?:^#|&)auth=([^&]+)/);
    const errorMatch = hash.match(/(?:^#|&)auth-error=([^&]+)/);
    if (authMatch) {
      saveSession(decodeURIComponent(authMatch[1]));
      history.replaceState(null, "", location.pathname + location.search);
      return { ok: true };
    }
    if (errorMatch) {
      history.replaceState(null, "", location.pathname + location.search);
      return { ok: false, message: decodeURIComponent(errorMatch[1]) };
    }
    return null;
  }

  function renderAuthUI() {
    const slot = document.getElementById("auth-slot");
    if (!slot) return;
    const session = loadSession();
    slot.innerHTML = "";

    if (session) {
      const wrap = document.createElement("div");
      wrap.className = "auth-user";
      const avatar = document.createElement("img");
      avatar.className = "auth-avatar";
      avatar.src = session.avatarUrl || "";
      avatar.alt = "";
      avatar.width = 24;
      avatar.height = 24;
      const name = document.createElement("span");
      name.className = "auth-name";
      name.textContent = `@${session.login}`;
      const signOut = document.createElement("button");
      signOut.type = "button";
      signOut.className = "auth-signout";
      signOut.textContent = "Sign out";
      signOut.addEventListener("click", logout);
      wrap.appendChild(avatar);
      wrap.appendChild(name);
      wrap.appendChild(signOut);
      slot.appendChild(wrap);
    } else {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "auth-signin";
      btn.innerHTML =
        '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"></path></svg> Sign in with GitHub';
      btn.addEventListener("click", login);
      slot.appendChild(btn);
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    const result = consumeHashToken();
    renderAuthUI();
    if (result && result.ok) renderAuthUI();
    if (result && result.ok === false) {
      const slot = document.getElementById("auth-slot");
      if (slot) {
        const err = document.createElement("span");
        err.className = "auth-error";
        err.textContent = `Sign-in failed: ${result.message}`;
        slot.appendChild(err);
      }
    }
  });

  window.ForumAuth = {
    getSession: loadSession,
    login,
    logout,
    isReady: GITHUB_CLIENT_ID !== "REPLACE_WITH_OAUTH_CLIENT_ID",
  };
})();
