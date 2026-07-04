import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  getIdTokenResult
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";
import { FIREBASE_CONFIG } from "./firebase-config.js";

const app = getApps().length ? getApps()[0] : initializeApp(FIREBASE_CONFIG);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

export function observeAuth(callback) {
  return onAuthStateChanged(auth, callback);
}

export async function login(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}

export async function logout() {
  return signOut(auth);
}

export async function getMembership(uid) {
  const snap = await getDoc(doc(db, "projectMembers", uid));
  return snap.exists() ? snap.data() : null;
}

export async function isTeamUser(user) {
  if (!user) return false;
  const email = (user.email || "").toLowerCase();
  const hasBusinessEmail = email.endsWith("@sweethometransitions.com");
  if (!hasBusinessEmail) return false;

  const token = await getIdTokenResult(user, true);
  if (token.claims.team === true) return true;

  const userDoc = await getDoc(doc(db, "users", user.uid));
  if (!userDoc.exists()) return false;
  return userDoc.data().role === "team";
}

export async function resolvePortalContext(user) {
  const team = await isTeamUser(user);
  if (team) return { role: "team", projectId: null, membership: null };

  const membership = await getMembership(user.uid);
  if (!membership || !membership.projectId) {
    return { role: "none", projectId: null, membership: null };
  }
  return { role: membership.role || "client", projectId: membership.projectId, membership };
}

export function waitForAuthUser() {
  return new Promise((resolve) => {
    const unsubscribe = observeAuth((user) => {
      unsubscribe();
      resolve(user || null);
    });
  });
}

export function formatCurrency(value) {
  const amount = Number(value || 0);
  return amount.toLocaleString("en-US", { style: "currency", currency: "USD" });
}
