export const fashionColors = {
  Black: {
    shades: ['Black', 'Jet Black', 'Charcoal', 'Washed Black'],
    matches: [
      'White',
      'Gray',
      'Beige',
      'Cream',
      'Camel',
      'Blue',
      'Navy',
      'Olive',
      'Burgundy',
      'Red',
      'Pink',
      'Silver',
      'Denim',
    ],
  },

  White: {
    shades: ['White', 'Off White', 'Ivory', 'Cream'],
    matches: [
      'Black',
      'Gray',
      'Blue',
      'Navy',
      'Brown',
      'Green',
      'Olive',
      'Beige',
      'Camel',
      'Khaki',
      'Burgundy',
      'Pink',
      'Gold',
      'Denim',
    ],
  },

  Gray: {
    shades: [
      'Gray',
      'Light Gray',
      'Dark Gray',
      'Charcoal Gray',
      'Ash Gray',
    ],
    matches: [
      'Black',
      'White',
      'Blue',
      'Navy',
      'Beige',
      'Camel',
      'Pink',
      'Burgundy',
      'Green',
      'Olive',
    ],
  },

  Blue: {
    shades: [
      'Blue',
      'Royal Blue',
      'Sky Blue',
      'Light Blue',
      'Dark Blue',
    ],
    matches: [
      'White',
      'Gray',
      'Black',
      'Beige',
      'Camel',
      'Brown',
      'Olive',
      'Cream',
    ],
  },

  Navy: {
    shades: ['Navy', 'Midnight Blue', 'Dark Navy'],
    matches: [
      'White',
      'Gray',
      'Beige',
      'Cream',
      'Camel',
      'Brown',
      'Burgundy',
      'Pink',
      'Olive',
      'Gold',
    ],
  },

  Denim: {
    shades: ['Denim', 'Light Denim', 'Dark Denim'],
    matches: [
      'White',
      'Black',
      'Gray',
      'Beige',
      'Camel',
      'Brown',
      'Olive',
    ],
  },

  Beige: {
    shades: ['Beige', 'Sand', 'Stone'],
    matches: [
      'Black',
      'White',
      'Brown',
      'Blue',
      'Navy',
      'Green',
      'Olive',
      'Burgundy',
      'Gray',
    ],
  },

  Camel: {
    shades: ['Camel', 'Light Camel', 'Dark Camel'],
    matches: [
      'White',
      'Black',
      'Navy',
      'Blue',
      'Cream',
      'Olive',
      'Brown',
      'Gray',
    ],
  },

  Cream: {
    shades: ['Cream', 'Off White', 'Ivory'],
    matches: [
      'Brown',
      'Camel',
      'Navy',
      'Blue',
      'Olive',
      'Black',
      'Gray',
      'Burgundy',
    ],
  },

  Brown: {
    shades: [
      'Brown',
      'Chocolate',
      'Coffee',
      'Dark Brown',
      'Light Brown',
    ],
    matches: [
      'White',
      'Cream',
      'Beige',
      'Camel',
      'Blue',
      'Navy',
      'Olive',
      'Green',
    ],
  },

  Green: {
    shades: [
      'Green',
      'Forest Green',
      'Dark Green',
      'Mint Green',
      'Sage Green',
    ],
    matches: [
      'White',
      'Black',
      'Brown',
      'Beige',
      'Cream',
      'Gray',
      'Camel',
    ],
  },

  Olive: {
    shades: ['Olive', 'Olive Green', 'Military Green'],
    matches: [
      'Black',
      'White',
      'Cream',
      'Camel',
      'Brown',
      'Gray',
      'Beige',
      'Navy',
    ],
  },

  Red: {
    shades: ['Red', 'Dark Red', 'Bright Red'],
    matches: [
      'Black',
      'White',
      'Gray',
      'Cream',
      'Denim',
    ],
  },

  Burgundy: {
    shades: ['Burgundy', 'Wine', 'Maroon'],
    matches: [
      'Black',
      'White',
      'Gray',
      'Beige',
      'Cream',
      'Navy',
      'Camel',
      'Pink',
    ],
  },

  Pink: {
    shades: ['Pink', 'Light Pink', 'Dusty Pink', 'Rose'],
    matches: [
      'White',
      'Gray',
      'Navy',
      'Black',
      'Beige',
      'Camel',
      'Burgundy',
    ],
  },

  Yellow: {
    shades: ['Yellow', 'Mustard', 'Golden Yellow'],
    matches: [
      'Black',
      'Gray',
      'Blue',
      'Navy',
      'White',
    ],
  },

  Orange: {
    shades: ['Orange', 'Burnt Orange', 'Rust'],
    matches: [
      'Black',
      'White',
      'Brown',
      'Beige',
      'Navy',
    ],
  },

  Purple: {
    shades: ['Purple', 'Lavender', 'Dark Purple'],
    matches: [
      'Black',
      'White',
      'Gray',
      'Silver',
    ],
  },

  Khaki: {
    shades: ['Khaki', 'Light Khaki'],
    matches: [
      'White',
      'Black',
      'Olive',
      'Brown',
      'Navy',
    ],
  },

  Gold: {
    shades: ['Gold'],
    matches: [
      'Black',
      'White',
      'Navy',
      'Burgundy',
    ],
  },

  Silver: {
    shades: ['Silver'],
    matches: [
      'Black',
      'White',
      'Gray',
      'Blue',
    ],
  },
} as const;

export type FashionColor = keyof typeof fashionColors;