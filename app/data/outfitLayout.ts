export type OutfitCanvasVariant =
  | 'builder'
  | 'suggestion'
  | 'savedCard'
  | 'details';

export const OUTFIT_LAYOUT = {
  builder: {
    canvas: {
      width: 285,
      height: 420,
    },

    /*
     * الجاكيت:
     * أعلى اليسار ومستقل عن التيشيرت.
     */
    Jackets: {
      top: 8,
      left: 4,
      width: 96,
      height: 92,
      zIndex: 5,
    },

    /*
     * التيشيرت:
     * في المنتصف وفوق البنطلون.
     */
    Tops: {
      top: 40,
      left: 50,
      width: 200,
      height: 200,
      zIndex: 3,
    },

    /*
     * البنطلون / الشورت:
     * تحت التيشيرت مباشرة.
     */
    Bottoms: {
      top: 194,
      left: 45,
      width: 200,
      height: 180,
      zIndex: 2,
    },

    /*
     * الفستان:
     * في المنتصف مع مساحة للإكسسوارات.
     */
    Dresses: {
      top: 58,
      left: 58,
      width: 172,
      height: 315,
      zIndex: 3,
    },

    /*
     * الحذاء:
     * أسفل البنطلون وفي المنتصف.
     */
    Shoes: {
      top: 330,
      left: 50,
      width: 220,
      height: 100,
      zIndex: 6,
    },

    /*
     * الساعة:
     * يمين البنطلون.
     */
    Watch: {
      top: 200,
      left: 190,
      width: 80,
      height: 100,
      zIndex: 7,
    },

    /*
     * النظارة:
     * أعلى اليمين.
     */
    Glasses: {
      top: 30,
      left: 213,
      width: 66,
      height: 42,
      zIndex: 7,
    },

    /*
     * الكاب:
     * أعلى اليمين.
     */
    Cap: {
      top: 8,
      left: 160,
      width: 150,
      height: 100,
      zIndex: 7,
    },

    /*
     * الشنطة:
     * يسار البنطلون وأسفل الجاكيت.
     */
    Bag: {
      top: 180,
      left: -30,
      width: 150,
      height: 180,
      zIndex: 7,
    },

    /*
     * أي إكسسوار آخر:
     * يمين البنطلون.
     */
    Other: {
      top: 254,
      left: 238,
      width: 43,
      height: 54,
      zIndex: 7,
    },

    Accessories: {
      top: 254,
      left: 238,
      width: 43,
      height: 54,
      zIndex: 7,
    },
  },

  suggestion: {
    canvas: {
      width: 300,
      height: 440,
    },

    /*
     * تستخدمها:
     * Random
     * Smart
     * Occasion
     * Weather
     */
    Jackets: {
      top: 8,
      left: 4,
      width: 101,
      height: 96,
      zIndex: 5,
    },

    Tops: {
      top: 40,
      left: 50,
      width: 200,
      height: 200,
      zIndex: 3,
    },

   Bottoms: {
      top: 194,
      left: 45,
      width: 200,
      height: 180,
      zIndex: 2,
    },

    Dresses: {
      top: 61,
      left: 61,
      width: 181,
      height: 330,
      zIndex: 3,
    },

    Shoes: {
      top: 330,
      left: 50,
      width: 220,
      height: 100,
      zIndex: 6,
    },

    Watch: {
      top: 200,
      left: 190,
      width: 80,
      height: 100,
      zIndex: 7,
    },

    Glasses: {
      top: 31,
      left: 224,
      width: 69,
      height: 44,
      zIndex: 7,
    },


Cap: {
      top: 8,
      left: 160,
      width: 150,
      height: 100,
      zIndex: 7,
    },

   Bag: {
      top: 180,
      left: -30,
      width: 150,
      height: 180,
      zIndex: 7,
    },

    Other: {
      top: 266,
      left: 250,
      width: 45,
      height: 57,
      zIndex: 7,
    },

    Accessories: {
      top: 266,
      left: 250,
      width: 45,
      height: 57,
      zIndex: 7,
    },
  },

  savedCard: {
    canvas: {
      width: 180,
      height: 220,
    },

    Jackets: {
      top: 4,
      left: 2,
      width: 61,
      height: 58,
      zIndex: 5,
    },

    Tops: {
      top: 36,
      left: 37,
      width: 107,
      height: 96,
      zIndex: 3,
    },

    Bottoms: {
      top: 102,
      left: 42,
      width: 101,
      height: 113,
      zIndex: 2,
    },

    Dresses: {
      top: 31,
      left: 37,
      width: 109,
      height: 180,
      zIndex: 3,
    },

    Shoes: {
      top: 150,
      left: 59,
      width: 150,
      height: 70,
      zIndex: 6,
    },

    Watch: {
      top: 90,
      left: 120,
      width: 60,
      height: 90,
      zIndex: 7,
    },

    Glasses: {
      top: 16,
      left: 135,
      width: 41,
      height: 27,
      zIndex: 7,
    },

    Cap: {
      top: 35,
      left: 120,
      width: 60,
      height: 47,
      zIndex: 7,
    },

    Bag: {
      top: 100,
      left: 8,
      width: 70,
      height: 80,
      zIndex: 7,
    },

    Other: {
      top: 133,
      left: 150,
      width: 27,
      height: 34,
      zIndex: 7,
    },

    Accessories: {
      top: 133,
      left: 150,
      width: 27,
      height: 34,
      zIndex: 7,
    },
  },

  details: {
    canvas: {
      width: 320,
      height: 470,
    },

    Jackets: {
      top: 9,
      left: 4,
      width: 108,
      height: 103,
      zIndex: 5,
    },

    Tops: {
      top: 40,
      left: 50,
      width: 200,
      height: 200,
      zIndex: 3,
    },

   Bottoms: {
      top: 194,
      left: 45,
      width: 200,
      height: 180,
      zIndex: 2,
    },

    Dresses: {
      top: 65,
      left: 65,
      width: 193,
      height: 353,
      zIndex: 3,
    },

    Shoes: {
      top: 330,
      left: 50,
      width: 220,
      height: 100,
      zIndex: 6,
    },

    Watch: {
      top: 200,
      left: 190,
      width: 80,
      height: 100,
      zIndex: 7,
    },

    Glasses: {
      top: 34,
      left: 239,
      width: 74,
      height: 47,
      zIndex: 7,
    },

   Cap: {
      top: 8,
      left: 160,
      width: 150,
      height: 100,
      zIndex: 7,
    },

   Bag: {
      top: 180,
      left: -30,
      width: 150,
      height: 180,
      zIndex: 7,
    },

    Other: {
      top: 284,
      left: 266,
      width: 48,
      height: 61,
      zIndex: 7,
    },

    Accessories: {
      top: 284,
      left: 266,
      width: 48,
      height: 61,
      zIndex: 7,
    },
  },
} as const;