// lib/paymentFlowService.ts

import {
  Platform,
} from 'react-native';

import {
  PAYMENT_ENVIRONMENT,
  REAL_PAYMENTS_ENABLED,
  type PaymentProvider,
  type TripleNPlanId,
} from '@/lib/paymentConfig';

import {
  prepareAppleExternalPurchase,
} from '@/lib/appleExternalPurchaseService';

import {
  isCheckoutCancelled,
  isCheckoutPending,
  isCheckoutSuccessful,
  startCheckout,
} from '@/lib/paymentService';

import {
  grantDevelopmentPaymentAccess,
} from '@/lib/subscriptionService';

import {
  supabase,
} from '@/lib/supabase';

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
 * Apple error message
 * ======================================================= */

function getAppleExternalPurchaseErrorMessage(
  reason:
    string | null
): string {
  switch (
    reason
  ) {
    case 'payments-not-allowed':
      return 'Purchases are not allowed for this Apple account or device.';

    case 'api-unavailable':
      return 'This payment option is not available on this version of iOS.';

    case 'not-eligible':
      return 'This payment option is not available for your App Store region.';

    case 'token-ineligible':
      return 'Apple could not prepare this purchase for your account.';

    case 'payments-not-allowed':
      return 'Purchases are not allowed on this device.';

    default:
      return 'Apple could not prepare the external purchase. Please try again.';
  }
}

/* =========================================================
 * Save Apple external-purchase tokens
 * ======================================================= */

async function saveAppleExternalPurchaseTokens(
  acquisitionToken:
    string,
  servicesToken:
    string
): Promise<void> {
  const normalizedAcquisitionToken =
    acquisitionToken
      .trim();

  const normalizedServicesToken =
    servicesToken
      .trim();

  if (
    !normalizedAcquisitionToken ||
    !normalizedServicesToken
  ) {
    throw new Error(
      'APPLE_EXTERNAL_PURCHASE_TOKEN_MISSING'
    );
  }

  /* -------------------------------------------------------
   * Resolve authenticated session
   * ----------------------------------------------------- */

  const {
    data:
      sessionData,
    error:
      sessionError,
  } =
    await supabase.auth
      .getSession();

  if (
    sessionError
  ) {
    throw sessionError;
  }

  const accessToken =
    sessionData
      .session
      ?.access_token
      ?.trim();

  if (
    !accessToken
  ) {
    throw new Error(
      'AUTHENTICATED_USER_REQUIRED'
    );
  }

  /* -------------------------------------------------------
   * Save tokens through secure Edge Function
   * ----------------------------------------------------- */

  const {
    data:
      saveData,
    error:
      saveError,
  } =
    await supabase.functions
      .invoke(
        'save-apple-external-purchase-tokens',
        {
          body: {
            acquisitionToken:
              normalizedAcquisitionToken,

            servicesToken:
              normalizedServicesToken,
          },

          headers: {
            Authorization:
              `Bearer ${accessToken}`,
          },
        }
      );

  if (
    saveError
  ) {
    console.error(
      'APPLE EXTERNAL PURCHASE TOKEN SAVE ERROR:',
      saveError
    );

    throw new Error(
      'APPLE_EXTERNAL_PURCHASE_TOKEN_STORAGE_FAILED'
    );
  }

  if (
    !saveData ||
    saveData.success !==
      true ||
    saveData.saved !==
      true
  ) {
    console.error(
      'APPLE EXTERNAL PURCHASE TOKEN SAVE INVALID RESPONSE:',
      saveData
    );

    throw new Error(
      'APPLE_EXTERNAL_PURCHASE_TOKEN_STORAGE_FAILED'
    );
  }
}

/* =========================================================
 * Apple external-purchase gate
 * ======================================================= */

async function prepareProductionAppleCheckout(
  planId:
    TripleNPlanId
): Promise<PaymentFlowResult | null> {

  /*
   * Android does not use Apple's StoreKit gate.
   */
  if (
    Platform.OS !==
      'ios'
  ) {
    return null;
  }

  const appleResult =
    await prepareAppleExternalPurchase();

  /* -------------------------------------------------------
   * User cancelled Apple's disclosure
   * ----------------------------------------------------- */

  if (
    !appleResult.allowed &&
    appleResult.reason ===
      'cancelled'
  ) {
    const checkout =
      createFailedCheckout(
        planId,
        'APPLE_EXTERNAL_PURCHASE_CANCELLED',
        'The purchase was cancelled.'
      );

    return {
      status:
        'cancelled',

      allowAppEntry:
        false,

      provider:
        null,

      planId,

      checkout,

      developmentBypass:
        false,

      errorCode:
        null,

      errorMessage:
        null,
    };
  }

  /* -------------------------------------------------------
   * Apple did not allow external purchase
   * ----------------------------------------------------- */

  if (
    !appleResult.allowed
  ) {
    const errorCode =
      appleResult.reason
        ? `APPLE_EXTERNAL_PURCHASE_${appleResult.reason
            .replace(
              /-/g,
              '_'
            )
            .toUpperCase()}`
        : 'APPLE_EXTERNAL_PURCHASE_FAILED';

    const errorMessage =
      getAppleExternalPurchaseErrorMessage(
        appleResult.reason
      );

    const checkout =
      createFailedCheckout(
        planId,
        errorCode,
        errorMessage
      );

    return {
      status:
        'failed',

      allowAppEntry:
        false,

      provider:
        null,

      planId,

      checkout,

      developmentBypass:
        false,

      errorCode,
      errorMessage,
    };
  }

  /* -------------------------------------------------------
   * Apple allowed external purchase.
   *
   * On iOS production both Apple tokens must exist.
   * ----------------------------------------------------- */

  const acquisitionToken =
    appleResult
      .acquisitionToken
      ?.trim() ??
    '';

  const servicesToken =
    appleResult
      .servicesToken
      ?.trim() ??
    '';

  if (
    !acquisitionToken ||
    !servicesToken
  ) {
    const checkout =
      createFailedCheckout(
        planId,
        'APPLE_EXTERNAL_PURCHASE_TOKEN_MISSING',
        'Apple could not prepare this purchase. Please try again.'
      );

    return {
      status:
        'failed',

      allowAppEntry:
        false,

      provider:
        null,

      planId,

      checkout,

      developmentBypass:
        false,

      errorCode:
        checkout.errorCode,

      errorMessage:
        checkout.errorMessage,
    };
  }

  /* -------------------------------------------------------
   * Persist Apple tokens before creating Stripe checkout
   * ----------------------------------------------------- */

  try {
    await saveAppleExternalPurchaseTokens(
      acquisitionToken,
      servicesToken
    );
  } catch (
    error:
      unknown
  ) {
    console.error(
      'APPLE EXTERNAL PURCHASE PREPARATION ERROR:',
      error
    );

    const checkout =
      createFailedCheckout(
        planId,
        'APPLE_EXTERNAL_PURCHASE_TOKEN_STORAGE_FAILED',
        'The purchase could not be prepared securely. Please try again.'
      );

    return {
      status:
        'failed',

      allowAppEntry:
        false,

      provider:
        null,

      planId,

      checkout,

      developmentBypass:
        false,

      errorCode:
        checkout.errorCode,

      errorMessage:
        checkout.errorMessage,
    };
  }

  /*
   * null means:
   *
   * Apple gate passed.
   * Continue to the existing checkout flow.
   */
  return null;
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
     * Development bypass status
     * --------------------------------------------------- */

    const developmentBypass =
      isDevelopmentBypassCheckout();

    /* -----------------------------------------------------
     * Apple production external-purchase gate
     *
     * Production iOS:
     *
     * canMakePayments
     *   -> eligibility
     *   -> Apple tokens
     *   -> Apple disclosure
     *   -> secure token storage
     *   -> Stripe checkout
     *
     * Development bypass:
     *
     * Skip StoreKit external-purchase flow.
     * --------------------------------------------------- */

    if (
      !developmentBypass
    ) {
      const appleGateResult =
        await prepareProductionAppleCheckout(
          input.planId
        );

      if (
        appleGateResult
      ) {
        return appleGateResult;
      }
    }

    /* -----------------------------------------------------
     * Start existing checkout
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
    console.error(
      'PAYMENT FLOW ERROR:',
      error
    );

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