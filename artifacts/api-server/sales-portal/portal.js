(function () {
  const API_BASE = "/api";
  const TOKEN_KEY = "projectAlphaSalesPortalToken";
  const USER_KEY = "projectAlphaSalesPortalUser";
  const LISTING_DRAFT_KEY = "projectAlphaSalesPortalListingDraft";
  const MAX_LISTING_PHOTOS = 20;
  // Every listing photo is normalised to a uniform 4:3 landscape frame so cards
  // and the detail gallery render consistently across scraped and agent uploads.
  const LISTING_IMAGE_TARGET_WIDTH = 1600;
  const LISTING_IMAGE_TARGET_HEIGHT = 1200;

  const LISTING_STEPS = ["Photos", "Address", "Property details", "Price & sale", "Documents", "Description"];
  const STEP_ERROR_KEYS = [["imageUrls"], ["address"], ["propertyTag", "details"], ["pricing"], ["documents"], ["copy"]];
  const PROPERTY_TAGS = {
    house: "Residential House",
    rural: "Lifestyle Block",
    apartment: "Apartment",
    unit: "Unit",
    townhouse: "Terrace housing",
    commercial: "Commercial",
  };
  const METHOD_LABELS = {
    auction: "Auction",
    tender: "Tender",
    asking_price: "Asking Price",
    deadline_sale: "Deadline Sale",
    price_by_negotiation: "Price by Negotiation",
  };

  const state = {
    verificationId: null,
    verifiedPhone: null,
    phoneVerificationToken: null,
    resetCodeRequested: false,
    currentUser: null,
    listings: [],
    listingStep: 0,
    listingPhotos: [],
    listingDocuments: [],
    addressTimer: null,
    lastAddressQuery: "",
    otpCooldownTimer: null,
    pendingSignupPayload: null,
    pendingSignupForm: null,
    paywallContext: "signup",
    pendingListingPublish: false,
  };

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));

  function setStatus(element, message, type) {
    if (!element) return;
    element.textContent = message || "";
    element.classList.remove("success", "error");
    if (type) element.classList.add(type);
  }

  function getErrorMessage(error, fallback) {
    if (error && typeof error.message === "string" && error.message.trim()) return error.message;
    return fallback;
  }

  async function api(path, options) {
    const response = await fetch(`${API_BASE}${path}`, {
      headers: {
        "Content-Type": "application/json",
        ...(options && options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      },
      ...options,
      body: options && options.body ? JSON.stringify(options.body) : undefined,
    });
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (!response.ok) {
      const message = payload && payload.error ? payload.error : "Request failed. Please try again.";
      const error = new Error(message);
      if (payload && payload.retryAfterSeconds) error.retryAfterSeconds = payload.retryAfterSeconds;
      if (payload && payload.code) error.code = payload.code;
      throw error;
    }
    return payload;
  }

  async function uploadFile(path, token, file, extraFields) {
    const body = new FormData();
    body.append("file", file);
    Object.entries(extraFields || {}).forEach(([key, value]) => body.append(key, value));
    const response = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body,
    });
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (!response.ok) {
      const message = payload && payload.error ? payload.error : "Upload failed. Please try again.";
      const error = new Error(message);
      if (payload && payload.code) error.code = payload.code;
      throw error;
    }
    return payload;
  }

  // Upload via a presigned URL so the file goes DIRECTLY to object storage,
  // bypassing the serverless function body cap (Vercel 413). Falls back to the
  // same-origin multipart endpoint on any non-validation error — e.g. when
  // signed URLs aren't available, or the bucket's CORS blocks the cross-origin
  // PUT (surfaces as a "Failed to fetch" TypeError).
  async function uploadViaSignedUrl(basePath, token, file, extraFields) {
    const meta = {
      name: file.name || "upload",
      size: file.size,
      contentType: file.type || "application/octet-stream",
      ...(extraFields || {}),
    };
    const signed = await api(`${basePath}/request-url`, { method: "POST", token, body: meta });
    const uploadResp = await fetch(signed.uploadURL, {
      method: "PUT",
      headers: signed.requiredHeaders || { "Content-Type": meta.contentType },
      body: file,
    });
    if (!uploadResp.ok) throw new Error("Upload failed. Please try again.");
    return api(`${basePath}/complete`, {
      method: "POST",
      token,
      body: { objectPath: signed.objectPath, ...meta },
    });
  }

  async function uploadWithFallback(basePath, token, file, extraFields) {
    try {
      return await uploadViaSignedUrl(basePath, token, file, extraFields);
    } catch (error) {
      const code = error && error.code;
      // Validation rejections are deterministic — don't silently retry multipart.
      if (code === "INVALID_FILE_TYPE" || code === "INVALID_SIZE" || code === "INVALID_NAME" || code === "INVALID_CATEGORY") {
        throw error;
      }
      return uploadFile(basePath, token, file, extraFields);
    }
  }

  function formValues(form) {
    return Object.fromEntries(new FormData(form).entries());
  }

  function saveSession(token, user) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user || {}));
    state.currentUser = user || null;
  }

  function clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }

  function getSession() {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return null;
    try {
      return { token, user: JSON.parse(localStorage.getItem(USER_KEY) || "{}") };
    } catch {
      return { token, user: {} };
    }
  }

  function showDashboard(user) {
    state.currentUser = user || null;
    const hero = $(".portal-hero");
    if (hero) hero.hidden = true;
    $("#portal-auth").hidden = true;
    $("#portal-dashboard").hidden = false;
    fillProfileForm(user || {});
    updateAccountSummary(user || {});
    const params = new URLSearchParams(window.location.search);
    const requestedTab = params.has("lead") ? "leads" : "listings";
    switchDashboardTab(requestedTab);
    if (requestedTab === "leads") {
      // Trigger the inbox module's normal activation path as well as changing
      // the visible tab. The short-link token itself never reveals a lead.
      window.setTimeout(() => $('[data-dashboard-target="leads"]')?.click(), 0);
    } else if (params.get("upgrade") === "listings") {
      // Mobile sends gated agents here. If they had no browser session they
      // first sign in; this same branch then opens the Stripe/invitation modal.
      const cleanUrl = new URL(window.location.href);
      cleanUrl.searchParams.delete("upgrade");
      window.history.replaceState({}, document.title, `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`);
      window.setTimeout(() => openPaywall("listing"), 0);
    }
    void refreshListings();
  }

  function showAuth() {
    const hero = $(".portal-hero");
    if (hero) hero.hidden = false;
    $("#portal-auth").hidden = false;
    $("#portal-dashboard").hidden = true;
  }

  function updateListingMetrics(listings) {
    const total = listings.length;
    const active = listings.filter((listing) => listing.status !== "paused").length;
    const paused = total - active;
    const set = (selector, value) => {
      const element = $(selector);
      if (element) element.textContent = String(value);
    };
    set("#metric-total", total);
    set("#metric-active", active);
    set("#metric-paused", paused);
  }

  async function refreshListings() {
    const session = getSession();
    const status = $("#dashboard-status");
    if (!session) {
      showAuth();
      return;
    }
    setStatus(status, "Loading your listings...", null);
    try {
      const data = await api("/listings/my", { method: "GET", token: session.token });
      const listings = Array.isArray(data.listings) ? data.listings : [];
      state.listings = listings;
      updateListingMetrics(listings);
      renderListings(listings);
      setStatus(status, "", null);
    } catch (error) {
      state.listings = [];
      updateListingMetrics([]);
      renderListings([]);
      // Session replaced on another device — sign out cleanly
      if (error && error.code === "SESSION_REPLACED") {
        clearSession();
        showAuth();
        return;
      }
      setStatus(status, getErrorMessage(error, "We couldn't load your listings. Please refresh the page."), "error");
    }
  }

  function switchDashboardTab(target) {
    const labels = {
      listings: "My listings",
      leads: "Leads/messages",
      profile: "Profile",
      account: "Account",
      subscription: "Manage subscription",
    };
    $$(".portal-dashboard-tab").forEach((tab) => {
      const active = tab.dataset.dashboardTarget === target;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", active ? "true" : "false");
    });
    $$(".portal-dashboard-panel").forEach((panel) => {
      const active = panel.dataset.dashboardPanel === target;
      panel.classList.toggle("is-active", active);
      panel.hidden = !active;
    });
    const title = $("#dashboard-title");
    if (title) title.textContent = labels[target] || "Sales dashboard";
    if (target === "subscription") void loadSubscription();
  }

  function listingTitle(listing) {
    return listing.listingTitle || listing.address || "Untitled listing";
  }

  function formatStatus(status) {
    return status === "paused" ? "Paused" : "Active";
  }

  function formatPriceRange(listing) {
    const min = Number(listing.backendSearchPriceMin || 0);
    const max = Number(listing.backendSearchPriceMax || 0);
    if (!min || !max) return listing.priceDisplay || "";
    const format = (value) => `$${value.toLocaleString("en-NZ")}`;
    return min === max ? format(min) : `${format(min)}-${format(max)}`;
  }

  function listingMeta(listing) {
    const bits = [];
    if (listing.propertySubtype || listing.propertyType) bits.push(listing.propertySubtype || listing.propertyType);
    if (listing.methodOfSale) bits.push(METHOD_LABELS[listing.methodOfSale] || listing.methodOfSale);
    const price = formatPriceRange(listing);
    if (price) bits.push(price);
    return bits.join(" | ") || "Property";
  }

  function renderListings(listings) {
    const root = $("#listings-list");
    if (!root) return;
    if (!listings.length) {
      root.innerHTML = `
        <div class="portal-empty">
          <h3>No listings yet</h3>
          <p>Add your first property to start marketing it to Project Alpha buyers.</p>
        </div>
      `;
      return;
    }
    root.innerHTML = listings
      .map((listing) => {
        const isActive = listing.status !== "paused";
        const pending = !listing.approvedAt;
        const image = Array.isArray(listing.imageUrls) && listing.imageUrls[0] ? listing.imageUrls[0] : "";
        const views = Number(listing.totalViews || 0);
        const statusPill = pending
          ? `<span class="portal-pill portal-pill--pending">⏳ Pending approval</span>`
          : `<span class="portal-pill portal-pill--live">✓ Live</span>`;
        return `
          <article class="portal-listing-card" data-listing-id="${escapeHtml(listing.id)}">
            <div class="portal-listing-thumb">${image ? `<img src="${escapeHtml(image)}" alt="" loading="lazy" />` : "<span>No photo</span>"}</div>
            <div class="portal-listing-body">
              <div class="portal-listing-titlerow">
                <h3>${escapeHtml(listingTitle(listing))}</h3>
                ${statusPill}
              </div>
              <p>${escapeHtml(listing.address || "")}</p>
              <p>${escapeHtml(listingMeta(listing))}</p>
              <div class="portal-listing-stats">
                <span>${Number(listing.bedrooms || 0)} bed</span>
                <span>${Number(listing.bathrooms || 0)} bath</span>
                <span>${Number(listing.toilets || 0)} toilet</span>
                <span>${Number(listing.garages || 0)} garage</span>
                <span class="portal-stat-views">👁 ${views.toLocaleString()} views</span>
              </div>
            </div>
            <div class="portal-listing-actions">
              <label class="portal-switch${pending ? " portal-switch--disabled" : ""}">
                <input type="checkbox" data-toggle-listing="${escapeHtml(listing.id)}" ${isActive ? "checked" : ""} ${pending ? "disabled" : ""} />
                <span>${pending ? "Awaiting review" : formatStatus(listing.status)}</span>
              </label>
              ${pending ? `<p class="portal-listing-hint">Live once approved.</p>` : ""}
              <button class="link-button portal-danger" type="button" data-delete-listing="${escapeHtml(listing.id)}">Remove</button>
            </div>
          </article>
        `;
      })
      .join("");
  }

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  // ── Lightweight Markdown editor (no dependency) ────────────────────────────
  const MD_EMOJIS = [
    "😊", "😍", "🤩", "👍", "🔥", "✨", "🎉", "🏡", "🏠", "🛏️",
    "🛁", "🚗", "🌳", "🌞", "🌊", "🏖️", "🏫", "🚆", "🛒", "☕",
    "📍", "💰", "📐", "✅", "⭐", "❤️", "🔑", "🌿", "🐾", "👨‍👩‍👧‍👦",
  ];

  // Remove Markdown markers so we can measure real text length.
  function stripMarkdown(text) {
    return String(text || "")
      .replace(/[*_#>`~-]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  // Minimal, XSS-safe Markdown → HTML (escape first, then add a small subset).
  function renderMarkdownPreview(text) {
    const lines = String(text || "").split(/\r?\n/);
    const html = [];
    let inList = false;
    for (const raw of lines) {
      let line = escapeHtml(raw);
      // inline: bold, italic
      line = line
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, "$1<em>$2</em>")
        .replace(/_([^_]+)_/g, "<em>$1</em>");
      const bulletMatch = raw.match(/^\s*[-*•]\s+(.*)$/);
      const headingMatch = raw.match(/^\s*(#{1,3})\s+(.*)$/);
      if (bulletMatch) {
        if (!inList) {
          html.push("<ul>");
          inList = true;
        }
        const item = escapeHtml(bulletMatch[1]).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/_([^_]+)_/g, "<em>$1</em>");
        html.push(`<li>${item}</li>`);
        continue;
      }
      if (inList) {
        html.push("</ul>");
        inList = false;
      }
      if (headingMatch) {
        const level = Math.min(3, headingMatch[1].length) + 2; // h3..h5
        const inner = escapeHtml(headingMatch[2]).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
        html.push(`<h${level}>${inner}</h${level}>`);
        continue;
      }
      if (raw.trim() === "") {
        html.push("<br/>");
        continue;
      }
      html.push(`<p>${line}</p>`);
    }
    if (inList) html.push("</ul>");
    return html.join("");
  }

  // Apply a Markdown action to a text field around its current selection.
  function applyMarkdownAction(field, action, payload) {
    const value = field.value || "";
    const start = field.selectionStart ?? value.length;
    const end = field.selectionEnd ?? value.length;
    const selected = value.slice(start, end);
    let before = value.slice(0, start);
    let after = value.slice(end);
    let inner = selected;
    let wrapBefore = "";
    let wrapAfter = "";
    let caretOffset = 0;

    if (action === "bold") {
      wrapBefore = "**";
      wrapAfter = "**";
      if (!inner) inner = "bold text";
    } else if (action === "italic") {
      wrapBefore = "_";
      wrapAfter = "_";
      if (!inner) inner = "italic text";
    } else if (action === "heading") {
      const needsNl = before && !before.endsWith("\n");
      wrapBefore = (needsNl ? "\n" : "") + "## ";
      if (!inner) inner = "Heading";
    } else if (action === "bullet") {
      const needsNl = before && !before.endsWith("\n");
      const block = (inner || "List item").split(/\r?\n/).map((l) => `- ${l}`).join("\n");
      const next = `${before}${needsNl ? "\n" : ""}${block}${after}`;
      field.value = next;
      const pos = (before + (needsNl ? "\n" : "") + block).length;
      field.focus();
      field.setSelectionRange(pos, pos);
      field.dispatchEvent(new Event("input", { bubbles: true }));
      return;
    } else if (action === "emoji") {
      inner = payload || "";
      wrapBefore = "";
      wrapAfter = "";
      caretOffset = inner.length;
    }

    const next = `${before}${wrapBefore}${inner}${wrapAfter}${after}`;
    field.value = next;
    field.focus();
    const selStart = before.length + wrapBefore.length;
    const selEnd = selStart + inner.length;
    if (action === "emoji") {
      const pos = before.length + inner.length;
      field.setSelectionRange(pos, pos);
    } else {
      field.setSelectionRange(selStart, selEnd);
    }
    field.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function buildEmojiPopover(field) {
    const pop = document.createElement("div");
    pop.className = "md-emoji-pop";
    pop.innerHTML = MD_EMOJIS.map(
      (e) => `<button type="button" class="md-emoji" data-emoji="${e}">${e}</button>`,
    ).join("");
    pop.addEventListener("click", (event) => {
      const btn = event.target.closest("[data-emoji]");
      if (!btn) return;
      applyMarkdownAction(field, "emoji", btn.dataset.emoji);
      pop.remove();
    });
    document.addEventListener(
      "click",
      function onAway(e) {
        if (!pop.contains(e.target)) {
          pop.remove();
          document.removeEventListener("click", onAway);
        }
      },
      { capture: true },
    );
    return pop;
  }

  function setupMarkdownToolbars(form) {
    form.querySelectorAll(".md-toolbar").forEach((toolbar) => {
      const targetName = toolbar.dataset.mdTarget;
      const field = form.elements[targetName];
      if (!field) return;
      const previewEl = form.querySelector(`[data-md-preview='${targetName}']`);

      toolbar.addEventListener("click", (event) => {
        const btn = event.target.closest(".md-btn");
        if (!btn) return;
        event.preventDefault();
        const action = btn.dataset.md;
        if (action === "preview") {
          if (!previewEl) return;
          const show = previewEl.hidden;
          previewEl.hidden = !show;
          field.hidden = show;
          btn.classList.toggle("is-active", show);
          if (show) previewEl.innerHTML = renderMarkdownPreview(field.value);
          return;
        }
        if (action === "emoji") {
          const existing = toolbar.querySelector(".md-emoji-pop");
          if (existing) {
            existing.remove();
            return;
          }
          const pop = buildEmojiPopover(field);
          btn.parentElement.style.position = "relative";
          btn.insertAdjacentElement("afterend", pop);
          return;
        }
        applyMarkdownAction(field, action);
      });

      // Keep an open preview in sync while typing.
      if (previewEl) {
        field.addEventListener("input", () => {
          if (!previewEl.hidden) previewEl.innerHTML = renderMarkdownPreview(field.value);
        });
      }
    });
  }

  // ── WYSIWYG rich-text editor (no dependency) ───────────────────────────────
  // Edits formatting live in a contenteditable surface, then serialises back to
  // the same Markdown subset the rest of the app already renders (`**bold**`,
  // `_italic_`, `## heading`, `- bullet`) into a hidden <textarea>, so form
  // submission and validation are unchanged.
  function htmlToMarkdown(root) {
    const out = [];
    function inlineMd(node) {
      let s = "";
      node.childNodes.forEach((child) => {
        if (child.nodeType === Node.TEXT_NODE) {
          s += child.nodeValue.replace(/ /g, " ");
          return;
        }
        if (child.nodeType !== Node.ELEMENT_NODE) return;
        const tag = child.tagName.toLowerCase();
        if (tag === "br") {
          s += "\n";
          return;
        }
        const inner = inlineMd(child);
        if (!inner.trim()) {
          s += inner;
          return;
        }
        if (tag === "strong" || tag === "b") s += `**${inner}**`;
        else if (tag === "em" || tag === "i") s += `_${inner}_`;
        else s += inner;
      });
      return s;
    }
    Array.from(root.childNodes).forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        if (node.nodeValue.trim()) out.push(node.nodeValue.replace(/ /g, " "));
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const tag = node.tagName.toLowerCase();
      if (tag === "ul" || tag === "ol") {
        node.querySelectorAll("li").forEach((li) => out.push(`- ${inlineMd(li).trim()}`));
        return;
      }
      if (/^h[1-6]$/.test(tag)) {
        out.push(`## ${inlineMd(node).trim()}`);
        return;
      }
      if (tag === "br") {
        out.push("");
        return;
      }
      // p / div / other block → one or more lines (honour inner <br>).
      inlineMd(node).split("\n").forEach((line) => out.push(line));
    });
    return out.join("\n").replace(/\n{3,}/g, "\n\n").replace(/[ \t]+$/gm, "").trim();
  }

  function insertEmojiAtCaret(surface, emoji) {
    surface.focus();
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !surface.contains(sel.anchorNode)) {
      const range = document.createRange();
      range.selectNodeContents(surface);
      range.collapse(false); // caret to end
      if (sel) {
        sel.removeAllRanges();
        sel.addRange(range);
      }
    }
    // execCommand keeps the native undo stack and fires `input` for us.
    document.execCommand("insertText", false, emoji);
  }

  function buildRteEmojiPopover(surface) {
    const pop = document.createElement("div");
    pop.className = "md-emoji-pop";
    pop.innerHTML = MD_EMOJIS.map(
      (e) => `<button type="button" class="md-emoji" data-emoji="${e}">${e}</button>`,
    ).join("");
    // Don't let pressing a swatch blur the surface / drop the caret.
    pop.addEventListener("mousedown", (event) => event.preventDefault());
    pop.addEventListener("click", (event) => {
      const btn = event.target.closest("[data-emoji]");
      if (!btn) return;
      insertEmojiAtCaret(surface, btn.dataset.emoji);
      pop.remove();
    });
    document.addEventListener(
      "click",
      function onAway(e) {
        if (!pop.contains(e.target)) {
          pop.remove();
          document.removeEventListener("click", onAway, true);
        }
      },
      { capture: true },
    );
    return pop;
  }

  function setupRichTextEditors(form) {
    form.querySelectorAll(".rte").forEach((rte) => {
      const field = form.elements[rte.dataset.rte];
      const surface = rte.querySelector(".rte-surface");
      const toolbar = rte.querySelector(".rte-toolbar");
      if (!field || !surface || !toolbar) return;

      function syncEmptyState() {
        const empty = surface.textContent.trim() === "" && !surface.querySelector("li, img");
        surface.classList.toggle("is-empty", empty);
      }

      function serialise() {
        field.value = htmlToMarkdown(surface);
        // Mirror the textarea's own input event so existing validators run.
        field.dispatchEvent(new Event("input", { bubbles: true }));
        syncEmptyState();
      }

      function updateToolbarState() {
        const within = surface.contains(window.getSelection()?.anchorNode || null);
        const block = (document.queryCommandValue("formatBlock") || "").toLowerCase();
        const state = {
          bold: within && document.queryCommandState("bold"),
          italic: within && document.queryCommandState("italic"),
          bullet: within && document.queryCommandState("insertUnorderedList"),
          heading: within && /h[1-6]/.test(block),
        };
        toolbar.querySelectorAll(".rte-btn").forEach((btn) => {
          const cmd = btn.dataset.cmd;
          if (cmd in state) btn.classList.toggle("is-active", !!state[cmd]);
        });
      }

      // Hydrate any pre-existing Markdown (edit/autofill); empty for new listings.
      const initial = String(field.value || "").trim();
      surface.innerHTML = initial ? renderMarkdownPreview(initial) : "";
      syncEmptyState();

      // Toolbar buttons must not steal the selection from the surface.
      toolbar.addEventListener("mousedown", (event) => {
        if (event.target.closest(".rte-btn")) event.preventDefault();
      });

      toolbar.addEventListener("click", (event) => {
        const btn = event.target.closest(".rte-btn");
        if (!btn) return;
        event.preventDefault();
        const cmd = btn.dataset.cmd;
        if (cmd === "emoji") {
          const open = toolbar.querySelector(".md-emoji-pop");
          if (open) {
            open.remove();
            return;
          }
          const pop = buildRteEmojiPopover(surface);
          btn.parentElement.style.position = "relative";
          btn.insertAdjacentElement("afterend", pop);
          return;
        }
        surface.focus();
        if (cmd === "bold") document.execCommand("bold");
        else if (cmd === "italic") document.execCommand("italic");
        else if (cmd === "bullet") document.execCommand("insertUnorderedList");
        else if (cmd === "heading") {
          const block = (document.queryCommandValue("formatBlock") || "").toLowerCase();
          document.execCommand("formatBlock", false, /h[1-6]/.test(block) ? "p" : "h3");
        }
        updateToolbarState();
        serialise();
      });

      surface.addEventListener("input", serialise);
      surface.addEventListener("keyup", updateToolbarState);
      surface.addEventListener("mouseup", updateToolbarState);
      surface.addEventListener("focus", updateToolbarState);
      document.addEventListener("selectionchange", () => {
        if (surface.contains(document.getSelection()?.anchorNode || null)) updateToolbarState();
      });

      // Paste as plain text so the surface (and serialised Markdown) stay clean.
      surface.addEventListener("paste", (event) => {
        event.preventDefault();
        const text = (event.clipboardData || window.clipboardData).getData("text/plain");
        document.execCommand("insertText", false, text);
      });

      // Reset hook used by resetListingWizard() (form.reset() won't clear a
      // contenteditable surface on its own).
      rte._resetEditor = () => {
        field.value = "";
        surface.innerHTML = "";
        syncEmptyState();
      };
    });
  }

  function setFieldError(key, message) {
    const element = $(`[data-error-for='${key}']`);
    if (element) element.textContent = message || "";
  }

  function clearListingErrors() {
    $$("[data-error-for]").forEach((element) => {
      element.textContent = "";
    });
  }

  function switchListingStep(step) {
    state.listingStep = Math.max(0, Math.min(LISTING_STEPS.length - 1, step));
    $$(".portal-listing-step").forEach((panel) => {
      const active = Number(panel.dataset.listingStep) === state.listingStep;
      panel.classList.toggle("is-active", active);
      panel.hidden = !active;
    });
    $$(".portal-step-dot").forEach((dot) => {
      const dotStep = Number(dot.dataset.stepJump);
      dot.classList.toggle("is-active", dotStep === state.listingStep);
      dot.classList.toggle("is-complete", dotStep < state.listingStep);
    });
    const title = $("#listing-step-title");
    const count = $("#listing-step-count");
    if (title) title.textContent = LISTING_STEPS[state.listingStep];
    if (count) count.textContent = `Step ${state.listingStep + 1} of ${LISTING_STEPS.length}`;
    const isLastStep = state.listingStep === LISTING_STEPS.length - 1;
    $("#listing-prev-button").hidden = state.listingStep === 0;
    $("#listing-next-button").hidden = isLastStep;
    $("#listing-create-button").hidden = !isLastStep;
  }

  function resetListingWizard() {
    const form = $("#new-listing-form");
    if (form) {
      form.reset();
      // form.reset() doesn't touch contenteditable surfaces — clear them too.
      form.querySelectorAll(".rte").forEach((rte) => rte._resetEditor && rte._resetEditor());
    }
    state.listingPhotos.forEach((item) => URL.revokeObjectURL(item.previewUrl));
    state.listingPhotos = [];
    state.listingDocuments = [];
    state.lastAddressQuery = "";
    $("#listing-address-results").hidden = true;
    $("#listing-address-results").innerHTML = "";
    renderAddressConfirmation();
    renderPhotoPreview();
    renderDocumentList();
    clearListingErrors();
    switchListingStep(0);
  }

  function addListingPhotos(files) {
    const status = $("#dashboard-status");
    const accepted = Array.from(files || []).filter((file) => file.type.startsWith("image/"));
    if (!accepted.length) {
      setStatus(status, "Please choose image files for your photos.", "error");
      return;
    }
    const room = MAX_LISTING_PHOTOS - state.listingPhotos.length;
    if (room <= 0) {
      setFieldError("imageUrls", "You can add up to 20 photos.");
      return;
    }
    accepted.slice(0, room).forEach((file) => {
      state.listingPhotos.push({
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        file,
        previewUrl: URL.createObjectURL(file),
      });
    });
    if (accepted.length > room) setFieldError("imageUrls", "Only the first 20 photos were added.");
    else setFieldError("imageUrls", "");
    renderPhotoPreview();
  }

  function renderPhotoPreview() {
    const root = $("#listing-photo-preview");
    if (!root) return;
    if (!state.listingPhotos.length) {
      root.innerHTML = "";
      return;
    }
    root.innerHTML = state.listingPhotos
      .map(
        (item, index) => `
          <figure class="portal-photo-tile">
            <img src="${item.previewUrl}" alt="Property photo ${index + 1}" />
            <button type="button" aria-label="Remove photo ${index + 1}" data-remove-photo="${item.id}">x</button>
          </figure>
        `,
      )
      .join("");
  }

  function renderDocumentList() {
    const root = $("#listing-document-list");
    if (!root) return;
    const fileInputs = $$("[data-document-category]");
    const entries = fileInputs.flatMap((input) =>
      Array.from(input.files || []).map((file) => ({
        category: input.dataset.documentCategory,
        name: file.name,
      })),
    );
    if (!entries.length) {
      root.innerHTML = "<p>No files selected yet.</p>";
      return;
    }
    root.innerHTML = entries
      .map((entry) => `<span>${escapeHtml(documentCategoryLabel(entry.category))}: ${escapeHtml(entry.name)}</span>`)
      .join("");
  }

  function documentCategoryLabel(category) {
    if (category === "title") return "Record of title";
    if (category === "lim") return "LIM report";
    return "Other";
  }

  function selectedPropertyTag(form) {
    const selected = form.querySelector("input[name='propertyTag']:checked");
    if (!selected) return null;
    const [propertyType, propertySubtype] = selected.value.split("|");
    return { propertyType, propertySubtype };
  }

  function numberValue(form, name) {
    const value = Number(form.elements[name].value);
    return Number.isFinite(value) ? value : NaN;
  }

  function validateListingStep(step, showErrors) {
    const form = $("#new-listing-form");
    if (!form) return false;
    if (showErrors) (STEP_ERROR_KEYS[step] || []).forEach((key) => setFieldError(key, ""));

    if (step === 0) {
      const ok = state.listingPhotos.length >= 1 && state.listingPhotos.length <= MAX_LISTING_PHOTOS;
      if (!ok && showErrors) setFieldError("imageUrls", "Add at least 1 photo (up to 20).");
      return ok;
    }
    if (step === 1) {
      const ok = String(form.elements.address.value || "").trim().length >= 3;
      const selected = Boolean(String(form.elements.addressSelectedPlaceId.value || "").trim());
      const hasStructuredAddress = Boolean(String(form.elements.addressSuburb.value || "").trim() || String(form.elements.lat.value || "").trim());
      if ((!ok || !selected || !hasStructuredAddress) && showErrors) {
        setFieldError("address", "Start typing, then choose the formatted address from the dropdown.");
      }
      return ok && selected && hasStructuredAddress;
    }
    if (step === 2) {
      const tag = selectedPropertyTag(form);
      const metrics = ["garages", "bedrooms", "bathrooms", "toilets"].every((name) => {
        const value = numberValue(form, name);
        return Number.isInteger(value) && value >= 0;
      });
      const areas = ["floorAreaSqm", "landAreaSqm"].every((name) => {
        const value = numberValue(form, name);
        return Number.isInteger(value) && value > 0;
      });
      const title = Boolean(form.elements.titleStatus.value);
      if (!tag && showErrors) setFieldError("propertyTag", "Choose a property type.");
      if ((!metrics || !areas || !title) && showErrors) setFieldError("details", "Fill in the room counts, floor and land area, and title type.");
      return Boolean(tag && metrics && areas && title);
    }
    if (step === 3) {
      const method = Boolean(form.elements.methodOfSale.value);
      const min = numberValue(form, "backendSearchPriceMin");
      const max = numberValue(form, "backendSearchPriceMax");
      const backendOk = Number.isInteger(min) && Number.isInteger(max) && min > 0 && max >= min;
      const buyerMinRaw = String(form.elements.buyerPriceRangeMin.value || "").trim();
      const buyerMaxRaw = String(form.elements.buyerPriceRangeMax.value || "").trim();
      const buyerBlank = !buyerMinRaw && !buyerMaxRaw;
      let buyerOk = buyerBlank;
      if (!buyerBlank) {
        const buyerMin = Number(buyerMinRaw);
        const buyerMax = Number(buyerMaxRaw);
        buyerOk =
          Number.isInteger(buyerMin) &&
          Number.isInteger(buyerMax) &&
          buyerMin > 0 &&
          buyerMax >= buyerMin &&
          form.elements.buyerPriceRangeConfirmed.checked;
      }
      if ((!method || !backendOk || !buyerOk) && showErrors) {
        setFieldError(
          "pricing",
          "Choose a method of sale, enter a valid private search price, and tick the box to confirm any buyer price guide you add.",
        );
      }
      return method && backendOk && buyerOk;
    }
    if (step === 4) {
      const titleInput = form.elements.titleDocument;
      const limInput = form.elements.limDocument;
      const titleOk = !titleInput.files.length || titleInput.files[0].type === "application/pdf";
      const limOk = !limInput.files.length || limInput.files[0].type === "application/pdf";
      if ((!titleOk || !limOk) && showErrors) setFieldError("documents", "The record of title and LIM report must be PDF files.");
      return titleOk && limOk;
    }
    if (step === 5) {
      const title = String(form.elements.listingTitle.value || "").trim();
      const description = String(form.elements.description.value || "").trim();
      // Count real text length, ignoring Markdown markers so formatting doesn't
      // game the minimum-length rule.
      const plainLen = stripMarkdown(description).length;
      const ok = title.length >= 3 && plainLen >= 20;
      if (!ok && showErrors) setFieldError("copy", "Add a headline and a description of at least 20 characters.");
      return ok;
    }
    return true;
  }

  function clearSelectedAddress(form) {
    if (!form) return;
    form.elements.googlePlaceId.value = "";
    form.elements.addressSelectedPlaceId.value = "";
    form.elements.addressStreet.value = "";
    form.elements.addressSuburb.value = "";
    form.elements.addressCity.value = "";
    form.elements.addressPostcode.value = "";
    form.elements.lat.value = "";
    form.elements.lng.value = "";
    renderAddressConfirmation();
  }

  function renderAddressConfirmation() {
    const form = $("#new-listing-form");
    const box = $("#listing-address-confirmation");
    if (!form || !box) return;
    const selectedPlaceId = String(form.elements.addressSelectedPlaceId.value || "").trim();
    if (!selectedPlaceId) {
      box.hidden = true;
      box.innerHTML = "";
      return;
    }
    const suburb = String(form.elements.addressSuburb.value || "").trim();
    const city = String(form.elements.addressCity.value || "").trim();
    const postcode = String(form.elements.addressPostcode.value || "").trim();
    const meta = [suburb, city, postcode].filter(Boolean).join(" · ");
    box.innerHTML = `
      <span class="portal-address-confirmation-icon">✓</span>
      <span>
        <strong>Selected formatted address</strong>
        ${meta ? `<small>${escapeHtml(meta)}</small>` : ""}
      </span>
    `;
    box.hidden = false;
  }

  function validateEntireListing(showErrors) {
    if (showErrors) clearListingErrors();
    let allOk = true;
    LISTING_STEPS.forEach((_, index) => {
      if (!validateListingStep(index, showErrors)) allOk = false;
    });
    return allOk;
  }

  function firstInvalidStep() {
    return LISTING_STEPS.findIndex((_, index) => !validateListingStep(index, false));
  }

  function normalisedPredictionAddress(item) {
    const address = item && typeof item.address === "object" ? item.address : null;
    if (address) {
      return {
        street: address.street || "",
        suburb: address.suburb || "",
        city: address.city || "",
        postcode: address.postcode || "",
        label: address.label || item.description || "",
      };
    }
    const legacy = item?._address || {};
    return {
      street: [legacy.house_number, legacy.road || legacy.pedestrian || legacy.footway || ""].filter(Boolean).join(" "),
      suburb: legacy.suburb || legacy.neighbourhood || legacy.city_district || "",
      city: legacy.city || legacy.town || legacy.village || legacy.county || "",
      postcode: legacy.postcode || "",
      label: item?.description || "",
    };
  }

  async function searchAddress(query) {
    const session = getSession();
    const results = $("#listing-address-results");
    if (!session || !results) return;
    const trimmed = query.trim();
    if (trimmed.length < 3) {
      results.hidden = true;
      results.innerHTML = "";
      return;
    }
    state.lastAddressQuery = trimmed;
    // Show a "Searching…" hint so the agent knows it's working
    results.innerHTML = `<span class="portal-address-hint">Searching addresses…</span>`;
    results.hidden = false;
    try {
      const data = await api(`/listings/address-autocomplete?q=${encodeURIComponent(trimmed)}`, {
        method: "GET",
        token: session.token,
      });
      if (state.lastAddressQuery !== trimmed) return;
      const predictions = Array.isArray(data.predictions) ? data.predictions : [];
      if (!predictions.length) {
        results.innerHTML = `<span class="portal-address-hint">No addresses found. Try a more specific street address.</span>`;
        return;
      }
      results.innerHTML = predictions
        .slice(0, 7)
        .map((item) => {
          const predictionAddress = normalisedPredictionAddress(item);
          const description = predictionAddress.label || item.description || item.structured_formatting?.main_text || "";
          const mainText = item.structured_formatting?.main_text || description.split(",")[0] || description;
          const secondaryText = item.structured_formatting?.secondary_text || description.replace(mainText, "").replace(/^,\s*/, "");
          const placeId = item.place_id || "";
          const isOsm = item.source === "osm" || placeId.startsWith("osm:");
          const lat = item.lat || item._lat || "";
          const lon = item.lng || item._lon || "";
          const extraAttrs = isOsm
            ? ` data-osm="1"
                data-lat="${escapeHtml(String(lat))}"
                data-lon="${escapeHtml(String(lon))}"
                data-street="${escapeHtml(predictionAddress.street)}"
                data-suburb="${escapeHtml(predictionAddress.suburb)}"
                data-city="${escapeHtml(predictionAddress.city)}"
                data-postcode="${escapeHtml(predictionAddress.postcode)}"
              `
            : "";
          return `
            <button type="button" data-place-id="${escapeHtml(placeId)}" data-place-description="${escapeHtml(description)}" ${extraAttrs}>
              <span class="portal-address-main">${escapeHtml(mainText)}</span>
              ${secondaryText ? `<span class="portal-address-secondary">${escapeHtml(secondaryText)}</span>` : ""}
            </button>
          `;
        })
        .join("");
    } catch {
      results.innerHTML = `<span class="portal-address-hint">Address search is unavailable. Please try again before publishing.</span>`;
    }
  }

  function addressComponent(result, types) {
    const components = Array.isArray(result?.address_components) ? result.address_components : [];
    const found = components.find((component) => types.some((type) => component.types?.includes(type)));
    return found?.long_name || "";
  }

  async function chooseAddress(placeId, description, osmData) {
    const session = getSession();
    const form = $("#new-listing-form");
    const results = $("#listing-address-results");
    if (!session || !form) return;
    form.elements.address.value = description;
    form.elements.addressSelectedPlaceId.value = placeId;
    form.elements.googlePlaceId.value = placeId.startsWith("osm:") ? "" : placeId;
    if (results) results.hidden = true;

    // OSM results: all data was embedded in the button, no second request needed
    if (osmData) {
      form.elements.addressStreet.value = osmData.street || "";
      form.elements.addressSuburb.value = osmData.suburb || "";
      form.elements.addressCity.value = osmData.city || "";
      form.elements.addressPostcode.value = osmData.postcode || "";
      form.elements.lat.value = osmData.lat || "";
      form.elements.lng.value = osmData.lon || "";
      renderAddressConfirmation();
      return;
    }

    // Google Places: fetch full details for structured address components
    try {
      const data = await api(`/listings/place-details/${encodeURIComponent(placeId)}`, { method: "GET", token: session.token });
      const result = data.result || {};
      if (result.formatted_address) form.elements.address.value = result.formatted_address;
      form.elements.addressStreet.value = [addressComponent(result, ["street_number"]), addressComponent(result, ["route"])]
        .filter(Boolean)
        .join(" ");
      form.elements.addressSuburb.value = addressComponent(result, ["sublocality", "neighborhood"]);
      form.elements.addressCity.value = addressComponent(result, ["locality", "administrative_area_level_2"]);
      form.elements.addressPostcode.value = addressComponent(result, ["postal_code"]);
      form.elements.lat.value = result.geometry?.location?.lat ? String(result.geometry.location.lat) : "";
      form.elements.lng.value = result.geometry?.location?.lng ? String(result.geometry.location.lng) : "";
      renderAddressConfirmation();
    } catch {
      /* keep the typed address even if place details fail */
      renderAddressConfirmation();
    }
  }

  // Standardize a chosen photo to a uniform 4:3 landscape frame in the browser
  // before upload: honour EXIF orientation, center-crop ("cover") and re-encode
  // as JPEG. Runs client-side so it works regardless of the server runtime (the
  // serverless API can't run the native image pipeline). Falls back to the
  // original file on any failure so a photo always uploads.
  async function standardizeListingPhoto(file) {
    try {
      if (!file || !file.type || !file.type.startsWith("image/")) return file;
      if (typeof createImageBitmap !== "function" || typeof document === "undefined") return file;
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(() => createImageBitmap(file));
      const targetW = LISTING_IMAGE_TARGET_WIDTH;
      const targetH = LISTING_IMAGE_TARGET_HEIGHT;
      const canvas = document.createElement("canvas");
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext("2d");
      if (!ctx) { if (bitmap.close) bitmap.close(); return file; }
      const scale = Math.max(targetW / bitmap.width, targetH / bitmap.height);
      const drawW = bitmap.width * scale;
      const drawH = bitmap.height * scale;
      ctx.drawImage(bitmap, (targetW - drawW) / 2, (targetH - drawH) / 2, drawW, drawH);
      if (bitmap.close) bitmap.close();
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
      if (!blob) return file;
      const baseName = (file.name || "photo").replace(/\.[^.]+$/, "");
      return new File([blob], `${baseName}.jpg`, { type: "image/jpeg" });
    } catch {
      return file;
    }
  }

  async function uploadListingPhotos(token, statusElement) {
    const urls = [];
    const total = state.listingPhotos.length;
    for (let index = 0; index < total; index += 1) {
      const item = state.listingPhotos[index];
      if (statusElement) setStatus(statusElement, `Uploading photo ${index + 1} of ${total}...`, null);
      try {
        const standardized = await standardizeListingPhoto(item.file);
        const uploaded = await uploadWithFallback("/upload/listing-image", token, standardized);
        urls.push(uploaded.fileUrl);
      } catch (error) {
        const fileName = item.file?.name || `photo ${index + 1}`;
        const reason = getErrorMessage(error, "the file may be too large");
        throw new Error(`Couldn't upload "${fileName}" — ${reason}`);
      }
    }
    return urls;
  }

  async function uploadListingDocuments(token, statusElement) {
    const form = $("#new-listing-form");
    const documents = [];
    const inputs = Array.from(form.querySelectorAll("[data-document-category]"));
    // Flatten so we can show "1 of N" progress across all categories
    const queue = [];
    for (const input of inputs) {
      const category = input.dataset.documentCategory;
      for (const file of Array.from(input.files || [])) {
        queue.push({ category, file });
      }
    }
    const total = queue.length;
    for (let index = 0; index < total; index += 1) {
      const { category, file } = queue[index];
      if (statusElement) setStatus(statusElement, `Uploading document ${index + 1} of ${total}...`, null);
      try {
        const uploaded = await uploadWithFallback("/upload/listing-document", token, file, { category });
        documents.push(uploaded.document);
      } catch (error) {
        const fileName = file?.name || `document ${index + 1}`;
        const reason = getErrorMessage(error, "the file may be too large");
        throw new Error(`Couldn't upload "${fileName}" — ${reason}`);
      }
    }
    return documents;
  }

  function buildListingPayload(form, imageUrls, documentUrls) {
    const tag = selectedPropertyTag(form);
    const values = formValues(form);
    const buyerMin = String(values.buyerPriceRangeMin || "").trim();
    const buyerMax = String(values.buyerPriceRangeMax || "").trim();
    const payload = {
      listingTitle: String(values.listingTitle || "").trim(),
      address: String(values.address || "").trim(),
      addressStreet: String(values.addressStreet || "").trim() || undefined,
      addressSuburb: String(values.addressSuburb || "").trim() || undefined,
      addressCity: String(values.addressCity || "").trim() || undefined,
      addressPostcode: String(values.addressPostcode || "").trim() || undefined,
      lat: String(values.lat || "").trim() || undefined,
      lng: String(values.lng || "").trim() || undefined,
      googlePlaceId: String(values.googlePlaceId || "").trim() || undefined,
      status: "active",
      propertyType: tag.propertyType,
      propertySubtype: tag.propertySubtype,
      garages: numberValue(form, "garages"),
      bedrooms: numberValue(form, "bedrooms"),
      bathrooms: numberValue(form, "bathrooms"),
      toilets: numberValue(form, "toilets"),
      floorAreaSqm: numberValue(form, "floorAreaSqm"),
      landAreaSqm: numberValue(form, "landAreaSqm"),
      titleStatus: String(values.titleStatus || ""),
      methodOfSale: String(values.methodOfSale || ""),
      backendSearchPriceMin: numberValue(form, "backendSearchPriceMin"),
      backendSearchPriceMax: numberValue(form, "backendSearchPriceMax"),
      buyerPriceRangeConfirmed: Boolean(values.buyerPriceRangeConfirmed),
      description: String(values.description || "").trim(),
      imageUrls,
      documentUrls,
      features: [],
    };
    if (buyerMin && buyerMax) {
      payload.buyerPriceRangeMin = Number(buyerMin);
      payload.buyerPriceRangeMax = Number(buyerMax);
    }
    return payload;
  }

  function saveListingDraft() {
    const form = $("#new-listing-form");
    if (!form) return;
    const fields = [];
    Array.from(form.elements).forEach((field) => {
      if (!field.name || field.type === "file" || field.type === "button" || field.type === "submit") return;
      fields.push({
        name: field.name,
        value: field.value,
        checked: field.type === "checkbox" || field.type === "radio" ? field.checked : undefined,
      });
    });
    sessionStorage.setItem(LISTING_DRAFT_KEY, JSON.stringify({ fields, step: state.listingStep }));
  }

  function restoreListingDraft() {
    const raw = sessionStorage.getItem(LISTING_DRAFT_KEY);
    const form = $("#new-listing-form");
    if (!raw || !form) return false;
    try {
      const draft = JSON.parse(raw);
      for (const saved of Array.isArray(draft.fields) ? draft.fields : []) {
        const candidates = Array.from(form.elements).filter((field) => field.name === saved.name);
        for (const field of candidates) {
          if (field.type === "checkbox" || field.type === "radio") field.checked = !!saved.checked;
          else field.value = saved.value ?? "";
        }
      }
      const description = form.elements.description?.value || "";
      const surface = form.querySelector('[data-rte="description"] .rte-surface');
      if (surface) {
        surface.textContent = description;
        surface.classList.toggle("is-empty", !description.trim());
      }
      $("#new-listing-panel").hidden = false;
      renderAddressConfirmation();
      renderDocumentList();
      switchListingStep(Number.isFinite(Number(draft.step)) ? Number(draft.step) : LISTING_STEPS.length - 1);
      return true;
    } catch {
      sessionStorage.removeItem(LISTING_DRAFT_KEY);
      return false;
    }
  }

  async function handleNewListing(event) {
    event.preventDefault();
    const session = getSession();
    const status = $("#dashboard-status");
    if (!session) {
      showAuth();
      return;
    }
    const form = event.currentTarget;
    if (!validateEntireListing(true)) {
      const badStep = firstInvalidStep();
      if (badStep >= 0) switchListingStep(badStep);
      setStatus(status, "Please finish the highlighted details before publishing.", "error");
      return;
    }
    try {
      const entitlement = await api("/subscription/agent-status", { method: "GET", token: session.token });
      if (!entitlement.canList) {
        state.pendingListingPublish = true;
        openPaywall("listing");
        return;
      }
    } catch (error) {
      setStatus(status, getErrorMessage(error, "We couldn't verify listing access. Please try again."), "error");
      return;
    }
    const publishButton = $("#listing-create-button");
    if (publishButton) publishButton.disabled = true;
    try {
      const imageUrls = await uploadListingPhotos(session.token, status);
      const documentUrls = await uploadListingDocuments(session.token, status);
      setStatus(status, "Publishing your listing...", null);
      await api("/listings", {
        method: "POST",
        token: session.token,
        body: buildListingPayload(form, imageUrls, documentUrls),
      });
      sessionStorage.removeItem(LISTING_DRAFT_KEY);
      resetListingWizard();
      $("#new-listing-panel").hidden = true;
      await refreshListings();
      setStatus(status, "Your listing is now live for buyers.", "success");
    } catch (error) {
      setStatus(status, getErrorMessage(error, "We couldn't publish your listing. Please try again."), "error");
    } finally {
      if (publishButton) publishButton.disabled = false;
    }
  }

  async function handleDeleteListing(listingId) {
    const session = getSession();
    const status = $("#dashboard-status");
    if (!session) {
      showAuth();
      return;
    }
    const listing = state.listings.find((item) => item.id === listingId);
    const label = listing ? listingTitle(listing) : "this listing";
    if (!window.confirm(`Remove ${label}? It will no longer be shown to buyers.`)) return;
    setStatus(status, "Removing listing...", null);
    try {
      await api(`/listings/${encodeURIComponent(listingId)}`, { method: "DELETE", token: session.token });
      await refreshListings();
      setStatus(status, "Listing removed.", "success");
    } catch (error) {
      setStatus(status, getErrorMessage(error, "We couldn't remove this listing. Please try again."), "error");
    }
  }

  async function handleToggleListing(listingId, isActive) {
    const session = getSession();
    const status = $("#dashboard-status");
    if (!session) {
      showAuth();
      return;
    }
    setStatus(status, isActive ? "Making listing live..." : "Pausing listing...", null);
    try {
      await api(`/listings/${encodeURIComponent(listingId)}`, {
        method: "PATCH",
        token: session.token,
        body: { status: isActive ? "active" : "paused" },
      });
      await refreshListings();
      setStatus(status, isActive ? "Your listing is live for buyers." : "Your listing is paused and hidden from buyers.", "success");
    } catch (error) {
      setStatus(status, getErrorMessage(error, "We couldn't update your listing. Please try again."), "error");
      await refreshListings();
    }
  }

  function switchTab(target) {
    $$(".portal-tab").forEach((tab) => {
      const active = tab.dataset.tabTarget === target;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", active ? "true" : "false");
    });
    $$(".portal-panel").forEach((panel) => {
      const active = panel.dataset.tabPanel === target;
      panel.classList.toggle("is-active", active);
      panel.hidden = !active;
    });
  }

  function openReset() {
    const form = $("#password-reset-form");
    const loginEmail = $("#sales-login-form input[name='email']");
    const resetEmail = form ? form.elements.email : null;
    if (loginEmail && resetEmail && loginEmail.value.trim()) resetEmail.value = loginEmail.value.trim();
    const verifyBlock = $("#reset-verify-block");
    if (verifyBlock) verifyBlock.hidden = true;
    state.resetCodeRequested = false;
    setStatus($("#reset-status"), "", null);
    $("#reset-panel").hidden = false;
    if (resetEmail && !resetEmail.value) resetEmail.focus();
  }

  function closeReset() {
    $("#reset-panel").hidden = true;
  }

  function normalizeNzPhone(phone) {
    return String(phone || "").replace(/[\s\-()]/g, "").trim();
  }

  function resetPhoneVerification() {
    state.verificationId = null;
    state.verifiedPhone = null;
    state.phoneVerificationToken = null;
    window.clearInterval(state.otpCooldownTimer);
    state.otpCooldownTimer = null;
    const sendButton = $("#send-otp-button");
    const verifyBlock = $("#otp-verify-block");
    const cooldown = $("#otp-cooldown");
    const otpState = $("#otp-state");
    if (sendButton) {
      sendButton.hidden = false;
      sendButton.disabled = false;
    }
    if (verifyBlock) verifyBlock.hidden = true;
    if (cooldown) cooldown.textContent = "";
    if (otpState) {
      otpState.textContent = "Not verified yet";
      otpState.classList.remove("is-verified");
    }
  }

  function setOtpButtonsDisabled(disabled) {
    const sendButton = $("#send-otp-button");
    const resendButton = $("#resend-otp-button");
    if (sendButton) sendButton.disabled = disabled;
    if (resendButton) resendButton.disabled = disabled || !state.verificationId;
  }

  function startOtpCooldown(seconds) {
    const totalSeconds = Number(seconds || 0);
    const cooldown = $("#otp-cooldown");
    window.clearInterval(state.otpCooldownTimer);
    if (!cooldown || totalSeconds <= 0) {
      if (cooldown) cooldown.textContent = "";
      setOtpButtonsDisabled(false);
      return;
    }

    const endsAt = Date.now() + totalSeconds * 1000;
    setOtpButtonsDisabled(true);
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
      if (remaining <= 0) {
        window.clearInterval(state.otpCooldownTimer);
        state.otpCooldownTimer = null;
        cooldown.textContent = "You can request another code now.";
        setOtpButtonsDisabled(false);
        return;
      }
      cooldown.textContent = `You can request another code in ${remaining} second${remaining === 1 ? "" : "s"}.`;
    };
    tick();
    state.otpCooldownTimer = window.setInterval(tick, 1000);
  }

  function resolveAgencyName(values) {
    const selected = String(values.agencySelect || "").trim();
    if (selected === "Others") return String(values.agencyOther || "").trim();
    return selected;
  }

  const KNOWN_AGENCIES = ["Ray White", "Bayleys", "Barfoot & Thompson", "Harcourts", "LJ Hooker"];

  function setAgencyFields(select, otherField, agencyName) {
    if (!select || !otherField) return;
    const otherInput = otherField.querySelector("input");
    if (KNOWN_AGENCIES.includes(agencyName)) {
      select.value = agencyName;
      otherField.hidden = true;
      if (otherInput) {
        otherInput.required = false;
        otherInput.value = "";
      }
    } else if (agencyName) {
      select.value = "Others";
      otherField.hidden = false;
      if (otherInput) {
        otherInput.required = true;
        otherInput.value = agencyName;
      }
    } else {
      select.value = "";
      otherField.hidden = true;
      if (otherInput) {
        otherInput.required = false;
        otherInput.value = "";
      }
    }
  }

  function fillProfileForm(user) {
    const form = $("#portal-profile-form");
    if (!form) return;
    form.elements.fullName.value = user.fullName || "";
    form.elements.phone.value = user.phoneNumber || "";
    form.elements.primaryLanguage.value = (user.languages && user.languages[0]) || user.primaryLanguage || "";
    setAgencyFields($("#profile-agency-select"), $("#profile-agency-other-field"), user.agencyName || "");
    if (form.elements.reaaLicenceNumber) form.elements.reaaLicenceNumber.value = user.reaaLicenceNumber || "";
  }

  function updateAccountSummary(user) {
    const summary = $("#account-summary");
    if (!summary) return;
    const email = user.email ? `You're signed in as ${user.email}. ` : "";
    summary.textContent = `${email}You can use the same email and password to sign in to the Project Alpha app.`;
  }

  function selectedProfilePicture(form) {
    const input = form.elements.profilePicture;
    if (!input || !input.files || input.files.length === 0) return null;
    return input.files[0];
  }

  async function uploadProfilePicture(token, file) {
    const payload = await uploadWithFallback("/upload/profile-picture", token, file);
    return payload;
  }

  async function sendOtp(signupForm, isResend) {
    const status = $("#signup-status");
    const phoneNumber = normalizeNzPhone(signupForm.elements.phone.value);
    if (!/^\+64\d{7,10}$/.test(phoneNumber)) {
      setStatus(status, "Enter a valid New Zealand mobile number starting with +64.", "error");
      return;
    }

    setStatus(status, isResend ? "Sending a new code..." : "Sending your code...", null);
    try {
      const data = await api("/auth/send-otp", { method: "POST", body: { phone: phoneNumber } });
      state.verificationId = data.verificationId;
      state.verifiedPhone = null;
      state.phoneVerificationToken = null;
      const sendButton = $("#send-otp-button");
      const verifyBlock = $("#otp-verify-block");
      const otpState = $("#otp-state");
      if (sendButton) sendButton.hidden = true;
      if (verifyBlock) verifyBlock.hidden = false;
      if (otpState) {
        otpState.textContent = `Code sent to ${phoneNumber}`;
        otpState.classList.remove("is-verified");
      }
      if (signupForm.elements.otpCode) signupForm.elements.otpCode.focus();
      startOtpCooldown(data.retryAfterSeconds || 60);
      setStatus(status, "Code sent. Check your text messages.", "success");
    } catch (error) {
      if (error && Number(error.retryAfterSeconds) > 0) startOtpCooldown(error.retryAfterSeconds);
      setStatus(status, getErrorMessage(error, "We couldn't send the code. Please try again."), "error");
    }
  }

  async function verifyOtp(signupForm) {
    const status = $("#signup-status");
    const phoneNumber = normalizeNzPhone(signupForm.elements.phone.value);
    const code = String(signupForm.elements.otpCode.value || "").trim();
    if (!state.verificationId || !phoneNumber || !code) {
      setStatus(status, "Enter the code we texted you first.", "error");
      return;
    }

    setStatus(status, "Checking your code...", null);
    try {
      const data = await api("/auth/verify-otp", {
        method: "POST",
        body: { verificationId: state.verificationId, phone: phoneNumber, code },
      });
      state.phoneVerificationToken = data.token;
      state.verifiedPhone = data.phone;
      window.clearInterval(state.otpCooldownTimer);
      state.otpCooldownTimer = null;
      const verifyBlock = $("#otp-verify-block");
      const cooldown = $("#otp-cooldown");
      const otpState = $("#otp-state");
      if (verifyBlock) verifyBlock.hidden = true;
      if (cooldown) cooldown.textContent = "";
      if (otpState) {
        otpState.textContent = `Verified ${data.phone}`;
        otpState.classList.add("is-verified");
      }
      setStatus(status, "Mobile verified. You're ready to create your account.", "success");
    } catch (error) {
      setStatus(status, getErrorMessage(error, "That code didn't match. Please try again."), "error");
    }
  }

  async function handleSignup(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const status = $("#signup-status");
    const values = formValues(form);

    const phoneNumber = normalizeNzPhone(values.phone);
    if (!/^\+64\d{7,10}$/.test(phoneNumber)) {
      setStatus(status, "Enter a valid New Zealand mobile number starting with +64.", "error");
      return;
    }
    if (!state.phoneVerificationToken || state.verifiedPhone !== phoneNumber) {
      setStatus(status, "Please verify your mobile number before creating your account.", "error");
      return;
    }

    const agencyName = resolveAgencyName(values);
    if (!agencyName) {
      setStatus(status, "Choose your agency, or enter its name if you selected Other.", "error");
      return;
    }
    const reaaLicenceNumber = String(values.reaaLicenceNumber || "").trim();
    if (!reaaLicenceNumber) {
      setStatus(status, "Enter your REA licence number.", "error");
      return;
    }

    const payload = {
      fullName: String(values.fullName || "").trim(),
      email: String(values.email || "").trim(),
      password: String(values.password || ""),
      phoneNumber,
      phoneVerificationToken: state.phoneVerificationToken,
      primaryLanguage: String(values.primaryLanguage || "").trim(),
      agencyName,
      reaaLicenceNumber,
    };

    // Details are valid — show T&C consent before the paywall step.
    state.pendingSignupPayload = payload;
    state.pendingSignupForm = form;
    setStatus(status, "", null);
    openConsentModal();
  }

  // ── T&C consent modal ────────────────────────────────────────────────────
  function openConsentModal() {
    const panel = $("#consent-panel");
    if (!panel) { openPaywall(); return; }
    const checkbox = /** @type {HTMLInputElement|null} */ ($("#consent-checkbox"));
    const btn = $("#consent-confirm-button");
    if (checkbox) checkbox.checked = false;
    if (btn) btn.disabled = true;
    setStatus($("#consent-status"), "", null);
    panel.hidden = false;
    // Scroll the card into view and focus it for accessibility
    const card = panel.querySelector(".portal-consent-card");
    if (card) card.scrollTop = 0;
    if (btn) setTimeout(() => btn.focus(), 50);
  }

  function closeConsentModal() {
    const panel = $("#consent-panel");
    if (panel) panel.hidden = true;
    setStatus($("#consent-status"), "", null);
  }

  async function consentAndProceed() {
    const checkbox = /** @type {HTMLInputElement|null} */ ($("#consent-checkbox"));
    if (!checkbox || !checkbox.checked) {
      setStatus($("#consent-status"), "Please tick the checkbox to confirm you have read and agreed.", "error");
      return;
    }
    closeConsentModal();
    const status = $("#signup-status");
    setStatus(status, "Creating your free account...", null);
    try {
      const data = await api("/auth/sales-agent-web-signup", {
        method: "POST",
        body: state.pendingSignupPayload,
      });
      await completeAgentSignupSuccess(data, state.pendingSignupForm);
    } catch (error) {
      if (error && error.code === "INVITATION_OR_SUBSCRIPTION_REQUIRED") {
        openPaywall("signup");
        return;
      }
      setStatus(status, getErrorMessage(error, "We couldn't create your account. Please try again."), "error");
    }
  }

  // Shared success handler for both the invitation-code path and the post-Stripe
  // claim. `form` carries the optional profile photo (invite path only — a File
  // can't survive the redirect to Stripe, so subscribe agents add it later).
  async function completeAgentSignupSuccess(data, form) {
    let user = data.user;
    const picture = form ? selectedProfilePicture(form) : null;
    if (picture) {
      try {
        const uploaded = await uploadProfilePicture(data.token, picture);
        user = { ...user, avatarUrl: uploaded.fileUrl };
      } catch (uploadError) {
        // Non-fatal: the account exists; the photo can be added from Profile.
      }
    }
    saveSession(data.token, user);
    showDashboard(user);
    openAgentWelcome();
  }

  // ── Paywall (final signup step) ──────────────────────────────────────────
  function openPaywall(context) {
    state.paywallContext = context === "listing" ? "listing" : "signup";
    const panel = $("#paywall-panel");
    if (panel) panel.hidden = false;
    const eyebrow = $("#paywall-kicker");
    const heading = $("#paywall-heading");
    const copy = $("#paywall-copy");
    if (eyebrow) eyebrow.textContent = state.paywallContext === "listing" ? "Listing access" : "Final step";
    if (heading) heading.textContent = state.paywallContext === "listing" ? "Unlock property listings" : "Activate your agent account";
    if (copy) copy.textContent = state.paywallContext === "listing"
      ? "Subscribe or use an invitation code to publish this property."
      : "Choose how to complete your registration.";
    const inviteButton = $("#paywall-invite-button");
    if (inviteButton) inviteButton.textContent = state.paywallContext === "listing"
      ? "Activate listing access"
      : "Complete registration";
    switchPaywallMode("subscribe");
    setStatus($("#paywall-status"), "", null);
  }

  function closePaywall() {
    const panel = $("#paywall-panel");
    if (panel) panel.hidden = true;
    setStatus($("#paywall-status"), "", null);
  }

  function openAgentWelcome() {
    const panel = $("#agent-welcome-panel");
    if (panel) panel.hidden = false;
  }

  function closeAgentWelcome() {
    const panel = $("#agent-welcome-panel");
    if (panel) panel.hidden = true;
  }

  function switchPaywallMode(mode) {
    $$(".paywall-toggle-btn").forEach((b) =>
      b.classList.toggle("is-active", b.dataset.paywallMode === mode),
    );
    $$("[data-paywall-pane]").forEach((p) => {
      p.hidden = p.dataset.paywallPane !== mode;
    });
  }

  async function submitPaywallInvite() {
    const status = $("#paywall-status");
    const codeInput = $("#paywall-invite-code");
    const code = String((codeInput && codeInput.value) || "").trim();
    if (!code) {
      setStatus(status, "Enter your invitation code.", "error");
      return;
    }
    if (state.paywallContext === "listing") {
      const session = getSession();
      if (!session) {
        closePaywall();
        showAuth();
        return;
      }
      setStatus(status, "Activating listing access...", null);
      try {
        await api("/subscription/agent-invitation", {
          method: "POST",
          token: session.token,
          body: { invitationCode: code },
        });
        closePaywall();
        setStatus($("#dashboard-status"), "Invitation accepted. Publishing your listing...", "success");
        if (state.pendingListingPublish) {
          state.pendingListingPublish = false;
          $("#new-listing-form")?.requestSubmit();
        }
      } catch (error) {
        setStatus(status, getErrorMessage(error, "That invitation code didn't work. Please check it and try again."), "error");
      }
      return;
    }
    if (!state.pendingSignupPayload) {
      setStatus(status, "Please restart your signup.", "error");
      return;
    }
    const payload = { ...state.pendingSignupPayload, invitationCode: code };
    setStatus(status, "Creating your account…", null);
    try {
      const data = await api("/auth/sales-agent-web-signup", { method: "POST", body: payload });
      closePaywall();
      await completeAgentSignupSuccess(data, state.pendingSignupForm);
    } catch (error) {
      setStatus(
        status,
        getErrorMessage(error, "That invitation code didn't work. Please check it and try again."),
        "error",
      );
    }
  }

  async function submitPaywallSubscribe() {
    const status = $("#paywall-status");
    if (state.paywallContext === "listing") {
      const session = getSession();
      if (!session) {
        closePaywall();
        showAuth();
        return;
      }
      saveListingDraft();
      setStatus(status, "Starting secure checkout...", null);
      try {
        const data = await api("/subscription/agent-checkout", { method: "POST", token: session.token });
        if (data && data.checkoutUrl) window.location.assign(data.checkoutUrl);
        else setStatus(status, "Could not start checkout. Please try again.", "error");
      } catch (error) {
        setStatus(status, getErrorMessage(error, "Could not start checkout. Please try again."), "error");
      }
      return;
    }
    if (!state.pendingSignupPayload) {
      setStatus(status, "Please restart your signup.", "error");
      return;
    }
    setStatus(status, "Starting secure checkout…", null);
    try {
      const data = await api("/auth/sales-agent-web-signup/checkout", {
        method: "POST",
        body: state.pendingSignupPayload,
      });
      if (data && data.checkoutUrl) {
        window.location.assign(data.checkoutUrl);
      } else {
        setStatus(status, "Could not start checkout. Please try again.", "error");
      }
    } catch (error) {
      setStatus(status, getErrorMessage(error, "Could not start checkout. Please try again."), "error");
    }
  }

  // Handle the redirect back from Stripe Checkout. Returns true if it consumed
  // the page load (so the normal session-resume should be skipped).
  async function handleStripeReturn() {
    const params = new URLSearchParams(window.location.search);
    const result = params.get("agentSignup");
    const subscriptionResult = params.get("agentSubscription");
    if (!result && !subscriptionResult) return false;
    const sessionId = params.get("session_id");
    window.history.replaceState({}, document.title, window.location.pathname);

    if (subscriptionResult) {
      const session = getSession();
      if (!session) {
        showAuth();
        setStatus($("#login-status"), "Sign in again to finish activating your subscription.", "error");
        return true;
      }
      showDashboard(session.user);
      if (subscriptionResult === "cancelled") {
        restoreListingDraft();
        setStatus($("#dashboard-status"), "Checkout was cancelled. Your listing details were restored; reselect any photos or PDFs before publishing.", "error");
        return true;
      }
      if (subscriptionResult === "success" && sessionId) {
        try {
          const claimed = await api("/subscription/agent-checkout/claim", {
            method: "POST",
            token: session.token,
            body: { checkoutSessionId: sessionId },
          });
          if (!claimed.canList) throw new Error("Your subscription is still activating. Please refresh in a moment.");
          restoreListingDraft();
          setStatus($("#dashboard-status"), "Subscription active. Your listing details were restored; reselect photos and PDFs, then publish.", "success");
        } catch (error) {
          restoreListingDraft();
          setStatus($("#dashboard-status"), getErrorMessage(error, "We couldn't confirm the subscription yet. Please refresh and try again."), "error");
        }
        return true;
      }
    }

    if (result === "cancelled") {
      showAuth();
      const status = $("#signup-status");
      if (status) {
        setStatus(status, "Checkout was cancelled. You can try again or use an invitation code.", "error");
      }
      return true;
    }

    if (result === "success" && sessionId) {
      const status = $("#signup-status");
      if (status) setStatus(status, "Finishing your registration…", null);
      // The account is created by the Stripe webhook; retry a few times in case
      // it's still processing when we land back here.
      for (let attempt = 0; attempt < 6; attempt += 1) {
        try {
          const data = await api("/auth/sales-agent-web-signup/claim", {
            method: "POST",
            body: { checkoutSessionId: sessionId },
          });
          await completeAgentSignupSuccess(data, null);
          return true;
        } catch (error) {
          if (error && error.code === "PAYMENT_PENDING") {
            await new Promise((resolve) => setTimeout(resolve, 2000));
            continue;
          }
          showAuth();
          if (status) {
            setStatus(status, getErrorMessage(error, "We couldn't finish your registration. Please contact support."), "error");
          }
          return true;
        }
      }
      showAuth();
      if (status) {
        setStatus(status, "Your payment is processing. Please refresh in a moment to finish signing in.", null);
      }
      return true;
    }
    return false;
  }

  // ── Manage subscription tab ──────────────────────────────────────────────
  function subscriptionFeatureList(isInvite) {
    const ul = document.createElement("ul");
    ul.className = "paywall-features";
    const aiText = isInvite
      ? "Unlimited In-app AI Property search & analysis (3 months)"
      : "Unlimited In-app AI Property search & analysis";
    const items = [
      isInvite ? "Lifetime property listing" : "Property listing while your subscription is active",
      aiText,
      "Connect with verified consultants",
      "In-app live translation calls — 80+ languages (coming soon)",
      "Potential leads (coming soon)",
    ];
    for (const t of items) {
      const li = document.createElement("li");
      li.textContent = t;
      ul.appendChild(li);
    }
    return ul;
  }

  function formatDateLong(value) {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  }

  async function loadSubscription() {
    const summary = $("#subscription-summary");
    const body = $("#subscription-body");
    setStatus($("#subscription-status"), "", null);
    if (summary) summary.textContent = "Loading your plan…";
    if (body) body.innerHTML = "";
    const session = getSession();
    if (!session) return;
    try {
      const data = await api("/subscription/agent-status", { method: "GET", token: session.token });
      renderSubscription(data);
    } catch (error) {
      if (summary) summary.textContent = "Could not load your subscription.";
    }
  }

  function renderSubscription(data) {
    const summary = $("#subscription-summary");
    const body = $("#subscription-body");
    if (!body) return;
    body.innerHTML = "";

    if (data.listingPlan === "subscription") {
      const status = data.subscriptionStatus || "inactive";
      const active = status === "active" || status === "trialing";
      const periodLabel = data.subscriptionPeriodEndAt ? formatDateLong(data.subscriptionPeriodEndAt) : null;
      if (summary) {
        if (data.cancelAtPeriodEnd && periodLabel) {
          summary.textContent = `Your subscription is active and will end on ${periodLabel}.`;
        } else if (active && periodLabel) {
          summary.textContent = `Your subscription is active. Renews ${periodLabel}.`;
        } else if (active) {
          summary.textContent = "Your subscription is active.";
        } else {
          summary.textContent = "Your subscription is inactive. Resubscribe to list properties.";
        }
      }
      body.appendChild(subscriptionFeatureList(false));

      const row = document.createElement("div");
      row.className = "portal-form-row";
      if (active && !data.cancelAtPeriodEnd) {
        const btn = document.createElement("button");
        btn.className = "button button-quiet";
        btn.type = "button";
        btn.textContent = "Cancel subscription";
        btn.addEventListener("click", () => changeSubscription("cancel"));
        row.appendChild(btn);
      } else if (data.cancelAtPeriodEnd) {
        const btn = document.createElement("button");
        btn.className = "button button-primary";
        btn.type = "button";
        btn.textContent = "Resume subscription";
        btn.addEventListener("click", () => changeSubscription("resume"));
        row.appendChild(btn);
      }
      if (row.childNodes.length) body.appendChild(row);
    } else {
      if (summary) summary.textContent = "Property listing & promotion — Lifetime unlimited";
      const badge = document.createElement("p");
      badge.className = "subscription-lifetime-badge";
      badge.textContent = "✓ Lifetime unlimited";
      body.appendChild(badge);
      if (data.aiBoostExpiresAt) {
        const label = formatDateLong(data.aiBoostExpiresAt);
        if (label && new Date(data.aiBoostExpiresAt).getTime() > Date.now()) {
          const note = document.createElement("p");
          note.className = "subscription-note";
          note.textContent = `Unlimited AI search & analysis until ${label}.`;
          body.appendChild(note);
        }
      }
      body.appendChild(subscriptionFeatureList(true));
    }
  }

  async function changeSubscription(action) {
    const status = $("#subscription-status");
    const session = getSession();
    if (!session) return;
    setStatus(status, action === "cancel" ? "Cancelling…" : "Resuming…", null);
    try {
      await api(`/subscription/${action}`, { method: "POST", token: session.token });
      setStatus(
        status,
        action === "cancel"
          ? "Your subscription will end at the end of the current period."
          : "Your subscription has been resumed.",
        "success",
      );
      await loadSubscription();
    } catch (error) {
      setStatus(status, getErrorMessage(error, "Could not update your subscription. Please try again."), "error");
    }
  }

  async function handleLogin(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const status = $("#login-status");
    const values = formValues(form);
    setStatus(status, "Signing you in...", null);
    try {
      const data = await api("/auth/sales-agent-login", {
        method: "POST",
        body: {
          email: String(values.email || "").trim(),
          password: String(values.password || ""),
        },
      });
      saveSession(data.token, data.user);
      setStatus(status, "Welcome back!", "success");
      showDashboard(data.user);
    } catch (error) {
      setStatus(status, getErrorMessage(error, "We couldn't sign you in. Check your email and password."), "error");
    }
  }

  async function handleProfileSave(event) {
    event.preventDefault();
    const session = getSession();
    const status = $("#profile-status");
    if (!session) {
      showAuth();
      return;
    }
    const form = event.currentTarget;
    const values = formValues(form);
    const phoneNumber = normalizeNzPhone(values.phone);
    if (!/^\+64\d{7,10}$/.test(phoneNumber)) {
      setStatus(status, "Enter a valid New Zealand mobile number starting with +64.", "error");
      return;
    }
    const agencyName = resolveAgencyName(values);
    if (!agencyName) {
      setStatus(status, "Choose your agency, or enter its name if you selected Other.", "error");
      return;
    }
    const reaaLicenceNumber = String(values.reaaLicenceNumber || "").trim();
    if (!reaaLicenceNumber) {
      setStatus(status, "Enter your REA licence number.", "error");
      return;
    }
    let phoneVerificationToken;
    const currentPhone = normalizeNzPhone(session.user?.phoneNumber);
    if (currentPhone && currentPhone !== phoneNumber) {
      setStatus(status, "Verifying your new mobile number...", null);
      try {
        const sent = await api("/auth/send-otp", { method: "POST", body: { phone: phoneNumber } });
        const code = window.prompt(`Enter the verification code sent to ${phoneNumber}.`);
        if (!code) {
          setStatus(status, "Your mobile number was not changed.", "error");
          return;
        }
        const verified = await api("/auth/verify-otp", {
          method: "POST",
          body: { verificationId: sent.verificationId, phone: phoneNumber, code: String(code).trim() },
        });
        phoneVerificationToken = verified.token;
      } catch (error) {
        setStatus(status, getErrorMessage(error, "We couldn't verify the new mobile number."), "error");
        return;
      }
    }
    setStatus(status, "Saving your changes...", null);
    try {
      const data = await api("/auth/sales-agent-web-profile", {
        method: "PATCH",
        token: session.token,
        body: {
          fullName: String(values.fullName || "").trim(),
          phoneNumber,
          primaryLanguage: String(values.primaryLanguage || "").trim(),
          agencyName,
          reaaLicenceNumber,
          ...(phoneVerificationToken ? { phoneVerificationToken } : {}),
        },
      });
      let user = data.user;
      const picture = selectedProfilePicture(form);
      if (picture) {
        setStatus(status, "Changes saved. Updating your photo...", null);
        const uploaded = await uploadProfilePicture(session.token, picture);
        user = { ...user, avatarUrl: uploaded.fileUrl };
      }
      saveSession(session.token, user);
      fillProfileForm(user);
      updateAccountSummary(user);
      setStatus(status, "Your details have been saved.", "success");
    } catch (error) {
      setStatus(status, getErrorMessage(error, "We couldn't save your changes. Please try again."), "error");
    }
  }

  async function requestReset(isResend) {
    const form = $("#password-reset-form");
    const status = $("#reset-status");
    const email = form.elements.email.value.trim();
    if (!email) {
      setStatus(status, "Enter your email address first.", "error");
      return;
    }
    setStatus(status, isResend ? "Sending a new code..." : "Sending your reset code...", null);
    try {
      await api("/auth/password-reset/request", { method: "POST", body: { email } });
      state.resetCodeRequested = true;
      const verifyBlock = $("#reset-verify-block");
      if (verifyBlock) verifyBlock.hidden = false;
      if (form.elements.code) form.elements.code.focus();
      setStatus(status, "If that email has an account, we've sent a reset code. Check your inbox.", "success");
    } catch (error) {
      setStatus(status, getErrorMessage(error, "We couldn't send a reset code. Please try again."), "error");
    }
  }

  async function confirmReset(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const status = $("#reset-status");
    const values = formValues(form);
    const email = String(values.email || "").trim();
    const code = String(values.code || "").trim();
    const password = String(values.password || "");
    if (!email || !code || !password) {
      setStatus(status, "Enter your email, reset code, and new password.", "error");
      return;
    }
    setStatus(status, "Updating your password...", null);
    try {
      await api("/auth/password-reset/confirm", {
        method: "POST",
        body: { email, code, password },
      });
      setStatus(status, "Password updated. You can sign in with your new password.", "success");
      const loginEmail = $("#sales-login-form input[name='email']");
      if (loginEmail) loginEmail.value = email;
      window.setTimeout(() => {
        closeReset();
        switchTab("login");
      }, 1400);
    } catch (error) {
      setStatus(status, getErrorMessage(error, "We couldn't reset your password. Please try again."), "error");
    }
  }

  function initListingWizard() {
    const form = $("#new-listing-form");
    if (!form) return;

    $("#new-listing-button").addEventListener("click", () => {
      $("#new-listing-panel").hidden = false;
      switchListingStep(0);
      $("#listing-photo-input").focus();
    });
    $("#cancel-new-listing-button").addEventListener("click", () => {
      $("#new-listing-panel").hidden = true;
      resetListingWizard();
    });
    $("#listing-prev-button").addEventListener("click", () => switchListingStep(state.listingStep - 1));
    $("#listing-next-button").addEventListener("click", () => {
      if (!validateListingStep(state.listingStep, true)) return;
      switchListingStep(state.listingStep + 1);
    });
    $$(".portal-step-dot").forEach((dot) => {
      dot.addEventListener("click", () => {
        const target = Number(dot.dataset.stepJump);
        const canJump = target <= state.listingStep || Array.from({ length: target }).every((_, index) => validateListingStep(index, true));
        if (canJump) switchListingStep(target);
      });
    });

    setupMarkdownToolbars(form);
    setupRichTextEditors(form);

    const dropzone = $("#listing-photo-dropzone");
    const photoInput = $("#listing-photo-input");
    photoInput.addEventListener("change", (event) => addListingPhotos(event.currentTarget.files));
    dropzone.addEventListener("dragover", (event) => {
      event.preventDefault();
      dropzone.classList.add("is-dragging");
    });
    dropzone.addEventListener("dragleave", () => dropzone.classList.remove("is-dragging"));
    dropzone.addEventListener("drop", (event) => {
      event.preventDefault();
      dropzone.classList.remove("is-dragging");
      addListingPhotos(event.dataTransfer.files);
    });
    $("#listing-photo-preview").addEventListener("click", (event) => {
      const button = event.target.closest("[data-remove-photo]");
      if (!button) return;
      const index = state.listingPhotos.findIndex((item) => item.id === button.dataset.removePhoto);
      if (index >= 0) {
        URL.revokeObjectURL(state.listingPhotos[index].previewUrl);
        state.listingPhotos.splice(index, 1);
        renderPhotoPreview();
      }
    });

    form.elements.address.addEventListener("input", (event) => {
      clearSelectedAddress(form);
      // Capture the value synchronously: `event.currentTarget` is null by the
      // time the debounced setTimeout fires, which previously made the as-you-type
      // search throw and silently never run (the dropdown only appeared after a
      // re-focus). Reading it now fixes live autocomplete while typing.
      const value = String(event.currentTarget.value || "");
      window.clearTimeout(state.addressTimer);
      state.addressTimer = window.setTimeout(() => searchAddress(value), 250);
    });
    form.elements.address.addEventListener("focus", (event) => {
      const value = String(event.currentTarget.value || "");
      if (value.trim().length >= 3 && !form.elements.addressSelectedPlaceId.value) {
        void searchAddress(value);
      }
    });
    form.elements.address.addEventListener("blur", () => {
      window.setTimeout(() => {
        const results = $("#listing-address-results");
        if (results && !form.elements.addressSelectedPlaceId.value) results.hidden = true;
      }, 180);
    });
    $("#listing-address-results").addEventListener("click", (event) => {
      const button = event.target.closest("[data-place-id]");
      if (!button) return;
      const osmData = button.dataset.osm === "1"
        ? {
            lat: button.dataset.lat,
            lon: button.dataset.lon,
            street: button.dataset.street,
            suburb: button.dataset.suburb,
            city: button.dataset.city,
            postcode: button.dataset.postcode,
          }
        : null;
      void chooseAddress(button.dataset.placeId, button.dataset.placeDescription, osmData);
    });

    form.addEventListener("change", (event) => {
      if (event.target.matches("[data-document-category]")) renderDocumentList();
    });
    form.addEventListener("submit", handleNewListing);
    renderDocumentList();
    switchListingStep(0);
  }

  function init() {
    $$(".portal-tab").forEach((tab) => {
      tab.addEventListener("click", () => switchTab(tab.dataset.tabTarget));
    });

    const signupForm = $("#sales-signup-form");
    signupForm.addEventListener("submit", handleSignup);
    signupForm.elements.phone.addEventListener("input", () => {
      if (state.verifiedPhone && normalizeNzPhone(signupForm.elements.phone.value) !== state.verifiedPhone) {
        resetPhoneVerification();
      }
    });
    $("#send-otp-button").addEventListener("click", () => sendOtp(signupForm, false));
    $("#resend-otp-button").addEventListener("click", () => sendOtp(signupForm, true));
    $("#verify-otp-button").addEventListener("click", () => verifyOtp(signupForm));

    $("#agency-select").addEventListener("change", (event) => {
      const showOther = event.currentTarget.value === "Others";
      const field = $("#agency-other-field");
      field.hidden = !showOther;
      field.querySelector("input").required = showOther;
      if (!showOther) field.querySelector("input").value = "";
    });

    $("#sales-login-form").addEventListener("submit", handleLogin);
    $$("[data-reset-open]").forEach((button) => button.addEventListener("click", openReset));
    $$("[data-reset-close]").forEach((button) => button.addEventListener("click", closeReset));
    $("#request-reset-button").addEventListener("click", () => requestReset(false));
    $("#resend-reset-button").addEventListener("click", () => requestReset(true));
    $("#password-reset-form").addEventListener("submit", confirmReset);

    $$(".portal-dashboard-tab").forEach((tab) => {
      tab.addEventListener("click", () => switchDashboardTab(tab.dataset.dashboardTarget));
    });
    initListingWizard();
    $("#listings-list").addEventListener("click", (event) => {
      const removeButton = event.target.closest("[data-delete-listing]");
      if (removeButton) void handleDeleteListing(removeButton.dataset.deleteListing);
    });
    $("#listings-list").addEventListener("change", (event) => {
      const toggle = event.target.closest("[data-toggle-listing]");
      if (toggle) void handleToggleListing(toggle.dataset.toggleListing, toggle.checked);
    });
    $("#portal-profile-form").addEventListener("submit", handleProfileSave);
    $("#profile-agency-select").addEventListener("change", (event) => {
      const showOther = event.currentTarget.value === "Others";
      const field = $("#profile-agency-other-field");
      field.hidden = !showOther;
      field.querySelector("input").required = showOther;
      if (!showOther) field.querySelector("input").value = "";
    });
    $("#signout-button").addEventListener("click", () => {
      clearSession();
      showAuth();
    });
    $("#account-signout-button").addEventListener("click", () => {
      clearSession();
      showAuth();
    });

    $$("[data-consent-close]").forEach((button) => button.addEventListener("click", closeConsentModal));
    const consentCheckbox = /** @type {HTMLInputElement|null} */ ($("#consent-checkbox"));
    if (consentCheckbox) {
      consentCheckbox.addEventListener("change", () => {
        const btn = $("#consent-confirm-button");
        if (btn) btn.disabled = !consentCheckbox.checked;
      });
    }
    const consentConfirmBtn = $("#consent-confirm-button");
    if (consentConfirmBtn) consentConfirmBtn.addEventListener("click", consentAndProceed);

    $$("[data-paywall-close]").forEach((button) => button.addEventListener("click", closePaywall));
    $$("[data-agent-welcome-close]").forEach((button) => button.addEventListener("click", closeAgentWelcome));
    $$(".paywall-toggle-btn").forEach((button) =>
      button.addEventListener("click", () => switchPaywallMode(button.dataset.paywallMode)),
    );
    const paywallSubscribeBtn = $("#paywall-subscribe-button");
    if (paywallSubscribeBtn) paywallSubscribeBtn.addEventListener("click", submitPaywallSubscribe);
    const paywallInviteBtn = $("#paywall-invite-button");
    if (paywallInviteBtn) paywallInviteBtn.addEventListener("click", submitPaywallInvite);

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !$("#reset-panel").hidden) closeReset();
      if (event.key === "Escape" && !$("#consent-panel")?.hidden) closeConsentModal();
      if (event.key === "Escape" && !$("#paywall-panel").hidden) closePaywall();
      if (event.key === "Escape" && !$("#agent-welcome-panel").hidden) closeAgentWelcome();
    });

    // Handle the redirect back from Stripe before resuming any stored session.
    handleStripeReturn().then((handled) => {
      if (handled) return;
      const session = getSession();
      if (!session) return;
      api("/auth/me", { method: "GET", token: session.token })
        .then((data) => {
          if (data.user && (data.user.role === "sales_agent" || data.user.agencyName)) {
            saveSession(session.token, data.user);
            showDashboard(data.user);
          } else {
            clearSession();
            showAuth();
          }
        })
        .catch(() => {
          clearSession();
          showAuth();
        });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
