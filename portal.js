import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  fetchSignInMethodsForEmail,
  setPersistence,
  browserSessionPersistence
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

const PASSWORD_VERIFIED_SESSION_KEY = "sht.portalPasswordVerified";
const authPersistenceReady = setPersistence(auth, browserSessionPersistence);

function markPasswordVerified(user) {
  sessionStorage.setItem(PASSWORD_VERIFIED_SESSION_KEY, JSON.stringify({
    uid: user.uid,
    verifiedAt: Date.now()
  }));
}

export function clearPasswordVerifiedSession() {
  sessionStorage.removeItem(PASSWORD_VERIFIED_SESSION_KEY);
}

export function hasPasswordVerifiedSession(user) {
  if (!user) return false;
  const raw = sessionStorage.getItem(PASSWORD_VERIFIED_SESSION_KEY);
  if (!raw) return false;

  try {
    const value = JSON.parse(raw);
    return value && value.uid === user.uid;
  } catch (_err) {
    clearPasswordVerifiedSession();
    return false;
  }
}

export async function requirePasswordVerifiedSession(user) {
  if (hasPasswordVerifiedSession(user)) return true;
  clearPasswordVerifiedSession();
  await authPersistenceReady;
  await signOut(auth);
  return false;
}

export function observeAuth(callback) {
  return onAuthStateChanged(auth, callback);
}

export async function login(email, password) {
  await authPersistenceReady;
  const result = await signInWithEmailAndPassword(auth, email, password);
  markPasswordVerified(result.user);
  return result;
}

export async function logout() {
  clearPasswordVerifiedSession();
  await authPersistenceReady;
  return signOut(auth);
}

export async function createAccount(email, password) {
  await authPersistenceReady;
  const result = await createUserWithEmailAndPassword(auth, email, password);
  markPasswordVerified(result.user);
  return result;
}

export async function resetPasswordForRegisteredAccount(email) {
  const methods = await fetchSignInMethodsForEmail(auth, email);
  if (!methods || methods.length === 0) {
    throw new Error("No registered account was found for that email.");
  }
  return sendPasswordResetEmail(auth, email);
}

export async function getMembership(uid) {
  const snap = await getDoc(doc(db, "projectMembers", uid));
  return snap.exists() ? snap.data() : null;
}

export async function isTeamUser(user) {
  if (!user) return false;
  const email = (user.email || "").toLowerCase();
  return email === "trenton@sweethometransitions.com";
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
