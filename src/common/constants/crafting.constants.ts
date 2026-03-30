export enum CraftingSkill {
  BLACKSMITHING = 'blacksmithing',
  ALCHEMY = 'alchemy',
  WOODWORKING = 'woodworking',
}

/** XP thresholds per level (index = level, value = cumulative XP needed) */
export const CRAFTING_XP_THRESHOLDS = [
  0,    // Level 1 (starting)
  50,   // Level 2
  120,  // Level 3
  220,  // Level 4
  360,  // Level 5
  550,  // Level 6
  800,  // Level 7
  1120, // Level 8
  1520, // Level 9
  2000, // Level 10
];

export const MAX_CRAFTING_LEVEL = 10;

/** POI types for each crafting skill's station */
export const SKILL_STATION_TYPES: Record<CraftingSkill, string> = {
  [CraftingSkill.BLACKSMITHING]: 'forge_station',
  [CraftingSkill.ALCHEMY]: 'alchemy_station',
  [CraftingSkill.WOODWORKING]: 'woodworking_station',
};

/** All valid crafting station POI types */
export const ALL_STATION_TYPES = Object.values(SKILL_STATION_TYPES);
