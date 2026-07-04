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
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbw_XVeE560PSdWoV_dQKp8Afj8G4snGG_rCI4UoWXk9jbMDbwlloqOD7FqJFaWLKMWL7g/exec';
const PIPELINE_INTAKE_URL = 'https://us-central1-sweet-home-transitions.cloudfunctions.net/inquiryIntake';

const form = document.getElementById('contactForm');
const formNote = document.getElementById('formNote');
if (form) {
  form.addEventListener('submit', (e) => {
    e.preventDefault();

    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;
    formNote.textContent = 'Sending...';

    const formData = new FormData(form);
    const payload = {
      name: (formData.get('name') || '').toString().trim(),
      phone: (formData.get('phone') || '').toString().trim(),
      email: (formData.get('email') || '').toString().trim(),
      service: (formData.get('service') || '').toString().trim(),
      message: (formData.get('message') || '').toString().trim(),
      submittedAt: new Date().toISOString()
    };

    // 1) Send inquiry email (Apps Script, fire-and-forget due to no-cors)
    const emailRequest = (!SCRIPT_URL || SCRIPT_URL.indexOf('PASTE_YOUR') === 0)
      ? Promise.resolve()
      : fetch(SCRIPT_URL, {
          method: 'POST',
          mode: 'no-cors',
          body: formData
        });

    // 2) Add potential client to pipeline (Firebase Function)
    const pipelineRequest = fetch(PIPELINE_INTAKE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then((response) => {
      if (!response.ok) throw new Error('pipeline-intake-failed');
      return response.json().catch(() => ({}));
    });

    Promise.allSettled([emailRequest, pipelineRequest])
      .then((results) => {
        const pipelineResult = results[1];
        if (pipelineResult.status === 'rejected') {
          formNote.textContent = 'Your request was received, but pipeline intake did not complete. Please call (256) 924-6427 so we can add you right away.';
          return;
        }
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
