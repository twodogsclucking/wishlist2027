# Deploying to Hostinger

The site is plain static files, so there's no build step: Hostinger copies this repo into a folder and serves it.
Repo: https://github.com/twodogsclucking/wishlist2027 (public, branch `main`).

This file isn't served: `.htaccess` blocks .md, .py, .bat, .xlsx, scripts/ and .git.


## 1. Create the subdomain (once)

hPanel → Websites → ninepines.mn → Manage → Domains → Subdomains

- Subdomain: `wishlist`  (the site becomes wishlist.ninepines.mn)
- Leave "Custom folder" as Hostinger suggests, usually `public_html/wishlist`
- Create

If ninepines.mn's DNS is managed somewhere other than Hostinger, add an A record there:
`wishlist` → the IP shown in hPanel → Hosting → Plan details.


## 2. Connect the repo (once)

hPanel → Websites → ninepines.mn → Manage → Advanced → GIT

- Repository: `https://github.com/twodogsclucking/wishlist2027.git`
- Branch: `main`
- Directory: the subdomain folder from step 1, e.g. `wishlist`
  (relative to public_html; the folder must be empty, so delete any default index.php / default.php first)
- Create, then press Deploy once

The repo is public, so no SSH key is needed.


## 3. Auto-deploy on every push (once)

1. On the same GIT page: Manage → Auto Deployment → copy the webhook URL.
2. In GitHub: wishlist2027 → Settings → Webhooks → Add webhook
   - Payload URL: paste the Hostinger URL
   - Content type: application/json
   - Event: Just the push event
   - Add webhook

From then on every push to `main` goes live in a few seconds.


## 4. HTTPS (once)

hPanel → Security → SSL → install the free SSL for wishlist.ninepines.mn (it can take up to an hour).


## 5. Optional: password-protect it

The site is hidden from search engines (robots.txt, a noindex meta tag and an X-Robots-Tag header), but anyone with the link can open it.
To require a password: hPanel → Advanced → Password Protect Directories → choose the subdomain folder → set a username and password.
Share links still work; viewers just enter the password once.


## Checking it went live

- Open https://wishlist.ninepines.mn (use a hard refresh if it looks old: Ctrl+F5).
- https://wishlist.ninepines.mn/README.md and /scripts/validate.py should both say 403 Forbidden.
- Download Excel should work.
- The Photos button doesn't appear on the live site; photos are only added locally.


## Updating the site later

1. Run `preview.bat`, check the change locally (add photos here too).
2. Commit and push to `main`. The pre-commit hook and GitHub Actions run `scripts/validate.py`, and a broken data file is refused.
3. The webhook deploys automatically.

When app.js / excel.js / site.css change, bump `VER` in app.js and the `?v=` numbers in index.html so browsers don't keep old copies.
Data files (data/*.json, i18n/*.json) are always fetched fresh, so they need no bump.
