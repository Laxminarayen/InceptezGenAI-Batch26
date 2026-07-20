(function () {
  const EMOJIS = [
    ["😀", "smile"], ["😂", "joy"], ["😅", "sweat_smile"], ["😊", "blush"], ["🙂", "slight_smile"],
    ["😍", "heart_eyes"], ["🤔", "thinking"], ["😎", "sunglasses"], ["😴", "sleeping"], ["😭", "sob"],
    ["😡", "rage"], ["😬", "grimace"], ["🙃", "upside_down"], ["🥳", "partying"], ["😇", "innocent"],
    ["👍", "+1"], ["👎", "-1"], ["👏", "clap"], ["🙌", "raised_hands"], ["🙏", "pray"],
    ["💪", "muscle"], ["🤝", "handshake"], ["✌️", "v"], ["👀", "eyes"], ["🖐️", "hand"],
    ["🔥", "fire"], ["✨", "sparkles"], ["🎉", "tada"], ["🚀", "rocket"], ["💡", "bulb"],
    ["⭐", "star"], ["✅", "white_check_mark"], ["❌", "x"], ["❓", "question"], ["❗", "exclamation"],
    ["⚠️", "warning"], ["📌", "pushpin"], ["📝", "memo"], ["📊", "bar_chart"], ["📈", "chart_increasing"],
    ["🐍", "snake"], ["🐛", "bug"], ["💻", "computer"], ["🧠", "brain"], ["📚", "books"],
    ["🎯", "dart"], ["🔗", "link"], ["⏰", "alarm_clock"], ["📅", "calendar"], ["🧩", "puzzle"],
    ["🏆", "trophy"], ["🎓", "graduation_cap"], ["👨‍💻", "man_technologist"], ["👩‍💻", "woman_technologist"], ["🤖", "robot"],
    ["💬", "speech_balloon"], ["❤️", "heart"], ["👋", "wave"], ["🙋", "raising_hand"], ["🧵", "thread"],
  ];

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
    return div.innerHTML;
  }

  function wrapSelection(textarea, before, after, placeholder) {
    const { selectionStart, selectionEnd, value } = textarea;
    const selected = value.slice(selectionStart, selectionEnd) || placeholder;
    const replacement = `${before}${selected}${after}`;
    textarea.focus();
    textarea.setRangeText(replacement, selectionStart, selectionEnd, "end");
    const innerStart = selectionStart + before.length;
    textarea.setSelectionRange(innerStart, innerStart + selected.length);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function applyLinePrefix(textarea, makeLine) {
    const { value, selectionStart, selectionEnd } = textarea;
    const lineStart = value.lastIndexOf("\n", selectionStart - 1) + 1;
    let lineEnd = value.indexOf("\n", selectionEnd > selectionStart ? selectionEnd - 1 : selectionEnd);
    if (lineEnd === -1) lineEnd = value.length;
    const block = value.slice(lineStart, lineEnd);
    const lines = block.split("\n");
    const newBlock = lines.map(makeLine).join("\n");
    textarea.focus();
    textarea.setRangeText(newBlock, lineStart, lineEnd, "end");
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function toggleHeading(textarea) {
    applyLinePrefix(textarea, (line) => (line.startsWith("## ") ? line.slice(3) : `## ${line}`));
  }

  function toggleQuote(textarea) {
    applyLinePrefix(textarea, (line) => (line.startsWith("> ") ? line.slice(2) : `> ${line}`));
  }

  function toggleBulletList(textarea) {
    applyLinePrefix(textarea, (line) => (line.startsWith("- ") ? line.slice(2) : `- ${line}`));
  }

  function toggleNumberedList(textarea) {
    let i = 0;
    applyLinePrefix(textarea, (line) => {
      const stripped = line.replace(/^\d+\.\s+/, "");
      i += 1;
      return stripped === line ? `${i}. ${line}` : stripped;
    });
  }

  function insertLink(textarea) {
    const { selectionStart, selectionEnd, value } = textarea;
    const selected = value.slice(selectionStart, selectionEnd);
    const text = selected || "link text";
    const replacement = `[${text}](https://)`;
    textarea.focus();
    textarea.setRangeText(replacement, selectionStart, selectionEnd, "end");
    const urlStart = selectionStart + text.length + 3; // after "[text]("
    textarea.setSelectionRange(urlStart, urlStart + "https://".length);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function insertAtCursor(textarea, text) {
    const { selectionStart, selectionEnd } = textarea;
    textarea.focus();
    textarea.setRangeText(text, selectionStart, selectionEnd, "end");
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  }

  const MAX_IMAGE_DIMENSION = 1280;
  const IMAGE_QUALITY = 0.85;
  const MAX_SOURCE_FILE_BYTES = 12 * 1024 * 1024; // reject absurdly large source files outright

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("Couldn't read the file."));
      reader.readAsDataURL(file);
    });
  }

  function loadImageEl(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("That doesn't look like a valid image."));
      img.src = dataUrl;
    });
  }

  // Resizes/re-encodes large images client-side before upload. GIFs pass through
  // untouched (canvas would flatten animation to a single frame).
  async function prepareImage(file) {
    if (file.size > MAX_SOURCE_FILE_BYTES) throw new Error("Image is too large (max 12MB).");

    if (file.type === "image/gif") {
      const dataUrl = await readFileAsDataUrl(file);
      return { dataUrl, contentType: "image/gif" };
    }

    const sourceDataUrl = await readFileAsDataUrl(file);
    const img = await loadImageEl(sourceDataUrl);
    const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const outType = "image/jpeg";
    const dataUrl = canvas.toDataURL(outType, IMAGE_QUALITY);
    return { dataUrl, contentType: outType };
  }

  async function uploadImageFile(file, collection, onStatus) {
    if (!file.type.startsWith("image/")) throw new Error("Only image files are supported.");
    if (!window.ForumAPI) throw new Error("Image uploads aren't available on this page.");
    if (!window.ForumAPI.ready) throw new Error(window.ForumAPI.notReadyMessage);

    onStatus && onStatus("Preparing image…");
    const { dataUrl, contentType } = await prepareImage(file);
    const base64 = dataUrl.split(",")[1];

    onStatus && onStatus("Uploading…");
    const result = await window.ForumAPI.uploadImage({
      collection,
      filename: file.name || "image",
      contentType,
      dataBase64: base64,
    });
    return result.url;
  }

  function altTextFromFilename(name) {
    return (name || "image").replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ").trim() || "image";
  }

  function handleEnterAutoList(e, textarea) {
    if (e.key !== "Enter" || e.shiftKey) return false;
    const { value, selectionStart } = textarea;
    const lineStart = value.lastIndexOf("\n", selectionStart - 1) + 1;
    const currentLine = value.slice(lineStart, selectionStart);

    const bulletMatch = currentLine.match(/^(\s*)([-*])\s+/);
    const numberMatch = currentLine.match(/^(\s*)(\d+)\.\s+/);
    const quoteMatch = currentLine.match(/^(\s*)>\s+/);
    const marker = bulletMatch || numberMatch || quoteMatch;
    if (!marker) return false;

    const rest = currentLine.slice(marker[0].length);
    e.preventDefault();
    if (rest.trim() === "") {
      textarea.setRangeText("", lineStart, selectionStart, "end");
      return true;
    }
    let insertion;
    if (bulletMatch) insertion = `\n${bulletMatch[1]}${bulletMatch[2]} `;
    else if (numberMatch) insertion = `\n${numberMatch[1]}${parseInt(numberMatch[2], 10) + 1}. `;
    else insertion = `\n${quoteMatch[1]}> `;
    textarea.setRangeText(insertion, selectionStart, selectionStart, "end");
    return true;
  }

  function buildToolbarButton(icon, title, onClick) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "editor-btn";
    btn.title = title;
    btn.innerHTML = icon;
    btn.addEventListener("click", onClick);
    return btn;
  }

  function positionDropdown(dropdown, textarea) {
    const rect = textarea.getBoundingClientRect();
    dropdown.style.left = "0px";
    dropdown.style.top = `${textarea.offsetHeight + 4}px`;
  }

  function createDropdown() {
    const el = document.createElement("div");
    el.className = "editor-dropdown";
    el.hidden = true;
    return el;
  }

  function wireTrigger(textarea, dropdown, opts) {
    // opts: { triggerRe, getItems(query) -> [{label, apply(match)}], renderItem }
    let activeIndex = 0;
    let currentMatch = null;

    function close() {
      dropdown.hidden = true;
      dropdown.innerHTML = "";
      currentMatch = null;
    }

    function renderList(items) {
      dropdown.innerHTML = "";
      items.forEach((item, i) => {
        const row = document.createElement("div");
        row.className = "editor-dropdown-item" + (i === activeIndex ? " is-active" : "");
        row.innerHTML = opts.renderItem(item);
        row.addEventListener("mousedown", (e) => {
          e.preventDefault();
          select(item);
        });
        dropdown.appendChild(row);
      });
    }

    function select(item) {
      if (!currentMatch) return;
      const { start, end } = currentMatch;
      textarea.focus();
      const insertText = item.insert;
      textarea.setRangeText(insertText, start, end, "end");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      close();
    }

    textarea.addEventListener("input", () => {
      const value = textarea.value;
      const caret = textarea.selectionStart;
      const before = value.slice(0, caret);
      const m = before.match(opts.triggerRe);
      if (!m) {
        close();
        return;
      }
      const query = m[1];
      const items = opts.getItems(query);
      if (!items.length) {
        close();
        return;
      }
      currentMatch = { start: caret - m[0].length, end: caret };
      activeIndex = 0;
      positionDropdown(dropdown, textarea);
      dropdown.hidden = false;
      renderList(items.map((it) => ({ ...it, insert: opts.buildInsert(it, m[0]) })));
    });

    textarea.addEventListener("keydown", (e) => {
      if (dropdown.hidden) return;
      const items = Array.from(dropdown.children);
      if (!items.length) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        activeIndex = (activeIndex + 1) % items.length;
        items.forEach((it, i) => it.classList.toggle("is-active", i === activeIndex));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        activeIndex = (activeIndex - 1 + items.length) % items.length;
        items.forEach((it, i) => it.classList.toggle("is-active", i === activeIndex));
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        items[activeIndex].dispatchEvent(new MouseEvent("mousedown"));
      } else if (e.key === "Escape") {
        close();
      }
    });

    textarea.addEventListener("blur", () => setTimeout(close, 150));
  }

  function buildEmojiPopover(textarea) {
    const popover = document.createElement("div");
    popover.className = "emoji-popover";
    popover.hidden = true;

    const search = document.createElement("input");
    search.type = "text";
    search.placeholder = "Search emoji…";
    search.className = "emoji-search";
    popover.appendChild(search);

    const grid = document.createElement("div");
    grid.className = "emoji-grid";
    popover.appendChild(grid);

    function renderGrid(query) {
      grid.innerHTML = "";
      const q = query.trim().toLowerCase();
      const matches = EMOJIS.filter(([, code]) => !q || code.includes(q)).slice(0, 48);
      matches.forEach(([char, code]) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "emoji-grid-item";
        btn.textContent = char;
        btn.title = `:${code}:`;
        btn.addEventListener("mousedown", (e) => {
          e.preventDefault();
          insertAtCursor(textarea, char);
          popover.hidden = true;
        });
        grid.appendChild(btn);
      });
    }
    renderGrid("");
    search.addEventListener("input", () => renderGrid(search.value));

    return { popover, renderGrid, search };
  }

  function wrapEditor(textarea) {
    if (textarea.dataset.editorWrapped) return;
    textarea.dataset.editorWrapped = "1";

    const wrap = document.createElement("div");
    wrap.className = "editor-wrap";
    textarea.parentNode.insertBefore(wrap, textarea);

    const toolbar = document.createElement("div");
    toolbar.className = "editor-toolbar";
    wrap.appendChild(toolbar);

    toolbar.appendChild(buildToolbarButton("<b>B</b>", "Bold (Ctrl+B)", () => wrapSelection(textarea, "**", "**", "bold text")));
    toolbar.appendChild(buildToolbarButton("<i>i</i>", "Italic (Ctrl+I)", () => wrapSelection(textarea, "_", "_", "italic text")));
    toolbar.appendChild(buildToolbarButton("H", "Heading", () => toggleHeading(textarea)));
    toolbar.appendChild(buildToolbarButton("“”", "Quote", () => toggleQuote(textarea)));
    toolbar.appendChild(buildToolbarButton("&lt;/&gt;", "Code", () => wrapSelection(textarea, "`", "`", "code")));
    toolbar.appendChild(buildToolbarButton("•", "Bullet list", () => toggleBulletList(textarea)));
    toolbar.appendChild(buildToolbarButton("1.", "Numbered list", () => toggleNumberedList(textarea)));
    toolbar.appendChild(buildToolbarButton("🔗", "Link (Ctrl+K)", () => insertLink(textarea)));

    const imageInput = document.createElement("input");
    imageInput.type = "file";
    imageInput.accept = "image/png,image/jpeg,image/webp,image/gif";
    imageInput.hidden = true;
    toolbar.appendChild(buildToolbarButton("🖼️", "Add image", () => imageInput.click()));
    toolbar.appendChild(imageInput);

    const emojiWrap = document.createElement("div");
    emojiWrap.className = "editor-emoji-wrap";
    const emojiBtn = buildToolbarButton("😊", "Emoji", () => {
      emojiPopover.hidden = !emojiPopover.hidden;
      if (!emojiPopover.hidden) emojiSearch.focus();
    });
    emojiWrap.appendChild(emojiBtn);
    const { popover: emojiPopover, search: emojiSearch } = buildEmojiPopover(textarea);
    emojiWrap.appendChild(emojiPopover);
    toolbar.appendChild(emojiWrap);
    document.addEventListener("click", (e) => {
      if (!emojiWrap.contains(e.target)) emojiPopover.hidden = true;
    });

    const spacer = document.createElement("span");
    spacer.className = "editor-toolbar-spacer";
    toolbar.appendChild(spacer);

    const tabs = document.createElement("div");
    tabs.className = "editor-tabs";
    const writeTab = document.createElement("button");
    writeTab.type = "button";
    writeTab.className = "editor-tab is-active";
    writeTab.textContent = "Write";
    const previewTab = document.createElement("button");
    previewTab.type = "button";
    previewTab.className = "editor-tab";
    previewTab.textContent = "Preview";
    tabs.appendChild(writeTab);
    tabs.appendChild(previewTab);
    toolbar.appendChild(tabs);

    const body = document.createElement("div");
    body.className = "editor-body";
    wrap.appendChild(body);
    body.appendChild(textarea);

    const preview = document.createElement("div");
    preview.className = "editor-preview rendered-content";
    preview.hidden = true;
    body.appendChild(preview);

    const mentionDropdown = createDropdown();
    const emojiDropdown = createDropdown();
    body.style.position = "relative";
    body.appendChild(mentionDropdown);
    body.appendChild(emojiDropdown);

    const footer = document.createElement("div");
    footer.className = "editor-footer";
    const hint = document.createElement("span");
    hint.className = "editor-hint";
    hint.textContent = "Markdown supported · @mention · :emoji: · drop or paste an image";
    const uploadStatus = document.createElement("span");
    uploadStatus.className = "editor-upload-status";
    const charCount = document.createElement("span");
    charCount.className = "editor-charcount";
    footer.appendChild(hint);
    footer.appendChild(uploadStatus);
    footer.appendChild(charCount);
    wrap.appendChild(footer);

    function collectionFor(el) {
      const host = el.closest("[data-collection]");
      return host ? host.dataset.collection : "";
    }

    async function handleImageFile(file) {
      const collection = collectionFor(textarea);
      uploadStatus.textContent = "";
      uploadStatus.className = "editor-upload-status";
      try {
        const url = await uploadImageFile(file, collection, (msg) => {
          uploadStatus.textContent = msg;
        });
        insertAtCursor(textarea, `![${altTextFromFilename(file.name)}](${url})\n`);
        uploadStatus.textContent = "Image added ✓";
        setTimeout(() => (uploadStatus.textContent = ""), 2500);
      } catch (err) {
        uploadStatus.textContent = err.message || "Couldn't upload that image.";
        uploadStatus.className = "editor-upload-status is-error";
      }
    }

    imageInput.addEventListener("change", () => {
      if (imageInput.files && imageInput.files[0]) handleImageFile(imageInput.files[0]);
      imageInput.value = "";
    });

    ["dragenter", "dragover"].forEach((evt) =>
      wrap.addEventListener(evt, (e) => {
        if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes("Files")) return;
        e.preventDefault();
        wrap.classList.add("is-dragover");
      })
    );
    ["dragleave", "dragend"].forEach((evt) =>
      wrap.addEventListener(evt, () => wrap.classList.remove("is-dragover"))
    );
    wrap.addEventListener("drop", (e) => {
      wrap.classList.remove("is-dragover");
      const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (file && file.type.startsWith("image/")) {
        e.preventDefault();
        handleImageFile(file);
      }
    });

    textarea.addEventListener("paste", (e) => {
      const items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      const imageItem = Array.from(items).find((it) => it.type && it.type.startsWith("image/"));
      if (!imageItem) return;
      const file = imageItem.getAsFile();
      if (!file) return;
      e.preventDefault();
      handleImageFile(file);
    });

    function updateCharCount() {
      const max = textarea.getAttribute("maxlength");
      charCount.textContent = max ? `${textarea.value.length}/${max}` : "";
    }
    textarea.addEventListener("input", updateCharCount);
    updateCharCount();

    writeTab.addEventListener("click", () => {
      writeTab.classList.add("is-active");
      previewTab.classList.remove("is-active");
      preview.hidden = true;
      textarea.hidden = false;
    });
    previewTab.addEventListener("click", () => {
      previewTab.classList.add("is-active");
      writeTab.classList.remove("is-active");
      textarea.hidden = true;
      preview.hidden = false;
      const renderer = window.ForumMarkdown && window.ForumMarkdown.render;
      preview.innerHTML = renderer
        ? textarea.value.trim()
          ? renderer(textarea.value)
          : '<p class="editor-preview-empty">Nothing to preview yet.</p>'
        : `<p>${escapeHtml(textarea.value)}</p>`;
    });

    textarea.addEventListener("keydown", (e) => {
      if (handleEnterAutoList(e, textarea)) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "b") {
        e.preventDefault();
        wrapSelection(textarea, "**", "**", "bold text");
      } else if (mod && e.key.toLowerCase() === "i") {
        e.preventDefault();
        wrapSelection(textarea, "_", "_", "italic text");
      } else if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        insertLink(textarea);
      }
    });

    // @mention autocomplete
    wireTrigger(textarea, mentionDropdown, {
      triggerRe: /@([a-zA-Z0-9_-]{0,39})$/,
      getItems(query) {
        const collection = textarea.closest("[data-collection]");
        const key = collection && collection.dataset.collection;
        const known = (window.ForumKnownAuthors && window.ForumKnownAuthors[key]) || new Set();
        const q = query.toLowerCase();
        return Array.from(known)
          .filter((name) => name.toLowerCase().includes(q))
          .slice(0, 6)
          .map((name) => ({ label: name }));
      },
      buildInsert(item) {
        return `@${item.label} `;
      },
      renderItem(item) {
        return `@${escapeHtml(item.label)}`;
      },
    });

    // :emoji: shortcode autocomplete
    wireTrigger(textarea, emojiDropdown, {
      triggerRe: /:([a-z0-9_+-]{2,}):?$/,
      getItems(query) {
        const q = query.toLowerCase();
        return EMOJIS.filter(([, code]) => code.includes(q))
          .slice(0, 8)
          .map(([char, code]) => ({ char, code }));
      },
      buildInsert(item) {
        return item.char;
      },
      renderItem(item) {
        return `<span class="editor-dropdown-emoji">${item.char}</span> :${escapeHtml(item.code)}:`;
      },
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("textarea.js-rich-editor").forEach(wrapEditor);
  });

  window.ForumEditor = { wrap: wrapEditor };
})();
