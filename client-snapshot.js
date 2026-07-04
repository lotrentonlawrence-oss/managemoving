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
const floorWidthFt = document.getElementById("floorWidthFt");
const floorLengthFt = document.getElementById("floorLengthFt");
const floorSqft = document.getElementById("floorSqft");
const floorSourceNote = document.getElementById("floorSourceNote");
const itemForm = document.getElementById("itemForm");
const itemHint = document.getElementById("itemHint");
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
let addressInputObserver = null;

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

function forceAddressInputsEditable() {
  [clientAddressInput, floorLookupAddress].forEach((input) => {
    if (!input) return;
    input.disabled = false;
    input.readOnly = false;
    input.removeAttribute("disabled");
    input.removeAttribute("readonly");
  });
}

function installAddressInputGuards() {
  if (addressInputObserver) return;
  forceAddressInputsEditable();

  addressInputObserver = new MutationObserver(() => {
    forceAddressInputsEditable();
  });

  [clientAddressInput, floorLookupAddress].forEach((input) => {
    if (!input) return;
    addressInputObserver.observe(input, {
      attributes: true,
      attributeFilter: ["readonly", "disabled", "class", "style"]
    });

    ["focus", "click", "pointerdown", "mousedown", "touchstart"].forEach((eventName) => {
      input.addEventListener(eventName, () => {
        forceAddressInputsEditable();
        window.setTimeout(forceAddressInputsEditable, 0);
        window.setTimeout(forceAddressInputsEditable, 50);
      });
    });
  });
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

function bindAddressAutocomplete(primaryInput, mirrorInput) {
  if (!window.google || !window.google.maps || !window.google.maps.places) return;
  if (primaryInput.dataset.mapsAutocompleteBound === "1") return;
  primaryInput.dataset.mapsAutocompleteBound = "1";
  forceAddressInputsEditable();

  const autocomplete = new window.google.maps.places.Autocomplete(primaryInput, {
    types: ["address"],
    componentRestrictions: { country: "us" },
    fields: ["formatted_address", "address_components"]
  });

  autocomplete.addListener("place_changed", () => {
    const place = autocomplete.getPlace();
    const formatted = place && place.formatted_address ? place.formatted_address : primaryInput.value.trim();
    primaryInput.value = formatted;
    mirrorInput.value = formatted;
    queueAutosave();
  });

  primaryInput.addEventListener("focus", forceAddressInputsEditable);
  primaryInput.addEventListener("input", forceAddressInputsEditable);
}

async function initAddressAutocomplete() {
  try {
    forceAddressInputsEditable();
    installAddressInputGuards();
    const loaded = await loadGoogleMapsPlaces();
    if (!loaded) return;
    bindAddressAutocomplete(clientAddressInput, floorLookupAddress);
    bindAddressAutocomplete(floorLookupAddress, clientAddressInput);
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
  return {
    floorPlanUrl,
    source,
    sourceUrl,
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
      address
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

  floorWidthFt.value = parsed.widthFt || "";
  floorLengthFt.value = parsed.lengthFt || "";
  floorSqft.value = parsed.sqft || "";
  setFloorSourceNote(parsed.sourceUrl ? `Source: ${parsed.source} (${parsed.sourceUrl})` : `Source: ${parsed.source}`);

  await updateDoc(doc(db, "projects", projectId), {
    clientAddress: address,
    floorPlanUrl: parsed.floorPlanUrl,
    floorPlanDimensions: {
      widthFt: parsed.widthFt,
      lengthFt: parsed.lengthFt,
      sqft: parsed.sqft
    },
    floorPlanSource: {
      name: parsed.source,
      url: parsed.sourceUrl,
      importedAt: serverTimestamp()
    },
    updatedAt: serverTimestamp()
  });
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
clientAddressInput.addEventListener("input", forceAddressInputsEditable);
floorLookupAddress.addEventListener("input", forceAddressInputsEditable);

function markerEl(itemId, item) {
  const el = document.createElement("div");
  el.className = "floor-marker";
  el.dataset.id = itemId;
  el.style.left = `${item.x || 50}%`;
  el.style.top = `${item.y || 50}%`;
  el.innerHTML = `${item.label || "Item"}<small>${item.room || ""}</small>`;
  return el;
}

function enableMarkerDrag(el) {
  let dragging = false;
  el.addEventListener("pointerdown", (event) => {
    event.preventDefault();
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

teamFloorCanvas.addEventListener("click", (event) => {
  const rect = teamFloorCanvas.getBoundingClientRect();
  pendingPosition = {
    x: Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100)),
    y: Math.max(0, Math.min(100, ((event.clientY - rect.top) / rect.height) * 100))
  };
  itemHint.textContent = `Placement selected: ${pendingPosition.x.toFixed(1)}%, ${pendingPosition.y.toFixed(1)}%`;
});

floorUploadForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const file = floorImage.files[0];
  if (!file) return;
  const fileRef = ref(storage, `floorplans/${projectId}/${Date.now()}-${file.name}`);
  await uploadBytes(fileRef, file);
  const floorPlanUrl = await getDownloadURL(fileRef);
  await updateDoc(doc(db, "projects", projectId), { floorPlanUrl, updatedAt: serverTimestamp() });
  floorImage.value = "";
});

floorLookupForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setFloorSourceNote("Looking up latest floor plan records...");
  try {
    await runFloorPlanLookup();
    setFloorSourceNote("Floor plan imported from property data source.");
  } catch (err) {
    setFloorSourceNote(err.message || "Unable to import floor plan from address.");
  }
});

itemForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const label = document.getElementById("itemLabel").value.trim();
  const room = document.getElementById("itemRoom").value.trim();
  const notes = document.getElementById("itemNotes").value.trim();
  if (!label) return;
  await addDoc(collection(db, "projects", projectId, "floorPlanItems"), {
    label,
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
  installAddressInputGuards();
  forceAddressInputsEditable();
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
    const dimensions = currentProject.floorPlanDimensions || {};
    floorWidthFt.value = Number(dimensions.widthFt || 0) || "";
    floorLengthFt.value = Number(dimensions.lengthFt || 0) || "";
    floorSqft.value = Number(dimensions.sqft || 0) || "";
    if (currentProject.floorPlanSource && currentProject.floorPlanSource.name) {
      const source = currentProject.floorPlanSource.name;
      const sourceUrl = currentProject.floorPlanSource.url || "";
      setFloorSourceNote(sourceUrl ? `Source: ${source} (${sourceUrl})` : `Source: ${source}`);
    } else {
      setFloorSourceNote("");
    }
    snapshotTitle.textContent = `Client Snapshot — ${currentProject.clientName || currentProject.title || projectId}`;
    suppressAutosave = false;
  });

  onSnapshot(floorQuery, (snap) => {
    const items = snap.docs.map((d) => ({ id: d.id, data: d.data() }));
    renderFloor(items);
  });

  onSnapshot(auctionQuery, (snap) => {
    const items = snap.docs.map((d) => ({ id: d.id, data: d.data() }));
    renderAuction(items);
  });
});
