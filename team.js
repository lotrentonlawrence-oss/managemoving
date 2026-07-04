import { observeAuth, logout, resolvePortalContext, db, storage, formatCurrency } from "./portal.js";
import {
  collection,
  query,
  onSnapshot,
  doc,
  getDoc,
  setDoc,
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

const projectSelect = document.getElementById("projectSelect");
const logoutBtn = document.getElementById("logoutBtn");
const hoursForm = document.getElementById("hoursForm");
const hoursInput = document.getElementById("hoursInput");
const contractorForm = document.getElementById("contractorForm");
const contractorInput = document.getElementById("contractorInput");
const teamContractorsList = document.getElementById("teamContractorsList");
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
const teamNote = document.getElementById("teamNote");

let currentProjectId = null;
let currentProject = {};
let pendingPosition = { x: 50, y: 50 };
let floorUnsub = null;
let auctionUnsub = null;
let projectUnsub = null;

logoutBtn.addEventListener("click", async () => {
  await logout();
  window.location.href = "./login.html";
});

function note(text) {
  teamNote.textContent = text;
}

function ensureProjectSelected() {
  if (!currentProjectId) {
    note("Select a project first.");
    return false;
  }
  return true;
}

function renderContractors(contractors = []) {
  teamContractorsList.innerHTML = "";
  if (!contractors.length) {
    teamContractorsList.innerHTML = "<li>No contractors selected yet.</li>";
    return;
  }

  contractors.forEach((name, idx) => {
    const li = document.createElement("li");
    const removeBtn = document.createElement("button");
    removeBtn.className = "btn-ghost";
    removeBtn.style.marginLeft = "8px";
    removeBtn.textContent = "Remove";
    removeBtn.addEventListener("click", async () => {
      const next = [...contractors];
      next.splice(idx, 1);
      await updateDoc(doc(db, "projects", currentProjectId), { contractors: next, updatedAt: serverTimestamp() });
      note("Contractor removed.");
    });
    li.textContent = name;
    li.appendChild(removeBtn);
    teamContractorsList.appendChild(li);
  });
}

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

  el.addEventListener("pointermove", async (event) => {
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
    await updateDoc(doc(db, "projects", currentProjectId, "floorPlanItems", el.dataset.id), { x, y, updatedAt: serverTimestamp() });
    note("Floor plan position updated.");
  });
}

function renderFloor(project, items = []) {
  teamFloorCanvas.innerHTML = "";
  teamFloorCanvas.style.backgroundImage = project.floorPlanUrl ? `url('${project.floorPlanUrl}')` : "none";
  items.forEach(({ id, data }) => {
    const el = markerEl(id, data);
    enableMarkerDrag(el);
    teamFloorCanvas.appendChild(el);
  });
}

function renderAuction(items = []) {
  teamAuctionBody.innerHTML = "";
  items.forEach(({ id, data }) => {
    const tr = document.createElement("tr");
    const title = data.title || "";
    const status = data.status || "to_be_sold";
    const amount = Number(data.amount || 0);
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

hoursForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!ensureProjectSelected()) return;
  await updateDoc(doc(db, "projects", currentProjectId), {
    hoursAtHome: Number(hoursInput.value || 0),
    updatedAt: serverTimestamp()
  });
  note("Hours updated.");
});

contractorForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!ensureProjectSelected()) return;
  const name = contractorInput.value.trim();
  if (!name) return;
  const next = [...(currentProject.contractors || []), name];
  await updateDoc(doc(db, "projects", currentProjectId), { contractors: next, updatedAt: serverTimestamp() });
  contractorInput.value = "";
  note("Contractor added.");
});

floorUploadForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!ensureProjectSelected()) return;
  const file = floorImage.files[0];
  if (!file) {
    note("Choose an image file first.");
    return;
  }

  const fileRef = ref(storage, `floorplans/${currentProjectId}/${Date.now()}-${file.name}`);
  await uploadBytes(fileRef, file);
  const floorPlanUrl = await getDownloadURL(fileRef);
  await updateDoc(doc(db, "projects", currentProjectId), { floorPlanUrl, updatedAt: serverTimestamp() });
  floorImage.value = "";
  note("Floor plan uploaded.");
});

itemForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!ensureProjectSelected()) return;
  const label = document.getElementById("itemLabel").value.trim();
  const room = document.getElementById("itemRoom").value.trim();
  const notes = document.getElementById("itemNotes").value.trim();
  if (!label) {
    note("Item label is required.");
    return;
  }
  await addDoc(collection(db, "projects", currentProjectId, "floorPlanItems"), {
    label,
    room,
    notes,
    x: pendingPosition.x,
    y: pendingPosition.y,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  itemForm.reset();
  note("Floor plan item added.");
});

auctionForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!ensureProjectSelected()) return;
  const title = auctionTitle.value.trim();
  if (!title) return;
  await addDoc(collection(db, "projects", currentProjectId, "auctionItems"), {
    title,
    status: auctionStatus.value,
    amount: Number(auctionAmount.value || 0),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  auctionForm.reset();
  auctionStatus.value = "to_be_sold";
  note("Auction item added.");
});

teamAuctionBody.addEventListener("change", async (event) => {
  if (!ensureProjectSelected()) return;
  const target = event.target;
  const id = target.dataset.id;
  if (!id) return;

  if (target.dataset.role === "status") {
    await updateDoc(doc(db, "projects", currentProjectId, "auctionItems", id), { status: target.value, updatedAt: serverTimestamp() });
    return;
  }
  if (target.dataset.role === "amount") {
    await updateDoc(doc(db, "projects", currentProjectId, "auctionItems", id), { amount: Number(target.value || 0), updatedAt: serverTimestamp() });
  }
});

teamAuctionBody.addEventListener("click", async (event) => {
  if (!ensureProjectSelected()) return;
  const target = event.target;
  if (target.dataset.role !== "delete") return;
  const id = target.dataset.id;
  await deleteDoc(doc(db, "projects", currentProjectId, "auctionItems", id));
  note("Auction item removed.");
});

function subscribeProject(projectId) {
  if (projectUnsub) projectUnsub();
  if (floorUnsub) floorUnsub();
  if (auctionUnsub) auctionUnsub();

  currentProjectId = projectId;
  const projectRef = doc(db, "projects", projectId);
  const floorQuery = query(collection(db, "projects", projectId, "floorPlanItems"));
  const auctionQuery = query(collection(db, "projects", projectId, "auctionItems"), orderBy("createdAt", "desc"));

  projectUnsub = onSnapshot(projectRef, async (snap) => {
    if (!snap.exists()) {
      await setDoc(projectRef, {
        title: projectId,
        contractors: [],
        hoursAtHome: 0,
        floorPlanUrl: "",
        updatedAt: serverTimestamp()
      }, { merge: true });
      return;
    }
    currentProject = snap.data();
    hoursInput.value = currentProject.hoursAtHome || 0;
    renderContractors(currentProject.contractors || []);
  });

  floorUnsub = onSnapshot(floorQuery, (snap) => {
    const items = snap.docs.map((d) => ({ id: d.id, data: d.data() }));
    renderFloor(currentProject, items);
  });

  auctionUnsub = onSnapshot(auctionQuery, (snap) => {
    const items = snap.docs.map((d) => ({ id: d.id, data: d.data() }));
    renderAuction(items);
  });
}

observeAuth(async (user) => {
  if (!user) {
    window.location.href = "./login.html";
    return;
  }

  const ctx = await resolvePortalContext(user);
  if (ctx.role !== "team") {
    window.location.href = ctx.role === "client" ? "./client.html" : "./login.html";
    return;
  }

  const projectsQuery = query(collection(db, "projects"), orderBy("updatedAt", "desc"));
  onSnapshot(projectsQuery, async (snap) => {
    const projects = snap.docs.map((d) => ({ id: d.id, data: d.data() }));
    projectSelect.innerHTML = "";

    if (!projects.length) {
      const defaultId = "demo-project";
      await setDoc(doc(db, "projects", defaultId), {
        title: "Demo Project",
        contractors: [],
        hoursAtHome: 0,
        floorPlanUrl: "",
        updatedAt: serverTimestamp()
      }, { merge: true });
      projectSelect.innerHTML = `<option value="${defaultId}">Demo Project</option>`;
      subscribeProject(defaultId);
      return;
    }

    projects.forEach((p) => {
      const option = document.createElement("option");
      option.value = p.id;
      option.textContent = p.data.title || p.id;
      projectSelect.appendChild(option);
    });

    const selectedId = currentProjectId && projects.some((p) => p.id === currentProjectId)
      ? currentProjectId
      : projects[0].id;
    projectSelect.value = selectedId;
    subscribeProject(selectedId);
  });
});

projectSelect.addEventListener("change", async () => {
  const selected = projectSelect.value;
  if (!selected) return;
  const projectSnap = await getDoc(doc(db, "projects", selected));
  if (!projectSnap.exists()) {
    await setDoc(doc(db, "projects", selected), {
      title: selected,
      contractors: [],
      hoursAtHome: 0,
      floorPlanUrl: "",
      updatedAt: serverTimestamp()
    }, { merge: true });
  }
  subscribeProject(selected);
  note(`Viewing project: ${selected}`);
});
