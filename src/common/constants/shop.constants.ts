/** Starting gold for new characters */
export const STARTING_GOLD = 100;

/** Sell price = buy price (item.value) * this multiplier, floored */
export const SELL_PRICE_MULTIPLIER = 0.5;

/** Default stock quantity per rarity tier. Legendary = 0 means never stocked. */
export const STOCK_BY_RARITY: Record<string, number> = {
  common: 10,
  uncommon: 5,
  rare: 2,
  epic: 1,
  legendary: 0,
};

/** Rarity ordering for comparison (index = rank) */
export const RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

/** Item types that cannot be sold to shops */
export const UNSELLABLE_TYPES = ['quest'];
