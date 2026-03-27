/** Seconds of real-world time per cell traversal, keyed by terrain type */
export const TERRAIN_TRAVEL_COSTS: Record<string, number> = {
  plains: 10,
  coast: 15,
  forest: 20,
  desert: 25,
  swamp: 30,
  mountain: 45,
};

/** Terrain types that cannot be traversed */
export const IMPASSABLE_TERRAIN = new Set(['ocean']);

/** Direction vectors for step-based movement */
export const DIRECTIONS: Record<string, { dx: number; dy: number }> = {
  north: { dx: 0, dy: -1 },
  south: { dx: 0, dy: 1 },
  east: { dx: 1, dy: 0 },
  west: { dx: -1, dy: 0 },
};

/** Minimum terrain cost — used as A* heuristic multiplier */
export const MIN_TERRAIN_COST = Math.min(
  ...Object.values(TERRAIN_TRAVEL_COSTS),
);
