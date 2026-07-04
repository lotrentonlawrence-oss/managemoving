import { observeAuth, logout, resolvePortalContext, db, storage, auth } from "./portal.js";
import { FLOOR_PLAN_LOOKUP_ENDPOINT, GOOGLE_MAPS_API_KEY } from "./firebase-config.js";
import {
  doc,
  onSnapshot,
  collection,
  query,
  addDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  orderBy
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import {
  ref,
  uploadBytes,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";

const logoutBtn = document.getElementById("logoutBtn");
const snapshotTitle = document.getElementById("snapshotTitle");
const snapshotSaveNote = document.getElementById("snapshotSaveNote");
const snapshotForm = document.getElementById("snapshotForm");
const clientNameInput = document.getElementById("clientNameInput");
const clientEmailInput = document.getElementById("clientEmailInput");
const clientPhoneInput = document.getElementById("clientPhoneInput");
const clientAddressInput = document.getElementById("clientAddressInput");
const pipelineStageInput = document.getElementById("pipelineStageInput");
const pipelineProgressInput = document.getElementById("pipelineProgressInput");
const hoursAtHomeInput = document.getElementById("hoursAtHomeInput");
const contractorsInput = document.getElementById("contractorsInput");
const teamNotesInput = document.getElementById("teamNotesInput");
const floorUploadForm = document.getElementById("floorUploadForm");
const floorImage = document.getElementById("floorImage");
const teamFloorCanvas = document.getElementById("teamFloorCanvas");
const floorLookupForm = document.getElementById("floorLookupForm");
const floorLookupAddress = document.getElementById("floorLookupAddress");
const clientAddressSuggestions = document.getElementById("clientAddressSuggestions");
const floorLookupAddressSuggestions = document.getElementById("floorLookupAddressSuggestions");
const floorWidthFt = document.getElementById("floorWidthFt");
const floorLengthFt = document.getElementById("floorLengthFt");
const floorSqft = document.getElementById("floorSqft");
const floorSourceNote = document.getElementById("floorSourceNote");
const floorImportStatus = document.getElementById("floorImportStatus");
const floorManualOverride = document.getElementById("floorManualOverride");
const applyImportedFloorPlanBtn = document.getElementById("applyImportedFloorPlanBtn");
const drawFloorShapeBtn = document.getElementById("drawFloorShapeBtn");
const clearFloorShapeBtn = document.getElementById("clearFloorShapeBtn");
const floorShapeWidthFtInput = document.getElementById("floorShapeWidthFt");
const floorShapeLengthFtInput = document.getElementById("floorShapeLengthFt");
const itemForm = document.getElementById("itemForm");
const itemIconType = document.getElementById("itemIconType");
const itemHint = document.getElementById("itemHint");
const itemWidthFtInput = document.getElementById("itemWidthFt");
const itemDepthFtInput = document.getElementById("itemDepthFt");
const auctionForm = document.getElementById("auctionForm");
const auctionTitle = document.getElementById("auctionTitle");
const auctionStatus = document.getElementById("auctionStatus");
const auctionAmount = document.getElementById("auctionAmount");
const teamAuctionBody = document.getElementById("teamAuctionBody");

const params = new URLSearchParams(window.location.search);
const projectId = params.get("projectId");

let currentProject = {};
let pendingPosition = { x: 50, y: 50 };
let saveTimer = null;
let suppressAutosave = false;
let mapsPlacesLoader = null;
let placesPredictionService = null;
let addressGuardObserver = null;
let addressGuardTimer = null;
let suggestionRequestSeq = 0;
const predictionCache = new Map();
let drawShapeMode = false;
let drawShapeStart = null;
let drawShapeDraft = null;
let floorItemsCache = [];

const ICON_EMOJI = {
  tv: "📺",
  sofa: "🛋️",
  dresser: "🗄️",
  bed: "🛏️",
  table: "🪑",
  chair: "🪑",
  lamp: "💡"
};

logoutBtn.addEventListener("click", async () => {
  await logout();
  window.location.href = "./login.html";
});

function setSaveNote(text) {
  snapshotSaveNote.textContent = text;
}

function setFloorSourceNote(text) {
  floorSourceNote.textContent = text || "";
}

function setFloorImportStatus(text) {
  floorImportStatus.textContent = text || "";
}

function importedFloorPlanFromProject(project) {
  if (!project || !project.floorPlanImported) return null;
  const imported = project.floorPlanImported;
  const dimensions = imported.dimensions || {};
  return {
    floorPlanUrl: imported.floorPlanUrl || "",
    source: imported.source || "Data provider",
    sourceUrl: imported.sourceUrl || "",
    widthFt: Number(dimensions.widthFt || 0),
    lengthFt: Number(dimensions.lengthFt || 0),
    sqft: Number(dimensions.sqft || 0)
  };
}

function forceAddressInputEditable(input) {
  if (!input) return;
  if (input.disabled) input.disabled = false;
  if (input.readOnly) input.readOnly = false;
  input.removeAttribute("disabled");
  input.removeAttribute("readonly");
}

function enforceAddressInputsEditable() {
  forceAddressInputEditable(clientAddressInput);
  forceAddressInputEditable(floorLookupAddress);
}

function installEditableAddressGuard() {
  if (addressGuardTimer) return;
  enforceAddressInputsEditable();

  [clientAddressInput, floorLookupAddress].forEach((input) => {
    if (!input) return;
    ["focus", "click", "pointerdown", "mousedown", "keydown", "input"].forEach((eventName) => {
      input.addEventListener(eventName, enforceAddressInputsEditable);
    });
  });

  addressGuardObserver = new MutationObserver(() => {
    enforceAddressInputsEditable();
  });
  [clientAddressInput, floorLookupAddress].forEach((input) => {
    if (!input) return;
    addressGuardObserver.observe(input, {
      attributes: true,
      attributeFilter: ["readonly", "disabled", "style", "class"]
    });
  });

  addressGuardTimer = window.setInterval(enforceAddressInputsEditable, 300);
}

function loadGoogleMapsPlaces() {
  if (window.google && window.google.maps && window.google.maps.places) {
    return Promise.resolve(true);
  }
  if (!GOOGLE_MAPS_API_KEY) {
    return Promise.resolve(false);
  }
  if (mapsPlacesLoader) {
    return mapsPlacesLoader;
  }

  mapsPlacesLoader = new Promise((resolve, reject) => {
    const existing = document.getElementById("google-maps-places-script");
    if (existing) {
      existing.addEventListener("load", () => resolve(true), { once: true });
      existing.addEventListener("error", () => reject(new Error("Google Maps script failed to load.")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.id = "google-maps-places-script";
    script.async = true;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(GOOGLE_MAPS_API_KEY)}&libraries=places`;
    script.addEventListener("load", () => resolve(true), { once: true });
    script.addEventListener("error", () => reject(new Error("Google Maps script failed to load.")), { once: true });
    document.head.appendChild(script);
  });
  return mapsPlacesLoader;
}

function hideSuggestionList(listEl) {
  if (!listEl) return;
  listEl.innerHTML = "";
  listEl.classList.remove("visible");
}

function showSuggestionMessage(listEl, message) {
  if (!listEl) return;
  listEl.innerHTML = "";
  const row = document.createElement("div");
  row.className = "address-suggestion-item";
  row.textContent = message;
  listEl.appendChild(row);
  listEl.classList.add("visible");
}

function cachePredictions(query, predictions) {
  if (!query) return;
  predictionCache.set(query, predictions || []);
  if (predictionCache.size > 40) {
    const firstKey = predictionCache.keys().next().value;
    predictionCache.delete(firstKey);
  }
}

function getCachedPredictions(query) {
  if (!query) return null;
  if (predictionCache.has(query)) return predictionCache.get(query);
  const keys = Array.from(predictionCache.keys());
  const nearest = keys.find((k) => query.startsWith(k) && predictionCache.get(k)?.length);
  return nearest ? predictionCache.get(nearest) : null;
}

function scoreAddressPrediction(prediction, inputValue) {
  const desc = String(prediction.description || "").toLowerCase();
  const q = String(inputValue || "").trim().toLowerCase();
  let score = 0;
  if (q && desc.startsWith(q)) score += 10;
  if (q && desc.includes(q)) score += 5;
  if (desc.includes("huntsville")) score += 4;
  if (desc.includes(" al")) score += 2;
  return score;
}

function renderSuggestionList(listEl, predictions, primaryInput, mirrorInput) {
  if (!listEl) return;
  listEl.innerHTML = "";
  if (!predictions || !predictions.length) {
    listEl.classList.remove("visible");
    return;
  }

  predictions.slice(0, 5).forEach((prediction) => {
    const item = document.createElement("div");
    item.className = "address-suggestion-item";
    item.textContent = prediction.description;
    item.addEventListener("mousedown", (event) => {
      event.preventDefault();
      const selected = prediction.description;
      primaryInput.value = selected;
      mirrorInput.value = selected;
      hideSuggestionList(listEl);
      queueAutosave();
      enforceAddressInputsEditable();
    });
    listEl.appendChild(item);
  });
  listEl.classList.add("visible");
}

function requestAddressPredictions(value, listEl, primaryInput, mirrorInput) {
  const query = String(value || "").trim();
  if (query.length < 2) {
    hideSuggestionList(listEl);
    return;
  }

  const cached = getCachedPredictions(query);
  if (cached && cached.length) {
    const rankedCached = [...cached]
      .map((prediction) => ({ prediction, score: scoreAddressPrediction(prediction, query) }))
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.prediction);
    renderSuggestionList(listEl, rankedCached, primaryInput, mirrorInput);
  }

  if (!placesPredictionService) {
    showSuggestionMessage(listEl, "Address suggestions unavailable.");
    return;
  }
  if (!cached || !cached.length) {
    showSuggestionMessage(listEl, "Searching...");
  }
  const requestId = ++suggestionRequestSeq;

  placesPredictionService.getPlacePredictions({
    input: query,
    types: ["address"],
    componentRestrictions: { country: "us" },
    region: "us"
  }, (predictions, status) => {
    if (requestId !== suggestionRequestSeq) return;
    const okStatus = window.google.maps.places.PlacesServiceStatus.OK;
    if (status !== okStatus || !predictions) {
      if (!cached || !cached.length) {
        showSuggestionMessage(listEl, "No address suggestions found.");
      }
      return;
    }
    cachePredictions(query, predictions);
    const ranked = [...predictions]
      .map((prediction) => ({ prediction, score: scoreAddressPrediction(prediction, query) }))
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.prediction);
    renderSuggestionList(listEl, ranked, primaryInput, mirrorInput);
  });
}

function bindAddressSuggestionInput(primaryInput, mirrorInput, listEl) {
  if (!primaryInput || !mirrorInput || !listEl) return;
  if (primaryInput.dataset.mapsAutocompleteBound === "1") return;
  primaryInput.dataset.mapsAutocompleteBound = "1";

  let debounceTimer = null;
  primaryInput.addEventListener("input", () => {
    enforceAddressInputsEditable();
    mirrorInput.value = primaryInput.value;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      requestAddressPredictions(primaryInput.value, listEl, primaryInput, mirrorInput);
    }, 70);
  });

  primaryInput.addEventListener("change", () => {
    enforceAddressInputsEditable();
    mirrorInput.value = primaryInput.value.trim();
    hideSuggestionList(listEl);
    queueAutosave();
  });

  primaryInput.addEventListener("blur", () => {
    window.setTimeout(() => hideSuggestionList(listEl), 220);
  });

  primaryInput.addEventListener("focus", () => {
    enforceAddressInputsEditable();
    if (primaryInput.value.trim().length >= 2) {
      requestAddressPredictions(primaryInput.value, listEl, primaryInput, mirrorInput);
    }
  });
}

async function initAddressAutocomplete() {
  try {
    installEditableAddressGuard();
    const loaded = await loadGoogleMapsPlaces();
    if (!loaded) return;
    placesPredictionService = new window.google.maps.places.AutocompleteService();
    bindAddressSuggestionInput(clientAddressInput, floorLookupAddress, clientAddressSuggestions);
    bindAddressSuggestionInput(floorLookupAddress, clientAddressInput, floorLookupAddressSuggestions);
  } catch (err) {
    setFloorSourceNote(err.message || "Address suggestions are currently unavailable.");
  }
}

function toContractorArray(value) {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

async function saveSnapshotChanges() {
  if (!projectId) return;

  const payload = {
    title: clientNameInput.value.trim() || "Untitled Project",
    clientName: clientNameInput.value.trim(),
    clientEmail: clientEmailInput.value.trim().toLowerCase(),
    clientPhone: clientPhoneInput.value.trim(),
    clientAddress: clientAddressInput.value.trim(),
    pipelineStage: pipelineStageInput.value,
    pipelineProgress: Number(pipelineProgressInput.value || 0),
    hoursAtHome: Number(hoursAtHomeInput.value || 0),
    contractors: toContractorArray(contractorsInput.value),
    teamNotes: teamNotesInput.value.trim(),
    floorPlanManualOverride: floorManualOverride.checked,
    floorPlanDimensions: {
      widthFt: Number(floorWidthFt.value || 0),
      lengthFt: Number(floorLengthFt.value || 0),
      sqft: Number(floorSqft.value || 0)
    },
    updatedAt: serverTimestamp()
  };

  await updateDoc(doc(db, "projects", projectId), payload);
}

function parseLookupResult(result) {
  const dimensions = result && result.dimensions ? result.dimensions : {};
  const floorPlanUrl = result && result.floorPlanUrl ? String(result.floorPlanUrl) : "";
  const source = result && result.source ? String(result.source) : "Data provider";
  const sourceUrl = result && result.sourceUrl ? String(result.sourceUrl) : "";
  const provider = result && result.provider ? String(result.provider) : "";
  const appliedToDisplay = result && result.appliedToDisplay === true;
  return {
    floorPlanUrl,
    source,
    sourceUrl,
    provider,
    appliedToDisplay,
    widthFt: Number(dimensions.widthFt || 0),
    lengthFt: Number(dimensions.lengthFt || 0),
    sqft: Number(dimensions.sqft || 0)
  };
}

async function runFloorPlanLookup() {
  const address = floorLookupAddress.value.trim() || clientAddressInput.value.trim();
  if (!address) {
    throw new Error("Enter an address before running floor plan lookup.");
  }
  if (!FLOOR_PLAN_LOOKUP_ENDPOINT) {
    throw new Error("Set FLOOR_PLAN_LOOKUP_ENDPOINT in firebase-config.js before using lookup.");
  }

  const authUser = auth.currentUser;
  if (!authUser) {
    throw new Error("You must be signed in to run floor plan lookup.");
  }
  const token = await authUser.getIdToken();
  const response = await fetch(FLOOR_PLAN_LOOKUP_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`
    },
    body: JSON.stringify({
      projectId,
      address,
      preserveManual: floorManualOverride.checked
    })
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || body.message || "Lookup provider request failed.");
  }
  const parsed = parseLookupResult(body);
  if (!parsed.floorPlanUrl) {
    throw new Error("No floor plan image returned for this address.");
  }

  clientAddressInput.value = address;
  floorLookupAddress.value = address;

  if (!floorManualOverride.checked || parsed.appliedToDisplay) {
    floorWidthFt.value = parsed.widthFt || "";
    floorLengthFt.value = parsed.lengthFt || "";
    floorSqft.value = parsed.sqft || "";
    setFloorImportStatus("Imported floor plan applied to display.");
  } else {
    setFloorImportStatus("Imported floor plan saved. Manual override is on, so displayed plan was not replaced.");
  }
  const sourceText = parsed.provider ? `${parsed.source} (${parsed.provider})` : parsed.source;
  setFloorSourceNote(parsed.sourceUrl ? `Source: ${sourceText} (${parsed.sourceUrl})` : `Source: ${sourceText}`);
}

function queueAutosave() {
  if (suppressAutosave) return;
  setSaveNote("Saving...");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await saveSnapshotChanges();
      setSaveNote("Saved");
    } catch (err) {
      setSaveNote(err.message || "Unable to save changes.");
    }
  }, 450);
}

[
  clientNameInput,
  clientEmailInput,
  clientPhoneInput,
  clientAddressInput,
  pipelineStageInput,
  pipelineProgressInput,
  hoursAtHomeInput,
  contractorsInput,
  teamNotesInput,
  floorManualOverride,
  floorWidthFt,
  floorLengthFt,
  floorSqft
].forEach((field) => {
  field.addEventListener("input", queueAutosave);
  field.addEventListener("change", queueAutosave);
});

clientAddressInput.addEventListener("change", () => {
  floorLookupAddress.value = clientAddressInput.value.trim();
});

function normalizedFloorShape(project) {
  const shape = project?.floorPlanShape || {};
  const x = Number(shape.xPct);
  const y = Number(shape.yPct);
  const width = Number(shape.widthPct);
  const height = Number(shape.heightPct);
  if (![x, y, width, height].every((n) => Number.isFinite(n) && n >= 0)) return null;
  if (width <= 0 || height <= 0) return null;
  return {
    xPct: x,
    yPct: y,
    widthPct: width,
    heightPct: height,
    widthFt: Number(shape.widthFt || floorShapeWidthFtInput.value || floorWidthFt.value || 0),
    lengthFt: Number(shape.lengthFt || floorShapeLengthFtInput.value || floorLengthFt.value || 0)
  };
}

function itemSizePct(item, shape) {
  const widthFt = Number(item.widthFt || 0);
  const depthFt = Number(item.depthFt || 0);
  if (!shape || shape.widthFt <= 0 || shape.lengthFt <= 0 || widthFt <= 0 || depthFt <= 0) {
    return { widthPct: 7, heightPct: 7 };
  }
  const widthPct = Math.max(3, Math.min(35, (widthFt / shape.widthFt) * shape.widthPct));
  const heightPct = Math.max(3, Math.min(35, (depthFt / shape.lengthFt) * shape.heightPct));
  return { widthPct, heightPct };
}

function renderShapeOverlay(shape) {
  if (!shape) return;
  const shapeEl = document.createElement("div");
  shapeEl.className = "floor-shape";
  shapeEl.style.left = `${shape.xPct}%`;
  shapeEl.style.top = `${shape.yPct}%`;
  shapeEl.style.width = `${shape.widthPct}%`;
  shapeEl.style.height = `${shape.heightPct}%`;

  const widthLabel = document.createElement("div");
  widthLabel.className = "shape-label horizontal";
  widthLabel.textContent = shape.widthFt > 0 ? `${shape.widthFt.toFixed(1)} ft` : "width";

  const lengthLabel = document.createElement("div");
  lengthLabel.className = "shape-label vertical";
  lengthLabel.textContent = shape.lengthFt > 0 ? `${shape.lengthFt.toFixed(1)} ft` : "length";

  shapeEl.appendChild(widthLabel);
  shapeEl.appendChild(lengthLabel);
  teamFloorCanvas.appendChild(shapeEl);
}

function renderShapeDraft() {
  if (!drawShapeDraft) return;
  const draft = document.createElement("div");
  draft.className = "floor-shape-preview";
  draft.style.left = `${drawShapeDraft.xPct}%`;
  draft.style.top = `${drawShapeDraft.yPct}%`;
  draft.style.width = `${drawShapeDraft.widthPct}%`;
  draft.style.height = `${drawShapeDraft.heightPct}%`;
  teamFloorCanvas.appendChild(draft);
}

async function saveFloorShape(shape) {
  await updateDoc(doc(db, "projects", projectId), {
    floorPlanShape: shape ? {
      xPct: shape.xPct,
      yPct: shape.yPct,
      widthPct: shape.widthPct,
      heightPct: shape.heightPct,
      widthFt: Number(shape.widthFt || 0),
      lengthFt: Number(shape.lengthFt || 0)
    } : null,
    updatedAt: serverTimestamp()
  });
}

function canvasPointPct(event) {
  const rect = teamFloorCanvas.getBoundingClientRect();
  return {
    xPct: Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100)),
    yPct: Math.max(0, Math.min(100, ((event.clientY - rect.top) / rect.height) * 100))
  };
}

function rectFromPoints(a, b) {
  const xPct = Math.min(a.xPct, b.xPct);
  const yPct = Math.min(a.yPct, b.yPct);
  const widthPct = Math.abs(a.xPct - b.xPct);
  const heightPct = Math.abs(a.yPct - b.yPct);
  return { xPct, yPct, widthPct, heightPct };
}

function markerEl(itemId, item) {
  const el = document.createElement("div");
  el.className = "floor-marker";
  el.dataset.id = itemId;
  const shape = normalizedFloorShape(currentProject);
  const size = itemSizePct(item, shape);
  el.style.left = `${item.x || 50}%`;
  el.style.top = `${item.y || 50}%`;
  el.style.width = `${size.widthPct}%`;
  el.style.height = `${size.heightPct}%`;
  const icon = ICON_EMOJI[item.iconType] || "📦";
  const dims = Number(item.widthFt || 0) > 0 && Number(item.depthFt || 0) > 0
    ? `${Number(item.widthFt).toFixed(1)}' × ${Number(item.depthFt).toFixed(1)}'`
    : "";
  el.innerHTML = `<span class="icon-emoji">${icon}</span><small>${item.label || "Item"}</small><small>${dims || (item.room || "")}</small>`;
  return el;
}

function enableMarkerDrag(el) {
  let dragging = false;
  el.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (drawShapeMode) return;
    dragging = true;
    el.setPointerCapture(event.pointerId);
  });

  el.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    const rect = teamFloorCanvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100));
    const y = Math.max(0, Math.min(100, ((event.clientY - rect.top) / rect.height) * 100));
    el.style.left = `${x}%`;
    el.style.top = `${y}%`;
  });

  el.addEventListener("pointerup", async (event) => {
    if (!dragging) return;
    dragging = false;
    const rect = teamFloorCanvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100));
    const y = Math.max(0, Math.min(100, ((event.clientY - rect.top) / rect.height) * 100));
    await updateDoc(doc(db, "projects", projectId, "floorPlanItems", el.dataset.id), { x, y, updatedAt: serverTimestamp() });
  });
}

function renderFloor(items = []) {
  teamFloorCanvas.innerHTML = "";
  teamFloorCanvas.style.backgroundImage = currentProject.floorPlanUrl ? `url('${currentProject.floorPlanUrl}')` : "none";
  teamFloorCanvas.classList.toggle("draw-mode", drawShapeMode);
  renderShapeOverlay(normalizedFloorShape(currentProject));
  renderShapeDraft();
  items.forEach(({ id, data }) => {
    const el = markerEl(id, data);
    enableMarkerDrag(el);
    teamFloorCanvas.appendChild(el);
  });
}

function renderAuction(items = []) {
  teamAuctionBody.innerHTML = "";
  items.forEach(({ id, data }) => {
    const title = data.title || "";
    const status = data.status || "to_be_sold";
    const amount = Number(data.amount || 0);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${title}</td>
      <td>
        <select data-role="status" data-id="${id}">
          <option value="to_be_sold" ${status === "to_be_sold" ? "selected" : ""}>To Be Sold</option>
          <option value="sold" ${status === "sold" ? "selected" : ""}>Sold</option>
          <option value="unsold" ${status === "unsold" ? "selected" : ""}>Unsold</option>
        </select>
      </td>
      <td><input data-role="amount" data-id="${id}" type="number" min="0" step="0.01" value="${amount}"></td>
      <td><button class="btn-ghost" data-role="delete" data-id="${id}">Delete</button></td>
    `;
    teamAuctionBody.appendChild(tr);
  });
}

teamFloorCanvas.addEventListener("pointerdown", (event) => {
  if (!drawShapeMode) return;
  if (event.target !== teamFloorCanvas) return;
  drawShapeStart = canvasPointPct(event);
  drawShapeDraft = {
    xPct: drawShapeStart.xPct,
    yPct: drawShapeStart.yPct,
    widthPct: 0,
    heightPct: 0
  };
  renderFloor(floorItemsCache);
});

teamFloorCanvas.addEventListener("pointermove", (event) => {
  if (!drawShapeMode || !drawShapeStart) return;
  const nextPoint = canvasPointPct(event);
  drawShapeDraft = rectFromPoints(drawShapeStart, nextPoint);
  renderFloor(floorItemsCache);
});

teamFloorCanvas.addEventListener("pointerup", async (event) => {
  if (!drawShapeMode || !drawShapeStart) return;
  const endPoint = canvasPointPct(event);
  const rectShape = rectFromPoints(drawShapeStart, endPoint);
  drawShapeStart = null;
  drawShapeDraft = null;
  if (rectShape.widthPct < 2 || rectShape.heightPct < 2) {
    itemHint.textContent = "Shape draw cancelled (too small). Drag a larger rectangle.";
    renderFloor(floorItemsCache);
    return;
  }

  const shape = {
    ...rectShape,
    widthFt: Number(floorShapeWidthFtInput.value || floorWidthFt.value || 0),
    lengthFt: Number(floorShapeLengthFtInput.value || floorLengthFt.value || 0)
  };
  floorShapeWidthFtInput.value = shape.widthFt || "";
  floorShapeLengthFtInput.value = shape.lengthFt || "";
  currentProject.floorPlanShape = shape;
  await saveFloorShape(shape);
  itemHint.textContent = "Floor shape drawn. Add side dimensions to scale item icons.";
  renderFloor(floorItemsCache);
});

teamFloorCanvas.addEventListener("click", (event) => {
  if (drawShapeMode) return;
  if (event.target !== teamFloorCanvas) return;
  const point = canvasPointPct(event);
  pendingPosition = { x: point.xPct, y: point.yPct };
  itemHint.textContent = `Placement selected: ${pendingPosition.x.toFixed(1)}%, ${pendingPosition.y.toFixed(1)}%`;
});

floorUploadForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const file = floorImage.files[0];
  if (!file) return;
  const fileRef = ref(storage, `floorplans/${projectId}/${Date.now()}-${file.name}`);
  await uploadBytes(fileRef, file);
  const floorPlanUrl = await getDownloadURL(fileRef);
  floorManualOverride.checked = true;
  await updateDoc(doc(db, "projects", projectId), {
    floorPlanUrl,
    floorPlanManualOverride: true,
    floorPlanSource: {
      name: "Manual Upload",
      url: ""
    },
    updatedAt: serverTimestamp()
  });
  setFloorImportStatus("Manual floor plan uploaded and override enabled.");
  floorImage.value = "";
});

floorLookupForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setFloorImportStatus("Looking up latest floor plan records...");
  try {
    await runFloorPlanLookup();
    if (!floorManualOverride.checked) {
      setFloorImportStatus("Floor plan imported and displayed.");
    }
  } catch (err) {
    setFloorImportStatus(err.message || "Unable to import floor plan from address.");
  }
});

drawFloorShapeBtn.addEventListener("click", () => {
  drawShapeMode = !drawShapeMode;
  drawFloorShapeBtn.textContent = drawShapeMode ? "Drawing Enabled (Click & Drag)" : "Draw Floor Plan Shape";
  itemHint.textContent = drawShapeMode
    ? "Draw mode on: click and drag to create a 4-sided floor shape."
    : "Tip: click anywhere on the map before adding an item to set its position.";
  renderFloor(floorItemsCache);
});

clearFloorShapeBtn.addEventListener("click", async () => {
  currentProject.floorPlanShape = null;
  floorShapeWidthFtInput.value = "";
  floorShapeLengthFtInput.value = "";
  await saveFloorShape(null);
  renderFloor(floorItemsCache);
  itemHint.textContent = "Floor shape cleared.";
});

[floorShapeWidthFtInput, floorShapeLengthFtInput].forEach((input) => {
  input.addEventListener("change", async () => {
    const shape = normalizedFloorShape(currentProject);
    if (!shape) return;
    shape.widthFt = Number(floorShapeWidthFtInput.value || shape.widthFt || 0);
    shape.lengthFt = Number(floorShapeLengthFtInput.value || shape.lengthFt || 0);
    currentProject.floorPlanShape = shape;
    await saveFloorShape(shape);
    renderFloor(floorItemsCache);
  });
});

floorManualOverride.addEventListener("change", async () => {
  if (suppressAutosave) return;
  await saveSnapshotChanges().catch(() => {});
  if (floorManualOverride.checked) {
    setFloorImportStatus("Manual override is on. Imports will save but not replace displayed floor plan.");
    return;
  }
  setFloorImportStatus("Auto-apply is on. New imports will replace displayed floor plan.");
});

applyImportedFloorPlanBtn.addEventListener("click", async () => {
  const imported = importedFloorPlanFromProject(currentProject);
  if (!imported || !imported.floorPlanUrl) {
    setFloorImportStatus("No imported floor plan available yet.");
    return;
  }
  await updateDoc(doc(db, "projects", projectId), {
    floorPlanUrl: imported.floorPlanUrl,
    floorPlanDimensions: {
      widthFt: imported.widthFt,
      lengthFt: imported.lengthFt,
      sqft: imported.sqft
    },
    floorPlanSource: {
      name: imported.source,
      url: imported.sourceUrl,
      importedAt: serverTimestamp()
    },
    floorPlanManualOverride: false,
    updatedAt: serverTimestamp()
  });
  floorManualOverride.checked = false;
  setFloorImportStatus("Latest imported floor plan applied.");
});

itemForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const iconType = itemIconType.value;
  const label = document.getElementById("itemLabel").value.trim();
  const widthFt = Number(itemWidthFtInput.value || 0);
  const depthFt = Number(itemDepthFtInput.value || 0);
  const room = document.getElementById("itemRoom").value.trim();
  const notes = document.getElementById("itemNotes").value.trim();
  if (!label) return;
  await addDoc(collection(db, "projects", projectId, "floorPlanItems"), {
    iconType,
    label,
    widthFt,
    depthFt,
    room,
    notes,
    x: pendingPosition.x,
    y: pendingPosition.y,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  itemForm.reset();
});

auctionForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const title = auctionTitle.value.trim();
  if (!title) return;
  await addDoc(collection(db, "projects", projectId, "auctionItems"), {
    title,
    status: auctionStatus.value,
    amount: Number(auctionAmount.value || 0),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  auctionForm.reset();
  auctionStatus.value = "to_be_sold";
});

teamAuctionBody.addEventListener("change", async (event) => {
  const target = event.target;
  const id = target.dataset.id;
  if (!id) return;
  if (target.dataset.role === "status") {
    await updateDoc(doc(db, "projects", projectId, "auctionItems", id), { status: target.value, updatedAt: serverTimestamp() });
    return;
  }
  if (target.dataset.role === "amount") {
    await updateDoc(doc(db, "projects", projectId, "auctionItems", id), { amount: Number(target.value || 0), updatedAt: serverTimestamp() });
  }
});

teamAuctionBody.addEventListener("click", async (event) => {
  const target = event.target;
  if (target.dataset.role !== "delete") return;
  const id = target.dataset.id;
  await deleteDoc(doc(db, "projects", projectId, "auctionItems", id));
});

observeAuth(async (user) => {
  if (!user) {
    window.location.href = "./login.html";
    return;
  }
  const ctx = await resolvePortalContext(user);
  if (ctx.role !== "team") {
    window.location.href = "./login.html";
    return;
  }
  if (!projectId) {
    window.location.href = "./team.html";
    return;
  }
  installEditableAddressGuard();
  initAddressAutocomplete();

  const projectRef = doc(db, "projects", projectId);
  const floorQuery = query(collection(db, "projects", projectId, "floorPlanItems"));
  const auctionQuery = query(collection(db, "projects", projectId, "auctionItems"), orderBy("createdAt", "desc"));

  onSnapshot(projectRef, (snap) => {
    if (!snap.exists()) return;
    currentProject = snap.data();
    suppressAutosave = true;
    clientNameInput.value = currentProject.clientName || "";
    clientEmailInput.value = currentProject.clientEmail || "";
    clientPhoneInput.value = currentProject.clientPhone || "";
    clientAddressInput.value = currentProject.clientAddress || "";
    floorLookupAddress.value = currentProject.clientAddress || "";
    pipelineStageInput.value = currentProject.pipelineStage || "potential";
    pipelineProgressInput.value = Number(currentProject.pipelineProgress || 0);
    hoursAtHomeInput.value = Number(currentProject.hoursAtHome || 0);
    contractorsInput.value = (currentProject.contractors || []).join("\n");
    teamNotesInput.value = currentProject.teamNotes || "";
    floorManualOverride.checked = currentProject.floorPlanManualOverride === true;
    const shape = normalizedFloorShape(currentProject);
    floorShapeWidthFtInput.value = shape?.widthFt ? Number(shape.widthFt) : "";
    floorShapeLengthFtInput.value = shape?.lengthFt ? Number(shape.lengthFt) : "";
    const dimensions = currentProject.floorPlanDimensions || {};
    floorWidthFt.value = Number(dimensions.widthFt || 0) || "";
    floorLengthFt.value = Number(dimensions.lengthFt || 0) || "";
    floorSqft.value = Number(dimensions.sqft || 0) || "";
    const imported = importedFloorPlanFromProject(currentProject);
    applyImportedFloorPlanBtn.disabled = !imported || !imported.floorPlanUrl;
    if (floorManualOverride.checked) {
      setFloorImportStatus(imported && imported.floorPlanUrl
        ? "Manual override is on. Imported plan is available and can be applied manually."
        : "Manual override is on. Import keeps your displayed floor plan unchanged.");
    } else {
      setFloorImportStatus(imported && imported.floorPlanUrl
        ? "Auto-apply mode is on. Latest import is shown on the floor plan."
        : "");
    }
    if (currentProject.floorPlanSource && currentProject.floorPlanSource.name) {
      const source = currentProject.floorPlanSource.name;
      const sourceUrl = currentProject.floorPlanSource.url || "";
      setFloorSourceNote(sourceUrl ? `Source: ${source} (${sourceUrl})` : `Source: ${source}`);
    } else {
      setFloorSourceNote("");
    }
    snapshotTitle.textContent = `Client Snapshot — ${currentProject.clientName || currentProject.title || projectId}`;
    suppressAutosave = false;
    renderFloor(floorItemsCache);
  });

  onSnapshot(floorQuery, (snap) => {
    floorItemsCache = snap.docs.map((d) => ({ id: d.id, data: d.data() }));
    renderFloor(floorItemsCache);
  });

  onSnapshot(auctionQuery, (snap) => {
    const items = snap.docs.map((d) => ({ id: d.id, data: d.data() }));
    renderAuction(items);
  });
});
