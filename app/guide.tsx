import {
    router,
} from 'expo-router';

import {
    StatusBar,
} from 'expo-status-bar';

import {
    useRef,
    useState,
} from 'react';

import {
    ActivityIndicator,
    Alert,
    FlatList,
    Image,
    ImageSourcePropType,
    NativeScrollEvent,
    NativeSyntheticEvent,
    StyleSheet,
    Text,
    TouchableOpacity,
    useWindowDimensions,
    View,
} from 'react-native';

import {
    SafeAreaView,
} from 'react-native-safe-area-context';

import {
    markGuideCompleted,
} from '@/lib/guideService';

type GuideSlide = {
  id:
    string;

  image:
    ImageSourcePropType;
};

const GUIDE_SLIDES:
  GuideSlide[] = [
  {
    id:
      'guide-1',

    image:
      require(
        '../assets/onboarding-guide/guide-1.png'
      ),
  },

  {
    id:
      'guide-2',

    image:
      require(
        '../assets/onboarding-guide/guide-2.png'
      ),
  },

  {
    id:
      'guide-3',

    image:
      require(
        '../assets/onboarding-guide/guide-3.png'
      ),
  },

  {
    id:
      'guide-4',

    image:
      require(
        '../assets/onboarding-guide/guide-4.png'
      ),
  },
];

export default function GuideScreen() {
  const {
    width,
  } =
    useWindowDimensions();

  const listRef =
    useRef<
      FlatList<GuideSlide>
    >(
      null
    );

  const [
    currentIndex,
    setCurrentIndex,
  ] =
    useState(
      0
    );

  const [
    finishing,
    setFinishing,
  ] =
    useState(
      false
    );

  const isLastSlide =
    currentIndex ===
    GUIDE_SLIDES.length -
      1;

  const finishGuide =
    async () => {
      if (
        finishing
      ) {
        return;
      }

      setFinishing(
        true
      );

      try {
        /*
         * نسجل أولًا أن المستخدم
         * أنهى أو تخطى الشرح.
         *
         * guideService سيخبر
         * RootLayout فورًا.
         */
        await markGuideCompleted();

        /*
         * نذهب للـLogin.
         *
         * لو المستخدم لديه Session
         * بالفعل، الـRoot guard الحالي
         * سيحوله تلقائيًا إلى المكان
         * الصحيح.
         */
        router.replace(
          '/login' as never
        );
      } catch (error) {
        console.log(
          'GUIDE COMPLETION ERROR:',
          error
        );

        setFinishing(
          false
        );

        Alert.alert(
          'Please try again',
          'Triple N could not save your tutorial progress.'
        );
      }
    };

  const goNext =
    () => {
      if (
        isLastSlide
      ) {
        void finishGuide();

        return;
      }

      const nextIndex =
        currentIndex +
        1;

      listRef.current
        ?.scrollToIndex({
          index:
            nextIndex,

          animated:
            true,
        });
    };

  const handleMomentumScrollEnd =
    (
      event:
        NativeSyntheticEvent<NativeScrollEvent>
    ) => {
      const offsetX =
        event.nativeEvent
          .contentOffset.x;

      const nextIndex =
        Math.round(
          offsetX /
            width
        );

      if (
        nextIndex >=
          0 &&
        nextIndex <
          GUIDE_SLIDES.length
      ) {
        setCurrentIndex(
          nextIndex
        );
      }
    };

  return (
    <SafeAreaView
      edges={[
        'top',
        'bottom',
      ]}
      style={
        styles.container
      }
    >
      <StatusBar
        style="light"
      />

      <View
        style={
          styles.topBar
        }
      >
        <View
          style={
            styles.topSpacer
          }
        />

        <Text
          style={
            styles.title
          }
        >
          QUICK GUIDE
        </Text>

        <TouchableOpacity
          activeOpacity={
            0.7
          }
          disabled={
            finishing
          }
          style={
            styles.skipButton
          }
          onPress={() => {
            void finishGuide();
          }}
        >
          {finishing ? (
            <ActivityIndicator
              size="small"
              color="#f1d5bd"
            />
          ) : (
            <Text
              style={
                styles.skipText
              }
            >
              Skip
            </Text>
          )}
        </TouchableOpacity>
      </View>

      <FlatList
        ref={
          listRef
        }
        data={
          GUIDE_SLIDES
        }
        horizontal
        pagingEnabled
        bounces={
          false
        }
        showsHorizontalScrollIndicator={
          false
        }
        keyExtractor={
          item =>
            item.id
        }
        onMomentumScrollEnd={
          handleMomentumScrollEnd
        }
        getItemLayout={(
          _data,
          index
        ) => ({
          length:
            width,

          offset:
            width *
            index,

          index,
        })}
        renderItem={({
          item,
        }) => (
          <View
            style={[
              styles.slide,
              {
                width,
              },
            ]}
          >
            <Image
              source={
                item.image
              }
              resizeMode="contain"
              style={
                styles.guideImage
              }
            />
          </View>
        )}
      />

      <View
        style={
          styles.bottomArea
        }
      >
        <View
          style={
            styles.dotsContainer
          }
        >
          {GUIDE_SLIDES.map(
            (
              slide,
              index
            ) => (
              <View
                key={
                  slide.id
                }
                style={[
                  styles.dot,

                  index ===
                    currentIndex &&
                    styles.activeDot,
                ]}
              />
            )
          )}
        </View>

        <TouchableOpacity
          activeOpacity={
            0.85
          }
          disabled={
            finishing
          }
          style={[
            styles.nextButton,

            finishing &&
              styles
                .nextButtonDisabled,
          ]}
          onPress={
            goNext
          }
        >
          {finishing ? (
            <ActivityIndicator
              size="small"
              color="#090909"
            />
          ) : (
            <Text
              style={
                styles.nextText
              }
            >
              {isLastSlide
                ? 'Get Started'
                : 'Next'}
            </Text>
          )}
        </TouchableOpacity>

        <Text
          style={
            styles.swipeText
          }
        >
          Swipe to continue
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles =
  StyleSheet.create({
    container: {
      flex:
        1,

      backgroundColor:
        '#050607',
    },

    topBar: {
      minHeight:
        54,

      flexDirection:
        'row',

      alignItems:
        'center',

      paddingHorizontal:
        18,
    },

    topSpacer: {
      width:
        64,
    },

    title: {
      flex:
        1,

      color:
        '#f1d5bd',

      fontSize:
        13,

      fontWeight:
        '800',

      letterSpacing:
        2.2,

      textAlign:
        'center',
    },

    skipButton: {
      width:
        64,

      minHeight:
        42,

      alignItems:
        'flex-end',

      justifyContent:
        'center',
    },

    skipText: {
      color:
        '#f1d5bd',

      fontSize:
        15,

      fontWeight:
        '700',
    },

    slide: {
      flex:
        1,

      alignItems:
        'center',

      justifyContent:
        'center',

      paddingHorizontal:
        8,
    },

    guideImage: {
      width:
        '100%',

      height:
        '100%',
    },

    bottomArea: {
      paddingHorizontal:
        22,

      paddingTop:
        12,

      paddingBottom:
        8,
    },

    dotsContainer: {
      height:
        20,

      flexDirection:
        'row',

      alignItems:
        'center',

      justifyContent:
        'center',

      gap:
        7,
    },

    dot: {
      width:
        7,

      height:
        7,

      borderRadius:
        4,

      backgroundColor:
        '#454545',
    },

    activeDot: {
      width:
        23,

      backgroundColor:
        '#f1d5bd',
    },

    nextButton: {
      minHeight:
        54,

      marginTop:
        8,

      alignItems:
        'center',

      justifyContent:
        'center',

      borderRadius:
        18,

      backgroundColor:
        '#f1d5bd',
    },

    nextButtonDisabled: {
      opacity:
        0.7,
    },

    nextText: {
      color:
        '#080808',

      fontSize:
        17,

      fontWeight:
        '800',
    },

    swipeText: {
      marginTop:
        9,

      color:
        '#777777',

      fontSize:
        11,

      textAlign:
        'center',
    },
  });