# Domain & Email DNS Setup — sweethometransitions.com

This site's code is hosted on GitHub Pages at:
`https://github.com/lotrentonlawrence-oss/managemoving`

**Good news:** I checked, and `sweethometransitions.com` is already registered
with **Squarespace** as its DNS provider (nameservers `nsb1-4.squarespacedns.com`).
It is currently just showing Squarespace's default "parking page" — it is
**not** connected to a live Squarespace site, so there's nothing to lose by
repointing it.

To make the domain live, log into **Squarespace** (squarespace.com → log in)
and go to:

**Settings → Domains → sweethometransitions.com → DNS Settings**

Then add the records below. These can only be added by whoever has login
access to that Squarespace account.

> **Known issue:** Squarespace's DNS panel sometimes shows the default
> parking-page A records and `www` CNAME as **greyed out / locked** and
> won't let you edit or delete them. If that happens, skip to
> **"Plan B: Move DNS to Cloudflare"** below — it's a guaranteed workaround.

## 1. Point the website to GitHub Pages

Add these records in the Squarespace DNS Settings panel:

| Type  | Host / Name | Value                     |
|-------|-------------|---------------------------|
| A     | @           | 185.199.108.153           |
| A     | @           | 185.199.109.153            |
| A     | @           | 185.199.110.153            |
| A     | @           | 185.199.111.153            |
| CNAME | www         | lotrentonlawrence-oss.github.io |

(Optional but recommended, IPv6):

| Type  | Host / Name | Value                        |
|-------|-------------|-------------------------------|
| AAAA  | @           | 2606:50c0:8000::153           |
| AAAA  | @           | 2606:50c0:8001::153           |
| AAAA  | @           | 2606:50c0:8002::153           |
| AAAA  | @           | 2606:50c0:8003::153           |

> A `CNAME` file containing `sweethometransitions.com` has already been added
> to the repo root, and GitHub Pages has been configured to use it as the
> custom domain (verified working at
> `https://lotrentonlawrence-oss.github.io/managemoving/` already). Once the
> records above are added in Squarespace and DNS propagates (can take up to
> a few hours), the site will be live at `https://sweethometransitions.com`
> with GitHub's free automatic HTTPS certificate.

## 2. Google Workspace — Mail (MX records)

In the same Squarespace DNS Settings panel, remove any existing MX records
(Squarespace may have default parking-page MX/records — delete those), then
add:

| Priority | Value                    |
|----------|--------------------------|
| 1        | ASPMX.L.GOOGLE.COM       |
| 5        | ALT1.ASPMX.L.GOOGLE.COM  |
| 5        | ALT2.ASPMX.L.GOOGLE.COM  |
| 10       | ALT3.ASPMX.L.GOOGLE.COM  |
| 10       | ALT4.ASPMX.L.GOOGLE.COM  |

## 3. Recommended: SPF record (helps deliverability, prevents spoofing)

| Type | Host | Value                          |
|------|------|--------------------------------|
| TXT  | @    | `v=spf1 include:_spf.google.com ~all` |

## 4. After DNS records are set

1. If you haven't already, sign up for Google Workspace at
   `workspace.google.com` using `sweethometransitions.com`, and complete
   domain verification in the **Google Admin console** (admin.google.com) —
   Google will give you a TXT or HTML-file verification step.
2. Create the `trenton@sweethometransitions.com` user (if not already there).
3. Create `hello@sweethometransitions.com` as either its own mailbox or a
   "Send As" alias — see `EMAIL_SETUP.md` for details, this is what the
   contact form uses to send inquiry notifications.
4. Once mail is flowing, set up DKIM in Admin console → Apps → Google
   Workspace → Gmail → Authenticate email, for best deliverability.

## Plan B: Move DNS to Cloudflare (if Squarespace's records are locked)

Squarespace locks its default "preset" A records / `www` CNAME on some
accounts and won't let you edit or delete them, even though it will still
let you change **nameservers**. If you hit that wall, move DNS management to
Cloudflare (free) instead — it fully replaces Squarespace's DNS panel, and
your domain stays registered at Squarespace either way.

1. Go to `cloudflare.com` → sign up for a free account.
2. Click **Add a Site**, enter `sweethometransitions.com`, choose the **Free**
   plan → Continue.
3. Cloudflare scans and imports your existing DNS records automatically —
   it should pick up the current MX (`smtp.google.com`) and TXT/SPF record
   since those are already live. Review the imported list → Continue.
4. Cloudflare shows you **2 nameservers** (e.g. `xxxx.ns.cloudflare.com` and
   `yyyy.ns.cloudflare.com`). Copy both.
5. Go back to **Squarespace → Domains → sweethometransitions.com →
   Nameservers** (a separate tab/section from "DNS Settings"). Switch from
   Squarespace's nameservers to **custom nameservers**, paste in the two
   Cloudflare nameservers, remove the `nsb1-4.squarespacedns.com` ones, and
   save. (Registrars almost always allow nameserver changes even when they
   lock individual record editing.)
6. Wait for Cloudflare to detect the change — usually well under an hour,
   sometimes up to 24. Cloudflare emails you and its dashboard shows the
   site status change from "Pending Nameserver Update" to "Active."
7. Once Active, go to Cloudflare dashboard → your site → **DNS → Records**
   and set up:

   | Type  | Name | Content                          | Proxy status |
   |-------|------|-----------------------------------|--------------|
   | A     | @    | 185.199.108.153                   | DNS only     |
   | A     | @    | 185.199.109.153                   | DNS only     |
   | A     | @    | 185.199.110.153                   | DNS only     |
   | A     | @    | 185.199.111.153                   | DNS only     |
   | CNAME | www  | lotrentonlawrence-oss.github.io    | DNS only     |
   | MX    | @    | smtp.google.com (priority 1)       | DNS only     |
   | TXT   | @    | v=spf1 include:_spf.google.com ~all| DNS only     |

   **Important:** set the proxy status (the cloud icon) to grey/"DNS only"
   for all records, not orange/"Proxied." GitHub Pages needs to see the real
   visitor IP and issue its own SSL certificate directly — Cloudflare's proxy
   in front of it can block that.
8. Delete any leftover default/parking A record Cloudflare may have imported
   for `@` so it doesn't conflict with the 4 GitHub ones above.

## Why these two steps must be done manually

DNS records live inside your Squarespace account, and Workspace account/user
creation lives in Google's Admin console — both require your login
credentials, which I don't have access to. Everything else (site code,
GitHub Pages hosting, the CNAME file, and the contact-form mailer script)
has already been set up on the code side and just needs these DNS entries
to go live.
