import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { MapService } from '../map/map.service';
import { InventoryService } from '../inventory/inventory.service';
import { carryCapacity } from '../common/constants/inventory.constants';
import {
  SELL_PRICE_MULTIPLIER,
  STOCK_BY_RARITY,
  RARITY_ORDER,
  UNSELLABLE_TYPES,
} from '../common/constants/shop.constants';
import * as shopsData from '../data/shops.json';
import itemsData = require('../data/items.json');

interface ShopConfig {
  name: string;
  description: string;
  categories: string[];
  maxRarity: string;
  signatureItems: string[];
  restockMinutes: number;
}

@Injectable()
export class ShopsService {
  /** Full shop config keyed by town ID */
  private readonly shops: Record<string, ShopConfig> = shopsData as any;

  /** All item definitions keyed by ID for fast lookup */
  private readonly itemsById: Record<string, any>;

  constructor(
    private supabaseService: SupabaseService,
    private mapService: MapService,
    private inventoryService: InventoryService,
  ) {
    this.itemsById = {};
    for (const item of itemsData as any[]) {
      this.itemsById[item.id] = item;
    }
  }

  /* ─── Helpers ─── */

  private async getCharacter(userId: string) {
    const supabase = this.supabaseService.getClient();
    const { data, error } = await supabase
      .from('characters')
      .select('*, race:races(id, name), class:classes(id, name)')
      .eq('user_id', userId)
      .single();

    if (error || !data) {
      throw new NotFoundException('No character found. Create one first.');
    }
    return data;
  }

  /**
   * Validate the character is at the specified town, not traveling, not resting.
   * Returns the character record.
   */
  private async validateAtTown(userId: string, townId: string) {
    const character = await this.getCharacter(userId);

    // Must not be in combat
    if (character.in_combat) {
      throw new ConflictException('Cannot use shops while in combat.');
    }

    // Must not be traveling
    if (
      character.travel_eta &&
      new Date(character.travel_eta).getTime() > Date.now()
    ) {
      throw new ConflictException(
        'Cannot use shops while traveling. Wait until you arrive.',
      );
    }

    // Must not be resting
    if (
      character.rest_until &&
      new Date(character.rest_until).getTime() > Date.now()
    ) {
      throw new ConflictException(
        'Cannot use shops while resting. Stop resting first.',
      );
    }

    // Must be at the correct town
    const poi = await this.mapService.getPOIAt(character.pos_x, character.pos_y);
    if (!poi || poi.id !== townId || poi.type !== 'town') {
      throw new BadRequestException(
        `You are not at ${townId}. Travel to that town first.`,
      );
    }

    return character;
  }

  private getShopConfig(townId: string): ShopConfig {
    const config = this.shops[townId];
    if (!config) {
      throw new NotFoundException(`No shop exists in '${townId}'.`);
    }
    return config;
  }

  private rarityRank(rarity: string): number {
    const idx = RARITY_ORDER.indexOf(rarity);
    return idx >= 0 ? idx : 0;
  }

  /**
   * Build the catalog of items available at a shop.
   * Items must match a shop category AND be at or below maxRarity,
   * OR be in the signatureItems list (which bypasses category filter but still respects stock-by-rarity).
   */
  private buildCatalog(config: ShopConfig): any[] {
    const maxRank = this.rarityRank(config.maxRarity);
    const signatureSet = new Set(config.signatureItems);
    const categorySet = new Set(config.categories);
    const seen = new Set<string>();
    const catalog: any[] = [];

    for (const item of itemsData as any[]) {
      const rarityRank = this.rarityRank(item.rarity);
      const stock = STOCK_BY_RARITY[item.rarity] ?? 0;

      // Skip items with 0 stock (legendary)
      if (stock === 0) continue;

      const inCategory = categorySet.has(item.type) && rarityRank <= maxRank;
      const isSignature = signatureSet.has(item.id);

      if ((inCategory || isSignature) && !seen.has(item.id)) {
        seen.add(item.id);
        catalog.push(item);
      }
    }

    return catalog;
  }

  /* ─── Public API ─── */

  /** Browse a town shop's inventory with current stock levels */
  async getShop(userId: string, townId: string) {
    const character = await this.validateAtTown(userId, townId);
    const config = this.getShopConfig(townId);
    const catalog = this.buildCatalog(config);

    // Fetch existing stock rows for this character + town
    const supabase = this.supabaseService.getClient();
    const { data: stockRows, error } = await supabase
      .from('shop_stock')
      .select('*')
      .eq('character_id', character.id)
      .eq('town_id', townId);

    if (error) throw new BadRequestException(error.message);

    const stockMap = new Map<string, any>();
    for (const row of stockRows ?? []) {
      stockMap.set(row.item_id, row);
    }

    const now = Date.now();
    const restockMs = config.restockMinutes * 60 * 1000;
    const items: any[] = [];

    for (const item of catalog) {
      const maxStock = STOCK_BY_RARITY[item.rarity] ?? 0;
      let quantity: number;
      let needsDbWrite = false;
      let stockRow = stockMap.get(item.id);

      if (!stockRow) {
        // First visit — initialize stock at full
        quantity = maxStock;
        needsDbWrite = true;
      } else {
        // Check restock
        const lastRestock = new Date(stockRow.last_restock_at).getTime();
        if (now - lastRestock >= restockMs) {
          quantity = maxStock;
          needsDbWrite = true;
        } else {
          quantity = stockRow.quantity;
        }
      }

      // Batch write: upsert stock row
      if (needsDbWrite) {
        const { data: upserted, error: upsertErr } = await supabase
          .from('shop_stock')
          .upsert(
            {
              character_id: character.id,
              town_id: townId,
              item_id: item.id,
              quantity,
              last_restock_at: new Date().toISOString(),
            },
            { onConflict: 'character_id,town_id,item_id' },
          )
          .select()
          .single();

        if (upsertErr) throw new BadRequestException(upsertErr.message);
        stockRow = upserted;
      }

      items.push({
        id: item.id,
        name: item.name,
        type: item.type,
        rarity: item.rarity,
        price: item.value,
        sellPrice: Math.floor(item.value * SELL_PRICE_MULTIPLIER),
        levelRequired: item.levelRequired ?? item.level_required ?? 1,
        classRestriction: item.classRestriction ?? item.class_restriction ?? null,
        weight: item.weight,
        stock: quantity,
        maxStock,
      });
    }

    return {
      townId,
      shop: config.name,
      description: config.description,
      restockMinutes: config.restockMinutes,
      gold: character.gold,
      items,
    };
  }

  /** Buy an item from a town shop */
  async buyItem(userId: string, townId: string, itemId: string, quantity: number) {
    const character = await this.validateAtTown(userId, townId);
    const config = this.getShopConfig(townId);

    // Verify item is in this shop's catalog
    const catalog = this.buildCatalog(config);
    const catalogItem = catalog.find((i: any) => i.id === itemId);
    if (!catalogItem) {
      throw new BadRequestException(
        `${itemId} is not sold at ${config.name}.`,
      );
    }

    const item = this.itemsById[itemId];
    if (!item) {
      throw new NotFoundException(`Item '${itemId}' does not exist.`);
    }

    // Level check
    const levelReq = item.levelRequired ?? item.level_required ?? 1;
    if (character.level < levelReq) {
      throw new BadRequestException(
        `You must be level ${levelReq} to buy ${item.name}. You are level ${character.level}.`,
      );
    }

    // Class check
    const classRestriction = item.classRestriction ?? item.class_restriction ?? null;
    if (classRestriction && classRestriction !== character.class_id) {
      throw new BadRequestException(
        `Only the ${classRestriction} class can use ${item.name}.`,
      );
    }

    // Check stock
    const supabase = this.supabaseService.getClient();
    const { data: stockRow } = await supabase
      .from('shop_stock')
      .select('*')
      .eq('character_id', character.id)
      .eq('town_id', townId)
      .eq('item_id', itemId)
      .maybeSingle();

    const currentStock = stockRow?.quantity ?? 0;
    if (currentStock < quantity) {
      throw new BadRequestException(
        `Not enough stock. ${item.name} has ${currentStock} available, you requested ${quantity}.`,
      );
    }

    // Gold check
    const totalCost = item.value * quantity;
    if (character.gold < totalCost) {
      throw new BadRequestException(
        `Not enough gold. ${item.name} costs ${totalCost}g (${item.value}g each x${quantity}), you have ${character.gold}g.`,
      );
    }

    // Weight check
    const invRows = await this.inventoryService.getInventoryRowsForCharacter(character.id);
    const currentWeight = this.inventoryService.getCarryWeight(invRows);
    const addedWeight = parseFloat(item.weight) * quantity;
    const cap = carryCapacity(character.strength);

    if (currentWeight + addedWeight > cap) {
      throw new BadRequestException(
        `Cannot carry ${item.name} x${quantity} (${addedWeight.toFixed(1)} lbs). ` +
        `Current weight: ${currentWeight.toFixed(1)}/${cap} lbs.`,
      );
    }

    // Execute purchase
    // 1. Deduct gold
    const { error: goldErr } = await supabase
      .from('characters')
      .update({ gold: character.gold - totalCost })
      .eq('id', character.id);
    if (goldErr) throw new BadRequestException(goldErr.message);

    // 2. Decrement stock
    const { error: stockErr } = await supabase
      .from('shop_stock')
      .update({ quantity: currentStock - quantity })
      .eq('id', stockRow.id);
    if (stockErr) throw new BadRequestException(stockErr.message);

    // 3. Add to backpack
    await this.inventoryService.addToBackpack(character.id, itemId, quantity);

    return {
      bought: item.name,
      quantity,
      totalCost,
      gold: character.gold - totalCost,
      message: `Purchased ${quantity}x ${item.name} for ${totalCost}g.`,
    };
  }

  /** Sell an item from your inventory to a town shop */
  async sellItem(userId: string, townId: string, itemId: string, quantity: number) {
    const character = await this.validateAtTown(userId, townId);
    // Shop config not strictly needed for selling, but validates the town has a shop
    this.getShopConfig(townId);

    const item = this.itemsById[itemId];
    if (!item) {
      throw new NotFoundException(`Item '${itemId}' does not exist.`);
    }

    // Quest items cannot be sold
    if (UNSELLABLE_TYPES.includes(item.type)) {
      throw new BadRequestException(`${item.name} cannot be sold.`);
    }

    // Remove from backpack (throws if not in backpack)
    const removed = await this.inventoryService.removeFromBackpack(
      character.id,
      itemId,
      quantity,
    );

    // Calculate sell price
    const unitSellPrice = Math.floor(item.value * SELL_PRICE_MULTIPLIER);
    const totalSellPrice = unitSellPrice * removed;

    // Add gold
    const supabase = this.supabaseService.getClient();
    const newGold = character.gold + totalSellPrice;
    const { error } = await supabase
      .from('characters')
      .update({ gold: newGold })
      .eq('id', character.id);
    if (error) throw new BadRequestException(error.message);

    return {
      sold: item.name,
      quantity: removed,
      unitPrice: unitSellPrice,
      totalPrice: totalSellPrice,
      gold: newGold,
      message: `Sold ${removed}x ${item.name} for ${totalSellPrice}g.`,
    };
  }
}
