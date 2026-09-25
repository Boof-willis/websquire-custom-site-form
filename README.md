# Websquire website brief

Multistep client intake form. Submissions are captured directly by Ockno: the form carries
`data-ockno-form="observe"` and per-field `data-ockno-field` mappings, wired up by Ockno's site
tag (`public/index.html`).

## Layout

- `public/index.html`: the form. Served by the Cloudflare Pages project `websquire-custom-site-form`
  at https://brief.web-squire.com, deployed on every push to `main`.
- `functions/api/brief.ts`, `worker/`: retired. These used to forward submissions to a
  LeadConnector (GoHighLevel) inbound webhook; nothing calls them anymore (both now just return
  410). Left in place rather than deleted here, because `worker/wrangler.jsonc` and the root
  `wrangler.jsonc` couldn't be read/edited safely by the tooling that made this change. Once
  you've confirmed leads are landing in Ockno: delete both directories, drop the `BRIEF` service
  binding from the root `wrangler.jsonc`, and decommission the `websquire-brief` Worker and its
  `WEBHOOK_URL` secret in Cloudflare (`wrangler secret delete WEBHOOK_URL -c worker/wrangler.jsonc`,
  or just delete the Worker from the dashboard).

## Local development

```bash
npm install
git push   # Pages builds and deploys the site
```
