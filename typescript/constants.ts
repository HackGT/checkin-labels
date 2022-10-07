type WidthLength = [number, number];

interface Label {
  tapeSize: WidthLength;
  dots: WidthLength;
  dotsPrintable: WidthLength;
  rightMargin: number;
  feedMargin: number;
}

export const Labels: { [type: string]: Label } = {
  "12": {
    tapeSize: [12, 0],
    dots: [142, 0],
    dotsPrintable: [106, 0],
    rightMargin: 29,
    feedMargin: 35,
  },
  "29": {
    tapeSize: [29, 0],
    dots: [342, 0],
    dotsPrintable: [306, 0],
    rightMargin: 6,
    feedMargin: 35,
  },
  "38": {
    tapeSize: [38, 0],
    dots: [449, 0],
    dotsPrintable: [413, 0],
    rightMargin: 12,
    feedMargin: 35,
  },
  "50": {
    tapeSize: [50, 0],
    dots: [590, 0],
    dotsPrintable: [554, 0],
    rightMargin: 12,
    feedMargin: 35,
  },
  "54": {
    tapeSize: [54, 0],
    dots: [636, 0],
    dotsPrintable: [590, 0],
    rightMargin: 0,
    feedMargin: 35,
  },
  "62": {
    tapeSize: [62, 0],
    dots: [732, 0],
    dotsPrintable: [696, 0],
    rightMargin: 12,
    feedMargin: 35,
  },
  "102": {
    tapeSize: [102, 0],
    dots: [1200, 0],
    dotsPrintable: [1164, 0],
    rightMargin: 12,
    feedMargin: 35,
  },
  "17x54": {
    tapeSize: [17, 54],
    dots: [201, 636],
    dotsPrintable: [165, 566],
    rightMargin: 0,
    feedMargin: 0,
  },
  "17x87": {
    tapeSize: [17, 87],
    dots: [201, 1026],
    dotsPrintable: [165, 956],
    rightMargin: 0,
    feedMargin: 0,
  },
  "23x23": {
    tapeSize: [23, 23],
    dots: [272, 272],
    dotsPrintable: [202, 202],
    rightMargin: 42,
    feedMargin: 0,
  },
  "29x42": {
    tapeSize: [29, 42],
    dots: [342, 495],
    dotsPrintable: [306, 425],
    rightMargin: 6,
    feedMargin: 0,
  },
  "29x90": {
    tapeSize: [29, 90],
    dots: [342, 1061],
    dotsPrintable: [306, 991],
    rightMargin: 6,
    feedMargin: 0,
  },
  "39x90": {
    tapeSize: [38, 90],
    dots: [449, 1061],
    dotsPrintable: [413, 991],
    rightMargin: 12,
    feedMargin: 0,
  },
  "39x48": {
    tapeSize: [39, 48],
    dots: [461, 565],
    dotsPrintable: [425, 495],
    rightMargin: 6,
    feedMargin: 0,
  },
  "52x29": {
    tapeSize: [52, 29],
    dots: [614, 341],
    dotsPrintable: [578, 271],
    rightMargin: 0,
    feedMargin: 0,
  },
  "62x29": {
    tapeSize: [62, 29],
    dots: [732, 341],
    dotsPrintable: [696, 271],
    rightMargin: 12,
    feedMargin: 0,
  },
  "62x100": {
    tapeSize: [62, 100],
    dots: [732, 1179],
    dotsPrintable: [696, 1109],
    rightMargin: 12,
    feedMargin: 0,
  },
};

export const VendorID = 0x04f9; // Brother Industries, Ltd.

export const USBProductIDs: number[] = [
  0x2015, // QL-500
  0x2016, // QL-550
  0x2027, // QL-560
  0x2028, // QL-570
  0x2029, // QL-580N
  0x201b, // QL-650TD
  0x2042, // QL-700
  0x2020, // QL-1050
  0x202a, // QL-1060N
];
