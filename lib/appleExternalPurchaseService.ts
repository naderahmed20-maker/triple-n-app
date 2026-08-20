import {
    Platform,
} from 'react-native';

import {
    getExternalPurchaseEligibility,
    getExternalPurchaseTokens,
    showExternalPurchaseNotice,
} from '../modules/triple-n-storekit/src';

export type AppleExternalPurchaseGateResult = {
  allowed:
    boolean;

  reason:
    string | null;

  acquisitionToken:
    string | null;

  servicesToken:
    string | null;
};

export async function prepareAppleExternalPurchase():
  Promise<AppleExternalPurchaseGateResult> {

  if (
    Platform.OS !==
      'ios'
  ) {
    return {
      allowed:
        true,

      reason:
        null,

      acquisitionToken:
        null,

      servicesToken:
        null,
    };
  }

  const eligibility =
    await getExternalPurchaseEligibility();

  if (
    !eligibility
      .canMakePayments
  ) {
    return {
      allowed:
        false,

      reason:
        'payments-not-allowed',

      acquisitionToken:
        null,

      servicesToken:
        null,
    };
  }

  if (
    !eligibility
      .supported
  ) {
    return {
      allowed:
        false,

      reason:
        'api-unavailable',

      acquisitionToken:
        null,

      servicesToken:
        null,
    };
  }

  if (
    !eligibility
      .eligible
  ) {
    return {
      allowed:
        false,

      reason:
        'not-eligible',

      acquisitionToken:
        null,

      servicesToken:
        null,
    };
  }

  const tokens =
    await getExternalPurchaseTokens();

  if (
    !tokens
      .eligible
  ) {
    return {
      allowed:
        false,

      reason:
        'token-ineligible',

      acquisitionToken:
        null,

      servicesToken:
        null,
    };
  }

  const notice =
    await showExternalPurchaseNotice();

  if (
    !notice
      .continued
  ) {
    return {
      allowed:
        false,

      reason:
        notice.reason,
      acquisitionToken:
        tokens
          .acquisitionToken,

      servicesToken:
        tokens
          .servicesToken,
    };
  }

  return {
    allowed:
      true,

    reason:
      null,

    acquisitionToken:
      tokens
        .acquisitionToken,

    servicesToken:
      tokens
        .servicesToken,
  };
}

/* =========================================================
 * Silent Apple external-purchase token synchronization
 *
 * This reads currently available Apple external-purchase
 * tokens without presenting the checkout disclosure.
 *
 * The disclosure remains exclusively inside
 * prepareAppleExternalPurchase().
 * ======================================================= */

export async function syncAppleExternalPurchaseTokensSilently():
  Promise<AppleExternalPurchaseGateResult> {

  if (
    Platform.OS !==
      'ios'
  ) {
    return {
      allowed:
        true,

      reason:
        null,

      acquisitionToken:
        null,

      servicesToken:
        null,
    };
  }

  const eligibility =
    await getExternalPurchaseEligibility();

  if (
    !eligibility.canMakePayments
  ) {
    return {
      allowed:
        false,

      reason:
        'payments-not-allowed',

      acquisitionToken:
        null,

      servicesToken:
        null,
    };
  }

  if (
    !eligibility.supported
  ) {
    return {
      allowed:
        false,

      reason:
        'api-unavailable',

      acquisitionToken:
        null,

      servicesToken:
        null,
    };
  }

  if (
    !eligibility.eligible
  ) {
    return {
      allowed:
        false,

      reason:
        'not-eligible',

      acquisitionToken:
        null,

      servicesToken:
        null,
    };
  }

  const tokens =
    await getExternalPurchaseTokens();

  if (
    !tokens.eligible
  ) {
    return {
      allowed:
        false,

      reason:
        'token-ineligible',

      acquisitionToken:
        null,

      servicesToken:
        null,
    };
  }

  return {
    allowed:
      true,

    reason:
      null,

    acquisitionToken:
      tokens.acquisitionToken,

    servicesToken:
      tokens.servicesToken,
  };
}

