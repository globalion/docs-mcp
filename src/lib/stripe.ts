import Stripe from "stripe";

/**
 * Lazy singleton. If STRIPE_SECRET_KEY isn't set, getStripe() returns null so
 * the dashboard can render "billing coming soon" instead of crashing. This is
 * the state on fresh deploys before Pawan pastes the test key in.
 */
let _client: Stripe | null | undefined;

export function getStripe(): Stripe | null {
  if (_client !== undefined) return _client;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    _client = null;
    return null;
  }
  _client = new Stripe(key, { apiVersion: "2026-06-24.dahlia" });
  return _client;
}

export function isStripeConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}
