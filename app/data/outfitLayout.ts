export type OutfitCanvasVariant =
  | 'builder'
  | 'suggestion'
  | 'savedCard'
  | 'details';

export const OUTFIT_LAYOUT = {
  builder: {
    canvas: { width: 250, height: 390 },

    Jackets: {
      top: -10,
      left: 2,
      width: 245,
      height: 195,
      zIndex: 3,
    },

    Tops: {
      top: 25,
      left: 12,
      width: 225,
      height: 195,
      zIndex: 2,
    },

    Bottoms: {
      top: 155,
      left: 22,
      width: 205,
      height: 225,
      zIndex: 1,
    },

    Dresses: {
      top: 15,
      left: 10,
      width: 230,
      height: 330,
      zIndex: 2,
    },

    Shoes: {
      top: 300,
      left: 85,
      width: 220,
      height: 115,
      zIndex: 4,
    },

    Watch: {
      top: 178,
      left: 202,
      width: 42,
      height: 42,
      zIndex: 5,
    },

    Glasses: {
      top: 10,
      left: 96,
      width: 58,
      height: 36,
      zIndex: 5,
    },

    Cap: {
      top: 0,
      left: 94,
      width: 62,
      height: 46,
      zIndex: 5,
    },

    Bag: {
      top: 210,
      left: 5,
      width: 70,
      height: 95,
      zIndex: 5,
    },

    Other: {
      top: 185,
      left: 202,
      width: 45,
      height: 45,
      zIndex: 5,
    },

    Accessories: {
      top: 185,
      left: 202,
      width: 45,
      height: 45,
      zIndex: 5,
    },
  },

  suggestion: {
    canvas: { width: 285, height: 430 },

    Jackets: {
      top: -5,
      left: 8,
      width: 270,
      height: 200,
      zIndex: 3,
    },

    Tops: {
      top: 18,
      left: 20,
      width: 245,
      height: 215,
      zIndex: 2,
    },

    Bottoms: {
      top: 155,
      left: 28,
      width: 230,
      height: 255,
      zIndex: 1,
    },

    Dresses: {
      top: 10,
      left: 18,
      width: 250,
      height: 360,
      zIndex: 2,
    },

    Shoes: {
      top: 315,
      left: 120,
      width: 220,
      height: 115,
      zIndex: 4,
    },

    Watch: {
      top: 185,
      left: 235,
      width: 42,
      height: 42,
      zIndex: 5,
    },

    Glasses: {
      top: 10,
      left: 112,
      width: 62,
      height: 36,
      zIndex: 5,
    },

    Cap: {
      top: 0,
      left: 112,
      width: 62,
      height: 46,
      zIndex: 5,
    },

    Bag: {
      top: 210,
      left: 12,
      width: 78,
      height: 105,
      zIndex: 5,
    },

    Other: {
      top: 190,
      left: 235,
      width: 45,
      height: 45,
      zIndex: 5,
    },

    Accessories: {
      top: 190,
      left: 235,
      width: 45,
      height: 45,
      zIndex: 5,
    },
  },

  savedCard: {
    canvas: { width: 180, height: 210 },

    Jackets: {
      top: 0,
      left: 18,
      width: 145,
      height: 108,
      zIndex: 3,
    },

    Tops: {
      top: 2,
      left: 18,
      width: 145,
      height: 128,
      zIndex: 2,
    },

    Bottoms: {
      top: 84,
      left: 18,
      width: 138,
      height: 118,
      zIndex: 1,
    },

    Dresses: {
      top: 2,
      left: 18,
      width: 145,
      height: 185,
      zIndex: 2,
    },

    Shoes: {
      top: 150,
      left: 78,
      width: 110,
      height: 66,
      zIndex: 4,
    },

    Watch: {
      top: 98,
      left: 146,
      width: 24,
      height: 24,
      zIndex: 5,
    },

    Glasses: {
      top: 8,
      left: 74,
      width: 34,
      height: 20,
      zIndex: 5,
    },

    Cap: {
      top: 0,
      left: 72,
      width: 36,
      height: 26,
      zIndex: 5,
    },

    Bag: {
      top: 104,
      left: 0,
      width: 42,
      height: 58,
      zIndex: 5,
    },

    Other: {
      top: 104,
      left: 146,
      width: 24,
      height: 24,
      zIndex: 5,
    },

    Accessories: {
      top: 104,
      left: 146,
      width: 24,
      height: 24,
      zIndex: 5,
    },
  },

  details: {
    canvas: { width: 320, height: 470 },

    Jackets: {
      top: -10,
      left: 5,
      width: 310,
      height: 235,
      zIndex: 3,
    },

    Tops: {
      top: 10,
      left: 15,
      width: 290,
      height: 245,
      zIndex: 2,
    },

    Bottoms: {
      top: 165,
      left: 25,
      width: 270,
      height: 290,
      zIndex: 1,
    },

    Dresses: {
      top: 5,
      left: 15,
      width: 290,
      height: 415,
      zIndex: 2,
    },

    Shoes: {
      top: 365,
      left: 110,
      width: 280,
      height: 135,
      zIndex: 4,
    },

    Watch: {
      top: 195,
      left: 260,
      width: 44,
      height: 44,
      zIndex: 5,
    },

    Glasses: {
      top: 10,
      left: 128,
      width: 66,
      height: 40,
      zIndex: 5,
    },

    Cap: {
      top: 0,
      left: 124,
      width: 72,
      height: 55,
      zIndex: 5,
    },

    Bag: {
      top: 220,
      left: 10,
      width: 82,
      height: 112,
      zIndex: 5,
    },

    Other: {
      top: 205,
      left: 260,
      width: 48,
      height: 48,
      zIndex: 5,
    },

    Accessories: {
      top: 205,
      left: 260,
      width: 48,
      height: 48,
      zIndex: 5,
    },
  },
} as const;