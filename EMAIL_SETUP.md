# Email Setup — Contact Form → Inbox

This connects the website contact form so that submissions arrive as an
email sent **from** `hello@sweethometransitions.com` **to**
`trenton@sweethometransitions.com`.

Because the website is a static site (no server), it uses a small, free
**Google Apps Script** as the mail relay. This keeps everything inside your
own Google Workspace account instead of routing customer contact info
through a third-party form service.

## Prerequisites
- Google Workspace must be active for `sweethometransitions.com`.
- The mailbox `hello@sweethometransitions.com` should exist as either:
  - a real Workspace user/mailbox, **or**
  - a verified "Send As" alias on another user's Gmail account (e.g. yours).

## Step-by-step

1. **Log into Google.** Ideally log in as `hello@sweethometransitions.com`
   directly — this avoids extra alias setup. If that mailbox doesn't have a
   separate login, log in as `trenton@sweethometransitions.com` and see the
   "Send As alias" note below.

2. Go to **https://script.google.com** → **New project**.

3. Delete the placeholder `myFunction()` code, then copy the entire contents
   of [`apps-script/Code.gs`](apps-script/Code.gs) from this project into the
   editor.

4. Rename the project (top-left, "Untitled project") to something like
   `Sweet Home Transitions Mailer`.

5. Click **Deploy → New deployment**.
   - Click the gear icon next to "Select type" → choose **Web app**.
   - Description: `Contact form mailer`
   - Execute as: **Me**
   - Who has access: **Anyone**
   - Click **Deploy**.

6. Google will ask you to **authorize** the script the first time — approve
   it (it needs permission to send email as you).

7. Copy the **Web app URL** it gives you (ends in `/exec`).

8. Open `script.js` in the website files and replace this line:
   ```js
   const SCRIPT_URL = 'PASTE_YOUR_GOOGLE_APPS_SCRIPT_WEB_APP_URL_HERE';
   ```
   with your real URL, e.g.:
   ```js
   const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycb.../exec';
   ```

9. Re-publish/redeploy the website (see `DOMAIN_SETUP.md`) so the updated
   `script.js` goes live.

10. Test it: submit the form on the live site and confirm the email arrives
    at `trenton@sweethometransitions.com`.

## "Send As" alias note

If you deployed the script from an account that is **not**
`hello@sweethometransitions.com`, Gmail will only send *as* that alias if
it's been added and verified under:

`Gmail → Settings → See all settings → Accounts → "Send mail as" → Add another email address`

Add `hello@sweethometransitions.com`, verify it, then re-run the
deployment. If you skip this, emails will still send successfully, just from
your primary account address instead of `hello@`.

## Updating the script later

If you ever edit `apps-script/Code.gs`, you must go back to
**script.google.com → your project → Deploy → Manage deployments → Edit
(pencil icon) → New version → Deploy** for changes to take effect. Simply
saving the file is not enough.
