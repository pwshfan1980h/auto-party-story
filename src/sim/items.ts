// Equipment heroes find and wear (data/items.json): what goes in which slot, and who can use it.
import { CLASSES, ITEMS, type ItemDef } from './data';

export const SLOTS = ['weapon', 'shield', 'armour', 'trinket'] as const;
export type Slot = (typeof SLOTS)[number];
const RANGED_OR_CASTING = new Set(['bow', 'staff', 'lute', 'flask']);

/** Can this class use this item? Archers keep bows and casters keep staves; melee fighters swap blades; shields need a shield arm. */
export function canEquip(classId: string, itemId: string): boolean {
  const it = ITEMS[itemId], c = CLASSES[classId];
  if (!it || !c) return false;
  if (it.slot === 'shield') return !!c.gear?.shield;
  if (it.slot === 'weapon') {
    const own = c.gear?.weapon ?? '';
    if (RANGED_OR_CASTING.has(own) || RANGED_OR_CASTING.has(it.gear ?? '')) return own === it.gear;
    return true;
  }
  return true;
}

/** The item a hero has in a slot, if any. */
export function inSlot(items: string[] | undefined, slot: Slot): ItemDef | undefined {
  for (const id of items ?? []) if (ITEMS[id]?.slot === slot) return ITEMS[id];
  return undefined;
}
