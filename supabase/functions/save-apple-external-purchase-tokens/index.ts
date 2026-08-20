import "@supabase/functions-js/edge-runtime.d.ts";

import {
  withSupabase,
} from "@supabase/server";

/* =========================================================
 * Environment
 * ======================================================= */

const APPLE_BUNDLE_ID =
  Deno.env.get(
    "APPLE_BUNDLE_ID"
  ) ?? "";

/* =========================================================
 * Types
 * ======================================================= */

type AppleTokenType =
  | "ACQUISITION"
  | "SERVICES";

type SaveAppleTokensBody = {
  acquisitionToken?:
    unknown;

  servicesToken?:
    unknown;
};

type AppleExternalPurchaseTokenPayload = {
  appAppleId:
    number;

  bundleId:
    string;

  tokenCreationDate:
    number;

  externalPurchaseId:
    string;

  tokenType:
    AppleTokenType;

  tokenExpirationDate:
    number;
};

/* =========================================================
 * Base64URL decode
 * ======================================================= */

function decodeBase64Url(
  value:
    string
): string {
  let normalized =
    value
      .replace(
        /-/g,
        "+"
      )
      .replace(
        /_/g,
        "/"
      );

  const remainder =
    normalized.length %
    4;

  if (
    remainder ===
      2
  ) {
    normalized +=
      "==";
  } else if (
    remainder ===
      3
  ) {
    normalized +=
      "=";
  } else if (
    remainder ===
      1
  ) {
    throw new Error(
      "INVALID_BASE64URL_LENGTH"
    );
  }

  let binary:
    string;

  try {
    binary =
      atob(
        normalized
      );
  } catch {
    throw new Error(
      "INVALID_BASE64URL"
    );
  }

  const bytes =
    new Uint8Array(
      binary.length
    );

  for (
    let index =
      0;
    index <
      binary.length;
    index +=
      1
  ) {
    bytes[
      index
    ] =
      binary.charCodeAt(
        index
      );
  }

  return new TextDecoder()
    .decode(
      bytes
    );
}

/* =========================================================
 * Decode + validate Apple token
 * ======================================================= */

function decodeAppleToken(
  rawToken:
    string,
  expectedType:
    AppleTokenType
): AppleExternalPurchaseTokenPayload {
  const decodedText =
    decodeBase64Url(
      rawToken
    );

  let decoded:
    unknown;

  try {
    decoded =
      JSON.parse(
        decodedText
      );
  } catch {
    throw new Error(
      "INVALID_TOKEN_JSON"
    );
  }

  if (
    !decoded ||
    typeof decoded !==
      "object" ||
    Array.isArray(
      decoded
    )
  ) {
    throw new Error(
      "INVALID_TOKEN_PAYLOAD"
    );
  }

  const payload =
    decoded as
      Record<
        string,
        unknown
      >;

  /* -------------------------------------------------------
   * App Apple ID
   * ----------------------------------------------------- */

  if (
    typeof payload
      .appAppleId !==
      "number" ||
    !Number.isSafeInteger(
      payload.appAppleId
    ) ||
    payload.appAppleId <=
      0
  ) {
    throw new Error(
      "INVALID_APP_APPLE_ID"
    );
  }

  /* -------------------------------------------------------
   * Bundle ID
   * ----------------------------------------------------- */

  if (
    typeof payload
      .bundleId !==
      "string" ||
    !payload
      .bundleId
      .trim()
  ) {
    throw new Error(
      "INVALID_BUNDLE_ID"
    );
  }

  const bundleId =
    payload
      .bundleId
      .trim();

  if (
    !APPLE_BUNDLE_ID
  ) {
    throw new Error(
      "APPLE_BUNDLE_ID_NOT_CONFIGURED"
    );
  }

  if (
    bundleId !==
      APPLE_BUNDLE_ID
  ) {
    throw new Error(
      "APPLE_BUNDLE_ID_MISMATCH"
    );
  }

  /* -------------------------------------------------------
   * External Purchase ID
   * ----------------------------------------------------- */

  if (
    typeof payload
      .externalPurchaseId !==
      "string" ||
    !payload
      .externalPurchaseId
      .trim()
  ) {
    throw new Error(
      "INVALID_EXTERNAL_PURCHASE_ID"
    );
  }

  const externalPurchaseId =
    payload
      .externalPurchaseId
      .trim();

  if (
    externalPurchaseId.length >
      512
  ) {
    throw new Error(
      "EXTERNAL_PURCHASE_ID_TOO_LARGE"
    );
  }

  /* -------------------------------------------------------
   * Creation date
   * ----------------------------------------------------- */

  if (
    typeof payload
      .tokenCreationDate !==
      "number" ||
    !Number.isSafeInteger(
      payload.tokenCreationDate
    ) ||
    payload.tokenCreationDate <=
      0
  ) {
    throw new Error(
      "INVALID_TOKEN_CREATION_DATE"
    );
  }

  /* -------------------------------------------------------
   * Token type
   * ----------------------------------------------------- */

  if (
    payload.tokenType !==
      "ACQUISITION" &&
    payload.tokenType !==
      "SERVICES"
  ) {
    throw new Error(
      "INVALID_TOKEN_TYPE"
    );
  }

  if (
    payload.tokenType !==
      expectedType
  ) {
    throw new Error(
      "TOKEN_TYPE_MISMATCH"
    );
  }

  /* -------------------------------------------------------
   * Expiration date
   * ----------------------------------------------------- */

  if (
    typeof payload
      .tokenExpirationDate !==
      "number" ||
    !Number.isSafeInteger(
      payload.tokenExpirationDate
    ) ||
    payload.tokenExpirationDate <=
      0
  ) {
    throw new Error(
      "INVALID_TOKEN_EXPIRATION_DATE"
    );
  }

  if (
    payload.tokenExpirationDate <=
      payload.tokenCreationDate
  ) {
    throw new Error(
      "INVALID_TOKEN_DATE_RANGE"
    );
  }

  return {
    appAppleId:
      payload.appAppleId,

    bundleId,

    tokenCreationDate:
      payload.tokenCreationDate,

    externalPurchaseId,

    tokenType:
      payload.tokenType,

    tokenExpirationDate:
      payload.tokenExpirationDate,
  };
}

/* =========================================================
 * Edge Function
 * ======================================================= */

export default {
  fetch:
    withSupabase(
      {
        auth:
          "user",
      },
      async (
        req,
        ctx
      ) => {
        /* -------------------------------------------------
         * Method
         * ----------------------------------------------- */

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

        /* -------------------------------------------------
         * Authenticated user
         * ----------------------------------------------- */

        const userId =
          ctx
            .userClaims
            ?.sub;

        if (
          typeof userId !==
            "string" ||
          !userId
            .trim()
        ) {
          return Response.json(
            {
              success:
                false,

              error:
                "AUTHENTICATION_REQUIRED",
            },
            {
              status:
                401,
            }
          );
        }

        /* -------------------------------------------------
         * Server configuration
         * ----------------------------------------------- */

        if (
          !APPLE_BUNDLE_ID
        ) {
          console.error(
            "APPLE_BUNDLE_ID is not configured"
          );

          return Response.json(
            {
              success:
                false,

              error:
                "SERVER_CONFIGURATION_ERROR",
            },
            {
              status:
                500,
            }
          );
        }

        /* -------------------------------------------------
         * Body
         * ----------------------------------------------- */

        let body:
          SaveAppleTokensBody;

        try {
          body =
            await req
              .json();
        } catch {
          return Response.json(
            {
              success:
                false,

              error:
                "INVALID_JSON",
            },
            {
              status:
                400,
            }
          );
        }

        const acquisitionToken =
          typeof body
            .acquisitionToken ===
            "string"
            ? body
                .acquisitionToken
                .trim()
            : "";

        const servicesToken =
          typeof body
            .servicesToken ===
            "string"
            ? body
                .servicesToken
                .trim()
            : "";

        /*
         * At least one currently available Apple token
         * must be supplied.
         */

        if (
          !acquisitionToken &&
          !servicesToken
        ) {
          return Response.json(
            {
              success:
                false,

              error:
                "NO_ACTIVE_APPLE_TOKENS",
            },
            {
              status:
                400,
            }
          );
        }

        /* -------------------------------------------------
         * Size guard
         * ----------------------------------------------- */

        if (
          acquisitionToken.length >
            20000 ||
          servicesToken.length >
            20000
        ) {
          return Response.json(
            {
              success:
                false,

              error:
                "TOKEN_TOO_LARGE",
            },
            {
              status:
                400,
            }
          );
        }

        /* -------------------------------------------------
         * Decode available tokens
         * ----------------------------------------------- */

        let acquisition:
          AppleExternalPurchaseTokenPayload |
          null =
            null;

        let services:
          AppleExternalPurchaseTokenPayload |
          null =
            null;

        try {
          if (
            acquisitionToken
          ) {
            acquisition =
              decodeAppleToken(
                acquisitionToken,
                "ACQUISITION"
              );
          }

          if (
            servicesToken
          ) {
            services =
              decodeAppleToken(
                servicesToken,
                "SERVICES"
              );
          }
        } catch (
          error:
            unknown
        ) {
          const reason =
            error instanceof Error
              ? error.message
              : "INVALID_APPLE_TOKEN";

          console.error(
            "APPLE EXTERNAL PURCHASE TOKEN VALIDATION FAILED:",
            reason
          );

          return Response.json(
            {
              success:
                false,

              error:
                "INVALID_APPLE_TOKEN",

              reason,
            },
            {
              status:
                400,
            }
          );
        }

        /* -------------------------------------------------
         * Cross-token app validation
         * ----------------------------------------------- */

        if (
          acquisition &&
          services &&
          acquisition.appAppleId !==
            services.appAppleId
        ) {
          return Response.json(
            {
              success:
                false,

              error:
                "APPLE_TOKEN_APP_MISMATCH",
            },
            {
              status:
                400,
            }
          );
        }

        if (
          acquisition &&
          services &&
          acquisition.bundleId !==
            services.bundleId
        ) {
          return Response.json(
            {
              success:
                false,

              error:
                "APPLE_TOKEN_BUNDLE_MISMATCH",
            },
            {
              status:
                400,
            }
          );
        }

        const now =
          new Date()
            .toISOString();

        /* =================================================
         * Persist immutable-ish token history
         *
         * Re-saving the same externalPurchaseId updates the
         * raw token/timestamps only.
         *
         * Report status fields are deliberately NOT written
         * here, so existing Apple reporting results survive.
         * =============================================== */

        const historyRows:
          Record<
            string,
            unknown
          >[] = [];

        if (
          acquisition &&
          acquisitionToken
        ) {
          historyRows.push({
            user_id:
              userId,

            token_type:
              "ACQUISITION",

            external_purchase_id:
              acquisition
                .externalPurchaseId,

            raw_token:
              acquisitionToken,

            token_created_at_ms:
              acquisition
                .tokenCreationDate,

            token_expires_at_ms:
              acquisition
                .tokenExpirationDate,

            updated_at:
              now,
          });
        }

        if (
          services &&
          servicesToken
        ) {
          historyRows.push({
            user_id:
              userId,

            token_type:
              "SERVICES",

            external_purchase_id:
              services
                .externalPurchaseId,

            raw_token:
              servicesToken,

            token_created_at_ms:
              services
                .tokenCreationDate,

            token_expires_at_ms:
              services
                .tokenExpirationDate,

            updated_at:
              now,
          });
        }

        if (
          historyRows.length >
            0
        ) {
          const {
            error:
              historyError,
          } =
            await ctx
              .supabaseAdmin
              .from(
                "apple_external_purchase_token_history"
              )
              .upsert(
                historyRows,
                {
                  onConflict:
                    "external_purchase_id",
                }
              );

          if (
            historyError
          ) {
            console.error(
              "APPLE TOKEN HISTORY STORAGE FAILED:",
              historyError.code,
              historyError.message
            );

            return Response.json(
              {
                success:
                  false,

                error:
                  "TOKEN_HISTORY_STORAGE_FAILED",
              },
              {
                status:
                  500,
              }
            );
          }
        }

        /* =================================================
         * Update current token snapshot
         *
         * Missing token types are NOT cleared.
         * =============================================== */

        const currentUpdate:
          Record<
            string,
            unknown
          > = {
          user_id:
            userId,

          updated_at:
            now,
        };

        if (
          acquisition &&
          acquisitionToken
        ) {
          currentUpdate
            .acquisition_token =
              acquisitionToken;

          currentUpdate
            .acquisition_external_purchase_id =
              acquisition
                .externalPurchaseId;

          currentUpdate
            .acquisition_token_created_at_ms =
              acquisition
                .tokenCreationDate;

          currentUpdate
            .acquisition_token_expires_at_ms =
              acquisition
                .tokenExpirationDate;
        }

        if (
          services &&
          servicesToken
        ) {
          currentUpdate
            .services_token =
              servicesToken;

          currentUpdate
            .services_external_purchase_id =
              services
                .externalPurchaseId;

          currentUpdate
            .services_token_created_at_ms =
              services
                .tokenCreationDate;

          currentUpdate
            .services_token_expires_at_ms =
              services
                .tokenExpirationDate;
        }

        const {
          error:
            currentSaveError,
        } =
          await ctx
            .supabaseAdmin
            .from(
              "apple_external_purchase_tokens"
            )
            .upsert(
              currentUpdate,
              {
                onConflict:
                  "user_id",
              }
            );

        if (
          currentSaveError
        ) {
          console.error(
            "APPLE CURRENT TOKEN STORAGE FAILED:",
            currentSaveError.code,
            currentSaveError.message
          );

          return Response.json(
            {
              success:
                false,

              error:
                "TOKEN_STORAGE_FAILED",
            },
            {
              status:
                500,
            }
          );
        }

        /*
         * Never return:
         *
         * - raw Apple tokens
         * - externalPurchaseId
         * - App Apple ID
         */

        return Response.json(
          {
            success:
              true,

            saved:
              true,

            acquisitionSaved:
              acquisition !==
              null,

            servicesSaved:
              services !==
              null,

            historySaved:
              historyRows.length,
          },
          {
            status:
              200,
          }
        );
      }
    ),
};