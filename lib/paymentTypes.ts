// lib/paymentTypes.ts

import type {
  PaymentProvider,
  SubscriptionStatus,
  TripleNPlanId,
} from '@/lib/paymentConfig';

/* =========================================================
 * Checkout result
 * ======================================================= */

export type PaymentCheckoutStatus =
  | 'idle'
  | 'starting'
  | 'pending'
  | 'succeeded'
  | 'cancelled'
  | 'failed';

export type PaymentCheckoutResult = {
  status:
    PaymentCheckoutStatus;

  provider:
    PaymentProvider | null;

  planId:
    TripleNPlanId | null;

  /**
   * Secure hosted checkout URL returned by the payment
   * backend.
   *
   * For Stripe this is the Stripe Checkout Session URL.
   */
  checkoutUrl:
    string | null;

  /**
   * Provider transaction / checkout-session identifier.
   *
   * Stripe:
   * Checkout Session ID until the webhook records later
   * invoice/payment identifiers.
   */
  transactionId:
    string | null;

  /**
   * Provider subscription identifier when it is already
   * available to the client.
   *
   * Stripe normally establishes the authoritative
   * subscription ID through the webhook/backend.
   */
  subscriptionId:
    string | null;

  errorCode:
    string | null;

  errorMessage:
    string | null;
};

/* =========================================================
 * Provider eligibility
 * ======================================================= */

export type PaymentProviderEligibilityReason =
  | 'eligible'
  | 'unsupported-platform'
  | 'unsupported-region'
  | 'provider-disabled'
  | 'provider-not-configured'
  | 'store-policy-restricted'
  | 'storefront-unavailable'
  | 'network-unavailable'
  | 'unknown';

export type PaymentProviderEligibility = {
  provider:
    PaymentProvider;

  eligible:
    boolean;

  reason:
    PaymentProviderEligibilityReason;

  message:
    string | null;
};

/* =========================================================
 * Provider resolution
 * ======================================================= */

export type PaymentProviderResolution = {
  selectedProvider:
    PaymentProvider | null;

  eligibleProviders:
    PaymentProvider[];

  evaluations:
    PaymentProviderEligibility[];

  resolvedAt:
    string;
};

/* =========================================================
 * Subscription state
 * ======================================================= */

export type TripleNSubscription = {
  status:
    SubscriptionStatus;

  planId:
    TripleNPlanId | null;

  provider:
    PaymentProvider | null;

  startedAt:
    string | null;

  currentPeriodStart:
    string | null;

  currentPeriodEnd:
    string | null;

  cancelledAt:
    string | null;

  expiresAt:
    string | null;

  willRenew:
    boolean | null;

  providerSubscriptionId:
    string | null;

  providerCustomerId:
    string | null;

  lastVerifiedAt:
    string | null;
};

/* =========================================================
 * Subscription access
 * ======================================================= */

export type SubscriptionAccessStatus =
  | 'checking'
  | 'allowed'
  | 'blocked'
  | 'error';

export type SubscriptionAccessResult = {
  status:
    SubscriptionAccessStatus;

  hasAccess:
    boolean;

  subscription:
    TripleNSubscription | null;

  reason:
    string | null;
};

/* =========================================================
 * Purchase input
 * ======================================================= */

export type StartCheckoutInput = {
  userId:
    string;

  planId:
    TripleNPlanId;

  provider:
    PaymentProvider;
};

/* =========================================================
 * Restore purchases
 * ======================================================= */

export type RestorePurchasesResult = {
  restored:
    boolean;

  provider:
    PaymentProvider | null;

  subscription:
    TripleNSubscription | null;

  errorCode:
    string | null;

  errorMessage:
    string | null;
};

/* =========================================================
 * Shared empty/default values
 * ======================================================= */

export const EMPTY_CHECKOUT_RESULT:
  PaymentCheckoutResult = {
  status:
    'idle',

  provider:
    null,

  planId:
    null,

  checkoutUrl:
    null,

  transactionId:
    null,

  subscriptionId:
    null,

  errorCode:
    null,

  errorMessage:
    null,
};

export const EMPTY_SUBSCRIPTION:
  TripleNSubscription = {
  status:
    'unknown',

  planId:
    null,

  provider:
    null,

  startedAt:
    null,

  currentPeriodStart:
    null,

  currentPeriodEnd:
    null,

  cancelledAt:
    null,

  expiresAt:
    null,

  willRenew:
    null,

  providerSubscriptionId:
    null,

  providerCustomerId:
    null,

  lastVerifiedAt:
    null,
};