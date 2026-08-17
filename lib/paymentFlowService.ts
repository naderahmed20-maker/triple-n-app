// lib/paymentFlowService.ts

import {
  PAYMENT_ENVIRONMENT,
  REAL_PAYMENTS_ENABLED,
  type PaymentProvider,
  type TripleNPlanId,
} from '@/lib/paymentConfig';

import {
  isCheckoutCancelled,
  isCheckoutPending,
  isCheckoutSuccessful,
  startCheckout,
} from '@/lib/paymentService';

import {
  grantDevelopmentPaymentAccess,
} from '@/lib/subscriptionService';

import type {
  PaymentCheckoutResult,
} from '@/lib/paymentTypes';

/* =========================================================
 * Flow types
 * ======================================================= */

export type PaymentFlowStatus =
  | 'succeeded'
  | 'pending'
  | 'cancelled'
  | 'failed';

export type PaymentFlowResult = {
  status:
    PaymentFlowStatus;

  allowAppEntry:
    boolean;

  provider:
    PaymentProvider | null;

  planId:
    TripleNPlanId;

  checkout:
    PaymentCheckoutResult;

  developmentBypass:
    boolean;

  errorCode:
    string | null;

  errorMessage:
    string | null;
};

export type StartPaymentFlowInput = {
  userId:
    string;

  planId:
    TripleNPlanId;
};

/* =========================================================
 * Helpers
 * ======================================================= */

function isDevelopmentBypassCheckout():
  boolean {
  return (
    PAYMENT_ENVIRONMENT ===
      'development' &&
    !REAL_PAYMENTS_ENABLED
  );
}

/* =========================================================
 * Failed checkout helper
 * ======================================================= */

function createFailedCheckout(
  planId:
    TripleNPlanId,
  errorCode:
    string,
  errorMessage:
    string
): PaymentCheckoutResult {
  return {
    status:
      'failed',

    provider:
      null,

    planId,

    checkoutUrl:
      null,

    transactionId:
      null,

    subscriptionId:
      null,

    errorCode,

    errorMessage,
  };
}

/* =========================================================
 * Main payment flow
 * ======================================================= */

export async function startPaymentFlow(
  input:
    StartPaymentFlowInput
): Promise<PaymentFlowResult> {
  const userId =
    input.userId
      .trim();

  /* -------------------------------------------------------
   * Authentication guard
   * ----------------------------------------------------- */

  if (
    !userId
  ) {
    const checkout =
      createFailedCheckout(
        input.planId,
        'AUTHENTICATED_USER_REQUIRED',
        'You must be signed in before continuing.'
      );

    return {
      status:
        'failed',

      allowAppEntry:
        false,

      provider:
        null,

      planId:
        input.planId,

      checkout,

      developmentBypass:
        false,

      errorCode:
        checkout.errorCode,

      errorMessage:
        checkout.errorMessage,
    };
  }

  try {
    /* -----------------------------------------------------
     * Start checkout
     * --------------------------------------------------- */

    const checkout =
      await startCheckout({
        userId,

        planId:
          input.planId,
      });

    /* -----------------------------------------------------
     * Cancelled
     * --------------------------------------------------- */

    if (
      isCheckoutCancelled(
        checkout
      )
    ) {
      return {
        status:
          'cancelled',

        allowAppEntry:
          false,

        provider:
          checkout.provider,

        planId:
          input.planId,

        checkout,

        developmentBypass:
          false,

        errorCode:
          null,

        errorMessage:
          null,
      };
    }

    /* -----------------------------------------------------
     * Pending
     * --------------------------------------------------- */

    if (
      isCheckoutPending(
        checkout
      )
    ) {
      return {
        status:
          'pending',

        allowAppEntry:
          false,

        provider:
          checkout.provider,

        planId:
          input.planId,

        checkout,

        developmentBypass:
          false,

        errorCode:
          null,

        errorMessage:
          null,
      };
    }

    /* -----------------------------------------------------
     * Failed
     * --------------------------------------------------- */

    if (
      !isCheckoutSuccessful(
        checkout
      )
    ) {
      return {
        status:
          'failed',

        allowAppEntry:
          false,

        provider:
          checkout.provider,

        planId:
          input.planId,

        checkout,

        developmentBypass:
          false,

        errorCode:
          checkout.errorCode ??
          'CHECKOUT_FAILED',

        errorMessage:
          checkout.errorMessage ??
          'The checkout could not be completed.',
      };
    }

    /* -----------------------------------------------------
     * Development bypass
     * --------------------------------------------------- */

    const developmentBypass =
      isDevelopmentBypassCheckout();

    if (
      developmentBypass
    ) {
      await grantDevelopmentPaymentAccess(
        userId
      );

      return {
        status:
          'succeeded',

        allowAppEntry:
          true,

        provider:
          checkout.provider,

        planId:
          input.planId,

        checkout,

        developmentBypass:
          true,

        errorCode:
          null,

        errorMessage:
          null,
      };
    }

    /* -----------------------------------------------------
     * Production payment
     * -----------------------------------------------------
     *
     * A successful Stripe Checkout redirect does NOT by
     * itself grant subscription access.
     *
     * Stripe:
     *
     * Checkout
     *   -> Stripe webhook
     *   -> Supabase subscriptions table
     *   -> verified active subscription
     *
     * The backend remains the source of truth.
     *
     * Therefore the client remains pending here until
     * subscription verification confirms access.
     * --------------------------------------------------- */

    return {
      status:
        'pending',

      allowAppEntry:
        false,

      provider:
        checkout.provider,

      planId:
        input.planId,

      checkout,

      developmentBypass:
        false,

      errorCode:
        null,

      errorMessage:
        null,
    };
  } catch (
    error:
      unknown
  ) {
    const errorMessage =
      error instanceof Error
        ? error.message
        : 'The payment flow failed unexpectedly.';

    const checkout =
      createFailedCheckout(
        input.planId,
        'PAYMENT_FLOW_FAILED',
        errorMessage
      );

    return {
      status:
        'failed',

      allowAppEntry:
        false,

      provider:
        null,

      planId:
        input.planId,

      checkout,

      developmentBypass:
        false,

      errorCode:
        checkout.errorCode,

      errorMessage:
        checkout.errorMessage,
    };
  }
}

/* =========================================================
 * Flow helpers
 * ======================================================= */

export function canEnterAppAfterPaymentFlow(
  result:
    PaymentFlowResult
): boolean {
  return (
    result.status ===
      'succeeded' &&
    result.allowAppEntry
  );
}