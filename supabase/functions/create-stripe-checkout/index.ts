import "@supabase/functions-js/edge-runtime.d.ts";

import Stripe from "npm:stripe@^22";

import {
  createClient,
} from "npm:@supabase/supabase-js@^2";

/* =========================================================
 * Triple N - Create Stripe Checkout
 * ======================================================= */

/* =========================================================
 * Environment
 * ======================================================= */

const STRIPE_SECRET_KEY =
  Deno.env.get(
    "STRIPE_SECRET_KEY"
  ) ?? "";

const SUPABASE_URL =
  Deno.env.get(
    "SUPABASE_URL"
  ) ?? "";

const SUPABASE_ANON_KEY =
  Deno.env.get(
    "SUPABASE_ANON_KEY"
  ) ?? "";

/* =========================================================
 * Triple N website
 * ======================================================= */

const TRIPLE_N_WEBSITE_URL =
  "https://naderahmed20-maker.github.io/triple-n-website/";

/* =========================================================
 * Stripe
 * ======================================================= */

const stripe =
  new Stripe(
    STRIPE_SECRET_KEY
  );

/* =========================================================
 * Plans
 *
 * Prices are server-side and represent PRE-TAX prices.
 *
 * Monthly:
 * EUR 1.00 + applicable VAT/tax
 *
 * Yearly:
 * EUR 12.00 + applicable VAT/tax
 *
 * The mobile app is NEVER trusted to provide an amount.
 * ======================================================= */

type TripleNPlanId =
  | "monthly"
  | "yearly";

type PlanConfiguration = {
  amount:
    number;

  interval:
    "month" | "year";

  name:
    string;

  description:
    string;
};

const PLANS:
  Record<
    TripleNPlanId,
    PlanConfiguration
  > = {
    monthly: {
      amount:
        100,

      interval:
        "month",

      name:
        "Triple N Monthly",

      description:
        "Triple N monthly subscription",
    },

    yearly: {
      amount:
        1200,

      interval:
        "year",

      name:
        "Triple N Yearly",

      description:
        "Triple N yearly subscription",
    },
  };

/* =========================================================
 * CORS
 * ======================================================= */

const corsHeaders = {
  "Access-Control-Allow-Origin":
    "*",

  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",

  "Access-Control-Allow-Methods":
    "POST, OPTIONS",

  "Content-Type":
    "application/json",
};

/* =========================================================
 * Response helper
 * ======================================================= */

function jsonResponse(
  body:
    Record<
      string,
      unknown
    >,
  status =
    200
): Response {
  return new Response(
    JSON.stringify(
      body
    ),
    {
      status,

      headers:
        corsHeaders,
    }
  );
}

/* =========================================================
 * Plan validation
 * ======================================================= */

function isPlanId(
  value:
    unknown
): value is TripleNPlanId {
  return (
    value ===
      "monthly" ||
    value ===
      "yearly"
  );
}

/* =========================================================
 * Main
 * ======================================================= */

Deno.serve(
  async (
    req:
      Request
  ) => {
    /* -----------------------------------------------------
     * CORS preflight
     * --------------------------------------------------- */

    if (
      req.method ===
        "OPTIONS"
    ) {
      return new Response(
        "ok",
        {
          headers:
            corsHeaders,
        }
      );
    }

    /* -----------------------------------------------------
     * Method
     * --------------------------------------------------- */

    if (
      req.method !==
        "POST"
    ) {
      return jsonResponse(
        {
          error:
            "METHOD_NOT_ALLOWED",
        },
        405
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

      return jsonResponse(
        {
          error:
            "STRIPE_NOT_CONFIGURED",
        },
        500
      );
    }

    if (
      !SUPABASE_URL ||
      !SUPABASE_ANON_KEY
    ) {
      console.error(
        "Supabase environment variables are missing"
      );

      return jsonResponse(
        {
          error:
            "SUPABASE_NOT_CONFIGURED",
        },
        500
      );
    }

    /* -----------------------------------------------------
     * Authentication
     * --------------------------------------------------- */

    const authorization =
      req.headers.get(
        "Authorization"
      );

    if (
      !authorization
    ) {
      return jsonResponse(
        {
          error:
            "AUTHENTICATION_REQUIRED",
        },
        401
      );
    }

    /*
     * Authenticate using the caller's Supabase JWT.
     *
     * IMPORTANT:
     * Never accept userId from the request body.
     */

    const supabase =
      createClient(
        SUPABASE_URL,
        SUPABASE_ANON_KEY,
        {
          global: {
            headers: {
              Authorization:
                authorization,
            },
          },

          auth: {
            persistSession:
              false,

            autoRefreshToken:
              false,
          },
        }
      );

    const {
      data:
        authData,
      error:
        authError,
    } =
      await supabase
        .auth
        .getUser();

    if (
      authError ||
      !authData.user
    ) {
      console.warn(
        "Checkout authentication failed:",
        authError?.message
      );

      return jsonResponse(
        {
          error:
            "INVALID_AUTHENTICATION",
        },
        401
      );
    }

    const user =
      authData.user;

    /* -----------------------------------------------------
     * Request body
     * --------------------------------------------------- */

    let body:
      {
        planId?:
          unknown;
      };

    try {
      body =
        await req
          .json();
    } catch {
      return jsonResponse(
        {
          error:
            "INVALID_REQUEST_BODY",
        },
        400
      );
    }

    if (
      !isPlanId(
        body.planId
      )
    ) {
      return jsonResponse(
        {
          error:
            "INVALID_PLAN",
        },
        400
      );
    }

    const planId =
      body.planId;

    const plan =
      PLANS[
        planId
      ];

    /* -----------------------------------------------------
     * Existing subscription protection
     * --------------------------------------------------- */

    const {
      data:
        existingSubscription,
      error:
        subscriptionLookupError,
    } =
      await supabase
        .from(
          "subscriptions"
        )
        .select(
          "status, current_period_end, provider, provider_subscription_id"
        )
        .eq(
          "user_id",
          user.id
        )
        .maybeSingle();

    if (
      subscriptionLookupError
    ) {
      console.warn(
        "Unable to check existing subscription:",
        subscriptionLookupError
          .message
      );
    }

    if (
      existingSubscription
        ?.status ===
          "active"
    ) {
      const periodEnd =
        existingSubscription
          .current_period_end;

      const stillActive =
        !periodEnd ||
        new Date(
          periodEnd
        ).getTime() >
          Date.now();

      const hasRealStripeSubscription =
        existingSubscription
          .provider ===
          "stripe" &&
        typeof existingSubscription
          .provider_subscription_id ===
          "string" &&
        existingSubscription
          .provider_subscription_id
          .trim()
          .length >
          0;

      /*
       * Block duplicate checkout ONLY when Supabase contains
       * a real Stripe-backed active subscription.
       *
       * Legacy development-access rows may have status=active
       * without a Stripe subscription ID. Those rows must not
       * prevent the user from purchasing a real subscription.
       */

      if (
        stillActive &&
        hasRealStripeSubscription
      ) {
        return jsonResponse(
          {
            error:
              "SUBSCRIPTION_ALREADY_ACTIVE",
          },
          409
        );
      }

      if (
        stillActive &&
        !hasRealStripeSubscription
      ) {
        console.warn(
          "Ignoring legacy/non-Stripe active subscription row:",
          {
            userId:
              user.id,

            provider:
              existingSubscription
                .provider,

            providerSubscriptionId:
              existingSubscription
                .provider_subscription_id ??
              null,
          }
        );
      }
    }

    /* -----------------------------------------------------
     * Create Stripe Checkout Session
     * --------------------------------------------------- */

    try {
      const session =
        await stripe
          .checkout
          .sessions
          .create({
            mode:
              "subscription",

            client_reference_id:
              user.id,

            /*
             * Stripe may create the Customer for subscription
             * Checkout if one isn't already supplied.
             */

            customer_email:
              user.email ??
              undefined,

            /*
             * Stripe Tax
             *
             * This enables real automatic tax calculation.
             *
             * The plan prices remain exclusive of tax.
             * Applicable VAT/tax is added on top according
             * to Stripe's tax calculation and customer location.
             */

            automatic_tax: {
              enabled:
                true,
            },

            /*
             * Require billing address so Stripe has strong
             * customer-location evidence for tax calculation.
             */

            billing_address_collection:
              "required",

            /* -------------------------------------------------
             * Subscription item
             * ----------------------------------------------- */

            line_items: [
              {
                quantity:
                  1,

                price_data: {
                  currency:
                    "eur",

                  /*
                   * Amounts are in cents.
                   *
                   * monthly = 100  -> EUR 1.00
                   * yearly  = 1200 -> EUR 12.00
                   */

                  unit_amount:
                    plan.amount,

                  /*
                   * VAT/tax is added on TOP of the configured
                   * Triple N price.
                   */

                  tax_behavior:
                    "exclusive",

                  recurring: {
                    interval:
                      plan.interval,
                  },

                  product_data: {
                    name:
                      plan.name,

                    description:
                      plan.description,

                    /*
                     * Stripe product tax code.
                     *
                     * This classifies the digital service.
                     * automatic_tax above performs the actual
                     * tax calculation.
                     */

                    tax_code:
                      "txcd_10103100",
                  },
                },
              },
            ],

            /* -------------------------------------------------
             * Checkout Session metadata
             * ----------------------------------------------- */

            metadata: {
              triple_n_user_id:
                user.id,

              triple_n_plan_id:
                planId,
            },

            /* -------------------------------------------------
             * Subscription metadata
             *
             * This is retained on the Stripe Subscription and
             * lets webhook renewals map back to Triple N.
             * ----------------------------------------------- */

            subscription_data: {
              metadata: {
                triple_n_user_id:
                  user.id,

                triple_n_plan_id:
                  planId,
              },
            },

            /* -------------------------------------------------
             * Public HTTPS return URLs
             * ----------------------------------------------- */

            success_url:
              `${TRIPLE_N_WEBSITE_URL}?payment=success&session_id={CHECKOUT_SESSION_ID}`,

            cancel_url:
              `${TRIPLE_N_WEBSITE_URL}?payment=cancelled`,
          });

      /* ---------------------------------------------------
       * Stripe must return a hosted Checkout URL
       * ------------------------------------------------- */

      if (
        !session.url
      ) {
        console.error(
          "Stripe Checkout Session returned no URL:",
          session.id
        );

        return jsonResponse(
          {
            error:
              "CHECKOUT_URL_NOT_CREATED",
          },
          500
        );
      }

      console.log(
        "Stripe Checkout Session created:",
        {
          sessionId:
            session.id,

          userId:
            user.id,

          planId,

          automaticTax:
            true,

          taxBehavior:
            "exclusive",
        }
      );

      /*
       * Return only public checkout information.
       *
       * STRIPE_SECRET_KEY is NEVER returned.
       */

      return jsonResponse(
        {
          checkoutUrl:
            session.url,

          sessionId:
            session.id,

          planId,
        },
        200
      );
    } catch (
      error
    ) {
      console.error(
        "Stripe Checkout creation failed:",
        error
      );

      const stripeError =
        error &&
        typeof error ===
          "object"
          ? error as {
              type?:
                unknown;

              code?:
                unknown;

              message?:
                unknown;

              param?:
                unknown;

              requestId?:
                unknown;
            }
          : null;

      const stripeType =
        typeof stripeError
          ?.type ===
          "string"
          ? stripeError
              .type
          : null;

      const stripeCode =
        typeof stripeError
          ?.code ===
          "string"
          ? stripeError
              .code
          : null;

      const stripeMessage =
        typeof stripeError
          ?.message ===
          "string"
          ? stripeError
              .message
          : null;

      const stripeParam =
        typeof stripeError
          ?.param ===
          "string"
          ? stripeError
              .param
          : null;

      const stripeRequestId =
        typeof stripeError
          ?.requestId ===
          "string"
          ? stripeError
              .requestId
          : null;

      console.error(
        "Stripe diagnostic:",
        {
          type:
            stripeType,

          code:
            stripeCode,

          message:
            stripeMessage,

          param:
            stripeParam,

          requestId:
            stripeRequestId,
        }
      );

      return jsonResponse(
        {
          error:
            "STRIPE_CHECKOUT_FAILED",

          stripeType,

          stripeCode,

          stripeMessage,

          stripeParam,

          stripeRequestId,
        },
        500
      );
    }
  }
);