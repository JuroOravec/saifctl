// ─── Event catalogue ─────────────────────────────────────────────────────────

/** Every tracked event and its allowed properties. */
export type AnalyticsEvents = {
  // Waitlist funnel
  waitlist_open: never;
  waitlist_submit: never;
  github_star_click: never;

  // Outbound link clicks (external URLs)
  outbound_click: { destination: OutboundDestination };

  // Internal CTA clicks (in-app navigation to tutorials, marketing pages, etc.)
  cta_click: { destination: CtaDestination };

  // Section engagement (fires once per session per section)
  section_view: { section: SectionId };

  // Pipeline diagram interaction
  pipeline_step_click: { step: string };
};

export type OutboundDestination =
  | 'install_cli'
  | 'github_repo'
  | 'github_star'
  | 'security_docs'
  | 'prove_docs'
  | 'vscode_extension'
  | 'changelog'
  | 'docs'
  | 'cli_reference'
  | 'leash'
  | 'cedar_policy';

export type CtaDestination = 'sandbox_tutorial' | 'factory_tutorial';

export type SectionId =
  | 'modes'
  | 'gauntlet'
  | 'guarantee'
  | 'prove_it'
  | 'features'
  | 'deploy'
  | 'security'
  | 'reliability'
  | 'vscode'
  | 'glass_pipeline'
  | 'cta';

// ─── Adapter interface ────────────────────────────────────────────────────────

export interface AnalyticsAdapter {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  track(event: string, props?: Record<string, any>): void;
}
