import {
  importPKCS8,
  SignJWT,
} from "npm:jose@^6";

import type {
  SupabaseClient,
} from "npm:@supabase/supabase-js@^2";

import type Stripe from "npm:stripe@^22";

/* =========================================================
 * Triple N - Apple External Purchase Reporting
 * ======================================================= */

/* =========================================================
 * Environment
 * ======================================================= */

const APPLE_KEY_ID =
  Deno.env.get(
    "APPLE_EXTERNAL_PURCHASE_KEY_ID"
  ) ?? "";

const APPLE_ISSUER_ID =
  Deno.env.get(
    "APPLE_EXTERNAL_PURCHASE_ISSUER_ID"
  ) ?? "";

const APPLE_PRIVATE_KEY =
  Deno.env.get(
    "APPLE_EXTERNAL_PURCHASE_PRIVATE_KEY"
  ) ?? "";

const APPLE_BUNDLE_ID =
  Deno.env.get(
    "APPLE_BUNDLE_ID"
  ) ?? "";

/* =========================================================
 * Apple endpoints
 * ======================================================= */

const APPLE_PRODUCTION_BASE_URL =
  "https://api.storekit.apple.com";

const APPLE_SANDBOX_BASE_URL =
  "https://api.storekit-sandbox.apple.com";

const APPLE_REPORT_PATH =
  "/externalPurchase/v1/reports";

/* =========================================================
 * Types
 * ======================================================= */

type TripleNPlanId =
  | "monthly"
  | "yearly";

type AppleTokenType =
  | "ACQUISITION"
  | "SERVICES";

type AppleSubscriptionEvent =
  | "SUBSCRIPTION_START"
  | "RENEWAL";

type AppleTokenReportStatus =
  | "LINE_ITEM"
  | "NO_LINE_ITEM"
  | "DUPLICATE_TOKEN";

type AppleTokenHistoryRow = {
  id:
    string;

  user_id:
    string;

  token_type:
    AppleTokenType;

  external_purchase_id:
    string;

  token_created_at_ms:
    number;

  token_expires_at_ms:
    number;

  report_status:
    AppleTokenReportStatus |
    null;

  report_request_identifier:
    string | null;
};

type ExistingAppleReport = {
  id:
    string;

  status:
    string;

  request_identifier:
    string | null;

  line_item_id:
    string | null;

  reference_line_item_id:
    string | null;

  external_purchase_id:
    string | null;

  request_payload:
    unknown;
};

type PreviousSubscriptionReport = {
  line_item_id:
    string | null;

  subscription_event:
    string | null;

  request_payload:
    unknown;
};

type AppleSubscriptionLineItem = {
  lineItemId:
    string;

  creationDate:
    number;

  eventType:
    "BUY";

  productType:
    "SUBSCRIPTION";

  productIdentifier:
    string;

  amountTaxInclusive:
    number;

  amountTaxExclusive:
    number;

  taxAmount:
    number;

  netAmountTaxExclusive:
    number;

  reportingCurrency:
    string;

  pricingCurrency:
    string;

  taxCountry:
    string;

  subscriptionEvent:
    AppleSubscriptionEvent;

  subscriptionStartDate:
    number;

  subscriptionEndDate:
    number;

  subscriptionDaysOfPaidService:
    number;

  quantity:
    1;

  referenceLineItemId?:
    string;

  restatement?:
    boolean;

  erroneouslySubmitted?:
    boolean;
};



type AppleRefundLineItem = {
  lineItemId:
    string;

  creationDate:
    number;

  eventType:
    "REFUND";

  amountTaxInclusive:
    number;

  amountTaxExclusive:
    number;

  taxAmount:
    number;

  netAmountTaxExclusive:
    number;

  reportingCurrency:
    string;

  pricingCurrency:
    string;

  taxCountry:
    string;

  referenceLineItemId:
    string;

  restatement?:
    boolean;

  erroneouslySubmitted?:
    boolean;
};

type AppleOriginalTransactionReport = {
  user_id: string;
  stripe_invoice_id: string;
  stripe_subscription_id: string | null;
  line_item_id: string | null;
  external_purchase_id: string | null;
  request_payload: unknown;
};

type ExistingAppleRefundReport = {
  id: string;
  status: string;
  request_identifier: string | null;
  refund_line_item_id: string | null;
};

type PreviousAppleRefundReport = {
  refund_amount_exclusive_minor: number | null;
};
type AppleLineItemReportPayload = {
  requestIdentifier:
    string;

  externalPurchaseId:
    string;

  status:
    "LINE_ITEM";

  lineItems:
    Array<
      AppleSubscriptionLineItem |
      AppleRefundLineItem
    >;
};

type AppleNoLineItemReportPayload = {
  requestIdentifier:
    string;

  externalPurchaseId:
    string;

  status:
    "NO_LINE_ITEM" |
    "DUPLICATE_TOKEN" |
    "UNRECOGNIZED_TOKEN";
};

type AppleReportPayload =
  | AppleLineItemReportPayload
  | AppleNoLineItemReportPayload;

export type AppleExternalPurchaseReportingResult = {
  submitted:
    boolean;

  skipped:
    boolean;

  reason:
    string | null;
};

export type AppleExpiredTokenSweepResult = {
  examined:
    number;

  submitted:
    number;

  failed:
    number;

  skipped:
    number;
};

/* =========================================================
 * ISO alpha-2 -> alpha-3
 * ======================================================= */

const COUNTRY_ALPHA3:
  Record<
    string,
    string
  > = {
    AT: "AUT",
    BE: "BEL",
    BG: "BGR",
    HR: "HRV",
    CY: "CYP",
    CZ: "CZE",
    DK: "DNK",
    EE: "EST",
    FI: "FIN",
    FR: "FRA",
    DE: "DEU",
    GR: "GRC",
    HU: "HUN",
    IS: "ISL",
    IE: "IRL",
    IT: "ITA",
    LV: "LVA",
    LT: "LTU",
    LU: "LUX",
    MT: "MLT",
    NL: "NLD",
    NO: "NOR",
    PL: "POL",
    PT: "PRT",
    RO: "ROU",
    SK: "SVK",
    SI: "SVN",
    ES: "ESP",
    SE: "SWE",
  };

/* =========================================================
 * Configuration
 * ======================================================= */

function assertAppleConfiguration():
  void {
  const missing: string[] =
    [];

  if (!APPLE_KEY_ID) {
    missing.push(
      "APPLE_EXTERNAL_PURCHASE_KEY_ID"
    );
  }

  if (!APPLE_ISSUER_ID) {
    missing.push(
      "APPLE_EXTERNAL_PURCHASE_ISSUER_ID"
    );
  }

  if (!APPLE_PRIVATE_KEY) {
    missing.push(
      "APPLE_EXTERNAL_PURCHASE_PRIVATE_KEY"
    );
  }

  if (!APPLE_BUNDLE_ID) {
    missing.push(
      "APPLE_BUNDLE_ID"
    );
  }

  if (missing.length > 0) {
    throw new Error(
      `APPLE_EXTERNAL_PURCHASE_REPORTING_NOT_CONFIGURED:${missing.join(",")}`
    );
  }
}

/* =========================================================
 * Apple JWT
 * ======================================================= */

async function createAppleJwt():
  Promise<string> {
  assertAppleConfiguration();

  const privateKey =
    APPLE_PRIVATE_KEY
      .replace(
        /\\n/g,
        "\n"
      )
      .trim();

  const key =
    await importPKCS8(
      privateKey,
      "ES256"
    );

  const now =
    Math.floor(
      Date.now() /
        1000
    );

  return await new SignJWT({
    bid:
      APPLE_BUNDLE_ID,
  })
    .setProtectedHeader({
      alg:
        "ES256",

      kid:
        APPLE_KEY_ID,

      typ:
        "JWT",
    })
    .setIssuer(
      APPLE_ISSUER_ID
    )
    .setAudience(
      "appstoreconnect-v1"
    )
    .setIssuedAt(
      now
    )
    .setExpirationTime(
      now +
        5 * 60
    )
    .sign(
      key
    );
}

/* =========================================================
 * Apple environment
 * ======================================================= */

function getAppleBaseUrl(
  externalPurchaseId:
    string
): string {
  if (
    externalPurchaseId
      .toUpperCase()
      .startsWith(
        "SANDBOX"
      )
  ) {
    return APPLE_SANDBOX_BASE_URL;
  }

  return APPLE_PRODUCTION_BASE_URL;
}

/* =========================================================
 * Send report to Apple
 * ======================================================= */

async function sendAppleReport(
  payload:
    AppleReportPayload
): Promise<unknown> {
  const jwt =
    await createAppleJwt();

  const response =
    await fetch(
      `${getAppleBaseUrl(
        payload.externalPurchaseId
      )}${APPLE_REPORT_PATH}`,
      {
        method:
          "PUT",

        headers: {
          Authorization:
            `Bearer ${jwt}`,

          "Content-Type":
            "application/json",
        },

        body:
          JSON.stringify(
            payload
          ),
      }
    );

  const responseText =
    await response
      .text();

  let responseBody:
    unknown =
      null;

  if (
    responseText
  ) {
    try {
      responseBody =
        JSON.parse(
          responseText
        );
    } catch {
      responseBody = {
        raw:
          responseText
            .slice(
              0,
              4000
            ),
      };
    }
  }

  if (
    !response.ok
  ) {
    throw new Error(
      `APPLE_REPORT_REJECTED_${response.status}:${
        responseText
          .slice(
            0,
            2000
          )
      }`
    );
  }

  return responseBody;
}

/* =========================================================
 * Load token history
 * ======================================================= */

async function loadTokenHistory(
  supabaseAdmin:
    SupabaseClient,
  userId:
    string
): Promise<
  AppleTokenHistoryRow[]
> {
  const {
    data,
    error,
  } =
    await supabaseAdmin
      .from(
        "apple_external_purchase_token_history"
      )
      .select(
        [
          "id",
          "user_id",
          "token_type",
          "external_purchase_id",
          "token_created_at_ms",
          "token_expires_at_ms",
          "report_status",
          "report_request_identifier",
        ].join(",")
      )
      .eq(
        "user_id",
        userId
      )
      .order(
        "token_created_at_ms",
        {
          ascending:
            true,
        }
      );

  if (
    error
  ) {
    throw new Error(
      `APPLE_TOKEN_HISTORY_LOOKUP_FAILED:${error.message}`
    );
  }

  return (
    data ??
    []
  ) as unknown as
    AppleTokenHistoryRow[];
}

/* =========================================================
 * Token activity
 * ======================================================= */

function isTokenActiveAt(
  token:
    AppleTokenHistoryRow,
  transactionDate:
    number
): boolean {
  return (
    transactionDate >=
      token.token_created_at_ms &&
    transactionDate <=
      token.token_expires_at_ms
  );
}

/* =========================================================
 * Select transaction token
 *
 * Prefer SERVICES.
 *
 * If refreshed tokens exist for the same active period,
 * select deterministically and report the remaining tokens
 * separately as DUPLICATE_TOKEN.
 * ======================================================= */

function chooseTransactionToken(
  tokens:
    AppleTokenHistoryRow[],
  transactionDate:
    number
): AppleTokenHistoryRow | null {
  const active =
    tokens
      .filter(
        token =>
          isTokenActiveAt(
            token,
            transactionDate
          ) &&
          (
            token.report_status ===
              null ||
            token.report_status ===
              "LINE_ITEM"
          )
      )
      .sort(
        (
          first,
          second
        ) => {
          if (
            first.token_type !==
            second.token_type
          ) {
            if (
              first.token_type ===
                "SERVICES"
            ) {
              return -1;
            }

            return 1;
          }

          if (
            first.token_created_at_ms !==
            second.token_created_at_ms
          ) {
            return (
              first.token_created_at_ms -
              second.token_created_at_ms
            );
          }

          return first
            .external_purchase_id
            .localeCompare(
              second
                .external_purchase_id
            );
        }
      );

  return (
    active[0] ??
    null
  );
}

/* =========================================================
 * Invoice helpers
 * ======================================================= */

function getTransactionDateMs(
  invoice:
    Stripe.Invoice
): number {
  const paidAt =
    invoice
      .status_transitions
      ?.paid_at;

  if (
    typeof paidAt ===
      "number"
  ) {
    return paidAt *
      1000;
  }

  return invoice.created *
    1000;
}

/* =========================================================
 * Stripe taxes
 * ======================================================= */

function getInvoiceTaxMinorUnits(
  invoice:
    Stripe.Invoice
): number {
  const typedInvoice =
    invoice as
      Stripe.Invoice & {
        total_taxes?:
          Array<{
            amount?:
              number;
          }> | null;

        tax?:
          number | null;
      };

  if (
    Array.isArray(
      typedInvoice
        .total_taxes
    )
  ) {
    return typedInvoice
      .total_taxes
      .reduce(
        (
          sum,
          tax
        ) =>
          sum +
          (
            typeof tax.amount ===
              "number"
              ? tax.amount
              : 0
          ),
        0
      );
  }

  if (
    typeof typedInvoice
      .tax ===
      "number"
  ) {
    return typedInvoice.tax;
  }

  return 0;
}

/* =========================================================
 * Tax-exclusive amount
 * ======================================================= */

function getInvoiceTaxExclusiveMinorUnits(
  invoice:
    Stripe.Invoice,
  taxMinor:
    number
): number {
  const typedInvoice =
    invoice as
      Stripe.Invoice & {
        total_excluding_tax?:
          number | null;
      };

  if (
    typeof typedInvoice
      .total_excluding_tax ===
      "number"
  ) {
    return typedInvoice
      .total_excluding_tax;
  }

  return (
    invoice.amount_paid -
    taxMinor
  );
}

/* =========================================================
 * Stripe minor units -> Apple milli-units
 * ======================================================= */

function minorToMilli(
  amount:
    number
): number {
  if (
    !Number.isSafeInteger(
      amount
    )
  ) {
    throw new Error(
      "INVALID_STRIPE_AMOUNT"
    );
  }

  return amount *
    10;
}

/* =========================================================
 * Tax country
 * ======================================================= */

function getTaxCountry(
  invoice:
    Stripe.Invoice
): string {
  const alpha2 =
    invoice
      .customer_address
      ?.country
      ?.toUpperCase();

  if (
    !alpha2
  ) {
    throw new Error(
      "STRIPE_TAX_COUNTRY_MISSING"
    );
  }

  const alpha3 =
    COUNTRY_ALPHA3[
      alpha2
    ];

  if (
    !alpha3
  ) {
    throw new Error(
      `APPLE_TAX_COUNTRY_UNSUPPORTED:${alpha2}`
    );
  }

  return alpha3;
}

/* =========================================================
 * Subscription billing period
 * ======================================================= */

function getSubscriptionPeriod(
  invoice:
    Stripe.Invoice
): {
  start:
    number;

  end:
    number;
} {
  for (
    const line
    of invoice.lines.data
  ) {
    if (
      typeof line.period?.start ===
        "number" &&
      typeof line.period?.end ===
        "number" &&
      line.period.end >
        line.period.start
    ) {
      return {
        start:
          line.period.start *
          1000,

        end:
          line.period.end *
          1000,
      };
    }
  }

  throw new Error(
    "STRIPE_SUBSCRIPTION_PERIOD_MISSING"
  );
}

/* =========================================================
 * Product identifier
 * ======================================================= */

function getProductIdentifier(
  planId:
    TripleNPlanId
): string {
  if (
    planId ===
      "monthly"
  ) {
    return (
      `${APPLE_BUNDLE_ID}.monthly`
    );
  }

  return (
    `${APPLE_BUNDLE_ID}.yearly`
  );
}

/* =========================================================
 * Existing Stripe invoice report
 * ======================================================= */

async function findInvoiceReport(
  supabaseAdmin:
    SupabaseClient,
  invoiceId:
    string
): Promise<
  ExistingAppleReport | null
> {
  const {
    data,
    error,
  } =
    await supabaseAdmin
      .from(
        "apple_external_purchase_reports"
      )
      .select(
        [
          "id",
          "status",
          "request_identifier",
          "line_item_id",
          "reference_line_item_id",
          "external_purchase_id",
          "request_payload",
        ].join(",")
      )
      .eq(
        "stripe_invoice_id",
        invoiceId
      )
      .maybeSingle();

  if (
    error
  ) {
    throw new Error(
      `APPLE_REPORT_LOOKUP_FAILED:${error.message}`
    );
  }

  return (
    data as
      ExistingAppleReport |
      null
  );
}

/* =========================================================
 * Previous subscription reports
 * ======================================================= */

async function loadPreviousReports(
  supabaseAdmin:
    SupabaseClient,
  subscriptionId:
    string
): Promise<
  PreviousSubscriptionReport[]
> {
  const {
    data,
    error,
  } =
    await supabaseAdmin
      .from(
        "apple_external_purchase_reports"
      )
      .select(
        [
          "line_item_id",
          "subscription_event",
          "request_payload",
        ].join(",")
      )
      .eq(
        "stripe_subscription_id",
        subscriptionId
      )
      .eq(
        "status",
        "submitted"
      )
      .order(
        "created_at",
        {
          ascending:
            true,
        }
      );

  if (
    error
  ) {
    throw new Error(
      `APPLE_PREVIOUS_REPORT_LOOKUP_FAILED:${error.message}`
    );
  }

  return (
    data ??
    []
  ) as unknown as
    PreviousSubscriptionReport[];
}

/* =========================================================
 * Original subscription line item
 * ======================================================= */

function getOriginalLineItemId(
  reports:
    PreviousSubscriptionReport[]
): string | null {
  const start =
    reports.find(
      item =>
        item.subscription_event ===
          "SUBSCRIPTION_START" &&
        typeof item.line_item_id ===
          "string"
    );

  return start
    ?.line_item_id ??
    null;
}

/* =========================================================
 * Paid service days
 * ======================================================= */

function getPaidServiceDays(
  reports:
    PreviousSubscriptionReport[]
): number {
  if (
    reports.length ===
      0
  ) {
    return 0;
  }

  const previous =
    reports[
      reports.length -
        1
    ];

  const payload =
    previous
      .request_payload;

  if (
    !payload ||
    typeof payload !==
      "object" ||
    Array.isArray(
      payload
    )
  ) {
    return 0;
  }

  const lineItems =
    (
      payload as
        Record<
          string,
          unknown
        >
    )
      .lineItems;

  if (
    !Array.isArray(
      lineItems
    ) ||
    lineItems.length ===
      0
  ) {
    return 0;
  }

  const previousLine =
    lineItems[0] as
      Record<
        string,
        unknown
      >;

  const previousDays =
    typeof previousLine
      .subscriptionDaysOfPaidService ===
      "number"
      ? previousLine
          .subscriptionDaysOfPaidService
      : 0;

  const previousStart =
    previousLine
      .subscriptionStartDate;

  const previousEnd =
    previousLine
      .subscriptionEndDate;

  if (
    typeof previousStart !==
      "number" ||
    typeof previousEnd !==
      "number" ||
    previousEnd <=
      previousStart
  ) {
    return previousDays;
  }

  const paidPeriodDays =
    Math.max(
      0,
      Math.round(
        (
          previousEnd -
          previousStart
        ) /
          86_400_000
      )
    );

  return (
    previousDays +
    paidPeriodDays
  );
}

/* =========================================================
 * Store a token report attempt
 * ======================================================= */

async function markTokenAttempt({
  supabaseAdmin,
  token,
  requestIdentifier,
}: {
  supabaseAdmin:
    SupabaseClient;

  token:
    AppleTokenHistoryRow;

  requestIdentifier:
    string;
}): Promise<void> {
  const now =
    new Date()
      .toISOString();

  const {
    error,
  } =
    await supabaseAdmin
      .from(
        "apple_external_purchase_token_history"
      )
      .update({
        report_request_identifier:
          requestIdentifier,

        report_attempted_at:
          now,

        report_error:
          null,

        updated_at:
          now,
      })
      .eq(
        "id",
        token.id
      );

  if (
    error
  ) {
    throw new Error(
      `APPLE_TOKEN_ATTEMPT_STORAGE_FAILED:${error.message}`
    );
  }
}

/* =========================================================
 * Store successful token report
 * ======================================================= */

async function markTokenSubmitted({
  supabaseAdmin,
  token,
  requestIdentifier,
  status,
  appleResponse,
}: {
  supabaseAdmin:
    SupabaseClient;

  token:
    AppleTokenHistoryRow;

  requestIdentifier:
    string;

  status:
    AppleTokenReportStatus;

  appleResponse:
    unknown;
}): Promise<void> {
  const now =
    new Date()
      .toISOString();

  const {
    error,
  } =
    await supabaseAdmin
      .from(
        "apple_external_purchase_token_history"
      )
      .update({
        report_status:
          status,

        report_request_identifier:
          requestIdentifier,

        report_submitted_at:
          now,

        report_error:
          null,

        apple_response:
          appleResponse,

        updated_at:
          now,
      })
      .eq(
        "id",
        token.id
      );

  if (
    error
  ) {
    throw new Error(
      `APPLE_TOKEN_SUCCESS_STORAGE_FAILED:${error.message}`
    );
  }
}

/* =========================================================
 * Store token reporting failure
 * ======================================================= */

async function markTokenFailed({
  supabaseAdmin,
  token,
  requestIdentifier,
  errorMessage,
}: {
  supabaseAdmin:
    SupabaseClient;

  token:
    AppleTokenHistoryRow;

  requestIdentifier:
    string;

  errorMessage:
    string;
}): Promise<void> {
  const now =
    new Date()
      .toISOString();

  const {
    error,
  } =
    await supabaseAdmin
      .from(
        "apple_external_purchase_token_history"
      )
      .update({
        report_request_identifier:
          requestIdentifier,

        report_attempted_at:
          now,

        report_error:
          errorMessage.slice(
            0,
            4000
          ),

        updated_at:
          now,
      })
      .eq(
        "id",
        token.id
      );

  if (
    error
  ) {
    console.error(
      "APPLE TOKEN FAILURE STORAGE FAILED:",
      error.message
    );
  }
}

/* =========================================================
 * Report token without line items
 * ======================================================= */

async function reportTokenWithoutLineItems({
  supabaseAdmin,
  token,
  status,
}: {
  supabaseAdmin:
    SupabaseClient;

  token:
    AppleTokenHistoryRow;

  status:
    "NO_LINE_ITEM" |
    "DUPLICATE_TOKEN";
}): Promise<boolean> {
  if (
    token.report_status
  ) {
    return false;
  }

  const requestIdentifier =
    token
      .report_request_identifier ??
    crypto.randomUUID();

  const payload:
    AppleNoLineItemReportPayload = {
      requestIdentifier,

      externalPurchaseId:
        token
          .external_purchase_id,

      status,
    };

  await markTokenAttempt({
    supabaseAdmin,
    token,
    requestIdentifier,
  });

  try {
    const appleResponse =
      await sendAppleReport(
        payload
      );

    await markTokenSubmitted({
      supabaseAdmin,
      token,
      requestIdentifier,
      status,
      appleResponse,
    });

    console.log(
      "Apple token-only report submitted:",
      {
        externalPurchaseId:
          token
            .external_purchase_id,

        tokenType:
          token
            .token_type,

        status,
      }
    );

    return true;
  } catch (
    error:
      unknown
  ) {
    const message =
      error instanceof Error
        ? error.message
        : "APPLE_TOKEN_REPORT_UNKNOWN_ERROR";

    await markTokenFailed({
      supabaseAdmin,
      token,
      requestIdentifier,
      errorMessage:
        message,
    });

    throw error;
  }
}

/* =========================================================
 * Report other active tokens as duplicates
 * ======================================================= */

async function reportDuplicateTokensForTransaction({
  supabaseAdmin,
  tokens,
  selectedToken,
  transactionDate,
}: {
  supabaseAdmin:
    SupabaseClient;

  tokens:
    AppleTokenHistoryRow[];

  selectedToken:
    AppleTokenHistoryRow;

  transactionDate:
    number;
}): Promise<void> {
  const duplicates =
    tokens.filter(
      token =>
        token.id !==
          selectedToken.id &&
        token.report_status ===
          null &&
        isTokenActiveAt(
          token,
          transactionDate
        )
    );

  for (
    const duplicate
    of duplicates
  ) {
    await reportTokenWithoutLineItems({
      supabaseAdmin,

      token:
        duplicate,

      status:
        "DUPLICATE_TOKEN",
    });
  }
}

/* =========================================================
 * Paid Stripe invoice -> Apple
 * ======================================================= */

export async function reportPaidStripeInvoiceToApple({
  supabaseAdmin,
  invoice,
  userId,
  subscriptionId,
  planId,
}: {
  supabaseAdmin:
    SupabaseClient;

  invoice:
    Stripe.Invoice;

  userId:
    string;

  subscriptionId:
    string;

  planId:
    TripleNPlanId;
}): Promise<
  AppleExternalPurchaseReportingResult
> {
  assertAppleConfiguration();

  const transactionDate =
    getTransactionDateMs(
      invoice
    );

  const tokens =
    await loadTokenHistory(
      supabaseAdmin,
      userId
    );

  if (
    tokens.length ===
      0
  ) {
    return {
      submitted:
        false,

      skipped:
        true,

      reason:
        "no-apple-external-purchase-token",
    };
  }

  const existing =
    await findInvoiceReport(
      supabaseAdmin,
      invoice.id
    );

  /* -------------------------------------------------------
   * Invoice already submitted
   *
   * Still finish any duplicate-token reports that may have
   * failed after the LINE_ITEM report succeeded.
   * ----------------------------------------------------- */

  if (
    existing?.status ===
      "submitted"
  ) {
    const selectedToken =
      tokens.find(
        token =>
          token.external_purchase_id ===
            existing
              .external_purchase_id
      );

    if (
      selectedToken
    ) {
      await reportDuplicateTokensForTransaction({
        supabaseAdmin,
        tokens,
        selectedToken,
        transactionDate,
      });
    }

    return {
      submitted:
        true,

      skipped:
        true,

      reason:
        "already-submitted",
    };
  }

  /* -------------------------------------------------------
   * Select Apple token active when Stripe payment happened
   * ----------------------------------------------------- */

  const token =
    chooseTransactionToken(
      tokens,
      transactionDate
    );

  if (
    !token
  ) {
    return {
      submitted:
        false,

      skipped:
        true,

      reason:
        "no-token-active-at-transaction-time",
    };
  }

  /* -------------------------------------------------------
   * Stripe Tax
   * ----------------------------------------------------- */

  if (
    !invoice
      .automatic_tax
      ?.enabled
  ) {
    throw new Error(
      "STRIPE_AUTOMATIC_TAX_NOT_ENABLED_FOR_APPLE_TRANSACTION"
    );
  }

  const taxMinor =
    getInvoiceTaxMinorUnits(
      invoice
    );

  const inclusiveMinor =
    invoice.amount_paid;

  const exclusiveMinor =
    getInvoiceTaxExclusiveMinorUnits(
      invoice,
      taxMinor
    );

  if (
    exclusiveMinor +
      taxMinor !==
    inclusiveMinor
  ) {
    throw new Error(
      "STRIPE_TAX_TOTAL_MISMATCH"
    );
  }

  const amountTaxInclusive =
    minorToMilli(
      inclusiveMinor
    );

  const amountTaxExclusive =
    minorToMilli(
      exclusiveMinor
    );

  const taxAmount =
    minorToMilli(
      taxMinor
    );

  const netAmountTaxExclusive =
    amountTaxExclusive;

  /* -------------------------------------------------------
   * Currency
   * ----------------------------------------------------- */

  const currency =
    invoice
      .currency
      .toUpperCase();

  if (
    currency !==
      "EUR"
  ) {
    throw new Error(
      `UNSUPPORTED_APPLE_REPORTING_CURRENCY:${currency}`
    );
  }

  /* -------------------------------------------------------
   * Country + billing period
   * ----------------------------------------------------- */

  const taxCountry =
    getTaxCountry(
      invoice
    );

  const period =
    getSubscriptionPeriod(
      invoice
    );

  /* -------------------------------------------------------
   * Subscription history
   * ----------------------------------------------------- */

  const previousReports =
    await loadPreviousReports(
      supabaseAdmin,
      subscriptionId
    );

  const firstPurchase =
    previousReports.length ===
      0;

  const subscriptionEvent:
    AppleSubscriptionEvent =
      firstPurchase
        ? "SUBSCRIPTION_START"
        : "RENEWAL";

  const referenceLineItemId =
    firstPurchase
      ? null
      : getOriginalLineItemId(
          previousReports
        );

  if (
    !firstPurchase &&
    !referenceLineItemId
  ) {
    throw new Error(
      "APPLE_ORIGINAL_SUBSCRIPTION_LINE_ITEM_NOT_FOUND"
    );
  }

  const paidServiceDays =
    firstPurchase
      ? 0
      : getPaidServiceDays(
          previousReports
        );

  /* -------------------------------------------------------
   * Stable IDs on retry
   * ----------------------------------------------------- */

  const requestIdentifier =
    existing
      ?.request_identifier ??
    crypto.randomUUID();

  const lineItemId =
    existing
      ?.line_item_id ??
    crypto.randomUUID();

  /* -------------------------------------------------------
   * Apple line item
   * ----------------------------------------------------- */

  const lineItem:
    AppleSubscriptionLineItem = {
    lineItemId,

    creationDate:
      transactionDate,

    eventType:
      "BUY",

    productType:
      "SUBSCRIPTION",

    productIdentifier:
      getProductIdentifier(
        planId
      ),

    amountTaxInclusive,

    amountTaxExclusive,

    taxAmount,

    netAmountTaxExclusive,

    reportingCurrency:
      "EUR",

    pricingCurrency:
      "EUR",

    taxCountry,

    subscriptionEvent,

    subscriptionStartDate:
      period.start,

    subscriptionEndDate:
      period.end,

    subscriptionDaysOfPaidService:
      paidServiceDays,

    quantity:
      1,
  };

  if (
    referenceLineItemId
  ) {
    lineItem
      .referenceLineItemId =
        referenceLineItemId;
  }

  const payload:
    AppleLineItemReportPayload = {
      requestIdentifier,

      externalPurchaseId:
        token
          .external_purchase_id,

      status:
        "LINE_ITEM",

      lineItems: [
        lineItem,
      ],
    };

  const now =
    new Date()
      .toISOString();

  /* -------------------------------------------------------
   * Persist pending transaction report
   * ----------------------------------------------------- */

  if (
    existing
  ) {
    const {
      error,
    } =
      await supabaseAdmin
        .from(
          "apple_external_purchase_reports"
        )
        .update({
          user_id:
            userId,

          stripe_subscription_id:
            subscriptionId,

          apple_token_type:
            token
              .token_type,

          status:
            "pending",

          request_identifier:
            requestIdentifier,

          line_item_id:
            lineItemId,

          reference_line_item_id:
            referenceLineItemId,

          external_purchase_id:
            token
              .external_purchase_id,

          subscription_event:
            subscriptionEvent,

          request_payload:
            payload,

          error_message:
            null,

          attempted_at:
            now,

          updated_at:
            now,
        })
        .eq(
          "id",
          existing.id
        );

    if (
      error
    ) {
      throw new Error(
        `APPLE_REPORT_PENDING_UPDATE_FAILED:${error.message}`
      );
    }
  } else {
    const {
      error,
    } =
      await supabaseAdmin
        .from(
          "apple_external_purchase_reports"
        )
        .insert({
          user_id:
            userId,

          stripe_invoice_id:
            invoice.id,

          stripe_subscription_id:
            subscriptionId,

          apple_token_type:
            token
              .token_type,

          status:
            "pending",

          request_identifier:
            requestIdentifier,

          line_item_id:
            lineItemId,

          reference_line_item_id:
            referenceLineItemId,

          external_purchase_id:
            token
              .external_purchase_id,

          subscription_event:
            subscriptionEvent,

          request_payload:
            payload,

          attempted_at:
            now,

          created_at:
            now,

          updated_at:
            now,
        });

    if (
      error
    ) {
      throw new Error(
        `APPLE_REPORT_PENDING_INSERT_FAILED:${error.message}`
      );
    }
  }

  /* -------------------------------------------------------
   * Mark token attempt
   * ----------------------------------------------------- */

  await markTokenAttempt({
    supabaseAdmin,
    token,
    requestIdentifier,
  });

  /* -------------------------------------------------------
   * Submit LINE_ITEM
   * ----------------------------------------------------- */

  try {
    const appleResponse =
      await sendAppleReport(
        payload
      );

    const submittedAt =
      new Date()
        .toISOString();

    const {
      error,
    } =
      await supabaseAdmin
        .from(
          "apple_external_purchase_reports"
        )
        .update({
          status:
            "submitted",

          apple_response:
            appleResponse,

          error_message:
            null,

          submitted_at:
            submittedAt,

          updated_at:
            submittedAt,
        })
        .eq(
          "stripe_invoice_id",
          invoice.id
        );

    if (
      error
    ) {
      throw new Error(
        `APPLE_REPORT_SUCCESS_STORAGE_FAILED:${error.message}`
      );
    }

    await markTokenSubmitted({
      supabaseAdmin,
      token,
      requestIdentifier,
      status:
        "LINE_ITEM",
      appleResponse,
    });

    /*
     * Every other Apple token active for this same
     * transaction is reported separately as DUPLICATE_TOKEN.
     */

    await reportDuplicateTokensForTransaction({
      supabaseAdmin,
      tokens,
      selectedToken:
        token,
      transactionDate,
    });

    console.log(
      "Apple external purchase transaction submitted:",
      {
        invoiceId:
          invoice.id,

        subscriptionId,

        requestIdentifier,

        lineItemId,

        tokenType:
          token
            .token_type,

        subscriptionEvent,
      }
    );

    return {
      submitted:
        true,

      skipped:
        false,

      reason:
        null,
    };
  } catch (
    error:
      unknown
  ) {
    const message =
      error instanceof Error
        ? error.message
        : "APPLE_REPORT_UNKNOWN_ERROR";

    const failedAt =
      new Date()
        .toISOString();

    await supabaseAdmin
      .from(
        "apple_external_purchase_reports"
      )
      .update({
        status:
          "failed",

        error_message:
          message.slice(
            0,
            4000
          ),

        attempted_at:
          failedAt,

        updated_at:
          failedAt,
      })
      .eq(
        "stripe_invoice_id",
        invoice.id
      );

    await markTokenFailed({
      supabaseAdmin,
      token,
      requestIdentifier,
      errorMessage:
        message,
    });

    throw error;
  }
}

/* =========================================================
 * Does token have a transaction reported through another
 * token that was also active at transaction time?
 * ======================================================= */

async function tokenHasDuplicateTransaction({
  supabaseAdmin,
  token,
}: {
  supabaseAdmin:
    SupabaseClient;

  token:
    AppleTokenHistoryRow;
}): Promise<boolean> {
  const {
    data,
    error,
  } =
    await supabaseAdmin
      .from(
        "apple_external_purchase_reports"
      )
      .select(
        "external_purchase_id, request_payload"
      )
      .eq(
        "user_id",
        token.user_id
      )
      .eq(
        "status",
        "submitted"
      );

  if (
    error
  ) {
    throw new Error(
      `APPLE_TRANSACTION_LOOKUP_FAILED:${error.message}`
    );
  }

  for (
    const report
    of data ??
      []
  ) {
    if (
      report
        .external_purchase_id ===
      token
        .external_purchase_id
    ) {
      continue;
    }

    const payload =
      report
        .request_payload;

    if (
      !payload ||
      typeof payload !==
        "object" ||
      Array.isArray(
        payload
      )
    ) {
      continue;
    }

    const lineItems =
      (
        payload as
          Record<
            string,
            unknown
          >
      )
        .lineItems;

    if (
      !Array.isArray(
        lineItems
      )
    ) {
      continue;
    }

    for (
      const lineItem
      of lineItems
    ) {
      if (
        !lineItem ||
        typeof lineItem !==
          "object" ||
        Array.isArray(
          lineItem
        )
      ) {
        continue;
      }

      const creationDate =
        (
          lineItem as
            Record<
              string,
              unknown
            >
        )
          .creationDate;

      if (
        typeof creationDate ===
          "number" &&
        isTokenActiveAt(
          token,
          creationDate
        )
      ) {
        return true;
      }
    }
  }

  return false;
}

/* =========================================================
 * Report expired tokens
 *
 * Call this from a scheduled server function.
 *
 * After a custom link token expires:
 *
 * - DUPLICATE_TOKEN if another active token carried the
 *   completed transaction.
 *
 * - NO_LINE_ITEM if no completed transaction occurred.
 * ======================================================= */

export async function reportExpiredAppleTokens({
  supabaseAdmin,
  limit =
    100,
}: {
  supabaseAdmin:
    SupabaseClient;

  limit?:
    number;
}): Promise<
  AppleExpiredTokenSweepResult
> {
  assertAppleConfiguration();

  const nowMs =
    Date.now();

  const safeLimit =
    Math.max(
      1,
      Math.min(
        500,
        Math.trunc(
          limit
        )
      )
    );

  const {
    data,
    error,
  } =
    await supabaseAdmin
      .from(
        "apple_external_purchase_token_history"
      )
      .select(
        [
          "id",
          "user_id",
          "token_type",
          "external_purchase_id",
          "token_created_at_ms",
          "token_expires_at_ms",
          "report_status",
          "report_request_identifier",
        ].join(",")
      )
      .is(
        "report_status",
        null
      )
      .lte(
        "token_expires_at_ms",
        nowMs
      )
      .order(
        "token_expires_at_ms",
        {
          ascending:
            true,
        }
      )
      .limit(
        safeLimit
      );

  if (
    error
  ) {
    throw new Error(
      `APPLE_EXPIRED_TOKEN_LOOKUP_FAILED:${error.message}`
    );
  }

  const tokens =
    (
      data ??
      []
    ) as unknown as
      AppleTokenHistoryRow[];

  let submitted =
    0;

  let failed =
    0;

  let skipped =
    0;

  for (
    const token
    of tokens
  ) {
    if (
      token.report_status
    ) {
      skipped +=
        1;

      continue;
    }

    try {
      const duplicate =
        await tokenHasDuplicateTransaction({
          supabaseAdmin,
          token,
        });

      const didSubmit =
        await reportTokenWithoutLineItems({
          supabaseAdmin,

          token,

          status:
            duplicate
              ? "DUPLICATE_TOKEN"
              : "NO_LINE_ITEM",
        });

      if (
        didSubmit
      ) {
        submitted +=
          1;
      } else {
        skipped +=
          1;
      }
    } catch (
      error
    ) {
      failed +=
        1;

      console.error(
        "APPLE EXPIRED TOKEN REPORT FAILED:",
        {
          tokenId:
            token.id,

          externalPurchaseId:
            token
              .external_purchase_id,

          error,
        }
      );
    }
  }

  return {
    examined:
      tokens.length,

    submitted,

    failed,

    skipped,
  };
}


/* =========================================================
 * Apple notification: unreported external-purchase token
 * ======================================================= */

export async function reportUnreportedAppleExternalPurchaseToken({
  supabaseAdmin,
  externalPurchaseId,
}: {
  supabaseAdmin:
    SupabaseClient;

  externalPurchaseId:
    string;
}): Promise<
  AppleExternalPurchaseReportingResult
> {
  assertAppleConfiguration();

  const normalizedId =
    externalPurchaseId
      .trim();

  if (
    !normalizedId
  ) {
    throw new Error(
      "APPLE_EXTERNAL_PURCHASE_ID_MISSING"
    );
  }

  const {
    data,
    error,
  } =
    await supabaseAdmin
      .from(
        "apple_external_purchase_token_history"
      )
      .select(
        [
          "id",
          "user_id",
          "token_type",
          "external_purchase_id",
          "token_created_at_ms",
          "token_expires_at_ms",
          "report_status",
          "report_request_identifier",
        ].join(",")
      )
      .eq(
        "external_purchase_id",
        normalizedId
      )
      .maybeSingle();

  if (
    error
  ) {
    throw new Error(
      `APPLE_UNREPORTED_TOKEN_LOOKUP_FAILED:${error.message}`
    );
  }

  if (
    data
  ) {
    const token =
      data as unknown as
        AppleTokenHistoryRow;

    if (
      token.report_status
    ) {
      return {
        submitted:
          true,

        skipped:
          true,

        reason:
          "token-already-reported",
      };
    }

    const duplicate =
      await tokenHasDuplicateTransaction({
        supabaseAdmin,
        token,
      });

    const submitted =
      await reportTokenWithoutLineItems({
        supabaseAdmin,
        token,
        status:
          duplicate
            ? "DUPLICATE_TOKEN"
            : "NO_LINE_ITEM",
      });

    return {
      submitted,

      skipped:
        !submitted,

      reason:
        submitted
          ? null
          : "known-token-not-submitted",
    };
  }

  /*
   * Apple explicitly requires UNRECOGNIZED_TOKEN when its
   * notification contains an externalPurchaseId that Triple N
   * does not have in its own token history.
   */

  const payload:
    AppleNoLineItemReportPayload = {
      requestIdentifier:
        crypto.randomUUID(),

      externalPurchaseId:
        normalizedId,

      status:
        "UNRECOGNIZED_TOKEN",
    };

  await sendAppleReport(
    payload
  );

  console.log(
    "Apple unrecognized external-purchase token reported:",
    normalizedId
  );

  return {
    submitted:
      true,

    skipped:
      false,

    reason:
      null,
  };
}

/* =========================================================
 * Stripe refund -> Apple RefundLineItem
 *
 * The caller supplies the Stripe-authoritative tax split.
 * ======================================================= */

export async function reportStripeRefundToApple({
  supabaseAdmin,
  stripeRefundId,
  stripeInvoiceId,
  creationDateMs,
  amountTaxInclusiveMinor,
  taxAmountMinor,
}: {
  supabaseAdmin:
    SupabaseClient;

  stripeRefundId:
    string;

  stripeInvoiceId:
    string;

  creationDateMs:
    number;

  amountTaxInclusiveMinor:
    number;

  taxAmountMinor:
    number;
}): Promise<
  AppleExternalPurchaseReportingResult
> {
  assertAppleConfiguration();

  if (
    !stripeRefundId ||
    !stripeInvoiceId
  ) {
    throw new Error(
      "APPLE_REFUND_STRIPE_REFERENCE_MISSING"
    );
  }

  if (
    !Number.isSafeInteger(
      amountTaxInclusiveMinor
    ) ||
    amountTaxInclusiveMinor <=
      0
  ) {
    throw new Error(
      "APPLE_REFUND_AMOUNT_INVALID"
    );
  }

  if (
    !Number.isSafeInteger(
      taxAmountMinor
    ) ||
    taxAmountMinor <
      0 ||
    taxAmountMinor >
      amountTaxInclusiveMinor
  ) {
    throw new Error(
      "APPLE_REFUND_TAX_INVALID"
    );
  }

  const {
    data:
      original,
    error:
      originalError,
  } =
    await supabaseAdmin
      .from(
        "apple_external_purchase_reports"
      )
      .select(
        [
          "user_id",
          "stripe_invoice_id",
          "stripe_subscription_id",
          "line_item_id",
          "external_purchase_id",
          "request_payload",
        ].join(",")
      )
      .eq(
        "stripe_invoice_id",
        stripeInvoiceId
      )
      .eq(
        "status",
        "submitted"
      )
      .maybeSingle();

  if (
    originalError
  ) {
    throw new Error(
      `APPLE_REFUND_ORIGINAL_LOOKUP_FAILED:${originalError.message}`
    );
  }

  /*
   * The Stripe transaction wasn't an eligible Apple external
   * purchase. Nothing needs reporting to Apple.
   */

  if (
    !original
  ) {
    return {
      submitted:
        false,

      skipped:
        true,

      reason:
        "original-apple-transaction-not-found",
    };
  }

  const originalReport =
    original as unknown as
      AppleOriginalTransactionReport;

  if (
    typeof originalReport
      .line_item_id !==
      "string" ||
    typeof originalReport
      .external_purchase_id !==
      "string"
  ) {
    throw new Error(
      "APPLE_REFUND_ORIGINAL_REPORT_INCOMPLETE"
    );
  }

  const originalPayload =
    originalReport
      .request_payload;

  if (
    !originalPayload ||
    typeof originalPayload !==
      "object" ||
    Array.isArray(
      originalPayload
    )
  ) {
    throw new Error(
      "APPLE_REFUND_ORIGINAL_PAYLOAD_INVALID"
    );
  }

  const originalLineItems =
    (
      originalPayload as
        Record<
          string,
          unknown
        >
    )
      .lineItems;

  if (
    !Array.isArray(
      originalLineItems
    ) ||
    originalLineItems.length ===
      0
  ) {
    throw new Error(
      "APPLE_REFUND_ORIGINAL_LINE_ITEM_MISSING"
    );
  }

  const originalLine =
    originalLineItems[0] as
      Record<
        string,
        unknown
      >;

  const originalExclusiveMilli =
    originalLine
      .amountTaxExclusive;

  const reportingCurrency =
    originalLine
      .reportingCurrency;

  const pricingCurrency =
    originalLine
      .pricingCurrency;

  const taxCountry =
    originalLine
      .taxCountry;

  if (
    typeof originalExclusiveMilli !==
      "number" ||
    typeof reportingCurrency !==
      "string" ||
    typeof pricingCurrency !==
      "string" ||
    typeof taxCountry !==
      "string"
  ) {
    throw new Error(
      "APPLE_REFUND_ORIGINAL_FINANCIAL_DATA_MISSING"
    );
  }

  const originalExclusiveMinor =
    Math.round(
      originalExclusiveMilli /
        10
    );

  const refundExclusiveMinor =
    amountTaxInclusiveMinor -
    taxAmountMinor;

  const {
    data:
      existing,
    error:
      existingError,
  } =
    await supabaseAdmin
      .from(
        "apple_external_purchase_refund_reports"
      )
      .select(
        [
          "id",
          "status",
          "request_identifier",
          "refund_line_item_id",
        ].join(",")
      )
      .eq(
        "stripe_refund_id",
        stripeRefundId
      )
      .maybeSingle();

  if (
    existingError
  ) {
    throw new Error(
      `APPLE_REFUND_LOOKUP_FAILED:${existingError.message}`
    );
  }

  const existingReport =
    existing as unknown as
      ExistingAppleRefundReport |
      null;

  if (
    existingReport?.status ===
      "submitted"
  ) {
    return {
      submitted:
        true,

      skipped:
        true,

      reason:
        "refund-already-submitted",
    };
  }

  /*
   * netAmountTaxExclusive on Apple's REFUND line item is the
   * current remaining pre-tax net amount after all refunds.
   */

  const {
    data:
      previousRefunds,
    error:
      previousRefundsError,
  } =
    await supabaseAdmin
      .from(
        "apple_external_purchase_refund_reports"
      )
      .select(
        "refund_amount_exclusive_minor"
      )
      .eq(
        "stripe_invoice_id",
        stripeInvoiceId
      )
      .eq(
        "status",
        "submitted"
      );

  if (
    previousRefundsError
  ) {
    throw new Error(
      `APPLE_PREVIOUS_REFUNDS_LOOKUP_FAILED:${previousRefundsError.message}`
    );
  }

  const previouslyRefundedExclusive =
    (
      (
        previousRefunds ??
        []
      ) as unknown as
        PreviousAppleRefundReport[]
    )
      .reduce(
        (
          sum,
          row
        ) =>
          sum +
          (
            typeof row
              .refund_amount_exclusive_minor ===
              "number"
              ? row
                  .refund_amount_exclusive_minor
              : 0
          ),
        0
      );

  const remainingExclusiveMinor =
    Math.max(
      0,
      originalExclusiveMinor -
        previouslyRefundedExclusive -
        refundExclusiveMinor
    );

  const requestIdentifier =
    existingReport
      ?.request_identifier ??
    crypto.randomUUID();

  const refundLineItemId =
    existingReport
      ?.refund_line_item_id ??
    crypto.randomUUID();

  const lineItem:
    AppleRefundLineItem = {
    lineItemId:
      refundLineItemId,

    creationDate:
      creationDateMs,

    eventType:
      "REFUND",

    amountTaxInclusive:
      minorToMilli(
        amountTaxInclusiveMinor
      ),

    amountTaxExclusive:
      minorToMilli(
        refundExclusiveMinor
      ),

    taxAmount:
      minorToMilli(
        taxAmountMinor
      ),

    netAmountTaxExclusive:
      minorToMilli(
        remainingExclusiveMinor
      ),

    reportingCurrency,

    pricingCurrency,

    taxCountry,

    referenceLineItemId:
      originalReport
        .line_item_id,
  };

  const payload:
    AppleLineItemReportPayload = {
      requestIdentifier,

      externalPurchaseId:
        originalReport
          .external_purchase_id,

      status:
        "LINE_ITEM",

      lineItems: [
        lineItem,
      ],
    };

  const now =
    new Date()
      .toISOString();

  const row = {
    user_id:
      originalReport.user_id,

    stripe_refund_id:
      stripeRefundId,

    stripe_invoice_id:
      stripeInvoiceId,

    stripe_subscription_id:
      originalReport
        .stripe_subscription_id,

    request_identifier:
      requestIdentifier,

    refund_line_item_id:
      refundLineItemId,

    reference_line_item_id:
      originalReport
        .line_item_id,

    external_purchase_id:
      originalReport
        .external_purchase_id,

    refund_amount_inclusive_minor:
      amountTaxInclusiveMinor,

    refund_amount_exclusive_minor:
      refundExclusiveMinor,

    refund_tax_minor:
      taxAmountMinor,

    status:
      "pending",

    request_payload:
      payload,

    error_message:
      null,

    attempted_at:
      now,

    updated_at:
      now,
  };

  if (
    existingReport
  ) {
    const {
      error,
    } =
      await supabaseAdmin
        .from(
          "apple_external_purchase_refund_reports"
        )
        .update(
          row
        )
        .eq(
          "id",
          existingReport.id
        );

    if (
      error
    ) {
      throw new Error(
        `APPLE_REFUND_PENDING_UPDATE_FAILED:${error.message}`
      );
    }
  } else {
    const {
      error,
    } =
      await supabaseAdmin
        .from(
          "apple_external_purchase_refund_reports"
        )
        .insert({
          ...row,

          created_at:
            now,
        });

    if (
      error
    ) {
      throw new Error(
        `APPLE_REFUND_PENDING_INSERT_FAILED:${error.message}`
      );
    }
  }

  try {
    const appleResponse =
      await sendAppleReport(
        payload
      );

    const submittedAt =
      new Date()
        .toISOString();

    const {
      error,
    } =
      await supabaseAdmin
        .from(
          "apple_external_purchase_refund_reports"
        )
        .update({
          status:
            "submitted",

          apple_response:
            appleResponse,

          error_message:
            null,

          submitted_at:
            submittedAt,

          updated_at:
            submittedAt,
        })
        .eq(
          "stripe_refund_id",
          stripeRefundId
        );

    if (
      error
    ) {
      throw new Error(
        `APPLE_REFUND_SUCCESS_STORAGE_FAILED:${error.message}`
      );
    }

    return {
      submitted:
        true,

      skipped:
        false,

      reason:
        null,
    };
  } catch (
    error:
      unknown
  ) {
    const message =
      error instanceof Error
        ? error.message
        : "APPLE_REFUND_REPORT_UNKNOWN_ERROR";

    await supabaseAdmin
      .from(
        "apple_external_purchase_refund_reports"
      )
      .update({
        status:
          "failed",

        error_message:
          message.slice(
            0,
            4000
          ),

        updated_at:
          new Date()
            .toISOString(),
      })
      .eq(
        "stripe_refund_id",
        stripeRefundId
      );

    throw error;
  }
}

/* =========================================================
 * Generic Apple line-item correction / restatement
 *
 * Use only when a previously submitted line item contained
 * incorrect information.
 * ======================================================= */

export async function reportAppleLineItemCorrection({
  externalPurchaseId,
  lineItem,
  erroneouslySubmitted =
    false,
}: {
  externalPurchaseId:
    string;

  lineItem:
    AppleSubscriptionLineItem |
    AppleRefundLineItem;

  erroneouslySubmitted?:
    boolean;
}): Promise<unknown> {
  assertAppleConfiguration();

  const correctedLineItem = {
    ...lineItem,

    restatement:
      true,

    erroneouslySubmitted,
  };

  const payload:
    AppleLineItemReportPayload = {
      requestIdentifier:
        crypto.randomUUID(),

      externalPurchaseId,

      status:
        "LINE_ITEM",

      lineItems: [
        correctedLineItem,
      ],
    };

  return await sendAppleReport(
    payload
  );
}

