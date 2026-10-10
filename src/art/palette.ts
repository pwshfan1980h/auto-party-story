// The unit palette: warm, saturated pixel-art colours with a dark ink for outlines and eyes.
// Inspired by classic 16-bit fantasy sprites; all values are original.
export const P = {
  ink: 0x1d1622,
  eyeWhite: 0xf4eedc,

  // skin
  skinPale: 0xf6d5b4, skinFair: 0xeec39a, skinTan: 0xd49a6a, skinBrown: 0x9c6440, skinDeep: 0x6e4430,
  orc: 0x6f9a3c, orcDark: 0x557a2c, goblin: 0x9cb546, goblinDark: 0x7a9035, blush: 0xe58f7a,

  // hair
  hairBlack: 0x2b2230, hairBrown: 0x6b4128, hairChestnut: 0x8e4a26, hairRed: 0xb5482a, hairBlond: 0xe8c45a, hairWhite: 0xe8e4dc, hairGrey: 0x9b98a0,

  // metal
  steel: 0xb8c2cc, steelDark: 0x7c8794, steelLight: 0xe2e8ee, iron: 0x5d636e, gold: 0xe8b33c, goldDark: 0xb07f22, bronze: 0xb5713a, rust: 0x9a5530,

  // cloth and leather
  leather: 0x7a4a2a, leatherDark: 0x56331e, leatherLight: 0xa06a3c,
  wood: 0x8a5a33, woodDark: 0x5e3b20,
  white: 0xece6d6, whiteShadow: 0xc8c0ae,
  red: 0xb8322e, redDark: 0x7e1f22, crimson: 0x962036,
  blue: 0x3462b0, blueDark: 0x22427c, sky: 0x6aa6d8,
  purple: 0x6e3c9c, purpleDark: 0x48266a, violet: 0x9a62d0,
  green: 0x3f8a3e, greenDark: 0x2a5e2c, forest: 0x2f6a3a, moss: 0x6e8a3a,
  brown: 0x6b4a33, brownDark: 0x4a3222, tan: 0xc9a46c,
  black: 0x2a2530, blackSoft: 0x3c3444,
  orange: 0xd9772a, yellow: 0xf0d050,
  teal: 0x2f8a8a,

  // monsters
  bone: 0xe9e2c8, boneShadow: 0xbfb596, boneDark: 0x8f8670,
  zombie: 0x8aa07a, zombieDark: 0x5e7254, rot: 0x6a5a3e,
  ghost: 0xbcd9f0, ghostDeep: 0x7fa6d0, ghostGlow: 0xe6f6ff,
  ratFur: 0x7b6a5c, ratFurDark: 0x54473d, ratPink: 0xe0a0a0,
  batFur: 0x4c3a52, batWing: 0x6d4a6e, batWingDark: 0x4a3050,
  spider: 0x3a2e3a, spiderDark: 0x241c26, spiderMark: 0xc23a3a,
  slime: 0x6cc24a, slimeDark: 0x3f8a32, slimeCore: 0x2f6a26,
  glowGreen: 0x8ef06a, glowCyan: 0x7ae8ff, glowRed: 0xff5a3a, glowPurple: 0xc77aff, flame: 0xffa23a,
  glass: 0xa6e0d0,
} as const;
