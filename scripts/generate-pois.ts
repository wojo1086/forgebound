import * as fs from 'fs';
import * as path from 'path';

// --- Seeded PRNG (Mulberry32) ---
function mulberry32(seed: number) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(42);

function randInt(min: number, max: number): number {
  return Math.floor(rand() * (max - min + 1)) + min;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(rand() * arr.length)];
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function toKebab(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)); // Chebyshev
}

// --- Load terrain ---
const mapPath = path.resolve(__dirname, '../src/data/world-map.json');
const mapData = JSON.parse(fs.readFileSync(mapPath, 'utf-8'));
const terrain: string[][] = mapData.terrain;
const W = mapData.width as number;
const H = mapData.height as number;

function terrainAt(x: number, y: number): string {
  return terrain[y]?.[x] ?? 'ocean';
}

// Build index of cells by terrain type
const cellsByTerrain: Record<string, { x: number; y: number }[]> = {};
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const t = terrainAt(x, y);
    if (!cellsByTerrain[t]) cellsByTerrain[t] = [];
    cellsByTerrain[t].push({ x, y });
  }
}

// Shuffle each terrain list for random picking
for (const t of Object.keys(cellsByTerrain)) {
  cellsByTerrain[t] = shuffle(cellsByTerrain[t]);
}

const allIds = new Set<string>();

function uniqueId(base: string, suffix?: number): string {
  let id = toKebab(base);
  if (suffix !== undefined) id += `-${suffix}`;
  if (!allIds.has(id)) {
    allIds.add(id);
    return id;
  }
  let n = 1;
  while (allIds.has(`${id}-${n}`)) n++;
  const finalId = `${id}-${n}`;
  allIds.add(finalId);
  return finalId;
}

// Track placed POI positions for distance checks
const placedPositions: { x: number; y: number; category: string }[] = [];

function findCell(
  terrainType: string,
  minDistFrom: { x: number; y: number }[],
  minDist: number,
  preferCenter = false
): { x: number; y: number } | null {
  const candidates = cellsByTerrain[terrainType];
  if (!candidates || candidates.length === 0) return null;

  // Sort candidates by preference
  let sorted = [...candidates];
  if (preferCenter) {
    sorted.sort((a, b) => {
      const da = Math.abs(a.x - W / 2) + Math.abs(a.y - H / 2);
      const db = Math.abs(b.x - W / 2) + Math.abs(b.y - H / 2);
      return da - db;
    });
  } else {
    sorted = shuffle(sorted);
  }

  for (const cell of sorted) {
    const tooClose = minDistFrom.some(p => dist(cell, p) < minDist);
    if (!tooClose) return cell;
  }
  return null;
}

// ============================================================
// 1. TOWNS
// ============================================================

interface Town {
  id: string;
  name: string;
  x: number;
  y: number;
  terrain: string;
  description: string;
  visible: true;
}

const townDefs: { name: string; terrain: string; description: string; preferCenter?: boolean }[] = [
  // Starting town near center
  { name: 'Thornhaven', terrain: 'plains', description: 'A bustling trade hub at the heart of the realm, where caravans converge and adventurers begin their journeys.', preferCenter: true },
  // Coastal/port towns (4)
  { name: 'Saltmere', terrain: 'coast', description: 'A weathered fishing village perched on jagged cliffs, known for its smoked eel and secretive smugglers.' },
  { name: 'Tidecrest', terrain: 'coast', description: 'A prosperous port city with towering lighthouses and a sprawling open-air market along the docks.' },
  { name: 'Pearlshore', terrain: 'coast', description: 'A tranquil coastal hamlet famous for its pearl divers and the shimmering white sand of its beaches.' },
  { name: 'Stormwatch', terrain: 'coast', description: 'A fortified harbor town built to withstand hurricanes, its walls scarred by decades of battering waves.' },
  // Plains towns (3)
  { name: 'Goldfield', terrain: 'plains', description: 'Endless wheat fields surround this farming community, where the annual harvest festival draws visitors from across the land.' },
  { name: 'Windhollow', terrain: 'plains', description: 'A quiet settlement nestled in a shallow valley, sheltered from the constant winds that sweep the open grasslands.' },
  { name: 'Hearthstead', terrain: 'plains', description: 'A welcoming town centered around a great communal hearth that has burned without pause for three hundred years.' },
  // Forest towns (2)
  { name: 'Mosswood', terrain: 'forest', description: 'A secluded woodland village where treehouses and ground dwellings coexist among ancient oaks draped in moss.' },
  { name: 'Ferngate', terrain: 'forest', description: 'Built around a massive natural stone arch, this town serves as the gateway between the deep forest and the outer lands.' },
  // Mountain town (1)
  { name: 'Ironpeak', terrain: 'mountain', description: 'A hardy mining settlement carved into the mountainside, where the ring of hammers echoes day and night.' },
  // Ocean town (1)
  { name: 'Driftholm', terrain: 'ocean', description: 'A floating settlement of lashed-together ships and wooden platforms, drifting slowly across the open sea.' },
];

const towns: Town[] = [];
const townPositions: { x: number; y: number }[] = [];

for (const def of townDefs) {
  const cell = findCell(def.terrain, townPositions, 15, def.preferCenter);
  if (!cell) {
    console.warn(`WARNING: Could not place town ${def.name} on ${def.terrain}`);
    continue;
  }
  townPositions.push(cell);
  placedPositions.push({ ...cell, category: 'town' });
  towns.push({
    id: uniqueId(def.name),
    name: def.name,
    x: cell.x,
    y: cell.y,
    terrain: def.terrain,
    description: def.description,
    visible: true,
  });
}

// ============================================================
// 2. VISIBLE LANDMARKS
// ============================================================

interface Landmark {
  id: string;
  name: string;
  type: string;
  x: number;
  y: number;
  terrain: string;
  description: string;
  levelMin: number;
  levelMax: number;
  visible: true;
}

const landmarkDefs: { name: string; type: string; terrain: string[]; description: string; levelMin: number; levelMax: number }[] = [
  // Dungeons - mountains / forest
  { name: 'Shadowfang Caverns', type: 'dungeon', terrain: ['mountain'], description: 'A labyrinthine network of caves said to be home to creatures that have never seen daylight.', levelMin: 4, levelMax: 7 },
  { name: 'The Gullet', type: 'dungeon', terrain: ['mountain', 'forest'], description: 'A massive sinkhole leading to twisting underground passages lined with bioluminescent fungi.', levelMin: 6, levelMax: 9 },
  { name: 'Wormtunnel Depths', type: 'dungeon', terrain: ['mountain'], description: 'Tunnels bored by some immense worm-like creature, now inhabited by blind predators.', levelMin: 7, levelMax: 10 },
  // Ruins - desert / swamp
  { name: 'Sunken Citadel', type: 'ruins', terrain: ['swamp'], description: 'An ancient fortress slowly being consumed by the swamp, its towers leaning at unnatural angles.', levelMin: 3, levelMax: 6 },
  { name: 'Ashen Pillars', type: 'ruins', terrain: ['desert'], description: 'Towering stone columns etched with forgotten runes, half-buried in drifting sand.', levelMin: 5, levelMax: 8 },
  { name: 'Bleached Remnants', type: 'ruins', terrain: ['desert', 'plains'], description: 'The skeletal remains of a once-great city, now bleached white by centuries of sun.', levelMin: 2, levelMax: 5 },
  // Temples - forest / plains
  { name: 'Verdant Sanctum', type: 'temple', terrain: ['forest'], description: 'A living temple grown from intertwined trees, where druids gather to commune with the wild.', levelMin: 2, levelMax: 5 },
  { name: 'Starfall Shrine', type: 'temple', terrain: ['mountain', 'plains'], description: 'A hilltop temple built around a fallen meteorite that still radiates faint warmth.', levelMin: 4, levelMax: 7 },
  { name: 'Whispering Chapel', type: 'temple', terrain: ['forest', 'swamp'], description: 'A crumbling chapel where the wind through broken windows sounds like hushed prayers.', levelMin: 1, levelMax: 4 },
  // Towers
  { name: 'Spire of Echoes', type: 'tower', terrain: ['mountain', 'plains'], description: 'A spiraling tower whose peak disappears into perpetual clouds, said to amplify any spoken word.', levelMin: 5, levelMax: 8 },
  { name: 'Nightwatch Tower', type: 'tower', terrain: ['coast', 'plains'], description: 'An abandoned watchtower on a coastal bluff, its signal fire long extinguished.', levelMin: 1, levelMax: 3 },
  // Fortresses
  { name: 'Blackwall Keep', type: 'fortress', terrain: ['mountain', 'plains'], description: 'A dark stone fortress built to guard a mountain pass, now occupied by bandits.', levelMin: 6, levelMax: 9 },
  { name: 'Fort Briarhelm', type: 'fortress', terrain: ['forest'], description: 'A woodland fortress overgrown with thorny vines that seem to move on their own.', levelMin: 3, levelMax: 6 },
  { name: 'Tideguard Bastion', type: 'fortress', terrain: ['coast'], description: 'A crumbling seaside fortress that once defended against naval invasions.', levelMin: 4, levelMax: 7 },
  // Mines
  { name: 'Ironveil Mines', type: 'mine', terrain: ['mountain'], description: 'An abandoned mining complex where veins of enchanted iron still glow faintly in the dark.', levelMin: 5, levelMax: 8 },
  { name: 'Crystaldelve', type: 'mine', terrain: ['mountain'], description: 'A deep mine famous for its deposits of resonant crystals that hum when touched.', levelMin: 3, levelMax: 6 },
  { name: 'Bogore Pit', type: 'mine', terrain: ['swamp', 'forest'], description: 'A flooded strip mine in marshy ground, rumored to contain something terrible beneath the murky water.', levelMin: 6, levelMax: 9 },
  { name: 'Ember Quarry', type: 'mine', terrain: ['desert', 'mountain'], description: 'A quarry where the rock itself is warm to the touch, and fire elementals lurk in the deepest shafts.', levelMin: 7, levelMax: 10 },
];

const landmarks: Landmark[] = [];
const landmarkPositions: { x: number; y: number }[] = [];

for (const def of landmarkDefs) {
  // Try each allowed terrain in shuffled order
  const terrains = shuffle(def.terrain);
  let placed = false;
  for (const t of terrains) {
    const minDistFrom = [...townPositions, ...landmarkPositions];
    const cell = findCell(t, minDistFrom, 6);
    if (cell) {
      landmarkPositions.push(cell);
      placedPositions.push({ ...cell, category: 'landmark' });
      landmarks.push({
        id: uniqueId(def.name),
        name: def.name,
        type: def.type,
        x: cell.x,
        y: cell.y,
        terrain: t,
        description: def.description,
        levelMin: def.levelMin,
        levelMax: def.levelMax,
        visible: true,
      });
      placed = true;
      break;
    }
  }
  if (!placed) {
    console.warn(`WARNING: Could not place landmark ${def.name}`);
  }
}

// ============================================================
// 3. HIDDEN POIs
// ============================================================

interface HiddenPOI {
  id: string;
  name: string;
  type: string;
  x: number;
  y: number;
  terrain: string;
  description: string;
  levelMin: number;
  levelMax: number;
  visible: false;
}

// Terrain-type mappings for hidden POIs
const hiddenTypeConfig: Record<string, { terrains: string[]; names: string[]; descriptions: string[]; levelMin: number; levelMax: number }> = {
  secret_cave: {
    terrains: ['mountain', 'forest', 'coast'],
    names: ['Mossy Cave', 'Shadow Grotto', 'Glimmering Cavern', 'Echoing Hollow', 'Damp Burrow', 'Veiled Alcove', 'Dripping Cave', 'Narrow Fissure'],
    descriptions: [
      'A hidden cave entrance obscured by hanging vines and moss.',
      'A narrow crack in the rock opens into a surprisingly spacious cavern.',
      'A damp cave where water drips from stalactites into clear pools.',
      'A small cave with walls that sparkle faintly in torchlight.',
    ],
    levelMin: 1, levelMax: 5,
  },
  treasure_cache: {
    terrains: ['plains', 'forest', 'desert', 'mountain', 'coast'],
    names: ['Buried Strongbox', 'Hidden Stash', 'Forgotten Cache', 'Concealed Trove', 'Buried Chest', 'Covered Coffer'],
    descriptions: [
      'A partially buried chest, its lock rusted but intact.',
      'Stones arranged in a deliberate pattern mark a buried cache.',
      'A hollow tree stump conceals a wrapped bundle of valuables.',
      'A cache of goods hidden beneath a flat rock.',
    ],
    levelMin: 1, levelMax: 8,
  },
  herb_patch: {
    terrains: ['forest', 'swamp', 'plains'],
    names: ['Wild Herb Patch', 'Moonpetal Grove', 'Thornbloom Cluster', 'Healers Meadow', 'Fungal Patch', 'Verdant Glade'],
    descriptions: [
      'A cluster of rare medicinal herbs growing in a sheltered spot.',
      'Unusual flowers bloom here, their petals shimmering with dew.',
      'A patch of pungent herbs known for their restorative properties.',
      'Mushrooms with faintly luminous caps grow in a ring here.',
    ],
    levelMin: 1, levelMax: 3,
  },
  ambush_site: {
    terrains: ['forest', 'mountain', 'desert', 'plains', 'swamp'],
    names: ['Bandit Hollow', 'Narrow Pass', 'Dark Thicket', 'Robbers Bend', 'Shaded Gulch', 'Deadfall Trap'],
    descriptions: [
      'Broken branches and trampled ground suggest frequent ambush activity.',
      'A narrow passage between rocks, perfect for a surprise attack.',
      'A suspiciously quiet stretch of road with too many hiding spots.',
      'Remnants of previous travelers litter the ground here.',
    ],
    levelMin: 2, levelMax: 7,
  },
  shrine: {
    terrains: ['forest', 'mountain', 'plains', 'coast', 'desert'],
    names: ['Weathered Shrine', 'Forgotten Altar', 'Roadside Shrine', 'Mossy Idol', 'Standing Stone', 'Prayer Stone'],
    descriptions: [
      'A small stone shrine to a forgotten deity, half-hidden by overgrowth.',
      'An ancient altar with worn carvings that still radiate faint power.',
      'A simple roadside shrine where travelers leave small offerings.',
      'A carved stone figure stares out with empty eyes, its purpose unclear.',
    ],
    levelMin: 1, levelMax: 4,
  },
  shipwreck: {
    terrains: ['ocean', 'coast'],
    names: ['Sunken Vessel', 'Broken Hull', 'Barnacled Wreck', 'Storm-Shattered Ship', 'Ghost Ship', 'Beached Galley'],
    descriptions: [
      'The rotting hull of a ship juts from the waves, barnacle-encrusted.',
      'A wrecked vessel lies half-submerged, its cargo scattered across the seabed.',
      'The skeletal remains of a once-proud warship rest on a sandbar.',
      'A ship broken in two by some tremendous force, its hold still sealed.',
    ],
    levelMin: 2, levelMax: 6,
  },
  abandoned_camp: {
    terrains: ['forest', 'plains', 'desert', 'mountain', 'swamp'],
    names: ['Cold Campfire', 'Deserted Bivouac', 'Abandoned Lean-to', 'Empty Camp', 'Ransacked Camp', 'Dusty Bedroll'],
    descriptions: [
      'A recently abandoned campsite with still-warm embers in the fire pit.',
      'Torn tents and scattered supplies suggest a hasty departure.',
      'A crude shelter built against a rock face, long since abandoned.',
      'An old campsite with carved initials and a buried fire ring.',
    ],
    levelMin: 1, levelMax: 4,
  },
  fairy_ring: {
    terrains: ['forest', 'swamp'],
    names: ['Mushroom Circle', 'Fairy Ring', 'Enchanted Glade', 'Pixie Ring', 'Glowing Circle', 'Fey Clearing'],
    descriptions: [
      'A perfect ring of mushrooms in a forest clearing, humming with latent magic.',
      'The air shimmers inside this ring of toadstools, and time feels strange.',
      'Tiny lights dance above a circle of unusually large mushrooms.',
      'An unnaturally perfect circle of flowers where the grass grows greener.',
    ],
    levelMin: 1, levelMax: 5,
  },
  ancient_tomb: {
    terrains: ['desert', 'mountain', 'plains', 'swamp'],
    names: ['Sealed Tomb', 'Burial Mound', 'Crumbling Crypt', 'Sand-Covered Tomb', 'Forgotten Grave', 'Sunken Barrow'],
    descriptions: [
      'A stone door set into a hillside, sealed with ancient wards.',
      'A grass-covered mound that clearly conceals a burial chamber.',
      'A partially collapsed crypt with weathered inscriptions above the entrance.',
      'Sand has drifted away to reveal the entrance to a long-forgotten tomb.',
    ],
    levelMin: 3, levelMax: 8,
  },
  hidden_spring: {
    terrains: ['forest', 'mountain', 'desert', 'plains'],
    names: ['Crystal Spring', 'Hidden Pool', 'Bubbling Spring', 'Secluded Oasis', 'Mineral Spring', 'Clear Wellspring'],
    descriptions: [
      'Crystal-clear water bubbles up from between smooth stones.',
      'A hidden pool fed by an underground spring, unnaturally warm.',
      'A small spring of pure water that seems to have restorative properties.',
      'A secluded water source surrounded by lush vegetation in barren land.',
    ],
    levelMin: 1, levelMax: 3,
  },
  smuggler_den: {
    terrains: ['coast', 'forest', 'swamp'],
    names: ['Smugglers Cove', 'Hidden Warehouse', 'Contraband Cellar', 'Sea Cave Cache', 'Illicit Dock', 'Underground Market'],
    descriptions: [
      'A concealed cove with a hidden dock, used for moving illicit goods.',
      'A camouflaged entrance leads to an underground storage room full of crates.',
      'A network of hidden rooms beneath an unremarkable patch of ground.',
      'A sheltered inlet with signs of frequent unauthorized docking.',
    ],
    levelMin: 3, levelMax: 7,
  },
  crystal_node: {
    terrains: ['mountain', 'desert', 'coast'],
    names: ['Crystal Outcrop', 'Resonant Geode', 'Arcane Crystal Node', 'Shimmering Vein', 'Pulsing Formation', 'Raw Crystal Cluster'],
    descriptions: [
      'A cluster of raw crystals jutting from the rock, pulsing with faint energy.',
      'A geode split open by natural forces, its interior glittering with power.',
      'Crystals grow in impossible formations here, humming at a frequency felt in the bones.',
      'A vein of luminous crystal runs through the stone, warm to the touch.',
    ],
    levelMin: 4, levelMax: 9,
  },
};

// Target: ~500 hidden POIs for 100x100 map (roughly 1 per 20 cells)
const hiddenTargetByType: Record<string, number> = {
  secret_cave: 45,
  treasure_cache: 50,
  herb_patch: 40,
  ambush_site: 45,
  shrine: 40,
  shipwreck: 30,
  abandoned_camp: 45,
  fairy_ring: 30,
  ancient_tomb: 35,
  hidden_spring: 35,
  smuggler_den: 30,
  crystal_node: 40,
};

const hidden: HiddenPOI[] = [];
const usedCells = new Set<string>();

// Mark town and landmark cells as used
for (const t of towns) usedCells.add(`${t.x},${t.y}`);
for (const l of landmarks) usedCells.add(`${l.x},${l.y}`);

for (const [type, count] of Object.entries(hiddenTargetByType)) {
  const config = hiddenTypeConfig[type];
  let placed = 0;
  let attempts = 0;
  const maxAttempts = count * 20;

  while (placed < count && attempts < maxAttempts) {
    attempts++;
    const t = pick(config.terrains);
    const cells = cellsByTerrain[t];
    if (!cells || cells.length === 0) continue;

    const cell = pick(cells);
    const key = `${cell.x},${cell.y}`;
    if (usedCells.has(key)) continue;

    usedCells.add(key);

    const name = pick(config.names);
    const desc = pick(config.descriptions);
    const levelRange = config.levelMax - config.levelMin;
    const levelMin = config.levelMin + Math.floor(rand() * (levelRange / 2));
    const levelMax = Math.min(levelMin + 2 + randInt(0, 2), config.levelMax);

    hidden.push({
      id: uniqueId(name, placed),
      name,
      type,
      x: cell.x,
      y: cell.y,
      terrain: t,
      description: desc,
      levelMin,
      levelMax,
      visible: false,
    });
    placed++;
  }

  if (placed < count) {
    console.warn(`WARNING: Only placed ${placed}/${count} ${type} POIs`);
  }
}

// ============================================================
// VALIDATION
// ============================================================

let validationErrors = 0;

// Validate all POIs are on matching terrain
for (const t of towns) {
  if (terrainAt(t.x, t.y) !== t.terrain) {
    console.error(`VALIDATION ERROR: Town ${t.name} at (${t.x},${t.y}) is on ${terrainAt(t.x, t.y)} but expected ${t.terrain}`);
    validationErrors++;
  }
}
for (const l of landmarks) {
  if (terrainAt(l.x, l.y) !== l.terrain) {
    console.error(`VALIDATION ERROR: Landmark ${l.name} at (${l.x},${l.y}) is on ${terrainAt(l.x, l.y)} but expected ${l.terrain}`);
    validationErrors++;
  }
}
for (const h of hidden) {
  if (terrainAt(h.x, h.y) !== h.terrain) {
    console.error(`VALIDATION ERROR: Hidden ${h.name} at (${h.x},${h.y}) is on ${terrainAt(h.x, h.y)} but expected ${h.terrain}`);
    validationErrors++;
  }
}

// Validate unique IDs
const idSet = new Set<string>();
const allPois = [...towns.map(t => ({ ...t, cat: 'town' })), ...landmarks.map(l => ({ ...l, cat: 'landmark' })), ...hidden.map(h => ({ ...h, cat: 'hidden' }))];
for (const p of allPois) {
  if (idSet.has(p.id)) {
    console.error(`VALIDATION ERROR: Duplicate ID "${p.id}"`);
    validationErrors++;
  }
  idSet.add(p.id);
}

// Validate town spacing
for (let i = 0; i < towns.length; i++) {
  for (let j = i + 1; j < towns.length; j++) {
    const d = dist(towns[i], towns[j]);
    if (d < 8) {
      console.warn(`WARNING: Towns ${towns[i].name} and ${towns[j].name} are only ${d} cells apart`);
    }
  }
}

// Validate landmark distance from towns
for (const l of landmarks) {
  for (const t of towns) {
    const d = dist(l, t);
    if (d < 3) {
      console.warn(`WARNING: Landmark ${l.name} is only ${d} cells from town ${t.name}`);
    }
  }
}

// ============================================================
// OUTPUT
// ============================================================

const output = {
  towns,
  landmarks,
  hidden,
};

const outPath = path.resolve(__dirname, '../src/data/pois.json');
fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf-8');

// ============================================================
// SUMMARY
// ============================================================

console.log('\n=== POI Generation Summary ===\n');
console.log(`Towns: ${towns.length}`);
console.log(`Landmarks: ${landmarks.length}`);
console.log(`Hidden POIs: ${hidden.length}`);
console.log(`Total: ${towns.length + landmarks.length + hidden.length}`);
console.log(`Validation errors: ${validationErrors}\n`);

// By terrain
const terrainCounts: Record<string, { towns: number; landmarks: number; hidden: number }> = {};
for (const t of towns) {
  if (!terrainCounts[t.terrain]) terrainCounts[t.terrain] = { towns: 0, landmarks: 0, hidden: 0 };
  terrainCounts[t.terrain].towns++;
}
for (const l of landmarks) {
  if (!terrainCounts[l.terrain]) terrainCounts[l.terrain] = { towns: 0, landmarks: 0, hidden: 0 };
  terrainCounts[l.terrain].landmarks++;
}
for (const h of hidden) {
  if (!terrainCounts[h.terrain]) terrainCounts[h.terrain] = { towns: 0, landmarks: 0, hidden: 0 };
  terrainCounts[h.terrain].hidden++;
}

console.log('--- By Terrain ---');
for (const [t, c] of Object.entries(terrainCounts).sort()) {
  console.log(`  ${t.padEnd(10)}: ${String(c.towns).padStart(2)} towns, ${String(c.landmarks).padStart(2)} landmarks, ${String(c.hidden).padStart(3)} hidden`);
}

// By type (landmarks + hidden)
console.log('\n--- Landmarks by Type ---');
const lmByType: Record<string, number> = {};
for (const l of landmarks) lmByType[l.type] = (lmByType[l.type] || 0) + 1;
for (const [t, c] of Object.entries(lmByType).sort()) console.log(`  ${t.padEnd(12)}: ${c}`);

console.log('\n--- Hidden by Type ---');
const hidByType: Record<string, number> = {};
for (const h of hidden) hidByType[h.type] = (hidByType[h.type] || 0) + 1;
for (const [t, c] of Object.entries(hidByType).sort()) console.log(`  ${t.padEnd(16)}: ${c}`);

console.log(`\nOutput written to: ${outPath}`);
