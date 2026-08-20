import ExpoModulesCore
import StoreKit

public final class TripleNStoreKitModule:
  Module {

  public func definition() ->
    ModuleDefinition {

    Name(
      "TripleNStoreKit"
    )

    /*
     * Returns whether this device/account is allowed to
     * begin an external-purchase flow.
     *
     * No Stripe operation happens here.
     */
    AsyncFunction(
      "getExternalPurchaseEligibility"
    ) { () async -> [String: Any] in

      guard
        AppStore.canMakePayments
      else {
        return [
          "canMakePayments":
            false,

          "eligible":
            false,

          "supported":
            true
        ]
      }

      if #available(
        iOS 18.1,
        *
      ) {
        let eligible =
          await ExternalPurchaseCustomLink
            .isEligible

        return [
          "canMakePayments":
            true,

          "eligible":
            eligible,

          "supported":
            true
        ]
      }

      return [
        "canMakePayments":
          true,

        "eligible":
          false,

        "supported":
          false
      ]
    }

    /*
     * Apple requires ACQUISITION and SERVICES tokens
     * for EU external-purchase flows.
     *
     * This function only obtains the tokens.
     * The JavaScript/server layer will associate them
     * with the authenticated Triple N account.
     */
    AsyncFunction(
      "getExternalPurchaseTokens"
    ) { () async throws -> [String: Any] in

      guard
        AppStore.canMakePayments
      else {
        return [
          "canMakePayments":
            false,

          "eligible":
            false,

          "acquisitionToken":
            NSNull(),

          "servicesToken":
            NSNull()
        ]
      }

      guard #available(
        iOS 18.1,
        *
      ) else {
        return [
          "canMakePayments":
            true,

          "eligible":
            false,

          "acquisitionToken":
            NSNull(),

          "servicesToken":
            NSNull()
        ]
      }

      let eligible =
        await ExternalPurchaseCustomLink
          .isEligible

      guard
        eligible
      else {
        return [
          "canMakePayments":
            true,

          "eligible":
            false,

          "acquisitionToken":
            NSNull(),

          "servicesToken":
            NSNull()
        ]
      }

      let acquisitionToken =
        try await ExternalPurchaseCustomLink
          .token(
            for:
              "ACQUISITION"
          )

      let servicesToken =
        try await ExternalPurchaseCustomLink
          .token(
            for:
              "SERVICES"
          )

      return [
        "canMakePayments":
          true,

        "eligible":
          true,

        "acquisitionToken":
          acquisitionToken?.value ??
            NSNull(),

        "servicesToken":
          servicesToken?.value ??
            NSNull()
      ]
    }

    /*
     * Must be called only after a deliberate user action.
     *
     * Triple N opens Stripe Checkout in the browser,
     * therefore Apple's notice type is .browser.
     */
    AsyncFunction(
      "showExternalPurchaseNotice"
    ) { () async throws -> [String: Any] in

      guard
        AppStore.canMakePayments
      else {
        return [
          "continued":
            false,

          "reason":
            "payments-not-allowed"
        ]
      }

      guard #available(
        iOS 18.1,
        *
      ) else {
        return [
          "continued":
            false,

          "reason":
            "api-unavailable"
        ]
      }

      let eligible =
        await ExternalPurchaseCustomLink
          .isEligible

      guard
        eligible
      else {
        return [
          "continued":
            false,

          "reason":
            "not-eligible"
        ]
      }

      let result =
        try await ExternalPurchaseCustomLink
          .showNotice(
            type:
              .browser
          )

      switch result {
      case .continued:
        return [
          "continued":
            true,

          "reason":
            "continued"
        ]

      case .cancelled:
        return [
          "continued":
            false,

          "reason":
            "cancelled"
        ]

      @unknown default:
        return [
          "continued":
            false,

          "reason":
            "unknown"
        ]
      }
    }
  }
}
