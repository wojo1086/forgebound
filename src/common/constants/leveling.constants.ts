import { abilityModifier } from './game.constants';
import { CLASS_MANA_BASE } from './spells.constants';

/* ─── Level Cap ─── */

export const LEVEL_CAP = 20;

/* ─── XP Thresholds ───
 * Cumulative XP needed to reach each level. Index = level.
 * Early levels are fast (100-300 XP), later levels require 2000-3000 each.
 */
export const XP_THRESHOLDS: number[] = [
  0,      // index 0 (unused)
  0,      // level 1 — starting level
  100,    // level 2
  300,    // level 3
  600,    // level 4
  1000,   // level 5 — unlocks spell_level 2 spells
  1500,   // level 6
  2100,   // level 7 — unlocks spell_level 3 (auto) + spell_level 4 (scrolls)
  2800,   // level 8
  3600,   // level 9
  4500,   // level 10 — unlocks spell_level 5 (scrolls)
  5500,   // level 11
  6600,   // level 12 — epic gear
  7800,   // level 13
  9200,   // level 14
  10800,  // level 15 — legendary gear
  12600,  // level 16
  14600,  // level 17
  17000,  // level 18
  19800,  // level 19
  23000,  // level 20 — cap
];

/* ─── XP Sources ─── */

/** XP awarded for discovering a hidden POI, keyed by POI type */
export const DISCOVERY_XP: Record<string, number> = {
  crystal_node: 75,
  secret_cave: 60,
  ancient_tomb: 55,
  treasure_cache: 50,
  fairy_ring: 50,
  shipwreck: 45,
  smuggler_den: 45,
  shrine: 40,
  hidden_spring: 35,
  herb_patch: 30,
  abandoned_camp: 25,
  ambush_site: 20,
};

/** XP for visiting a town for the first time */
export const TOWN_FIRST_VISIT_XP = 100;

/** XP per cell traversed during travel */
export const TRAVEL_XP_PER_CELL = 1;

/* ─── HP Scaling ───
 * Formula: (10 + CON_mod) + (level - 1) * (CLASS_HP_PER_LEVEL + CON_mod)
 * Warriors are the tankiest, mages are the squishiest.
 */
export const CLASS_HP_PER_LEVEL: Record<string, number> = {
  warrior: 7,
  cleric: 6,
  ranger: 5,
  rogue: 5,
  mage: 4,
};

/* ─── Mana Scaling ───
 * Formula: CLASS_MANA_BASE + (level - 1) * (CLASS_MANA_PER_LEVEL + max(0, INT_mod))
 * Intelligence investment rewards casters with more mana per level.
 */
export const CLASS_MANA_PER_LEVEL: Record<string, number> = {
  warrior: 3,
  mage: 12,
  rogue: 5,
  cleric: 10,
  ranger: 7,
};

/* ─── Stat Allocation ─── */

/** Stat points granted per level-up */
export const STAT_POINTS_PER_LEVEL = 1;

/** Maximum ability score before equipment bonuses */
export const STAT_CAP = 20;

/** Valid ability score names */
export const ABILITY_NAMES = [
  'strength', 'dexterity', 'constitution',
  'intelligence', 'wisdom', 'charisma',
] as const;

/* ─── Helper Functions ─── */

/** Returns the level for a given cumulative XP total */
export function levelForXp(xp: number): number {
  for (let lvl = LEVEL_CAP; lvl >= 1; lvl--) {
    if (xp >= XP_THRESHOLDS[lvl]) return lvl;
  }
  return 1;
}

/** Returns the XP threshold for the next level, or null if at cap */
export function xpForNextLevel(level: number): number | null {
  if (level >= LEVEL_CAP) return null;
  return XP_THRESHOLDS[level + 1];
}

/** Calculate max HP for a character */
export function calculateMaxHp(
  level: number,
  classId: string,
  constitution: number,
): number {
  const conMod = abilityModifier(constitution);
  const hpPerLevel = CLASS_HP_PER_LEVEL[classId] ?? 5;
  return (10 + conMod) + (level - 1) * (hpPerLevel + conMod);
}

/** Calculate max mana for a character */
export function calculateMaxMana(
  level: number,
  classId: string,
  intelligence: number,
): number {
  const intMod = Math.max(0, abilityModifier(intelligence));
  const manaPerLevel = CLASS_MANA_PER_LEVEL[classId] ?? 5;
  const base = CLASS_MANA_BASE[classId] ?? 20;
  return base + (level - 1) * (manaPerLevel + intMod);
}
