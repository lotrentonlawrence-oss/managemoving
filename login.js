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

function askEmail(defaultValue = "") {
  const value = window.prompt("Enter your email address:", defaultValue);
  return (value || "").trim();
}

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
  const email = askEmail(form.email.value.trim());
  if (!email) {
    note.textContent = "Passcode setup cancelled.";
    return;
  }

  const password = window.prompt("Choose a password (minimum 6 characters):", "");
  if (!password) {
    note.textContent = "Passcode setup cancelled.";
    return;
  }
  if (password.length < 6) {
    note.textContent = "Password must be at least 6 characters.";
    return;
  }

  note.textContent = "Setting up account passcode...";
  try {
    const result = await createAccount(email, password);
    form.email.value = email;
    const ctx = await resolvePortalContext(result.user);
    routeByRole(ctx.role);
  } catch (err) {
    if (err && err.code === "auth/email-already-in-use") {
      try {
        await resetPasswordForRegisteredAccount(email);
        form.email.value = email;
        note.textContent = "Account already exists. A passcode setup email was sent.";
      } catch (resetErr) {
        note.textContent = resetErr.message || "Account exists, but passcode email could not be sent.";
      }
      return;
    }
    note.textContent = err.message || "Unable to set up account.";
  }
});

forgotPasswordBtn.addEventListener("click", async () => {
  const email = askEmail(form.email.value.trim());
  if (!email) {
    note.textContent = "Password setup/reset cancelled.";
    return;
  }

  note.textContent = "Sending password setup email...";
  try {
    await resetPasswordForRegisteredAccount(email);
    form.email.value = email;
    note.textContent = "Password setup email sent.";
  } catch (err) {
    note.textContent = err.message || "Unable to send password reset.";
  }
});
