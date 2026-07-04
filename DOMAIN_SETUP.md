# Domain & Email DNS Setup — sweethometransitions.com

This site's code is hosted on GitHub Pages at:
`https://github.com/lotrentonlawrence-oss/managemoving`

To make **sweethometransitions.com** point to it, and to make **Google
Workspace** handle mail/calendar for the domain, log into wherever the
domain was purchased (the **domain registrar** — e.g. GoDaddy, Namecheap,
Google Domains/Squarespace, etc.) and add the DNS records below. These
records can only be added by whoever has access to that registrar account.

## 1. Point the website to GitHub Pages

Add these records at your DNS provider:

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
> custom domain. Once DNS propagates (can take up to a few hours), the site
> will be live at `https://sweethometransitions.com` with GitHub's free
> automatic HTTPS certificate.

## 2. Google Workspace — Mail (MX records)

Remove any existing MX records for the domain, then add:

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

## 4. After MX records are set

1. Finish domain verification in the **Google Admin console**
   (admin.google.com) if you haven't already — Google will give you a TXT or
   HTML-file verification step during Workspace setup.
2. Create the `trenton@sweethometransitions.com` user (if not already there).
3. Create `inquires@sweethometransitions.com` as either its own mailbox or a
   "Send As" alias — see `EMAIL_SETUP.md` for details, this is what the
   contact form uses to send inquiry notifications.
4. Once mail is flowing, set up DKIM in Admin console → Apps → Google
   Workspace → Gmail → Authenticate email, for best deliverability.

## Why these two steps must be done manually

DNS records live with your domain registrar, and Workspace account/user
creation lives in Google's Admin console — both require your login
credentials, which I don't have access to. Everything else (site code,
GitHub Pages hosting, the CNAME file, and the contact-form mailer script)
has already been set up on the code side and just needs these DNS entries
to go live.
