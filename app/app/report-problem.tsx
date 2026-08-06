// app/report-problem.tsx
//
// Triple N - Problem Reporting Screen
//
// مسؤوليات الشاشة:
//
// 1) عرض خمس مشكلات محددة للمستخدم.
// 2) السماح بإرسال مشكلة واحدة في كل مرة.
// 3) منع الضغط المتكرر أثناء الإرسال.
// 4) تسجيل المشكلة من خلال issueReportService.
// 5) عرض اعتذار واضح بعد نجاح التسجيل.
// 6) إبلاغ المستخدم بأن المشكلة ستُراجع خلال أيام.
// 7) وعد المستخدم بهدية تقديرية بعد حل المشكلة.
// 8) عدم عرض بيانات أو إحصائيات مستخدمين آخرين.

import {
    useTranslation,
} from '@/lib/i18n';

import {
    submitIssueReport,
    type IssueReportCode,
    type IssueReportSubmissionResult,
} from '@/lib/issueReportService';

import {
    Feather,
} from '@expo/vector-icons';

import {
    router,
} from 'expo-router';

import {
    useMemo,
    useState,
} from 'react';

import {
    ActivityIndicator,
    Modal,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';

/* =========================================================
 * Types
 * ======================================================= */

type ProblemOption = {
  code:
    IssueReportCode;

  icon:
    React.ComponentProps<
      typeof Feather
    >['name'];

  titleKey:
    string;

  descriptionKey:
    string;

  fallbackTitle:
    string;

  fallbackDescription:
    string;
};

/* =========================================================
 * Constants
 * ======================================================= */

const PROBLEM_OPTIONS:
  readonly ProblemOption[] = [
    {
      code:
        'scan-not-completing',

      icon:
        'camera-off',

      titleKey:
        'issueReport.problemScanNotCompleting',

      descriptionKey:
        'issueReport.problemScanNotCompletingDescription',

      fallbackTitle:
        'Scan Item does not complete',

      fallbackDescription:
        'The scan remains in progress, stops unexpectedly, or never reaches the final result.',
    },

    {
      code:
        'processed-image-not-visible',

      icon:
        'image',

      titleKey:
        'issueReport.problemImageNotVisible',

      descriptionKey:
        'issueReport.problemImageNotVisibleDescription',

      fallbackTitle:
        'Processed item is not visible',

      fallbackDescription:
        'The item was processed, but its image does not appear correctly in the wardrobe.',
    },

    {
      code:
        'app-freezing-or-slow',

      icon:
        'activity',

      titleKey:
        'issueReport.problemAppFreezing',

      descriptionKey:
        'issueReport.problemAppFreezingDescription',

      fallbackTitle:
        'The app freezes or becomes slow',

      fallbackDescription:
        'Triple N becomes unresponsive, closes unexpectedly, or performs much slower than usual.',
    },

    {
      code:
        'wardrobe-items-missing',

      icon:
        'archive',

      titleKey:
        'issueReport.problemWardrobeItemsMissing',

      descriptionKey:
        'issueReport.problemWardrobeItemsMissingDescription',

      fallbackTitle:
        'Wardrobe items are missing',

      fallbackDescription:
        'One or more saved wardrobe items are missing, empty, or do not load correctly.',
    },

    {
      code:
        'outfit-results-incorrect',

      icon:
        'shuffle',

      titleKey:
        'issueReport.problemOutfitResults',

      descriptionKey:
        'issueReport.problemOutfitResultsDescription',

      fallbackTitle:
        'Outfit results are not correct',

      fallbackDescription:
        'An outfit suggestion contains incorrect items, missing pieces, or an unsuitable combination.',
    },
  ];

/* =========================================================
 * Screen
 * ======================================================= */

export default function ReportProblemScreen() {
  const {
    t,
  } =
    useTranslation();

  const [
    submittingCode,
    setSubmittingCode,
  ] =
    useState<
      IssueReportCode | null
    >(
      null
    );

  const [
    submissionResult,
    setSubmissionResult,
  ] =
    useState<
      IssueReportSubmissionResult | null
    >(
      null
    );

  const [
    submittedProblemTitle,
    setSubmittedProblemTitle,
  ] =
    useState(
      ''
    );

  const submitting =
    submittingCode !==
      null;

  /* =======================================================
   * Translation fallback
   * ===================================================== */

  function translateWithFallback(
    key:
      string,
    fallback:
      string
  ): string {
    const translated =
      t(
        key as never
      );

    if (
      !translated ||
      translated ===
        key
    ) {
      return fallback;
    }

    return translated;
  }

  /* =======================================================
   * Text
   * ===================================================== */

  const screenTitle =
    translateWithFallback(
      'issueReport.title',
      'Report a problem'
    );

  const screenSubtitle =
    translateWithFallback(
      'issueReport.subtitle',
      'Tell us what went wrong. Your report helps us improve Triple N for everyone.'
    );

  const privacyMessage =
    translateWithFallback(
      'issueReport.privacy',
      'Your report is linked securely to your account so we can identify affected users and follow up after the issue is resolved.'
    );

  const successTitle =
    translateWithFallback(
      'issueReport.successTitle',
      'Thank you for your patience'
    );

  const successMessage =
    translateWithFallback(
      'issueReport.successMessage',
      'We are truly sorry that you experienced this problem. Your report has been registered successfully, and our team will work to resolve it within the coming days.'
    );

  const giftMessage =
    translateWithFallback(
      'issueReport.giftMessage',
      'We also promise you a valuable appreciation gift after the problem has been resolved.'
    );

  const closeButtonText =
    translateWithFallback(
      'issueReport.close',
      'Done'
    );

  /* =======================================================
   * Submission
   * ===================================================== */

  async function reportProblem(
    problem:
      ProblemOption
  ): Promise<void> {
    if (
      submitting
    ) {
      return;
    }

    const problemTitle =
      translateWithFallback(
        problem.titleKey,
        problem.fallbackTitle
      );

    setSubmittingCode(
      problem.code
    );

    try {
      const result =
        await submitIssueReport({
          issueCode:
            problem.code,

          issueTitle:
            problemTitle,
        });

      setSubmittedProblemTitle(
        problemTitle
      );

      setSubmissionResult(
        result
      );
    } catch (
      error:
        unknown
    ) {
      const message =
        error instanceof
          Error
          ? error.message
          : translateWithFallback(
              'issueReport.submitFailed',
              'We could not register your report. Please try again.'
            );

      setSubmittedProblemTitle(
        ''
      );

     setSubmissionResult({
  success:
    false,

  reportId:
    null,

  issueCode:
    problem.code,

  issueKey:
    problem.code,

  issueTitle:
    problemTitle,

  alreadyReported:
    false,

  reportCount:
    0,

  uniqueReporters:
    0,

  totalUniqueReports:
    0,

  totalReports:
    0,

  message,

  rawResult: {},
});

    } finally {
      setSubmittingCode(
        null
      );
    }
  }

  /* =======================================================
   * Result state
   * ===================================================== */

  const submissionSucceeded =
    submissionResult
      ?.success ===
    true;

  const resultDescription =
    useMemo(
      () => {
        if (
          !submissionResult
        ) {
          return '';
        }

        if (
          submissionResult.success
        ) {
          return successMessage;
        }

        return (
          submissionResult.message ||
          translateWithFallback(
            'issueReport.submitFailed',
            'We could not register your report. Please try again.'
          )
        );
      },
      [
        submissionResult,
        successMessage,
      ]
    );

  function closeResult():
    void {
    setSubmissionResult(
      null
    );

    setSubmittedProblemTitle(
      ''
    );
  }

  /* =======================================================
   * Render
   * ===================================================== */

  return (
    <View
      style={
        styles.screen
      }
    >
      <ScrollView
        style={
          styles.scrollView
        }
        contentContainerStyle={
          styles.content
        }
        showsVerticalScrollIndicator={
          false
        }
      >
        {/* Header */}

        <View
          style={
            styles.header
          }
        >
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={translateWithFallback(
              'common.back',
              'Back'
            )}
            activeOpacity={
              0.82
            }
            style={
              styles.backButton
            }
            onPress={() =>
              router.back()
            }
          >
            <Feather
              name="chevron-left"
              size={
                29
              }
              color="#FFFFFF"
            />
          </TouchableOpacity>

          <View
            style={
              styles.headerIcon
            }
          >
            <Feather
              name="message-circle"
              size={
                25
              }
              color="#f1d8c2"
            />
          </View>
        </View>

        <Text
          style={
            styles.title
          }
        >
          {screenTitle}
        </Text>

        <Text
          style={
            styles.subtitle
          }
        >
          {screenSubtitle}
        </Text>

        {/* Problems */}

        <View
          style={
            styles.problemList
          }
        >
          {PROBLEM_OPTIONS.map(
            (
              problem,
              index
            ) => {
              const problemTitle =
                translateWithFallback(
                  problem.titleKey,
                  problem.fallbackTitle
                );

              const problemDescription =
                translateWithFallback(
                  problem.descriptionKey,
                  problem.fallbackDescription
                );

              const isSubmittingThisProblem =
                submittingCode ===
                  problem.code;

              return (
                <TouchableOpacity
                  key={
                    problem.code
                  }
                  accessibilityRole="button"
                  accessibilityLabel={
                    problemTitle
                  }
                  accessibilityHint={
                    problemDescription
                  }
                  activeOpacity={
                    0.86
                  }
                  disabled={
                    submitting
                  }
                  style={[
                    styles.problemButton,

                    index ===
                      PROBLEM_OPTIONS.length -
                        1 &&
                      styles.lastProblemButton,

                    submitting &&
                      styles.problemButtonDisabled,

                    isSubmittingThisProblem &&
                      styles.problemButtonSubmitting,
                  ]}
                  onPress={() => {
                    void reportProblem(
                      problem
                    );
                  }}
                >
                  <View
                    style={
                      styles.problemIconContainer
                    }
                  >
                    {isSubmittingThisProblem ? (
                      <ActivityIndicator
                        size="small"
                        color="#f1d8c2"
                      />
                    ) : (
                      <Feather
                        name={
                          problem.icon
                        }
                        size={
                          21
                        }
                        color="#f1d8c2"
                      />
                    )}
                  </View>

                  <View
                    style={
                      styles.problemTextContainer
                    }
                  >
                    <Text
                      style={
                        styles.problemTitle
                      }
                    >
                      {problemTitle}
                    </Text>

                    <Text
                      style={
                        styles.problemDescription
                      }
                    >
                      {problemDescription}
                    </Text>
                  </View>

                  <Feather
                    name="chevron-right"
                    size={
                      22
                    }
                    color="#6f737d"
                  />
                </TouchableOpacity>
              );
            }
          )}
        </View>

        {/* Privacy note */}

        <View
          style={
            styles.privacyCard
          }
        >
          <View
            style={
              styles.privacyIcon
            }
          >
            <Feather
              name="shield"
              size={
                18
              }
              color="#f1d8c2"
            />
          </View>

          <Text
            style={
              styles.privacyText
            }
          >
            {privacyMessage}
          </Text>
        </View>
      </ScrollView>

      {/* Submission result */}

      <Modal
        visible={
          submissionResult !==
            null
        }
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={
          closeResult
        }
      >
        <View
          style={
            styles.modalBackdrop
          }
        >
          <View
            style={
              styles.resultCard
            }
          >
            <View
              style={[
                styles.resultIcon,

                !submissionSucceeded &&
                  styles.resultErrorIcon,
              ]}
            >
              <Feather
                name={
                  submissionSucceeded
                    ? 'check'
                    : 'alert-circle'
                }
                size={
                  33
                }
                color={
                  submissionSucceeded
                    ? '#f1d8c2'
                    : '#ff7b7b'
                }
              />
            </View>

            <Text
              style={
                styles.resultTitle
              }
            >
              {submissionSucceeded
                ? successTitle
                : translateWithFallback(
                    'common.error',
                    'Something went wrong'
                  )}
            </Text>

            {submittedProblemTitle ? (
              <View
                style={
                  styles.reportedProblemBadge
                }
              >
                <Text
                  numberOfLines={
                    2
                  }
                  style={
                    styles.reportedProblemText
                  }
                >
                  {submittedProblemTitle}
                </Text>
              </View>
            ) : null}

            <Text
              style={
                styles.resultDescription
              }
            >
              {resultDescription}
            </Text>

            {submissionSucceeded ? (
              <>
                <View
                  style={
                    styles.giftCard
                  }
                >
                  <Feather
                    name="gift"
                    size={
                      21
                    }
                    color="#f1d8c2"
                  />

                  <Text
                    style={
                      styles.giftText
                    }
                  >
                    {giftMessage}
                  </Text>
                </View>

                {submissionResult
                  ?.alreadyReported ? (
                  <Text
                    style={
                      styles.alreadyReportedText
                    }
                  >
                    {translateWithFallback(
                      'issueReport.alreadyReported',
                      'You had already reported this problem. Your report remains recorded and will not be counted twice.'
                    )}
                  </Text>
                ) : null}
              </>
            ) : null}

            <TouchableOpacity
              accessibilityRole="button"
              activeOpacity={
                0.86
              }
              style={
                styles.resultButton
              }
              onPress={
                closeResult
              }
            >
              <Text
                style={
                  styles.resultButtonText
                }
              >
                {closeButtonText}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

/* =========================================================
 * Styles
 * ======================================================= */

const styles =
  StyleSheet.create({
    screen: {
      flex:
        1,

      backgroundColor:
        '#07090d',
    },

    scrollView: {
      flex:
        1,
    },

    content: {
      paddingHorizontal:
        22,

      paddingTop:
        58,

      paddingBottom:
        48,
    },

    header: {
      flexDirection:
        'row',

      alignItems:
        'center',

      justifyContent:
        'space-between',

      marginBottom:
        25,
    },

    backButton: {
      width:
        46,

      height:
        46,

      alignItems:
        'center',

      justifyContent:
        'center',

      borderWidth:
        1,

      borderColor:
        '#292c33',

      borderRadius:
        18,

      backgroundColor:
        '#17191e',
    },

    headerIcon: {
      width:
        46,

      height:
        46,

      alignItems:
        'center',

      justifyContent:
        'center',

      borderWidth:
        1,

      borderColor:
        'rgba(241, 216, 194, 0.22)',

      borderRadius:
        18,

      backgroundColor:
        'rgba(241, 216, 194, 0.08)',
    },

    title: {
      color:
        '#FFFFFF',

      fontSize:
        34,

      lineHeight:
        42,

      fontWeight:
        '900',

      letterSpacing:
        -0.7,
    },

    subtitle: {
      maxWidth:
        390,

      marginTop:
        10,

      marginBottom:
        26,

      color:
        '#9296a0',

      fontSize:
        15,

      lineHeight:
        23,

      fontWeight:
        '600',
    },

    problemList: {
      overflow:
        'hidden',

      borderWidth:
        1,

      borderColor:
        '#252830',

      borderRadius:
        28,

      backgroundColor:
        '#111318',
    },

    problemButton: {
      minHeight:
        105,

      flexDirection:
        'row',

      alignItems:
        'center',

      paddingHorizontal:
        17,

      paddingVertical:
        17,

      borderBottomWidth:
        1,

      borderBottomColor:
        '#252830',
    },

    lastProblemButton: {
      borderBottomWidth:
        0,
    },

    problemButtonDisabled: {
      opacity:
        0.6,
    },

    problemButtonSubmitting: {
      backgroundColor:
        'rgba(241, 216, 194, 0.05)',
    },

    problemIconContainer: {
      width:
        46,

      height:
        46,

      alignItems:
        'center',

      justifyContent:
        'center',

      flexShrink:
        0,

      borderWidth:
        1,

      borderColor:
        'rgba(241, 216, 194, 0.17)',

      borderRadius:
        17,

      backgroundColor:
        '#1b1e24',
    },

    problemTextContainer: {
      flex:
        1,

      paddingHorizontal:
        14,
    },

    problemTitle: {
      color:
        '#FFFFFF',

      fontSize:
        16,

      lineHeight:
        21,

      fontWeight:
        '900',
    },

    problemDescription: {
      marginTop:
        5,

      color:
        '#858995',

      fontSize:
        12,

      lineHeight:
        18,

      fontWeight:
        '600',
    },

    privacyCard: {
      flexDirection:
        'row',

      alignItems:
        'flex-start',

      marginTop:
        20,

      paddingHorizontal:
        16,

      paddingVertical:
        16,

      borderWidth:
        1,

      borderColor:
        'rgba(241, 216, 194, 0.15)',

      borderRadius:
        20,

      backgroundColor:
        'rgba(241, 216, 194, 0.045)',
    },

    privacyIcon: {
      width:
        34,

      height:
        34,

      alignItems:
        'center',

      justifyContent:
        'center',

      marginRight:
        12,

      borderRadius:
        13,

      backgroundColor:
        'rgba(241, 216, 194, 0.08)',
    },

    privacyText: {
      flex:
        1,

      color:
        '#8f929a',

      fontSize:
        12,

      lineHeight:
        19,

      fontWeight:
        '600',
    },

    modalBackdrop: {
      flex:
        1,

      alignItems:
        'center',

      justifyContent:
        'center',

      paddingHorizontal:
        23,

      paddingVertical:
        42,

      backgroundColor:
        'rgba(0, 0, 0, 0.84)',
    },

    resultCard: {
      width:
        '100%',

      maxWidth:
        390,

      alignItems:
        'center',

      paddingHorizontal:
        24,

      paddingTop:
        29,

      paddingBottom:
        23,

      borderWidth:
        1,

      borderColor:
        'rgba(241, 216, 194, 0.28)',

      borderRadius:
        29,

      backgroundColor:
        '#121419',
    },

    resultIcon: {
      width:
        70,

      height:
        70,

      alignItems:
        'center',

      justifyContent:
        'center',

      borderWidth:
        1,

      borderColor:
        'rgba(241, 216, 194, 0.5)',

      borderRadius:
        35,

      backgroundColor:
        'rgba(241, 216, 194, 0.09)',
    },

    resultErrorIcon: {
      borderColor:
        'rgba(255, 123, 123, 0.45)',

      backgroundColor:
        'rgba(255, 123, 123, 0.08)',
    },

    resultTitle: {
      marginTop:
        21,

      color:
        '#FFFFFF',

      fontSize:
        23,

      lineHeight:
        30,

      fontWeight:
        '900',

      textAlign:
        'center',
    },

    reportedProblemBadge: {
      maxWidth:
        '100%',

      marginTop:
        14,

      paddingHorizontal:
        13,

      paddingVertical:
        8,

      borderWidth:
        1,

      borderColor:
        '#2d3038',

      borderRadius:
        14,

      backgroundColor:
        '#191b21',
    },

    reportedProblemText: {
      color:
        '#d5d6da',

      fontSize:
        12,

      lineHeight:
        17,

      fontWeight:
        '700',

      textAlign:
        'center',
    },

    resultDescription: {
      marginTop:
        16,

      color:
        '#a7aab2',

      fontSize:
        14,

      lineHeight:
        22,

      textAlign:
        'center',
    },

    giftCard: {
      width:
        '100%',

      flexDirection:
        'row',

      alignItems:
        'center',

      marginTop:
        19,

      paddingHorizontal:
        15,

      paddingVertical:
        14,

      borderWidth:
        1,

      borderColor:
        'rgba(241, 216, 194, 0.18)',

      borderRadius:
        18,

      backgroundColor:
        'rgba(241, 216, 194, 0.055)',
    },

    giftText: {
      flex:
        1,

      marginLeft:
        12,

      color:
        '#d7c4b2',

      fontSize:
        12,

      lineHeight:
        19,

      fontWeight:
        '700',
    },

    alreadyReportedText: {
      marginTop:
        14,

      color:
        '#858995',

      fontSize:
        11,

      lineHeight:
        17,

      textAlign:
        'center',
    },

    resultButton: {
      width:
        '100%',

      minHeight:
        54,

      alignItems:
        'center',

      justifyContent:
        'center',

      marginTop:
        23,

      paddingHorizontal:
        18,

      borderRadius:
        18,

      backgroundColor:
        '#f1d8c2',
    },

    resultButtonText: {
      color:
        '#111111',

      fontSize:
        16,

      fontWeight:
        '900',
    },
  });