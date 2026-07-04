/**
 * Sweet Home Transitions — Website Contact Form Mailer
 * --------------------------------------------------------------------------
 * Purpose:
 *   Receives contact-form submissions from sweethometransitions.com and
 *   emails them to the business owner, sent from the "hello@" address.
 *
 * Deployment (see ../EMAIL_SETUP.md for the full step-by-step guide):
 *   1. Log into Google (ideally as hello@sweethometransitions.com, once
 *      that mailbox exists in Google Workspace).
 *   2. Go to https://script.google.com -> New project.
 *   3. Delete the placeholder code and paste this entire file in.
 *   4. Update the TO_EMAIL / FROM_ALIAS constants below if needed.
 *   5. Deploy -> New deployment -> Type: "Web app".
 *        - Execute as: Me
 *        - Who has access: Anyone
 *   6. Copy the generated Web App URL.
 *   7. Paste that URL into script.js as the SCRIPT_URL constant.
 *
 * Notes:
 *   - If you deploy this while logged in AS hello@sweethometransitions.com,
 *     GmailApp.sendEmail() sends natively from that address — no extra setup.
 *   - If you deploy it from a different account (e.g. trenton@), you must
 *     first add hello@ as a "Send As" alias under that account's
 *     Gmail Settings -> Accounts -> "Send mail as", or the `from` override
 *     below will be silently ignored by Gmail.
 */

const TO_EMAIL = 'trenton@sweethometransitions.com';
const FROM_ALIAS = 'hello@sweethometransitions.com';
const BUSINESS_NAME = 'Sweet Home Transitions';

function doPost(e) {
  try {
    const params = (e && e.parameter) || {};

    const name = (params.name || '').trim() || 'Not provided';
    const phone = (params.phone || '').trim() || 'Not provided';
    const email = (params.email || '').trim() || 'Not provided';
    const service = (params.service || '').trim() || 'Not specified';
    const message = (params.message || '').trim() || '(No additional details provided)';

    const subject = `New Website Inquiry — ${name}`;
    const body = [
      `You have a new inquiry from the ${BUSINESS_NAME} website contact form:`,
      '',
      `Name:            ${name}`,
      `Phone:           ${phone}`,
      `Email:           ${email}`,
      `Interested In:   ${service}`,
      '',
      'Message:',
      message,
      '',
      '---',
      'Sent automatically from the sweethometransitions.com contact form.'
    ].join('\n');

    const mailOptions = {
      name: `${BUSINESS_NAME} Website`
    };
    // Only set a replyTo if the visitor actually gave a usable email address.
    if (email !== 'Not provided') {
      mailOptions.replyTo = email;
    }
    // Attempt to send from the hello@ alias. If that alias isn't verified
    // on this account yet, Gmail will fall back to the account's own address.
    mailOptions.from = FROM_ALIAS;

    GmailApp.sendEmail(TO_EMAIL, subject, body, mailOptions);

    return ContentService
      .createTextOutput(JSON.stringify({ result: 'success' }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ result: 'error', error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Optional: lets you sanity-check the deployment by visiting the Web App
 * URL directly in a browser (GET request) — should show "OK".
 */
function doGet() {
  return ContentService.createTextOutput('Sweet Home Transitions mail endpoint is running. OK.');
}
