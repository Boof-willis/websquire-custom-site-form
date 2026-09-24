// Receives website-brief submissions, validates them and forwards them to the LeadConnector
// (GoHighLevel) inbound webhook in the WEBHOOK_URL secret. It has no public URL: the Pages site
// forwards /api/brief here through a service binding (functions/api/brief.ts), because Pages
// Functions can't use the rate-limit binding. The webhook URL stays server-side.

const MAX_BODY_BYTES = 64 * 1024;
const MAX_TEXT = 5000;
const MAX_LIST_ITEMS = 40;
const MAX_LIST_ITEM = 200;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const WEBHOOK_TIMEOUT_MS = 15000;

// Mirrors the required questions in the form; the server is the real gate.
const REQUIRED: Record<string, string> = {
  name: 'Your name',
  email: 'Email',
  business: 'Business name',
  about: 'What the business does',
  audience: 'Who it is for',
  project_type: 'Project type',
  folder_status: 'Folder shared with info@web-squire.com'
};

type Answer = string | string[] | null;
type Answers = Record<string, Answer>;
interface Section { title: string; fields: { key: string; label: string }[] }
interface Brief {
  form: 'website-brief';
  version: number;
  submission_id: string;
  submitted_at: string | null;
  source_url: string | null;
  answers: Answers;
  sections: Section[];
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== '/api/brief') return json({ error: 'not_found' }, 404);

    const origin = request.headers.get('Origin');
    const cors = corsHeaders(origin, url, env);
    if (origin && !cors) return json({ error: 'origin_not_allowed' }, 403);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors ?? {} });
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, { ...cors, Allow: 'POST, OPTIONS' });

    return handleBrief(request, env, cors ?? {});
  }
} satisfies ExportedHandler<Env>;

async function handleBrief(request: Request, env: Env, cors: Record<string, string>): Promise<Response> {
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const { success } = await env.SUBMIT_LIMITER.limit({ key: ip });
  if (!success) return json({ error: 'rate_limited' }, 429, { ...cors, 'Retry-After': '60' });

  if (!(request.headers.get('Content-Type') ?? '').includes('application/json')) {
    return json({ error: 'expected_json' }, 415, cors);
  }
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return json({ error: 'too_large' }, 413, cors);

  let brief: Brief;
  try {
    brief = normalize(JSON.parse(raw));
  } catch {
    return json({ error: 'invalid_payload' }, 400, cors);
  }

  const missing = Object.keys(REQUIRED).filter(k => !hasValue(brief.answers[k]));
  if (missing.length) return json({ error: 'missing_fields', fields: missing }, 422, cors);
  const clientEmail = brief.answers.email as string;
  if (!EMAIL_RE.test(clientEmail)) return json({ error: 'invalid_email', fields: ['email'] }, 422, cors);

  const country = (request as Request & { cf?: { country?: string } }).cf?.country ?? null;

  try {
    const res = await fetch(env.WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(webhookPayload(brief, country)),
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS)
    });
    if (!res.ok) throw new Error(`webhook responded ${res.status}: ${(await res.text()).slice(0, 300)}`);
  } catch (err) {
    console.error('brief webhook failed', { message: (err as Error).message, submission_id: brief.submission_id });
    return json({ error: 'send_failed' }, 502, cors);
  }

  console.log('brief sent', { submission_id: brief.submission_id });
  return json({ ok: true, submission_id: brief.submission_id }, 200, cors);
}

/* ---------- request handling ---------- */

function corsHeaders(origin: string | null, url: URL, env: Env): Record<string, string> | null {
  if (!origin) return {};
  if (origin === url.origin) return {};
  const allowed = env.ALLOWED_ORIGINS.split(',').map(s => s.trim()).filter(Boolean);
  if (!allowed.includes(origin)) return null;
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin'
  };
}

function json(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers }
  });
}

// Accept only the shape the form sends; clamp sizes so a crafted request can't bloat the email.
function normalize(input: unknown): Brief {
  if (!isObject(input) || input.form !== 'website-brief' || !isObject(input.answers)) throw new Error('shape');

  const answers: Answers = {};
  for (const [key, value] of Object.entries(input.answers).slice(0, 100)) {
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(key)) continue;
    if (typeof value === 'string') answers[key] = value.trim().slice(0, MAX_TEXT) || null;
    else if (Array.isArray(value)) {
      answers[key] = value.filter((v): v is string => typeof v === 'string').slice(0, MAX_LIST_ITEMS).map(v => v.slice(0, MAX_LIST_ITEM));
    } else answers[key] = null;
  }

  const sections: Section[] = Array.isArray(input.sections)
    ? input.sections.filter(isObject).slice(0, 20).map(s => ({
        title: str(s.title, 80) || 'Section',
        fields: (Array.isArray(s.fields) ? s.fields : []).filter(isObject).slice(0, 60)
          .map(f => ({ key: str(f.key, 40), label: str(f.label, 120) }))
          .filter(f => f.key in answers)
      }))
    : [];

  // Anything answered but not described by a section still reaches the email.
  const described = new Set(sections.flatMap(s => s.fields.map(f => f.key)));
  const extra = Object.keys(answers).filter(k => !described.has(k));
  if (extra.length) sections.push({ title: 'Other', fields: extra.map(key => ({ key, label: humanize(key) })) });

  return {
    form: 'website-brief',
    version: typeof input.version === 'number' ? input.version : 1,
    submission_id: str(input.submission_id, 64) || crypto.randomUUID(),
    submitted_at: str(input.submitted_at, 40) || null,
    source_url: str(input.source_url, 500) || null,
    answers,
    sections
  };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const hasValue = (v: Answer | undefined) => (Array.isArray(v) ? v.length > 0 : !!v);
const oneLine = (s: string) => s.replace(/[\r\n]+/g, ' ').trim();
const humanize = (k: string) => k.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());
const display = (v: Answer | undefined) => (Array.isArray(v) ? v.join(', ') : v ?? '');

/* ---------- webhook payload ---------- */

function renderText(b: Brief): string {
  const a = b.answers;
  const lines = [
    `Website brief from ${a.name} at ${a.business}`,
    `Email: ${a.email}${a.phone ? `   Phone: ${a.phone}` : ''}`,
    `Content folder: ${display(a.folder_status)}`,
    ...(a.folder_links ? [`Folder links:\n${a.folder_links}`] : []),
    `Submission: ${b.submission_id}`,
    ''
  ];
  for (const s of b.sections) {
    const rows = s.fields.filter(f => hasValue(a[f.key]));
    lines.push(s.title.toUpperCase(), '-'.repeat(40));
    if (!rows.length) lines.push('(nothing entered)');
    for (const f of rows) {
      const v = display(a[f.key]);
      lines.push(v.includes('\n') ? `${f.label}:\n${v}` : `${f.label}: ${v}`);
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

// Flat, string-valued fields map cleanly onto contact and custom fields in a GoHighLevel workflow.
function webhookPayload(b: Brief, country: string | null) {
  const a = b.answers;
  const fullName = oneLine(String(a.name ?? ''));
  const [firstName, ...rest] = fullName.split(/\s+/);
  const answers: Record<string, string> = {};
  for (const [k, v] of Object.entries(a)) answers[k] = display(v);
  return {
    form: b.form,
    version: b.version,
    submission_id: b.submission_id,
    submitted_at: b.submitted_at,
    received_at: new Date().toISOString(),
    source_url: b.source_url,
    country,
    first_name: firstName ?? '',
    last_name: rest.join(' '),
    full_name: fullName,
    email: display(a.email),
    phone: display(a.phone),
    company_name: display(a.business),
    website: display(a.current_site),
    answers,
    brief_summary: renderText(b)
  };
}
