// Body specs for every race: proportions, colour ranges and features. Cosmetic only (no stats).
import type { Color } from './kit';
import { P } from './palette';

export type Feature =
  | 'beard' | 'pointyEars' | 'smallEars' | 'bigEars' | 'bigNose' | 'tusks' | 'brow' | 'curly' | 'bareFeet'
  | 'snout' | 'tail' | 'crest' | 'catEars' | 'whiskers' | 'mushroomCap' | 'boneFace' | 'glowEyes'
  | 'plating' | 'visor' | 'wings' | 'float' | 'horns' | 'fur';

export interface BodySpec {
  name: string;
  skins: Color[];
  /** null: no hair (scales, plating, caps). */
  hairs: Color[] | null;
  /** Base proportions in voxels (an "average" member of the race). */
  leg: number;
  torso: number;
  torsoW: number;
  torsoD: number;
  head: [number, number, number];
  arm: number;
  /** Seeded height offset range, split between legs and torso. */
  height: [number, number];
  /** Seeded weight offset range, added to torso width (and depth when heavy). */
  weight: [number, number];
  /** Chance of a beard by sex. */
  beard?: { m: number; f: number };
  features: Feature[];
  eyes?: Color;
  /** Mushroom cap or crest colours, when the race has one. */
  accents?: Color[];
}

export const RACE_BODIES: Record<string, BodySpec> = {
  human: {
    name: 'Human', skins: [P.skinPale, P.skinFair, P.skinTan, P.skinBrown, P.skinDeep],
    hairs: [P.hairBlack, P.hairBrown, P.hairChestnut, P.hairRed, P.hairBlond, P.hairGrey],
    leg: 6, torso: 8, torsoW: 9, torsoD: 5, head: [11, 10, 10], arm: 7, height: [-1, 2], weight: [-1, 2], beard: { m: 0.3, f: 0 }, features: [],
  },
  dwarf: {
    name: 'Dwarf', skins: [P.skinFair, P.skinTan, P.skinBrown, P.skinPale],
    hairs: [P.hairRed, P.hairChestnut, P.hairBrown, P.hairBlack, P.hairGrey, P.hairWhite],
    leg: 4, torso: 8, torsoW: 11, torsoD: 6, head: [11, 10, 10], arm: 6, height: [-1, 1], weight: [0, 2], beard: { m: 0.95, f: 0.3 }, features: ['beard', 'bigNose'],
  },
  elf: {
    name: 'Elf', skins: [P.skinPale, P.skinFair, 0xe8d6c4, P.skinTan],
    hairs: [P.hairBlond, P.hairWhite, P.hairBlack, P.hairChestnut, 0xc4d4ec],
    leg: 8, torso: 9, torsoW: 7, torsoD: 5, head: [9, 10, 9], arm: 8, height: [0, 2], weight: [-1, 1], features: ['pointyEars'],
  },
  halfling: {
    name: 'Halfling', skins: [P.skinFair, P.skinTan, P.skinBrown, P.skinPale],
    hairs: [P.hairBrown, P.hairChestnut, P.hairBlond, P.hairBlack, P.hairRed],
    leg: 4, torso: 7, torsoW: 9, torsoD: 5, head: [11, 10, 10], arm: 6, height: [-1, 1], weight: [-1, 2], features: ['curly', 'bareFeet', 'smallEars'],
  },
  orc: {
    name: 'Orc', skins: [P.orc, P.orcDark, 0x7c8c48, 0x5c8a5a],
    hairs: [P.hairBlack, P.hairBrown, P.hairGrey],
    leg: 6, torso: 9, torsoW: 11, torsoD: 6, head: [11, 10, 10], arm: 8, height: [0, 2], weight: [0, 2], features: ['tusks', 'brow', 'smallEars'],
  },
  gnome: {
    name: 'Gnome', skins: [P.skinPale, P.skinFair, P.skinTan],
    hairs: [P.hairWhite, P.hairRed, 0x5aa8dc, P.hairBlond, 0xd878b0],
    leg: 4, torso: 7, torsoW: 9, torsoD: 5, head: [11, 10, 10], arm: 6, height: [-1, 1], weight: [-1, 1], beard: { m: 0.45, f: 0 }, features: ['bigNose', 'smallEars'],
  },
  goblin: {
    name: 'Goblin', skins: [P.goblin, P.goblinDark, 0xa8c060, 0x8aa858],
    hairs: [P.hairBlack, P.hairBrown, P.hairGrey],
    leg: 4, torso: 6, torsoW: 7, torsoD: 5, head: [11, 9, 10], arm: 6, height: [-1, 1], weight: [-1, 1], features: ['bigEars', 'bigNose'],
  },
  lizardfolk: {
    name: 'Lizardfolk', skins: [0x4f8a5a, 0x6aa060, 0x3f7a6a, 0x8a9a4a], hairs: null,
    leg: 6, torso: 8, torsoW: 9, torsoD: 6, head: [9, 8, 9], arm: 7, height: [0, 2], weight: [-1, 1], features: ['snout', 'tail', 'crest'],
    accents: [P.red, P.orange, P.yellow, P.teal], eyes: P.yellow,
  },
  catfolk: {
    name: 'Catfolk', skins: [0xd89a50, 0x8a7a6a, 0x3a3440, 0xe8d8c0, 0xb07a4a], hairs: null,
    leg: 6, torso: 8, torsoW: 7, torsoD: 5, head: [11, 10, 9], arm: 7, height: [-1, 1], weight: [-1, 1], features: ['catEars', 'tail', 'whiskers', 'fur'], eyes: 0x5ab04a,
  },
  myconid: {
    name: 'Myconid', skins: [0xeadfc4, 0xd8c8a8, 0xe4d4bc], hairs: null,
    leg: 5, torso: 8, torsoW: 9, torsoD: 6, head: [9, 7, 9], arm: 6, height: [-1, 2], weight: [0, 2], features: ['mushroomCap'],
    accents: [P.red, P.brown, P.purple, P.teal, P.orange],
  },
  revenant: {
    name: 'Revenant', skins: [P.bone, P.boneShadow], hairs: [P.hairBlack, P.hairGrey, P.hairWhite],
    leg: 6, torso: 8, torsoW: 9, torsoD: 5, head: [10, 10, 10], arm: 7, height: [-1, 1], weight: [-1, 0], features: ['boneFace', 'glowEyes'], eyes: P.glowCyan,
  },
  construct: {
    name: 'Construct', skins: [P.steel, P.bronze, P.iron, 0x8a7a5a], hairs: null,
    leg: 6, torso: 9, torsoW: 11, torsoD: 7, head: [9, 8, 9], arm: 8, height: [0, 2], weight: [0, 2], features: ['plating', 'visor', 'glowEyes'], eyes: P.flame,
  },
  sprite: {
    name: 'Sprite', skins: [P.skinPale, 0xd0f0e0, 0xf0d0e8, 0xd8e4ff],
    hairs: [0xf0a0d0, 0x90e0f0, P.hairBlond, P.hairWhite, 0xb0f090],
    leg: 4, torso: 5, torsoW: 5, torsoD: 4, head: [9, 9, 8], arm: 5, height: [-1, 1], weight: [-1, 0], features: ['wings', 'pointyEars', 'float'],
  },
  demonkin: {
    name: 'Demonkin', skins: [0xb04a4a, 0x8a3a5a, 0x6a3a7a, 0xd06a5a], hairs: [P.hairBlack, 0x2a1a2a, P.hairWhite, 0x5a1a2a],
    leg: 6, torso: 8, torsoW: 9, torsoD: 5, head: [11, 10, 10], arm: 7, height: [0, 2], weight: [-1, 1], features: ['horns', 'tail', 'glowEyes'], eyes: P.glowRed,
  },
};

export const HAIR_STYLES = ['short', 'crop', 'long', 'ponytail', 'bun', 'spiky', 'braids', 'mohawk', 'bald'] as const;
export type HairStyle = (typeof HAIR_STYLES)[number] | 'curly';
