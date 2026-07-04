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
const floorLevelsCountInput = document.getElementById("floorLevelsCount");
const activeFloorLevelSelect = document.getElementById("activeFloorLevel");
const zoomOutBtn = document.getElementById("zoomOutBtn");
const zoomResetBtn = document.getElementById("zoomResetBtn");
const zoomInBtn = document.getElementById("zoomInBtn");
const floorShapeWidthFtInput = document.getElementById("floorShapeWidthFt");
const floorShapeLengthFtInput = document.getElementById("floorShapeLengthFt");
const floorRoomsList = document.getElementById("floorRoomsList");
const iconPalette = document.getElementById("iconPalette");
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
let floorItemsAllCache = [];
let floorRoomsCache = [];
let floorRoomsByLevelCache = {};
let roomSaveTimer = null;
let activeLevel = 1;
let floorLevelCount = 1;
let mapZoom = 1;

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

function levelKey(level) {
  return `level_${Number(level || 1)}`;
}

function ensureLevelState() {
  if (!Number.isFinite(activeLevel) || activeLevel < 1) activeLevel = 1;
  if (!Number.isFinite(floorLevelCount) || floorLevelCount < 1) floorLevelCount = 1;
  if (activeLevel > floorLevelCount) activeLevel = floorLevelCount;
}

function rebuildLevelSelect() {
  ensureLevelState();
  if (!activeFloorLevelSelect) return;
  activeFloorLevelSelect.innerHTML = "";
  for (let i = 1; i <= floorLevelCount; i += 1) {
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = `Level ${i}`;
    activeFloorLevelSelect.appendChild(opt);
  }
  activeFloorLevelSelect.value = String(activeLevel);
  if (floorLevelsCountInput) floorLevelsCountInput.value = String(floorLevelCount);
}

function syncActiveLevelCaches() {
  ensureLevelState();
  const key = levelKey(activeLevel);
  floorRoomsCache = Array.isArray(floorRoomsByLevelCache[key]) ? floorRoomsByLevelCache[key] : [];
  floorItemsCache = floorItemsAllCache.filter(({ data }) => {
    const itemLevel = Number(data.level || 1);
    return itemLevel === activeLevel;
  });
}

function setMapZoom(nextZoom) {
  mapZoom = Math.max(0.5, Math.min(2.5, Number(nextZoom || 1)));
  teamFloorCanvas.style.transformOrigin = "top left";
  teamFloorCanvas.style.transform = `scale(${mapZoom})`;
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

function normalizedFloorRooms(project) {
  const byLevel = project?.floorPlanRoomsByLevel || {};
  const roomsAtLevel = Array.isArray(byLevel[levelKey(activeLevel)]) ? byLevel[levelKey(activeLevel)] : null;
  const rooms = roomsAtLevel || (Array.isArray(project?.floorPlanRooms) ? project.floorPlanRooms : []);
  if (!rooms.length && project?.floorPlanShape) {
    const s = project.floorPlanShape;
    return [{
      id: "room-legacy",
      name: "Room 1",
      xPct: Number(s.xPct || 0),
      yPct: Number(s.yPct || 0),
      widthPct: Number(s.widthPct || 0),
      heightPct: Number(s.heightPct || 0),
      widthFt: Number(s.widthFt || 0),
      lengthFt: Number(s.lengthFt || 0)
    }].filter((room) => room.widthPct > 0 && room.heightPct > 0);
  }
  return rooms
    .map((room, index) => ({
      id: room.id || `room-${index + 1}`,
      name: room.name || `Room ${index + 1}`,
      xPct: Number(room.xPct || 0),
      yPct: Number(room.yPct || 0),
      widthPct: Number(room.widthPct || 0),
      heightPct: Number(room.heightPct || 0),
      widthFt: Number(room.widthFt || 0),
      lengthFt: Number(room.lengthFt || 0)
    }))
    .filter((room) => room.widthPct > 0 && room.heightPct > 0);
}

function overallShapeFromRooms(rooms) {
  if (!rooms.length) return null;
  const minX = Math.min(...rooms.map((r) => r.xPct));
  const minY = Math.min(...rooms.map((r) => r.yPct));
  const maxX = Math.max(...rooms.map((r) => r.xPct + r.widthPct));
  const maxY = Math.max(...rooms.map((r) => r.yPct + r.heightPct));
  const widthPct = Math.max(0, maxX - minX);
  const heightPct = Math.max(0, maxY - minY);

  const scaleX = rooms
    .filter((r) => r.widthFt > 0 && r.widthPct > 0)
    .map((r) => r.widthFt / r.widthPct);
  const scaleY = rooms
    .filter((r) => r.lengthFt > 0 && r.heightPct > 0)
    .map((r) => r.lengthFt / r.heightPct);
  const avgScaleX = scaleX.length ? scaleX.reduce((a, b) => a + b, 0) / scaleX.length : 0;
  const avgScaleY = scaleY.length ? scaleY.reduce((a, b) => a + b, 0) / scaleY.length : 0;
  const widthFt = avgScaleX > 0 ? widthPct * avgScaleX : Number(floorWidthFt.value || 0);
  const lengthFt = avgScaleY > 0 ? heightPct * avgScaleY : Number(floorLengthFt.value || 0);

  return { xPct: minX, yPct: minY, widthPct, heightPct, widthFt, lengthFt };
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

function renderRoomsOverlay(rooms) {
  rooms.forEach((room) => {
    const roomEl = document.createElement("div");
    roomEl.className = "floor-room";
    roomEl.style.left = `${room.xPct}%`;
    roomEl.style.top = `${room.yPct}%`;
    roomEl.style.width = `${room.widthPct}%`;
    roomEl.style.height = `${room.heightPct}%`;
    roomEl.innerHTML = `<div class="floor-room-label">${room.name} (${room.widthFt || "?"}′ × ${room.lengthFt || "?"}′)</div>`;
    roomEl.addEventListener("dblclick", () => {
      const nextWidth = window.prompt(`${room.name} width (ft):`, String(room.widthFt || ""));
      const nextLength = window.prompt(`${room.name} length (ft):`, String(room.lengthFt || ""));
      floorRoomsCache = floorRoomsCache.map((r) => {
        if (r.id !== room.id) return r;
        return {
          ...r,
          widthFt: Number(nextWidth || r.widthFt || 0),
          lengthFt: Number(nextLength || r.lengthFt || 0)
        };
      });
      floorRoomsByLevelCache[levelKey(activeLevel)] = floorRoomsCache;
      currentProject.floorPlanRoomsByLevel = floorRoomsByLevelCache;
      queueSaveRooms();
    });
    teamFloorCanvas.appendChild(roomEl);
  });

  const shape = overallShapeFromRooms(rooms);
  if (!shape) return;
  const widthLabel = document.createElement("div");
  widthLabel.className = "shape-label horizontal";
  widthLabel.style.left = `${shape.xPct + shape.widthPct / 2}%`;
  widthLabel.style.top = `${Math.max(0, shape.yPct - 2)}%`;
  widthLabel.textContent = shape.widthFt > 0 ? `${shape.widthFt.toFixed(1)} ft` : "";

  const lengthLabel = document.createElement("div");
  lengthLabel.className = "shape-label vertical";
  lengthLabel.style.left = `${Math.max(0, shape.xPct - 1)}%`;
  lengthLabel.style.top = `${shape.yPct + shape.heightPct / 2}%`;
  lengthLabel.textContent = shape.lengthFt > 0 ? `${shape.lengthFt.toFixed(1)} ft` : "";

  teamFloorCanvas.appendChild(widthLabel);
  teamFloorCanvas.appendChild(lengthLabel);
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
  const nextRooms = shape ? [...floorRoomsCache, {
    id: `room-${Date.now()}`,
    name: `Room ${floorRoomsCache.length + 1}`,
    xPct: shape.xPct,
    yPct: shape.yPct,
    widthPct: shape.widthPct,
    heightPct: shape.heightPct,
    widthFt: Number(shape.widthFt || 0),
    lengthFt: Number(shape.lengthFt || 0)
  }] : [];
  floorRoomsCache = nextRooms;
  floorRoomsByLevelCache[levelKey(activeLevel)] = nextRooms;
  currentProject.floorPlanRoomsByLevel = floorRoomsByLevelCache;
  queueSaveRooms();
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

function deriveFloorMetricsFromRooms(rooms) {
  const shape = overallShapeFromRooms(rooms);
  if (!shape) return { widthFt: 0, lengthFt: 0, sqft: 0 };
  const totalSqft = rooms.reduce((sum, r) => sum + (Number(r.widthFt || 0) * Number(r.lengthFt || 0)), 0);
  return {
    widthFt: Number(shape.widthFt || 0),
    lengthFt: Number(shape.lengthFt || 0),
    sqft: totalSqft > 0 ? totalSqft : Number(shape.widthFt || 0) * Number(shape.lengthFt || 0)
  };
}

function queueSaveRooms() {
  clearTimeout(roomSaveTimer);
  roomSaveTimer = setTimeout(async () => {
    const metrics = deriveFloorMetricsFromRooms(floorRoomsCache);
    floorWidthFt.value = metrics.widthFt ? metrics.widthFt.toFixed(1) : "";
    floorLengthFt.value = metrics.lengthFt ? metrics.lengthFt.toFixed(1) : "";
    floorSqft.value = metrics.sqft ? Math.round(metrics.sqft) : "";
    await updateDoc(doc(db, "projects", projectId), {
      floorPlanRoomsByLevel: floorRoomsByLevelCache,
      floorPlanLevelCount: floorLevelCount,
      floorPlanActiveLevel: activeLevel,
      floorPlanDimensions: {
        widthFt: metrics.widthFt,
        lengthFt: metrics.lengthFt,
        sqft: metrics.sqft
      },
      updatedAt: serverTimestamp()
    });
    renderFloor(floorItemsCache);
    renderRoomsEditor();
  }, 120);
}

function renderRoomsEditor() {
  if (!floorRoomsList) return;
  floorRoomsList.innerHTML = "";
  if (!floorRoomsCache.length) {
    floorRoomsList.innerHTML = "<p class='muted'>No room boxes yet. Use Draw Floor Plan Shape.</p>";
    return;
  }

  floorRoomsCache.forEach((room, index) => {
    const row = document.createElement("div");
    row.className = "room-row";
    row.innerHTML = `
      <input data-role="name" data-id="${room.id}" type="text" value="${room.name || `Room ${index + 1}`}">
      <input data-role="widthFt" data-id="${room.id}" type="number" step="0.1" min="0" value="${Number(room.widthFt || 0) || ""}" placeholder="Width ft">
      <input data-role="lengthFt" data-id="${room.id}" type="number" step="0.1" min="0" value="${Number(room.lengthFt || 0) || ""}" placeholder="Length ft">
      <button type="button" class="btn-ghost" data-role="delete" data-id="${room.id}">Delete</button>
    `;
    floorRoomsList.appendChild(row);
  });
}

function markerEl(itemId, item) {
  const el = document.createElement("div");
  el.className = "floor-marker";
  el.dataset.id = itemId;
  const shape = overallShapeFromRooms(normalizedFloorRooms(currentProject));
  const size = itemSizePct(item, shape);
  el.style.left = `${item.x || 50}%`;
  el.style.top = `${item.y || 50}%`;
  el.style.width = `${size.widthPct}%`;
  el.style.height = `${size.heightPct}%`;
  const icon = ICON_EMOJI[item.iconType] || "📦";
  const widthFt = Number(item.widthFt || 0);
  const depthFt = Number(item.depthFt || 0);
  const dims = Number(item.widthFt || 0) > 0 && Number(item.depthFt || 0) > 0
    ? `${Number(item.widthFt).toFixed(1)}' × ${Number(item.depthFt).toFixed(1)}'`
    : "";
  el.innerHTML = `
    <span class="icon-emoji">${icon}</span>
    <small>${item.label || "Item"}</small>
    <small>${dims || (item.room || "")}</small>
    <button type="button" class="marker-edit-btn" data-role="toggle-editor">Edit</button>
    <div class="marker-editor" data-role="editor">
      <input type="number" min="0" step="0.1" data-role="widthFt" value="${widthFt || ""}" placeholder="Width ft">
      <input type="number" min="0" step="0.1" data-role="depthFt" value="${depthFt || ""}" placeholder="Depth ft">
    </div>
  `;
  const editBtn = el.querySelector("[data-role='toggle-editor']");
  const editor = el.querySelector("[data-role='editor']");
  editBtn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    editor.classList.toggle("visible");
  });
  editor.querySelectorAll("input").forEach((input) => {
    input.addEventListener("change", async (event) => {
      event.stopPropagation();
      const newWidth = Number(editor.querySelector("[data-role='widthFt']").value || 0);
      const newDepth = Number(editor.querySelector("[data-role='depthFt']").value || 0);
      await updateDoc(doc(db, "projects", projectId, "floorPlanItems", itemId), {
        widthFt: newWidth,
        depthFt: newDepth,
        updatedAt: serverTimestamp()
      });
    });
  });
  return el;
}

function enableMarkerDrag(el) {
  let dragging = false;
  el.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".marker-editor") || event.target.closest(".marker-edit-btn")) return;
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
  syncActiveLevelCaches();
  teamFloorCanvas.innerHTML = "";
  teamFloorCanvas.style.backgroundImage = currentProject.floorPlanUrl ? `url('${currentProject.floorPlanUrl}')` : "none";
  teamFloorCanvas.classList.toggle("draw-mode", drawShapeMode);
  setMapZoom(mapZoom);
  renderRoomsOverlay(normalizedFloorRooms(currentProject));
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
  floorRoomsByLevelCache[levelKey(activeLevel)] = [];
  currentProject.floorPlanRoomsByLevel = floorRoomsByLevelCache;
  floorRoomsCache = [];
  floorShapeWidthFtInput.value = "";
  floorShapeLengthFtInput.value = "";
  await saveFloorShape(null);
  renderFloor(floorItemsCache);
  renderRoomsEditor();
  itemHint.textContent = "Floor shape cleared.";
});

floorLevelsCountInput.addEventListener("change", async () => {
  floorLevelCount = Math.max(1, Math.min(6, Number(floorLevelsCountInput.value || 1)));
  if (activeLevel > floorLevelCount) activeLevel = floorLevelCount;
  for (let i = 1; i <= floorLevelCount; i += 1) {
    const key = levelKey(i);
    if (!Array.isArray(floorRoomsByLevelCache[key])) floorRoomsByLevelCache[key] = [];
  }
  rebuildLevelSelect();
  syncActiveLevelCaches();
  renderRoomsEditor();
  renderFloor(floorItemsCache);
  await updateDoc(doc(db, "projects", projectId), {
    floorPlanLevelCount: floorLevelCount,
    floorPlanActiveLevel: activeLevel,
    floorPlanRoomsByLevel: floorRoomsByLevelCache,
    updatedAt: serverTimestamp()
  });
});

activeFloorLevelSelect.addEventListener("change", async () => {
  activeLevel = Number(activeFloorLevelSelect.value || 1);
  syncActiveLevelCaches();
  renderRoomsEditor();
  renderFloor(floorItemsCache);
  await updateDoc(doc(db, "projects", projectId), {
    floorPlanActiveLevel: activeLevel,
    updatedAt: serverTimestamp()
  });
});

zoomInBtn.addEventListener("click", () => {
  setMapZoom(mapZoom + 0.2);
});
zoomOutBtn.addEventListener("click", () => {
  setMapZoom(mapZoom - 0.2);
});
zoomResetBtn.addEventListener("click", () => {
  setMapZoom(1);
});

if (iconPalette) {
  iconPalette.querySelectorAll(".icon-palette-item").forEach((btn) => {
    btn.addEventListener("dragstart", (event) => {
      event.dataTransfer.setData("text/floor-icon", btn.dataset.icon || "sofa");
    });
  });
}

teamFloorCanvas.addEventListener("dragover", (event) => {
  event.preventDefault();
});

teamFloorCanvas.addEventListener("drop", async (event) => {
  event.preventDefault();
  const iconType = event.dataTransfer.getData("text/floor-icon");
  if (!iconType) return;
  const point = canvasPointPct(event);
  await addDoc(collection(db, "projects", projectId, "floorPlanItems"), {
    iconType,
    label: iconType.charAt(0).toUpperCase() + iconType.slice(1),
    widthFt: 0,
    depthFt: 0,
    room: "",
    notes: "Added from icon key",
    level: activeLevel,
    x: point.xPct,
    y: point.yPct,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
});

function handleRoomFieldUpdate(event) {
  const target = event.target;
  const id = target.dataset.id;
  const role = target.dataset.role;
  if (!id || !role) return;
  floorRoomsCache = floorRoomsCache.map((room) => {
    if (room.id !== id) return room;
    if (role === "name") return { ...room, name: target.value.trim() || room.name };
    if (role === "widthFt") return { ...room, widthFt: Number(target.value || 0) };
    if (role === "lengthFt") return { ...room, lengthFt: Number(target.value || 0) };
    return room;
  });
  currentProject.floorPlanRooms = floorRoomsCache;
  queueSaveRooms();
}

if (floorRoomsList) {
  floorRoomsList.addEventListener("change", handleRoomFieldUpdate);
  floorRoomsList.addEventListener("input", handleRoomFieldUpdate);

  floorRoomsList.addEventListener("click", (event) => {
    const target = event.target;
    if (target.dataset.role !== "delete") return;
    const id = target.dataset.id;
    floorRoomsCache = floorRoomsCache.filter((room) => room.id !== id);
    currentProject.floorPlanRooms = floorRoomsCache;
    queueSaveRooms();
  });
}

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
    level: activeLevel,
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
    floorLevelCount = Math.max(1, Number(currentProject.floorPlanLevelCount || 1));
    activeLevel = Math.max(1, Number(currentProject.floorPlanActiveLevel || 1));
    floorRoomsByLevelCache = currentProject.floorPlanRoomsByLevel || {};
    if (!floorRoomsByLevelCache[levelKey(1)]) {
      floorRoomsByLevelCache[levelKey(1)] = normalizedFloorRooms(currentProject);
    }
    rebuildLevelSelect();
    syncActiveLevelCaches();
    const lastRoom = floorRoomsCache[floorRoomsCache.length - 1];
    floorShapeWidthFtInput.value = lastRoom?.widthFt ? Number(lastRoom.widthFt) : "";
    floorShapeLengthFtInput.value = lastRoom?.lengthFt ? Number(lastRoom.lengthFt) : "";
    const dimensions = currentProject.floorPlanDimensions || {};
    floorWidthFt.value = Number(dimensions.widthFt || 0) || "";
    floorLengthFt.value = Number(dimensions.lengthFt || 0) || "";
    floorSqft.value = Number(dimensions.sqft || 0) || "";
    renderRoomsEditor();
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
    floorItemsAllCache = snap.docs.map((d) => ({ id: d.id, data: d.data() }));
    syncActiveLevelCaches();
    renderFloor(floorItemsCache);
  });

  onSnapshot(auctionQuery, (snap) => {
    const items = snap.docs.map((d) => ({ id: d.id, data: d.data() }));
    renderAuction(items);
  });
});
