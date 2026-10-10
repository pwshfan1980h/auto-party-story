export type DamageType = 'slash' | 'pierce' | 'blunt' | 'fire' | 'frost' | 'storm' | 'holy' | 'shadow' | 'poison';
export const PHYSICAL: ReadonlySet<DamageType> = new Set(['slash', 'pierce', 'blunt']);

export type Team = 0 | 1;
export type Zone = 'front' | 'middle' | 'back';
export type Role = 'tank' | 'heal' | 'striker' | 'bruiser' | 'artillery' | 'area' | 'control' | 'support' | 'summon' | 'utility';
export type RankId = 'minion' | 'normal' | 'veteran' | 'elite' | 'champion' | 'boss';
export type RoomType = 'normal' | 'elite' | 'horde' | 'boss';

export interface Stats {
  maxHp: number;
  power: number;
  spell: number;
  armor: number;
  resist: Partial<Record<DamageType, number>>;
  atkSpeed: number;
  move: number;
  crit: number;
  critMult: number;
  evasion: number;
  /** Chance to turn aside a melee blow from the front. */
  parry: number;
  /** Chance to stop a blow from the front: mostly from a shield, a little from a weapon. */
  block: number;
  /** 1 when the shield also stops missiles. */
  blockMissiles: number;
  /** Chance that a parry knocks the attacker's weapon away. */
  disarm: number;
  /** 1 when fighting with a held weapon (one that can be knocked away). */
  armed: number;
  accuracy: number;
  energyGain: number;
  healPower: number;
  healTaken: number;
  radius: number;
}

export interface Attrs {
  might: number;
  agility: number;
  arcana: number;
  vigor: number;
}

// ---- abilities and effects (spec 03) ----

export type Delivery = 'melee' | 'projectile' | 'telegraph' | 'self';
export type Affects = 'target' | 'enemies' | 'allies' | 'self';

export interface Area {
  shape: 'circle' | 'cone';
  r: number;
  /** Cone width in degrees. */
  angle?: number;
  /** Where the area is centred. */
  at: 'target' | 'self';
}

export type Effect =
  | { type: 'damage'; dmgType: DamageType; base: number; scale: number; vsTag?: Record<string, number>; ifTargetHpBelow?: number; mult?: number }
  | { type: 'heal'; base: number; scale: number }
  | { type: 'shield'; base: number; scale: number; dur: number }
  | { type: 'status'; status: string; dur: number; chance?: number; stacks?: number }
  | { type: 'cleanse'; count: number }
  | { type: 'knockback'; dist: number }
  | { type: 'dash'; to: 'behind' | 'target' }
  | { type: 'taunt'; dur: number }
  | { type: 'summon'; enemy: string; count: number; max: number; dur?: number }
  | { type: 'energy'; amount: number }
  | { type: 'revive'; hpPct: number }
  | { type: 'explode' };

export interface AbilityDef {
  id: string;
  name: string;
  kind: 'basic' | 'skill' | 'ult';
  range: number;
  windup: number;
  cooldown?: number;
  delivery: Delivery;
  affects: Affects;
  area?: Area;
  projectile?: { speed: number };
  telegraph?: { delay: number };
  effects: Effect[];
  /** Melee and single-target projectiles can be dodged. */
  dodgeable?: boolean;
  /** Ally-targeted ability (heals, buffs). */
  friendly?: boolean;
  /** Bonus multiplier when hitting from behind (Backstab). */
  behindMult?: number;
  /** Hitting a winding-up enemy cancels its action. */
  interrupts?: boolean;
  cine?: number;
}

export interface StatusDef {
  id: string;
  kind: 'buff' | 'debuff' | 'cc';
  stacking: 'refresh' | 'stack';
  maxStacks?: number;
  /** Damage or heal applied every 0.5 s per stack. */
  tick?: { dmgType?: DamageType; dmg?: number; heal?: number; ofCasterSpell?: number };
  mods?: Partial<Record<'power' | 'spell' | 'armor' | 'move' | 'atkSpeed' | 'healTaken' | 'damageDealt' | 'damageTaken' | 'evasion', number>>;
  flags?: ('stun' | 'root' | 'sleep' | 'downed' | 'taunted' | 'fear')[];
  /** Removed when the unit takes damage (sleep). */
  breakOnDamage?: boolean;
}

// ---- behaviour rules (spec 06) ----

export type CondToken = string; // e.g. "always", "allyHpBelow:0.45", "enemiesInRange:3:1.8"
export type TargetToken = string; // e.g. "nearest", "lowestHpPct", "backline"
export type IntentToken = string; // e.g. "approach", "kite:4", "flank", "screen", "regroup"

export interface RuleDef {
  if: CondToken;
  use: 'basic' | 'skill' | 'ult' | 'revive';
  /** Which skill, when the unit has more than one. */
  skill?: string;
  on: TargetToken;
  move?: IntentToken;
  text?: string;
}
