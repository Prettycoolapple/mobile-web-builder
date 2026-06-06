(function () {
  const API_BASE = "/api";
  const TOKEN_KEY = "projectAlphaSalesPortalToken";
  const USER_KEY = "projectAlphaSalesPortalUser";
  const MAX_LISTING_PHOTOS = 20;

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
    otpCooldownTimer: null,
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
    const hero = $(".portal-hero");
    if (hero) hero.hidden = true;
    $("#portal-auth").hidden = true;
    $("#portal-dashboard").hidden = false;
    fillProfileForm(user || {});
    updateAccountSummary(user || {});
    switchDashboardTab("listings");
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
    const isLastStep = state.listingStep === LISTING_STEPS.length - 1;
    $("#listing-prev-button").hidden = state.listingStep === 0;
    $("#listing-next-button").hidden = isLastStep;
    $("#listing-create-button").hidden = !isLastStep;
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
      if (!ok && showErrors) setFieldError("address", "Enter the property's street address.");
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
      const ok = title.length >= 3 && description.length >= 20;
      if (!ok && showErrors) setFieldError("copy", "Add a headline and a description of at least 20 characters.");
      return ok;
    }
    return true;
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

  // Build an OSM address label from the raw address object returned by Nominatim
  function osmAddressLabel(addr) {
    if (!addr || typeof addr !== "object") return "";
    const parts = [];
    const houseNumber = addr.house_number || "";
    const road = addr.road || addr.pedestrian || addr.footway || "";
    if (houseNumber && road) parts.push(`${houseNumber} ${road}`);
    else if (road) parts.push(road);
    else if (houseNumber) parts.push(houseNumber);
    if (addr.suburb || addr.neighbourhood) parts.push(addr.suburb || addr.neighbourhood);
    if (addr.city || addr.town || addr.village) parts.push(addr.city || addr.town || addr.village);
    if (addr.postcode) parts.push(addr.postcode);
    return parts.join(", ");
  }

  async function searchAddress(query) {
    const session = getSession();
    const results = $("#listing-address-results");
    const field = $("#new-listing-form")?.elements?.address;
    if (!session || !results) return;
    const trimmed = query.trim();
    if (trimmed.length < 3) {
      results.hidden = true;
      results.innerHTML = "";
      return;
    }
    // Show a "Searching…" hint so the agent knows it's working
    results.innerHTML = `<span class="portal-address-hint">Searching addresses…</span>`;
    results.hidden = false;
    try {
      const data = await api(`/listings/address-autocomplete?q=${encodeURIComponent(trimmed)}`, {
        method: "GET",
        token: session.token,
      });
      const predictions = Array.isArray(data.predictions) ? data.predictions : [];
      if (!predictions.length) {
        results.innerHTML = `<span class="portal-address-hint">No addresses found. Try a more specific street address.</span>`;
        return;
      }
      results.innerHTML = predictions
        .slice(0, 7)
        .map((item) => {
          const description = item.description || item.structured_formatting?.main_text || "";
          const placeId = item.place_id || "";
          // For OSM results, embed address parts as data attributes so we don't
          // need a second round-trip to the place-details endpoint.
          const isOsm = placeId.startsWith("osm:");
          const addr = item._address || {};
          const extraAttrs = isOsm
            ? ` data-osm="1"
                data-lat="${escapeHtml(String(item._lat || ""))}"
                data-lon="${escapeHtml(String(item._lon || ""))}"
                data-street="${escapeHtml([addr.house_number, addr.road || addr.pedestrian || ""].filter(Boolean).join(" "))}"
                data-suburb="${escapeHtml(addr.suburb || addr.neighbourhood || "")}"
                data-city="${escapeHtml(addr.city || addr.town || addr.village || "")}"
                data-postcode="${escapeHtml(addr.postcode || "")}"
              `
            : "";
          return `<button type="button" data-place-id="${escapeHtml(placeId)}" data-place-description="${escapeHtml(description)}" ${extraAttrs}>${escapeHtml(description)}</button>`;
        })
        .join("");
    } catch {
      results.innerHTML = `<span class="portal-address-hint">Address search is unavailable. You can type the address manually.</span>`;
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
    } catch {
      /* keep the typed address even if place details fail */
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
      const badStep = firstInvalidStep();
      if (badStep >= 0) switchListingStep(badStep);
      setStatus(status, "Please finish the highlighted details before publishing.", "error");
      return;
    }
    setStatus(status, "Uploading photos...", null);
    try {
      const imageUrls = await uploadListingPhotos(session.token);
      setStatus(status, "Uploading documents...", null);
      const documentUrls = await uploadListingDocuments(session.token);
      setStatus(status, "Publishing your listing...", null);
      await api("/listings", {
        method: "POST",
        token: session.token,
        body: buildListingPayload(form, imageUrls, documentUrls),
      });
      resetListingWizard();
      $("#new-listing-panel").hidden = true;
      await refreshListings();
      setStatus(status, "Your listing is now live for buyers.", "success");
    } catch (error) {
      setStatus(status, getErrorMessage(error, "We couldn't publish your listing. Please try again."), "error");
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
    const payload = await uploadFile("/upload/profile-picture", token, file);
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

    const payload = {
      fullName: String(values.fullName || "").trim(),
      email: String(values.email || "").trim(),
      password: String(values.password || ""),
      phoneNumber,
      phoneVerificationToken: state.phoneVerificationToken,
      primaryLanguage: String(values.primaryLanguage || "").trim(),
      agencyName,
    };

    setStatus(status, "Creating your account...", null);
    try {
      const data = await api("/auth/sales-agent-web-signup", { method: "POST", body: payload });
      let user = data.user;
      const picture = selectedProfilePicture(form);
      if (picture) {
        setStatus(status, "Account created. Adding your photo...", null);
        try {
          const uploaded = await uploadProfilePicture(data.token, picture);
          user = { ...user, avatarUrl: uploaded.fileUrl };
        } catch (uploadError) {
          setStatus(
            status,
            `Your account is ready, but we couldn't add your photo: ${getErrorMessage(uploadError, "Please try again from your profile.")}`,
            "error",
          );
        }
      }
      saveSession(data.token, user);
      if (!picture) setStatus(status, "Welcome aboard! Setting up your dashboard...", "success");
      showDashboard(user);
    } catch (error) {
      setStatus(status, getErrorMessage(error, "We couldn't create your account. Please try again."), "error");
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
      form.elements.googlePlaceId.value = "";
      window.clearTimeout(state.addressTimer);
      state.addressTimer = window.setTimeout(() => searchAddress(event.currentTarget.value), 250);
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
