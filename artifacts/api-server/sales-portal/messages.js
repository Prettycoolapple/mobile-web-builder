(function () {
  const API_BASE = "/api";
  const TOKEN_KEY = "projectAlphaSalesPortalToken";
  const USER_KEY = "projectAlphaSalesPortalUser";
  const state = {
    threads: [],
    messages: [],
    selectedId: null,
    nextCursor: null,
    profile: null,
    sending: false,
    loading: false,
    files: [],
    socket: null,
    socketConnected: false,
    pollTimer: null,
    pendingTag: null,
  };

  const $ = (selector) => document.querySelector(selector);
  const token = () => localStorage.getItem(TOKEN_KEY);
  function currentUser() {
    try { return JSON.parse(localStorage.getItem(USER_KEY) || "{}"); } catch { return {}; }
  }

  function setStatus(message, type) {
    const el = $("#sales-dm-status");
    if (!el) return;
    el.textContent = message || "";
    el.classList.remove("error", "success");
    if (type) el.classList.add(type);
  }

  async function api(path, options) {
    const response = await fetch(`${API_BASE}${path}`, {
      headers: {
        "Content-Type": "application/json",
        ...(options?.token ? { Authorization: `Bearer ${options.token}` } : {}),
      },
      ...options,
      body: options?.body ? JSON.stringify(options.body) : undefined,
    });
    let payload = null;
    try { payload = await response.json(); } catch {}
    if (!response.ok) {
      const error = new Error(payload?.error || "Request failed. Please try again.");
      error.code = payload?.code;
      throw error;
    }
    return payload;
  }

  async function uploadMultipart(path, file) {
    const body = new FormData();
    body.append("file", file);
    const response = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token()}` },
      body,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.error || "Upload failed. Please try again.");
    return payload;
  }

  async function uploadAttachment(file) {
    const isImage = /^image\//i.test(file.type || "");
    const base = isImage ? "/upload/dm-image" : "/upload/dm-file";
    try {
      const signed = await api(`${base}/request-url`, {
        method: "POST",
        token: token(),
        body: { name: file.name || "attachment", size: file.size, contentType: file.type || "application/octet-stream" },
      });
      const upload = await fetch(signed.uploadURL, {
        method: "PUT",
        headers: signed.requiredHeaders || { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!upload.ok) throw new Error("Upload failed");
      const completed = await api(`${base}/complete`, {
        method: "POST",
        token: token(),
        body: { objectPath: signed.objectPath },
      });
      return completed;
    } catch {
      return uploadMultipart(base, file);
    }
  }

  function initials(name) {
    return String(name || "Project Alpha").split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  }

  function avatar(el, participant) {
    if (!el) return;
    el.replaceChildren();
    if (participant?.avatarUrl) {
      const image = document.createElement("img");
      image.src = participant.avatarUrl;
      image.alt = "";
      el.appendChild(image);
    } else {
      el.textContent = initials(participant?.fullName);
    }
  }

  function selectedThread() {
    return state.threads.find((thread) => thread.id === state.selectedId) || null;
  }

  function preview(message) {
    if (!message) return "No messages yet";
    if (message.body) return message.body;
    if (message.fileUrl) return message.fileName || "PDF document";
    if (message.imageUrl) return "Photo";
    return "Message";
  }

  function formatTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }

  async function openMessageFile(message) {
    if (!message.fileUrl || message.fileUrl === "#") return;
    if (!message.fileUrl.startsWith("/api/storage")) {
      window.open(message.fileUrl, "_blank", "noopener");
      await api(`/dm/threads/${encodeURIComponent(message.threadId || state.selectedId)}/messages/${encodeURIComponent(message.id)}/file-viewed`, {
        method: "POST", token: token(),
      }).catch(() => null);
      return;
    }
    try {
      const response = await fetch(message.fileUrl, {
        headers: { Authorization: `Bearer ${token()}` },
      });
      if (!response.ok) throw new Error("Could not open this file.");
      const blobUrl = URL.createObjectURL(await response.blob());
      window.open(blobUrl, "_blank", "noopener");
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
      await api(`/dm/threads/${encodeURIComponent(message.threadId || state.selectedId)}/messages/${encodeURIComponent(message.id)}/file-viewed`, {
        method: "POST", token: token(),
      }).catch(() => null);
    } catch (error) { setStatus(error.message, "error"); }
  }

  function isWaitingOnLimTitle(thread) {
    return (thread.leads || []).reduce((count, lead) => {
      if (lead.status !== "connected") return count;
      return count + (lead.requestedDocuments || []).filter((docType) => !lead.delivered?.[docType]).length;
    }, 0);
  }

  function updateNavUnread() {
    const count = state.threads.reduce((sum, thread) => sum + isWaitingOnLimTitle(thread), 0);
    const el = $("#sales-dm-nav-unread");
    if (!el) return;
    el.hidden = count === 0;
    el.textContent = count ? `(${count})` : "";
  }

  function renderThreads() {
    const root = $("#sales-dm-thread-list");
    if (!root) return;
    root.replaceChildren();
    const query = String($("#sales-dm-search")?.value || "").trim().toLowerCase();
    const threads = state.threads.filter((thread) => {
      const who = thread.otherParticipant;
      return !query || `${who?.fullName || ""} ${(thread.leads || []).map((lead) => lead.propertyAddress).join(" ")} ${preview(thread.lastMessage)}`.toLowerCase().includes(query);
    });
    if (!threads.length) {
      const empty = document.createElement("div");
      empty.className = "sales-dm-empty";
      empty.style.padding = "30px 18px";
      empty.textContent = query ? "No conversations match your search." : "No leads have messaged you yet.";
      root.appendChild(empty);
      updateNavUnread();
      return;
    }
    for (const thread of threads) {
      const person = thread.otherParticipant;
      const button = document.createElement("button");
      button.type = "button";
      button.className = `sales-dm-thread${thread.id === state.selectedId ? " is-active" : ""}`;
      const av = document.createElement("span");
      av.className = "sales-dm-avatar";
      avatar(av, person);
      const copy = document.createElement("span");
      copy.className = "sales-dm-thread-copy";
      const name = document.createElement("span");
      name.className = "sales-dm-thread-name";
      name.textContent = person?.fullName || "Project Alpha user";
      const last = document.createElement("span");
      last.className = "sales-dm-thread-preview";
      last.textContent = thread.leadSummary?.propertyAddress || preview(thread.lastMessage);
      copy.append(name, last);
      button.append(av, copy);
      if (thread.unreadCount) {
        const unread = document.createElement("span");
        unread.className = "sales-dm-unread";
        unread.textContent = thread.unreadCount > 99 ? "99+" : String(thread.unreadCount);
        button.appendChild(unread);
      }
      button.addEventListener("click", () => selectThread(thread.id));
      root.appendChild(button);
    }
    updateNavUnread();
  }

  function messageContent(message) {
    const bubble = document.createElement("div");
    bubble.className = "sales-dm-bubble";
    if (message.messageKind === "lim_title_request") {
      bubble.classList.add("sales-dm-lead-card");
      const heading = document.createElement("strong");
      heading.textContent = "LIM + Title lead";
      bubble.appendChild(heading);
      const lead = (selectedThread()?.leads || []).find((item) => item.id === message.leadRequestId);
      if (lead && message.senderId !== currentUser().id) {
        const actions = document.createElement("div");
        actions.className = "sales-dm-document-actions";
        for (const [label, documentType] of [["Attach LIM", "lim_report"], ["Attach Title", "title"]]) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "button button-quiet";
          button.textContent = label;
          button.addEventListener("click", () => {
            state.pendingTag = { leadRequestId: lead.id, documentType, linkMethod: "card_upload" };
            $("#sales-dm-file-input")?.click();
          });
          actions.appendChild(button);
        }
        bubble.appendChild(actions);
      }
    }
    if (message.body) {
      const body = document.createElement("p");
      body.textContent = message.body;
      bubble.appendChild(body);
    }
    if (message.imageUrl) {
      const image = document.createElement("img");
      image.src = message.imageUrl;
      image.alt = message.fileName || "Chat attachment";
      image.loading = "lazy";
      bubble.appendChild(image);
    }
    if (message.fileUrl) {
      const file = document.createElement("a");
      file.className = "sales-dm-file";
      file.href = message.fileUrl === "#" ? "#" : message.fileUrl;
      file.addEventListener("click", (event) => {
        event.preventDefault();
        void openMessageFile(message);
      });
      file.textContent = message.fileName || "Open PDF document";
      bubble.appendChild(file);
      if (message.messageKind === "lim_title_document") {
        const label = document.createElement("span");
        label.className = "sales-dm-document-link";
        const meta = message.metadataJson || {};
        label.textContent = `${meta.docType === "lim_report" ? "LIM" : meta.docType === "title" ? "Title" : "LIM + Title"} · ${meta.propertyAddress || "Linked property"}`;
        bubble.appendChild(label);
        if (message.senderId === currentUser().id && !message.pending) {
          const change = document.createElement("button");
          change.type = "button";
          change.className = "sales-dm-change-link";
          change.textContent = "Change";
          change.addEventListener("click", () => changeDocumentTag(message));
          bubble.appendChild(change);
        }
      }
    }
    const time = document.createElement("span");
    time.className = "sales-dm-time";
    // Explicit delivery state on the agent's own messages. File-opened takes
    // priority over the conversation-level read receipt.
    let receipt = "";
    if (!message.pending && message.senderId === currentUser().id) {
      if (message.fileUrl && message.fileViewedAt) receipt = " · File opened";
      else if (message.readAt) receipt = " · Read";
      else receipt = " · Sent";
    }
    time.textContent = message.pending ? "Sending..." : `${formatTime(message.createdAt)}${receipt}`;
    bubble.appendChild(time);
    return bubble;
  }

  function renderMessages(preserveScroll) {
    const root = $("#sales-dm-list");
    if (!root) return;
    const previousBottom = root.scrollHeight - root.scrollTop;
    root.replaceChildren();
    if (!state.selectedId) {
      const empty = document.createElement("div");
      empty.className = "sales-dm-empty";
      empty.textContent = "Select a conversation to view and reply to messages.";
      root.appendChild(empty);
      updateComposer();
      return;
    }
    if (state.nextCursor) {
      const more = document.createElement("button");
      more.type = "button";
      more.className = "button button-quiet sales-dm-load-more";
      more.textContent = "Load older messages";
      more.addEventListener("click", loadOlder);
      root.appendChild(more);
    }
    for (const message of state.messages) {
      const row = document.createElement("div");
      const mine = message.senderId === currentUser().id;
      row.className = `sales-dm-row${mine ? " is-mine" : ""}`;
      const like = document.createElement("button");
      like.type = "button";
      like.className = `sales-dm-like${message.likedAt ? " is-liked" : ""}`;
      like.textContent = "♥";
      like.title = message.likedAt ? "Unlike message" : "Like message";
      like.disabled = !!message.pending;
      like.addEventListener("click", () => toggleLike(message));
      row.append(messageContent(message), like);
      root.appendChild(row);
    }
    if (!state.messages.length) {
      const empty = document.createElement("div");
      empty.className = "sales-dm-empty";
      empty.textContent = "No messages in this conversation yet.";
      root.appendChild(empty);
    }
    if (preserveScroll) root.scrollTop = Math.max(0, root.scrollHeight - previousBottom);
    else root.scrollTop = root.scrollHeight;
    updateComposer();
  }

  function renderHeader() {
    const thread = selectedThread();
    const person = thread?.otherParticipant;
    $("#sales-dm-active-name").textContent = person?.fullName || "Select a conversation";
    $("#sales-dm-active-meta").textContent = thread?.leadSummary?.propertyAddress || "Project Alpha user";
    avatar($("#sales-dm-active-avatar"), person);
    $("#sales-dm-shell")?.classList.toggle("has-active-thread", !!thread);
    const blocked = !!thread?.blockStatus?.messagingBlocked;
    $("#sales-dm-blocked")?.classList.toggle("is-visible", blocked);
    const block = $("#sales-dm-block");
    const report = $("#sales-dm-report");
    const call = $("#sales-dm-call");
    const emailButton = $("#sales-dm-email");
    if (block) { block.hidden = !thread; block.textContent = thread?.blockStatus?.iBlockedThem ? "Unblock" : "Block"; }
    if (report) report.hidden = !thread;
    const phone = state.profile?.roleData?.contactNumber;
    const email = state.profile?.roleData?.contactEmail;
    if (call) { call.hidden = !thread || !phone; call.textContent = phone && call.dataset.revealed === "1" ? phone : "Show phone"; }
    if (emailButton) { emailButton.hidden = !thread || !email; emailButton.textContent = email && emailButton.dataset.revealed === "1" ? email : "Show email"; }
    updateComposer();
  }

  function updateComposer() {
    const thread = selectedThread();
    const disabled = !thread || state.loading || state.sending || !!thread?.blockStatus?.messagingBlocked;
    const input = $("#sales-dm-input");
    const send = $("#sales-dm-send");
    const attach = $("#sales-dm-attach");
    if (input) input.disabled = disabled;
    if (attach) attach.disabled = disabled;
    if (send) send.disabled = disabled || !String(input?.value || "").trim();
  }

  async function loadThreads(quiet) {
    if (!token()) return;
    const root = $("#sales-dm-thread-list");
    if (!quiet && root) root.innerHTML = '<div class="sales-dm-empty" style="padding:30px 18px">Loading conversations...</div>';
    try {
      const data = await api("/dm/threads", { method: "GET", token: token() });
      state.threads = (data.threads || []).filter((thread) => thread.otherParticipant?.role === "general");
      if (state.selectedId && !state.threads.some((thread) => thread.id === state.selectedId)) state.selectedId = null;
      renderThreads();
      renderHeader();
    } catch (error) {
      if (root) root.innerHTML = `<div class="sales-dm-empty" style="padding:30px 18px"></div>`;
      if (root?.firstChild) root.firstChild.textContent = error.message;
    }
  }

  async function selectThread(id) {
    state.selectedId = id;
    state.profile = null;
    state.messages = [];
    state.nextCursor = null;
    const thread = selectedThread();
    if (thread) thread.unreadCount = 0;
    renderThreads();
    renderHeader();
    state.loading = true;
    updateComposer();
    try {
      const [data, profile] = await Promise.all([
        api(`/dm/threads/${encodeURIComponent(id)}/messages?limit=30`, { method: "GET", token: token() }),
        thread?.otherParticipant?.id
          ? api(`/users/${encodeURIComponent(thread.otherParticipant.id)}`, { method: "GET", token: token() }).catch(() => null)
          : Promise.resolve(null),
      ]);
      state.messages = [...(data.messages || [])].reverse();
      state.nextCursor = data.nextCursor || null;
      state.profile = profile;
      if (thread && data.blockStatus) thread.blockStatus = data.blockStatus;
      await api(`/dm/threads/${encodeURIComponent(id)}/read`, { method: "PATCH", token: token() }).catch(() => null);
    } catch (error) {
      setStatus(error.message, "error");
    } finally {
      state.loading = false;
      renderHeader();
      renderMessages();
    }
  }

  async function loadOlder() {
    if (!state.selectedId || !state.nextCursor || state.loading) return;
    state.loading = true;
    try {
      const data = await api(`/dm/threads/${encodeURIComponent(state.selectedId)}/messages?limit=30&cursor=${encodeURIComponent(state.nextCursor)}`, { method: "GET", token: token() });
      state.messages = [...(data.messages || [])].reverse().concat(state.messages);
      state.nextCursor = data.nextCursor || null;
      renderMessages(true);
    } catch (error) { setStatus(error.message, "error"); }
    finally { state.loading = false; updateComposer(); }
  }

  async function sendText(event) {
    event.preventDefault();
    const input = $("#sales-dm-input");
    const body = String(input?.value || "").trim();
    if (!body || !state.selectedId || state.sending) return;
    const local = { id: `local-${Date.now()}`, senderId: currentUser().id, body, createdAt: new Date().toISOString(), pending: true };
    state.messages.push(local);
    input.value = "";
    state.sending = true;
    renderMessages();
    try {
      const data = await api(`/dm/threads/${encodeURIComponent(state.selectedId)}/messages`, { method: "POST", token: token(), body: { body } });
      state.messages = state.messages.map((message) => message.id === local.id ? data.message : message);
      await loadThreads(true);
      setStatus("");
    } catch (error) {
      state.messages = state.messages.filter((message) => message.id !== local.id);
      input.value = body;
      setStatus(error.message, "error");
    } finally { state.sending = false; renderMessages(); }
  }

  async function toggleLike(message) {
    if (!state.selectedId || message.pending) return;
    const previous = { likedAt: message.likedAt, likedBy: message.likedBy };
    message.likedAt = message.likedAt ? null : new Date().toISOString();
    message.likedBy = message.likedAt ? currentUser().id : null;
    renderMessages(true);
    try {
      const data = await api(`/dm/threads/${encodeURIComponent(state.selectedId)}/messages/${encodeURIComponent(message.id)}/like`, {
        method: "POST", token: token(), body: { liked: !!message.likedAt },
      });
      Object.assign(message, data.message);
    } catch (error) { Object.assign(message, previous); setStatus(error.message, "error"); }
    renderMessages(true);
  }

  function renderPendingFiles() {
    const panel = $("#sales-dm-attachments");
    const list = $("#sales-dm-attachment-list");
    if (!panel || !list) return;
    panel.hidden = !state.files.length;
    list.replaceChildren();
    for (const file of state.files) {
      const item = document.createElement("div");
      item.textContent = `${file.type === "application/pdf" ? "PDF" : "Image"}: ${file.name} (${Math.max(1, Math.round(file.size / 1024))} KB)`;
      list.appendChild(item);
    }
    $("#sales-dm-confirm-files").textContent = state.files.length === 1 ? "Send file" : `Send ${state.files.length} files`;
  }

  function openTagSheet(leads, initial) {
    return new Promise((resolve) => {
      let selection = initial || (leads.length === 1 ? {
        leadRequestId: leads[0].id,
        documentType: leads[0].delivered?.lim_report ? "title" : "lim_report",
        linkMethod: "auto_single_open",
      } : null);
      const overlay = document.createElement("div");
      overlay.className = "sales-dm-tag-overlay";
      const sheet = document.createElement("div");
      sheet.className = "sales-dm-tag-sheet";
      sheet.innerHTML = '<h3>Link this PDF to a property</h3><p>This keeps LIM and title documents with the correct buyer request.</p>';
      const choices = document.createElement("div");
      function renderChoices() {
        choices.replaceChildren();
        for (const lead of leads) {
          const row = document.createElement("div");
          row.className = "sales-dm-tag-row";
          const address = document.createElement("strong");
          address.textContent = lead.propertyAddress;
          row.appendChild(address);
          const chips = document.createElement("div");
          chips.className = "sales-dm-tag-chips";
          for (const [label, documentType] of [["LIM", "lim_report"], ["Title", "title"], ["Both", "combined"]]) {
            const chip = document.createElement("button");
            chip.type = "button";
            chip.textContent = label;
            chip.className = selection?.leadRequestId === lead.id && selection?.documentType === documentType ? "is-selected" : "";
            chip.addEventListener("click", () => {
              selection = { leadRequestId: lead.id, documentType, linkMethod: leads.length === 1 ? "auto_single_open" : "agent_picker" };
              renderChoices();
            });
            chips.appendChild(chip);
          }
          row.appendChild(chips);
          choices.appendChild(row);
        }
      }
      renderChoices();
      sheet.appendChild(choices);
      const actions = document.createElement("div");
      actions.className = "sales-dm-tag-actions";
      const other = document.createElement("button");
      other.type = "button"; other.className = "button button-quiet"; other.textContent = "Other document";
      other.addEventListener("click", () => { overlay.remove(); resolve({ untagged: true }); });
      const cancel = document.createElement("button");
      cancel.type = "button"; cancel.className = "button button-quiet"; cancel.textContent = "Cancel";
      cancel.addEventListener("click", () => { overlay.remove(); resolve(null); });
      const confirm = document.createElement("button");
      confirm.type = "button"; confirm.className = "button button-primary"; confirm.textContent = "Confirm link";
      confirm.addEventListener("click", () => { if (selection) { overlay.remove(); resolve(selection); } });
      actions.append(other, cancel, confirm);
      sheet.appendChild(actions);
      overlay.appendChild(sheet);
      document.body.appendChild(overlay);
    });
  }

  function acceptReuseNotice() {
    const key = `projectAlphaLimTitleReuseNoticeAccepted:${currentUser().id || "agent"}`;
    if (localStorage.getItem(key) === "1") return true;
    const accepted = window.confirm("Documents linked to a property may be securely shared with other interested buyers of that same property. Continue?");
    if (accepted) localStorage.setItem(key, "1");
    return accepted;
  }

  async function changeDocumentTag(message) {
    const leads = (selectedThread()?.leads || []).filter((lead) => lead.status === "connected");
    if (!leads.length) return;
    const selection = await openTagSheet(leads, {
      leadRequestId: message.leadRequestId,
      documentType: message.metadataJson?.docType || "lim_report",
      linkMethod: "agent_picker",
    });
    if (!selection || selection.untagged) return;
    try {
      const data = await api(`/dm/messages/${encodeURIComponent(message.id)}/tag-document`, {
        method: "POST", token: token(), body: selection,
      });
      state.messages = state.messages.map((item) => item.id === message.id ? data.message : item);
      await loadThreads(true);
      renderMessages(true);
    } catch (error) { setStatus(error.message, "error"); }
  }

  async function sendFiles() {
    if (!state.files.length || !state.selectedId || state.sending) return;
    const files = state.files.slice();
    state.files = [];
    renderPendingFiles();
    state.sending = true;
    updateComposer();
    for (const file of files) {
      const image = /^image\//i.test(file.type || "");
      let documentTag = null;
      if (!image && file.type === "application/pdf") {
        const leads = (selectedThread()?.leads || []).filter((lead) => lead.status === "connected" && !lead.delivered?.complete);
        if (state.pendingTag) {
          documentTag = state.pendingTag;
          state.pendingTag = null;
        } else if (leads.length) {
          documentTag = await openTagSheet(leads, null);
          if (!documentTag) continue;
          if (documentTag.untagged) documentTag = null;
        }
        if (documentTag && !acceptReuseNotice()) continue;
      }
      const localUrl = image ? URL.createObjectURL(file) : null;
      const local = {
        id: `local-${Date.now()}-${Math.random()}`,
        senderId: currentUser().id,
        body: null,
        imageUrl: localUrl,
        fileUrl: image ? null : "#",
        fileName: file.name,
        createdAt: new Date().toISOString(),
        pending: true,
      };
      state.messages.push(local);
      renderMessages();
      try {
        setStatus(`Uploading ${file.name}...`);
        const uploaded = await uploadAttachment(file);
        const fileUrl = uploaded.fileUrl;
        const payload = image
          ? { imageUrl: fileUrl }
          : {
              fileUrl,
              objectPath: uploaded.objectPath ?? null,
              fileSize: uploaded.fileSize ?? file.size,
              fileHash: uploaded.fileHash ?? null,
              fileName: file.name || "attachment.pdf",
              fileMime: file.type || "application/pdf",
              ...(documentTag || {}),
            };
        const data = await api(`/dm/threads/${encodeURIComponent(state.selectedId)}/messages`, { method: "POST", token: token(), body: payload });
        if (localUrl) URL.revokeObjectURL(localUrl);
        state.messages = state.messages.map((message) => message.id === local.id ? data.message : message);
      } catch (error) {
        if (localUrl) URL.revokeObjectURL(localUrl);
        state.messages = state.messages.filter((message) => message.id !== local.id);
        setStatus(error.message, "error");
      }
    }
    state.sending = false;
    state.pendingTag = null;
    await loadThreads(true);
    renderMessages();
    if (!$("#sales-dm-status").classList.contains("error")) setStatus("");
  }

  async function toggleBlock() {
    const thread = selectedThread();
    const userId = thread?.otherParticipant?.id;
    if (!thread || !userId) return;
    try {
      if (thread.blockStatus?.iBlockedThem) {
        await api(`/dm/block/${encodeURIComponent(userId)}`, { method: "DELETE", token: token() });
      } else {
        await api("/dm/block", { method: "POST", token: token(), body: { blockedUserId: userId } });
      }
      await loadThreads(true);
      await selectThread(thread.id);
    } catch (error) { setStatus(error.message, "error"); }
  }

  async function reportUser() {
    const thread = selectedThread();
    const userId = thread?.otherParticipant?.id;
    if (!thread || !userId) return;
    const comment = window.prompt("Briefly describe the issue with this conversation.");
    if (!comment) return;
    try {
      await api("/dm/report", { method: "POST", token: token(), body: { reportedUserId: userId, threadId: thread.id, comment } });
      setStatus("Report sent. Thank you.", "success");
    } catch (error) { setStatus(error.message, "error"); }
  }

  function applyIncoming(threadId, message) {
    const thread = state.threads.find((item) => item.id === threadId);
    if (!thread) { loadThreads(true); return; }
    thread.lastMessage = message;
    thread.lastMessageAt = message.createdAt;
    const mine = message.senderId === currentUser().id;
    if (threadId === state.selectedId) {
      const optimisticIndex = state.messages.findIndex((item) => item.pending && item.senderId === message.senderId && item.body === message.body);
      if (optimisticIndex >= 0) state.messages[optimisticIndex] = message;
      else if (!state.messages.some((item) => item.id === message.id)) state.messages.push(message);
      if (!mine) api(`/dm/threads/${encodeURIComponent(threadId)}/read`, { method: "PATCH", token: token() }).catch(() => null);
      renderMessages();
    } else if (!mine) thread.unreadCount = Number(thread.unreadCount || 0) + 1;
    renderThreads();
  }

  function connectSocket() {
    if (state.socket || !token()) return;
    const start = () => {
      if (!window.io || state.socket) return;
      const socket = window.io(window.location.origin, {
        path: `${API_BASE}/socket.io`, auth: { token: token() }, transports: ["websocket", "polling"], reconnection: true,
      });
      state.socket = socket;
      socket.on("connect", () => { state.socketConnected = true; loadThreads(true); });
      socket.on("disconnect", () => { state.socketConnected = false; });
      socket.on("connect_error", () => { state.socketConnected = false; });
      socket.on("new_message", ({ threadId, message }) => applyIncoming(threadId, message));
      socket.on("message_like", ({ threadId, message }) => {
        if (threadId === state.selectedId) {
          state.messages = state.messages.map((item) => item.id === message.id ? message : item);
          renderMessages(true);
        }
      });
      socket.on("message_updated", ({ threadId, message }) => {
        if (threadId === state.selectedId) {
          state.messages = state.messages.map((item) => item.id === message.id ? message : item);
          renderMessages(true);
        }
      });
      socket.on("messages_read", ({ threadId, messageIds, readAt }) => {
        if (threadId !== state.selectedId) return;
        const ids = new Set(messageIds || []);
        state.messages = state.messages.map((item) => ids.has(item.id) && !item.readAt ? { ...item, readAt } : item);
        renderMessages(true);
      });
      socket.on("file_viewed", ({ threadId, message }) => {
        if (threadId === state.selectedId) {
          state.messages = state.messages.map((item) => item.id === message.id ? message : item);
          renderMessages(true);
        }
      });
    };
    if (window.io) { start(); return; }
    const script = document.createElement("script");
    script.src = `${API_BASE}/socket.io/socket.io.js`;
    script.onload = start;
    document.head.appendChild(script);
  }

  function activateInbox() {
    if (!token()) return;
    loadThreads(false);
    connectSocket();
    if (!state.pollTimer) {
      state.pollTimer = window.setInterval(() => {
        const panel = $('[data-dashboard-panel="leads"]');
        if (!state.socketConnected && panel && !panel.hidden) loadThreads(true);
      }, 10000);
    }
  }

  function init() {
    if (!$("#sales-dm-shell")) return;
    $('[data-dashboard-target="leads"]')?.addEventListener("click", activateInbox);
    $("#sales-dm-search")?.addEventListener("input", renderThreads);
    $("#sales-dm-form")?.addEventListener("submit", sendText);
    $("#sales-dm-input")?.addEventListener("input", updateComposer);
    $("#sales-dm-input")?.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); $("#sales-dm-form")?.requestSubmit(); }
    });
    $("#sales-dm-attach")?.addEventListener("click", () => $("#sales-dm-file-input")?.click());
    $("#sales-dm-file-input")?.addEventListener("change", (event) => {
      state.files = Array.from(event.currentTarget.files || []);
      event.currentTarget.value = "";
      renderPendingFiles();
    });
    $("#sales-dm-confirm-files")?.addEventListener("click", sendFiles);
    $("#sales-dm-cancel-files")?.addEventListener("click", () => { state.files = []; renderPendingFiles(); });
    $("#sales-dm-block")?.addEventListener("click", toggleBlock);
    $("#sales-dm-report")?.addEventListener("click", reportUser);
    $("#sales-dm-call")?.addEventListener("click", (event) => {
      event.currentTarget.dataset.revealed = event.currentTarget.dataset.revealed === "1" ? "0" : "1";
      renderHeader();
    });
    $("#sales-dm-email")?.addEventListener("click", (event) => {
      event.currentTarget.dataset.revealed = event.currentTarget.dataset.revealed === "1" ? "0" : "1";
      renderHeader();
    });
    $("#sales-dm-back")?.addEventListener("click", () => {
      state.selectedId = null; state.messages = []; state.profile = null;
      renderThreads(); renderHeader(); renderMessages();
    });
    [$("#signout-button"), $("#account-signout-button")].forEach((button) => button?.addEventListener("click", () => {
      state.socket?.disconnect(); state.socket = null; state.socketConnected = false;
    }));
    if (token()) loadThreads(true);
  }

  init();
})();
