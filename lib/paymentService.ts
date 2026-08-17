// lib/paymentService.ts

import {
  supabase,
} from './supabase';

import type {
  PaymentProvider,
  TripleNPlanId,
} from './paymentConfig';

import type {
  PaymentCheckoutResult,
  StartCheckoutInput,
} from './paymentTypes';

/* =========================================================
 * Triple N Payment Service
 *
 * Production responsibilities:
 *
 * - Authenticate with Supabase.
 * - Call the secure Supabase Edge Function.
 * - Never expose Stripe secret keys in the app.
 * - Never trust prices supplied by the app.
 * - Receive a Stripe-hosted Checkout URL.
 *
 * IMPORTANT:
 *
 * A created Checkout Session is NOT proof of payment.
 *
 * Real subscription access must only be granted after the
 * Stripe webhook has verified and synchronized the
 * subscription into Supabase.
 * ======================================================= */

/* =========================================================
 * Types
 * ======================================================= */

export type CreateCheckoutResult = {
  checkoutUrl:
    string;

  sessionId:
    string;

  planId:
    TripleNPlanId;
};

type CheckoutFunctionResponse = {
  checkoutUrl?:
    unknown;

  sessionId?:
    unknown;

  planId?:
    unknown;

  error?:
    unknown;
};

/* =========================================================
 * Constants
 * ======================================================= */

const STRIPE_CHECKOUT_FUNCTION =
  'create-stripe-checkout';

/* =========================================================
 * Generic helpers
 * ======================================================= */

function isPlanId(
  value:
    unknown
): value is TripleNPlanId {
  return (
    value ===
      'monthly' ||
    value ===
      'yearly'
  );
}

function isHttpsUrl(
  value:
    unknown
): value is string {
  if (
    typeof value !==
      'string'
  ) {
    return false;
  }

  try {
    const url =
      new URL(
        value
      );

    return (
      url.protocol ===
        'https:'
    );
  } catch {
    return false;
  }
}

function getErrorMessage(
  errorCode:
    unknown
): string {
  switch (
    errorCode
  ) {
    case 'AUTHENTICATION_REQUIRED':
      return 'Please sign in before starting checkout.';

    case 'INVALID_AUTHENTICATION':
      return 'Your login session is no longer valid. Please sign in again.';

    case 'INVALID_PLAN':
      return 'The selected subscription plan is invalid.';

    case 'SUBSCRIPTION_ALREADY_ACTIVE':
      return 'You already have an active Triple N subscription.';

    case 'STRIPE_NOT_CONFIGURED':
      return 'Payments are temporarily unavailable.';

    case 'SUPABASE_NOT_CONFIGURED':
      return 'Payments are temporarily unavailable.';

    case 'CHECKOUT_URL_NOT_CREATED':
      return 'Unable to open the secure checkout page.';

    case 'STRIPE_CHECKOUT_FAILED':
      return 'Unable to start Stripe Checkout. Please try again.';

    case 'METHOD_NOT_ALLOWED':
      return 'Invalid payment request.';

    case 'INVALID_REQUEST_BODY':
      return 'Invalid payment request.';

    default:
      return 'Unable to start checkout. Please try again.';
  }
}

/* =========================================================
 * Checkout result helpers
 * ======================================================= */

function createFailedCheckoutResult(
  planId:
    TripleNPlanId,
  provider:
    PaymentProvider | null,
  errorCode:
    string,
  errorMessage:
    string
): PaymentCheckoutResult {
  return {
    status:
      'failed',

    provider,

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
 * Authentication
 * ======================================================= */

async function requireAuthenticatedUser() {
  const {
    data:
      sessionData,
    error:
      sessionError,
  } =
    await supabase
      .auth
      .getSession();

  if (
    sessionError
  ) {
    throw new Error(
      sessionError.message
    );
  }

  const session =
    sessionData
      .session;

  if (
    !session ||
    !session.user
  ) {
    throw new Error(
      'Please sign in before starting checkout.'
    );
  }

  return {
    user:
      session.user,

    session,
  };
}

/* =========================================================
 * Create Stripe Checkout Session
 * ======================================================= */

export async function createStripeCheckout(
  planId:
    TripleNPlanId
): Promise<CreateCheckoutResult> {
  if (
    !isPlanId(
      planId
    )
  ) {
    throw new Error(
      'Invalid subscription plan.'
    );
  }

  const {
    session,
  } =
    await requireAuthenticatedUser();

  const {
    data,
    error,
  } =
    await supabase
      .functions
      .invoke(
        STRIPE_CHECKOUT_FUNCTION,
        {
          body: {
            planId,
          },

          headers: {
            Authorization:
              `Bearer ${session.access_token}`,
          },
        }
      );

  if (
    error
  ) {
    console.error(
      'create-stripe-checkout invocation failed:',
      error
    );

    throw new Error(
      error.message ||
      'Unable to connect to the payment service.'
    );
  }

  const response =
    data as
      | CheckoutFunctionResponse
      | null;

  if (
    !response
  ) {
    throw new Error(
      'The payment service returned an empty response.'
    );
  }

  if (
    response.error
  ) {
    console.error(
      'create-stripe-checkout returned an error:',
      response.error
    );

    throw new Error(
      getErrorMessage(
        response.error
      )
    );
  }

  if (
    !isHttpsUrl(
      response.checkoutUrl
    )
  ) {
    console.error(
      'Invalid Stripe Checkout URL:',
      response.checkoutUrl
    );

    throw new Error(
      'The payment service returned an invalid checkout URL.'
    );
  }

  if (
    typeof response
      .sessionId !==
      'string' ||
    !response
      .sessionId
      .trim()
  ) {
    console.error(
      'Invalid Stripe Checkout Session ID:',
      response.sessionId
    );

    throw new Error(
      'The payment service returned an invalid checkout session.'
    );
  }

  if (
    !isPlanId(
      response.planId
    )
  ) {
    console.error(
      'Invalid checkout plan returned by server:',
      response.planId
    );

    throw new Error(
      'The payment service returned an invalid subscription plan.'
    );
  }

  if (
    response.planId !==
      planId
  ) {
    console.error(
      'Checkout plan mismatch:',
      {
        requestedPlan:
          planId,

        returnedPlan:
          response.planId,
      }
    );

    throw new Error(
      'The payment service returned a different subscription plan.'
    );
  }

  return {
    checkoutUrl:
      response.checkoutUrl,

    sessionId:
      response.sessionId,

    planId:
      response.planId,
  };
}

/* =========================================================
 * Provider checkout
 * ======================================================= */

async function startStripeCheckout(
  input:
    StartCheckoutInput
): Promise<PaymentCheckoutResult> {
  try {
    const checkout =
      await createStripeCheckout(
        input.planId
      );

    /*
     * Stripe Checkout Session exists, but payment has not
     * yet been verified.
     *
     * Therefore status remains pending.
     *
     * checkoutUrl is returned to the UI so the secure
     * Stripe-hosted checkout can be opened.
     *
     * transactionId temporarily contains the Stripe
     * Checkout Session ID.
     *
     * The authoritative subscription ID and active status
     * are synchronized later by the Stripe webhook.
     */

    return {
      status:
        'pending',

      provider:
        'stripe',

      planId:
        checkout.planId,

      checkoutUrl:
        checkout.checkoutUrl,

      transactionId:
        checkout.sessionId,

      subscriptionId:
        null,

      errorCode:
        null,

      errorMessage:
        null,
    };
  } catch (
    error:
      unknown
  ) {
    const message =
      error instanceof Error
        ? error.message
        : 'Unable to start Stripe Checkout.';

    console.error(
      'Stripe checkout failed:',
      error
    );

    return createFailedCheckoutResult(
      input.planId,
      'stripe',
      'STRIPE_CHECKOUT_FAILED',
      message
    );
  }
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
      return await startStripeCheckout(
        input
      );

    case 'apple':
      return createFailedCheckoutResult(
        input.planId,
        'apple',
        'APPLE_IAP_NOT_CONFIGURED',
        'Apple In-App Purchase is not configured.'
      );

    case 'google':
      return createFailedCheckoutResult(
        input.planId,
        'google',
        'GOOGLE_BILLING_NOT_CONFIGURED',
        'Google Play Billing is not configured.'
      );

    default:
      return createFailedCheckoutResult(
        input.planId,
        null,
        'PAYMENT_PROVIDER_UNSUPPORTED',
        'No supported payment provider is available.'
      );
  }
}

/* =========================================================
 * Main checkout API
 * ======================================================= */

export async function startCheckout({
  userId,
  planId,
}: {
  userId:
    string;

  planId:
    TripleNPlanId;
}): Promise<PaymentCheckoutResult> {
  const normalizedUserId =
    userId.trim();

  if (
    !normalizedUserId
  ) {
    return createFailedCheckoutResult(
      planId,
      null,
      'AUTHENTICATED_USER_REQUIRED',
      'You must be signed in before continuing.'
    );
  }

  if (
    !isPlanId(
      planId
    )
  ) {
    return createFailedCheckoutResult(
      planId,
      null,
      'INVALID_PLAN',
      'The selected subscription plan is invalid.'
    );
  }

  /*
   * Stripe is currently Triple N's configured payment
   * provider.
   *
   * The Edge Function independently authenticates the
   * caller. userId is therefore not trusted as proof of
   * identity or authorization.
   */

  return await startProviderCheckout({
    userId:
      normalizedUserId,

    planId,

    provider:
      'stripe',
  });
}

/* =========================================================
 * Checkout state helpers
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

/* =========================================================
 * Convenience functions
 * ======================================================= */

export async function createMonthlyCheckout():
  Promise<CreateCheckoutResult> {
  return await createStripeCheckout(
    'monthly'
  );
}

export async function createYearlyCheckout():
  Promise<CreateCheckoutResult> {
  return await createStripeCheckout(
    'yearly'
  );
}