export type OutfitCanvasVariant =
  | 'builder'
  | 'suggestion'
  | 'savedCard'
  | 'details';

export const OUTFIT_LAYOUT = {
  /*
   * =========================================================
   * Builder
   * Canvas: 285 x 420
   * =========================================================
   */
  builder: {
    canvas: {
      width: 320,
      height: 440,
    },

    Jackets: {
      top: 8,
      left: 22,
      width: 276,
      height: 160,
      zIndex: 5,
    },

    Tops: {
      top: 8,
      left: 18,
      width: 284,
      height: 190,
      zIndex: 3,
    },

    Bottoms: {
      top: 142,
      left: 56,
      width: 208,
      height: 235,
      zIndex: 2,
    },

    Dresses: {
      top: 10,
      left: 42,
      width: 236,
      height: 400,
      zIndex: 3,
    },

    Shoes: {
      top: 344,
      left: 74,
      width: 172,
      height: 86,
      zIndex: 6,
    },

    Watch: {
      top: 182,
      left: 250,
      width: 62,
      height: 72,
      zIndex: 7,
    },

    Glasses: {
      top: 24,
      left: 232,
      width: 78,
      height: 48,
      zIndex: 7,
    },

    Cap: {
      top: 0,
      left: 218,
      width: 92,
      height: 70,
      zIndex: 7,
    },

    Bag: {
      top: 170,
      left: 4,
      width: 112,
      height: 150,
      zIndex: 7,
    },

    Other: {
      top: 212,
      left: 264,
      width: 48,
      height: 58,
      zIndex: 7,
    },

    Accessories: {
      top: 212,
      left: 264,
      width: 48,
      height: 58,
      zIndex: 7,
    },
  },
  /*
   * =========================================================
   * Suggestion
   *
   * Random / Occasion / Weather / Smart
   * Canvas: 300 x 440
   * =========================================================
   */
  suggestion: {
    canvas: {
      width: 320,
      height: 440,
    },

    Jackets: {
      top: 8,
      left: 22,
      width: 276,
      height: 160,
      zIndex: 5,
    },

    Tops: {
      top: 8,
      left: 18,
      width: 284,
      height: 190,
      zIndex: 3,
    },

    Bottoms: {
      top: 142,
      left: 56,
      width: 208,
      height: 235,
      zIndex: 2,
    },

    Dresses: {
      top: 10,
      left: 42,
      width: 236,
      height: 400,
      zIndex: 3,
    },

    Shoes: {
      top: 344,
      left: 74,
      width: 172,
      height: 86,
      zIndex: 6,
    },

    Watch: {
      top: 182,
      left: 250,
      width: 62,
      height: 72,
      zIndex: 7,
    },

    Glasses: {
      top: 24,
      left: 232,
      width: 78,
      height: 48,
      zIndex: 7,
    },

    Cap: {
      top: 0,
      left: 218,
      width: 92,
      height: 70,
      zIndex: 7,
    },

    Bag: {
      top: 170,
      left: 4,
      width: 112,
      height: 150,
      zIndex: 7,
    },

    Other: {
      top: 212,
      left: 264,
      width: 48,
      height: 58,
      zIndex: 7,
    },

    Accessories: {
      top: 212,
      left: 264,
      width: 48,
      height: 58,
      zIndex: 7,
    },
  },
  /*
   * =========================================================
   * Saved outfit card
   * Canvas: 180 x 220
   * =========================================================
   */
  savedCard: {
    canvas: {
      width: 180,
      height: 220,
    },

    Jackets: {
      top: 0,
      left: 0,
      width: 98,
      height: 84,
      zIndex: 5,
    },

    Tops: {
      top: 4,
      left: 10,
      width: 160,
      height: 115,
      zIndex: 3,
    },

    Bottoms: {
      top: 78,
      left: 20,
      width: 140,
      height: 130,
      zIndex: 2,
    },

    Dresses: {
      top: 4,
      left: 12,
      width: 156,
      height: 205,
      zIndex: 3,
    },

    Shoes: {
      top: 162,
      left: 8,
      width: 164,
      height: 54,
      zIndex: 6,
    },

    Watch: {
      top: 92,
      left: 135,
      width: 42,
      height: 55,
      zIndex: 7,
    },

    Glasses: {
      top: 5,
      left: 132,
      width: 43,
      height: 27,
      zIndex: 7,
    },

    Cap: {
      top: 0,
      left: 118,
      width: 58,
      height: 42,
      zIndex: 7,
    },

    Bag: {
      top: 86,
      left: 0,
      width: 68,
      height: 88,
      zIndex: 7,
    },

    Other: {
      top: 116,
      left: 148,
      width: 29,
      height: 36,
      zIndex: 7,
    },

    Accessories: {
      top: 116,
      left: 148,
      width: 29,
      height: 36,
      zIndex: 7,
    },
  },

  /*
   * =========================================================
   * Details / Preview
   * Canvas: 320 x 470
   * =========================================================
   */
  details: {
    canvas: {
      width: 320,
      height: 470,
    },

    Jackets: {
      top: 5,
      left: 0,
      width: 160,
      height: 155,
      zIndex: 5,
    },

    Tops: {
      top: 16,
      left: 21,
      width: 277,
      height: 230,
      zIndex: 3,
    },

    Bottoms: {
      top: 155,
      left: 32,
      width: 256,
      height: 262,
      zIndex: 2,
    },

    Dresses: {
      top: 16,
      left: 27,
      width: 266,
      height: 427,
      zIndex: 3,
    },

    Shoes: {
      top: 358,
      left: 16,
      width: 288,
      height: 107,
      zIndex: 6,
    },

    Watch: {
      top: 203,
      left: 229,
      width: 85,
      height: 96,
      zIndex: 7,
    },

    Glasses: {
      top: 16,
      left: 229,
      width: 80,
      height: 48,
      zIndex: 7,
    },

    Cap: {
      top: 0,
      left: 197,
      width: 117,
      height: 85,
      zIndex: 7,
    },

    Bag: {
      top: 176,
      left: -11,
      width: 144,
      height: 198,
      zIndex: 7,
    },

    Other: {
      top: 235,
      left: 261,
      width: 53,
      height: 64,
      zIndex: 7,
    },

    Accessories: {
      top: 235,
      left: 261,
      width: 53,
      height: 64,
      zIndex: 7,
    },
  },
} as const;
