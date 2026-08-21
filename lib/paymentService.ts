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

type SupabaseFunctionErrorBody = {
  error?:
    unknown;

  message?:
    unknown;

  details?:
    unknown;
};

type FunctionInvocationErrorLike = {
  message?:
    unknown;

  context?:
    unknown;

  name?:
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
      return 'Stripe is not configured on the payment server.';

    case 'SUPABASE_NOT_CONFIGURED':
      return 'Supabase is not configured on the payment server.';

    case 'CHECKOUT_URL_NOT_CREATED':
      return 'Stripe did not return a secure checkout URL.';

    case 'STRIPE_CHECKOUT_FAILED':
      return 'Stripe could not create the Checkout Session.';

    case 'METHOD_NOT_ALLOWED':
      return 'Invalid payment request method.';

    case 'INVALID_REQUEST_BODY':
      return 'Invalid payment request body.';

    default:
      return 'Unable to start checkout. Please try again.';
  }
}

function getUnknownErrorMessage(
  error:
    unknown
): string {
  if (
    error instanceof Error
  ) {
    return error.message;
  }

  if (
    typeof error ===
      'string'
  ) {
    return error;
  }

  if (
    error &&
    typeof error ===
      'object' &&
    'message' in error
  ) {
    const message =
      (
        error as {
          message?:
            unknown;
        }
      ).message;

    if (
      typeof message ===
        'string' &&
      message.trim()
    ) {
      return message;
    }
  }

  return 'Unknown payment error.';
}

/* =========================================================
 * Edge Function error diagnostics
 * ======================================================= */

function isResponse(
  value:
    unknown
): value is Response {
  return (
    typeof Response !==
      'undefined' &&
    value instanceof
      Response
  );
}

async function readFunctionErrorBody(
  error:
    unknown
): Promise<{
  status:
    number | null;

  errorCode:
    string | null;

  serverMessage:
    string | null;

  rawBody:
    unknown;
}> {
  if (
    !error ||
    typeof error !==
      'object'
  ) {
    return {
      status:
        null,

      errorCode:
        null,

      serverMessage:
        null,

      rawBody:
        null,
    };
  }

  const invocationError =
    error as
      FunctionInvocationErrorLike;

  const context =
    invocationError
      .context;

  if (
    !isResponse(
      context
    )
  ) {
    return {
      status:
        null,

      errorCode:
        null,

      serverMessage:
        null,

      rawBody:
        null,
    };
  }

  const status =
    context.status;

  let rawBody:
    unknown =
      null;

  /*
   * Response bodies can only be consumed once.
   * clone() prevents the diagnostic read from mutating
   * the original Response stored on the Supabase error.
   */
  try {
    const cloned =
      context.clone();

    const contentType =
      cloned.headers
        .get(
          'content-type'
        ) ??
      '';

    if (
      contentType.includes(
        'application/json'
      )
    ) {
      rawBody =
        await cloned
          .json();
    } else {
      const text =
        await cloned
          .text();

      rawBody =
        text ||
        null;
    }
  } catch (
    bodyReadError
  ) {
    console.error(
      'Unable to read Edge Function error body:',
      bodyReadError
    );
  }

  let errorCode:
    string | null =
      null;

  let serverMessage:
    string | null =
      null;

  if (
    rawBody &&
    typeof rawBody ===
      'object'
  ) {
    const body =
      rawBody as
        SupabaseFunctionErrorBody;

    if (
      typeof body.error ===
        'string' &&
      body.error.trim()
    ) {
      errorCode =
        body.error.trim();
    }

    if (
      typeof body.message ===
        'string' &&
      body.message.trim()
    ) {
      serverMessage =
        body.message.trim();
    }
  }

  return {
    status,

    errorCode,

    serverMessage,

    rawBody,
  };
}

async function throwDetailedFunctionError(
  error:
    unknown
): Promise<never> {
  const diagnostic =
    await readFunctionErrorBody(
      error
    );

  console.error(
    'create-stripe-checkout diagnostic:',
    {
      status:
        diagnostic.status,

      errorCode:
        diagnostic.errorCode,

      serverMessage:
        diagnostic.serverMessage,

      rawBody:
        diagnostic.rawBody,

      originalMessage:
        getUnknownErrorMessage(
          error
        ),
    }
  );

  if (
    diagnostic.errorCode
  ) {
    const friendlyMessage =
      getErrorMessage(
        diagnostic.errorCode
      );

    throw new Error(
      `${diagnostic.errorCode}: ${friendlyMessage}`
    );
  }

  if (
    diagnostic.serverMessage
  ) {
    throw new Error(
      diagnostic.status
        ? `HTTP ${diagnostic.status}: ${diagnostic.serverMessage}`
        : diagnostic.serverMessage
    );
  }

  if (
  diagnostic.status === 409
) {
  throw new Error(
    'SUBSCRIPTION_ALREADY_ACTIVE: You already have an active Triple N subscription.'
  );
}

  if (
    diagnostic.status
  ) {
    throw new Error(
      `Stripe checkout Edge Function failed with HTTP ${diagnostic.status}.`
    );
  }

  throw new Error(
    getUnknownErrorMessage(
      error
    ) ||
    'Unable to connect to the payment service.'
  );
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

  if (
    !session
      .access_token
      .trim()
  ) {
    throw new Error(
      'Your login session does not contain a valid access token. Please sign in again.'
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

  /* =======================================================
   * Supabase invocation failure
   * ===================================================== */

  if (
    error
  ) {
    console.error(
      'create-stripe-checkout invocation failed:',
      error
    );

    await throwDetailedFunctionError(
      error
    );
  }

  /* =======================================================
   * Parse successful HTTP response
   * ===================================================== */

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

  /*
   * Normally a non-2xx response is surfaced by Supabase as
   * an invocation error.
   *
   * This secondary check protects us if the server returns
   * HTTP 2xx with an application-level error object.
   */
  if (
    response.error
  ) {
    console.error(
      'create-stripe-checkout returned an application error:',
      response.error
    );

    const errorCode =
      typeof response.error ===
        'string'
        ? response.error
        : String(
            response.error
          );

    throw new Error(
      `${errorCode}: ${getErrorMessage(
        errorCode
      )}`
    );
  }

  /* =======================================================
   * Validate Checkout URL
   * ===================================================== */

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

  /* =======================================================
   * Validate Checkout Session
   * ===================================================== */

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

  /* =======================================================
   * Validate returned plan
   * ===================================================== */

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
 * Stripe checkout
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
     * A Stripe Checkout Session now exists.
     *
     * This is NOT proof that payment succeeded.
     *
     * The app receives the hosted Stripe URL and opens it.
     * Subscription access is only granted after the Stripe
     * webhook updates the authoritative subscription state
     * in Supabase.
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

      /*
       * The Stripe Checkout Session ID is temporarily stored
       * as transactionId until webhook processing supplies
       * authoritative subscription/payment identifiers.
       */
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
      getUnknownErrorMessage(
        error
      );

    console.error(
      'Stripe checkout failed:',
      error
    );

    return createFailedCheckoutResult(
      input.planId,
      'stripe',
      'STRIPE_CHECKOUT_FAILED',
      message ||
      'Unable to start Stripe Checkout.'
    );
  }
}

/* =========================================================
 * Stripe-only dispatcher
 * ======================================================= */

async function startProviderCheckout(
  input:
    StartCheckoutInput
): Promise<PaymentCheckoutResult> {
  return await startStripeCheckout(
    input
  );
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
   * Stripe is Triple N's only configured payment provider.
   *
   * userId is used by the client flow but is NOT trusted as
   * authentication by the payment backend.
   *
   * The create-stripe-checkout Edge Function independently
   * validates the Supabase JWT and obtains the user ID from
   * the authenticated Supabase user.
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