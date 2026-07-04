# Sweet Home Transitions — Website

Marketing site for **Sweet Home Transitions**, a senior move-management and
downsizing concierge serving Huntsville, Madison, Athens, and the Tennessee
Valley, AL.

**Slogan:** *Moving with Care, Settling with Comfort*

## Structure

- `index.html` — all page content and sections
- `styles.css` — styling
- `script.js` — mobile nav + contact form submission logic
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
