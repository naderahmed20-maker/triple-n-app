// lib/paymentProviderResolver.ts

import {
    Platform,
} from 'react-native';

import {
    PAYMENT_PROVIDER_PRIORITY,
    type PaymentProvider,
} from '@/lib/paymentConfig';

import type {
    PaymentProviderEligibility,
    PaymentProviderResolution,
} from '@/lib/paymentTypes';

/* =========================================================
 * Provider capability input
 * ======================================================= */

export type PaymentProviderCapabilityInput = {
  /**
   * Whether Stripe is currently allowed for this user,
   * storefront, region, and distribution configuration.
   *
   * For now this will come from development configuration.
   * Later it will come from the real payment eligibility
   * layer / backend.
   */
  stripeAllowed:
    boolean;

  /**
   * Whether Apple IAP is available/configured.
   */
  appleAvailable:
    boolean;

  /**
   * Whether Google Play Billing is available/configured.
   */
  googleAvailable:
    boolean;

  /**
   * Optional storefront/region information.
   *
   * Not used for hard-coded payment decisions yet.
   * We keep it here because real production eligibility
   * will depend on storefront/program enrollment.
   */
  countryCode?:
    string | null;

  storefrontCode?:
    string | null;
};

/* =========================================================
 * Platform helpers
 * ======================================================= */

function isIOS():
  boolean {
  return (
    Platform.OS ===
    'ios'
  );
}

function isAndroid():
  boolean {
  return (
    Platform.OS ===
    'android'
  );
}

/* =========================================================
 * Provider evaluation
 * ======================================================= */

function evaluateStripe(
  input:
    PaymentProviderCapabilityInput
): PaymentProviderEligibility {
  if (
    !input.stripeAllowed
  ) {
    return {
      provider:
        'stripe',

      eligible:
        false,

      reason:
        'store-policy-restricted',

      message:
        'Stripe is not eligible for this purchase configuration.',
    };
  }

  return {
    provider:
      'stripe',

    eligible:
      true,

    reason:
      'eligible',

    message:
      null,
  };
}

function evaluateApple(
  input:
    PaymentProviderCapabilityInput
): PaymentProviderEligibility {
  if (
    !isIOS()
  ) {
    return {
      provider:
        'apple',

      eligible:
        false,

      reason:
        'unsupported-platform',

      message:
        'Apple In-App Purchase is available only on iOS.',
    };
  }

  if (
    !input.appleAvailable
  ) {
    return {
      provider:
        'apple',

      eligible:
        false,

      reason:
        'provider-not-configured',

      message:
        'Apple In-App Purchase is not currently configured.',
    };
  }

  return {
    provider:
      'apple',

    eligible:
      true,

    reason:
      'eligible',

    message:
      null,
  };
}

function evaluateGoogle(
  input:
    PaymentProviderCapabilityInput
): PaymentProviderEligibility {
  if (
    !isAndroid()
  ) {
    return {
      provider:
        'google',

      eligible:
        false,

      reason:
        'unsupported-platform',

      message:
        'Google Play Billing is available only on Android.',
    };
  }

  if (
    !input.googleAvailable
  ) {
    return {
      provider:
        'google',

      eligible:
        false,

      reason:
        'provider-not-configured',

      message:
        'Google Play Billing is not currently configured.',
    };
  }

  return {
    provider:
      'google',

    eligible:
      true,

    reason:
      'eligible',

    message:
      null,
  };
}

/* =========================================================
 * Public provider resolver
 * ======================================================= */

export function resolvePaymentProvider(
  input:
    PaymentProviderCapabilityInput
): PaymentProviderResolution {
  const evaluations:
    PaymentProviderEligibility[] = [
      evaluateStripe(
        input
      ),

      evaluateApple(
        input
      ),

      evaluateGoogle(
        input
      ),
    ];

  const eligibleProviders =
    evaluations
      .filter(
        evaluation =>
          evaluation.eligible
      )
      .map(
        evaluation =>
          evaluation.provider
      );

  let selectedProvider:
    PaymentProvider | null =
      null;

  for (
    const provider of
    PAYMENT_PROVIDER_PRIORITY
  ) {
    if (
      eligibleProviders.includes(
        provider
      )
    ) {
      selectedProvider =
        provider;

      break;
    }
  }

  return {
    selectedProvider,

    eligibleProviders,

    evaluations,

    resolvedAt:
      new Date()
        .toISOString(),
  };
}

/* =========================================================
 * Development capability defaults
 * ======================================================= */

/**
 * DEVELOPMENT ONLY.
 *
 * This simulates the provider-selection behavior before
 * real Stripe / Apple / Google integrations are connected.
 *
 * Current behavior:
 *
 * iOS:
 *   Stripe allowed
 *   Apple available
 *   -> Stripe wins
 *
 * Android:
 *   Stripe allowed
 *   Google available
 *   -> Stripe wins
 *
 * Later this function will be replaced or fed by real
 * backend/storefront eligibility.
 */
export function getDevelopmentPaymentCapabilities():
  PaymentProviderCapabilityInput {
  if (
    isIOS()
  ) {
    return {
      stripeAllowed:
        true,

      appleAvailable:
        true,

      googleAvailable:
        false,

      countryCode:
        null,

      storefrontCode:
        null,
    };
  }

  if (
    isAndroid()
  ) {
    return {
      stripeAllowed:
        true,

      appleAvailable:
        false,

      googleAvailable:
        true,

      countryCode:
        null,

      storefrontCode:
        null,
    };
  }

  return {
    stripeAllowed:
      false,

    appleAvailable:
      false,

    googleAvailable:
      false,

    countryCode:
      null,

    storefrontCode:
      null,
  };
}

/* =========================================================
 * Development resolver shortcut
 * ======================================================= */

export function resolveDevelopmentPaymentProvider():
  PaymentProviderResolution {
  return resolvePaymentProvider(
    getDevelopmentPaymentCapabilities()
  );
}