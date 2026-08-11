// lib/subscriptionService.ts

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
    ALLOW_DEVELOPMENT_CONTINUE,
    PAYMENT_ENVIRONMENT,
    REAL_PAYMENTS_ENABLED,
    SUBSCRIPTION_GATE_ENFORCED,
    type PaymentProvider,
    type SubscriptionStatus,
    type TripleNPlanId,
} from '@/lib/paymentConfig';

import {
    supabase,
} from '@/lib/supabase';

import type {
    SubscriptionAccessResult,
    TripleNSubscription,
} from '@/lib/paymentTypes';

/* =========================================================
 * Storage
 * ======================================================= */

const DEVELOPMENT_ACCESS_KEY =
  'TRIPLE_N_DEVELOPMENT_PAYMENT_ACCESS';

/* =========================================================
 * Database row
 * ======================================================= */

type SubscriptionDatabaseRow = {
  status:
    string;

  plan_id:
    string | null;

  provider:
    string | null;

  provider_customer_id:
    string | null;

  provider_subscription_id:
    string | null;

  started_at:
    string | null;

  current_period_start:
    string | null;

  current_period_end:
    string | null;

  cancelled_at:
    string | null;

  expires_at:
    string | null;

  will_renew:
    boolean | null;

  last_verified_at:
    string | null;
};

/* =========================================================
 * Development access
 * ======================================================= */

type DevelopmentAccessRecord = {
  userId:
    string;

  grantedAt:
    string;
};

export async function grantDevelopmentPaymentAccess(
  userId:
    string
): Promise<void> {
  if (
    PAYMENT_ENVIRONMENT !==
      'development' ||
    REAL_PAYMENTS_ENABLED ||
    !ALLOW_DEVELOPMENT_CONTINUE
  ) {
    return;
  }

  const normalizedUserId =
    userId.trim();

  if (
    !normalizedUserId
  ) {
    throw new Error(
      'A valid user ID is required to grant development payment access.'
    );
  }

  const record:
    DevelopmentAccessRecord = {
    userId:
      normalizedUserId,

    grantedAt:
      new Date()
        .toISOString(),
  };

  await AsyncStorage.setItem(
    DEVELOPMENT_ACCESS_KEY,
    JSON.stringify(
      record
    )
  );
}

/* =========================================================
 * Read development access
 * ======================================================= */

async function hasDevelopmentPaymentAccess(
  userId:
    string
): Promise<boolean> {
  if (
    PAYMENT_ENVIRONMENT !==
      'development' ||
    REAL_PAYMENTS_ENABLED
  ) {
    return false;
  }

  const value =
    await AsyncStorage.getItem(
      DEVELOPMENT_ACCESS_KEY
    );

  if (
    !value
  ) {
    return false;
  }

  try {
    const parsed =
      JSON.parse(
        value
      ) as Partial<DevelopmentAccessRecord>;

    return (
      typeof parsed.userId ===
        'string' &&
      parsed.userId ===
        userId
    );
  } catch {
    return false;
  }
}

/* =========================================================
 * Clear development access
 * ======================================================= */

export async function clearDevelopmentPaymentAccess():
  Promise<void> {
  await AsyncStorage.removeItem(
    DEVELOPMENT_ACCESS_KEY
  );
}

/* =========================================================
 * Validation helpers
 * ======================================================= */

function normalizeSubscriptionStatus(
  value:
    string
): SubscriptionStatus {
  switch (
    value
  ) {
    case 'unknown':
    case 'inactive':
    case 'pending':
    case 'active':
    case 'past_due':
    case 'cancelled':
    case 'expired':
      return value;

    default:
      return 'unknown';
  }
}

function normalizePlanId(
  value:
    string | null
): TripleNPlanId | null {
  if (
    value ===
      'monthly' ||
    value ===
      'yearly'
  ) {
    return value;
  }

  return null;
}

function normalizeProvider(
  value:
    string | null
): PaymentProvider | null {
  if (
    value ===
      'stripe' ||
    value ===
      'apple' ||
    value ===
      'google'
  ) {
    return value;
  }

  return null;
}

/* =========================================================
 * Map database row
 * ======================================================= */

function mapSubscriptionRow(
  row:
    SubscriptionDatabaseRow
): TripleNSubscription {
  return {
    status:
      normalizeSubscriptionStatus(
        row.status
      ),

    planId:
      normalizePlanId(
        row.plan_id
      ),

    provider:
      normalizeProvider(
        row.provider
      ),

    startedAt:
      row.started_at,

    currentPeriodStart:
      row.current_period_start,

    currentPeriodEnd:
      row.current_period_end,

    cancelledAt:
      row.cancelled_at,

    expiresAt:
      row.expires_at,

    willRenew:
      row.will_renew,

    providerSubscriptionId:
      row.provider_subscription_id,

    providerCustomerId:
      row.provider_customer_id,

    lastVerifiedAt:
      row.last_verified_at,
  };
}

/* =========================================================
 * Real verified subscription
 * ======================================================= */

export async function getVerifiedSubscription(
  userId:
    string
): Promise<TripleNSubscription | null> {
  const normalizedUserId =
    userId.trim();

  if (
    !normalizedUserId
  ) {
    return null;
  }

  const {
    data,
    error,
  } =
    await supabase
      .from(
        'subscriptions'
      )
      .select(`
        status,
        plan_id,
        provider,
        provider_customer_id,
        provider_subscription_id,
        started_at,
        current_period_start,
        current_period_end,
        cancelled_at,
        expires_at,
        will_renew,
        last_verified_at
      `)
      .eq(
        'user_id',
        normalizedUserId
      )
      .maybeSingle();

  if (
    error
  ) {
    throw error;
  }

  if (
    !data
  ) {
    return null;
  }

  return mapSubscriptionRow(
    data as SubscriptionDatabaseRow
  );
}

/* =========================================================
 * Active subscription validation
 * ======================================================= */

function isVerifiedSubscriptionActive(
  subscription:
    TripleNSubscription | null
): boolean {
  if (
    !subscription ||
    subscription.status !==
      'active'
  ) {
    return false;
  }

  if (
    !subscription.expiresAt
  ) {
    return true;
  }

  const expiresAt =
    Date.parse(
      subscription.expiresAt
    );

  if (
    !Number.isFinite(
      expiresAt
    )
  ) {
    return false;
  }

  return (
    expiresAt >
    Date.now()
  );
}

/* =========================================================
 * Subscription access check
 * ======================================================= */

export async function checkSubscriptionAccess(
  userId:
    string
): Promise<SubscriptionAccessResult> {
  const normalizedUserId =
    userId.trim();

  if (
    !normalizedUserId
  ) {
    return {
      status:
        'blocked',

      hasAccess:
        false,

      subscription:
        null,

      reason:
        'AUTHENTICATED_USER_REQUIRED',
    };
  }

  try {
    /* -----------------------------------------------------
     * Development preview access
     * --------------------------------------------------- */

    if (
      PAYMENT_ENVIRONMENT ===
        'development' &&
      !REAL_PAYMENTS_ENABLED
    ) {
      const developmentAccess =
        await hasDevelopmentPaymentAccess(
          normalizedUserId
        );

      if (
        developmentAccess
      ) {
        return {
          status:
            'allowed',

          hasAccess:
            true,

          subscription:
            null,

          reason:
            'DEVELOPMENT_ACCESS_GRANTED',
        };
      }

      if (
        !SUBSCRIPTION_GATE_ENFORCED
      ) {
        return {
          status:
            'allowed',

          hasAccess:
            true,

          subscription:
            null,

          reason:
            'SUBSCRIPTION_GATE_NOT_ENFORCED',
        };
      }
    }

    /* -----------------------------------------------------
     * Real verified subscription
     * --------------------------------------------------- */

    const subscription =
      await getVerifiedSubscription(
        normalizedUserId
      );

    const active =
      isVerifiedSubscriptionActive(
        subscription
      );

    if (
      active
    ) {
      return {
        status:
          'allowed',

        hasAccess:
          true,

        subscription,

        reason:
          null,
      };
    }

    return {
      status:
        'blocked',

      hasAccess:
        false,

      subscription,

      reason:
        subscription
          ? `SUBSCRIPTION_${subscription.status.toUpperCase()}`
          : 'ACTIVE_SUBSCRIPTION_REQUIRED',
    };
  } catch (
    error: any
  ) {
    console.log(
      'SUBSCRIPTION ACCESS CHECK ERROR:',
      error
    );

    return {
      status:
        'error',

      hasAccess:
        false,

      subscription:
        null,

      reason:
        error?.message ||
        'SUBSCRIPTION_CHECK_FAILED',
    };
  }
}