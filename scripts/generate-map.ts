import * as fs from 'fs';
import * as path from 'path';

// ── Seeded PRNG (mulberry32) ────────────────────────────────────────────────
function mulberry32(seed: number) {
  let s = seed | 0;
  return (): number => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(42);

type Terrain = 'ocean' | 'coast' | 'plains' | 'forest' | 'mountain' | 'swamp' | 'desert';

const W = 100;
const H = 100;
const EDGE_MARGIN = 2; // minimum ocean tiles between land and map edge

function dist(x1: number, y1: number, x2: number, y2: number): number {
  return Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function smoothNoise2D(x: number, y: number, scale: number, octaves: number): number {
  let value = 0;
  let amplitude = 1;
  let totalAmp = 0;
  for (let o = 0; o < octaves; o++) {
    const freq = Math.pow(2, o) / scale;
    const gx = x * freq;
    const gy = y * freq;
    const ix = Math.floor(gx);
    const iy = Math.floor(gy);
    const fx = gx - ix;
    const fy = gy - iy;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);

    const v00 = hashNoise(ix, iy, o);
    const v10 = hashNoise(ix + 1, iy, o);
    const v01 = hashNoise(ix, iy + 1, o);
    const v11 = hashNoise(ix + 1, iy + 1, o);

    const top = v00 + sx * (v10 - v00);
    const bot = v01 + sx * (v11 - v01);
    value += (top + sy * (bot - top)) * amplitude;
    totalAmp += amplitude;
    amplitude *= 0.5;
  }
  return value / totalAmp;
}

function hashNoise(ix: number, iy: number, octave: number): number {
  let h = (ix * 374761393 + iy * 668265263 + octave * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = h ^ (h >>> 16);
  return ((h >>> 0) / 4294967296);
}

function neighbors(x: number, y: number): [number, number][] {
  const n: [number, number][] = [];
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx >= 0 && nx < W && ny >= 0 && ny < H) {
      n.push([nx, ny]);
    }
  }
  return n;
}

// ── Step 1: Build continent shape ───────────────────────────────────────────
const landMask: number[][] = [];
const cx = W / 2;
const cy = H / 2;

for (let y = 0; y < H; y++) {
  landMask[y] = [];
  for (let x = 0; x < W; x++) {
    // Normalized distance from center (0 at center, ~1 at edges)
    const dx = (x - cx) / (W / 2);
    const dy = (y - cy) / (H / 2);
    const d = Math.sqrt(dx * dx + dy * dy);

    const angle = Math.atan2(dy, dx);

    // Shape perturbations for irregular coastline
    let radiusMod = 0;
    radiusMod += 0.08 * Math.sin(angle * 2.0 + 1.3);
    radiusMod += 0.06 * Math.sin(angle * 3.0 + 0.7);
    radiusMod += 0.07 * Math.sin(angle * 5.0 - 2.1);
    radiusMod += 0.04 * Math.sin(angle * 7.0 + 4.5);
    radiusMod += 0.03 * Math.sin(angle * 11.0 + 0.3);
    radiusMod += 0.02 * Math.sin(angle * 13.0 - 1.8);

    // Peninsula pushing northwest
    const nwAngle = angle + 2.4;
    radiusMod += 0.10 * Math.exp(-nwAngle * nwAngle * 2);

    // Large bay cutting into the south
    const sAngle = angle - 1.5;
    radiusMod -= 0.10 * Math.exp(-sAngle * sAngle * 3);

    // Peninsula pushing east
    radiusMod += 0.08 * Math.exp(-angle * angle * 4);

    // Smaller bay in the northeast
    const neAngle = angle + 0.8;
    radiusMod -= 0.06 * Math.exp(-neAngle * neAngle * 5);

    // Base radius — leave room for ocean margin at edges
    // With margin=2 on a 100-wide map, we need land to stop ~2 cells from edge
    // That means max radius in normalized coords is about (50-2)/50 = 0.96
    const baseRadius = 0.80 + radiusMod;

    // Noise for coastline irregularity (scaled up for larger map)
    const noise = smoothNoise2D(x, y, 16, 4);
    const noiseMod = (noise - 0.5) * 0.20;

    let landValue = (baseRadius - d) * 2.5 + noiseMod;

    // Hard edge fade — force ocean within EDGE_MARGIN of map border
    const edgeDist = Math.min(x, y, W - 1 - x, H - 1 - y);
    if (edgeDist < EDGE_MARGIN) {
      landValue = -1;
    }

    landMask[y][x] = clamp(landValue, -1, 1);
  }
}

// ── Step 2: Classify into ocean or land ─────────────────────────────────────
const grid: Terrain[][] = [];

for (let y = 0; y < H; y++) {
  grid[y] = [];
  for (let x = 0; x < W; x++) {
    grid[y][x] = landMask[y][x] < 0.05 ? 'ocean' : 'plains';
  }
}

// ── Step 3: Overlay biomes (all positions scaled 2x from 50x50) ─────────────

// Mountains — multiple distinct ranges and peaks
function isMountain(x: number, y: number): boolean {
  // Main range: jagged spine running west-to-east in the northern third
  const spineY = 36
    + 5.0 * Math.sin(x * 0.075 + 0.5)
    + 4.0 * Math.sin(x * 0.15 - 1.2)
    + 3.0 * Math.sin(x * 0.25 + 2.0);
  const distFromSpine = Math.abs(y - spineY);
  const width = 4.0 + 2.5 * Math.sin(x * 0.1 + 0.8) + smoothNoise2D(x, y, 12, 2) * 2.5;
  if (distFromSpine < width && x > 12 && x < 88) return true;

  // Southern highland cluster
  if (dist(x, y, 56, 60) < 5 + smoothNoise2D(x, y, 8, 2) * 2.5) return true;

  // Western isolated peaks
  if (dist(x, y, 22, 55) < 3 + smoothNoise2D(x, y, 5, 2) * 1.5) return true;

  // Northeastern ridge
  const neSpineY = 25 + 2.0 * Math.sin(x * 0.2 + 3.0);
  if (Math.abs(y - neSpineY) < 2 && x > 65 && x < 85) return true;

  // Southeast volcanic peak
  if (dist(x, y, 75, 70) < 3 + smoothNoise2D(x, y, 4, 2) * 1.5) return true;

  return false;
}

// Forests — multiple distinct woodland regions
function forestWeight(x: number, y: number): number {
  let w = 0;
  // Large eastern Greenwood
  w += Math.max(0, 1 - dist(x, y, 76, 48) / 18) * 0.8;
  // Northwest old-growth forest
  w += Math.max(0, 1 - dist(x, y, 28, 28) / 14) * 0.7;
  // Southern pine forest
  w += Math.max(0, 1 - dist(x, y, 55, 78) / 10) * 0.65;
  // Central woodland between mountain ranges
  w += Math.max(0, 1 - dist(x, y, 45, 45) / 8) * 0.5;
  // Northeastern coastal woods
  w += Math.max(0, 1 - dist(x, y, 80, 30) / 8) * 0.55;
  // Western thicket
  w += Math.max(0, 1 - dist(x, y, 18, 50) / 7) * 0.5;
  // Scattered patches via noise
  const fn = smoothNoise2D(x + 100, y + 100, 14, 3);
  w += fn > 0.62 ? (fn - 0.62) * 2.0 : 0;
  return clamp(w, 0, 1);
}

// Swamps — multiple marshy lowlands
function swampWeight(x: number, y: number): number {
  let w = 0;
  // Main southeastern swamp
  w += Math.max(0, 1 - dist(x, y, 65, 72) / 12) * 1.0;
  // Eastern marshes
  w += Math.max(0, 1 - dist(x, y, 78, 60) / 7) * 0.6;
  // Small central bog
  w += Math.max(0, 1 - dist(x, y, 48, 55) / 5) * 0.5;
  // Western wetlands near coast
  w += Math.max(0, 1 - dist(x, y, 15, 65) / 6) * 0.5;
  const sn = smoothNoise2D(x + 200, y + 200, 10, 2);
  w *= 0.6 + sn * 0.6;
  return clamp(w, 0, 1);
}

// Deserts — southwest arid region + secondary patches
function desertWeight(x: number, y: number): number {
  let w = 0;
  // Main southwest desert
  w += Math.max(0, 1 - dist(x, y, 28, 70) / 12) * 0.85;
  // Secondary arid badlands
  w += Math.max(0, 1 - dist(x, y, 38, 60) / 7) * 0.55;
  // Small northern dry steppe
  w += Math.max(0, 1 - dist(x, y, 50, 28) / 5) * 0.4;
  const dn = smoothNoise2D(x + 300, y + 300, 10, 2);
  w *= 0.4 + dn * 0.8;
  return clamp(w, 0, 1);
}

for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    if (grid[y][x] !== 'plains') continue;

    if (isMountain(x, y)) {
      grid[y][x] = 'mountain';
      continue;
    }

    const fw = forestWeight(x, y);
    const sw = swampWeight(x, y);
    const dw = desertWeight(x, y);

    const maxW = Math.max(fw, sw, dw);
    if (maxW > 0.25) {
      if (fw === maxW) grid[y][x] = 'forest';
      else if (sw === maxW) grid[y][x] = 'swamp';
      else grid[y][x] = 'desert';
    }
  }
}

// ── Step 4: Inland lakes (more and bigger for 100x100) ──────────────────────
const lakeSeeds: [number, number, number][] = [
  [44, 52, 3.5],  // center lake
  [70, 32, 3.0],  // northeast lake
  [36, 64, 2.5],  // south-center lake
  [20, 45, 2.0],  // western lake
  [80, 58, 2.2],  // eastern lake
];

for (const [lx, ly, lr] of lakeSeeds) {
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const d = dist(x, y, lx, ly);
      const noiseMod = smoothNoise2D(x + 500, y + 500, 6, 2) * 1.5;
      if (d < lr + noiseMod) {
        if (grid[y][x] !== 'ocean') {
          grid[y][x] = 'ocean';
        }
      }
    }
  }
}

// ── Step 5: Generate coast ONLY as transition between land and ocean ────────
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    if (grid[y][x] === 'ocean') continue;
    for (const [nx, ny] of neighbors(x, y)) {
      if (grid[ny][nx] === 'ocean') {
        grid[y][x] = 'coast';
        break;
      }
    }
  }
}

// ── Verify edge margin ──────────────────────────────────────────────────────
let edgeViolations = 0;
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const edgeDist = Math.min(x, y, W - 1 - x, H - 1 - y);
    if (edgeDist < EDGE_MARGIN && grid[y][x] !== 'ocean') {
      edgeViolations++;
      grid[y][x] = 'ocean'; // Force fix
    }
  }
}
if (edgeViolations > 0) {
  console.log(`Fixed ${edgeViolations} edge violations (forced to ocean)`);
}

// ── Output ──────────────────────────────────────────────────────────────────
const mapData = {
  width: W,
  height: H,
  terrain: grid,
};

const outPath = path.resolve(__dirname, '..', 'src', 'data', 'world-map.json');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(mapData, null, 2), 'utf-8');
console.log(`Map saved to ${outPath}`);

// Terrain counts
const counts: Record<string, number> = {};
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    counts[grid[y][x]] = (counts[grid[y][x]] || 0) + 1;
  }
}
console.log('\nTerrain distribution:');
for (const [t, c] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
  const pct = ((c / (W * H)) * 100).toFixed(1);
  console.log(`  ${t.padEnd(10)} ${String(c).padStart(5)}  (${pct}%)`);
}

// Verify no land touches map border
let borderLand = 0;
for (let i = 0; i < W; i++) {
  if (grid[0][i] !== 'ocean') borderLand++;
  if (grid[H - 1][i] !== 'ocean') borderLand++;
}
for (let i = 0; i < H; i++) {
  if (grid[i][0] !== 'ocean') borderLand++;
  if (grid[i][W - 1] !== 'ocean') borderLand++;
}
console.log(`\nBorder land cells: ${borderLand} (should be 0)`);
