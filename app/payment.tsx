// app/payment.tsx

import {
    Feather,
} from '@expo/vector-icons';

import * as Haptics from 'expo-haptics';

import {
    router,
} from 'expo-router';

import {
    useMemo,
    useState,
} from 'react';

import {
    ActivityIndicator,
    Alert,
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';

import {
    PAYMENT_ENVIRONMENT,
    REAL_PAYMENTS_ENABLED,
    TRIPLE_N_PLANS,
    canContinueFromPaywall,
    type TripleNPlanId,
} from '@/lib/paymentConfig';

import {
    canEnterAppAfterPaymentFlow,
    startPaymentFlow,
} from '@/lib/paymentFlowService';

import {
    supabase,
} from '@/lib/supabase';

/* =========================================================
 * Payment screen
 * ======================================================= */

export default function PaymentScreen() {
  const [
    selectedPlan,
    setSelectedPlan,
  ] =
    useState<TripleNPlanId>(
      'yearly'
    );

  const [
    processing,
    setProcessing,
  ] =
    useState(
      false
    );

  const [
    signingOut,
    setSigningOut,
  ] =
    useState(
      false
    );

  /* =======================================================
   * Selected plan
   * ===================================================== */

  const plan =
    useMemo(
      () =>
        TRIPLE_N_PLANS.find(
          item =>
            item.id ===
            selectedPlan
        ) ??
        TRIPLE_N_PLANS[0],
      [
        selectedPlan,
      ]
    );

  const continueAllowed =
    canContinueFromPaywall() &&
    !processing &&
    !signingOut;

  const developmentPreview =
    PAYMENT_ENVIRONMENT ===
      'development' &&
    !REAL_PAYMENTS_ENABLED;

  /* =======================================================
   * Select plan
   * ===================================================== */

  async function selectPlan(
    id:
      TripleNPlanId
  ): Promise<void> {
    if (
      processing ||
      signingOut
    ) {
      return;
    }

    setSelectedPlan(
      id
    );

    try {
      await Haptics
        .selectionAsync();
    } catch {
      // Haptics are optional.
    }
  }

  /* =======================================================
   * Continue
   * ===================================================== */

  async function continuePayment():
    Promise<void> {
    if (
      !continueAllowed
    ) {
      return;
    }

    setProcessing(
      true
    );

    try {
      /* ---------------------------------------------------
       * Resolve authenticated user
       * ------------------------------------------------- */

      const {
        data,
        error,
      } =
        await supabase.auth
          .getUser();

      if (
        error
      ) {
        throw error;
      }

      const user =
        data.user;

      if (
        !user
      ) {
        router.replace(
          '/login' as never
        );

        return;
      }

      /* ---------------------------------------------------
       * Start unified payment flow
       * ------------------------------------------------- */

      const result =
        await startPaymentFlow({
          userId:
            user.id,

          planId:
            selectedPlan,
        });

      /* ---------------------------------------------------
       * Success
       * ------------------------------------------------- */

      if (
        canEnterAppAfterPaymentFlow(
          result
        )
      ) {
        try {
          await Haptics
            .notificationAsync(
              Haptics
                .NotificationFeedbackType
                .Success
            );
        } catch {
          // Haptics are optional.
        }

        /*
         * Development:
         *
         * Development access has already been granted
         * inside paymentFlowService.
         *
         * Production:
         *
         * We will only arrive here after the payment
         * architecture allows verified access.
         */

        return;
      }

      /* ---------------------------------------------------
       * Cancelled
       * ------------------------------------------------- */

      if (
        result.status ===
          'cancelled'
      ) {
        return;
      }

      /* ---------------------------------------------------
       * Pending
       * ------------------------------------------------- */

      if (
        result.status ===
          'pending'
      ) {
        Alert.alert(
          'Payment pending',
          'Your subscription is being verified. Triple N will unlock automatically once the payment is confirmed.'
        );

        return;
      }

      /* ---------------------------------------------------
       * Failed
       * ------------------------------------------------- */

      Alert.alert(
        'Unable to continue',
        result.errorMessage ||
        'The subscription process could not be completed. Please try again.'
      );
    } catch (
      error: any
    ) {
      console.log(
        'PAYMENT SCREEN CONTINUE ERROR:',
        error
      );

      try {
        await Haptics
          .notificationAsync(
            Haptics
              .NotificationFeedbackType
              .Error
          );
      } catch {
        // Haptics are optional.
      }

      Alert.alert(
        'Unable to continue',
        error?.message ||
        'Something went wrong. Please try again.'
      );
    } finally {
      setProcessing(
        false
      );
    }
  }

  /* =======================================================
   * Sign out
   * ===================================================== */

  async function signOut():
    Promise<void> {
    if (
      processing ||
      signingOut
    ) {
      return;
    }

    setSigningOut(
      true
    );

    try {
      const {
        error,
      } =
        await supabase.auth
          .signOut();

      if (
        error
      ) {
        throw error;
      }

      router.replace(
        '/login' as never
      );
    } catch (
      error: any
    ) {
      Alert.alert(
        'Unable to sign out',
        error?.message ||
        'Please try again.'
      );
    } finally {
      setSigningOut(
        false
      );
    }
  }

  /* =======================================================
   * Render
   * ===================================================== */

  return (
    <SafeAreaView
      style={
        styles.safeArea
      }
    >
      <ScrollView
        style={
          styles.container
        }
        contentContainerStyle={
          styles.content
        }
        showsVerticalScrollIndicator={
          false
        }
        bounces={
          true
        }
      >
        {/* =================================================
         * Header
         * =============================================== */}

        <View
          style={
            styles.header
          }
        >
          <View
            style={
              styles.headerSide
            }
          />

          <View
            style={
              styles.headerBrand
            }
          >
            <View
              style={
                styles.headerBrandMark
              }
            >
              <Text
                style={
                  styles.headerBrandLetter
                }
              >
                N
              </Text>
            </View>

            <Text
              style={
                styles.headerBrandText
              }
            >
              TRIPLE N
            </Text>
          </View>

          <TouchableOpacity
            activeOpacity={
              0.8
            }
            disabled={
              processing ||
              signingOut
            }
            style={[
              styles.signOutButton,

              (
                processing ||
                signingOut
              ) &&
                styles.buttonDisabled,
            ]}
            onPress={() =>
              void signOut()
            }
          >
            {signingOut ? (
              <ActivityIndicator
                size="small"
                color="#a6a8ae"
              />
            ) : (
              <Feather
                name="log-out"
                size={19}
                color="#a6a8ae"
              />
            )}
          </TouchableOpacity>
        </View>

        {/* =================================================
         * Hero
         * =============================================== */}

        <View
          style={
            styles.hero
          }
        >
          <View
            style={
              styles.premiumSymbol
            }
          >
            <View
              style={
                styles.premiumSymbolInner
              }
            >
              <Feather
                name="star"
                size={27}
                color="#111111"
              />
            </View>
          </View>

          <View
            style={
              styles.premiumBadge
            }
          >
            <Text
              style={
                styles.premiumBadgeText
              }
            >
              TRIPLE N PREMIUM
            </Text>
          </View>

          <Text
            style={
              styles.heroTitle
            }
          >
            Your wardrobe,
            {'\n'}
            elevated.
          </Text>

          <Text
            style={
              styles.heroSubtitle
            }
          >
            Your personal AI fashion experience,
            built around what you actually own.
          </Text>
        </View>

        {/* =================================================
         * Benefits
         * =============================================== */}

        <View
          style={
            styles.featuresCard
          }
        >
          <PremiumFeature
            icon="zap"
            title="Unlimited outfit ideas"
            subtitle="Create fresh combinations from your own wardrobe whenever you need them."
          />

          <PremiumFeature
            icon="star"
            title="Smart personal styling"
            subtitle="Get recommendations shaped around your clothes, style and occasion."
          />

          <PremiumFeature
            icon="cloud-rain"
            title="Weather-aware outfits"
            subtitle="Dress for real conditions with automatic weather-aware suggestions."
          />

          <PremiumFeature
            icon="heart"
            title="Keep your best looks"
            subtitle="Save favourites and build a personal collection of outfits."
            last
          />
        </View>

        {/* =================================================
         * Plans
         * =============================================== */}

        <View
          style={
            styles.sectionHeading
          }
        >
          <Text
            style={
              styles.sectionEyebrow
            }
          >
            MEMBERSHIP
          </Text>

          <Text
            style={
              styles.sectionTitle
            }
          >
            Choose your plan
          </Text>

          <Text
            style={
              styles.sectionSubtitle
            }
          >
            One membership. The full Triple N experience.
          </Text>
        </View>

        <View
          style={
            styles.plans
          }
        >
          {TRIPLE_N_PLANS.map(
            item => {
              const active =
                item.id ===
                selectedPlan;

              return (
                <TouchableOpacity
                  key={
                    item.id
                  }
                  activeOpacity={
                    0.88
                  }
                  disabled={
                    processing ||
                    signingOut
                  }
                  style={[
                    styles.planCard,

                    active &&
                      styles
                        .planCardActive,

                    (
                      processing ||
                      signingOut
                    ) &&
                      styles
                        .buttonDisabled,
                  ]}
                  onPress={() =>
                    void selectPlan(
                      item.id
                    )
                  }
                >
                  {item.badge ? (
                    <View
                      style={
                        styles.planBadge
                      }
                    >
                      <Text
                        style={
                          styles.planBadgeText
                        }
                      >
                        {item.badge}
                      </Text>
                    </View>
                  ) : null}

                  <View
                    style={
                      styles.planHeader
                    }
                  >
                    <View
                      style={[
                        styles.radioOuter,

                        active &&
                          styles
                            .radioOuterActive,
                      ]}
                    >
                      {active ? (
                        <View
                          style={
                            styles.radioInner
                          }
                        />
                      ) : null}
                    </View>

                    <View
                      style={
                        styles.planHeadingBox
                      }
                    >
                      <Text
                        style={
                          styles.planName
                        }
                      >
                        {item.name}
                      </Text>

                      <Text
                        style={
                          styles.planDescription
                        }
                      >
                        {item.description}
                      </Text>
                    </View>
                  </View>

                  <View
                    style={
                      styles.priceRow
                    }
                  >
                    <Text
                      style={
                        styles.price
                      }
                    >
                      {item.priceLabel}
                    </Text>

                    <Text
                      style={
                        styles.billingLabel
                      }
                    >
                      {item.billingLabel}
                    </Text>
                  </View>

                  {item.id ===
                    'yearly' ? (
                    <View
                      style={
                        styles.yearlySavingRow
                      }
                    >
                      <Feather
                        name="check-circle"
                        size={15}
                        color="#f1d8c2"
                      />

                      <Text
                        style={
                          styles.yearlySavingText
                        }
                      >
                        Better value for long-term access
                      </Text>
                    </View>
                  ) : null}
                </TouchableOpacity>
              );
            }
          )}
        </View>

        {/* =================================================
         * Summary
         * =============================================== */}

        <View
          style={
            styles.summaryCard
          }
        >
          <View
            style={
              styles.summaryHeader
            }
          >
            <View>
              <Text
                style={
                  styles.summaryEyebrow
                }
              >
                YOUR SELECTION
              </Text>

              <Text
                style={
                  styles.summaryTitle
                }
              >
                Triple N Premium
              </Text>
            </View>

            <View
              style={
                styles.summaryPlanBadge
              }
            >
              <Text
                style={
                  styles.summaryPlanBadgeText
                }
              >
                {plan.name.toUpperCase()}
              </Text>
            </View>
          </View>

          <View
            style={
              styles.summaryDivider
            }
          />

          <View
            style={
              styles.summaryRow
            }
          >
            <View>
              <Text
                style={
                  styles.summaryLabel
                }
              >
                Total
              </Text>

              <Text
                style={
                  styles.summaryBilling
                }
              >
                {plan.billingLabel}
              </Text>
            </View>

            <Text
              style={
                styles.summaryTotal
              }
            >
              {plan.priceLabel}
            </Text>
          </View>
        </View>

        {/* =================================================
         * Current development status
         * =============================================== */}

        {developmentPreview ? (
          <View
            style={
              styles.previewCard
            }
          >
            <View
              style={
                styles.previewIcon
              }
            >
              <Feather
                name="shield"
                size={19}
                color="#f1d8c2"
              />
            </View>

            <View
              style={
                styles.previewTextBox
              }
            >
              <Text
                style={
                  styles.previewTitle
                }
              >
                Checkout setup in progress
              </Text>

              <Text
                style={
                  styles.previewSubtitle
                }
              >
                Continue currently opens Triple N without charging you. Real checkout will be activated when payment processing is ready.
              </Text>
            </View>
          </View>
        ) : null}

        {/* =================================================
         * Continue
         * =============================================== */}

        <TouchableOpacity
          activeOpacity={
            0.86
          }
          disabled={
            !continueAllowed
          }
          style={[
            styles.continueButton,

            !continueAllowed &&
              styles
                .continueButtonDisabled,
          ]}
          onPress={() =>
            void continuePayment()
          }
        >
          {processing ? (
            <>
              <ActivityIndicator
                size="small"
                color="#111111"
              />

              <Text
                style={
                  styles.continueButtonText
                }
              >
                Preparing...
              </Text>
            </>
          ) : (
            <>
              <Text
                style={
                  styles.continueButtonText
                }
              >
                Continue
              </Text>

              <View
                style={
                  styles.continueArrow
                }
              >
                <Feather
                  name="arrow-right"
                  size={18}
                  color="#111111"
                />
              </View>
            </>
          )}
        </TouchableOpacity>

        {/* =================================================
         * Security
         * =============================================== */}

        <View
          style={
            styles.securityRow
          }
        >
          <Feather
            name="lock"
            size={13}
            color="#72757d"
          />

          <Text
            style={
              styles.securityText
            }
          >
            Secure subscription access · Cancel according to your selected billing provider
          </Text>
        </View>

        <Text
          style={
            styles.legalPreview
          }
        >
          Final prices, billing terms and payment methods will be shown before any real charge is made.
        </Text>

        <Text
          style={
            styles.footer
          }
        >
          TRIPLE N · PREMIUM EXPERIENCE
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

/* =========================================================
 * Premium feature
 * ======================================================= */

function PremiumFeature({
  icon,
  title,
  subtitle,
  last = false,
}: {
  icon:
    React.ComponentProps<
      typeof Feather
    >['name'];

  title:
    string;

  subtitle:
    string;

  last?:
    boolean;
}) {
  return (
    <View
      style={[
        styles.featureRow,

        last &&
          styles
            .featureRowLast,
      ]}
    >
      <View
        style={
          styles.featureIcon
        }
      >
        <Feather
          name={
            icon
          }
          size={19}
          color="#111111"
        />
      </View>

      <View
        style={
          styles.featureTextBox
        }
      >
        <Text
          style={
            styles.featureTitle
          }
        >
          {title}
        </Text>

        <Text
          style={
            styles.featureSubtitle
          }
        >
          {subtitle}
        </Text>
      </View>

      <View
        style={
          styles.featureCheck
        }
      >
        <Feather
          name="check"
          size={15}
          color="#f1d8c2"
        />
      </View>
    </View>
  );
}

/* =========================================================
 * Styles
 * ======================================================= */

const styles =
  StyleSheet.create({
    safeArea: {
      flex:
        1,

      backgroundColor:
        '#07090d',
    },

    container: {
      flex:
        1,

      backgroundColor:
        '#07090d',
    },

    content: {
      paddingHorizontal:
        22,

      paddingTop:
        8,

      paddingBottom:
        48,
    },

    /* =====================================================
     * Header
     * =================================================== */

    header: {
      minHeight:
        56,

      flexDirection:
        'row',

      alignItems:
        'center',

      justifyContent:
        'space-between',
    },

    headerSide: {
      width:
        44,

      height:
        44,
    },

    headerBrand: {
      flexDirection:
        'row',

      alignItems:
        'center',

      justifyContent:
        'center',
    },

    headerBrandMark: {
      width:
        26,

      height:
        26,

      marginRight:
        9,

      alignItems:
        'center',

      justifyContent:
        'center',

      borderWidth:
        1,

      borderColor:
        'rgba(241,216,194,0.48)',

      borderRadius:
        13,

      backgroundColor:
        '#15171b',
    },

    headerBrandLetter: {
      color:
        '#f1d8c2',

      fontSize:
        14,

      fontWeight:
        '900',
    },

    headerBrandText: {
      color:
        '#f3f3f3',

      fontSize:
        12,

      fontWeight:
        '900',

      letterSpacing:
        2.7,
    },

    signOutButton: {
      width:
        44,

      height:
        44,

      alignItems:
        'center',

      justifyContent:
        'center',

      borderWidth:
        1,

      borderColor:
        '#252830',

      borderRadius:
        22,

      backgroundColor:
        '#14161b',
    },

    /* =====================================================
     * Hero
     * =================================================== */

    hero: {
      alignItems:
        'center',

      paddingTop:
        31,

      paddingBottom:
        31,
    },

    premiumSymbol: {
      width:
        72,

      height:
        72,

      alignItems:
        'center',

      justifyContent:
        'center',

      borderWidth:
        1,

      borderColor:
        'rgba(241,216,194,0.18)',

      borderRadius:
        36,

      backgroundColor:
        'rgba(241,216,194,0.035)',
    },

    premiumSymbolInner: {
      width:
        56,

      height:
        56,

      alignItems:
        'center',

      justifyContent:
        'center',

      borderRadius:
        28,

      backgroundColor:
        '#f1d8c2',
    },

    premiumBadge: {
      marginTop:
        19,

      paddingHorizontal:
        14,

      paddingVertical:
        7,

      borderWidth:
        1,

      borderColor:
        'rgba(241,216,194,0.27)',

      borderRadius:
        999,

      backgroundColor:
        'rgba(241,216,194,0.06)',
    },

    premiumBadgeText: {
      color:
        '#f1d8c2',

      fontSize:
        10,

      fontWeight:
        '900',

      letterSpacing:
        1.5,
    },

    heroTitle: {
      marginTop:
        20,

      color:
        '#ffffff',

      fontSize:
        42,

      lineHeight:
        47,

      fontWeight:
        '900',

      letterSpacing:
        -1.25,

      textAlign:
        'center',
    },

    heroSubtitle: {
      maxWidth:
        345,

      marginTop:
        15,

      color:
        '#8f9299',

      fontSize:
        15,

      lineHeight:
        23,

      fontWeight:
        '600',

      textAlign:
        'center',
    },

    /* =====================================================
     * Features
     * =================================================== */

    featuresCard: {
      overflow:
        'hidden',

      borderWidth:
        1,

      borderColor:
        '#22252b',

      borderRadius:
        28,

      backgroundColor:
        '#111318',
    },

    featureRow: {
      minHeight:
        84,

      paddingHorizontal:
        16,

      paddingVertical:
        14,

      flexDirection:
        'row',

      alignItems:
        'center',

      borderBottomWidth:
        StyleSheet.hairlineWidth,

      borderBottomColor:
        '#292c33',
    },

    featureRowLast: {
      borderBottomWidth:
        0,
    },

    featureIcon: {
      width:
        42,

      height:
        42,

      alignItems:
        'center',

      justifyContent:
        'center',

      borderRadius:
        15,

      backgroundColor:
        '#f1d8c2',
    },

    featureTextBox: {
      flex:
        1,

      marginLeft:
        14,

      paddingRight:
        10,
    },

    featureTitle: {
      color:
        '#ffffff',

      fontSize:
        15,

      lineHeight:
        20,

      fontWeight:
        '900',
    },

    featureSubtitle: {
      marginTop:
        4,

      color:
        '#7f838c',

      fontSize:
        12,

      lineHeight:
        17,

      fontWeight:
        '600',
    },

    featureCheck: {
      width:
        28,

      height:
        28,

      alignItems:
        'center',

      justifyContent:
        'center',

      borderWidth:
        1,

      borderColor:
        '#30333a',

      borderRadius:
        14,

      backgroundColor:
        '#191b20',
    },

    /* =====================================================
     * Section
     * =================================================== */

    sectionHeading: {
      marginTop:
        33,

      marginBottom:
        16,
    },

    sectionEyebrow: {
      color:
        '#f1d8c2',

      fontSize:
        10,

      fontWeight:
        '900',

      letterSpacing:
        1.5,
    },

    sectionTitle: {
      marginTop:
        7,

      color:
        '#ffffff',

      fontSize:
        23,

      fontWeight:
        '900',
    },

    sectionSubtitle: {
      marginTop:
        6,

      color:
        '#858995',

      fontSize:
        13,

      lineHeight:
        19,

      fontWeight:
        '600',
    },

    /* =====================================================
     * Plans
     * =================================================== */

    plans: {
      gap:
        13,
    },

    planCard: {
      position:
        'relative',

      padding:
        19,

      overflow:
        'hidden',

      borderWidth:
        1,

      borderColor:
        '#252830',

      borderRadius:
        25,

      backgroundColor:
        '#111318',
    },

    planCardActive: {
      borderColor:
        '#f1d8c2',

      backgroundColor:
        '#17171a',
    },

    planBadge: {
      position:
        'absolute',

      top:
        0,

      right:
        0,

      paddingHorizontal:
        13,

      paddingVertical:
        7,

      borderBottomLeftRadius:
        15,

      backgroundColor:
        '#f1d8c2',
    },

    planBadgeText: {
      color:
        '#111111',

      fontSize:
        8,

      fontWeight:
        '900',

      letterSpacing:
        0.8,
    },

    planHeader: {
      paddingRight:
        65,

      flexDirection:
        'row',

      alignItems:
        'flex-start',
    },

    radioOuter: {
      width:
        22,

      height:
        22,

      marginTop:
        1,

      alignItems:
        'center',

      justifyContent:
        'center',

      borderWidth:
        2,

      borderColor:
        '#555962',

      borderRadius:
        11,
    },

    radioOuterActive: {
      borderColor:
        '#f1d8c2',
    },

    radioInner: {
      width:
        10,

      height:
        10,

      borderRadius:
        5,

      backgroundColor:
        '#f1d8c2',
    },

    planHeadingBox: {
      flex:
        1,

      marginLeft:
        12,
    },

    planName: {
      color:
        '#ffffff',

      fontSize:
        17,

      fontWeight:
        '900',
    },

    planDescription: {
      marginTop:
        6,

      color:
        '#858995',

      fontSize:
        12,

      lineHeight:
        18,

      fontWeight:
        '600',
    },

    priceRow: {
      marginTop:
        20,

      flexDirection:
        'row',

      alignItems:
        'flex-end',
    },

    price: {
      color:
        '#ffffff',

      fontSize:
        32,

      fontWeight:
        '900',

      letterSpacing:
        -0.9,
    },

    billingLabel: {
      marginLeft:
        8,

      marginBottom:
        5,

      color:
        '#8f9299',

      fontSize:
        12,

      fontWeight:
        '700',
    },

    yearlySavingRow: {
      marginTop:
        15,

      flexDirection:
        'row',

      alignItems:
        'center',
    },

    yearlySavingText: {
      marginLeft:
        7,

      color:
        '#b9a694',

      fontSize:
        11,

      fontWeight:
        '700',
    },

    /* =====================================================
     * Summary
     * =================================================== */

    summaryCard: {
      marginTop:
        19,

      padding:
        19,

      borderWidth:
        1,

      borderColor:
        '#22252b',

      borderRadius:
        24,

      backgroundColor:
        '#111318',
    },

    summaryHeader: {
      flexDirection:
        'row',

      alignItems:
        'center',

      justifyContent:
        'space-between',
    },

    summaryEyebrow: {
      color:
        '#70747d',

      fontSize:
        9,

      fontWeight:
        '900',

      letterSpacing:
        1.2,
    },

    summaryTitle: {
      marginTop:
        5,

      color:
        '#ffffff',

      fontSize:
        16,

      fontWeight:
        '900',
    },

    summaryPlanBadge: {
      paddingHorizontal:
        10,

      paddingVertical:
        6,

      borderWidth:
        1,

      borderColor:
        'rgba(241,216,194,0.22)',

      borderRadius:
        999,

      backgroundColor:
        'rgba(241,216,194,0.06)',
    },

    summaryPlanBadgeText: {
      color:
        '#f1d8c2',

      fontSize:
        8,

      fontWeight:
        '900',

      letterSpacing:
        0.7,
    },

    summaryDivider: {
      height:
        StyleSheet.hairlineWidth,

      marginVertical:
        17,

      backgroundColor:
        '#30333a',
    },

    summaryRow: {
      flexDirection:
        'row',

      alignItems:
        'center',

      justifyContent:
        'space-between',
    },

    summaryLabel: {
      color:
        '#ffffff',

      fontSize:
        14,

      fontWeight:
        '900',
    },

    summaryBilling: {
      marginTop:
        3,

      color:
        '#777b84',

      fontSize:
        11,

      fontWeight:
        '600',
    },

    summaryTotal: {
      color:
        '#f1d8c2',

      fontSize:
        22,

      fontWeight:
        '900',
    },

    /* =====================================================
     * Development preview
     * =================================================== */

    previewCard: {
      marginTop:
        18,

      padding:
        16,

      flexDirection:
        'row',

      alignItems:
        'center',

      borderWidth:
        1,

      borderColor:
        'rgba(241,216,194,0.2)',

      borderRadius:
        21,

      backgroundColor:
        'rgba(241,216,194,0.045)',
    },

    previewIcon: {
      width:
        42,

      height:
        42,

      alignItems:
        'center',

      justifyContent:
        'center',

      borderRadius:
        21,

      backgroundColor:
        '#1b1d22',
    },

    previewTextBox: {
      flex:
        1,

      marginLeft:
        13,
    },

    previewTitle: {
      color:
        '#ffffff',

      fontSize:
        13,

      fontWeight:
        '900',
    },

    previewSubtitle: {
      marginTop:
        4,

      color:
        '#858995',

      fontSize:
        10,

      lineHeight:
        16,

      fontWeight:
        '600',
    },

    /* =====================================================
     * Continue
     * =================================================== */

    continueButton: {
      minHeight:
        62,

      marginTop:
        20,

      paddingHorizontal:
        21,

      flexDirection:
        'row',

      alignItems:
        'center',

      justifyContent:
        'center',

      borderRadius:
        22,

      backgroundColor:
        '#f1d8c2',
    },

    continueButtonDisabled: {
      opacity:
        0.52,
    },

    continueButtonText: {
      marginHorizontal:
        10,

      color:
        '#111111',

      fontSize:
        16,

      fontWeight:
        '900',
    },

    continueArrow: {
      width:
        30,

      height:
        30,

      alignItems:
        'center',

      justifyContent:
        'center',

      borderRadius:
        15,

      backgroundColor:
        'rgba(17,17,17,0.08)',
    },

    buttonDisabled: {
      opacity:
        0.58,
    },

    /* =====================================================
     * Footer/security
     * =================================================== */

    securityRow: {
      marginTop:
        14,

      paddingHorizontal:
        10,

      flexDirection:
        'row',

      alignItems:
        'center',

      justifyContent:
        'center',
    },

    securityText: {
      flex:
        1,

      marginLeft:
        7,

      color:
        '#72757d',

      fontSize:
        10,

      lineHeight:
        15,

      textAlign:
        'center',
    },

    legalPreview: {
      marginTop:
        11,

      paddingHorizontal:
        13,

      color:
        '#555962',

      fontSize:
        9,

      lineHeight:
        14,

      textAlign:
        'center',
    },

    footer: {
      marginTop:
        35,

      color:
        '#484b52',

      fontSize:
        9,

      fontWeight:
        '900',

      letterSpacing:
        1.6,

      textAlign:
        'center',
    },
  });