/* ─── Encounter Rates (chance per cell traveled) ─── */
export const ENCOUNTER_RATES: Record<string, number> = {
  plains: 0.03,
  coast: 0.02,
  forest: 0.08,
  desert: 0.06,
  swamp: 0.10,
  mountain: 0.12,
};

/** POI types that always trigger combat when discovered */
export const GUARANTEED_COMBAT_POIS = new Set([
  'ambush_site',
  'smuggler_den',
]);

/* ─── Monster Scaling ─── */
export const HP_SCALE_FACTOR = 0.3;
export const DMG_SCALE_FACTOR = 0.2;
export const AC_SCALE_DIVISOR = 3;
export const GOLD_SCALE_FACTOR = 0.25;
export const GOLD_VARIANCE = 0.3;

/* ─── Area Level Bands (distance from center 50,50) ─── */
export const MAP_CENTER_X = 50;
export const MAP_CENTER_Y = 50;

export const AREA_LEVEL_BANDS = [
  { maxDistance: 10, minLevel: 1, maxLevel: 3 },
  { maxDistance: 20, minLevel: 2, maxLevel: 5 },
  { maxDistance: 30, minLevel: 3, maxLevel: 7 },
  { maxDistance: 45, minLevel: 5, maxLevel: 9 },
  { maxDistance: Infinity, minLevel: 7, maxLevel: 10 },
];

/* ─── Hit & Damage ─── */
export const CRIT_ROLL = 20;
export const FUMBLE_ROLL = 1;
export const CRIT_DAMAGE_MULTIPLIER = 2;
export const UNARMED_DAMAGE_MIN = 1;
export const UNARMED_DAMAGE_MAX = 1;

/* ─── Flee ─── */
export const FLEE_BASE_CHANCE = 0.40;
export const FLEE_DEX_BONUS = 0.05;
export const FLEE_MAX_CHANCE = 0.85;
export const FLEE_MIN_CHANCE = 0.15;

/* ─── Loot Rolls by Tier ─── */
export const LOOT_ROLLS: Record<string, number> = {
  normal: 1,
  elite: 2,
  boss: 3,
};

/* ─── Death Penalty ─── */
export const DEATH_GOLD_PENALTY = 0.10;
export const DEATH_XP_PENALTY = 0.10;
export const RESPAWN_HP_FRACTION = 0.25;
export const RESPAWN_MANA_FRACTION = 0.25;
