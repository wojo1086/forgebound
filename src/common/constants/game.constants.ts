export const ABILITIES = [
  'strength',
  'dexterity',
  'constitution',
  'intelligence',
  'wisdom',
  'charisma',
] as const;
export type Ability = (typeof ABILITIES)[number];

/**
 * D&D 5e point buy cost table.
 * Key = ability score (before racial bonuses), Value = cumulative cost from base of 8.
 */
export const POINT_BUY_COSTS: Record<number, number> = {
  8: 0,
  9: 1,
  10: 2,
  11: 3,
  12: 4,
  13: 5,
  14: 7,
  15: 9,
};

export const POINT_BUY_BUDGET = 27;
export const ABILITY_MIN = 8;
export const ABILITY_MAX = 15;

/** Standard D&D ability modifier: floor((score - 10) / 2) */
export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}
