export const EQUIPMENT_SLOTS = [
  'weapon',
  'armor',
  'helmet',
  'shield',
  'leggings',
  'boots',
  'gloves',
  'ring1',
  'ring2',
  'amulet',
] as const;

export type EquipmentSlot = (typeof EQUIPMENT_SLOTS)[number];

/** Maps item types to the equipment slots they can occupy */
export const ITEM_TYPE_SLOTS: Record<string, readonly EquipmentSlot[]> = {
  weapon: ['weapon'],
  armor: ['armor'],
  helmet: ['helmet'],
  shield: ['shield'],
  leggings: ['leggings'],
  boots: ['boots'],
  gloves: ['gloves'],
  ring: ['ring1', 'ring2'],
  amulet: ['amulet'],
};

/** Item types that can be equipped */
export const EQUIPPABLE_TYPES = Object.keys(ITEM_TYPE_SLOTS);

/** Item types that are NOT equippable */
export const NON_EQUIPPABLE_TYPES = ['consumable', 'material', 'quest', 'ammunition'];

/** Carry capacity: base + (strength * multiplier) in pounds */
export const CARRY_CAPACITY_BASE = 40;
export const CARRY_CAPACITY_PER_STR = 5;

/** Calculate carry capacity for a given strength score */
export function carryCapacity(strength: number): number {
  return CARRY_CAPACITY_BASE + strength * CARRY_CAPACITY_PER_STR;
}

/**
 * Starting equipment per class.
 * Each entry is { itemId, slot? }. If slot is set, the item is auto-equipped.
 * Items without a slot go into the backpack. Quantity defaults to 1 unless specified.
 */
export const STARTING_EQUIPMENT: Record<
  string,
  { itemId: string; slot?: EquipmentSlot; quantity?: number }[]
> = {
  warrior: [
    { itemId: 'copper-longsword', slot: 'weapon' },
    { itemId: 'leather-armor', slot: 'armor' },
    { itemId: 'leather-cap', slot: 'helmet' },
    { itemId: 'wooden-shield', slot: 'shield' },
    { itemId: 'leather-leggings', slot: 'leggings' },
    { itemId: 'leather-boots', slot: 'boots' },
    { itemId: 'cloth-gloves', slot: 'gloves' },
    { itemId: 'health-potion', quantity: 3 },
    { itemId: 'ration', quantity: 5 },
  ],
  mage: [
    { itemId: 'wooden-staff', slot: 'weapon' },
    { itemId: 'cloth-robe', slot: 'armor' },
    { itemId: 'cloth-hood', slot: 'helmet' },
    { itemId: 'cloth-leggings', slot: 'leggings' },
    { itemId: 'cloth-sandals', slot: 'boots' },
    { itemId: 'cloth-gloves', slot: 'gloves' },
    { itemId: 'health-potion', quantity: 5 },
    { itemId: 'ration', quantity: 3 },
  ],
  rogue: [
    { itemId: 'copper-dagger', slot: 'weapon' },
    { itemId: 'leather-armor', slot: 'armor' },
    { itemId: 'leather-cap', slot: 'helmet' },
    { itemId: 'leather-leggings', slot: 'leggings' },
    { itemId: 'leather-boots', slot: 'boots' },
    { itemId: 'leather-gloves', slot: 'gloves' },
    { itemId: 'copper-dagger' },
    { itemId: 'health-potion', quantity: 3 },
    { itemId: 'ration', quantity: 5 },
  ],
  cleric: [
    { itemId: 'copper-mace', slot: 'weapon' },
    { itemId: 'leather-armor', slot: 'armor' },
    { itemId: 'cloth-hood', slot: 'helmet' },
    { itemId: 'wooden-shield', slot: 'shield' },
    { itemId: 'leather-leggings', slot: 'leggings' },
    { itemId: 'leather-boots', slot: 'boots' },
    { itemId: 'cloth-gloves', slot: 'gloves' },
    { itemId: 'health-potion', quantity: 5 },
    { itemId: 'ration', quantity: 3 },
  ],
  ranger: [
    { itemId: 'hunting-bow', slot: 'weapon' },
    { itemId: 'leather-armor', slot: 'armor' },
    { itemId: 'leather-cap', slot: 'helmet' },
    { itemId: 'leather-leggings', slot: 'leggings' },
    { itemId: 'leather-boots', slot: 'boots' },
    { itemId: 'leather-gloves', slot: 'gloves' },
    { itemId: 'copper-arrows', quantity: 20 },
    { itemId: 'copper-dagger' },
    { itemId: 'health-potion', quantity: 3 },
    { itemId: 'ration', quantity: 5 },
  ],
};
