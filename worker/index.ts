// Receives website-brief submissions and emails them to TO_EMAIL.
// It has no public URL: the Pages site forwards /api/brief here through a service binding
// (functions/api/brief.ts), because Pages Functions can't use the send_email or rate-limit bindings.

const MAX_BODY_BYTES = 64 * 1024;
const MAX_TEXT = 5000;
const MAX_LIST_ITEMS = 40;
const MAX_LIST_ITEM = 200;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

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

  const received = {
    ...brief,
    received_at: new Date().toISOString(),
    country: (request as Request & { cf?: { country?: string } }).cf?.country ?? null
  };

  try {
    await env.EMAIL.send({
      to: env.TO_EMAIL,
      from: { email: env.FROM_EMAIL, name: 'Websquire Briefs' },
      replyTo: { email: clientEmail, name: oneLine(brief.answers.name as string) },
      subject: oneLine(`New website brief: ${brief.answers.business} (${brief.answers.name})`).slice(0, 200),
      text: renderText(brief),
      html: renderHtml(brief),
      attachments: [{
        content: JSON.stringify(received, null, 2),
        filename: `brief-${slug(brief.answers.business as string)}-${received.received_at.slice(0, 10)}.json`,
        type: 'application/json',
        disposition: 'attachment'
      }]
    });
  } catch (err) {
    const e = err as { code?: string; message?: string };
    console.error('brief email failed', { code: e.code, message: e.message, submission_id: brief.submission_id });
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
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'client';
const display = (v: Answer | undefined) => (Array.isArray(v) ? v.join(', ') : v ?? '');

/* ---------- email rendering ---------- */

function renderText(b: Brief): string {
  const a = b.answers;
  const lines = [
    `New website brief from ${a.name} at ${a.business}`,
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
  lines.push('The full JSON payload is attached.');
  return lines.join('\n');
}

function renderHtml(b: Brief): string {
  const a = b.answers;
  const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
  const linkify = (s: string) => esc(s).replace(/https?:\/\/[^\s<]+/g, u => `<a href="${u}" style="color:#7a6a2e">${u}</a>`);
  const value = (v: Answer | undefined) => (Array.isArray(v) ? v.map(esc).join(' &middot; ') : linkify(v ?? '').replace(/\n/g, '<br>'));

  const summary: [string, string][] = [
    ['Contact', `${esc(String(a.name))}${a.role ? `, ${esc(String(a.role))}` : ''}`],
    ['Email', `<a href="mailto:${esc(String(a.email))}" style="color:#7a6a2e">${esc(String(a.email))}</a>`],
    ...(a.phone ? [['Phone', esc(String(a.phone))] as [string, string]] : []),
    ...(a.contact_pref ? [['Prefers', esc(String(a.contact_pref))] as [string, string]] : []),
    ['Content folder', value(a.folder_status)],
    ...(a.folder_links ? [['Folder links', value(a.folder_links)] as [string, string]] : [])
  ];

  const row = (label: string, html: string) =>
    `<tr><td style="padding:8px 16px 8px 0;vertical-align:top;color:#6b6b74;font-size:13px;width:180px">${esc(label)}</td>` +
    `<td style="padding:8px 0;vertical-align:top;font-size:14px;color:#18181b">${html}</td></tr>`;

  const sections = b.sections.map(s => {
    const rows = s.fields.filter(f => hasValue(a[f.key]));
    const body = rows.length
      ? rows.map(f => row(f.label, value(a[f.key]))).join('')
      : `<tr><td colspan="2" style="padding:8px 0;color:#9a9aa3;font-size:13px">Nothing entered</td></tr>`;
    return `<h3 style="margin:28px 0 4px;font-size:15px;color:#18181b;border-bottom:1px solid #e4e4e7;padding-bottom:6px">${esc(s.title)}</h3>` +
      `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse">${body}</table>`;
  }).join('');

  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f4f4f5;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif">
<div style="max-width:680px;margin:0 auto;background:#fff;border-radius:10px;padding:28px 32px">
<p style="margin:0 0 4px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#a1914f">New website brief</p>
<h2 style="margin:0 0 20px;font-size:22px;color:#18181b">${esc(String(a.business))}</h2>
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;background:#fafaf7;border-radius:8px">${summary.map(([l, h]) => row(l, h)).join('')}</table>
${sections}
<p style="margin:28px 0 0;font-size:12px;color:#9a9aa3">Submission ${esc(b.submission_id)}. The full JSON payload is attached. Reply to this email to answer ${esc(String(a.name))} directly.</p>
</div></body></html>`;
}
