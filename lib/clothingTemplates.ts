export type TemplateGender =
  | 'male'
  | 'female';

export type TemplateSelectorGroup =
  | 'top'
  | 'shirt'
  | 'shorts'
  | 'pants'
  | 'sneakers'
  | 'shoes';

export type ClothingTemplate = {
  id: string;

  label: string;
  badgeLabel: string;

  gender:
    TemplateGender;

  category: string;
  subCategory: string;

  viewBox:
    '0 0 1000 1000';

  aspectRatio: number;

  instructionsTitle:
    string;

  instructionsText:
    string;

  photoTip: string;

  /**
   * مسار SVG الداخلي.
   * أي شيء داخل هذا المسار يبقى ظاهرًا.
   * أي شيء خارجه يصبح شفافًا.
   */
  maskPath: string;

  camera: {
    /**
     * عرض الإطار كنسبة من عرض الشاشة.
     */
    widthRatio: number;

    /**
     * مكان بداية الإطار كنسبة من ارتفاع الشاشة.
     */
    topRatio: number;
  };
};

export type TemplateGroupDefinition = {
  id:
    TemplateSelectorGroup;

  label: string;

  subtitle: string;

  templateIds:
    string[];
};

export const DEFAULT_TEMPLATE_ID =
  'male-tshirt-regular';

/**
 * وضع تجربة القوالب.
 *
 * true:
 * لا يجب إرسال الصور إلى RunPod أثناء الاختبار.
 *
 * false:
 * يسمح بتشغيل مسار الرفع الطبيعي بعد إنهاء التجربة.
 */
export const TEMPLATE_LOCAL_TEST_MODE =
  true;

/* ======================================== */
/* Template paths                           */
/* ======================================== */

const TSHIRT_REGULAR_PATH = `
  M382 48
  C409 96 445 118 500 118
  C555 118 591 96 618 48
  L784 124
  L972 374
  L798 496
  L746 414
  L744 956
  L256 956
  L254 414
  L202 496
  L28 374
  L216 124
  Z
`;

const TSHIRT_OVERSIZED_PATH = `
  M 222.04 175.72
  L 194.07 205.44
  L 143.38 289.35
  L 42.86 513.11
  L 142.5 571.67
  L 243.9 640.73
  L 245.64 913.44
  L 756.98 915.19
  L 761.35 879.35
  L 762.22 639.85
  L 855.75 575.17
  L 963.26 511.36
  L 867.11 298.96
  L 806.8 199.32
  L 784.07 176.59
  L 753.48 158.24
  L 590.9 83.07
  L 502.62 97.05
  L 424.83 83.07
  L 402.98 84.81
  Z
`;

const POLO_PATH = `
  M374 54
  C408 98 448 116 500 116
  C552 116 592 98 626 54
  L790 126
  L964 352
  L804 470
  L748 394
  L744 956
  L256 956
  L252 394
  L196 470
  L36 352
  L210 126
  Z
`;

const SHIRT_SHORT_SLEEVE_PATH = `
  M368 48
  L438 112
  L500 76
  L562 112
  L632 48
  L790 124
  L968 362
  L800 478
  L748 398
  L744 956
  L256 956
  L252 398
  L200 478
  L32 362
  L210 124
  Z
`;

const SHIRT_LONG_SLEEVE_PATH = `
  M364 48
  L438 112
  L500 76
  L562 112
  L636 48
  L766 112
  L900 184
  L976 740
  L812 768
  L734 416
  L742 956
  L258 956
  L266 416
  L188 768
  L24 740
  L100 184
  L234 112
  Z
`;

const SHORT_SHORTS_PATH = `
  M246 128
  L754 128
  L794 494
  L624 514
  L548 870
  L452 870
  L376 514
  L206 494
  Z
`;

const LONG_SHORTS_PATH = `
  M244 116
  L756 116
  L806 456
  L650 474
  L590 920
  L410 920
  L350 474
  L194 456
  Z
`;

const PANTS_PATH = `
  M250 68
  L750 68
  L790 418
  L646 446
  L602 956
  L452 956
  L500 424
  L548 956
  L398 956
  L354 446
  L210 418
  Z
`;

/**
 * كوتشي Slim منخفض وخفيف.
 */
const SNEAKERS_SLIM_PATH = `
  M92 690
  L94 610
  C96 568 104 526 122 492
  C134 468 152 462 174 480
  C190 494 202 518 224 534
  C252 554 286 562 326 560
  C354 558 380 550 402 538
  L398 494
  C396 472 404 448 420 428
  C430 416 444 414 458 424
  L530 474
  C572 500 620 528 674 554
  C734 582 792 600 850 610
  C888 616 914 632 926 656
  C936 676 936 704 930 724
  C904 738 866 746 818 750
  C672 760 526 760 380 760
  L154 760
  C122 760 100 752 92 738
  Z
`;

/**
 * كوتشي Regular متوسط الحجم.
 */
const SNEAKERS_REGULAR_PATH = `
  M84 698
  L88 598
  C90 558 100 518 118 484
  C130 460 150 456 172 474
  C190 490 202 520 228 536
  C258 556 294 562 334 558
  C366 554 396 542 420 524
  L416 470
  C414 446 422 420 438 396
  C448 382 464 378 480 388
  L558 446
  C602 478 648 508 704 536
  C764 566 818 586 872 598
  C910 606 936 622 948 650
  C960 676 958 706 948 730
  C926 744 890 752 842 756
  C686 766 530 766 374 766
  L146 766
  C112 766 92 756 84 738
  Z
`;

/**
 * كوتشي Chunky بنعل وجسم أكبر.
 */
const SNEAKERS_CHUNKY_PATH = `
  M72 704
  C66 684 70 662 84 644
  C72 618 78 592 98 574
  L102 520
  C104 486 116 456 138 436
  C152 424 172 424 190 436
  L214 454
  C230 470 244 500 268 516
  C294 534 326 540 360 536
  C388 532 414 520 434 502
  L430 450
  C428 424 438 394 458 366
  C470 350 488 346 506 358
  L582 412
  C628 448 680 482 738 512
  C796 542 850 560 900 572
  C934 580 958 598 968 628
  C978 656 974 686 960 710
  C966 728 958 748 940 762
  C920 778 890 786 852 790
  L754 798
  C722 800 694 792 670 776
  C648 762 624 756 598 758
  C570 760 546 770 522 784
  C500 798 474 804 446 802
  L146 794
  C110 794 84 780 74 758
  C66 742 66 722 72 704
  Z
`;

/**
 * جزمة Classic Lace-Up رسمية منخفضة.
 */
const SHOES_CLASSIC_LACE_UP_PATH = `
  M126 748
  L126 672
  C126 624 132 574 148 530
  C160 496 180 470 204 450
  C218 438 234 434 252 440
  C302 458 352 468 404 468
  C452 468 494 458 526 438
  L530 404
  C532 386 540 366 554 350
  C564 338 580 336 594 346
  L662 398
  C704 430 746 466 782 504
  C818 542 856 566 900 578
  C930 586 950 604 958 632
  C966 660 964 692 956 718
  C930 738 896 752 852 760
  C790 772 720 776 642 774
  C572 772 504 764 436 752
  L410 746
  L410 774
  L126 774
  Z
`;

/**
 * Loafer منخفض بدون أربطة.
 */
const SHOES_LOAFER_PATH = `
  M126 752
  L126 684
  C126 636 132 588 146 544
  C156 514 174 488 196 466
  C208 454 224 450 240 456
  C300 474 360 486 420 494
  C468 500 506 500 538 494
  L524 456
  C518 436 522 414 538 394
  C550 378 568 374 586 386
  L660 438
  C700 466 740 498 776 530
  C812 562 850 582 892 592
  C926 600 948 618 958 646
  C968 674 966 704 956 730
  C932 748 896 760 848 768
  C784 778 712 780 632 776
  C558 772 486 764 414 752
  L410 780
  L126 780
  Z
`;

/* ======================================== */
/* Templates                                */
/* ======================================== */

export const CLOTHING_TEMPLATES:
  Record<
    string,
    ClothingTemplate
  > = {
  'male-tshirt-regular': {
    id:
      'male-tshirt-regular',

    label:
      'T-Shirt Regular',

    badgeLabel:
      'T-SHIRT',

    gender:
      'male',

    category:
      'Tops',

    subCategory:
      'TShirt',

    viewBox:
      '0 0 1000 1000',

    aspectRatio: 1,

    instructionsTitle:
      'Align the regular T-shirt',

    instructionsText:
      'Place the entire T-shirt inside the outline',

    photoTip:
      'Use a plain background and good lighting',

    maskPath:
      TSHIRT_REGULAR_PATH,

    camera: {
      widthRatio: 0.96,
      topRatio: 0.15,
    },
  },

  'male-tshirt-oversized': {
    id:
      'male-tshirt-oversized',

    label:
      'T-Shirt Oversized',

    badgeLabel:
      'OVERSIZED',

    gender:
      'male',

    category:
      'Tops',

    subCategory:
      'TShirt',

    viewBox:
      '0 0 1000 1000',

    aspectRatio: 1,

    instructionsTitle:
      'Align the oversized T-shirt',

    instructionsText:
      'Keep the wide body and sleeves inside the outline',

    photoTip:
      'Lay the T-shirt flat without folding the sides',

    maskPath:
      TSHIRT_OVERSIZED_PATH,

    camera: {
      widthRatio: 0.98,
      topRatio: 0.15,
    },
  },

  'male-polo': {
    id:
      'male-polo',

    label:
      'Polo',

    badgeLabel:
      'POLO',

    gender:
      'male',

    category:
      'Tops',

    subCategory:
      'Polo',

    viewBox:
      '0 0 1000 1000',

    aspectRatio: 1,

    instructionsTitle:
      'Align the polo',

    instructionsText:
      'Place the full polo inside the outline',

    photoTip:
      'Keep the collar flat and the sleeves open',

    maskPath:
      POLO_PATH,

    camera: {
      widthRatio: 0.96,
      topRatio: 0.15,
    },
  },

  'male-shirt-short-sleeve': {
    id:
      'male-shirt-short-sleeve',

    label:
      'Short-Sleeve Shirt',

    badgeLabel:
      'SHORT SHIRT',

    gender:
      'male',

    category:
      'Tops',

    subCategory:
      'Shirt',

    viewBox:
      '0 0 1000 1000',

    aspectRatio: 1,

    instructionsTitle:
      'Align the short-sleeve shirt',

    instructionsText:
      'Keep the body and both sleeves inside the outline',

    photoTip:
      'Close the shirt and lay it completely flat',

    maskPath:
      SHIRT_SHORT_SLEEVE_PATH,

    camera: {
      widthRatio: 0.96,
      topRatio: 0.15,
    },
  },

  'male-shirt-long-sleeve': {
    id:
      'male-shirt-long-sleeve',

    label:
      'Long-Sleeve Shirt',

    badgeLabel:
      'LONG SHIRT',

    gender:
      'male',

    category:
      'Tops',

    subCategory:
      'Shirt',

    viewBox:
      '0 0 1000 1000',

    aspectRatio: 1,

    instructionsTitle:
      'Align the long-sleeve shirt',

    instructionsText:
      'Stretch both sleeves and keep them inside the outline',

    photoTip:
      'Keep the body straight and do not fold the cuffs',

    maskPath:
      SHIRT_LONG_SLEEVE_PATH,

    camera: {
      widthRatio: 0.98,
      topRatio: 0.14,
    },
  },

  'male-short-shorts': {
    id:
      'male-short-shorts',

    label:
      'Short Shorts',

    badgeLabel:
      'SHORT SHORTS',

    gender:
      'male',

    category:
      'Shorts',

    subCategory:
      'Shorts',

    viewBox:
      '0 0 1000 1000',

    aspectRatio: 1,

    instructionsTitle:
      'Align the short shorts',

    instructionsText:
      'Center the waistband and place both legs inside the outline',

    photoTip:
      'Keep the waistband straight and remove any belt',

    maskPath:
      SHORT_SHORTS_PATH,

    camera: {
      widthRatio: 0.94,
      topRatio: 0.18,
    },
  },

  'male-long-shorts': {
    id:
      'male-long-shorts',

    label:
      'Long Shorts',

    badgeLabel:
      'LONG SHORTS',

    gender:
      'male',

    category:
      'Shorts',

    subCategory:
      'Shorts',

    viewBox:
      '0 0 1000 1000',

    aspectRatio: 1,

    instructionsTitle:
      'Align the long shorts',

    instructionsText:
      'Center the waistband and keep both legs straight',

    photoTip:
      'Lay the shorts flat without any folded fabric',

    maskPath:
      LONG_SHORTS_PATH,

    camera: {
      widthRatio: 0.94,
      topRatio: 0.17,
    },
  },

  'male-pants': {
    id:
      'male-pants',

    label:
      'Pants',

    badgeLabel:
      'PANTS',

    gender:
      'male',

    category:
      'Pants',

    subCategory:
      'Jeans',

    viewBox:
      '0 0 1000 1000',

    aspectRatio: 1,

    instructionsTitle:
      'Align the pants',

    instructionsText:
      'Center the waistband and keep both legs straight',

    photoTip:
      'Lay the pants flat without folding the legs',

    maskPath:
      PANTS_PATH,

    camera: {
      widthRatio: 0.94,
      topRatio: 0.14,
    },
  },

  'male-sneakers-slim': {
    id:
      'male-sneakers-slim',

    label:
      'Slim Sneaker',

    badgeLabel:
      'SLIM',

    gender:
      'male',

    category:
      'Shoes',

    subCategory:
      'Sneakers',

    viewBox:
      '0 0 1000 1000',

    aspectRatio: 1,

    instructionsTitle:
      'Align the slim sneaker',

    instructionsText:
      'Place the entire sneaker inside the outline',

    photoTip:
      'Use a clear side view and keep the complete sole visible',

    maskPath:
      SNEAKERS_SLIM_PATH,

    camera: {
      widthRatio: 0.98,
      topRatio: 0.22,
    },
  },

  'male-sneakers-regular': {
    id:
      'male-sneakers-regular',

    label:
      'Regular Sneaker',

    badgeLabel:
      'REGULAR',

    gender:
      'male',

    category:
      'Shoes',

    subCategory:
      'Sneakers',

    viewBox:
      '0 0 1000 1000',

    aspectRatio: 1,

    instructionsTitle:
      'Align the regular sneaker',

    instructionsText:
      'Place the entire sneaker inside the outline',

    photoTip:
      'Use a clear side view and keep the complete sole visible',

    maskPath:
      SNEAKERS_REGULAR_PATH,

    camera: {
      widthRatio: 0.98,
      topRatio: 0.22,
    },
  },

  'male-sneakers-chunky': {
    id:
      'male-sneakers-chunky',

    label:
      'Chunky Sneaker',

    badgeLabel:
      'CHUNKY',

    gender:
      'male',

    category:
      'Shoes',

    subCategory:
      'Sneakers',

    viewBox:
      '0 0 1000 1000',

    aspectRatio: 1,

    instructionsTitle:
      'Align the chunky sneaker',

    instructionsText:
      'Keep the full sneaker and thick sole inside the outline',

    photoTip:
      'Use a clear side view without cutting off the thick sole',

    maskPath:
      SNEAKERS_CHUNKY_PATH,

    camera: {
      widthRatio: 0.98,
      topRatio: 0.21,
    },
  },

  'male-shoes-classic-lace-up': {
    id:
      'male-shoes-classic-lace-up',

    label:
      'Classic Lace-Up',

    badgeLabel:
      'LACE-UP',

    gender:
      'male',

    category:
      'Shoes',

    subCategory:
      'Shoes',

    viewBox:
      '0 0 1000 1000',

    aspectRatio: 1,

    instructionsTitle:
      'Align the classic lace-up shoe',

    instructionsText:
      'Place the entire shoe inside the outline',

    photoTip:
      'Use a side view and keep the complete heel and toe visible',

    maskPath:
      SHOES_CLASSIC_LACE_UP_PATH,

    camera: {
      widthRatio: 0.98,
      topRatio: 0.22,
    },
  },

  'male-shoes-loafer': {
    id:
      'male-shoes-loafer',

    label:
      'Loafer',

    badgeLabel:
      'LOAFER',

    gender:
      'male',

    category:
      'Shoes',

    subCategory:
      'Shoes',

    viewBox:
      '0 0 1000 1000',

    aspectRatio: 1,

    instructionsTitle:
      'Align the loafer',

    instructionsText:
      'Place the entire loafer inside the outline',

    photoTip:
      'Use a side view and keep the complete heel and toe visible',

    maskPath:
      SHOES_LOAFER_PATH,

    camera: {
      widthRatio: 0.98,
      topRatio: 0.22,
    },
  },
};

/* ======================================== */
/* Selector groups                          */
/* ======================================== */

/**
 * المستخدم يرى المجموعات الست فقط.
 *
 * المجموعة التي تحتوي على أكثر من قالب:
 * تفتح شاشة الاختيارات التابعة لها.
 *
 * المجموعة التي تحتوي على قالب واحد:
 * تفتح الكاميرا مباشرة.
 */
export const MALE_TEMPLATE_GROUPS:
  TemplateGroupDefinition[] = [
  {
    id:
      'top',

    label:
      'Top',

    subtitle:
      'T-shirt, oversized or polo',

    templateIds: [
      'male-tshirt-regular',
      'male-tshirt-oversized',
      'male-polo',
    ],
  },

  {
    id:
      'shirt',

    label:
      'Shirt',

    subtitle:
      'Short or long sleeve',

    templateIds: [
      'male-shirt-short-sleeve',
      'male-shirt-long-sleeve',
    ],
  },

  {
    id:
      'shorts',

    label:
      'Shorts',

    subtitle:
      'Short or long fit',

    templateIds: [
      'male-short-shorts',
      'male-long-shorts',
    ],
  },

  {
    id:
      'pants',

    label:
      'Pants',

    subtitle:
      'Regular pants',

    templateIds: [
      'male-pants',
    ],
  },

  {
    id:
      'sneakers',

    label:
      'Sneakers',

    subtitle:
      'Slim, regular or chunky',

    templateIds: [
      'male-sneakers-slim',
      'male-sneakers-regular',
      'male-sneakers-chunky',
    ],
  },

  {
    id:
      'shoes',

    label:
      'Shoes',

    subtitle:
      'Classic lace-up or loafer',

    templateIds: [
      'male-shoes-classic-lace-up',
      'male-shoes-loafer',
    ],
  },
];

/* ======================================== */
/* Template helpers                         */
/* ======================================== */

export function getClothingTemplate(
  templateId?: string | null
): ClothingTemplate {
  if (
    templateId &&
    CLOTHING_TEMPLATES[
      templateId
    ]
  ) {
    return CLOTHING_TEMPLATES[
      templateId
    ];
  }

  return CLOTHING_TEMPLATES[
    DEFAULT_TEMPLATE_ID
  ];
}

export function hasClothingTemplate(
  templateId: string
) {
  return Boolean(
    CLOTHING_TEMPLATES[
      templateId
    ]
  );
}

export function getTemplatesByGender(
  gender:
    TemplateGender
) {
  return Object.values(
    CLOTHING_TEMPLATES
  ).filter(
    (template) =>
      template.gender ===
      gender
  );
}

export function getTemplatesByCategory(
  gender:
    TemplateGender,
  category: string
) {
  return Object.values(
    CLOTHING_TEMPLATES
  ).filter(
    (template) =>
      template.gender ===
        gender &&
      template.category ===
        category
  );
}

export function getTemplateGroups(
  gender:
    TemplateGender
): TemplateGroupDefinition[] {
  if (
    gender ===
    'male'
  ) {
    return MALE_TEMPLATE_GROUPS;
  }

  /**
   * قوالب النساء ستُضاف لاحقًا
   * بنفس المحرك دون تعديل الكاميرا.
   */
  return [];
}

export function getTemplateGroup(
  gender:
    TemplateGender,
  groupId:
    TemplateSelectorGroup
): TemplateGroupDefinition | null {
  return (
    getTemplateGroups(
      gender
    ).find(
      (group) =>
        group.id ===
        groupId
    ) || null
  );
}

export function getTemplatesInGroup(
  gender:
    TemplateGender,
  groupId:
    TemplateSelectorGroup
): ClothingTemplate[] {
  const group =
    getTemplateGroup(
      gender,
      groupId
    );

  if (!group) {
    return [];
  }

  return group.templateIds
    .map(
      (templateId) =>
        CLOTHING_TEMPLATES[
          templateId
        ]
    )
    .filter(
      (
        template
      ): template is ClothingTemplate =>
        Boolean(
          template &&
          template.gender ===
            gender
        )
    );
}