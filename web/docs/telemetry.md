# Telemetry & Analytics

This document covers:

1. [What we track and why](#1-what-we-track-and-why)
2. [Provider: Plausible](#2-provider-plausible)
3. [Architecture: swapping providers](#3-architecture-swapping-providers)
4. [Setup & configuration](#4-setup--configuration)

---

## 1. What We Track and Why

We use privacy-first, cookieless analytics. No cookie banner is required.  
**No PII beyond the email voluntarily submitted through the waitlist form is ever collected.**

### Tier 1 — Conversion Funnel (Most Important)

These events directly measure whether the landing page converts visitors into leads.

| Event               | Fired when                                                   | Purpose                           |
| ------------------- | ------------------------------------------------------------ | --------------------------------- |
| `waitlist_open`     | Any "Book a Demo" / "Request Early Access" button is clicked | Measures CTA click-through intent |
| `waitlist_submit`   | Email is successfully saved to Supabase                      | Measures actual conversion        |
| `github_star_click` | "Star SAIFAC on GitHub" is clicked in the post-submit step   | Measures double-CTA effectiveness |

**Key ratio:** `waitlist_submit / waitlist_open` = form conversion rate.  
Low ratio → investigate form friction (copy, trust, load time).  
Low `waitlist_open` → investigate above-the-fold CTA visibility.

### Tier 2 — Section Engagement

Fires once per session when the user's viewport crosses a section (20% threshold).
Tells you which sections people actually read vs. where they drop off.

| Event          | Props                    | Section                              |
| -------------- | ------------------------ | ------------------------------------ |
| `section_view` | `section: 'gauntlet'`    | The Gauntlet / Pipeline Architecture |
| `section_view` | `section: 'guarantee'`   | The Three Guarantees                 |
| `section_view` | `section: 'prove_it'`    | Prove It / Terminal Demo             |
| `section_view` | `section: 'features'`    | Feature Grid                         |
| `section_view` | `section: 'deploy'`      | Deployment Tiers                     |
| `section_view` | `section: 'security'`    | Zero-Trust Security Table            |
| `section_view` | `section: 'reliability'` | Reliability Table                    |
| `section_view` | `section: 'vscode'`      | VSCode Extension                     |
| `section_view` | `section: 'cta'`         | Final CTA                            |

### Tier 3 — Feature Interest

| Event                 | Props                                  | Answers                                          |
| --------------------- | -------------------------------------- | ------------------------------------------------ |
| `pipeline_step_click` | `step: 'Proposal'` (or any step title) | Which pipeline stages interest visitors most?    |
| `outbound_click`      | `destination: 'install_cli'`           | How many IC-persona visitors self-serve?         |
| `outbound_click`      | `destination: 'github_repo'`           | General GitHub interest                          |
| `outbound_click`      | `destination: 'security_docs'`         | Are CTOs reading the security deep-dive?         |
| `outbound_click`      | `destination: 'prove_docs'`            | Are skeptical ICs following up on the proof CTA? |
| `outbound_click`      | `destination: 'vscode_extension'`      | Interest in the extension before it ships        |

Full list of `OutboundDestination` values: `install_cli`, `github_repo`, `github_star`, `security_docs`, `prove_docs`, `vscode_extension`, `changelog`, `docs`, `cli_reference`, `leash`, `cedar_policy`.

---

## 2. Provider: Plausible

We use [Plausible Analytics](https://plausible.io) — an EU-based, open-source, cookieless analytics platform.

**Why Plausible:**

- No cookies → no consent banner required (GDPR-compliant by design).
- Data hosted in the EU.
- Open source — can be self-hosted for $0/mo.
- Actively hostile to ad-blocker circumvention tricks (unlike GA).

**Integration:** [`next-plausible`](https://github.com/4lejandrito/next-plausible) npm package.

### Self-hosting vs. Cloud

| Option               | Cost                        | Effort     |
| -------------------- | --------------------------- | ---------- |
| Plausible Cloud      | $9/mo (up to 10k pageviews) | Zero infra |
| Self-hosted (Docker) | ~$5/mo VPS                  | ~1hr setup |

Self-hosted is cheaper long-term and keeps all data on your own infrastructure. See [Plausible self-hosting docs](https://plausible.io/docs/self-hosting).

---

## 3. Architecture: Swapping Providers

All event tracking flows through a thin abstraction in `src/lib/analytics.ts`.

```
component
  └─ track('waitlist_submit')
        └─ analytics.ts → plausibleAdapter.track(...) → window.plausible('waitlist_submit')
```

Plausible’s script (loaded by `PlausibleProvider` in layout) exposes `window.plausible`. The adapter in `analytics.ts` calls it directly — no React context or hooks.

### The two files to change when swapping providers

| File                   | Role                                                                                      |
| ---------------------- | ----------------------------------------------------------------------------------------- |
| `src/lib/analytics.ts` | Event catalogue + `AnalyticsAdapter` interface + `track()` public API + Plausible adapter |
| `src/app/layout.tsx`   | Wraps the app in `<PlausibleProvider>` to load the script                                 |

**To swap to a different provider (e.g. Fathom, PostHog, custom):**

1. In `analytics.ts`, replace `plausibleAdapter` with an adapter that calls your provider’s SDK (or call `setAnalyticsAdapter()` at app boot).
2. Replace `<PlausibleProvider>` in `layout.tsx` with your provider’s script wrapper (or a plain `<Script>` tag).
3. No changes to `page.tsx` or `WaitlistModal.tsx`.

### The `AnalyticsAdapter` interface

```typescript
export interface AnalyticsAdapter {
  track(event: string, props?: Record<string, any>): void;
}
```

### The `track()` call signature

`track()` is fully typed. TypeScript will error if you pass wrong props for a given event:

```typescript
track('waitlist_submit'); // ✓ no props needed
track('outbound_click', { destination: 'install_cli' }); // ✓ typed destination
track('outbound_click', { destination: 'typo' }); // ✗ type error
track('section_view', { section: 'security' }); // ✓ typed section
```

To add a new event, add it to the `AnalyticsEvents` type in `analytics.ts`:

```typescript
export type AnalyticsEvents = {
  // ...existing events...
  my_new_event: { someProperty: string }; // add here
};
```

TypeScript will then require the correct props wherever `track('my_new_event', ...)` is called.

---

## 4. Setup & Configuration

### Environment variables

| Variable                       | Required      | Description                                                                                  |
| ------------------------------ | ------------- | -------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_PLAUSIBLE_DOMAIN` | Yes (in prod) | Your site's domain, e.g. `safeaifactory.com`. Leave empty to disable analytics in local dev. |

Set in `.env.local` (copy from `.env.local.example`).

### Plausible dashboard setup (Cloud)

1. Create an account at [plausible.io](https://plausible.io).
2. Add a new site with your domain.
3. Set `NEXT_PUBLIC_PLAUSIBLE_DOMAIN=yourdomain.com` in your hosting environment.
4. Deploy. Plausible will start receiving events automatically.

### Registering custom event goals in Plausible

Plausible requires you to manually register custom event names in the dashboard before they appear in reports.

Go to: **Site settings → Goals → Add goal → Custom event** and add:

- `waitlist_open`
- `waitlist_submit`
- `github_star_click`
- `outbound_click`
- `section_view`
- `pipeline_step_click`

### Verifying events locally

To test events locally without deploying, set `trackLocalhost` on the `PlausibleProvider` in `layout.tsx`:

```tsx
<PlausibleProvider domain={domain} trackLocalhost enabled={!!domain}>
```

Then open the Plausible dashboard → Realtime to see events arrive.
