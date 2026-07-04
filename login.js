import { observeAuth, login, resolvePortalContext } from "./portal.js";

const form = document.getElementById("loginForm");
const note = document.getElementById("loginNote");

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
