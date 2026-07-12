import { observeAuth, logout, resolvePortalContext, db, formatCurrency } from "./portal.js";
import {
  doc,
  onSnapshot,
  collection,
  query,
  orderBy
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const params = new URLSearchParams(window.location.search);
const previewProjectId = params.get("projectId");
const isPreview = params.get("preview") === "1" && !!previewProjectId;

const clientNameEl = document.getElementById("clientName");
const previewBanner = document.getElementById("previewBanner");
const logoutBtn = document.getElementById("logoutBtn");
const contractorsList = document.getElementById("contractorsList");
const hoursValue = document.getElementById("hoursValue");
const soldAmount = document.getElementById("soldAmount");
const soldCount = document.getElementById("soldCount");
const unsoldCount = document.getElementById("unsoldCount");
const auctionBody = document.getElementById("auctionBody");
const floorPlanCanvas = document.getElementById("floorPlanCanvas");
const zoomLabel = document.getElementById("zoomLabel");
const zoomInBtn = document.getElementById("zoomInBtn");
const zoomOutBtn = document.getElementById("zoomOutBtn");

let zoom = 1;
function setZoom(value) {
  zoom = Math.min(2, Math.max(0.6, value));
  floorPlanCanvas.style.transform = `scale(${zoom})`;
  zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
}

zoomInBtn.addEventListener("click", () => setZoom(zoom + 0.1));
zoomOutBtn.addEventListener("click", () => setZoom(zoom - 0.1));

logoutBtn.addEventListener("click", async () => {
  await logout();
  window.location.href = "./login.html";
});

function renderContractors(contractors = []) {
  contractorsList.innerHTML = "";
  if (!contractors.length) {
    contractorsList.innerHTML = "<li>No contractors added yet.</li>";
    return;
  }
  contractors.forEach((name) => {
    const li = document.createElement("li");
    li.textContent = name;
    contractorsList.appendChild(li);
  });
}

function renderAuction(items = []) {
  let soldTotal = 0;
  let sold = 0;
  let unsold = 0;
  auctionBody.innerHTML = "";

  items.forEach((item) => {
    const amount = Number(item.amount || 0);
    if (item.status === "sold") {
      sold += 1;
      soldTotal += amount;
    } else {
      unsold += 1;
    }

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${item.title || ""}</td>
      <td>${(item.status || "to_be_sold").replaceAll("_", " ")}</td>
      <td>${formatCurrency(amount)}</td>
    `;
    auctionBody.appendChild(tr);
  });

  soldAmount.textContent = formatCurrency(soldTotal);
  soldCount.textContent = String(sold);
  unsoldCount.textContent = String(unsold);
}

function markerEl(item) {
  const el = document.createElement("div");
  el.className = "floor-marker";
  el.style.left = `${item.x || 50}%`;
  el.style.top = `${item.y || 50}%`;
  el.innerHTML = `${item.label || "Item"}<small>${item.room || ""}</small>`;
  return el;
}

function renderFloorPlan(project, items = []) {
  floorPlanCanvas.innerHTML = "";
  floorPlanCanvas.style.backgroundImage = project.floorPlanUrl ? `url('${project.floorPlanUrl}')` : "none";
  items.forEach((item) => floorPlanCanvas.appendChild(markerEl(item)));
}

observeAuth(async (user) => {
  if (!user) {
    window.location.href = "./login.html";
    return;
  }

  const ctx = await resolvePortalContext(user);

  let resolvedProjectId;
  if (isPreview && ctx.role === "team") {
    resolvedProjectId = previewProjectId;
    clientNameEl.textContent = "Preview Mode";
    if (previewBanner) previewBanner.hidden = false;
  } else if (ctx.role === "client" && ctx.projectId) {
    resolvedProjectId = ctx.projectId;
    clientNameEl.textContent = user.email || "";
  } else {
    window.location.href = ctx.role === "team" ? "./team.html" : "./login.html";
    return;
  }

  const projectRef = doc(db, "projects", resolvedProjectId);
  const floorQuery = query(collection(db, "projects", resolvedProjectId, "floorPlanItems"));
  const auctionQuery = query(collection(db, "projects", resolvedProjectId, "auctionItems"), orderBy("createdAt", "desc"));

  onSnapshot(projectRef, (snap) => {
    if (!snap.exists()) return;
    const data = snap.data();
    renderContractors(data.contractors || []);
    hoursValue.textContent = String(data.hoursAtHome || 0);
    renderFloorPlan(data, []);
  });

  let latestProjectData = {};
  onSnapshot(projectRef, (snap) => {
    if (!snap.exists()) return;
    latestProjectData = snap.data();
  });

  onSnapshot(floorQuery, (snap) => {
    const items = snap.docs.map((d) => d.data());
    renderFloorPlan(latestProjectData, items);
  });

  onSnapshot(auctionQuery, (snap) => {
    const items = snap.docs.map((d) => d.data());
    renderAuction(items);
  });
});
