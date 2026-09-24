# Websquire website brief

Multistep client intake form. Submitting it POSTs a JSON payload to `/api/brief`, which is emailed
to `info@web-squire.com` through Cloudflare Email Service with the full payload attached as JSON.

## Layout

- `public/index.html`: the form. Served by the Cloudflare Pages project `websquire-custom-site-form`,
  which deploys on every push to `main`.
- `functions/api/brief.ts`: Pages Function that forwards submissions to the `websquire-brief` Worker
  through the `BRIEF` service binding (`wrangler.jsonc`).
- `worker/`: the `websquire-brief` Worker. Validates the payload, rate-limits per IP and sends the
  email. It has no public URL. Pages Functions can't use the `send_email` or rate-limit bindings,
  which is why this lives in its own Worker.

## Setup

```bash
npm install
npx wrangler login
npx wrangler email sending enable web-squire.com   # needs web-squire.com on Cloudflare DNS
npm run deploy:worker                              # deploy the Worker before Pages relies on it
git push                                           # Pages builds and deploys the site
```

## Config (`worker/wrangler.jsonc`)

- `TO_EMAIL`: where briefs are sent.
- `FROM_EMAIL`: sender address; must be on a domain onboarded to Email Sending.
- `ALLOWED_ORIGINS`: comma-separated origins allowed to post from another site. Empty means the
  Pages site only.
- `SUBMIT_LIMITER`: 5 submissions per minute per IP.

## Local development

```bash
npm run dev
```

Runs the Worker on port 8788 and the Pages site on the port wrangler prints.
Emails are not sent locally; wrangler writes them to `.wrangler/tmp/email/` and logs the paths.
