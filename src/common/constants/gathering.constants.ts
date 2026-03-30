export enum GatheringSkill {
  MINING = 'mining',
  HERBALISM = 'herbalism',
  WOODCUTTING = 'woodcutting',
}

/** XP thresholds per level (index = level, value = cumulative XP needed) */
export const GATHERING_XP_THRESHOLDS = [
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

export const MAX_GATHERING_LEVEL = 10;

/** Which terrain types each gathering skill uses */
export const SKILL_TERRAINS: Record<GatheringSkill, string[]> = {
  [GatheringSkill.MINING]: ['mountain', 'desert'],
  [GatheringSkill.HERBALISM]: ['forest', 'swamp'],
  [GatheringSkill.WOODCUTTING]: ['forest', 'plains'],
};

/** POI types for each gathering skill */
export const SKILL_NODE_TYPES: Record<GatheringSkill, string> = {
  [GatheringSkill.MINING]: 'mining_node',
  [GatheringSkill.HERBALISM]: 'herb_node',
  [GatheringSkill.WOODCUTTING]: 'woodcutting_node',
};
