import {
  TERRAIN_TRAVEL_COSTS,
  IMPASSABLE_TERRAIN,
  MIN_TERRAIN_COST,
} from '../common/constants/travel.constants';

export interface Coordinate {
  x: number;
  y: number;
}

/**
 * A* pathfinding on the 100×100 terrain grid.
 *
 * - 4-directional movement (no diagonals)
 * - Avoids ocean and out-of-bounds cells
 * - Cost = real-world seconds based on TERRAIN_TRAVEL_COSTS
 * - Heuristic = Manhattan distance × MIN_TERRAIN_COST (admissible)
 *
 * @returns Array of coordinates from start to goal (inclusive), or null if unreachable.
 */
export function findPath(
  start: Coordinate,
  goal: Coordinate,
  getTerrainAt: (x: number, y: number) => string | null,
): Coordinate[] | null {
  const key = (x: number, y: number) => `${x},${y}`;
  const startKey = key(start.x, start.y);
  const goalKey = key(goal.x, goal.y);

  // Quick checks
  const goalTerrain = getTerrainAt(goal.x, goal.y);
  if (!goalTerrain || IMPASSABLE_TERRAIN.has(goalTerrain)) return null;

  if (startKey === goalKey) return [{ ...start }];

  // g-costs and parent tracking
  const gScore = new Map<string, number>();
  gScore.set(startKey, 0);

  const cameFrom = new Map<string, string>();

  // f-score = g + heuristic
  const fScore = new Map<string, number>();
  const h = (x: number, y: number) =>
    (Math.abs(x - goal.x) + Math.abs(y - goal.y)) * MIN_TERRAIN_COST;
  fScore.set(startKey, h(start.x, start.y));

  // Open set as a binary min-heap
  const open: { key: string; x: number; y: number; f: number }[] = [
    { key: startKey, x: start.x, y: start.y, f: fScore.get(startKey)! },
  ];
  const inOpen = new Set<string>([startKey]);
  const closed = new Set<string>();

  // Heap operations
  const swap = (i: number, j: number) => {
    [open[i], open[j]] = [open[j], open[i]];
  };
  const bubbleUp = (i: number) => {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (open[parent].f <= open[i].f) break;
      swap(i, parent);
      i = parent;
    }
  };
  const sinkDown = (i: number) => {
    const n = open.length;
    while (true) {
      let smallest = i;
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      if (left < n && open[left].f < open[smallest].f) smallest = left;
      if (right < n && open[right].f < open[smallest].f) smallest = right;
      if (smallest === i) break;
      swap(i, smallest);
      i = smallest;
    }
  };
  const heapPop = () => {
    const top = open[0];
    const last = open.pop()!;
    if (open.length > 0) {
      open[0] = last;
      sinkDown(0);
    }
    inOpen.delete(top.key);
    return top;
  };
  const heapPush = (item: (typeof open)[0]) => {
    open.push(item);
    inOpen.add(item.key);
    bubbleUp(open.length - 1);
  };

  const DX = [0, 0, 1, -1];
  const DY = [-1, 1, 0, 0];

  while (open.length > 0) {
    const current = heapPop();
    if (current.key === goalKey) {
      // Reconstruct path
      const path: Coordinate[] = [];
      let k: string | undefined = goalKey;
      while (k !== undefined) {
        const [cx, cy] = k.split(',').map(Number);
        path.push({ x: cx, y: cy });
        k = cameFrom.get(k);
      }
      path.reverse();
      return path;
    }

    closed.add(current.key);

    for (let d = 0; d < 4; d++) {
      const nx = current.x + DX[d];
      const ny = current.y + DY[d];
      const nKey = key(nx, ny);

      if (closed.has(nKey)) continue;

      const terrain = getTerrainAt(nx, ny);
      if (!terrain || IMPASSABLE_TERRAIN.has(terrain)) continue;

      const cost = TERRAIN_TRAVEL_COSTS[terrain];
      if (cost === undefined) continue; // unknown terrain type

      const tentativeG = gScore.get(current.key)! + cost;
      const prevG = gScore.get(nKey);

      if (prevG !== undefined && tentativeG >= prevG) continue;

      cameFrom.set(nKey, current.key);
      gScore.set(nKey, tentativeG);
      const f = tentativeG + h(nx, ny);
      fScore.set(nKey, f);

      if (!inOpen.has(nKey)) {
        heapPush({ key: nKey, x: nx, y: ny, f });
      } else {
        // Update existing node in heap (remove and re-add for simplicity)
        const idx = open.findIndex((o) => o.key === nKey);
        if (idx !== -1) {
          open[idx].f = f;
          bubbleUp(idx);
        }
      }
    }
  }

  return null; // No path found
}

/**
 * Compute cumulative travel times for each step in a path.
 * stepTimes[0] = 0 (start), stepTimes[i] = seconds to reach path[i] from path[0].
 */
export function computeStepTimes(
  path: Coordinate[],
  getTerrainAt: (x: number, y: number) => string | null,
): number[] {
  const times: number[] = [0];
  for (let i = 1; i < path.length; i++) {
    const terrain = getTerrainAt(path[i].x, path[i].y);
    const cost = terrain ? (TERRAIN_TRAVEL_COSTS[terrain] ?? 10) : 10;
    times.push(times[i - 1] + cost);
  }
  return times;
}
