// What each room tends to pay: [items, value per item per floor]. Shared by runs and Leaders.
import type { NodeType } from './delve';

export const LOOT: Partial<Record<NodeType, [number, number]>> = { fight: [1, 10], elite: [2, 16], horde: [3, 14], boss: [4, 30], treasure: [2, 14], event: [1, 8] };

/** Expected loot value of a room type on a floor (item values average 1.0× their base). */
export function lootValue(type: NodeType | '?', floor: number): number {
  const l = type === '?' ? LOOT.fight! : LOOT[type];
  return l ? l[0] * l[1] * floor : 0;
}
