import {
  observeAuth,
  login,
  createAccount,
  resetPasswordForRegisteredAccount,
  resolvePortalContext
} from "./portal.js";

const form = document.getElementById("loginForm");
const note = document.getElementById("loginNote");
const createAccountBtn = document.getElementById("createAccountBtn");
const forgotPasswordBtn = document.getElementById("forgotPasswordBtn");

function routeByRole(role) {
  if (role === "team") {
    window.location.href = "./team.html";
    return;
  }
  if (role === "client") {
    window.location.href = "./client.html";
    return;
  }
  note.textContent = "Your account is active, but no project access has been assigned yet.";
}

observeAuth(async (user) => {
  if (!user) return;
  const ctx = await resolvePortalContext(user);
  routeByRole(ctx.role);
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  note.textContent = "Signing in...";

  const email = form.email.value.trim();
  const password = form.password.value;

  try {
    const result = await login(email, password);
    const ctx = await resolvePortalContext(result.user);
    routeByRole(ctx.role);
  } catch (err) {
    note.textContent = err.message || "Unable to sign in. Please check your credentials.";
  }
});

createAccountBtn.addEventListener("click", async () => {
  const email = form.email.value.trim();
  const password = form.password.value;
  if (!email || !password) {
    note.textContent = "Enter email and password to create an account.";
    return;
  }

  note.textContent = "Creating account...";
  try {
    const result = await createAccount(email, password);
    const ctx = await resolvePortalContext(result.user);
    routeByRole(ctx.role);
  } catch (err) {
    note.textContent = err.message || "Unable to create account.";
  }
});

forgotPasswordBtn.addEventListener("click", async () => {
  const email = form.email.value.trim();
  if (!email) {
    note.textContent = "Enter your registered email first.";
    return;
  }

  note.textContent = "Checking account...";
  try {
    await resetPasswordForRegisteredAccount(email);
    note.textContent = "Password reset email sent.";
  } catch (err) {
    note.textContent = err.message || "Unable to send password reset.";
  }
});
