/* ─── Status Effects System ─── */

export enum StatusEffectType {
  POISON = 'poison',
  BLEED = 'bleed',
  STUN = 'stun',
  BURN = 'burn',
  WEAKNESS = 'weakness',
  SHIELD = 'shield',
  FREEZE = 'freeze',
  REGEN = 'regen',
  BLIND = 'blind',
  SILENCE = 'silence',
  CURSE = 'curse',
  ENRAGE = 'enrage',
}

export interface StatusEffect {
  type: StatusEffectType;
  duration: number;   // turns remaining
  value: number;      // damage/heal per tick, % modifier, flat amount, etc.
  source: string;     // name of ability/spell/weapon that applied it
}

/** Default duration and value for each effect type */
export const STATUS_EFFECT_DEFAULTS: Record<
  StatusEffectType,
  { duration: number; value: number }
> = {
  [StatusEffectType.POISON]:   { duration: 3, value: 5 },
  [StatusEffectType.BLEED]:    { duration: 3, value: 4 },
  [StatusEffectType.STUN]:     { duration: 1, value: 0 },
  [StatusEffectType.BURN]:     { duration: 2, value: 6 },
  [StatusEffectType.WEAKNESS]: { duration: 3, value: 25 }, // 25% outgoing damage reduction
  [StatusEffectType.SHIELD]:   { duration: 3, value: 5 },  // 5 flat damage absorbed per hit
  [StatusEffectType.FREEZE]:   { duration: 1, value: 50 }, // 50% extra incoming damage
  [StatusEffectType.REGEN]:    { duration: 3, value: 5 },
  [StatusEffectType.BLIND]:    { duration: 2, value: 40 }, // 40% miss chance
  [StatusEffectType.SILENCE]:  { duration: 2, value: 0 },
  [StatusEffectType.CURSE]:    { duration: 3, value: 2 },  // -2 to all ability modifiers
  [StatusEffectType.ENRAGE]:   { duration: 3, value: 30 }, // 30% outgoing damage increase
};

/** Effects that prevent the target from acting */
export const INCAPACITATING_EFFECTS = new Set<StatusEffectType>([
  StatusEffectType.STUN,
  StatusEffectType.FREEZE,
]);

/** Damage-over-time effects */
export const DOT_EFFECTS = new Set<StatusEffectType>([
  StatusEffectType.POISON,
  StatusEffectType.BLEED,
  StatusEffectType.BURN,
]);

/** Positive effects (not removed by cleanse) */
export const BUFF_EFFECTS = new Set<StatusEffectType>([
  StatusEffectType.SHIELD,
  StatusEffectType.REGEN,
  StatusEffectType.ENRAGE,
]);

/** Flavor text for DoT damage in combat log */
export const DOT_FLAVOR: Record<string, string> = {
  [StatusEffectType.POISON]: 'takes poison damage',
  [StatusEffectType.BLEED]:  'bleeds',
  [StatusEffectType.BURN]:   'burns',
};

/** Flavor text for effect application */
export const EFFECT_APPLY_FLAVOR: Record<string, string> = {
  [StatusEffectType.POISON]:   'is poisoned',
  [StatusEffectType.BLEED]:    'starts bleeding',
  [StatusEffectType.STUN]:     'is stunned',
  [StatusEffectType.BURN]:     'is set ablaze',
  [StatusEffectType.WEAKNESS]: 'is weakened',
  [StatusEffectType.SHIELD]:   'gains a protective shield',
  [StatusEffectType.FREEZE]:   'is frozen',
  [StatusEffectType.REGEN]:    'begins regenerating',
  [StatusEffectType.BLIND]:    'is blinded',
  [StatusEffectType.SILENCE]:  'is silenced',
  [StatusEffectType.CURSE]:    'is cursed',
  [StatusEffectType.ENRAGE]:   'becomes enraged',
};
