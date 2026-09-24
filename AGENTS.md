# Working in this repository

This repository is the source of truth for the website **Websquire Custom Site Form** (served at `websquire-custom-site-form.ocknopages.com`).
Ockno renders it: every push to the default branch is synced and goes live for the pages the
manifest marks `published`. Nothing here needs a build step.

## Layout

- `pages/<route>.html` - one complete HTML document per page. `pages/index.html` is `/`,
  `pages/about.html` is `/about`, `pages/blog/post.html` is `/blog/post`.
- `assets/...` - static files. A page references them root-relative: `assets/css/site.css`
  is `/css/site.css` in the page.
- `ockno.config.json` - the manifest: routes, `published` flags, and a read-only mirror of the
  tracking bindings Ockno manages.
- `AGENTS.md`, `CLAUDE.md`, `README.md` - these notes. Ockno rewrites them.

## Rules the renderer enforces

1. **No `<script>` tags, inline `on*=` handlers, `<iframe>`, `<embed>` or `<object>`** in
   `pages/*.html`. Behavior belongs to Ockno's runtime (forms, booking, number swap, pixels).
   A page that breaks this rule is refused at sync: the last good version keeps serving and the
   page is flagged in Ockno until the next push validates.
2. **Keep `<meta name="ockno-page" content="...">` exactly as it is** in every page. It is the
   page's identity across renames and moves; captures, views and experiments join on it.

## How Ockno features are written

- A lead form is a container with `data-ockno-form` (give it `data-ockno-name="quote"` when a
  page has more than one), inputs with `data-ockno-field="email|phone|first_name|last_name|full_name|company|city|..."`
  (or `data-ockno-field="custom:anything"`), a `data-ockno-submit` button, and, beside any phone
  field, an unchecked `data-ockno-consent` checkbox. At least one of email / phone / a name is
  required. Ockno's runtime owns validation and submission; never add your own.
- A booking calendar: `<div data-ockno-booking="calendar-slug"></div>` (leave it empty).
- A hosted form or survey authored in Ockno: `<div data-ockno-form-embed="form-slug"></div>`.
- Tailwind utility classes work as-is; Ockno compiles them on sync. Custom CSS goes in `assets/`.
- To publish or unpublish a page, flip its `published` flag in `ockno.config.json`.

## What to leave alone

- Ockno owns `ockno.config.json`'s `bindings_readonly` block and `AGENTS.md`; edits there are
  overwritten on the next publish from Ockno. `CLAUDE.md`, `README.md` and
  `.cursor/rules/ockno.mdc` are written once and then yours.
- Ockno only ever writes under `pages/`, `assets/` and its own files. Anything else you add
  (a `.github/` workflow, docs) is yours.
- Never commit secrets or credentials.

## Checks on every push

Ockno posts a check on every commit it syncs. Green: every page validated and went live. Red:
a page was refused (the check names the file and the line); the last good version of that
page keeps serving until the next push validates. A repository that turns into a framework
project (a `package.json` with Astro, Next.js, Vite, ...) gets an "action required" check:
Ockno keeps serving the last good pages and recommends switching the site to external hosting
(Ockno → the site → Repository → Hosting → My own host). Ockno never flips that itself.

The same rules run anywhere with `npx @ockno/site check .` (see the package README), and as a
GitHub Action (`uses: ockno/site@v1`) on pull requests.

## Hosting it yourself (external)

If this site needs its own JavaScript or a build step, switch it to external hosting in Ockno.
Then the contract is: one script tag on every page, once before `</body>`:

    Ockno → Web → Tracking → Site tag gives the token for this workspace

plus the `data-ockno-*` attributes and `ockno-page` meta above, in the BUILT output. Run the
check against that output in CI (`npx @ockno/site check dist`). `@ockno/site/react` ships typed
helpers (`<OcknoForm>`, `<OcknoField>`, `<OcknoConsent>`, `<OcknoSubmit>`, `<OcknoBooking>`,
`<OcknoFormEmbed>`, `<OcknoScript>`) that render exactly this markup.
