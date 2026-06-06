(function () {
  const API_BASE = "/api";
  const TOKEN_KEY = "projectAlphaSalesPortalToken";
  const USER_KEY = "projectAlphaSalesPortalUser";
  const MAX_LISTING_PHOTOS = 20;

  const LISTING_STEPS = ["Photos", "Address", "Property details", "Sale and pricing", "Files", "Marketing copy"];
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
      throw new Error(message);
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
      throw new Error(message);
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
    $("#portal-auth").hidden = true;
    $("#portal-dashboard").hidden = false;
    fillProfileForm(user || {});
    updateAccountSummary(user || {});
    switchDashboardTab("listings");
    void refreshListings();
  }

  function showAuth() {
    $("#portal-auth").hidden = false;
    $("#portal-dashboard").hidden = true;
  }

  async function refreshListings() {
    const session = getSession();
    const status = $("#dashboard-status");
    const count = $("#listing-count");
    if (!session) {
      showAuth();
      return;
    }
    setStatus(status, "Checking property records...", null);
    try {
      const data = await api("/listings/my", { method: "GET", token: session.token });
      const listings = Array.isArray(data.listings) ? data.listings : [];
      state.listings = listings;
      if (count) count.textContent = String(listings.length);
      renderListings(listings);
      setStatus(status, "Property database connection is working.", "success");
    } catch (error) {
      renderListings([]);
      setStatus(status, getErrorMessage(error, "Could not load property records."), "error");
    }
  }

  function switchDashboardTab(target) {
    const labels = {
      listings: "My listings",
      profile: "Profile",
      account: "Account",
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
    return bits.join(" | ") || "Property record";
  }

  function renderListings(listings) {
    const root = $("#listings-list");
    if (!root) return;
    if (!listings.length) {
      root.innerHTML = `
        <div class="portal-empty">
          <h3>No listings yet</h3>
          <p>Add your first property record. Photos, documents, and property details will stay stored for future analysis.</p>
        </div>
      `;
      return;
    }
    root.innerHTML = listings
      .map((listing) => {
        const isActive = listing.status !== "paused";
        const image = Array.isArray(listing.imageUrls) && listing.imageUrls[0] ? listing.imageUrls[0] : "";
        return `
          <article class="portal-listing-card" data-listing-id="${escapeHtml(listing.id)}">
            <div class="portal-listing-thumb">${image ? `<img src="${escapeHtml(image)}" alt="" loading="lazy" />` : "<span>No photo</span>"}</div>
            <div class="portal-listing-body">
              <h3>${escapeHtml(listingTitle(listing))}</h3>
              <p>${escapeHtml(listing.address || "")}</p>
              <p>${escapeHtml(listingMeta(listing))}</p>
              <div class="portal-listing-stats">
                <span>${Number(listing.bedrooms || 0)} bed</span>
                <span>${Number(listing.bathrooms || 0)} bath</span>
                <span>${Number(listing.toilets || 0)} toilet</span>
                <span>${Number(listing.garages || 0)} garage</span>
              </div>
            </div>
            <div class="portal-listing-actions">
              <label class="portal-switch">
                <input type="checkbox" data-toggle-listing="${escapeHtml(listing.id)}" ${isActive ? "checked" : ""} />
                <span>${formatStatus(listing.status)}</span>
              </label>
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
    $("#listing-prev-button").disabled = state.listingStep === 0;
    $("#listing-next-button").hidden = state.listingStep === LISTING_STEPS.length - 1;
    $("#listing-create-button").hidden = state.listingStep !== LISTING_STEPS.length - 1;
    updateCreateButton();
  }

  function resetListingWizard() {
    const form = $("#new-listing-form");
    if (form) form.reset();
    state.listingPhotos.forEach((item) => URL.revokeObjectURL(item.previewUrl));
    state.listingPhotos = [];
    state.listingDocuments = [];
    $("#listing-address-results").hidden = true;
    $("#listing-address-results").innerHTML = "";
    renderPhotoPreview();
    renderDocumentList();
    clearListingErrors();
    switchListingStep(0);
  }

  function addListingPhotos(files) {
    const status = $("#dashboard-status");
    const accepted = Array.from(files || []).filter((file) => file.type.startsWith("image/"));
    if (!accepted.length) {
      setStatus(status, "Choose image files for property photos.", "error");
      return;
    }
    const room = MAX_LISTING_PHOTOS - state.listingPhotos.length;
    if (room <= 0) {
      setFieldError("imageUrls", "You can upload a maximum of 20 photos.");
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
    updateCreateButton();
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
    if (category === "title") return "Property Title";
    if (category === "lim") return "LIM Report";
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
    if (showErrors) clearListingErrors();

    if (step === 0) {
      const ok = state.listingPhotos.length >= 1 && state.listingPhotos.length <= MAX_LISTING_PHOTOS;
      if (!ok && showErrors) setFieldError("imageUrls", "Upload at least 1 photo and no more than 20 photos.");
      return ok;
    }
    if (step === 1) {
      const ok = String(form.elements.address.value || "").trim().length >= 3;
      if (!ok && showErrors) setFieldError("address", "Enter the full physical street address.");
      return ok;
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
      if (!tag && showErrors) setFieldError("propertyTag", "Select a property type.");
      if ((!metrics || !areas || !title) && showErrors) setFieldError("details", "Complete all metrics, areas, and title status.");
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
          "Choose the sale method, enter a valid private search price, and confirm any buyer-facing range you add.",
        );
      }
      return method && backendOk && buyerOk;
    }
    if (step === 4) {
      const titleInput = form.elements.titleDocument;
      const limInput = form.elements.limDocument;
      const titleOk = !titleInput.files.length || titleInput.files[0].type === "application/pdf";
      const limOk = !limInput.files.length || limInput.files[0].type === "application/pdf";
      if ((!titleOk || !limOk) && showErrors) setFieldError("documents", "Property Title and LIM uploads must be PDF files.");
      return titleOk && limOk;
    }
    if (step === 5) {
      const title = String(form.elements.listingTitle.value || "").trim();
      const description = String(form.elements.description.value || "").trim();
      const ok = title.length >= 3 && description.length >= 20;
      if (!ok && showErrors) setFieldError("copy", "Enter a listing title and at least 20 characters of body copy.");
      return ok;
    }
    return true;
  }

  function validateEntireListing(showErrors) {
    return LISTING_STEPS.every((_, index) => validateListingStep(index, showErrors));
  }

  function updateCreateButton() {
    const button = $("#listing-create-button");
    if (!button) return;
    button.disabled = !validateEntireListing(false);
  }

  async function searchAddress(query) {
    const session = getSession();
    const results = $("#listing-address-results");
    if (!session || !results) return;
    if (query.trim().length < 3) {
      results.hidden = true;
      results.innerHTML = "";
      return;
    }
    try {
      const data = await api(`/listings/address-autocomplete?q=${encodeURIComponent(query.trim())}`, {
        method: "GET",
        token: session.token,
      });
      const predictions = Array.isArray(data.predictions) ? data.predictions : [];
      if (!predictions.length) {
        results.hidden = true;
        results.innerHTML = "";
        return;
      }
      results.innerHTML = predictions
        .slice(0, 5)
        .map((item) => {
          const description = item.description || item.structured_formatting?.main_text || "";
          const placeId = item.place_id || "";
          return `<button type="button" data-place-id="${escapeHtml(placeId)}" data-place-description="${escapeHtml(description)}">${escapeHtml(description)}</button>`;
        })
        .join("");
      results.hidden = false;
    } catch {
      results.hidden = true;
    }
  }

  function addressComponent(result, types) {
    const components = Array.isArray(result?.address_components) ? result.address_components : [];
    const found = components.find((component) => types.some((type) => component.types?.includes(type)));
    return found?.long_name || "";
  }

  async function chooseAddress(placeId, description) {
    const session = getSession();
    const form = $("#new-listing-form");
    const results = $("#listing-address-results");
    if (!session || !form) return;
    form.elements.address.value = description;
    form.elements.googlePlaceId.value = placeId;
    if (results) results.hidden = true;
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
      updateCreateButton();
    } catch {
      updateCreateButton();
    }
  }

  async function uploadListingPhotos(token) {
    const urls = [];
    for (const item of state.listingPhotos) {
      const uploaded = await uploadFile("/upload/listing-image", token, item.file);
      urls.push(uploaded.fileUrl);
    }
    return urls;
  }

  async function uploadListingDocuments(token) {
    const form = $("#new-listing-form");
    const documents = [];
    const inputs = Array.from(form.querySelectorAll("[data-document-category]"));
    for (const input of inputs) {
      const category = input.dataset.documentCategory;
      for (const file of Array.from(input.files || [])) {
        const uploaded = await uploadFile("/upload/listing-document", token, file, { category });
        documents.push(uploaded.document);
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
      setStatus(status, "Complete the required listing details before creating.", "error");
      updateCreateButton();
      return;
    }
    setStatus(status, "Uploading photos...", null);
    try {
      const imageUrls = await uploadListingPhotos(session.token);
      setStatus(status, "Uploading files...", null);
      const documentUrls = await uploadListingDocuments(session.token);
      setStatus(status, "Creating listing...", null);
      await api("/listings", {
        method: "POST",
        token: session.token,
        body: buildListingPayload(form, imageUrls, documentUrls),
      });
      resetListingWizard();
      $("#new-listing-panel").hidden = true;
      await refreshListings();
      setStatus(status, "Listing created.", "success");
    } catch (error) {
      setStatus(status, getErrorMessage(error, "Could not create listing."), "error");
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
    if (!window.confirm(`Remove ${label}? It will be hidden from this dashboard, but the stored property data stays in the backend.`)) return;
    setStatus(status, "Removing listing...", null);
    try {
      await api(`/listings/${encodeURIComponent(listingId)}`, { method: "DELETE", token: session.token });
      await refreshListings();
      setStatus(status, "Listing removed. Stored property data is retained.", "success");
    } catch (error) {
      setStatus(status, getErrorMessage(error, "Could not remove listing."), "error");
    }
  }

  async function handleToggleListing(listingId, isActive) {
    const session = getSession();
    const status = $("#dashboard-status");
    if (!session) {
      showAuth();
      return;
    }
    setStatus(status, isActive ? "Activating listing..." : "Pausing listing...", null);
    try {
      await api(`/listings/${encodeURIComponent(listingId)}`, {
        method: "PATCH",
        token: session.token,
        body: { status: isActive ? "active" : "paused" },
      });
      await refreshListings();
      setStatus(status, isActive ? "Listing marked active." : "Listing paused.", "success");
    } catch (error) {
      setStatus(status, getErrorMessage(error, "Could not update listing status."), "error");
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
    const loginEmail = $("#sales-login-form input[name='email']");
    const resetEmail = $("#password-reset-form input[name='email']");
    if (loginEmail && resetEmail && loginEmail.value.trim()) resetEmail.value = loginEmail.value.trim();
    $("#reset-panel").hidden = false;
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
    const resendButton = $("#resend-otp-button");
    const otpState = $("#otp-state");
    if (resendButton) resendButton.disabled = true;
    if (otpState) otpState.textContent = "Phone not verified yet";
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
  }

  function updateAccountSummary(user) {
    const summary = $("#account-summary");
    if (!summary) return;
    const email = user.email ? ` Signed in as ${user.email}.` : "";
    summary.textContent = `Your sales portal account also works in the Project Alpha app as a free-tier user.${email}`;
  }

  function selectedProfilePicture(form) {
    const input = form.elements.profilePicture;
    if (!input || !input.files || input.files.length === 0) return null;
    return input.files[0];
  }

  async function uploadProfilePicture(token, file) {
    const payload = await uploadFile("/upload/profile-picture", token, file);
    return payload;
  }

  async function sendOtp(signupForm, isResend) {
    const status = $("#signup-status");
    const phoneNumber = normalizeNzPhone(signupForm.elements.phone.value);
    if (!/^\+64\d{7,10}$/.test(phoneNumber)) {
      setStatus(status, "Enter a valid New Zealand contact number starting with +64.", "error");
      return;
    }

    setStatus(status, isResend ? "Resending verification code..." : "Sending verification code...", null);
    try {
      const data = await api("/auth/send-otp", { method: "POST", body: { phone: phoneNumber } });
      state.verificationId = data.verificationId;
      state.verifiedPhone = null;
      state.phoneVerificationToken = null;
      $("#resend-otp-button").disabled = false;
      $("#otp-state").textContent = "Code sent. Check your phone.";
      setStatus(status, "Verification code sent.", "success");
    } catch (error) {
      setStatus(status, getErrorMessage(error, "Could not send verification code."), "error");
    }
  }

  async function verifyOtp(signupForm) {
    const status = $("#signup-status");
    const phoneNumber = normalizeNzPhone(signupForm.elements.phone.value);
    const code = String(signupForm.elements.otpCode.value || "").trim();
    if (!state.verificationId || !phoneNumber || !code) {
      setStatus(status, "Enter your phone number and verification code first.", "error");
      return;
    }

    setStatus(status, "Verifying phone...", null);
    try {
      const data = await api("/auth/verify-otp", {
        method: "POST",
        body: { verificationId: state.verificationId, phone: phoneNumber, code },
      });
      state.phoneVerificationToken = data.token;
      state.verifiedPhone = data.phone;
      $("#otp-state").textContent = `Verified ${data.phone}`;
      setStatus(status, "Phone verified. You can create the account now.", "success");
    } catch (error) {
      setStatus(status, getErrorMessage(error, "Could not verify code."), "error");
    }
  }

  async function handleSignup(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const status = $("#signup-status");
    const values = formValues(form);

    const phoneNumber = normalizeNzPhone(values.phone);
    if (!/^\+64\d{7,10}$/.test(phoneNumber)) {
      setStatus(status, "Enter a valid New Zealand contact number starting with +64.", "error");
      return;
    }
    if (!state.phoneVerificationToken || state.verifiedPhone !== phoneNumber) {
      setStatus(status, "Please verify your phone number before creating the account.", "error");
      return;
    }

    const agencyName = resolveAgencyName(values);
    if (!agencyName) {
      setStatus(status, "Select an agency, or enter the agency name if you choose Others.", "error");
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
    };

    setStatus(status, "Creating sales-agent account...", null);
    try {
      const data = await api("/auth/sales-agent-web-signup", { method: "POST", body: payload });
      let user = data.user;
      const picture = selectedProfilePicture(form);
      if (picture) {
        setStatus(status, "Account created. Uploading profile picture...", null);
        try {
          const uploaded = await uploadProfilePicture(data.token, picture);
          user = { ...user, avatarUrl: uploaded.fileUrl };
        } catch (uploadError) {
          setStatus(
            status,
            `Account created, but the profile picture could not upload: ${getErrorMessage(uploadError, "Upload failed.")}`,
            "error",
          );
        }
      }
      saveSession(data.token, user);
      if (!picture) setStatus(status, "Account created. Opening portal foundation...", "success");
      showDashboard(user);
    } catch (error) {
      setStatus(status, getErrorMessage(error, "Signup failed. Please try again."), "error");
    }
  }

  async function handleLogin(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const status = $("#login-status");
    const values = formValues(form);
    setStatus(status, "Signing in...", null);
    try {
      const data = await api("/auth/sales-agent-login", {
        method: "POST",
        body: {
          email: String(values.email || "").trim(),
          password: String(values.password || ""),
        },
      });
      saveSession(data.token, data.user);
      setStatus(status, "Signed in.", "success");
      showDashboard(data.user);
    } catch (error) {
      setStatus(status, getErrorMessage(error, "Login failed. Please try again."), "error");
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
      setStatus(status, "Enter a valid New Zealand contact number starting with +64.", "error");
      return;
    }
    const agencyName = resolveAgencyName(values);
    if (!agencyName) {
      setStatus(status, "Select an agency, or enter the agency name if you choose Others.", "error");
      return;
    }
    setStatus(status, "Saving profile...", null);
    try {
      const data = await api("/auth/sales-agent-web-profile", {
        method: "PATCH",
        token: session.token,
        body: {
          fullName: String(values.fullName || "").trim(),
          phoneNumber,
          primaryLanguage: String(values.primaryLanguage || "").trim(),
          agencyName,
        },
      });
      let user = data.user;
      const picture = selectedProfilePicture(form);
      if (picture) {
        setStatus(status, "Profile saved. Uploading profile picture...", null);
        const uploaded = await uploadProfilePicture(session.token, picture);
        user = { ...user, avatarUrl: uploaded.fileUrl };
      }
      saveSession(session.token, user);
      fillProfileForm(user);
      updateAccountSummary(user);
      setStatus(status, "Profile saved.", "success");
    } catch (error) {
      setStatus(status, getErrorMessage(error, "Could not save profile."), "error");
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
    setStatus(status, isResend ? "Resending reset code..." : "Sending reset code...", null);
    try {
      await api("/auth/password-reset/request", { method: "POST", body: { email } });
      state.resetCodeRequested = true;
      $("#resend-reset-button").disabled = false;
      setStatus(status, "If that email has an account, a reset code has been sent.", "success");
    } catch (error) {
      setStatus(status, getErrorMessage(error, "Could not send reset code."), "error");
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
    setStatus(status, "Updating password...", null);
    try {
      await api("/auth/password-reset/confirm", {
        method: "POST",
        body: { email, code, password },
      });
      setStatus(status, "Password updated. You can sign in now.", "success");
    } catch (error) {
      setStatus(status, getErrorMessage(error, "Could not reset password."), "error");
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
        updateCreateButton();
      }
    });

    form.elements.address.addEventListener("input", (event) => {
      form.elements.googlePlaceId.value = "";
      window.clearTimeout(state.addressTimer);
      state.addressTimer = window.setTimeout(() => searchAddress(event.currentTarget.value), 250);
      updateCreateButton();
    });
    $("#listing-address-results").addEventListener("click", (event) => {
      const button = event.target.closest("[data-place-id]");
      if (button) void chooseAddress(button.dataset.placeId, button.dataset.placeDescription);
    });

    form.addEventListener("input", updateCreateButton);
    form.addEventListener("change", (event) => {
      if (event.target.matches("[data-document-category]")) renderDocumentList();
      updateCreateButton();
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

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !$("#reset-panel").hidden) closeReset();
    });

    const session = getSession();
    if (session) {
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
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
