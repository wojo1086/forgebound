export const SPELL_SCHOOLS = [
  'evocation',
  'restoration',
  'abjuration',
  'conjuration',
  'enchantment',
  'necromancy',
  'divination',
  'transmutation',
] as const;

export type SpellSchool = (typeof SPELL_SCHOOLS)[number];

export const DAMAGE_TYPES = [
  'fire',
  'ice',
  'lightning',
  'holy',
  'shadow',
  'arcane',
  'poison',
  'physical',
] as const;

export type DamageType = (typeof DAMAGE_TYPES)[number];

export const TARGET_TYPES = ['self', 'enemy', 'ally', 'area'] as const;

export type TargetType = (typeof TARGET_TYPES)[number];

/** Base mana pool per class */
export const CLASS_MANA_BASE: Record<string, number> = {
  warrior: 20,
  mage: 100,
  rogue: 40,
  cleric: 80,
  ranger: 60,
};

/** Spells at or below this level can be learned via /spells/learn.
 *  Higher-level spells require spell scroll items. */
export const AUTO_LEARN_MAX_LEVEL = 3;

/** Spells granted automatically at character creation */
export const STARTING_SPELLS: Record<string, string[]> = {
  warrior: ['battle-cry'],
  mage: ['magic-missile', 'frost-bolt', 'arcane-shield'],
  rogue: ['shadow-step', 'poison-blade'],
  cleric: ['heal', 'holy-light', 'bless'],
  ranger: ['natures-blessing', 'hunters-mark'],
};
