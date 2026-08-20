import {
    createClient,
} from "npm:@supabase/supabase-js@^2";

import {
    reportExpiredAppleTokens,
} from "../_shared/appleExternalPurchaseReporting.ts";

/* =========================================================
 * Environment
 * ======================================================= */

const SUPABASE_URL =
  Deno.env.get(
    "SUPABASE_URL"
  ) ?? "";

const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get(
    "SUPABASE_SERVICE_ROLE_KEY"
  ) ?? "";

const APPLE_REPORT_SWEEP_SECRET =
  Deno.env.get(
    "APPLE_REPORT_SWEEP_SECRET"
  ) ?? "";

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
 * Main
 * ======================================================= */

Deno.serve(
  async (
    req:
      Request
  ) => {
    if (
      req.method !==
        "POST"
    ) {
      return Response.json(
        {
          success:
            false,

          error:
            "METHOD_NOT_ALLOWED",
        },
        {
          status:
            405,
        }
      );
    }

    if (
      !SUPABASE_URL ||
      !SUPABASE_SERVICE_ROLE_KEY
    ) {
      return Response.json(
        {
          success:
            false,

          error:
            "SUPABASE_NOT_CONFIGURED",
        },
        {
          status:
            500,
        }
      );
    }

    if (
      !APPLE_REPORT_SWEEP_SECRET
    ) {
      return Response.json(
        {
          success:
            false,

          error:
            "SWEEP_SECRET_NOT_CONFIGURED",
        },
        {
          status:
            500,
        }
      );
    }

    const suppliedSecret =
      req.headers.get(
        "x-apple-report-sweep-secret"
      );

    if (
      suppliedSecret !==
        APPLE_REPORT_SWEEP_SECRET
    ) {
      return Response.json(
        {
          success:
            false,

          error:
            "UNAUTHORIZED",
        },
        {
          status:
            401,
        }
      );
    }

    try {
      const result =
        await reportExpiredAppleTokens({
          supabaseAdmin,

          limit:
            100,
        });

      return Response.json(
        {
          success:
            true,

          ...result,
        },
        {
          status:
            200,
        }
      );
    } catch (
      error:
        unknown
    ) {
      const message =
        error instanceof Error
          ? error.message
          : "APPLE_TOKEN_SWEEP_FAILED";

      console.error(
        "APPLE EXPIRED TOKEN SWEEP FAILED:",
        message
      );

return Response.json(
  {
    success:
      false,

    error:
  "APPLE_TOKEN_SWEEP_FAILED",
  },
        {
          status:
            500,
        }
      );
    }
  }
);