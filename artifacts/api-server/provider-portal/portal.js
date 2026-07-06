(function () {
  const API_BASE = "/api";
  // Distinct keys from the sales portal so the two portal sessions never collide.
  const TOKEN_KEY = "projectAlphaProviderPortalToken";
  const USER_KEY = "projectAlphaProviderPortalUser";

  const state = {
    verificationId: null,
    verifiedPhone: null,
    phoneVerificationToken: null,
    resetCodeRequested: false,
    currentUser: null,
    otpCooldownTimer: null,
    pendingSignupPayload: null,
    pendingSignupForm: null,
    dmThreads: [],
    dmMessages: [],
    dmSelectedThreadId: null,
    dmSelectedProfile: null,
    dmNextCursor: null,
    dmLoading: false,
    dmSending: false,
    dmPollTimer: null,
    dmSocket: null,
    dmSocketScriptPromise: null,
    dmSocketConnected: false,
    dmRevealedPhoneUserId: null,
    providerSubscription: null,
    pendingDmFiles: [],
    dmAttachmentObjectUrls: [],
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
  // same-origin multipart endpoint on any non-validation error (signed URLs
  // unavailable, or bucket CORS blocking the cross-origin PUT).
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
      if (code === "INVALID_FILE_TYPE" || code === "INVALID_SIZE" || code === "INVALID_NAME" || code === "INVALID_CATEGORY") {
        throw error;
      }
      return uploadFile(basePath, token, file, extraFields);
    }
  }

  function currentToken() {
    const session = getSession();
    return session ? session.token : null;
  }

  function displayName(user) {
    if (!user) return "Project Alpha user";
    return user.fullName || user.companyName || "Project Alpha user";
  }

  function initialsFor(name) {
    const parts = String(name || "PA")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2);
    return (parts.map((part) => part[0]).join("") || "PA").toUpperCase();
  }

  function resolveAssetUrl(url) {
    if (!url) return "";
    if (/^(https?:|data:|blob:|file:)/i.test(url)) return url;
    if (url.startsWith("/")) return url;
    return `/${url}`;
  }

  function setAvatar(container, user, sizeLabel) {
    if (!container) return;
    const name = displayName(user);
    const url = resolveAssetUrl(user && user.avatarUrl);
    container.replaceChildren();
    container.setAttribute("aria-label", name);
    if (url) {
      const img = document.createElement("img");
      img.src = url;
      img.alt = "";
      img.loading = "lazy";
      img.decoding = "async";
      img.onerror = () => {
        container.replaceChildren(initialsFor(name));
      };
      container.appendChild(img);
    } else {
      container.textContent = initialsFor(name);
    }
    if (sizeLabel) container.dataset.avatarSize = sizeLabel;
  }

  function createAvatar(user, className) {
    const span = document.createElement("span");
    span.className = className;
    setAvatar(span, user);
    return span;
  }

  function formatTime(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const now = new Date();
    const sameDay = date.toDateString() === now.toDateString();
    return date.toLocaleString(undefined, sameDay
      ? { hour: "numeric", minute: "2-digit" }
      : { month: "short", day: "numeric" });
  }

  function formatFullTime(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function formatDate(value) {
    if (!value) return "Not set";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Not set";
    return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }

  function daysUntil(value) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return Math.max(0, Math.ceil((date.getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
  }

  function messagePreview(message) {
    if (!message) return "No messages yet";
    if (message.body) return message.body;
    if (message.fileUrl) return message.fileName || "File";
    if (message.imageUrl) return "Photo";
    return "Photo";
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
    state.currentUser = null;
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

  // ── Auth view <-> placeholder dashboard ──────────────────────────────────
  function showDashboard(user) {
    state.currentUser = user || null;
    document.body.classList.remove("provider-auth-booting");
    document.body.classList.add("provider-dashboard-active");
    const hero = $(".portal-hero");
    if (hero) hero.hidden = true;
    $("#portal-auth").hidden = true;
    $("#portal-dashboard").hidden = false;
    startDmPolling();
    void loadDmThreads({ preserveSelection: true });
    void connectDmSocket();
    fillProviderProfileForm(user || {});
    void loadProviderSubscription();
  }

  function showAuth() {
    document.body.classList.remove("provider-auth-booting");
    document.body.classList.remove("provider-dashboard-active");
    stopDmPolling();
    resetDmState();
    const hero = $(".portal-hero");
    if (hero) hero.hidden = false;
    $("#portal-auth").hidden = false;
    $("#portal-dashboard").hidden = true;
  }

  function switchProviderMode(mode) {
    // Work space is the dedicated React SPA at /workspace/ (shares this portal's
    // auth token via localStorage). Navigate there instead of toggling a panel,
    // unless the account is subscription-locked — then keep them on Manage.
    if (mode === "workspace" && !isProviderAccessLocked()) {
      window.location.assign("/workspace/");
      return;
    }
    const selectedMode = isProviderAccessLocked() && mode === "workspace" ? "manage" : (mode === "workspace" ? "workspace" : "manage");
    $$("[data-provider-mode]").forEach((button) => {
      const active = button.dataset.providerMode === selectedMode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
    });
    $$("[data-provider-mode-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.providerModePanel !== selectedMode;
    });
    if (isProviderAccessLocked()) switchManagePanel("subscription");
  }

  function switchManagePanel(panelName) {
    const requestedPanel = panelName === "profile" || panelName === "subscription" ? panelName : "message";
    const selectedPanel = isProviderAccessLocked() && requestedPanel !== "subscription" ? "subscription" : requestedPanel;
    $$("[data-provider-manage-panel]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.providerManagePanel === selectedPanel);
    });
    $$("[data-provider-manage-content]").forEach((panel) => {
      panel.hidden = panel.dataset.providerManageContent !== selectedPanel;
    });
    if (selectedPanel === "message") {
      void loadDmThreads({ preserveSelection: true });
    } else if (selectedPanel === "profile") {
      fillProviderProfileForm(state.currentUser || {});
    } else if (selectedPanel === "subscription") {
      void loadProviderSubscription({ quiet: true });
    }
  }

  function isProviderAccessLocked() {
    return !!state.providerSubscription && state.providerSubscription.providerAccessActive === false;
  }

  function applyProviderAccessLock() {
    const locked = isProviderAccessLocked();
    const shell = $(".provider-dashboard-shell");
    if (shell) shell.classList.toggle("is-access-locked", locked);
    $$("[data-provider-mode='workspace'], [data-provider-manage-panel='message'], [data-provider-manage-panel='profile']").forEach((button) => {
      button.setAttribute("aria-disabled", locked ? "true" : "false");
    });
    if (locked) {
      switchProviderMode("manage");
      switchManagePanel("subscription");
    }
  }

  function subscriptionMetaRow(label, value) {
    const row = document.createElement("div");
    row.className = "provider-subscription-row";
    const left = document.createElement("span");
    left.textContent = label;
    const right = document.createElement("strong");
    right.textContent = value;
    row.append(left, right);
    return row;
  }

  function setSubscriptionLoading() {
    const badge = $("#provider-subscription-badge");
    const meta = $("#provider-subscription-meta");
    const actions = $("#provider-subscription-actions");
    if (badge) {
      badge.textContent = "Loading...";
      badge.classList.remove("is-warning");
    }
    if (meta) meta.replaceChildren(subscriptionMetaRow("Status", "Checking account"));
    if (actions) actions.replaceChildren();
  }

  async function loadProviderSubscription(options) {
    const token = currentToken();
    if (!token) return;
    const opts = options || {};
    if (!opts.quiet) setSubscriptionLoading();
    try {
      const data = await api("/subscription/provider-status", { method: "GET", token });
      state.providerSubscription = data;
      renderProviderSubscription();
      applyProviderAccessLock();
    } catch (error) {
      const badge = $("#provider-subscription-badge");
      const meta = $("#provider-subscription-meta");
      if (badge) {
        badge.textContent = "Could not load";
        badge.classList.add("is-warning");
      }
      if (meta) meta.replaceChildren(subscriptionMetaRow("Error", getErrorMessage(error, "Subscription status is unavailable.")));
      setStatus($("#provider-subscription-status"), getErrorMessage(error, "We couldn't load your subscription."), "error");
    }
  }

  function renderProviderSubscription() {
    const data = state.providerSubscription || {};
    const badge = $("#provider-subscription-badge");
    const meta = $("#provider-subscription-meta");
    const actions = $("#provider-subscription-actions");
    const note = $("#provider-subscription-note");
    if (!badge || !meta || !actions) return;

    badge.classList.toggle("is-warning", !data.providerAccessActive);
    meta.replaceChildren();
    actions.replaceChildren();
    setStatus($("#provider-subscription-status"), "", null);

    const kind = data.providerAccessKind || "none";
    const trialDays = daysUntil(data.providerTrialEndsAt);

    if (kind === "stripe" && data.providerAccessActive) {
      badge.textContent = data.cancelAtPeriodEnd ? "Active until cancellation date" : "Stripe subscription active";
      meta.append(
        subscriptionMetaRow("Plan", "Provider Standard"),
        subscriptionMetaRow("Status", data.subscriptionStatus || "active"),
        subscriptionMetaRow(data.cancelAtPeriodEnd ? "Access ends" : "Renews", data.subscriptionPeriodEndAt ? formatDate(data.subscriptionPeriodEndAt) : "Renewal date syncing"),
      );
      const manage = document.createElement("button");
      manage.type = "button";
      manage.className = data.cancelAtPeriodEnd ? "button button-primary" : "button button-quiet";
      manage.textContent = data.cancelAtPeriodEnd ? "Resume subscription" : "Cancel subscription";
      manage.addEventListener("click", () => {
        void changeProviderSubscription(data.cancelAtPeriodEnd ? "resume" : "cancel");
      });
      actions.appendChild(manage);
      if (note) note.textContent = "Your provider access is active on the web portal and mobile app.";
      return;
    }

    if (kind === "trial" && data.providerAccessActive) {
      badge.textContent = "Trial active";
      meta.append(
        subscriptionMetaRow("Access source", "Invitation code trial"),
        subscriptionMetaRow("Trial ends", formatDate(data.providerTrialEndsAt)),
        subscriptionMetaRow("Days remaining", trialDays === null ? "14 days" : `${trialDays} day${trialDays === 1 ? "" : "s"}`),
        subscriptionMetaRow("Mobile app access", "Active during trial"),
      );
      actions.appendChild(createProviderSubscribeButton("Subscribe with Stripe"));
      if (note) note.textContent = "This account was activated with an invitation code, so it is on a 14-day trial. Subscribe before the trial ends to keep provider access.";
      return;
    }

    if (kind === "iap" && data.providerAccessActive) {
      badge.textContent = "Mobile subscription active";
      meta.append(
        subscriptionMetaRow("Plan", "Provider Standard"),
        subscriptionMetaRow("Access", "Active"),
        subscriptionMetaRow("Period ends", formatDate(data.subscriptionPeriodEndAt)),
      );
      if (note) note.textContent = "Your mobile app subscription is active. Stripe controls are only shown for web subscriptions.";
      return;
    }

    badge.textContent = kind === "expired_trial" ? "Trial ended" : "Subscription required";
    meta.append(
      subscriptionMetaRow("Access", "Paused"),
      subscriptionMetaRow("Access source", kind === "expired_trial" ? "Invitation code trial" : "No active subscription"),
      subscriptionMetaRow("Trial ended", data.providerTrialEndsAt ? formatDate(data.providerTrialEndsAt) : "No active trial"),
      subscriptionMetaRow("Next step", "Subscribe through Stripe"),
    );
    actions.appendChild(createProviderSubscribeButton("Reactivate with Stripe"));
    if (note) note.textContent = "Provider features are locked until this account is reactivated with Stripe.";
  }

  function createProviderSubscribeButton(label) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "button button-primary";
    button.textContent = label;
    button.addEventListener("click", () => {
      void startProviderSubscriptionCheckout(button);
    });
    return button;
  }

  async function startProviderSubscriptionCheckout(button) {
    const token = currentToken();
    if (!token) return;
    const original = button.textContent;
    button.disabled = true;
    button.textContent = "Opening Stripe...";
    setStatus($("#provider-subscription-status"), "", null);
    try {
      const data = await api("/subscription/provider-checkout", { method: "POST", token });
      if (!data.checkoutUrl) throw new Error("Stripe checkout did not return a URL.");
      window.location.href = data.checkoutUrl;
    } catch (error) {
      button.disabled = false;
      button.textContent = original;
      setStatus($("#provider-subscription-status"), getErrorMessage(error, "Could not open Stripe checkout."), "error");
    }
  }

  async function changeProviderSubscription(action) {
    const token = currentToken();
    if (!token) return;
    setStatus($("#provider-subscription-status"), action === "cancel" ? "Cancelling at period end..." : "Resuming subscription...", null);
    try {
      await api(`/subscription/${action}`, { method: "POST", token });
      await loadProviderSubscription({ quiet: true });
      setStatus($("#provider-subscription-status"), action === "cancel" ? "Subscription will end at the period end." : "Subscription resumed.", "success");
    } catch (error) {
      setStatus($("#provider-subscription-status"), getErrorMessage(error, "Subscription could not be updated."), "error");
    }
  }

  async function handleProviderSubscriptionReturn(sessionId) {
    const session = getSession();
    if (!session) {
      window.history.replaceState({}, "", window.location.pathname);
      return;
    }
    try {
      setSubscriptionLoading();
      await api("/subscription/provider-checkout/claim", {
        method: "POST",
        token: session.token,
        body: { checkoutSessionId: sessionId },
      });
      const me = await api("/auth/me", { method: "GET", token: session.token });
      saveSession(session.token, me.user);
      showDashboard(me.user);
      switchManagePanel("subscription");
      setStatus($("#provider-subscription-status"), "Subscription active. Your provider access is restored.", "success");
    } catch (error) {
      showDashboard(session.user || {});
      switchManagePanel("subscription");
      setStatus($("#provider-subscription-status"), getErrorMessage(error, "We could not confirm the Stripe subscription yet."), "error");
    } finally {
      window.history.replaceState({}, "", window.location.pathname);
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

  function resetDmState() {
    state.dmThreads = [];
    state.dmMessages = [];
    state.dmSelectedThreadId = null;
    state.dmSelectedProfile = null;
    state.dmNextCursor = null;
    state.dmLoading = false;
    state.dmSending = false;
    state.dmRevealedPhoneUserId = null;
    disconnectDmSocket();
    renderDmThreads();
    renderSelectedDmThread();
  }

  function stopDmPolling() {
    if (state.dmPollTimer) {
      window.clearInterval(state.dmPollTimer);
      state.dmPollTimer = null;
    }
  }

  function startDmPolling() {
    stopDmPolling();
    if (state.dmSocketConnected) return;
    state.dmPollTimer = window.setInterval(() => {
      const dashboard = $("#portal-dashboard");
      const messagePanel = $('[data-provider-manage-content="message"]');
      if (!dashboard || dashboard.hidden || !messagePanel || messagePanel.hidden) return;
      void refreshDmInbox();
    }, 10000);
  }

  function selectedDmThread() {
    return state.dmThreads.find((thread) => thread.id === state.dmSelectedThreadId) || null;
  }

  function isDmBlocked(thread) {
    return !!(thread && thread.blockStatus && thread.blockStatus.messagingBlocked);
  }

  async function refreshDmInbox() {
    await loadDmThreads({ preserveSelection: true, quiet: true });
  }

  function ensureSocketClient() {
    if (window.io) return Promise.resolve(window.io);
    if (state.dmSocketScriptPromise) return state.dmSocketScriptPromise;
    state.dmSocketScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = `${API_BASE}/socket.io/socket.io.js`;
      script.async = true;
      script.onload = () => window.io ? resolve(window.io) : reject(new Error("Socket client unavailable"));
      script.onerror = () => reject(new Error("Socket client unavailable"));
      document.head.appendChild(script);
    });
    return state.dmSocketScriptPromise;
  }

  async function connectDmSocket() {
    const token = currentToken();
    if (!token || state.dmSocket) return;
    try {
      const io = await ensureSocketClient();
      const socket = io(window.location.origin, {
        path: `${API_BASE}/socket.io`,
        auth: { token },
        transports: ["websocket", "polling"],
        reconnection: true,
        reconnectionDelay: 2000,
      });
      state.dmSocket = socket;
      socket.on("connect", () => {
        state.dmSocketConnected = true;
        stopDmPolling();
        void refreshDmInbox();
      });
      socket.on("connect_error", () => {
        state.dmSocketConnected = false;
        startDmPolling();
      });
      socket.on("disconnect", () => {
        state.dmSocketConnected = false;
        startDmPolling();
      });
      socket.on("new_message", ({ threadId, message }) => {
        handleIncomingDmMessage(threadId, message);
      });
      socket.on("message_like", ({ threadId, message }) => {
        applyDmLikeUpdate(threadId, message);
      });
    } catch {
      state.dmSocketConnected = false;
      startDmPolling();
    }
  }

  function disconnectDmSocket() {
    if (state.dmSocket) {
      state.dmSocket.disconnect();
      state.dmSocket = null;
    }
    state.dmSocketConnected = false;
  }

  function hasDmMessage(messageId) {
    return !!messageId && state.dmMessages.some((message) => message.id === messageId);
  }

  function handleIncomingDmMessage(threadId, message) {
    if (!threadId || !message) return;
    const isMine = state.currentUser && message.senderId === state.currentUser.id;
    let threadFound = false;
    state.dmThreads = state.dmThreads.map((thread) => {
      if (thread.id !== threadId) return thread;
      threadFound = true;
      const isActive = thread.id === state.dmSelectedThreadId;
      return {
        ...thread,
        lastMessage: message,
        lastMessageAt: message.createdAt || new Date().toISOString(),
        unreadCount: isMine || isActive ? 0 : (thread.unreadCount || 0) + 1,
      };
    });
    if (!threadFound) {
      void loadDmThreads({ preserveSelection: true, quiet: true });
      return;
    }
    if (threadId === state.dmSelectedThreadId && !isMine && !hasDmMessage(message.id)) {
      state.dmMessages = [...state.dmMessages, message];
      renderSelectedDmThread();
      void markDmThreadRead(threadId);
    }
    renderDmThreads();
  }

  async function loadDmThreads(options) {
    const token = currentToken();
    if (!token) return;
    const opts = options || {};
    const list = $("#provider-thread-list");
    if (!opts.quiet && list) {
      list.replaceChildren();
      const loading = document.createElement("div");
      loading.className = "provider-thread-empty";
      loading.textContent = "Loading conversations...";
      list.appendChild(loading);
    }
    try {
      const data = await api("/dm/threads", { method: "GET", token });
      const threads = Array.isArray(data.threads) ? data.threads : [];
      state.dmThreads = threads.filter((thread) => thread.otherParticipant && thread.otherParticipant.role === "general");
      if (!opts.preserveSelection || !state.dmThreads.some((thread) => thread.id === state.dmSelectedThreadId)) {
        state.dmSelectedThreadId = state.dmThreads[0] ? state.dmThreads[0].id : null;
      }
      renderDmThreads();
      if (state.dmSelectedThreadId) {
        await loadDmMessages(state.dmSelectedThreadId, { quiet: opts.quiet });
      } else {
        state.dmMessages = [];
        state.dmSelectedProfile = null;
        state.dmNextCursor = null;
        renderSelectedDmThread();
      }
    } catch (error) {
      renderDmThreadError(getErrorMessage(error, "We couldn't load conversations. Please try again."));
    }
  }

  function renderDmThreadError(message) {
    const list = $("#provider-thread-list");
    if (!list) return;
    list.replaceChildren();
    const empty = document.createElement("div");
    empty.className = "provider-thread-empty";
    const strong = document.createElement("strong");
    strong.textContent = message;
    const retry = document.createElement("button");
    retry.className = "button button-quiet";
    retry.type = "button";
    retry.textContent = "Retry";
    retry.addEventListener("click", () => {
      void loadDmThreads({ preserveSelection: true });
    });
    empty.append(strong, document.createElement("br"), retry);
    list.appendChild(empty);
  }

  function renderDmThreads() {
    const list = $("#provider-thread-list");
    if (!list) return;
    const query = String($("#provider-thread-search")?.value || "").trim().toLowerCase();
    const filtered = state.dmThreads.filter((thread) => {
      const name = displayName(thread.otherParticipant).toLowerCase();
      const preview = messagePreview(thread.lastMessage).toLowerCase();
      return !query || name.includes(query) || preview.includes(query);
    });
    list.replaceChildren();
    if (filtered.length === 0) {
      const empty = document.createElement("div");
      empty.className = "provider-thread-empty";
      empty.textContent = state.dmThreads.length
        ? "No contacts match that search."
        : "No general users have messaged you yet.";
      list.appendChild(empty);
      return;
    }
    filtered.forEach((thread) => {
      const item = document.createElement("div");
      item.className = "provider-thread-item";
      if (thread.id === state.dmSelectedThreadId) item.classList.add("is-active");
      item.dataset.threadId = thread.id;

      const button = document.createElement("button");
      button.type = "button";
      button.className = "provider-thread-select";

      const other = thread.otherParticipant;
      const avatar = createAvatar(other, "provider-thread-avatar");
      const body = document.createElement("span");
      const nameRow = document.createElement("span");
      nameRow.className = "provider-thread-name";
      const name = document.createElement("strong");
      name.textContent = displayName(other);
      nameRow.appendChild(name);
      if (thread.unreadCount) {
        const badge = document.createElement("span");
        badge.className = "provider-thread-badge";
        badge.textContent = String(Math.min(thread.unreadCount, 99));
        nameRow.appendChild(badge);
      }
      const preview = document.createElement("span");
      preview.className = "provider-thread-preview";
      preview.textContent = messagePreview(thread.lastMessage);
      body.append(nameRow, preview);

      const time = document.createElement("span");
      time.className = "provider-thread-time";
      time.textContent = formatTime(thread.lastMessageAt || thread.lastMessage?.createdAt || thread.createdAt);

      button.append(avatar, body, time);
      button.addEventListener("click", () => {
        void selectDmThread(thread.id);
      });
      item.appendChild(button);
      if (thread.id === state.dmSelectedThreadId) item.appendChild(createDmThreadActionMenu(thread));
      list.appendChild(item);
    });
  }

  function createDmThreadActionMenu(thread) {
    const menu = document.createElement("details");
    menu.className = "provider-thread-actions";
    const summary = document.createElement("summary");
    summary.setAttribute("aria-label", "User actions");
    summary.textContent = "⋯";
    const panel = document.createElement("div");
    panel.className = "provider-thread-menu-panel";

    const block = document.createElement("button");
    block.type = "button";
    block.className = "button button-quiet";
    block.textContent = thread.blockStatus?.iBlockedThem ? "Unblock" : "Block";
    block.addEventListener("click", (event) => {
      event.stopPropagation();
      menu.open = false;
      void toggleDmBlock();
    });

    const report = document.createElement("button");
    report.type = "button";
    report.className = "button button-quiet";
    report.textContent = "Report";
    report.addEventListener("click", (event) => {
      event.stopPropagation();
      menu.open = false;
      void reportDmUser();
    });

    panel.append(block, report);
    menu.append(summary, panel);
    return menu;
  }

  async function selectDmThread(threadId) {
    if (!threadId || state.dmSelectedThreadId === threadId) return;
    state.dmSelectedThreadId = threadId;
    state.dmMessages = [];
    state.dmSelectedProfile = null;
    state.dmNextCursor = null;
    state.dmRevealedPhoneUserId = null;
    renderDmThreads();
    renderSelectedDmThread();
    await loadDmMessages(threadId);
  }

  async function loadDmMessages(threadId, options) {
    const token = currentToken();
    if (!token || !threadId) return;
    const opts = options || {};
    if (!opts.quiet) {
      state.dmLoading = true;
      renderSelectedDmThread();
    }
    try {
      const data = await api(`/dm/threads/${encodeURIComponent(threadId)}/messages`, { method: "GET", token });
      state.dmMessages = Array.isArray(data.messages) ? data.messages.slice().reverse() : [];
      state.dmNextCursor = data.nextCursor || null;
      const thread = selectedDmThread();
      if (thread && data.blockStatus) thread.blockStatus = data.blockStatus;
      await markDmThreadRead(threadId);
      await loadSelectedDmProfile();
      state.dmLoading = false;
      renderSelectedDmThread();
      renderDmThreads();
    } catch (error) {
      state.dmLoading = false;
      renderDmMessageError(getErrorMessage(error, "We couldn't load this conversation. Please try again."));
    }
  }

  async function loadOlderDmMessages() {
    const token = currentToken();
    const threadId = state.dmSelectedThreadId;
    if (!token || !threadId || !state.dmNextCursor) return;
    const cursor = state.dmNextCursor;
    try {
      const data = await api(`/dm/threads/${encodeURIComponent(threadId)}/messages?cursor=${encodeURIComponent(cursor)}`, {
        method: "GET",
        token,
      });
      const older = Array.isArray(data.messages) ? data.messages.slice().reverse() : [];
      state.dmMessages = [...older, ...state.dmMessages];
      state.dmNextCursor = data.nextCursor || null;
      renderSelectedDmThread({ preserveScroll: true });
    } catch (error) {
      setStatus($("#provider-message-status"), getErrorMessage(error, "Older messages could not be loaded."), "error");
    }
  }

  async function markDmThreadRead(threadId) {
    const token = currentToken();
    if (!token || !threadId) return;
    try {
      await api(`/dm/threads/${encodeURIComponent(threadId)}/read`, { method: "PATCH", token });
      state.dmThreads = state.dmThreads.map((thread) =>
        thread.id === threadId ? { ...thread, unreadCount: 0 } : thread,
      );
    } catch {
      // Read receipts are best-effort; the inbox still works if this call fails.
    }
  }

  async function loadSelectedDmProfile() {
    const token = currentToken();
    const thread = selectedDmThread();
    const userId = thread && thread.otherParticipant && thread.otherParticipant.id;
    if (!token || !userId) {
      state.dmSelectedProfile = null;
      return;
    }
    try {
      state.dmSelectedProfile = await api(`/users/${encodeURIComponent(userId)}`, { method: "GET", token });
    } catch {
      state.dmSelectedProfile = null;
    }
  }

  function renderDmMessageError(message) {
    const list = $("#provider-message-list");
    if (!list) return;
    list.replaceChildren();
    const empty = document.createElement("div");
    empty.className = "provider-message-empty";
    const inner = document.createElement("div");
    const strong = document.createElement("strong");
    strong.textContent = message;
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "button button-quiet";
    retry.textContent = "Retry";
    retry.addEventListener("click", () => {
      if (state.dmSelectedThreadId) void loadDmMessages(state.dmSelectedThreadId);
    });
    inner.append(strong, retry);
    empty.appendChild(inner);
    list.appendChild(empty);
  }

  function renderSelectedDmThread(options) {
    const thread = selectedDmThread();
    const shell = $("#provider-message-shell");
    const list = $("#provider-message-list");
    const activeName = $("#provider-active-name");
    const activeSubtitle = $("#provider-active-subtitle");
    const activeAvatar = $("#provider-active-avatar");
    const input = $("#provider-message-input");
    const send = $("#provider-message-send");
    const attach = $("#provider-message-attach");
    const blocked = $("#provider-message-blocked");
    const callLink = $("#provider-call-link");
    if (!list) return;

    if (shell) shell.classList.toggle("has-active-thread", !!thread);

    if (!thread) {
      if (activeName) activeName.textContent = "Select a conversation";
      if (activeSubtitle) activeSubtitle.textContent = "Choose a general user from the contact list.";
      setAvatar(activeAvatar, { fullName: "Project Alpha" });
      list.replaceChildren();
      const empty = document.createElement("div");
      empty.className = "provider-message-empty";
      const inner = document.createElement("div");
      const strong = document.createElement("strong");
      strong.textContent = "No conversation selected.";
      const copy = document.createElement("p");
      copy.textContent = "Select a contact on the left to view and reply to messages from Project Alpha users.";
      inner.append(strong, copy);
      empty.appendChild(inner);
      list.appendChild(empty);
      renderSelectedDmProfile();
      if (input) input.disabled = true;
      if (send) send.disabled = true;
      if (attach) attach.disabled = true;
      if (blocked) blocked.classList.remove("is-visible");
      if (callLink) callLink.hidden = true;
      return;
    }

    const other = thread.otherParticipant || {};
    const name = displayName(other);
    if (activeName) activeName.textContent = name;
    if (activeSubtitle) {
      const rec = Number(state.dmSelectedProfile?.recommendationCount ?? other.recommendationCount ?? 0);
      activeSubtitle.textContent = rec > 0 ? `General user · ${rec} recommendations` : "General user";
    }
    setAvatar(activeAvatar, other);

    const contactNumber = state.dmSelectedProfile?.roleData?.contactNumber;
    const phoneRevealed = !!contactNumber && state.dmRevealedPhoneUserId === other.id;
    if (callLink) {
      if (contactNumber) {
        callLink.title = phoneRevealed ? `Phone: ${contactNumber}` : "Reveal phone number";
        // This phone action is the only place the user's number is revealed.
        callLink.textContent = phoneRevealed ? contactNumber : "☎";
        callLink.classList.toggle("is-phone-revealed", phoneRevealed);
        callLink.hidden = false;
      } else {
        callLink.textContent = "☎";
        callLink.classList.remove("is-phone-revealed");
        callLink.hidden = true;
      }
    }

    const blockedNow = isDmBlocked(thread);
    if (blocked) {
      blocked.textContent = thread.blockStatus?.iBlockedThem
        ? "You blocked this user. Unblock them before sending messages."
        : "Messaging is currently unavailable with this user.";
      blocked.classList.toggle("is-visible", blockedNow);
    }
    if (input) input.disabled = blockedNow || state.dmSending || state.dmLoading;
    if (attach) attach.disabled = blockedNow || state.dmSending || state.dmLoading;
    updateDmSendState();

    list.replaceChildren();
    if (state.dmLoading) {
      const loading = document.createElement("div");
      loading.className = "provider-message-empty";
      loading.textContent = "Loading conversation...";
      list.appendChild(loading);
      renderSelectedDmProfile();
      return;
    }

    if (state.dmNextCursor) {
      const more = document.createElement("button");
      more.type = "button";
      more.className = "provider-message-load-more";
      more.textContent = "Load earlier messages";
      more.addEventListener("click", () => {
        void loadOlderDmMessages();
      });
      list.appendChild(more);
    }

    if (state.dmMessages.length === 0) {
      const empty = document.createElement("div");
      empty.className = "provider-message-empty";
      empty.textContent = "No messages in this conversation yet.";
      list.appendChild(empty);
    } else {
      state.dmMessages.forEach((message) => {
        list.appendChild(createDmMessageBubble(message));
      });
    }
    renderSelectedDmProfile();
    if (!options || !options.preserveScroll) {
      requestAnimationFrame(() => {
        list.scrollTop = list.scrollHeight;
      });
    }
  }

  function createDmMessageBubble(message) {
    const row = document.createElement("div");
    row.className = "provider-message-bubble-row";
    if (message.senderId && state.currentUser && message.senderId === state.currentUser.id) row.classList.add("is-mine");
    const bubble = document.createElement("div");
    bubble.className = "provider-message-bubble";
    if (message.imageUrl) {
      const img = document.createElement("img");
      const fullUrl = resolveAssetUrl(message.imageUrl);
      img.src = fullUrl;
      img.alt = "Shared image";
      img.loading = "lazy";
      img.decoding = "async";
      img.style.cursor = "zoom-in";
      img.addEventListener("click", () => openDmLightbox(fullUrl));
      bubble.appendChild(img);
    }
    if (message.fileUrl) {
      const fileCard = document.createElement("a");
      fileCard.className = "provider-message-file";
      fileCard.href = resolveAssetUrl(message.fileUrl);
      fileCard.target = "_blank";
      fileCard.rel = "noopener noreferrer";
      const icon = document.createElement("span");
      icon.className = "provider-message-file-icon";
      icon.textContent = "📄";
      const fileName = document.createElement("span");
      fileName.className = "provider-message-file-name";
      fileName.textContent = message.fileName || "Attachment";
      fileCard.append(icon, fileName);
      bubble.appendChild(fileCard);
    }
    if (message.body) {
      const text = document.createElement("p");
      text.textContent = message.body;
      bubble.appendChild(text);
    }
    const time = document.createElement("span");
    time.className = "provider-message-time";
    time.textContent = formatFullTime(message.createdAt);
    bubble.appendChild(time);
    row.appendChild(bubble);

    const liked = !!message.likedAt;
    const isLocal = typeof message.id === "string" && message.id.startsWith("local-");
    const likeBtn = document.createElement("button");
    likeBtn.type = "button";
    likeBtn.className = "provider-message-like" + (liked ? " is-liked" : "");
    likeBtn.textContent = liked ? "♥" : "♡";
    likeBtn.setAttribute("aria-label", liked ? "Remove like" : "Like message");
    likeBtn.disabled = isLocal;
    if (!isLocal) {
      likeBtn.addEventListener("click", () => {
        void toggleDmLike(message);
      });
    }
    row.appendChild(likeBtn);
    return row;
  }

  function applyDmLikeUpdate(threadId, message) {
    if (!threadId || !message || threadId !== state.dmSelectedThreadId) return;
    let changed = false;
    state.dmMessages = state.dmMessages.map((m) => {
      if (m.id !== message.id) return m;
      changed = true;
      return { ...m, likedAt: message.likedAt || null, likedBy: message.likedBy || null };
    });
    if (changed) renderSelectedDmThread({ preserveScroll: true });
  }

  async function toggleDmLike(message) {
    const token = currentToken();
    const threadId = state.dmSelectedThreadId;
    if (!token || !threadId || !message || !message.id) return;
    const nextLiked = !message.likedAt;
    // Optimistic update.
    applyDmLikeUpdate(threadId, {
      id: message.id,
      likedAt: nextLiked ? new Date().toISOString() : null,
      likedBy: nextLiked ? (state.currentUser && state.currentUser.id) || null : null,
    });
    try {
      const data = await api(`/dm/threads/${threadId}/messages/${message.id}/like`, {
        method: "POST",
        token,
        body: { liked: nextLiked },
      });
      if (data && data.message) applyDmLikeUpdate(threadId, data.message);
    } catch {
      // Revert on failure.
      applyDmLikeUpdate(threadId, {
        id: message.id,
        likedAt: message.likedAt || null,
        likedBy: message.likedBy || null,
      });
    }
  }

  function openDmLightbox(url) {
    if (!url) return;
    let overlay = document.getElementById("provider-image-lightbox");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "provider-image-lightbox";
      overlay.className = "provider-image-lightbox";
      const img = document.createElement("img");
      img.className = "provider-image-lightbox-img";
      img.alt = "Enlarged image";
      const closeBtn = document.createElement("button");
      closeBtn.type = "button";
      closeBtn.className = "provider-image-lightbox-close";
      closeBtn.setAttribute("aria-label", "Close");
      closeBtn.textContent = "✕";
      overlay.append(img, closeBtn);
      overlay.addEventListener("click", (event) => {
        if (event.target === overlay || event.target === closeBtn) closeDmLightbox();
      });
      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") closeDmLightbox();
      });
      document.body.appendChild(overlay);
    }
    overlay.querySelector(".provider-image-lightbox-img").src = url;
    overlay.classList.add("is-visible");
  }

  function closeDmLightbox() {
    const overlay = document.getElementById("provider-image-lightbox");
    if (overlay) overlay.classList.remove("is-visible");
  }

  function renderSelectedDmProfile() {
    // The selected user's safety actions now live directly on the active
    // contact row, keeping the inbox column dedicated to conversations.
  }

  function updateDmSendState() {
    const input = $("#provider-message-input");
    const send = $("#provider-message-send");
    const attach = $("#provider-message-attach");
    const thread = selectedDmThread();
    const disabled = !thread || state.dmSending || state.dmLoading || isDmBlocked(thread);
    if (input) input.disabled = disabled;
    if (attach) attach.disabled = disabled;
    if (!send) return;
    const hasText = !!(input && input.value.trim());
    send.disabled = disabled || !hasText;
  }

  function formatFileSize(bytes) {
    const size = Number(bytes || 0);
    if (!Number.isFinite(size) || size <= 0) return "";
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
    return `${(size / (1024 * 1024)).toFixed(size >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
  }

  function clearDmAttachmentObjectUrls() {
    state.dmAttachmentObjectUrls.forEach((url) => {
      try {
        URL.revokeObjectURL(url);
      } catch {
      }
    });
    state.dmAttachmentObjectUrls = [];
  }

  function renderDmAttachmentConfirm() {
    const panel = $("#provider-attachment-panel");
    const title = $("#provider-attachment-title");
    const list = $("#provider-attachment-list");
    const confirm = $("#provider-attachment-confirm");
    if (!panel || !list) return;
    const files = state.pendingDmFiles || [];
    panel.hidden = files.length === 0;
    clearDmAttachmentObjectUrls();
    list.replaceChildren();
    if (title) title.textContent = files.length === 1 ? "Send this file?" : `Send ${files.length} files?`;
    if (confirm) {
      confirm.textContent = files.length === 1 ? "Send file" : "Send files";
      confirm.disabled = files.length === 0 || state.dmSending;
    }
    files.forEach((file) => {
      const item = document.createElement("div");
      item.className = "provider-attachment-item";
      const thumb = document.createElement("span");
      thumb.className = "provider-attachment-thumb";
      if (/^image\//i.test(file.type || "")) {
        const img = document.createElement("img");
        const url = URL.createObjectURL(file);
        state.dmAttachmentObjectUrls.push(url);
        img.src = url;
        img.alt = "";
        thumb.appendChild(img);
      } else {
        thumb.textContent = "PDF";
      }
      const meta = document.createElement("div");
      const name = document.createElement("span");
      name.className = "provider-attachment-name";
      name.textContent = file.name || "Attachment";
      const details = document.createElement("span");
      details.className = "provider-attachment-meta";
      details.textContent = [file.type || "File", formatFileSize(file.size)].filter(Boolean).join(" - ");
      meta.append(name, details);
      item.append(thumb, meta);
      list.appendChild(item);
    });
    setStatus($("#provider-attachment-status"), "", null);
  }

  function openDmAttachmentConfirm(files) {
    const thread = selectedDmThread();
    if (!thread || state.dmSending || state.dmLoading || isDmBlocked(thread)) return;
    state.pendingDmFiles = Array.from(files || []).filter(Boolean);
    renderDmAttachmentConfirm();
  }

  function closeDmAttachmentConfirm() {
    state.pendingDmFiles = [];
    clearDmAttachmentObjectUrls();
    renderDmAttachmentConfirm();
  }

  async function confirmDmAttachments() {
    const files = state.pendingDmFiles.slice();
    const thread = selectedDmThread();
    if (!files.length || !thread || state.dmSending || state.dmLoading || isDmBlocked(thread)) return;
    state.pendingDmFiles = [];
    clearDmAttachmentObjectUrls();
    renderDmAttachmentConfirm();
    setStatus($("#provider-message-status"), files.length === 1 ? "Sending attachment..." : `Sending ${files.length} attachments...`, null);
    for (const file of files) {
      if (/^image\//i.test(file.type || "")) await sendDmPhoto(file);
      else await sendDmFile(file);
    }
  }

  function revealSelectedPhone() {
    const thread = selectedDmThread();
    const userId = thread?.otherParticipant?.id;
    const contactNumber = state.dmSelectedProfile?.roleData?.contactNumber;
    if (!userId || !contactNumber) return;
    state.dmRevealedPhoneUserId = state.dmRevealedPhoneUserId === userId ? null : userId;
    // The number is shown in-place on the ☎ icon itself (see renderSelectedDmThread);
    // don't echo it into the status bar — the icon is the single reveal location.
    renderSelectedDmThread({ preserveScroll: true });
    setStatus($("#provider-message-status"), "", null);
  }

  async function uploadDmImage(file, token) {
    try {
      const signed = await api("/upload/dm-image/request-url", {
        method: "POST",
        token,
        body: {
          name: file.name || "message-photo",
          size: file.size,
          contentType: file.type || "application/octet-stream",
        },
      });
      const uploadResp = await fetch(signed.uploadURL, {
        method: "PUT",
        headers: signed.requiredHeaders || { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!uploadResp.ok) throw new Error("Upload failed. Please try again.");
      const completed = await api("/upload/dm-image/complete", {
        method: "POST",
        token,
        body: { objectPath: signed.objectPath },
      });
      return completed.fileUrl;
    } catch (error) {
      // The signed-URL path can fail for reasons other than local storage mode —
      // e.g. the object-storage bucket's CORS blocks the cross-origin PUT, which
      // surfaces as a "Failed to fetch" TypeError. In every such case fall back to
      // the same-origin multipart endpoint (no CORS), so images still send.
      const uploaded = await uploadFile("/upload/dm-image", token, file);
      return uploaded.fileUrl;
    }
  }

  async function sendDmMessage(event) {
    event.preventDefault();
    const token = currentToken();
    const thread = selectedDmThread();
    const input = $("#provider-message-input");
    const body = input ? input.value.trim() : "";
    if (!token || !thread || !body || isDmBlocked(thread)) return;
    updateDmSendState();
    setStatus($("#provider-message-status"), "", null);
    try {
      const optimistic = {
        id: `local-${Date.now()}`,
        threadId: thread.id,
        senderId: state.currentUser?.id,
        body,
        imageUrl: null,
        readAt: null,
        createdAt: new Date().toISOString(),
      };
      state.dmMessages = [...state.dmMessages, optimistic];
      if (input) input.value = "";
      renderSelectedDmThread();
      const data = await api(`/dm/threads/${encodeURIComponent(thread.id)}/messages`, {
        method: "POST",
        token,
        body: { body },
      });
      state.dmMessages = state.dmMessages.map((message) => message.id === optimistic.id ? data.message : message);
      setStatus($("#provider-message-status"), "", null);
      await loadDmThreads({ preserveSelection: true, quiet: true });
    } catch (error) {
      setStatus($("#provider-message-status"), getErrorMessage(error, "We couldn't send that message."), "error");
      await loadDmMessages(thread.id, { quiet: true });
    } finally {
      updateDmSendState();
    }
  }

  async function sendDmPhoto(file) {
    const token = currentToken();
    const thread = selectedDmThread();
    if (!token || !thread || !file || isDmBlocked(thread)) return;
    if (!/^image\//i.test(file.type || "")) {
      setStatus($("#provider-message-status"), "Choose an image file to send.", "error");
      return;
    }
    state.dmSending = true;
    updateDmSendState();
    setStatus($("#provider-message-status"), "Uploading photo...", null);
    let localUrl = "";
    try {
      localUrl = URL.createObjectURL(file);
      const optimistic = {
        id: `local-${Date.now()}`,
        threadId: thread.id,
        senderId: state.currentUser?.id,
        body: null,
        imageUrl: localUrl,
        readAt: null,
        createdAt: new Date().toISOString(),
      };
      state.dmMessages = [...state.dmMessages, optimistic];
      renderSelectedDmThread();
      const imageUrl = await uploadDmImage(file, token);
      setStatus($("#provider-message-status"), "Sending photo...", null);
      const data = await api(`/dm/threads/${encodeURIComponent(thread.id)}/messages`, {
        method: "POST",
        token,
        body: { imageUrl },
      });
      URL.revokeObjectURL(localUrl);
      localUrl = "";
      state.dmMessages = state.dmMessages.map((message) => message.id === optimistic.id ? data.message : message);
      setStatus($("#provider-message-status"), "", null);
      await loadDmThreads({ preserveSelection: true, quiet: true });
    } catch (error) {
      setStatus($("#provider-message-status"), getErrorMessage(error, "We couldn't send that photo."), "error");
      await loadDmMessages(thread.id, { quiet: true });
    } finally {
      if (localUrl) URL.revokeObjectURL(localUrl);
      state.dmSending = false;
      updateDmSendState();
    }
  }

  async function uploadDmFile(file, token) {
    try {
      const signed = await api("/upload/dm-file/request-url", {
        method: "POST",
        token,
        body: {
          name: file.name || "attachment",
          size: file.size,
          contentType: file.type || "application/octet-stream",
        },
      });
      const uploadResp = await fetch(signed.uploadURL, {
        method: "PUT",
        headers: signed.requiredHeaders || { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!uploadResp.ok) throw new Error("Upload failed. Please try again.");
      const completed = await api("/upload/dm-file/complete", {
        method: "POST",
        token,
        body: { objectPath: signed.objectPath },
      });
      return completed.fileUrl;
    } catch (error) {
      // Same-origin multipart fallback (handles object-storage CORS / local mode).
      const uploaded = await uploadFile("/upload/dm-file", token, file);
      return uploaded.fileUrl;
    }
  }

  async function sendDmFile(file) {
    const token = currentToken();
    const thread = selectedDmThread();
    if (!token || !thread || !file || isDmBlocked(thread)) return;
    state.dmSending = true;
    updateDmSendState();
    setStatus($("#provider-message-status"), "Uploading file...", null);
    try {
      const optimistic = {
        id: `local-${Date.now()}`,
        threadId: thread.id,
        senderId: state.currentUser?.id,
        body: null,
        imageUrl: null,
        fileUrl: "#",
        fileName: file.name || "attachment",
        fileMime: file.type || "application/octet-stream",
        readAt: null,
        createdAt: new Date().toISOString(),
      };
      state.dmMessages = [...state.dmMessages, optimistic];
      renderSelectedDmThread();
      const fileUrl = await uploadDmFile(file, token);
      setStatus($("#provider-message-status"), "Sending file...", null);
      const data = await api(`/dm/threads/${encodeURIComponent(thread.id)}/messages`, {
        method: "POST",
        token,
        body: { fileUrl, fileName: file.name || "attachment", fileMime: file.type || "application/octet-stream" },
      });
      state.dmMessages = state.dmMessages.map((message) => message.id === optimistic.id ? data.message : message);
      setStatus($("#provider-message-status"), "", null);
      await loadDmThreads({ preserveSelection: true, quiet: true });
    } catch (error) {
      setStatus($("#provider-message-status"), getErrorMessage(error, "We couldn't send that file."), "error");
      await loadDmMessages(thread.id, { quiet: true });
    } finally {
      state.dmSending = false;
      updateDmSendState();
    }
  }

  async function toggleDmBlock() {
    const token = currentToken();
    const thread = selectedDmThread();
    const userId = thread?.otherParticipant?.id;
    if (!token || !thread || !userId) return;
    const shouldUnblock = !!thread.blockStatus?.iBlockedThem;
    try {
      if (shouldUnblock) {
        await api(`/dm/block/${encodeURIComponent(userId)}`, { method: "DELETE", token });
      } else {
        await api("/dm/block", { method: "POST", token, body: { blockedUserId: userId } });
      }
      await loadDmThreads({ preserveSelection: true, quiet: true });
      await loadDmMessages(thread.id, { quiet: true });
    } catch (error) {
      setStatus($("#provider-message-status"), getErrorMessage(error, "We couldn't update blocking."), "error");
    }
  }

  async function reportDmUser() {
    const token = currentToken();
    const thread = selectedDmThread();
    const userId = thread?.otherParticipant?.id;
    if (!token || !thread || !userId) return;
    const comment = window.prompt("Briefly describe the issue with this conversation.");
    if (!comment) return;
    try {
      await api("/dm/report", {
        method: "POST",
        token,
        body: {
          reportedUserId: userId,
          threadId: thread.id,
          comment,
        },
      });
      setStatus($("#provider-message-status"), "Report sent. Thank you.", "success");
    } catch (error) {
      setStatus($("#provider-message-status"), getErrorMessage(error, "We couldn't send the report."), "error");
    }
  }

  // ── Phone OTP (shared backend with the sales portal) ─────────────────────
  function normalizeNzPhone(phone) {
    return String(phone || "").replace(/[\s\-()]/g, "").trim();
  }

  // Signup form's mobile field only collects the local-format digits (the +64
  // prefix is a fixed, non-editable UI element) — this turns "021 123 4567" or
  // "21 123 4567" into "+64211234567" before it ever reaches the API.
  function nzLocalToE164(localRaw) {
    const digits = String(localRaw || "").replace(/\D/g, "").replace(/^0+/, "");
    return digits ? `+64${digits}` : "";
  }

  function signupPhoneE164(signupForm) {
    return nzLocalToE164(signupForm.elements.phoneLocal.value);
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

  async function sendOtp(signupForm, isResend) {
    const status = $("#signup-status");
    const phoneNumber = signupPhoneE164(signupForm);
    if (!/^\+64\d{7,10}$/.test(phoneNumber)) {
      setStatus(status, "Enter a valid New Zealand mobile number.", "error");
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
    const phoneNumber = signupPhoneE164(signupForm);
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

  // ── Signup ────────────────────────────────────────────────────────────────
  function selectedProfilePicture(form) {
    const input = form.elements.profilePicture;
    if (!input || !input.files || input.files.length === 0) return null;
    return input.files[0];
  }

  async function uploadProfilePicture(token, file) {
    return uploadWithFallback("/upload/profile-picture", token, file);
  }

  function setProviderProfileDiscipline(discipline, otherDiscipline) {
    const select = $("#profile-discipline-select");
    const field = $("#profile-discipline-other-field");
    if (!select || !field) return;
    const input = field.querySelector("input");
    select.value = discipline || "";
    const showOther = select.value === "other";
    field.hidden = !showOther;
    if (input) {
      input.required = showOther;
      input.value = showOther ? (otherDiscipline || "") : "";
    }
  }

  function fillProviderProfileForm(user) {
    const form = $("#provider-profile-form");
    if (!form) return;
    form.elements.fullName.value = user.fullName || "";
    form.elements.phone.value = user.phoneNumber || "";
    form.elements.primaryLanguage.value = user.primaryLanguage || (user.languages && user.languages[0]) || "";
    form.elements.secondaryLanguage.value = user.secondaryLanguage || (user.languages && user.languages[1]) || "";
    form.elements.companyName.value = user.companyName || "";
    form.elements.nzCompanyRegisterNumber.value = user.nzCompanyRegisterNumber || "";
    setProviderProfileDiscipline(user.discipline || "", user.otherDiscipline || "");
    form.elements.contactNumber.value = user.contactNumber || user.phoneNumber || "";
    form.elements.bio.value = user.bio || "";
    form.elements.addressStreet.value = user.addressStreet || "";
    form.elements.addressSuburb.value = user.addressSuburb || "";
    form.elements.addressCity.value = user.addressCity || "";
    form.elements.addressPostcode.value = user.addressPostcode || "";
    if (form.elements.profilePicture) form.elements.profilePicture.value = "";
  }

  async function handleProviderProfileSave(event) {
    event.preventDefault();
    const session = getSession();
    const status = $("#provider-profile-status");
    if (!session) {
      showAuth();
      return;
    }
    const form = event.currentTarget;
    const values = formValues(form);
    const phoneNumber = normalizeNzPhone(values.phone);
    const contactNumber = normalizeNzPhone(values.contactNumber || values.phone);
    if (!/^\+64\d{7,10}$/.test(phoneNumber)) {
      setStatus(status, "Enter a valid New Zealand mobile number starting with +64.", "error");
      return;
    }
    if (contactNumber && !/^\+64\d{7,10}$/.test(contactNumber)) {
      setStatus(status, "Enter a valid New Zealand contact number starting with +64.", "error");
      return;
    }
    const discipline = String(values.discipline || "").trim();
    const otherDiscipline = String(values.otherDiscipline || "").trim();
    if (discipline === "other" && !otherDiscipline) {
      setStatus(status, "Please describe your discipline.", "error");
      return;
    }
    const payload = {
      fullName: String(values.fullName || "").trim(),
      phoneNumber,
      primaryLanguage: String(values.primaryLanguage || "").trim(),
      secondaryLanguage: String(values.secondaryLanguage || "").trim(),
      companyName: String(values.companyName || "").trim(),
      nzCompanyRegisterNumber: String(values.nzCompanyRegisterNumber || "").trim(),
      discipline,
      otherDiscipline,
      contactNumber: contactNumber || phoneNumber,
      bio: String(values.bio || "").trim(),
      addressStreet: String(values.addressStreet || "").trim(),
      addressSuburb: String(values.addressSuburb || "").trim(),
      addressCity: String(values.addressCity || "").trim(),
      addressPostcode: String(values.addressPostcode || "").trim(),
    };
    if (!payload.fullName || !payload.primaryLanguage || !payload.companyName || !payload.nzCompanyRegisterNumber || !payload.discipline) {
      setStatus(status, "Complete the required profile fields before saving.", "error");
      return;
    }

    setStatus(status, "Saving your profile...", null);
    try {
      const data = await api("/auth/service-provider-web-profile", {
        method: "PATCH",
        token: session.token,
        body: payload,
      });
      let user = data.user;
      const picture = selectedProfilePicture(form);
      if (picture) {
        setStatus(status, "Profile saved. Updating your photo...", null);
        const uploaded = await uploadProfilePicture(session.token, picture);
        user = { ...user, avatarUrl: uploaded.fileUrl };
      }
      saveSession(session.token, user);
      fillProviderProfileForm(user);
      showDashboard(user);
      switchProviderMode("manage");
      switchManagePanel("profile");
      setStatus(status, "Your provider profile has been saved.", "success");
    } catch (error) {
      setStatus(status, getErrorMessage(error, "We couldn't save your profile. Please try again."), "error");
    }
  }

  async function handleSignup(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const status = $("#signup-status");
    const values = formValues(form);

    const phoneNumber = nzLocalToE164(values.phoneLocal);
    if (!/^\+64\d{7,10}$/.test(phoneNumber)) {
      setStatus(status, "Enter a valid New Zealand mobile number.", "error");
      return;
    }
    if (!state.phoneVerificationToken || state.verifiedPhone !== phoneNumber) {
      setStatus(status, "Please verify your mobile number before creating your account.", "error");
      return;
    }

    const fullName = String(values.fullName || "").trim();
    const email = String(values.email || "").trim();
    const password = String(values.password || "");
    const primaryLanguage = String(values.primaryLanguage || "").trim();
    const secondaryLanguage = String(values.secondaryLanguage || "").trim();
    const companyName = String(values.companyName || "").trim();
    const nzCompanyRegisterNumber = String(values.nzCompanyRegisterNumber || "").trim();
    const discipline = String(values.discipline || "").trim();
    const otherDiscipline = String(values.otherDiscipline || "").trim();

    if (!companyName) {
      setStatus(status, "Enter your company name.", "error");
      return;
    }
    if (!nzCompanyRegisterNumber) {
      setStatus(status, "Enter your NZ Companies Register number.", "error");
      return;
    }
    if (!discipline) {
      setStatus(status, "Choose your discipline.", "error");
      return;
    }
    if (discipline === "other" && !otherDiscipline) {
      setStatus(status, "Please describe your discipline.", "error");
      return;
    }
    if (!primaryLanguage) {
      setStatus(status, "Choose your preferred language.", "error");
      return;
    }

    const addressStreet = String(values.addressStreet || "").trim();
    const addressSuburb = String(values.addressSuburb || "").trim();
    const addressCity = String(values.addressCity || "").trim();
    const addressPostcode = String(values.addressPostcode || "").trim();

    const payload = {
      fullName,
      email,
      password,
      phoneNumber,
      phoneVerificationToken: state.phoneVerificationToken,
      primaryLanguage,
      companyName,
      nzCompanyRegisterNumber,
      discipline,
    };
    if (discipline === "other") payload.otherDiscipline = otherDiscipline;
    if (secondaryLanguage) payload.secondaryLanguage = secondaryLanguage;
    if (addressStreet) payload.addressStreet = addressStreet;
    if (addressSuburb) payload.addressSuburb = addressSuburb;
    if (addressCity) payload.addressCity = addressCity;
    if (addressPostcode) payload.addressPostcode = addressPostcode;

    // Details are valid — confirm T&C consent before creating the account.
    state.pendingSignupPayload = payload;
    state.pendingSignupForm = form;
    setStatus(status, "", null);
    openConsentModal();
  }

  // ── T&C consent modal ──────────────────────────────────────────────────────
  function openConsentModal() {
    const panel = $("#consent-panel");
    if (!panel) {
      void submitSignup();
      return;
    }
    const checkbox = $("#consent-checkbox");
    const btn = $("#consent-confirm-button");
    if (checkbox) checkbox.checked = false;
    if (btn) btn.disabled = true;
    setStatus($("#consent-status"), "", null);
    panel.hidden = false;
    const card = panel.querySelector(".portal-consent-card");
    if (card) card.scrollTop = 0;
    if (btn) setTimeout(() => btn.focus(), 50);
  }

  function closeConsentModal() {
    const panel = $("#consent-panel");
    if (panel) panel.hidden = true;
    setStatus($("#consent-status"), "", null);
  }

  function consentAndProceed() {
    const checkbox = $("#consent-checkbox");
    if (!checkbox || !checkbox.checked) {
      setStatus($("#consent-status"), "Please tick the checkbox to confirm you have read and agreed.", "error");
      return;
    }
    closeConsentModal();
    openPaywall();
  }

  // ── Paywall ───────────────────────────────────────────────────────────────
  function openPaywall() {
    const panel = $("#paywall-panel");
    if (!panel) return;
    setStatus($("#paywall-status"), "", null);
    switchPaywallMode("subscribe");
    const code = $("#paywall-invite-code");
    if (code) code.value = "";
    panel.hidden = false;
    panel.querySelector(".portal-paywall-card")?.scrollTo?.(0, 0);
  }

  function closePaywall() {
    const panel = $("#paywall-panel");
    if (panel) panel.hidden = true;
    setStatus($("#paywall-status"), "", null);
  }

  function switchPaywallMode(mode) {
    $$(".paywall-toggle-btn").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.paywallMode === mode);
    });
    $$("[data-paywall-pane]").forEach((pane) => {
      pane.hidden = pane.dataset.paywallPane !== mode;
    });
  }

  async function submitPaywallInvite() {
    const status = $("#paywall-status");
    const code = String($("#paywall-invite-code")?.value || "").trim();
    if (!code) {
      setStatus(status, "Enter your invitation code.", "error");
      return;
    }
    if (!state.pendingSignupPayload) {
      setStatus(status, "Please restart your signup.", "error");
      return;
    }
    const btn = $("#paywall-invite-button");
    if (btn) btn.disabled = true;
    setStatus(status, "Completing registration…", null);
    try {
      const data = await api("/auth/service-provider-web-signup", {
        method: "POST",
        body: { ...state.pendingSignupPayload, invitationCode: code },
      });
      let user = data.user;
      const picture = state.pendingSignupForm ? selectedProfilePicture(state.pendingSignupForm) : null;
      if (picture) {
        try {
          const uploaded = await uploadProfilePicture(data.token, picture);
          user = { ...user, avatarUrl: uploaded.fileUrl };
        } catch {
          // Non-fatal; photo can be added later in the app.
        }
      }
      closePaywall();
      saveSession(data.token, user);
      showDashboard(user);
    } catch (error) {
      if (btn) btn.disabled = false;
      if (error && error.code === "INVITATION_OR_SUBSCRIPTION_REQUIRED") {
        setStatus(status, "That invitation code isn't valid. Check it and try again, or subscribe.", "error");
        return;
      }
      setStatus(status, getErrorMessage(error, "We couldn't complete registration. Please try again."), "error");
    }
  }

  async function submitPaywallSubscribe() {
    const status = $("#paywall-status");
    if (!state.pendingSignupPayload) {
      setStatus(status, "Please restart your signup.", "error");
      return;
    }
    const btn = $("#paywall-subscribe-button");
    if (btn) btn.disabled = true;
    setStatus(status, "Preparing checkout…", null);
    try {
      const data = await api("/auth/service-provider-web-signup/checkout", {
        method: "POST",
        body: state.pendingSignupPayload,
      });
      window.location.href = data.checkoutUrl;
    } catch (error) {
      if (btn) btn.disabled = false;
      setStatus(status, getErrorMessage(error, "We couldn't start checkout. Please try again."), "error");
    }
  }

  async function handleStripeReturn(sessionId) {
    const authSection = $("#portal-auth");
    const hero = $(".portal-hero");
    if (authSection) authSection.hidden = true;
    if (hero) hero.hidden = true;
    const dash = $("#portal-dashboard");
    if (dash) {
      const summary = $("#dashboard-summary");
      if (summary) summary.textContent = "Completing your registration…";
      dash.hidden = false;
    }
    try {
      const data = await api("/auth/service-provider-web-signup/claim", {
        method: "POST",
        body: { checkoutSessionId: sessionId },
      });
      saveSession(data.token, data.user);
      showDashboard(data.user);
      window.history.replaceState({}, "", window.location.pathname);
    } catch (error) {
      if (authSection) authSection.hidden = false;
      if (hero) hero.hidden = false;
      if (dash) dash.hidden = true;
      const loginStatus = $("#login-status");
      setStatus(
        loginStatus,
        getErrorMessage(error, "We couldn't complete your registration. Please sign in or contact support."),
        "error",
      );
      switchTab("login");
    }
  }

  // ── Login ────────────────────────────────────────────────────────────────
  async function handleLogin(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const status = $("#login-status");
    const values = formValues(form);
    setStatus(status, "Signing you in...", null);
    try {
      const data = await api("/auth/service-provider-login", {
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
      if (error && error.code === "SERVICE_PROVIDER_REQUIRED") {
        setStatus(
          status,
          "This portal is for service providers. If you have a different account type, please use the Project Alpha app.",
          "error",
        );
        return;
      }
      setStatus(status, getErrorMessage(error, "We couldn't sign you in. Check your email and password."), "error");
    }
  }

  // ── Password reset (shared backend with the sales portal) ────────────────
  function openReset() {
    const form = $("#password-reset-form");
    const loginEmail = $("#provider-login-form input[name='email']");
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
      const loginEmail = $("#provider-login-form input[name='email']");
      if (loginEmail) loginEmail.value = email;
      window.setTimeout(() => {
        closeReset();
        switchTab("login");
      }, 1400);
    } catch (error) {
      setStatus(status, getErrorMessage(error, "We couldn't reset your password. Please try again."), "error");
    }
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  function init() {
    $$(".portal-tab").forEach((tab) => {
      tab.addEventListener("click", () => switchTab(tab.dataset.tabTarget));
    });

    const signupForm = $("#provider-signup-form");
    signupForm.addEventListener("submit", handleSignup);
    signupForm.elements.phoneLocal.addEventListener("input", () => {
      if (state.verifiedPhone && signupPhoneE164(signupForm) !== state.verifiedPhone) {
        resetPhoneVerification();
      }
    });
    $("#send-otp-button").addEventListener("click", () => sendOtp(signupForm, false));
    $("#resend-otp-button").addEventListener("click", () => sendOtp(signupForm, true));
    $("#verify-otp-button").addEventListener("click", () => verifyOtp(signupForm));

    $("#discipline-select").addEventListener("change", (event) => {
      const showOther = event.currentTarget.value === "other";
      const field = $("#discipline-other-field");
      field.hidden = !showOther;
      const input = field.querySelector("input");
      if (input) {
        input.required = showOther;
        if (!showOther) input.value = "";
      }
    });
    $("#profile-discipline-select")?.addEventListener("change", (event) => {
      setProviderProfileDiscipline(event.currentTarget.value, $("#profile-discipline-other-field input")?.value || "");
    });

    $("#provider-login-form").addEventListener("submit", handleLogin);
    $("#provider-profile-form")?.addEventListener("submit", handleProviderProfileSave);
    $$("[data-reset-open]").forEach((button) => button.addEventListener("click", openReset));
    $$("[data-reset-close]").forEach((button) => button.addEventListener("click", closeReset));
    $("#request-reset-button").addEventListener("click", () => requestReset(false));
    $("#resend-reset-button").addEventListener("click", () => requestReset(true));
    $("#password-reset-form").addEventListener("submit", confirmReset);

    $("#signout-button").addEventListener("click", () => {
      clearSession();
      showAuth();
    });
    $$("[data-provider-mode]").forEach((button) => {
      button.addEventListener("click", () => switchProviderMode(button.dataset.providerMode));
    });
    $$("[data-provider-manage-panel]").forEach((button) => {
      button.addEventListener("click", () => switchManagePanel(button.dataset.providerManagePanel));
    });
    const messageForm = $("#provider-message-form");
    if (messageForm) messageForm.addEventListener("submit", sendDmMessage);
    const messageInput = $("#provider-message-input");
    if (messageInput) {
      messageInput.addEventListener("input", updateDmSendState);
      messageInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          if (!$("#provider-message-send")?.disabled) {
            messageForm?.requestSubmit();
          }
        }
      });
    }
    const attachButton = $("#provider-message-attach");
    const photoInput = $("#provider-message-photo");
    if (attachButton && photoInput) {
      attachButton.addEventListener("click", () => photoInput.click());
      photoInput.addEventListener("change", () => {
        const files = Array.from(photoInput.files || []);
        photoInput.value = "";
        if (!files.length) return;
        openDmAttachmentConfirm(files);
      });
    }
    $$("[data-attachment-close]").forEach((button) => button.addEventListener("click", closeDmAttachmentConfirm));
    $("#provider-attachment-confirm")?.addEventListener("click", () => {
      void confirmDmAttachments();
    });
    $("#provider-thread-search")?.addEventListener("input", renderDmThreads);
    $("#provider-call-link")?.addEventListener("click", revealSelectedPhone);
    $("#provider-message-back")?.addEventListener("click", () => {
      state.dmSelectedThreadId = null;
      state.dmMessages = [];
      state.dmSelectedProfile = null;
      state.dmNextCursor = null;
      state.dmRevealedPhoneUserId = null;
      renderDmThreads();
      renderSelectedDmThread();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") void refreshDmInbox();
    });
    window.addEventListener("focus", () => {
      void refreshDmInbox();
    });

    $$("[data-consent-close]").forEach((button) => button.addEventListener("click", closeConsentModal));
    const consentCheckbox = $("#consent-checkbox");
    if (consentCheckbox) {
      consentCheckbox.addEventListener("change", () => {
        const btn = $("#consent-confirm-button");
        if (btn) btn.disabled = !consentCheckbox.checked;
      });
    }
    const consentConfirmBtn = $("#consent-confirm-button");
    if (consentConfirmBtn) consentConfirmBtn.addEventListener("click", consentAndProceed);

    $$("[data-paywall-close]").forEach((button) => button.addEventListener("click", closePaywall));
    $$(".paywall-toggle-btn").forEach((btn) => btn.addEventListener("click", () => switchPaywallMode(btn.dataset.paywallMode)));
    const subscribeBtn = $("#paywall-subscribe-button");
    if (subscribeBtn) subscribeBtn.addEventListener("click", () => { void submitPaywallSubscribe(); });
    const inviteBtn = $("#paywall-invite-button");
    if (inviteBtn) inviteBtn.addEventListener("click", () => { void submitPaywallInvite(); });

    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (!$("#reset-panel").hidden) closeReset();
      if (!$("#consent-panel")?.hidden) closeConsentModal();
      if (!$("#paywall-panel")?.hidden) closePaywall();
      if (!$("#provider-attachment-panel")?.hidden) closeDmAttachmentConfirm();
    });

    // Handle return from Stripe Checkout.
    const params = new URLSearchParams(window.location.search);
    const stripeSignupStatus = params.get("providerSignup");
    const stripeSubscriptionStatus = params.get("providerSubscription");
    const stripeSessionId = params.get("session_id");
    let handlingStripeReturn = false;
    if (stripeSignupStatus === "success" && stripeSessionId) {
      handlingStripeReturn = true;
      void handleStripeReturn(stripeSessionId);
    } else if (stripeSubscriptionStatus === "success" && stripeSessionId) {
      handlingStripeReturn = true;
      void handleProviderSubscriptionReturn(stripeSessionId);
    } else if (stripeSignupStatus === "cancelled") {
      window.history.replaceState({}, "", window.location.pathname);
    } else if (stripeSubscriptionStatus === "cancelled") {
      window.history.replaceState({}, "", window.location.pathname);
    }

    if (handlingStripeReturn) return;

    // Resume a stored session if the token still belongs to a service provider.
    const session = getSession();
    if (!session) {
      showAuth();
      return;
    }
    api("/auth/me", { method: "GET", token: session.token })
      .then((data) => {
        if (data.user && (data.user.role === "service_provider" || data.user.discipline || data.user.companyName)) {
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
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
