// Hands form submissions to the websquire-brief Worker, which validates them and sends the email.
interface Env { BRIEF: Fetcher }

export const onRequest: PagesFunction<Env> = ({ request, env }) => env.BRIEF.fetch(request);
