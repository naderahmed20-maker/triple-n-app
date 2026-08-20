import {
  Buffer,
} from "node:buffer";

import {
  Environment,
  SignedDataVerifier,
} from "npm:@apple/app-store-server-library@^3.1.0";

import {
  createClient,
} from "npm:@supabase/supabase-js@^2";

import {
  reportUnreportedAppleExternalPurchaseToken,
} from "../_shared/appleExternalPurchaseReporting.ts";

/* =========================================================
 * Triple N - App Store Server Notifications V2
 * ======================================================= */

const SUPABASE_URL =
  Deno.env.get(
    "SUPABASE_URL"
  ) ?? "";

const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get(
    "SUPABASE_SERVICE_ROLE_KEY"
  ) ?? "";

const APPLE_BUNDLE_ID =
  Deno.env.get(
    "APPLE_BUNDLE_ID"
  ) ?? "";

const APPLE_APP_ID =
  6802679821;

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

async function loadAppleRoots():
  Promise<Buffer[]> {
  const urls = [
    new URL(
      "./certs/AppleIncRootCertificate.cer",
      import.meta.url
    ),

    new URL(
      "./certs/AppleRootCA-G2.cer",
      import.meta.url
    ),

    new URL(
      "./certs/AppleRootCA-G3.cer",
      import.meta.url
    ),
  ];

  const certificates:
    Buffer[] = [];

  for (
    const url
    of urls
  ) {
    const bytes =
      await Deno
        .readFile(
          url
        );

    certificates.push(
      Buffer.from(
        bytes
      )
    );
  }

  return certificates;
}

async function verifyNotification(
  signedPayload:
    string
): Promise<
  Record<
    string,
    unknown
  >
> {
  const roots =
    await loadAppleRoots();

  /*
   * We don't trust an unverified payload to select its
   * environment. Verify against Production first, then
   * independently against Sandbox.
   */

  const productionVerifier =
    new SignedDataVerifier(
      roots,
      true,
      Environment.PRODUCTION,
      APPLE_BUNDLE_ID,
      APPLE_APP_ID
    );

  try {
    return (
      await productionVerifier
        .verifyAndDecodeNotification(
          signedPayload
        )
    ) as unknown as
      Record<
        string,
        unknown
      >;
  } catch (
    productionError
  ) {
    const sandboxVerifier =
      new SignedDataVerifier(
        roots,
        true,
        Environment.SANDBOX,
        APPLE_BUNDLE_ID
      );

    try {
      return (
        await sandboxVerifier
          .verifyAndDecodeNotification(
            signedPayload
          )
      ) as unknown as
        Record<
          string,
          unknown
        >;
    } catch (
      sandboxError
    ) {
      console.error(
        "APPLE JWS VERIFICATION FAILED:",
        {
          productionError,
          sandboxError,
        }
      );

      throw new Error(
        "APPLE_NOTIFICATION_SIGNATURE_INVALID"
      );
    }
  }
}

Deno.serve(
  async (
    req:
      Request
  ) => {
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

    if (
      !SUPABASE_URL ||
      !SUPABASE_SERVICE_ROLE_KEY ||
      !APPLE_BUNDLE_ID
    ) {
      return new Response(
        "Server configuration missing",
        {
          status:
            500,
        }
      );
    }

    let body:
      unknown;

    try {
      body =
        await req.json();
    } catch {
      return new Response(
        "Invalid JSON",
        {
          status:
            400,
        }
      );
    }

    if (
      !body ||
      typeof body !==
        "object" ||
      Array.isArray(
        body
      )
    ) {
      return new Response(
        "Invalid body",
        {
          status:
            400,
        }
      );
    }

    const signedPayload =
      (
        body as
          Record<
            string,
            unknown
          >
      )
        .signedPayload;

    if (
      typeof signedPayload !==
        "string" ||
      !signedPayload
    ) {
      return new Response(
        "Missing signedPayload",
        {
          status:
            400,
        }
      );
    }

    let decoded:
      Record<
        string,
        unknown
      >;

    try {
      decoded =
        await verifyNotification(
          signedPayload
        );
    } catch (
      error
    ) {
      console.error(
        "APPLE NOTIFICATION REJECTED:",
        error
      );

      return new Response(
        "Invalid notification",
        {
          status:
            400,
        }
      );
    }

    const notificationType =
      decoded
        .notificationType;

    const subtype =
      decoded
        .subtype;

    /*
     * Triple N doesn't use Apple IAP in this release.
     * The Apple V2 endpoint exists for external-purchase
     * token reporting.
     */

    if (
      notificationType !==
        "EXTERNAL_PURCHASE_TOKEN"
    ) {
      return new Response(
        null,
        {
          status:
            200,
        }
      );
    }

    /*
     * UNREPORTED means Apple hasn't received a report for the
     * token. CREATED and ACTIVE_TOKEN_REMINDER don't require
     * treating the token as transactionless while still active.
     */

    if (
      subtype !==
        "UNREPORTED"
    ) {
      return new Response(
        null,
        {
          status:
            200,
        }
      );
    }

    const externalPurchaseToken =
      decoded
        .externalPurchaseToken;

    if (
      !externalPurchaseToken ||
      typeof externalPurchaseToken !==
        "object" ||
      Array.isArray(
        externalPurchaseToken
      )
    ) {
      return new Response(
        "Missing external purchase token",
        {
          status:
            400,
        }
      );
    }

    const externalPurchaseId =
      (
        externalPurchaseToken as
          Record<
            string,
            unknown
          >
      )
        .externalPurchaseId;

    if (
      typeof externalPurchaseId !==
        "string" ||
      !externalPurchaseId
    ) {
      return new Response(
        "Missing externalPurchaseId",
        {
          status:
            400,
        }
      );
    }

    try {
      const result =
        await reportUnreportedAppleExternalPurchaseToken({
          supabaseAdmin,
          externalPurchaseId,
        });

      console.log(
        "Apple UNREPORTED token processed:",
        {
          externalPurchaseId,
          submitted:
            result.submitted,
          skipped:
            result.skipped,
          reason:
            result.reason,
        }
      );

      return new Response(
        null,
        {
          status:
            200,
        }
      );
    } catch (
      error
    ) {
      console.error(
        "APPLE UNREPORTED TOKEN PROCESSING FAILED:",
        error
      );

      /*
       * 500 allows Apple's notification retry mechanism to
       * retry a temporary server/reporting failure.
       */

      return new Response(
        "Processing failed",
        {
          status:
            500,
        }
      );
    }
  }
);
