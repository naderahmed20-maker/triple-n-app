import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@22.0.0";

/* =========================================================
 * Triple N — Delete Account
 *
 * Security:
 * - Never trusts userId from request body.
 * - Resolves the user only from the Supabase JWT.
 * - Service Role stays server-side.
 *
 * Order:
 * 1. Authenticate user.
 * 2. Find Stripe subscriptions.
 * 3. Cancel Stripe subscriptions.
 * 4. Remove wardrobe Storage objects.
 * 5. Delete user-owned database rows.
 * 6. Delete Supabase Auth user LAST.
 * ======================================================= */

const SUPABASE_URL =
  Deno.env.get("SUPABASE_URL") ?? "";

const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const STRIPE_SECRET_KEY =
  Deno.env.get("STRIPE_SECRET_KEY") ?? "";

const WARDROBE_BUCKET =
  "wardrobe";

const stripe =
  new Stripe(
    STRIPE_SECRET_KEY
  );

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods":
    "POST, OPTIONS",
};

function jsonResponse(
  body: Record<string, unknown>,
  status = 200
): Response {
  return new Response(
    JSON.stringify(body),
    {
      status,
      headers: {
        ...corsHeaders,
        "Content-Type":
          "application/json",
      },
    }
  );
}

function getBearerToken(
  request: Request
): string | null {
  const authorization =
    request.headers.get(
      "Authorization"
    );

  if (!authorization) {
    return null;
  }

  const match =
    authorization.match(
      /^Bearer\s+(.+)$/i
    );

  return match?.[1]?.trim() || null;
}

async function removeWardrobeStorage(
  supabaseAdmin: ReturnType<
    typeof createClient
  >,
  userId: string
): Promise<number> {
  let removedCount = 0;

  /*
   * Files created by Triple N use:
   *
   * wardrobe/<userId>/<filename>
   *
   * Always list from offset 0 because each
   * successful remove shortens the directory.
   */

  for (;;) {
    const {
      data,
      error,
    } =
      await supabaseAdmin
        .storage
        .from(
          WARDROBE_BUCKET
        )
        .list(
          userId,
          {
            limit: 100,
            offset: 0,
            sortBy: {
              column:
                "name",
              order:
                "asc",
            },
          }
        );

    if (error) {
      throw new Error(
        `Unable to list wardrobe storage: ${error.message}`
      );
    }

    if (
      !data ||
      data.length === 0
    ) {
      break;
    }

    const paths =
      data
        .filter(
          (entry) =>
            typeof entry.name ===
              "string" &&
            entry.name.length > 0 &&
            entry.name !==
              ".emptyFolderPlaceholder"
        )
        .map(
          (entry) =>
            `${userId}/${entry.name}`
        );

    if (
      paths.length === 0
    ) {
      break;
    }

    const {
      error:
        removeError,
    } =
      await supabaseAdmin
        .storage
        .from(
          WARDROBE_BUCKET
        )
        .remove(
          paths
        );

    if (removeError) {
      throw new Error(
        `Unable to delete wardrobe storage: ${removeError.message}`
      );
    }

    removedCount +=
      paths.length;
  }

  return removedCount;
}

async function deleteRowsByUserId(
  supabaseAdmin: ReturnType<
    typeof createClient
  >,
  table: string,
  userId: string
): Promise<void> {
  const {
    error,
  } =
    await supabaseAdmin
      .from(
        table
      )
      .delete()
      .eq(
        "user_id",
        userId
      );

  if (error) {
    throw new Error(
      `Unable to delete ${table}: ${error.message}`
    );
  }
}

Deno.serve(
  async (
    request: Request
  ): Promise<Response> => {
    if (
      request.method ===
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

    if (
      request.method !==
      "POST"
    ) {
      return jsonResponse(
        {
          success:
            false,
          error:
            "METHOD_NOT_ALLOWED",
        },
        405
      );
    }

    if (
      !SUPABASE_URL ||
      !SUPABASE_SERVICE_ROLE_KEY
    ) {
      console.error(
        "Supabase server environment is not configured."
      );

      return jsonResponse(
        {
          success:
            false,
          error:
            "SERVER_NOT_CONFIGURED",
        },
        500
      );
    }

    if (
      !STRIPE_SECRET_KEY
    ) {
      console.error(
        "STRIPE_SECRET_KEY is missing."
      );

      /*
       * We intentionally DO NOT delete the account
       * when Stripe cannot be checked.
       *
       * Otherwise a user could lose the Triple N
       * account while an external subscription
       * continues charging.
       */

      return jsonResponse(
        {
          success:
            false,
          error:
            "PAYMENT_SERVER_NOT_CONFIGURED",
        },
        500
      );
    }

    const token =
      getBearerToken(
        request
      );

    if (!token) {
      return jsonResponse(
        {
          success:
            false,
          error:
            "UNAUTHORIZED",
        },
        401
      );
    }

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

    try {
      /* =====================================================
       * Authenticate from JWT
       * =================================================== */

      const {
        data:
          userResult,
        error:
          userError,
      } =
        await supabaseAdmin
          .auth
          .getUser(
            token
          );

      const user =
        userResult.user;

      if (
        userError ||
        !user
      ) {
        console.warn(
          "Delete-account authentication failed."
        );

        return jsonResponse(
          {
            success:
              false,
            error:
              "UNAUTHORIZED",
          },
          401
        );
      }

      const userId =
        user.id;

      /* =====================================================
       * Read subscription BEFORE deleting anything
       * =================================================== */

      const {
        data:
          subscriptionRows,
        error:
          subscriptionError,
      } =
        await supabaseAdmin
          .from(
            "subscriptions"
          )
          .select(
            [
              "provider",
              "provider_customer_id",
              "provider_subscription_id",
              "status",
              "will_renew",
            ].join(",")
          )
          .eq(
            "user_id",
            userId
          );

      if (
        subscriptionError
      ) {
        throw new Error(
          `Unable to inspect subscriptions: ${subscriptionError.message}`
        );
      }

      /* =====================================================
       * Cancel Stripe FIRST
       * =================================================== */

      const stripeSubscriptionIds =
        Array.from(
          new Set(
            (
              subscriptionRows ??
              []
            )
              .filter(
                (row) =>
                  row.provider ===
                    "stripe" &&
                  typeof row.provider_subscription_id ===
                    "string" &&
                  row.provider_subscription_id
                    .trim()
                    .length >
                    0
              )
              .map(
                (row) =>
                  row
                    .provider_subscription_id
                    .trim()
              )
          )
        );

      for (
        const subscriptionId
        of stripeSubscriptionIds
      ) {
        try {
          await stripe
            .subscriptions
            .cancel(
              subscriptionId
            );

          console.log(
            "Stripe subscription cancelled for account deletion:",
            subscriptionId
          );
        } catch (
          error
        ) {
          /*
           * If Stripe says the subscription does not exist,
           * there is nothing left to cancel and deletion may
           * continue.
           */

          const stripeError =
            error as {
              code?: string;
              message?: string;
              statusCode?: number;
            };

          if (
            stripeError.code ===
              "resource_missing" ||
            stripeError.statusCode ===
              404
          ) {
            console.warn(
              "Stripe subscription was already absent:",
              subscriptionId
            );

            continue;
          }

          console.error(
            "Stripe cancellation failed:",
            subscriptionId,
            stripeError.message ??
              error
          );

          /*
           * Critical safety rule:
           * NEVER remove the account while Stripe cancellation
           * is uncertain.
           */

          return jsonResponse(
            {
              success:
                false,

              error:
                "STRIPE_CANCELLATION_FAILED",
            },
            502
          );
        }
      }

      /* =====================================================
       * Storage
       * =================================================== */

      const removedStorageFiles =
        await removeWardrobeStorage(
          supabaseAdmin,
          userId
        );

      /* =====================================================
       * User-owned rows
       *
       * Delete dependent rows before Auth user.
       * =================================================== */

      await deleteRowsByUserId(
        supabaseAdmin,
        "push_tokens",
        userId
      );

      await deleteRowsByUserId(
        supabaseAdmin,
        "saved_outfits",
        userId
      );

      await deleteRowsByUserId(
        supabaseAdmin,
        "wardrobe_items",
        userId
      );

      await deleteRowsByUserId(
        supabaseAdmin,
        "subscriptions",
        userId
      );

      await deleteRowsByUserId(
        supabaseAdmin,
        "issue_reports",
        userId
      );
      /*
       * profiles uses id = auth.users.id,
       * not user_id.
       */

      const {
        error:
          profileDeleteError,
      } =
        await supabaseAdmin
          .from(
            "profiles"
          )
          .delete()
          .eq(
            "id",
            userId
          );

      if (
        profileDeleteError
      ) {
        throw new Error(
          `Unable to delete profile: ${profileDeleteError.message}`
        );
      }

      /* =====================================================
       * Auth user — ALWAYS LAST
       * =================================================== */

      const {
        error:
          authDeleteError,
      } =
        await supabaseAdmin
          .auth
          .admin
          .deleteUser(
            userId
          );

      if (
        authDeleteError
      ) {
        throw new Error(
          `Unable to delete Auth user: ${authDeleteError.message}`
        );
      }

      console.log(
        "Triple N account permanently deleted:",
        userId
      );

      return jsonResponse(
        {
          success:
            true,

          deleted:
            true,

          cancelledStripeSubscriptions:
            stripeSubscriptionIds
              .length,

          removedStorageFiles,
        }
      );
    } catch (
      error
    ) {
      console.error(
        "Delete account failed:",
        error
      );

      return jsonResponse(
        {
          success:
            false,

          error:
            "ACCOUNT_DELETION_FAILED",

          message:
            error instanceof
              Error
              ? error.message
              : "Unknown deletion error",
        },
        500
      );
    }
  }
);