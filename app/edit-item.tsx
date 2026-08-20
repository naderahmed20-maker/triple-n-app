// app/edit-item.tsx
//
// Triple N - Edit Wardrobe Item
//
// Ã˜ÂªÃ˜Â¹Ã˜Â¯Ã™Å Ã™â€ž Ã˜Â¨Ã™Å Ã˜Â§Ã™â€ Ã˜Â§Ã˜Âª Ã˜Â§Ã™â€žÃ™â€šÃ˜Â·Ã˜Â¹Ã˜Â© Ã™Ë†Ã˜ÂªÃ˜ÂºÃ™Å Ã™Å Ã˜Â± Ã˜ÂµÃ™Ë†Ã˜Â±Ã˜ÂªÃ™â€¡Ã˜Â§.
//
// Ã˜Â¹Ã™â€ Ã˜Â¯ Ã˜ÂªÃ˜ÂºÃ™Å Ã™Å Ã˜Â± Ã˜Â§Ã™â€žÃ˜ÂµÃ™Ë†Ã˜Â±Ã˜Â©:
//
// 1) Ã˜ÂªÃ˜Â¬Ã™â€¡Ã™Å Ã˜Â² Ã™â€ Ã˜Â³Ã˜Â®Ã˜Â© Ã™â€¦Ã˜Â­Ã™â€žÃ™Å Ã˜Â© Ã™â€¦Ã™â€ Ã˜Â§Ã˜Â³Ã˜Â¨Ã˜Â© Ã™â€žÃ™â‚¬EdgeSAM.
// 2) Ã˜Â±Ã™ÂÃ˜Â¹ Ã˜Â§Ã™â€žÃ˜ÂµÃ™Ë†Ã˜Â±Ã˜Â© Ã˜Â§Ã™â€žÃ˜Â£Ã˜ÂµÃ™â€žÃ™Å Ã˜Â© Ã™â€žÃ™â€žÃ˜ÂªÃ˜Â®Ã˜Â²Ã™Å Ã™â€ .
// 3) Ã˜ÂªÃ˜Â­Ã˜Â¯Ã™Å Ã˜Â« Ã˜Â§Ã™â€žÃ™â€šÃ˜Â·Ã˜Â¹Ã˜Â© Ã˜Â¥Ã™â€žÃ™â€° queued.
// 4) Ã˜Â¥Ã™â€ Ã˜Â´Ã˜Â§Ã˜Â¡ Processing Job.
// 5) Ã˜Â¥Ã˜Â¯Ã˜Â®Ã˜Â§Ã™â€ž Ã˜Â§Ã™â€žÃ˜ÂµÃ™Ë†Ã˜Â±Ã˜Â© Ã˜Â¥Ã™â€žÃ™â€° Scan Item Queue.
// 6) EdgeSAM Ã™Å Ã˜Â¹Ã˜Â§Ã™â€žÃ˜Â¬Ã™â€¡Ã˜Â§ Ã™â€¦Ã˜Â­Ã™â€žÃ™Å Ã™â€¹Ã˜Â§.
// 7) LocalScanItemProcessingAdapter Ã™Å Ã˜Â­Ã˜Â¯Ã˜Â« Ã˜Â§Ã™â€žÃ™â€šÃ˜Â·Ã˜Â¹Ã˜Â©
//    Ã˜Â¨Ã˜Â§Ã™â€žÃ˜ÂµÃ™Ë†Ã˜Â±Ã˜Â© Ã˜Â§Ã™â€žÃ˜Â´Ã™ÂÃ˜Â§Ã™ÂÃ˜Â© Ã˜Â§Ã™â€žÃ™â€ Ã™â€¡Ã˜Â§Ã˜Â¦Ã™Å Ã˜Â©.
//
// Summer V1:
//
// - Ã™â€žÃ˜Â§ Ã˜ÂªÃ™Ë†Ã˜Â¬Ã˜Â¯ Jackets.
// - Ã™â€žÃ˜Â§ Ã˜ÂªÃ™Ë†Ã˜Â¬Ã˜Â¯ Ã˜Â£Ã™Å  Ã˜Â¨Ã™Å Ã˜Â§Ã™â€ Ã˜Â§Ã˜Âª Ã˜Â´Ã˜ÂªÃ™Ë†Ã™Å Ã˜Â©.
// - season Ã™Ë†occasion Ã˜Â¯Ã˜Â§Ã˜Â®Ã™â€ž Job Ã˜ÂªÃ™Æ’Ã™Ë†Ã™â€  null.

import {
  useTranslation,
} from '@/lib/i18n';


import {
  getMyWardrobeItems,
  updateWardrobeItem,
  type WardrobeItem,
} from '@/lib/wardrobeService';


import {
  router,
  useLocalSearchParams,
} from 'expo-router';

import {
  useEffect,
  useState,
} from 'react';

import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
} from 'react-native';

/* =========================================================
 * Summer categories
 * ======================================================= */

const CATEGORIES = [
  'Tops',
  'Pants',
  'Shorts',
  'Shoes',
  'Accessories',
] as const;

const COLORS = [
  'Black',
  'White',
  'Blue',
  'Red',
  'Green',
  'Brown',
  'Yellow',
  'Purple',
  'Gray',
  'Beige',
] as const;

type EditableCategory =
  (typeof CATEGORIES)[number];

type EditableColor =
  (typeof COLORS)[number];


/* =========================================================
 * Helpers
 * ======================================================= */

function getUnknownErrorMessage(
  error:
    unknown
): string {
  if (
    error instanceof Error
  ) {
    return error.message;
  }

  if (
    typeof error ===
      'string'
  ) {
    return error;
  }

  try {
    const serialized =
      JSON.stringify(
        error
      );

    if (
      serialized
    ) {
      return serialized;
    }
  } catch {
    // Ã™â€ Ã˜Â³Ã˜ÂªÃ˜Â®Ã˜Â¯Ã™â€¦ String Ã™ÂÃ™Å  Ã˜Â§Ã™â€žÃ™â€ Ã™â€¡Ã˜Â§Ã™Å Ã˜Â©.
  }

  return String(
    error
  );
}

/* =========================================================
 * Screen
 * ======================================================= */

export default function EditItemScreen() {
  const {
    t,
    language,
  } =
    useTranslation();

  const {
    id,
  } =
    useLocalSearchParams<{
      id?:
        | string
        | string[];
    }>();

  const itemId =
    Array.isArray(
      id
    )
      ? id[0]
      : id;

  const [
    loadedItem,
    setLoadedItem,
  ] =
    useState<WardrobeItem | null>(
      null
    );

  const [
    image,
    setImage,
  ] =
    useState(
      ''
    );
const [
    name,
    setName,
  ] =
    useState(
      ''
    );

  const [
    category,
    setCategory,
  ] =
    useState<EditableCategory>(
      'Tops'
    );

  const [
    color,
    setColor,
  ] =
    useState<EditableColor>(
      'Black'
    );

  const [
    loading,
    setLoading,
  ] =
    useState(
      true
    );

  const [
    saving,
    setSaving,
  ] =
    useState(
      false
    );

  /* =======================================================
   * Load item
   * ===================================================== */

  useEffect(() => {
    let active =
      true;

    async function loadItem():
      Promise<void> {
      try {
        if (
          !itemId
        ) {
          router.back();

          return;
        }

        const allItems =
          await getMyWardrobeItems();

        const item =
          allItems.find(
            currentItem =>
              currentItem.id ===
              itemId
          );

        if (
          !item
        ) {
          Alert.alert(
            t(
              'common.error'
            ),
            t(
              'editItem.notFound'
            )
          );

          router.back();

          return;
        }

        if (
          !active
        ) {
          return;
        }

        setLoadedItem(
          item
        );

        setImage(
          item.image ||
          ''
        );
setName(
          item.name ||
          ''
        );
if (
          CATEGORIES.includes(
            item.category as
              EditableCategory
          )
        ) {
          setCategory(
            item.category as
              EditableCategory
          );
        } else {
          /**
           * Ã˜Â£Ã™Å  Jacket Ã™â€šÃ˜Â¯Ã™Å Ã™â€¦Ã˜Â© Ã™â€žÃ™â€  Ã˜ÂªÃ˜Â¨Ã™â€šÃ™â€° Ã™Æ’Ã™ÂÃ˜Â¦Ã˜Â©
           * Ã™â€šÃ˜Â§Ã˜Â¨Ã™â€žÃ˜Â© Ã™â€žÃ™â€žÃ˜Â§Ã˜Â®Ã˜ÂªÃ™Å Ã˜Â§Ã˜Â± Ã˜Â¯Ã˜Â§Ã˜Â®Ã™â€ž Summer V1.
           */
          setCategory(
            'Tops'
          );
        }

        const normalizedColor =
          item.color ===
          'Grey'
            ? 'Gray'
            : item.color;

        if (
          COLORS.includes(
            normalizedColor as
              EditableColor
          )
        ) {
          setColor(
            normalizedColor as
              EditableColor
          );
        } else {
          setColor(
            'Black'
          );
        }
      } catch (error) {
        if (
          !active
        ) {
          return;
        }

        Alert.alert(
          t(
            'common.error'
          ),
          getUnknownErrorMessage(
            error
          ) ||
          t(
            'editItem.loadFailed'
          )
        );

        router.back();
      } finally {
        if (
          active
        ) {
          setLoading(
            false
          );
        }
      }
    }

    void loadItem();

    return () => {
      active =
        false;
    };
  }, [
    itemId,
    t,
  ]);

  /* =======================================================
   * Translations
   * ===================================================== */

  function translateCategory(
    value:
      string
  ): string {
    switch (
      value
    ) {
      case 'Top':
      case 'Tops':
        return t(
          'category.tops'
        );

      case 'Pants':
        return t(
          'category.pants'
        );

      case 'Shorts':
        return t(
          'category.shorts'
        );

      case 'Shoes':
        return t(
          'category.shoes'
        );

      case 'Accessory':
      case 'Accessories':
        return t(
          'category.accessories'
        );

      default:
        return value;
    }
  }

  function translateColor(
    value:
      string
  ): string {
    if (
      language !==
        'Italian'
    ) {
      return value;
    }

    const italianColors:
      Record<
        string,
        string
      > = {
      Black:
        'Nero',

      White:
        'Bianco',

      Blue:
        'Blu',

      Red:
        'Rosso',

      Green:
        'Verde',

      Brown:
        'Marrone',

      Yellow:
        'Giallo',

      Purple:
        'Viola',

      Gray:
        'Grigio',

      Grey:
        'Grigio',

      Beige:
        'Beige',
    };

    return (
      italianColors[
        value
      ] ||
      value
    );
  }


  /* =======================================================
   * Save metadata only
   * ===================================================== */

  async function saveMetadataOnly():
    Promise<void> {
    if (
      !itemId
    ) {
      return;
    }

    const categoryChanged =
      loadedItem?.category !==
      category;

    await updateWardrobeItem(
      itemId,
      {
        name:
          name.trim(),

        category,

        /**
         * Ã™â€žÃ˜Â§ Ã™â€ Ã˜Â­Ã˜ÂªÃ™ÂÃ˜Â¸ Ã˜Â¨Ã™â‚¬subcategory Ã™â€šÃ˜Â¯Ã™Å Ã™â€¦Ã˜Â©
         * Ã˜Â¥Ã˜Â°Ã˜Â§ Ã˜ÂªÃ˜ÂºÃ™Å Ã˜Â±Ã˜Âª Ã˜Â§Ã™â€žÃ™ÂÃ˜Â¦Ã˜Â© Ã˜Â§Ã™â€žÃ˜Â£Ã˜Â³Ã˜Â§Ã˜Â³Ã™Å Ã˜Â©.
         */
        subCategory:
          categoryChanged
            ? null
            : loadedItem
                ?.subCategory ??
              null,

        color,
      }
    );

    router.back();
  }



  /* =======================================================
   * Save
   * ===================================================== */

  async function saveChanges():
    Promise<void> {
    if (
      !itemId ||
      saving
    ) {
      return;
    }

    setSaving(
      true
    );

    try {
      await saveMetadataOnly();
    } catch (error) {
      Alert.alert(
        t(
          'common.error'
        ),
        getUnknownErrorMessage(
          error
        ) ||
        t(
          'outfit.saveFailedMessage'
        )
      );
    } finally {
      setSaving(
        false
      );
    }
  }

/* =======================================================
   * Loading
   * ===================================================== */

  if (
    loading
  ) {
    return (
      <ScrollView
        style={
          styles.container
        }
        contentContainerStyle={
          styles.center
        }
      >
        <ActivityIndicator
          size="large"
          color="#f4dfc8"
        />

        <Text
          style={
            styles.loadingText
          }
        >
          {t(
            'common.loading'
          )}
        </Text>
      </ScrollView>
    );
  }

  /* =======================================================
   * UI
   * ===================================================== */

  return (
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
      keyboardShouldPersistTaps="handled"
    >
      <Text
        style={
          styles.title
        }
      >
        {t(
          'editItem.title'
        )}
      </Text>

      {image !==
      '' ? (
        <Image
          source={{
            uri:
              image,
          }}
          style={
            styles.itemImage
          }
          resizeMode="contain"
        />
      ) : null}


      <Text
        style={
          styles.label
        }
      >
        {t(
          'addItem.itemName'
        )}
      </Text>

      <TextInput
        style={
          styles.input
        }
        placeholder={t(
          'editItem.itemNamePlaceholder'
        )}
        placeholderTextColor="#777"
        value={
          name
        }
        onChangeText={
          setName
        }
        editable={
          !saving
        }
      />

      <Text
        style={
          styles.label
        }
      >
        {t(
          'editItem.chooseCategory'
        )}
      </Text>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={
          false
        }
        style={
          styles.rowScroll
        }
        contentContainerStyle={
          styles.rowContent
        }
      >
        {CATEGORIES.map(
          item => (
            <TouchableOpacity
              key={
                item
              }
              style={[
                styles.categoryButton,

                category ===
                  item &&
                  styles.activeCategory,
              ]}
              onPress={() => {
                setCategory(
                  item
                );
              }}
              disabled={
                saving
              }
            >
              <Text
                style={[
                  styles.categoryText,

                  category ===
                    item &&
                    styles
                      .activeCategoryText,
                ]}
              >
                {translateCategory(
                  item
                )}
              </Text>
            </TouchableOpacity>
          )
        )}
      </ScrollView>

      <Text
        style={
          styles.label
        }
      >
        {t(
          'editItem.chooseColor'
        )}
      </Text>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={
          false
        }
        style={
          styles.rowScroll
        }
        contentContainerStyle={
          styles.rowContent
        }
      >
        {COLORS.map(
          item => (
            <TouchableOpacity
              key={
                item
              }
              style={[
                styles.colorButton,

                color ===
                  item &&
                  styles.activeColor,
              ]}
              onPress={() => {
                setColor(
                  item
                );
              }}
              disabled={
                saving
              }
            >
              <Text
                style={[
                  styles.colorText,

                  color ===
                    item &&
                    styles
                      .activeColorText,
                ]}
              >
                {translateColor(
                  item
                )}
              </Text>
            </TouchableOpacity>
          )
        )}
      </ScrollView>

      <TouchableOpacity
        style={[
          styles.button,

          saving &&
            styles.disabledButton,
        ]}
        onPress={
          saveChanges
        }
        disabled={
          saving
        }
      >
        {saving ? (
          <ActivityIndicator
            color="#111"
          />
        ) : (
          <Text
            style={
              styles.buttonText
            }
          >
            {t(
              'editItem.saveChanges'
            )}
          </Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        style={[
          styles.cancelButton,

          saving &&
            styles.disabledButton,
        ]}
        onPress={() => {
          router.back();
        }}
        disabled={
          saving
        }
      >
        <Text
          style={
            styles.cancelText
          }
        >
          {t(
            'common.cancel'
          )}
        </Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

/* =========================================================
 * Styles
 * ======================================================= */

const styles =
  StyleSheet.create({
    container: {
      flex:
        1,

      backgroundColor:
        '#111',
    },

    center: {
      flexGrow:
        1,

      justifyContent:
        'center',

      alignItems:
        'center',
    },

    loadingText: {
      marginTop:
        12,

      color:
        '#aaa',

      fontSize:
        14,

      fontWeight:
        '700',
    },

    content: {
      padding:
        20,

      paddingTop:
        70,

      paddingBottom:
        40,
    },

    title: {
      marginBottom:
        25,

      color:
        'white',

      fontSize:
        34,

      fontWeight:
        'bold',

      textAlign:
        'center',
    },

    itemImage: {
      width:
        '100%',

      height:
        260,

      marginBottom:
        12,

      borderRadius:
        25,

      backgroundColor:
        '#e5e5e5',
    },


    label: {
      marginBottom:
        12,

      color:
        'white',

      fontSize:
        18,

      fontWeight:
        'bold',
    },

    input: {
      marginBottom:
        25,

      padding:
        15,

      borderWidth:
        1,

      borderColor:
        '#333',

      borderRadius:
        15,

      color:
        'white',

      backgroundColor:
        '#1c1c1c',

      fontSize:
        16,
    },

    rowScroll: {
      marginBottom:
        25,
    },

    rowContent: {
      paddingRight:
        10,
    },

    categoryButton: {
      marginRight:
        10,

      paddingVertical:
        10,

      paddingHorizontal:
        14,

      borderWidth:
        1,

      borderColor:
        '#444',

      borderRadius:
        20,
    },

    activeCategory: {
      backgroundColor:
        'white',
    },

    categoryText: {
      color:
        '#aaa',

      fontSize:
        15,
    },

    activeCategoryText: {
      color:
        '#111',

      fontWeight:
        'bold',
    },

    colorButton: {
      marginRight:
        10,

      paddingVertical:
        10,

      paddingHorizontal:
        14,

      borderWidth:
        1,

      borderColor:
        '#444',

      borderRadius:
        20,

      backgroundColor:
        '#1c1c1c',
    },

    activeColor: {
      backgroundColor:
        '#f59e0b',
    },

    colorText: {
      color:
        '#aaa',

      fontSize:
        15,

      fontWeight:
        'bold',
    },

    activeColorText: {
      color:
        '#111',
    },

    button: {
      marginBottom:
        15,

      padding:
        18,

      borderRadius:
        30,

      alignItems:
        'center',

      backgroundColor:
        '#fff',
    },

    buttonText: {
      color:
        '#111',

      fontSize:
        18,

      fontWeight:
        'bold',
    },

    cancelButton: {
      padding:
        16,

      borderRadius:
        30,

      alignItems:
        'center',

      backgroundColor:
        '#222',
    },

    cancelText: {
      color:
        'white',

      fontSize:
        16,

      fontWeight:
        'bold',
    },

    disabledButton: {
      opacity:
        0.55,
    },
  });
