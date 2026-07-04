import { observeAuth, logout, resolvePortalContext, db, storage } from "./portal.js";
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

logoutBtn.addEventListener("click", async () => {
  await logout();
  window.location.href = "./login.html";
});

function setSaveNote(text) {
  snapshotSaveNote.textContent = text;
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
    updatedAt: serverTimestamp()
  };

  await updateDoc(doc(db, "projects", projectId), payload);
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
  teamNotesInput
].forEach((field) => {
  field.addEventListener("input", queueAutosave);
  field.addEventListener("change", queueAutosave);
});

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
    pipelineStageInput.value = currentProject.pipelineStage || "potential";
    pipelineProgressInput.value = Number(currentProject.pipelineProgress || 0);
    hoursAtHomeInput.value = Number(currentProject.hoursAtHome || 0);
    contractorsInput.value = (currentProject.contractors || []).join("\n");
    teamNotesInput.value = currentProject.teamNotes || "";
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
