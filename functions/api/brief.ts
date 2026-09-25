// Retired: Ockno's site tag now captures this form directly; nothing calls this route.
// Safe to delete this file (and the `worker/` Worker + its WEBHOOK_URL secret) once you've
// confirmed leads are landing in Ockno.
export const onRequest: PagesFunction = () => new Response('Gone', { status: 410 });
