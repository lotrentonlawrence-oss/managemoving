# Sweet Home Transitions — Website

Marketing site for **Sweet Home Transitions**, a senior move-management and
downsizing concierge serving Huntsville, Madison, Athens, and the Tennessee
Valley, AL.

**Slogan:** *Moving with Care, Settling with Comfort*

## Structure

- `index.html` — all page content and sections
- `styles.css` — styling
- `script.js` — mobile nav + contact form submission logic
- `login.html`, `login.js` — portal sign-in entry point
- `client.html`, `client.js` — client-only project dashboard
- `team.html`, `team.js` — business team dashboard for project updates
- `client-snapshot.html`, `client-snapshot.js` — team-only detailed client page with autosave
- `portal.css` — shared styling for portal pages
- `portal.js` — shared Firebase auth/routing helpers
- `firebase-config.js` — Firebase web app config placeholders
- `firebase.rules` — Firestore security rules for team/client access
- `storage.rules` — Storage security rules for floor plan uploads
- `firebase.json` / `.firebaserc` — Firebase project/deploy configuration
- `firestore.indexes.json` — Firestore index config
- `assets/logo.png` — primary brand logo used in header and footer
- `apps-script/Code.gs` — Google Apps Script that emails contact-form
  submissions from `hello@sweethometransitions.com` to
  `trenton@sweethometransitions.com`
- `CNAME` — tells GitHub Pages to serve this site at
  `sweethometransitions.com`
- `robots.txt` — search engine crawl directives + sitemap location
- `sitemap.xml` — XML sitemap for indexing
- `EMAIL_SETUP.md` — step-by-step guide to deploy the Apps Script mailer
- `DOMAIN_SETUP.md` — DNS records needed at the domain registrar to point
  the domain at GitHub Pages, plus Google Workspace MX records for email

## Hosting

Served via **GitHub Pages** directly from the `main` branch. Custom domain
is configured via the `CNAME` file — see `DOMAIN_SETUP.md` for the DNS
records that need to be added at the domain registrar to make
`sweethometransitions.com` resolve to this site.

## Contact form

The form on the site posts to a Google Apps Script Web App endpoint (see
`apps-script/Code.gs`), which sends the inquiry as an email. Follow
`EMAIL_SETUP.md` to deploy your own instance and wire up the `SCRIPT_URL`
constant in `script.js`.

## Portal setup (Firebase)

1. Create a Firebase project and web app.
2. Enable **Authentication** with Email/Password.
3. Enable **Firestore Database** and **Storage**.
4. Replace placeholders in `firebase-config.js` with your Firebase web config.
5. Publish `firebase.rules` and `storage.rules`.
6. Sign in to `team.html` as `trenton@sweethometransitions.com`:
   - Add potential/active/completed transitions in the pipeline board
   - Use **Client Account Setup** to create client credentials and link each
     account to a selected `projectId`
   - Open **Client Snapshot** from the pipeline card to manage project details,
     floor plan, auctions, and notes with autosave.
7. Configure automated floor-plan import:
   - Set `FLOOR_PLAN_LOOKUP_ENDPOINT` in `firebase-config.js` to your HTTPS
     backend endpoint (Cloud Function or API).
   - Endpoint should accept `{ projectId, address }`, query approved providers,
     upload selected floor-plan image to Firebase Storage, and return:
     - `floorPlanUrl`
     - `dimensions: { widthFt, lengthFt, sqft }`
     - `source` and `sourceUrl`
   - In **Client Snapshot**, use **Find & Import Floor Plan** to auto-populate
     floor plan image + dimensions from the address.

Firebase CLI deploy (from this folder):

```bash
firebase login
firebase use sweet-home-transitions
firebase deploy --only firestore:rules,firestore:indexes,storage
```

Current team-access restriction: only `trenton@sweethometransitions.com`
can access `team.html`.

Important: third-party listing sources (including Zillow/Realtor/Homes/county
systems) must be integrated through licensed/authorized APIs or data feeds
that allow this use.

Data is organized under `projects/{projectId}` with subcollections:
- `floorPlanItems` (for draggable item placements)
- `auctionItems` (for sold/unsold tracking and amounts)
