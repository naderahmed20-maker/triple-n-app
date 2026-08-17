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
  Deno.env.get("STRIPE_SECRET_KEY") ?? "";

const SUPABASE_URL =
  Deno.env.get("SUPABASE_URL") ?? "";

const SUPABASE_ANON_KEY =
  Deno.env.get("SUPABASE_ANON_KEY") ?? "";

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
 * Prices are defined server-side.
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
        499,

      interval:
        "month",

      name:
        "Triple N Monthly",

      description:
        "Triple N monthly subscription",
    },

    yearly: {
      amount:
        3999,

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
    Record<string, unknown>,
  status =
    200
): Response {
  return new Response(
    JSON.stringify(body),
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
        await req.json();
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
          "status, current_period_end"
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
        subscriptionLookupError.message
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

      if (
        stillActive
      ) {
        return jsonResponse(
          {
            error:
              "SUBSCRIPTION_ALREADY_ACTIVE",
          },
          409
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

            customer_email:
              user.email ??
              undefined,

            line_items: [
              {
                quantity:
                  1,

                price_data: {
                  currency:
                    "eur",

                  unit_amount:
                    plan.amount,

                  recurring: {
                    interval:
                      plan.interval,
                  },

                  product_data: {
                    name:
                      plan.name,

                    description:
                      plan.description,
                  },
                },
              },
            ],

            metadata: {
              triple_n_user_id:
                user.id,

              triple_n_plan_id:
                planId,
            },

            subscription_data: {
              metadata: {
                triple_n_user_id:
                  user.id,

                triple_n_plan_id:
                  planId,
              },
            },

            /*
             * Real public HTTPS return URLs.
             */

            success_url:
              `${TRIPLE_N_WEBSITE_URL}?payment=success&session_id={CHECKOUT_SESSION_ID}`,

            cancel_url:
              `${TRIPLE_N_WEBSITE_URL}?payment=cancelled`,
          });

      /* ---------------------------------------------------
       * Stripe must return a hosted Checkout URL.
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

      return jsonResponse(
        {
          error:
            "STRIPE_CHECKOUT_FAILED",
        },
        500
      );
    }
  }
);