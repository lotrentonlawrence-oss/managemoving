// Mobile nav toggle
const navToggle = document.getElementById('navToggle');
const siteNav = document.getElementById('siteNav');
if (navToggle && siteNav) {
  navToggle.addEventListener('click', () => {
    const isOpen = siteNav.classList.toggle('open');
    navToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  });
  siteNav.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
      siteNav.classList.remove('open');
      navToggle.setAttribute('aria-expanded', 'false');
    });
  });
}

// Footer year
const yearEl = document.getElementById('year');
if (yearEl) yearEl.textContent = new Date().getFullYear();

// Contact form -> Google Apps Script mailer (hello@sweethometransitions.com -> trenton@sweethometransitions.com)
// Replace the URL below with your deployed Apps Script Web App URL.
// See apps-script/Code.gs and EMAIL_SETUP.md for full deployment steps.
const SCRIPT_URL = 'PASTE_YOUR_GOOGLE_APPS_SCRIPT_WEB_APP_URL_HERE';

const form = document.getElementById('contactForm');
const formNote = document.getElementById('formNote');
if (form) {
  form.addEventListener('submit', (e) => {
    e.preventDefault();

    if (!SCRIPT_URL || SCRIPT_URL.indexOf('PASTE_YOUR') === 0) {
      formNote.textContent = "Thanks! (Form isn't wired to email yet — see EMAIL_SETUP.md to finish setup.)";
      return;
    }

    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;
    formNote.textContent = 'Sending...';

    const formData = new FormData(form);

    // Apps Script web apps don't return CORS headers for a normal fetch read,
    // so we send in "no-cors" mode (fire-and-forget) and optimistically
    // confirm receipt. The form data still reaches the script and the email
    // still sends — we just can't read the JSON response back here.
    fetch(SCRIPT_URL, {
      method: 'POST',
      mode: 'no-cors',
      body: formData
    })
      .then(() => {
        formNote.textContent = "Thank you! Your request has been received — we'll call you within one business day.";
        form.reset();
      })
      .catch(() => {
        formNote.textContent = 'Something went wrong sending your request — please call us instead at (256) 924-6427.';
      })
      .finally(() => {
        if (submitBtn) submitBtn.disabled = false;
      });
  });
}
