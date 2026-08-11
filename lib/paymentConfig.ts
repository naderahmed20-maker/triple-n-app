// lib/paymentConfig.ts

/* =========================================================
 * Triple N Payments
 *
 * Central payment configuration.
 *
 * IMPORTANT:
 *
 * - Real payments are intentionally disabled for now.
 * - The complete payment flow can still be tested.
 * - In development preview mode, Continue enters the app
 *   without charging the user.
 *
 * Production provider priority:
 *
 *   Stripe -> Apple IAP -> Google Play Billing
 *
 * Stripe is preferred ONLY when it is legally and
 * platform/store-policy eligible for that purchase.
 * ======================================================= */

/* =========================================================
 * Payment environment
 * ======================================================= */

export type PaymentEnvironment =
  | 'development'
  | 'sandbox'
  | 'production';

/**
 * CURRENT STATE
 *
 * Keep this as "development" until we are ready to connect
 * real payment providers.
 */
export const PAYMENT_ENVIRONMENT:
  PaymentEnvironment =
    'development';

/* =========================================================
 * Master switches
 * ======================================================= */

/**
 * Enables actual charging.
 *
 * MUST remain false for now.
 */
export const REAL_PAYMENTS_ENABLED =
  false;

/**
 * Controls whether subscription/payment access is required
 * before entering Triple N.
 *
 * CURRENT DEVELOPMENT STATE:
 *
 * true:
 * user must pass through the paywall after login.
 *
 * Because REAL_PAYMENTS_ENABLED is false and
 * ALLOW_DEVELOPMENT_CONTINUE is true,
 * Continue grants temporary development access
 * without charging any money.
 *
 * Production will keep this true, but access will then
 * require a real verified subscription.
 */
export const SUBSCRIPTION_GATE_ENFORCED =
  true;

/**
 * Development-only bypass.
 *
 * When:
 *
 * REAL_PAYMENTS_ENABLED === false
 * and
 * ALLOW_DEVELOPMENT_CONTINUE === true
 *
 * the Continue button simulates a successful checkout
 * and sends the developer/user into the app.
 *
 * This MUST be disabled before production.
 */
export const ALLOW_DEVELOPMENT_CONTINUE =
  true;

/* =========================================================
 * Plans
 * ======================================================= */

export type TripleNPlanId =
  | 'monthly'
  | 'yearly';

export type TripleNPlan = {
  id:
    TripleNPlanId;

  name:
    string;

  priceLabel:
    string;

  billingLabel:
    string;

  description:
    string;

  badge:
    string | null;

  /**
   * Provider product IDs are intentionally null until
   * the real products are created.
   */
  stripePriceId:
    string | null;

  appleProductId:
    string | null;

  googleProductId:
    string | null;
};

export const TRIPLE_N_PLANS:
  readonly TripleNPlan[] = [
    {
      id:
        'monthly',

      name:
        'Monthly',

      /**
       * Preview price only.
       *
       * Final production prices will come from the
       * payment provider/store, not from UI hard-coding.
       */
      priceLabel:
        '€4.99',

      billingLabel:
        'per month',

      description:
        'Full access with complete flexibility.',

      badge:
        null,

      stripePriceId:
        null,

      appleProductId:
        null,

      googleProductId:
        null,
    },

    {
      id:
        'yearly',

      name:
        'Yearly',

      priceLabel:
        '€39.99',

      billingLabel:
        'per year',

      description:
        'The best value for the complete Triple N experience.',

      badge:
        'BEST VALUE',

      stripePriceId:
        null,

      appleProductId:
        null,

      googleProductId:
        null,
    },
  ] as const;

/* =========================================================
 * Payment providers
 * ======================================================= */

export type PaymentProvider =
  | 'stripe'
  | 'apple'
  | 'google';

/**
 * IMPORTANT:
 *
 * This means preference, NOT unconditional availability.
 *
 * The future Payment Provider Resolver will:
 *
 * 1. Determine which providers are eligible.
 * 2. Remove providers that are not allowed/available.
 * 3. Apply this priority to the remaining providers.
 *
 * Therefore:
 *
 * Stripe + Apple available
 * -> Stripe
 *
 * Stripe + Google available
 * -> Stripe
 *
 * Stripe unavailable on iOS
 * -> Apple
 *
 * Stripe unavailable on Android
 * -> Google
 */
export const PAYMENT_PROVIDER_PRIORITY:
  readonly PaymentProvider[] = [
    'stripe',
    'apple',
    'google',
  ] as const;

/* =========================================================
 * Subscription status
 * ======================================================= */

export type SubscriptionStatus =
  | 'unknown'
  | 'inactive'
  | 'pending'
  | 'active'
  | 'past_due'
  | 'cancelled'
  | 'expired';

export type SubscriptionRecord = {
  status:
    SubscriptionStatus;

  planId:
    TripleNPlanId | null;

  provider:
    PaymentProvider | null;

  expiresAt:
    string | null;

  willRenew:
    boolean | null;
};

/* =========================================================
 * Development preview
 * ======================================================= */

/**
 * Whether Continue is currently allowed to move forward.
 */
export function canContinueFromPaywall():
  boolean {
  if (
    REAL_PAYMENTS_ENABLED
  ) {
    return true;
  }

  return (
    PAYMENT_ENVIRONMENT ===
      'development' &&
    ALLOW_DEVELOPMENT_CONTINUE
  );
}

/**
 * Whether pressing Continue should actually start a
 * provider checkout.
 */
export function shouldStartRealCheckout():
  boolean {
  return (
    REAL_PAYMENTS_ENABLED &&
    PAYMENT_ENVIRONMENT !==
      'development'
  );
}

/**
 * Safety assertion for future production builds.
 *
 * We'll call this during the final payment initialization.
 */
export function assertPaymentConfigurationSafe():
  void {
  if (
    PAYMENT_ENVIRONMENT ===
      'production' &&
    ALLOW_DEVELOPMENT_CONTINUE
  ) {
    throw new Error(
      'Unsafe payment configuration: development payment bypass is enabled in production.'
    );
  }

  if (
    PAYMENT_ENVIRONMENT ===
      'production' &&
    !REAL_PAYMENTS_ENABLED
  ) {
    throw new Error(
      'Unsafe payment configuration: production environment is configured while real payments are disabled.'
    );
  }
}