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
 * Main payment flow
 * ======================================================= */

export async function startPaymentFlow(
  input:
    StartPaymentFlowInput
): Promise<PaymentFlowResult> {
  const userId =
    input.userId
      .trim();

  if (
    !userId
  ) {
    const checkout:
      PaymentCheckoutResult = {
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
        'AUTHENTICATED_USER_REQUIRED',

      errorMessage:
        'You must be signed in before continuing.',
    };

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
     * Development preview
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
     * REAL PAYMENT IMPORTANT
     * -----------------------------------------------------
     *
     * نجاح checkout الحقيقي لوحده مش كفاية
     * علشان نفتح التطبيق.
     *
     * في Production:
     *
     * Stripe
     *   -> server/webhook verification
     *
     * Apple
     *   -> verified transaction/subscription
     *
     * Google
     *   -> verified purchase/subscription
     *
     * وبعدها backend هو اللي يثبت إن الاشتراك Active.
     *
     * لذلك لا نفتح التطبيق هنا مباشرة.
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
    error: any
  ) {
    const checkout:
      PaymentCheckoutResult = {
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
        'PAYMENT_FLOW_FAILED',

      errorMessage:
        error?.message ??
        'The payment flow failed unexpectedly.',
    };

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