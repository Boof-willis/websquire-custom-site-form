# Websquire website brief

Multistep client intake form. Submitting it POSTs a JSON payload to `/api/brief`, which is validated
and forwarded to a LeadConnector (GoHighLevel) inbound webhook.

## Layout

- `public/index.html`: the form. Served by the Cloudflare Pages project `websquire-custom-site-form`
  at https://brief.web-squire.com, deployed on every push to `main`.
- `functions/api/brief.ts`: Pages Function that forwards submissions to the `websquire-brief` Worker
  through the `BRIEF` service binding (`wrangler.jsonc`).
- `worker/`: the `websquire-brief` Worker. Validates the payload, rate-limits per IP and POSTs it to
  the webhook. It has no public URL. Pages Functions can't use the rate-limit binding, which is why
  this lives in its own Worker, and the webhook URL never reaches the browser.

## Webhook payload

Flat, string-valued fields so they map directly in a GoHighLevel workflow:

- `first_name`, `last_name`, `full_name`, `email`, `phone`, `company_name`, `website`
- `answers.<question>`: every question in the form; multi-selects are comma-separated
- `brief_summary`: the whole brief as readable text, grouped by step
- `submission_id`, `submitted_at`, `received_at`, `source_url`, `country`

## Setup

```bash
npm install
npx wrangler login
npx wrangler secret put WEBHOOK_URL -c worker/wrangler.jsonc   # the LeadConnector webhook URL
npm run deploy:worker                                          # deploy before Pages relies on it
git push                                                       # Pages builds and deploys the site
```

## Config (`worker/wrangler.jsonc`)

- `WEBHOOK_URL` (secret): where submissions are sent.
- `ALLOWED_ORIGINS`: comma-separated origins allowed to post from another site. Empty means the
  Pages site only.
- `SUBMIT_LIMITER`: 5 submissions per minute per IP.

## Local development

Put `WEBHOOK_URL=<a test endpoint>` in `worker/.dev.vars`, then:

```bash
npm run dev
```

Runs the Worker on port 8788 and the Pages site on the port wrangler prints.
