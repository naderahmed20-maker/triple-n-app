import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  getImageBatchStatus,
  ImageBatchStatus,
} from '@/lib/cleanImageService';

import {
  useTranslation,
} from '@/lib/i18n';

import {
  router,
  useFocusEffect,
  useLocalSearchParams,
} from 'expo-router';

import {
  useCallback,
  useMemo,
  useState,
} from 'react';

import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

const ACTIVE_IMAGE_BATCH_KEY =
  'ACTIVE_IMAGE_BATCH';

const POLL_INTERVAL_MS =
  3_000;

type StoredImageBatch = {
  batchId: string;

  total?: number;

  uploaded?: number;

  failedUploads?: number;

  createdAt?: number;
};

function getFirstParam(
  value:
    | string
    | string[]
    | undefined
) {
  if (
    Array.isArray(value)
  ) {
    return (
      value[0] ||
      ''
    );
  }

  return value || '';
}

function isFinishedStatus(
  status:
    ImageBatchStatus['status']
) {
  return (
    status ===
      'completed' ||
    status ===
      'completed_with_errors' ||
    status ===
      'failed' ||
    status ===
      'cancelled'
  );
}

export default function ProcessingImageScreen() {
  const {
    t,
  } = useTranslation();

  const params =
    useLocalSearchParams<{
      batchId?:
        | string
        | string[];

      total?:
        | string
        | string[];
    }>();

  const paramBatchId =
    getFirstParam(
      params.batchId
    );

  const paramTotal =
    Number(
      getFirstParam(
        params.total
      )
    ) || 0;

  const [
    batchId,
    setBatchId,
  ] = useState(
    paramBatchId
  );

  const [
    batchStatus,
    setBatchStatus,
  ] =
    useState<ImageBatchStatus | null>(
      null
    );

  const [
    loading,
    setLoading,
  ] = useState(true);

  const [
    refreshing,
    setRefreshing,
  ] = useState(false);

  const [
    errorMessage,
    setErrorMessage,
  ] = useState('');

  const [
    missingBatch,
    setMissingBatch,
  ] = useState(false);

  const totalImages =
    batchStatus
      ?.total_images ||
    paramTotal ||
    0;

  const completedImages =
    batchStatus
      ?.completed_images ||
    0;

  const failedImages =
    batchStatus
      ?.failed_images ||
    0;

  const cancelledImages =
    batchStatus
      ?.cancelled_images ||
    0;

  const finishedImages =
    Math.min(
      totalImages ||
        completedImages +
          failedImages +
          cancelledImages,

      completedImages +
        failedImages +
        cancelledImages
    );

  const progress =
    Math.max(
      0,
      Math.min(
        100,
        batchStatus
          ?.progress ||
          (totalImages > 0
            ? Math.round(
                (
                  finishedImages /
                  totalImages
                ) *
                  100
              )
            : 0)
      )
    );

  const finished =
    batchStatus
      ? isFinishedStatus(
          batchStatus.status
        )
      : false;

  const statusTitle =
    useMemo(() => {
      if (
        batchStatus?.status ===
        'completed'
      ) {
        return t(
          'processingImage.wardrobeReady'
        );
      }

      if (
        batchStatus?.status ===
        'completed_with_errors'
      ) {
        return t(
          'processingImage.processingCompleted'
        );
      }

      if (
        batchStatus?.status ===
        'failed'
      ) {
        return t(
          'processingImage.processingFailed'
        );
      }

      if (
        batchStatus?.status ===
        'cancelled'
      ) {
        return t(
          'processingImage.processingCancelled'
        );
      }

      if (
        batchStatus?.status ===
        'uploading'
      ) {
        return t(
          'processingImage.uploadingPhotos'
        );
      }

      return t(
        'processingImage.preparingClothing'
      );
    }, [
      batchStatus?.status,
      t,
    ]);

  const statusSubtitle =
    useMemo(() => {
      if (
        batchStatus?.status ===
        'completed'
      ) {
        return `${completedImages} ${t(
          'processingImage.itemsAdded'
        )}`;
      }

      if (
        batchStatus?.status ===
        'completed_with_errors'
      ) {
        return `${completedImages} ${t(
          'processingImage.completed'
        )} ${t(
          'processingImage.and'
        )} ${failedImages} ${t(
          'processingImage.failedLowercase'
        )}.`;
      }

      if (
        batchStatus?.status ===
        'failed'
      ) {
        return t(
          'processingImage.photosCouldNotBeProcessed'
        );
      }

      if (
        batchStatus?.status ===
        'cancelled'
      ) {
        return t(
          'processingImage.uploadCancelled'
        );
      }

      return t(
        'processingImage.removingBackground'
      );
    }, [
      batchStatus?.status,
      completedImages,
      failedImages,
      t,
    ]);

  const remainingImages =
    Math.max(
      0,
      totalImages -
        finishedImages
    );

  async function loadStoredBatch() {
    const storedValue =
      await AsyncStorage.getItem(
        ACTIVE_IMAGE_BATCH_KEY
      );

    if (!storedValue) {
      return null;
    }

    try {
      const parsed =
        JSON.parse(
          storedValue
        ) as StoredImageBatch;

      if (
        !parsed.batchId ||
        typeof parsed.batchId !==
          'string'
      ) {
        return null;
      }

      return parsed;
    } catch {
      await AsyncStorage.removeItem(
        ACTIVE_IMAGE_BATCH_KEY
      );

      return null;
    }
  }

  async function clearStoredBatch(
    expectedBatchId?: string
  ) {
    try {
      const stored =
        await loadStoredBatch();

      if (
        expectedBatchId &&
        stored?.batchId &&
        stored.batchId !==
          expectedBatchId
      ) {
        return;
      }

      await AsyncStorage.removeItem(
        ACTIVE_IMAGE_BATCH_KEY
      );
    } catch (
      error
    ) {
      console.warn(
        'CLEAR IMAGE BATCH ERROR:',
        error
      );
    }
  }

  async function resolveBatchId() {
    if (batchId) {
      return batchId;
    }

    if (paramBatchId) {
      setBatchId(
        paramBatchId
      );

      return paramBatchId;
    }

    const stored =
      await loadStoredBatch();

    if (
      stored?.batchId
    ) {
      setBatchId(
        stored.batchId
      );

      return stored.batchId;
    }

    return '';
  }

  async function refreshStatus(
    currentBatchId: string,
    showLoader = false
  ) {
    if (
      !currentBatchId
    ) {
      return null;
    }

    if (showLoader) {
      setRefreshing(true);
    }

    try {
      const status =
        await getImageBatchStatus(
          currentBatchId
        );

      setBatchStatus(
        status
      );

      setErrorMessage('');

      if (
        isFinishedStatus(
          status.status
        )
      ) {
        await clearStoredBatch(
          currentBatchId
        );
      }

      return status;
    } catch (
      error: unknown
    ) {
      const message =
        error instanceof Error
          ? error.message
          : t(
              'processingImage.readStatusError'
            );

      setErrorMessage(
        message
      );

      return null;
    } finally {
      if (showLoader) {
        setRefreshing(false);
      }
    }
  }

  useFocusEffect(
    useCallback(() => {
      let active = true;

      let pollTimer:
        ReturnType<
          typeof setInterval
        > | null = null;

      async function startTracking() {
        setLoading(true);
        setMissingBatch(false);
        setErrorMessage('');

        try {
          const resolvedBatchId =
            await resolveBatchId();

          if (
            !active
          ) {
            return;
          }

          if (
            !resolvedBatchId
          ) {
            setMissingBatch(true);
            setLoading(false);

            return;
          }

          const firstStatus =
            await refreshStatus(
              resolvedBatchId
            );

          if (
            !active
          ) {
            return;
          }

          setLoading(false);

          if (
            firstStatus &&
            isFinishedStatus(
              firstStatus.status
            )
          ) {
            return;
          }

          pollTimer =
            setInterval(
              () => {
                if (
                  !active
                ) {
                  return;
                }

                void refreshStatus(
                  resolvedBatchId
                ).then(
                  (
                    status
                  ) => {
                    if (
                      status &&
                      isFinishedStatus(
                        status.status
                      ) &&
                      pollTimer
                    ) {
                      clearInterval(
                        pollTimer
                      );

                      pollTimer =
                        null;
                    }
                  }
                );
              },
              POLL_INTERVAL_MS
            );
        } catch (
          error: unknown
        ) {
          if (
            !active
          ) {
            return;
          }

          const message =
            error instanceof Error
              ? error.message
              : t(
                  'processingImage.genericError'
                );

          setErrorMessage(
            message
          );

          setLoading(false);
        }
      }

      void startTracking();

      return () => {
        active = false;

        if (
          pollTimer
        ) {
          clearInterval(
            pollTimer
          );
        }
      };
    }, [
      batchId,
      paramBatchId,
      t,
    ])
  );

  function openWardrobe() {
    router.replace(
      '/wardrobe' as any
    );
  }

  function leaveProcessing() {
    router.replace(
      '/wardrobe' as any
    );
  }

  function retryStatus() {
    void resolveBatchId()
      .then(
        (
          resolvedBatchId
        ) => {
          if (
            !resolvedBatchId
          ) {
            setMissingBatch(
              true
            );

            return;
          }

          void refreshStatus(
            resolvedBatchId,
            true
          );
        }
      );
  }

  function clearAndReturn() {
    Alert.alert(
      t(
        'processingImage.removeUploadTitle'
      ),

      t(
        'processingImage.removeUploadMessage'
      ),

      [
        {
          text:
            t(
              'common.cancel'
            ),

          style:
            'cancel',
        },

        {
          text:
            t(
              'processingImage.remove'
            ),

          style:
            'destructive',

          onPress: () => {
            void clearStoredBatch(
              batchId ||
                paramBatchId
            ).finally(
              () => {
                router.replace(
                  '/wardrobe' as any
                );
              }
            );
          },
        },
      ]
    );
  }

  if (
    loading
  ) {
    return (
      <View
        style={
          styles.container
        }
      >
        <ActivityIndicator
          size="large"
          color="#f4dfc8"
        />

        <Text
          style={
            styles.title
          }
        >
          {t(
            'processingImage.loadingProgress'
          )}
        </Text>

        <Text
          style={
            styles.subtitle
          }
        >
          {t(
            'processingImage.pleaseWait'
          )}
        </Text>
      </View>
    );
  }

  if (
    missingBatch
  ) {
    return (
      <View
        style={
          styles.container
        }
      >
        <View
          style={
            styles.statusIcon
          }
        >
          <Text
            style={
              styles.statusIconText
            }
          >
            !
          </Text>
        </View>

        <Text
          style={
            styles.title
          }
        >
          {t(
            'processingImage.noActiveUpload'
          )}
        </Text>

        <Text
          style={
            styles.subtitle
          }
        >
          {t(
            'processingImage.noBatchFound'
          )}
        </Text>

        <TouchableOpacity
          style={
            styles.primaryButton
          }
          onPress={
            openWardrobe
          }
        >
          <Text
            style={
              styles.primaryButtonText
            }
          >
            {t(
              'processingImage.openWardrobe'
            )}
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View
      style={
        styles.container
      }
    >
      <View
        style={
          styles.topBar
        }
      >
        <TouchableOpacity
          style={
            styles.closeButton
          }
          onPress={
            leaveProcessing
          }
        >
          <Text
            style={
              styles.closeButtonText
            }
          >
            ×
          </Text>
        </TouchableOpacity>
      </View>

      <View
        style={
          styles.content
        }
      >
        {finished ? (
          <View
            style={[
              styles.statusIcon,

              batchStatus
                ?.status ===
                'failed' &&
                styles.failedIcon,
            ]}
          >
            <Text
              style={
                styles.statusIconText
              }
            >
              {batchStatus
                ?.status ===
                'failed'
                ? '!'
                : '✓'}
            </Text>
          </View>
        ) : (
          <ActivityIndicator
            size="large"
            color="#f4dfc8"
          />
        )}

        <Text
          style={
            styles.title
          }
        >
          {statusTitle}
        </Text>

        <Text
          style={
            styles.subtitle
          }
        >
          {statusSubtitle}
        </Text>

        <View
          style={
            styles.progressCard
          }
        >
          <View
            style={
              styles.progressHeader
            }
          >
            <Text
              style={
                styles.progressLabel
              }
            >
              {t(
                'processingImage.progress'
              )}
            </Text>

            <Text
              style={
                styles.progressPercent
              }
            >
              {progress}%
            </Text>
          </View>

          <View
            style={
              styles.progressTrack
            }
          >
            <View
              style={[
                styles.progressFill,

                {
                  width:
                    `${progress}%`,
                },
              ]}
            />
          </View>

          <Text
            style={
              styles.progressText
            }
          >
            {finishedImages} /{' '}
            {totalImages}{' '}
            {t(
              'processingImage.photosFinished'
            )}
          </Text>
        </View>

        <View
          style={
            styles.statsRow
          }
        >
          <View
            style={
              styles.statCard
            }
          >
            <Text
              style={
                styles.statNumber
              }
            >
              {completedImages}
            </Text>

            <Text
              style={
                styles.statLabel
              }
            >
              {t(
                'processingImage.ready'
              )}
            </Text>
          </View>

          <View
            style={
              styles.statCard
            }
          >
            <Text
              style={
                styles.statNumber
              }
            >
              {remainingImages}
            </Text>

            <Text
              style={
                styles.statLabel
              }
            >
              {t(
                'processingImage.remaining'
              )}
            </Text>
          </View>

          <View
            style={
              styles.statCard
            }
          >
            <Text
              style={[
                styles.statNumber,

                failedImages >
                  0 &&
                  styles.failedNumber,
              ]}
            >
              {failedImages}
            </Text>

            <Text
              style={
                styles.statLabel
              }
            >
              {t(
                'processingImage.failed'
              )}
            </Text>
          </View>
        </View>

        {errorMessage ? (
          <View
            style={
              styles.errorBox
            }
          >
            <Text
              style={
                styles.errorText
              }
            >
              {errorMessage}
            </Text>

            <TouchableOpacity
              onPress={
                retryStatus
              }
              disabled={
                refreshing
              }
            >
              <Text
                style={
                  styles.retryText
                }
              >
                {refreshing
                  ? t(
                      'processingImage.refreshing'
                    )
                  : t(
                      'common.retry'
                    )}
              </Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {!finished ? (
          <View
            style={
              styles.backgroundNote
            }
          >
            <Text
              style={
                styles.backgroundNoteTitle
              }
            >
              {t(
                'processingImage.canLeaveScreen'
              )}
            </Text>

            <Text
              style={
                styles.backgroundNoteText
              }
            >
              {t(
                'processingImage.workerContinues'
              )}
            </Text>
          </View>
        ) : null}
      </View>

      <View
        style={
          styles.bottomActions
        }
      >
        {finished ? (
          <TouchableOpacity
            style={
              styles.primaryButton
            }
            onPress={
              openWardrobe
            }
          >
            <Text
              style={
                styles.primaryButtonText
              }
            >
              {t(
                'processingImage.openWardrobe'
              )}
            </Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={
              styles.secondaryButton
            }
            onPress={
              leaveProcessing
            }
          >
            <Text
              style={
                styles.secondaryButtonText
              }
            >
              {t(
                'processingImage.continueInBackground'
              )}
            </Text>
          </TouchableOpacity>
        )}

        {finished &&
        batchStatus?.status !==
          'completed' ? (
          <TouchableOpacity
            style={
              styles.removeButton
            }
            onPress={
              clearAndReturn
            }
          >
            <Text
              style={
                styles.removeButtonText
              }
            >
              {t(
                'common.close'
              )}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

const styles =
  StyleSheet.create({
    container: {
      flex: 1,

      backgroundColor:
        '#07090d',

      paddingHorizontal: 22,

      paddingTop: 55,

      paddingBottom: 28,
    },

    topBar: {
      minHeight: 52,

      alignItems:
        'flex-end',
    },

    closeButton: {
      width: 48,

      height: 48,

      borderRadius: 17,

      backgroundColor:
        '#15171c',

      alignItems:
        'center',

      justifyContent:
        'center',

      borderWidth: 1,

      borderColor:
        '#252a31',
    },

    closeButtonText: {
      color: '#fff',

      fontSize: 35,

      lineHeight: 38,

      fontWeight: '500',
    },

    content: {
      flex: 1,

      justifyContent:
        'center',

      alignItems:
        'center',
    },

    statusIcon: {
      width: 74,

      height: 74,

      borderRadius: 37,

      backgroundColor:
        '#f4dfc8',

      alignItems:
        'center',

      justifyContent:
        'center',
    },

    failedIcon: {
      backgroundColor:
        '#3a171b',
    },

    statusIconText: {
      color: '#111',

      fontSize: 38,

      fontWeight: '900',
    },

    title: {
      color: '#fff',

      fontSize: 25,

      fontWeight: '900',

      textAlign:
        'center',

      marginTop: 24,
    },

    subtitle: {
      color: '#a5a8ae',

      textAlign:
        'center',

      marginTop: 12,

      fontSize: 15,

      lineHeight: 23,

      maxWidth: 340,
    },

    progressCard: {
      width: '100%',

      backgroundColor:
        '#15171c',

      borderRadius: 22,

      borderWidth: 1,

      borderColor:
        '#252a31',

      padding: 18,

      marginTop: 30,
    },

    progressHeader: {
      flexDirection:
        'row',

      justifyContent:
        'space-between',

      alignItems:
        'center',
    },

    progressLabel: {
      color: '#fff',

      fontSize: 15,

      fontWeight: '900',
    },

    progressPercent: {
      color: '#f4dfc8',

      fontSize: 18,

      fontWeight: '900',
    },

    progressTrack: {
      height: 12,

      borderRadius: 6,

      backgroundColor:
        '#292c33',

      overflow:
        'hidden',

      marginTop: 14,
    },

    progressFill: {
      height: '100%',

      borderRadius: 6,

      backgroundColor:
        '#f4dfc8',
    },

    progressText: {
      color: '#8d9199',

      fontSize: 13,

      fontWeight: '700',

      marginTop: 12,

      textAlign:
        'center',
    },

    statsRow: {
      width: '100%',

      flexDirection:
        'row',

      gap: 10,

      marginTop: 12,
    },

    statCard: {
      flex: 1,

      minHeight: 88,

      borderRadius: 18,

      backgroundColor:
        '#15171c',

      borderWidth: 1,

      borderColor:
        '#252a31',

      alignItems:
        'center',

      justifyContent:
        'center',

      paddingHorizontal: 6,
    },

    statNumber: {
      color: '#fff',

      fontSize: 22,

      fontWeight: '900',
    },

    failedNumber: {
      color: '#ff8f98',
    },

    statLabel: {
      color: '#858991',

      fontSize: 11,

      fontWeight: '800',

      textAlign:
        'center',

      marginTop: 5,
    },

    errorBox: {
      width: '100%',

      backgroundColor:
        '#241317',

      borderRadius: 18,

      borderWidth: 1,

      borderColor:
        '#51262d',

      padding: 14,

      marginTop: 14,

      alignItems:
        'center',
    },

    errorText: {
      color: '#ffb3ba',

      textAlign:
        'center',

      fontSize: 13,

      lineHeight: 19,
    },

    retryText: {
      color: '#f4dfc8',

      fontWeight: '900',

      marginTop: 10,
    },

    backgroundNote: {
      width: '100%',

      borderRadius: 18,

      backgroundColor:
        '#111318',

      borderWidth: 1,

      borderColor:
        '#20232a',

      padding: 15,

      marginTop: 14,
    },

    backgroundNoteTitle: {
      color: '#f4dfc8',

      fontSize: 13,

      fontWeight: '900',

      textAlign:
        'center',
    },

    backgroundNoteText: {
      color: '#777c85',

      fontSize: 12,

      lineHeight: 18,

      textAlign:
        'center',

      marginTop: 5,
    },

    bottomActions: {
      width: '100%',
    },

    primaryButton: {
      width: '100%',

      minHeight: 58,

      borderRadius: 29,

      backgroundColor:
        '#f4dfc8',

      alignItems:
        'center',

      justifyContent:
        'center',

      paddingHorizontal: 20,

      marginTop: 28,
    },

    primaryButtonText: {
      color: '#111',

      fontSize: 17,

      fontWeight: '900',
    },

    secondaryButton: {
      width: '100%',

      minHeight: 58,

      borderRadius: 29,

      backgroundColor:
        '#15171c',

      borderWidth: 1,

      borderColor:
        '#353941',

      alignItems:
        'center',

      justifyContent:
        'center',

      paddingHorizontal: 20,
    },

    secondaryButtonText: {
      color: '#fff',

      fontSize: 16,

      fontWeight: '900',
    },

    removeButton: {
      alignItems:
        'center',

      justifyContent:
        'center',

      paddingVertical: 14,
    },

    removeButtonText: {
      color: '#8b8f97',

      fontSize: 14,

      fontWeight: '800',
    },
  });