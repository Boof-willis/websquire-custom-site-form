// Retired: this Worker used to forward website-brief submissions to a LeadConnector (GoHighLevel)
// webhook. Ockno's site tag now captures and reports the brief form directly, and
// functions/api/brief.ts no longer calls this Worker.
//
// Nothing in this repo references the WEBHOOK_URL secret anymore. To finish decommissioning it:
// delete the `websquire-brief` Worker deployment and its WEBHOOK_URL secret from your Cloudflare
// account (`wrangler secret delete WEBHOOK_URL -c worker/wrangler.jsonc`, or just delete the Worker
// from the dashboard), and drop the BRIEF service binding from the root wrangler.jsonc plus the
// SUBMIT_LIMITER / ALLOWED_ORIGINS / WEBHOOK_URL bindings from worker/wrangler.jsonc - those two
// config files couldn't be read (and so weren't edited) from here.

export default {
  async fetch(): Promise<Response> {
    return new Response('Gone', { status: 410 });
  }
} satisfies ExportedHandler;
