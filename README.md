# Websquire website brief

Multistep client intake form (`public/index.html`) served by a Cloudflare Worker (`src/index.ts`).
Submitting the form POSTs a JSON payload to `/api/brief`; the Worker validates it and emails it to
`info@web-squire.com` through Cloudflare Email Service, with the full payload attached as JSON.

## Setup

```bash
npm install
npx wrangler login                                  # needs the email_sending scope
npx wrangler email sending enable web-squire.com    # adds SPF/DKIM records for sending
npm run deploy
```

## Config (`wrangler.jsonc`)

- `TO_EMAIL`: where briefs are sent.
- `FROM_EMAIL`: sender address; must be on a domain onboarded to Email Sending.
- `ALLOWED_ORIGINS`: comma-separated origins allowed to post from another site. Empty means same-origin only.
- `SUBMIT_LIMITER`: 5 submissions per minute per IP.

## Local development

```bash
npm run dev
```

Emails are not sent locally; wrangler writes them to `.wrangler/tmp/email/` and logs the paths.
