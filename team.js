import { observeAuth, logout, resolvePortalContext, db } from "./portal.js";
import { FIREBASE_CONFIG } from "./firebase-config.js";
import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signOut as signOutAuth
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  collection,
  query,
  onSnapshot,
  doc,
  setDoc,
  addDoc,
  serverTimestamp,
  orderBy
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const logoutBtn = document.getElementById("logoutBtn");
const pipelineLeadForm = document.getElementById("pipelineLeadForm");
const leadName = document.getElementById("leadName");
const leadEmail = document.getElementById("leadEmail");
const leadPhone = document.getElementById("leadPhone");
const leadStage = document.getElementById("leadStage");
const clientAccessForm = document.getElementById("clientAccessForm");
const clientEmailInput = document.getElementById("clientEmailInput");
const clientPasscodeInput = document.getElementById("clientPasscodeInput");
const clientProjectSelect = document.getElementById("clientProjectSelect");
const potentialList = document.getElementById("potentialList");
const activeList = document.getElementById("activeList");
const completedList = document.getElementById("completedList");
const teamNote = document.getElementById("teamNote");

let projectsCache = [];

logoutBtn.addEventListener("click", async () => {
  await logout();
  window.location.href = "./login.html";
});

function note(text) {
  teamNote.textContent = text;
}

function stageLabel(stage) {
  if (stage === "completed") return "Completed";
  if (stage === "active") return "Active Transition";
  return "Potential Client";
}

function progressValue(project) {
  if (project.pipelineProgress !== undefined && project.pipelineProgress !== null) {
    return Number(project.pipelineProgress || 0);
  }
  if (project.pipelineStage === "completed") return 100;
  if (project.pipelineStage === "active") return 50;
  return 10;
}

function renderProjectCard(projectId, data) {
  const card = document.createElement("article");
  card.className = "pipeline-card";

  const name = data.clientName || data.title || "Unnamed client";
  const email = data.clientEmail || "";
  const progress = progressValue(data);
  const stage = stageLabel(data.pipelineStage || "potential");

  card.innerHTML = `
    <h4>${name}</h4>
    <p class="muted">${email || "No email yet"}</p>
    <p class="muted">Stage: ${stage}</p>
    <div class="progress-wrap">
      <div class="progress-track"><div class="progress-fill" style="width:${Math.max(0, Math.min(100, progress))}%"></div></div>
      <span>${Math.round(progress)}%</span>
    </div>
    <button class="btn-ghost" data-project-id="${projectId}">Open Client Snapshot</button>
  `;

  card.querySelector("button").addEventListener("click", () => {
    window.location.href = `./client-snapshot.html?projectId=${encodeURIComponent(projectId)}`;
  });

  return card;
}

function renderPipeline(projectDocs) {
  potentialList.innerHTML = "";
  activeList.innerHTML = "";
  completedList.innerHTML = "";
  clientProjectSelect.innerHTML = "";

  if (!projectDocs.length) {
    potentialList.innerHTML = "<p class='muted'>No clients in pipeline yet.</p>";
    clientProjectSelect.innerHTML = "<option value=''>No project available</option>";
    return;
  }

  projectDocs.forEach(({ id, data }) => {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = data.clientName || data.title || id;
    clientProjectSelect.appendChild(option);

    const card = renderProjectCard(id, data);
    const stage = data.pipelineStage || "potential";
    if (stage === "active") {
      activeList.appendChild(card);
    } else if (stage === "completed") {
      completedList.appendChild(card);
    } else {
      potentialList.appendChild(card);
    }
  });
}

async function createClientAuthAccount(email, passcode) {
  const appName = `client-provision-${Date.now()}`;
  const secondaryApp = initializeApp(FIREBASE_CONFIG, appName);
  const secondaryAuth = getAuth(secondaryApp);
  try {
    const result = await createUserWithEmailAndPassword(secondaryAuth, email, passcode);
    return result.user;
  } finally {
    await signOutAuth(secondaryAuth).catch(() => {});
    await deleteApp(secondaryApp).catch(() => {});
  }
}

pipelineLeadForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const clientName = leadName.value.trim();
  const clientEmail = leadEmail.value.trim().toLowerCase();
  const clientPhone = leadPhone.value.trim();
  const pipelineStage = leadStage.value;

  if (!clientName) {
    note("Client name is required.");
    return;
  }

  try {
    await addDoc(collection(db, "projects"), {
      title: clientName,
      clientName,
      clientEmail,
      clientPhone,
      pipelineStage,
      pipelineProgress: pipelineStage === "completed" ? 100 : (pipelineStage === "active" ? 50 : 10),
      contractors: [],
      hoursAtHome: 0,
      floorPlanUrl: "",
      teamNotes: "",
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp()
    });
    pipelineLeadForm.reset();
    leadStage.value = "potential";
    note("Client added to pipeline.");
  } catch (err) {
    note(err.message || "Unable to add client to pipeline.");
  }
});

clientAccessForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = clientEmailInput.value.trim().toLowerCase();
  const passcode = clientPasscodeInput.value;
  const projectId = clientProjectSelect.value;

  if (!email || !passcode || !projectId) {
    note("Provide client email, passcode, and project.");
    return;
  }
  if (passcode.length < 6) {
    note("Client passcode must be at least 6 characters.");
    return;
  }

  try {
    const user = await createClientAuthAccount(email, passcode);
    await setDoc(doc(db, "users", user.uid), {
      email,
      role: "client",
      projectId,
      updatedAt: serverTimestamp()
    }, { merge: true });
    await setDoc(doc(db, "projectMembers", user.uid), {
      email,
      role: "client",
      projectId,
      createdBy: "trenton@sweethometransitions.com",
      createdAt: serverTimestamp()
    }, { merge: true });
    clientAccessForm.reset();
    note("Client account created and linked. They can use \"Forgot password?\" to request a new passcode email.");
  } catch (err) {
    if (err && err.code === "auth/email-already-in-use") {
      note("That email already has an account. Use \"Forgot password?\" on login to request a new passcode email.");
      return;
    }
    note(err.message || "Unable to create client account.");
  }
});

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
  onSnapshot(projectsQuery, (snap) => {
    projectsCache = snap.docs.map((d) => ({ id: d.id, data: d.data() }));
    renderPipeline(projectsCache);
  });
});
