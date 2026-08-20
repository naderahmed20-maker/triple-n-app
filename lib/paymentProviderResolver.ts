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
 * Stripe-only provider capability
 * ======================================================= */

export type PaymentProviderCapabilityInput = {
  stripeAllowed:
    boolean;

  appleAvailable?:
    boolean;

  googleAvailable?:
    boolean;

  countryCode?:
    string | null;

  storefrontCode?:
    string | null;
};

/* =========================================================
 * Stripe evaluation
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

/* =========================================================
 * Provider resolver
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
    ];

  const eligibleProviders:
    PaymentProvider[] =
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
 * Current capability defaults
 * ======================================================= */

export function getDevelopmentPaymentCapabilities():
  PaymentProviderCapabilityInput {
  return {
    stripeAllowed:
      Platform.OS === 'ios' ||
      Platform.OS === 'android',

    countryCode:
      null,

    storefrontCode:
      null,
  };
}

export function resolveDevelopmentPaymentProvider():
  PaymentProviderResolution {
  return resolvePaymentProvider(
    getDevelopmentPaymentCapabilities()
  );
}