/**
 * Analytics abstraction layer.
 *
 * All event tracking in the app goes through `track()`. The underlying
 * provider (currently Plausible) is wired up separately. Swapping providers
 * means updating only this file — no React context needed
 * in components.
 *
 * Usage:
 *   import { track } from '@/lib/analytics';
 *   track('waitlist_submit');
 *   track('outbound_click', { destination: 'install_cli' });
 */

import { plausibleAdapter } from './adaptors/plausible';
import { type AnalyticsAdapter, type AnalyticsEvents } from './types';

const _adapter: AnalyticsAdapter = plausibleAdapter;

// ─── Public API ───────────────────────────────────────────────────────────────

type EventProps<E extends keyof AnalyticsEvents> = AnalyticsEvents[E];

/** Overloads give per-event type safety at the call site. */
export function track<E extends keyof AnalyticsEvents>(
  event: E,
  ...args: EventProps<E> extends never ? [] : [props: EventProps<E>]
): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _adapter.track(event, args[0] as Record<string, any> | undefined);
}
