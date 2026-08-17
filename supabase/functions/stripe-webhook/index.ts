import "@supabase/functions-js/edge-runtime.d.ts";

import Stripe from "npm:stripe@^22";

import {
  createClient,
} from "npm:@supabase/supabase-js@^2";

/* =========================================================
 * Triple N - Stripe Webhook
 *
 * Responsibilities:
 *
 * - Verify every Stripe webhook signature.
 * - Never trust payment state from the mobile app.
 * - Resolve the Triple N user from Stripe.
 * - Synchronize Stripe subscription state to Supabase.
 * - Handle renewals, cancellations and payment failures.
 *
 * IMPORTANT:
 *
 * The subscriptions table is client READ-ONLY.
 *
 * This Edge Function uses the Supabase Service Role Key
 * because verified server-side payment events are the only
 * authority allowed to update Stripe subscription state.
 * ======================================================= */

/* =========================================================
 * Environment
 * ======================================================= */

const STRIPE_SECRET_KEY =
  Deno.env.get(
    "STRIPE_SECRET_KEY"
  ) ?? "";

const STRIPE_WEBHOOK_SECRET =
  Deno.env.get(
    "STRIPE_WEBHOOK_SECRET"
  ) ?? "";

const SUPABASE_URL =
  Deno.env.get(
    "SUPABASE_URL"
  ) ?? "";

const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get(
    "SUPABASE_SERVICE_ROLE_KEY"
  ) ?? "";

/* =========================================================
 * Stripe
 * ======================================================= */

const stripe =
  new Stripe(
    STRIPE_SECRET_KEY
  );

const cryptoProvider =
  Stripe.createSubtleCryptoProvider();

/* =========================================================
 * Supabase admin
 * ======================================================= */

const supabaseAdmin =
  createClient(
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        persistSession:
          false,

        autoRefreshToken:
          false,
      },
    }
  );

/* =========================================================
 * Types
 * ======================================================= */

type TripleNPlanId =
  | "monthly"
  | "yearly";

type TripleNSubscriptionStatus =
  | "unknown"
  | "inactive"
  | "pending"
  | "active"
  | "past_due"
  | "cancelled"
  | "expired";

type SyncSubscriptionOptions = {
  preferredUserId?:
    string | null;

  providerTransactionId?:
    string | null;

  statusOverride?:
    TripleNSubscriptionStatus | null;
};

/* =========================================================
 * Generic helpers
 * ======================================================= */

function unixToIso(
  timestamp:
    number | null | undefined
): string | null {
  if (
    timestamp ===
      null ||
    timestamp ===
      undefined
  ) {
    return null;
  }

  return new Date(
    timestamp * 1000
  ).toISOString();
}

function getStripeId(
  value:
    | string
    | {
        id:
          string;
      }
    | null
    | undefined
): string | null {
  if (
    !value
  ) {
    return null;
  }

  if (
    typeof value ===
      "string"
  ) {
    return value;
  }

  if (
    typeof value.id ===
      "string"
  ) {
    return value.id;
  }

  return null;
}

function isUuid(
  value:
    string
): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(
      value
    );
}

/* =========================================================
 * Stripe status -> Triple N status
 * ======================================================= */

function mapStripeSubscriptionStatus(
  status:
    Stripe.Subscription["status"]
): TripleNSubscriptionStatus {
  switch (
    status
  ) {
    case "active":
    case "trialing":
      return "active";

    case "incomplete":
      return "pending";

    case "past_due":
    case "unpaid":
      return "past_due";

    case "paused":
      return "inactive";

    case "canceled":
      return "cancelled";

    case "incomplete_expired":
      return "expired";

    default:
      return "unknown";
  }
}

/* =========================================================
 * Plan resolution
 *
 * Primary source:
 * subscription metadata written by create-stripe-checkout.
 *
 * Fallback:
 * Stripe recurring interval.
 * ======================================================= */

function getPlanId(
  subscription:
    Stripe.Subscription
): TripleNPlanId | null {
  const metadataPlan =
    subscription
      .metadata
      ?.triple_n_plan_id;

  if (
    metadataPlan ===
      "monthly" ||
    metadataPlan ===
      "yearly"
  ) {
    return metadataPlan;
  }

  const firstItem =
    subscription
      .items
      .data[0];

  const interval =
    firstItem
      ?.price
      ?.recurring
      ?.interval;

  if (
    interval ===
      "month"
  ) {
    return "monthly";
  }

  if (
    interval ===
      "year"
  ) {
    return "yearly";
  }

  return null;
}

/* =========================================================
 * Current billing period
 *
 * Stripe API versions may expose the current period on
 * subscription items.
 *
 * A legacy subscription-level fallback is retained.
 * ======================================================= */

function getCurrentPeriod(
  subscription:
    Stripe.Subscription
): {
  start:
    number | null;

  end:
    number | null;
} {
  const starts:
    number[] = [];

  const ends:
    number[] = [];

  for (
    const item
    of subscription.items.data
  ) {
    const typedItem =
      item as Stripe.SubscriptionItem & {
        current_period_start?:
          number;

        current_period_end?:
          number;
      };

    if (
      typeof typedItem
        .current_period_start ===
      "number"
    ) {
      starts.push(
        typedItem
          .current_period_start
      );
    }

    if (
      typeof typedItem
        .current_period_end ===
      "number"
    ) {
      ends.push(
        typedItem
          .current_period_end
      );
    }
  }

  if (
    starts.length >
      0 &&
    ends.length >
      0
  ) {
    return {
      start:
        Math.min(
          ...starts
        ),

      end:
        Math.max(
          ...ends
        ),
    };
  }

  const legacySubscription =
    subscription as Stripe.Subscription & {
      current_period_start?:
        number;

      current_period_end?:
        number;
    };

  return {
    start:
      typeof legacySubscription
        .current_period_start ===
      "number"
        ? legacySubscription
            .current_period_start
        : null,

    end:
      typeof legacySubscription
        .current_period_end ===
      "number"
        ? legacySubscription
            .current_period_end
        : null,
  };
}

/* =========================================================
 * Invoice -> Subscription ID
 *
 * Supports current and legacy Stripe invoice structures.
 * ======================================================= */

function getInvoiceSubscriptionId(
  invoice:
    Stripe.Invoice
): string | null {
  const modernInvoice =
    invoice as Stripe.Invoice & {
      parent?:
        {
          subscription_details?:
            {
              subscription?:
                | string
                | Stripe.Subscription
                | null;
            } | null;
        } | null;
    };

  const modernSubscription =
    modernInvoice
      .parent
      ?.subscription_details
      ?.subscription;

  const modernId =
    getStripeId(
      modernSubscription
    );

  if (
    modernId
  ) {
    return modernId;
  }

  const legacyInvoice =
    invoice as Stripe.Invoice & {
      subscription?:
        | string
        | Stripe.Subscription
        | null;
    };

  const legacyId =
    getStripeId(
      legacyInvoice
        .subscription
    );

  if (
    legacyId
  ) {
    return legacyId;
  }

  /*
   * Additional fallback through invoice lines.
   */

  for (
    const line
    of invoice.lines.data
  ) {
    const typedLine =
      line as typeof line & {
        parent?:
          {
            subscription_item_details?:
              {
                subscription?:
                  | string
                  | Stripe.Subscription
                  | null;
              } | null;
          } | null;
      };

    const lineSubscriptionId =
      getStripeId(
        typedLine
          .parent
          ?.subscription_item_details
          ?.subscription
      );

    if (
      lineSubscriptionId
    ) {
      return lineSubscriptionId;
    }
  }

  return null;
}

/* =========================================================
 * Resolve Triple N user
 *
 * Resolution order:
 *
 * 1. Existing Supabase subscription row.
 * 2. Stripe subscription metadata.
 * 3. Stripe Checkout Session client_reference_id.
 *
 * This allows recurring Stripe events to recover the
 * original authenticated Triple N account.
 * ======================================================= */

async function findUserIdForSubscription(
  subscription:
    Stripe.Subscription
): Promise<string | null> {
  const subscriptionId =
    subscription.id;

  /* -------------------------------------------------------
   * Existing database mapping
   * ----------------------------------------------------- */

  const {
    data,
    error,
  } =
    await supabaseAdmin
      .from(
        "subscriptions"
      )
      .select(
        "user_id"
      )
      .eq(
        "provider",
        "stripe"
      )
      .eq(
        "provider_subscription_id",
        subscriptionId
      )
      .maybeSingle();

  if (
    error
  ) {
    throw new Error(
      `Failed to look up subscription user: ${error.message}`
    );
  }

  if (
    data?.user_id &&
    isUuid(
      data.user_id
    )
  ) {
    return data.user_id;
  }

  /* -------------------------------------------------------
   * Subscription metadata
   * ----------------------------------------------------- */

  const metadataUserId =
    subscription
      .metadata
      ?.triple_n_user_id;

  if (
    metadataUserId &&
    isUuid(
      metadataUserId
    )
  ) {
    return metadataUserId;
  }

  /* -------------------------------------------------------
   * Checkout Session fallback
   * ----------------------------------------------------- */

  const sessions =
    await stripe
      .checkout
      .sessions
      .list({
        subscription:
          subscriptionId,

        limit:
          10,
      });

  for (
    const session
    of sessions.data
  ) {
    const userId =
      session
        .client_reference_id;

    if (
      userId &&
      isUuid(
        userId
      )
    ) {
      return userId;
    }

    const metadataUserId =
      session
        .metadata
        ?.triple_n_user_id;

    if (
      metadataUserId &&
      isUuid(
        metadataUserId
      )
    ) {
      return metadataUserId;
    }
  }

  return null;
}

/* =========================================================
 * Synchronize Stripe -> Supabase
 * ======================================================= */

async function syncSubscription(
  subscription:
    Stripe.Subscription,
  options:
    SyncSubscriptionOptions = {}
): Promise<boolean> {
  const subscriptionId =
    subscription.id;

  let userId =
    options
      .preferredUserId ??
    null;

  if (
    !userId
  ) {
    userId =
      await findUserIdForSubscription(
        subscription
      );
  }

  if (
    !userId
  ) {
    console.warn(
      "Unable to map Stripe subscription to Triple N user:",
      subscriptionId
    );

    return false;
  }

  if (
    !isUuid(
      userId
    )
  ) {
    console.error(
      "Invalid Triple N user ID:",
      userId
    );

    return false;
  }

  const customerId =
    getStripeId(
      subscription.customer
    );

  const planId =
    getPlanId(
      subscription
    );

  const period =
    getCurrentPeriod(
      subscription
    );

  const stripeStatus =
    mapStripeSubscriptionStatus(
      subscription.status
    );

  const status =
    options
      .statusOverride ??
    stripeStatus;

  const currentPeriodStart =
    unixToIso(
      period.start
    );

  const currentPeriodEnd =
    unixToIso(
      period.end
    );

  const cancelledAt =
    unixToIso(
      subscription
        .canceled_at
    );

  const endedAt =
    unixToIso(
      subscription
        .ended_at
    );

  const startedAt =
    unixToIso(
      subscription
        .start_date
    );

  /* -------------------------------------------------------
   * Renewal
   * ----------------------------------------------------- */

  let willRenew:
    boolean | null =
      null;

  if (
    status ===
      "active" ||
    status ===
      "pending" ||
    status ===
      "past_due"
  ) {
    willRenew =
      !subscription
        .cancel_at_period_end;
  } else if (
    status ===
      "cancelled" ||
    status ===
      "expired" ||
    status ===
      "inactive"
  ) {
    willRenew =
      false;
  }

  /* -------------------------------------------------------
   * Expiration
   * ----------------------------------------------------- */

  let expiresAt:
    string | null =
      null;

  /*
   * User has cancelled future renewal but still owns
   * access until the end of the paid billing period.
   */

  if (
    subscription
      .cancel_at_period_end &&
    currentPeriodEnd
  ) {
    expiresAt =
      currentPeriodEnd;
  }

  /*
   * Stripe subscription has actually ended.
   */

  if (
    status ===
      "cancelled" ||
    status ===
      "expired"
  ) {
    expiresAt =
      endedAt ??
      currentPeriodEnd ??
      cancelledAt;
  }

  const now =
    new Date()
      .toISOString();

  const row:
    Record<
      string,
      unknown
    > = {
    user_id:
      userId,

    status,

    plan_id:
      planId,

    provider:
      "stripe",

    provider_customer_id:
      customerId,

    provider_subscription_id:
      subscriptionId,

    started_at:
      startedAt,

    current_period_start:
      currentPeriodStart,

    current_period_end:
      currentPeriodEnd,

    cancelled_at:
      cancelledAt,

    expires_at:
      expiresAt,

    will_renew:
      willRenew,

    last_verified_at:
      now,

    updated_at:
      now,
  };

  /*
   * Do not erase an existing transaction ID when an event
   * does not provide a newer one.
   */

  if (
    options
      .providerTransactionId
  ) {
    row
      .provider_transaction_id =
        options
          .providerTransactionId;
  }

  const {
    error,
  } =
    await supabaseAdmin
      .from(
        "subscriptions"
      )
      .upsert(
        row,
        {
          onConflict:
            "user_id",
        }
      );

  if (
    error
  ) {
    throw new Error(
      `Failed to synchronize subscription: ${error.message}`
    );
  }

  console.log(
    "Stripe subscription synchronized:",
    {
      userId,
      subscriptionId,
      customerId,
      status,
      planId,
      willRenew,
      currentPeriodEnd,
    }
  );

  return true;
}

/* =========================================================
 * Retrieve authoritative current Stripe state
 *
 * Stripe webhook events may arrive out of order.
 *
 * Retrieving the current subscription prevents an older
 * webhook event from overwriting newer Stripe state.
 * ======================================================= */

async function syncSubscriptionById(
  subscriptionId:
    string,
  options:
    SyncSubscriptionOptions = {}
): Promise<boolean> {
  const subscription =
    await stripe
      .subscriptions
      .retrieve(
        subscriptionId
      );

  return await syncSubscription(
    subscription,
    options
  );
}

/* =========================================================
 * Checkout completed
 * ======================================================= */

async function handleCheckoutSession(
  session:
    Stripe.Checkout.Session
): Promise<void> {
  if (
    session.mode !==
      "subscription"
  ) {
    console.log(
      "Ignoring non-subscription Checkout Session:",
      session.id
    );

    return;
  }

  const subscriptionId =
    getStripeId(
      session.subscription
    );

  if (
    !subscriptionId
  ) {
    console.warn(
      "Checkout Session has no subscription:",
      session.id
    );

    return;
  }

  let userId =
    session
      .client_reference_id;

  if (
    !userId ||
    !isUuid(
      userId
    )
  ) {
    const metadataUserId =
      session
        .metadata
        ?.triple_n_user_id;

    userId =
      metadataUserId &&
      isUuid(
        metadataUserId
      )
        ? metadataUserId
        : null;
  }

  if (
    !userId
  ) {
    console.warn(
      "Checkout Session has no valid Triple N user reference:",
      session.id
    );

    return;
  }

  await syncSubscriptionById(
    subscriptionId,
    {
      preferredUserId:
        userId,

      providerTransactionId:
        session.id,
    }
  );
}

/* =========================================================
 * Subscription lifecycle event
 * ======================================================= */

async function handleSubscriptionEvent(
  eventSubscription:
    Stripe.Subscription
): Promise<void> {
  try {
    /*
     * Retrieve Stripe's latest state instead of blindly
     * trusting webhook delivery order.
     */

    await syncSubscriptionById(
      eventSubscription.id
    );
  } catch (
    error
  ) {
    console.warn(
      "Unable to retrieve current Stripe subscription; using webhook object:",
      eventSubscription.id,
      error
    );

    await syncSubscription(
      eventSubscription
    );
  }
}

/* =========================================================
 * Invoice paid
 * ======================================================= */

async function handleInvoicePaid(
  invoice:
    Stripe.Invoice
): Promise<void> {
  const subscriptionId =
    getInvoiceSubscriptionId(
      invoice
    );

  if (
    !subscriptionId
  ) {
    console.log(
      "Ignoring non-subscription paid invoice:",
      invoice.id
    );

    return;
  }

  await syncSubscriptionById(
    subscriptionId,
    {
      providerTransactionId:
        invoice.id,
    }
  );
}

/* =========================================================
 * Invoice payment failed
 * ======================================================= */

async function handleInvoicePaymentFailed(
  invoice:
    Stripe.Invoice
): Promise<void> {
  const subscriptionId =
    getInvoiceSubscriptionId(
      invoice
    );

  if (
    !subscriptionId
  ) {
    console.log(
      "Ignoring non-subscription failed invoice:",
      invoice.id
    );

    return;
  }

  await syncSubscriptionById(
    subscriptionId,
    {
      providerTransactionId:
        invoice.id,

      statusOverride:
        "past_due",
    }
  );
}

/* =========================================================
 * Webhook server
 * ======================================================= */

Deno.serve(
  async (
    req:
      Request
  ) => {
    /* -----------------------------------------------------
     * Method
     * --------------------------------------------------- */

    if (
      req.method !==
        "POST"
    ) {
      return new Response(
        "Method not allowed",
        {
          status:
            405,
        }
      );
    }

    /* -----------------------------------------------------
     * Environment safety
     * --------------------------------------------------- */

    if (
      !STRIPE_SECRET_KEY
    ) {
      console.error(
        "STRIPE_SECRET_KEY is missing"
      );

      return new Response(
        "Stripe secret key not configured",
        {
          status:
            500,
        }
      );
    }

    if (
      !STRIPE_WEBHOOK_SECRET
    ) {
      console.error(
        "STRIPE_WEBHOOK_SECRET is missing"
      );

      return new Response(
        "Webhook secret not configured",
        {
          status:
            500,
        }
      );
    }

    if (
      !SUPABASE_URL ||
      !SUPABASE_SERVICE_ROLE_KEY
    ) {
      console.error(
        "Supabase server credentials are missing"
      );

      return new Response(
        "Supabase server configuration missing",
        {
          status:
            500,
        }
      );
    }

    /* -----------------------------------------------------
     * Stripe signature
     * --------------------------------------------------- */

    const signature =
      req.headers.get(
        "stripe-signature"
      );

    if (
      !signature
    ) {
      return new Response(
        "Missing Stripe signature",
        {
          status:
            400,
        }
      );
    }

    /*
     * IMPORTANT:
     *
     * Stripe signature verification requires the exact,
     * unmodified raw HTTP request body.
     */

    const body =
      await req.text();

    let event:
      Stripe.Event;

    try {
      event =
        await stripe
          .webhooks
          .constructEventAsync(
            body,
            signature,
            STRIPE_WEBHOOK_SECRET,
            undefined,
            cryptoProvider
          );
    } catch (
      error
    ) {
      console.error(
        "Stripe signature verification failed:",
        error
      );

      return new Response(
        "Invalid Stripe signature",
        {
          status:
            400,
        }
      );
    }

    /* -----------------------------------------------------
     * Process verified Stripe event
     * --------------------------------------------------- */

    try {
      switch (
        event.type
      ) {
        /* -----------------------------------------------
         * Checkout
         * --------------------------------------------- */

        case "checkout.session.completed": {
          const session =
            event
              .data
              .object as
              Stripe.Checkout.Session;

          await handleCheckoutSession(
            session
          );

          break;
        }

        case "checkout.session.async_payment_succeeded": {
          const session =
            event
              .data
              .object as
              Stripe.Checkout.Session;

          await handleCheckoutSession(
            session
          );

          break;
        }

        /* -----------------------------------------------
         * Subscription lifecycle
         * --------------------------------------------- */

        case "customer.subscription.created": {
          const subscription =
            event
              .data
              .object as
              Stripe.Subscription;

          await handleSubscriptionEvent(
            subscription
          );

          break;
        }

        case "customer.subscription.updated": {
          const subscription =
            event
              .data
              .object as
              Stripe.Subscription;

          await handleSubscriptionEvent(
            subscription
          );

          break;
        }

        case "customer.subscription.deleted": {
          const subscription =
            event
              .data
              .object as
              Stripe.Subscription;

          await handleSubscriptionEvent(
            subscription
          );

          break;
        }

        /* -----------------------------------------------
         * Renewal / invoices
         * --------------------------------------------- */

        case "invoice.paid": {
          const invoice =
            event
              .data
              .object as
              Stripe.Invoice;

          await handleInvoicePaid(
            invoice
          );

          break;
        }

        case "invoice.payment_failed": {
          const invoice =
            event
              .data
              .object as
              Stripe.Invoice;

          await handleInvoicePaymentFailed(
            invoice
          );

          break;
        }

        /* -----------------------------------------------
         * Everything else
         * --------------------------------------------- */

        default:
          console.log(
            "Unhandled Stripe event:",
            event.type
          );
      }
    } catch (
      error
    ) {
      /*
       * IMPORTANT:
       *
       * Return 500 for a real database/payment processing
       * failure.
       *
       * Stripe can then retry webhook delivery instead of
       * Triple N silently losing the subscription update.
       */

      console.error(
        "Stripe webhook processing failed:",
        {
          eventId:
            event.id,

          eventType:
            event.type,

          error,
        }
      );

      return Response.json(
        {
          received:
            false,

          eventId:
            event.id,

          eventType:
            event.type,

          error:
            "WEBHOOK_PROCESSING_FAILED",
        },
        {
          status:
            500,
        }
      );
    }

    /* -----------------------------------------------------
     * Success
     * --------------------------------------------------- */

    return Response.json(
      {
        received:
          true,

        eventId:
          event.id,

        eventType:
          event.type,
      },
      {
        status:
          200,
      }
    );
  }
);