// What each room tends to pay, from data/delve.json. Shared by runs and Leaders.
import { DELVE } from './data';
import type { NodeType } from './delve';

export const LOOT = DELVE.loot as Partial<Record<NodeType, [number, number]>>;

/** Expected loot value of a room type on a floor (item values average 1.0× their base). */
export function lootValue(type: NodeType | '?', floor: number): number {
  const l = type === '?' ? LOOT.fight : LOOT[type];
  return l ? l[0] * l[1] * floor : 0;
}
