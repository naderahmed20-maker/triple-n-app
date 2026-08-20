import {
  Platform,
} from 'react-native';

import {
  requireNativeModule,
} from 'expo';

export type ExternalPurchaseEligibility = {
  canMakePayments: boolean;
  eligible: boolean;
  supported: boolean;
};

export type ExternalPurchaseTokens = {
  canMakePayments: boolean;
  eligible: boolean;
  acquisitionToken: string | null;
  servicesToken: string | null;
};

export type ExternalPurchaseNoticeResult = {
  continued: boolean;
  reason: string;
};

type TripleNStoreKitNativeModule = {
  getExternalPurchaseEligibility:
    () => Promise<ExternalPurchaseEligibility>;

  getExternalPurchaseTokens:
    () => Promise<ExternalPurchaseTokens>;

  showExternalPurchaseNotice:
    () => Promise<ExternalPurchaseNoticeResult>;
};

function requireIOSModule():
  TripleNStoreKitNativeModule {

  if (
    Platform.OS !==
      'ios'
  ) {
    throw new Error(
      'Triple N StoreKit is available on iOS only.'
    );
  }

  return requireNativeModule<TripleNStoreKitNativeModule>(
    'TripleNStoreKit'
  );
}

export async function getExternalPurchaseEligibility():
  Promise<ExternalPurchaseEligibility> {

  return await requireIOSModule()
    .getExternalPurchaseEligibility();
}

export async function getExternalPurchaseTokens():
  Promise<ExternalPurchaseTokens> {

  return await requireIOSModule()
    .getExternalPurchaseTokens();
}

export async function showExternalPurchaseNotice():
  Promise<ExternalPurchaseNoticeResult> {

  return await requireIOSModule()
    .showExternalPurchaseNotice();
}
