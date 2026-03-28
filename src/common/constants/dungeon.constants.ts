/* ─── Dungeon-Eligible POI Types ─── */
export const DUNGEON_POI_TYPES = new Set([
  'dungeon',
  'ruins',
  'mine',
  'fortress',
  'ancient_tomb',
  'secret_cave',
  'smuggler_den',
]);

/* ─── Room Counts by POI Category ─── */
export const ROOM_COUNT = {
  landmark: { min: 5, max: 8 },
  hidden: { min: 3, max: 5 },
};

/* ─── Room Type Weights (boss is always last, not rolled) ─── */
export const ROOM_WEIGHTS: Record<string, number> = {
  combat: 40,
  treasure: 20,
  trap: 20,
  rest: 20,
};

/* ─── Trap Rooms ─── */
export const TRAP_DAMAGE_FRACTION = 0.15;
export const TRAP_AVOID_BASE = 0.4;
export const TRAP_DEX_BONUS = 0.05;
export const TRAP_MAX_AVOID = 0.85;
export const TRAP_MIN_AVOID = 0.15;

/* ─── Rest Rooms ─── */
export const DUNGEON_REST_HP_FRACTION = 0.3;
export const DUNGEON_REST_MANA_FRACTION = 0.3;

/* ─── Treasure Rooms ─── */
export const TREASURE_ROOM_ROLLS = 2;
export const TREASURE_GOLD_MIN = 10;
export const TREASURE_GOLD_MAX = 50;
export const TREASURE_GOLD_LEVEL_SCALE = 5;

/* ─── Boss Room Bonus ─── */
export const BOSS_BONUS_XP_MULTIPLIER = 1.5;
export const BOSS_BONUS_GOLD_MULTIPLIER = 2.0;

/* ─── Dungeon Completion Bonus ─── */
export const COMPLETION_XP_BASE = 50;
export const COMPLETION_XP_PER_LEVEL = 25;
export const COMPLETION_GOLD_BASE = 30;
export const COMPLETION_GOLD_PER_LEVEL = 15;

/* ─── Cooldown (ms) ─── */
export const DUNGEON_RESET_COOLDOWN = 24 * 60 * 60 * 1000; // 24 hours
