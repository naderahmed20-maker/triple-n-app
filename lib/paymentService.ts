// lib/paymentService.ts

import {
    ALLOW_DEVELOPMENT_CONTINUE,
    PAYMENT_ENVIRONMENT,
    REAL_PAYMENTS_ENABLED,
    type PaymentProvider,
    type TripleNPlanId,
} from '@/lib/paymentConfig';

import {
    resolveDevelopmentPaymentProvider,
    resolvePaymentProvider,
    type PaymentProviderCapabilityInput,
} from '@/lib/paymentProviderResolver';

import type {
    PaymentCheckoutResult,
    PaymentProviderResolution,
    StartCheckoutInput,
} from '@/lib/paymentTypes';

/* =========================================================
 * Checkout request
 * ======================================================= */

export type TripleNCheckoutRequest = {
  userId:
    string;

  planId:
    TripleNPlanId;

  /**
   * Optional capabilities.
   *
   * Development:
   * usually omitted.
   *
   * Production:
   * supplied by the real eligibility layer.
   */
  capabilities?:
    PaymentProviderCapabilityInput;
};

/* =========================================================
 * Provider resolution
 * ======================================================= */

export function resolveCheckoutProvider(
  request:
    TripleNCheckoutRequest
): PaymentProviderResolution {
  if (
    request.capabilities
  ) {
    return resolvePaymentProvider(
      request.capabilities
    );
  }

  return resolveDevelopmentPaymentProvider();
}

/* =========================================================
 * Development checkout
 * ======================================================= */

function createDevelopmentCheckoutResult(
  planId:
    TripleNPlanId,
  provider:
    PaymentProvider
): PaymentCheckoutResult {
  return {
    status:
      'succeeded',

    provider,

    planId,

    transactionId:
      `development-${Date.now()}`,

    subscriptionId:
      `development-subscription-${Date.now()}`,

    errorCode:
      null,

    errorMessage:
      null,
  };
}

/* =========================================================
 * Real provider placeholders
 * ======================================================= */

async function startStripeCheckout(
  input:
    StartCheckoutInput
): Promise<PaymentCheckoutResult> {
  void input;

  return {
    status:
      'failed',

    provider:
      'stripe',

    planId:
      input.planId,

    transactionId:
      null,

    subscriptionId:
      null,

    errorCode:
      'STRIPE_NOT_CONNECTED',

    errorMessage:
      'Stripe checkout is not connected yet.',
  };
}

async function startAppleCheckout(
  input:
    StartCheckoutInput
): Promise<PaymentCheckoutResult> {
  void input;

  return {
    status:
      'failed',

    provider:
      'apple',

    planId:
      input.planId,

    transactionId:
      null,

    subscriptionId:
      null,

    errorCode:
      'APPLE_IAP_NOT_CONNECTED',

    errorMessage:
      'Apple In-App Purchase is not connected yet.',
  };
}

async function startGoogleCheckout(
  input:
    StartCheckoutInput
): Promise<PaymentCheckoutResult> {
  void input;

  return {
    status:
      'failed',

    provider:
      'google',

    planId:
      input.planId,

    transactionId:
      null,

    subscriptionId:
      null,

    errorCode:
      'GOOGLE_BILLING_NOT_CONNECTED',

    errorMessage:
      'Google Play Billing is not connected yet.',
  };
}

/* =========================================================
 * Provider dispatcher
 * ======================================================= */

async function startProviderCheckout(
  input:
    StartCheckoutInput
): Promise<PaymentCheckoutResult> {
  switch (
    input.provider
  ) {
    case 'stripe':
      return startStripeCheckout(
        input
      );

    case 'apple':
      return startAppleCheckout(
        input
      );

    case 'google':
      return startGoogleCheckout(
        input
      );

    default:
      return {
        status:
          'failed',

        provider:
          null,

        planId:
          input.planId,

        transactionId:
          null,

        subscriptionId:
          null,

        errorCode:
          'PAYMENT_PROVIDER_UNSUPPORTED',

        errorMessage:
          'No supported payment provider is available.',
      };
  }
}

/* =========================================================
 * Main checkout
 * ======================================================= */

export async function startCheckout(
  request:
    TripleNCheckoutRequest
): Promise<PaymentCheckoutResult> {
  if (
    !request.userId
      .trim()
  ) {
    return {
      status:
        'failed',

      provider:
        null,

      planId:
        request.planId,

      transactionId:
        null,

      subscriptionId:
        null,

      errorCode:
        'AUTHENTICATED_USER_REQUIRED',

      errorMessage:
        'An authenticated user is required before checkout.',
    };
  }

  const resolution =
    resolveCheckoutProvider(
      request
    );

  const provider =
    resolution
      .selectedProvider;

  if (
    !provider
  ) {
    return {
      status:
        'failed',

      provider:
        null,

      planId:
        request.planId,

      transactionId:
        null,

      subscriptionId:
        null,

      errorCode:
        'NO_ELIGIBLE_PAYMENT_PROVIDER',

      errorMessage:
        'No eligible payment provider is currently available.',
    };
  }

  /* -------------------------------------------------------
   * Development bypass
   * ----------------------------------------------------- */

  if (
    PAYMENT_ENVIRONMENT ===
      'development' &&
    !REAL_PAYMENTS_ENABLED &&
    ALLOW_DEVELOPMENT_CONTINUE
  ) {
    return createDevelopmentCheckoutResult(
      request.planId,
      provider
    );
  }

  /* -------------------------------------------------------
   * Safety check
   * ----------------------------------------------------- */

  if (
    !REAL_PAYMENTS_ENABLED
  ) {
    return {
      status:
        'failed',

      provider,

      planId:
        request.planId,

      transactionId:
        null,

      subscriptionId:
        null,

      errorCode:
        'REAL_PAYMENTS_DISABLED',

      errorMessage:
        'Real payments are currently disabled.',
    };
  }

  /* -------------------------------------------------------
   * Real checkout
   * ----------------------------------------------------- */

  return startProviderCheckout({
    userId:
      request.userId,

    planId:
      request.planId,

    provider,
  });
}

/* =========================================================
 * Checkout helpers
 * ======================================================= */

export function isCheckoutSuccessful(
  result:
    PaymentCheckoutResult
): boolean {
  return (
    result.status ===
    'succeeded'
  );
}

export function isCheckoutCancelled(
  result:
    PaymentCheckoutResult
): boolean {
  return (
    result.status ===
    'cancelled'
  );
}

export function isCheckoutPending(
  result:
    PaymentCheckoutResult
): boolean {
  return (
    result.status ===
    'pending'
  );
}