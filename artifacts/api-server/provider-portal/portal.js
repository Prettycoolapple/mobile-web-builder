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
    const hero = $(".portal-hero");
    if (hero) hero.hidden = true;
    $("#portal-auth").hidden = true;
    $("#portal-dashboard").hidden = false;
    const summary = $("#dashboard-summary");
    if (summary) {
      const name = (user && (user.fullName || user.companyName)) || "";
      const email = user && user.email ? user.email : "";
      summary.textContent = name
        ? `You're signed in as ${name}${email ? ` (${email})` : ""}.`
        : "You're signed in to your service provider account.";
    }
  }

  function showAuth() {
    const hero = $(".portal-hero");
    if (hero) hero.hidden = false;
    $("#portal-auth").hidden = false;
    $("#portal-dashboard").hidden = true;
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

  // ── Phone OTP (shared backend with the sales portal) ─────────────────────
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

  // ── Signup ────────────────────────────────────────────────────────────────
  function selectedProfilePicture(form) {
    const input = form.elements.profilePicture;
    if (!input || !input.files || input.files.length === 0) return null;
    return input.files[0];
  }

  async function uploadProfilePicture(token, file) {
    return uploadFile("/upload/profile-picture", token, file);
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

    const languages = [primaryLanguage];
    if (secondaryLanguage && secondaryLanguage !== primaryLanguage) languages.push(secondaryLanguage);

    const providerData = {
      companyName,
      nzCompanyRegisterNumber,
      discipline,
      contactNumber: phoneNumber,
      primaryLanguage,
    };
    if (discipline === "other") providerData.otherDiscipline = otherDiscipline;
    if (secondaryLanguage) providerData.secondaryLanguage = secondaryLanguage;
    const addressStreet = String(values.addressStreet || "").trim();
    const addressSuburb = String(values.addressSuburb || "").trim();
    const addressCity = String(values.addressCity || "").trim();
    const addressPostcode = String(values.addressPostcode || "").trim();
    if (addressStreet) providerData.addressStreet = addressStreet;
    if (addressSuburb) providerData.addressSuburb = addressSuburb;
    if (addressCity) providerData.addressCity = addressCity;
    if (addressPostcode) providerData.addressPostcode = addressPostcode;

    const payload = {
      role: "service_provider",
      fullName,
      email,
      password,
      phoneNumber,
      phoneVerificationToken: state.phoneVerificationToken,
      languages,
      providerData,
    };

    // Details are valid — confirm T&C consent before creating the account.
    state.pendingSignupPayload = payload;
    state.pendingSignupForm = form;
    setStatus(status, "", null);
    openConsentModal();
  }

  async function submitSignup() {
    const status = $("#signup-status");
    if (!state.pendingSignupPayload) {
      setStatus(status, "Please restart your signup.", "error");
      return;
    }
    setStatus(status, "Creating your account…", null);
    try {
      const data = await api("/auth/signup", { method: "POST", body: state.pendingSignupPayload });
      let user = data.user;
      const picture = state.pendingSignupForm ? selectedProfilePicture(state.pendingSignupForm) : null;
      if (picture) {
        try {
          const uploaded = await uploadProfilePicture(data.token, picture);
          user = { ...user, avatarUrl: uploaded.fileUrl };
        } catch {
          // Non-fatal: the account exists; the photo can be added later in the app.
        }
      }
      saveSession(data.token, user);
      setStatus(status, "Your account is ready.", "success");
      showDashboard(user);
    } catch (error) {
      setStatus(status, getErrorMessage(error, "We couldn't create your account. Please try again."), "error");
    }
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
    void submitSignup();
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
    signupForm.elements.phone.addEventListener("input", () => {
      if (state.verifiedPhone && normalizeNzPhone(signupForm.elements.phone.value) !== state.verifiedPhone) {
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

    $("#provider-login-form").addEventListener("submit", handleLogin);
    $$("[data-reset-open]").forEach((button) => button.addEventListener("click", openReset));
    $$("[data-reset-close]").forEach((button) => button.addEventListener("click", closeReset));
    $("#request-reset-button").addEventListener("click", () => requestReset(false));
    $("#resend-reset-button").addEventListener("click", () => requestReset(true));
    $("#password-reset-form").addEventListener("submit", confirmReset);

    $("#signout-button").addEventListener("click", () => {
      clearSession();
      showAuth();
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

    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (!$("#reset-panel").hidden) closeReset();
      if (!$("#consent-panel")?.hidden) closeConsentModal();
    });

    // Resume a stored session if the token still belongs to a service provider.
    const session = getSession();
    if (!session) return;
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
