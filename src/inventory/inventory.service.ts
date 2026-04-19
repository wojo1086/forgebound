import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import {
  EQUIPMENT_SLOTS,
  EQUIPPABLE_TYPES,
  ITEM_TYPE_SLOTS,
  STARTING_EQUIPMENT,
  EquipmentSlot,
  carryCapacity,
} from '../common/constants/inventory.constants';
import { PickUpItemDto } from './dto/pick-up-item.dto';
import { DropItemDto } from './dto/drop-item.dto';
import { EquipItemDto } from './dto/equip-item.dto';
import { UnequipItemDto } from './dto/unequip-item.dto';
import { UseItemDto } from './dto/use-item.dto';

@Injectable()
export class InventoryService {
  constructor(private supabaseService: SupabaseService) {}

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

  private async getItemDef(itemId: string) {
    const supabase = this.supabaseService.getClient();
    const { data, error } = await supabase
      .from('items')
      .select('*')
      .eq('id', itemId)
      .single();

    if (error || !data) {
      throw new NotFoundException(`Item '${itemId}' does not exist.`);
    }
    return data;
  }

  private async getInventoryRows(characterId: string) {
    const supabase = this.supabaseService.getClient();
    const { data, error } = await supabase
      .from('character_inventory')
      .select('*, item:items(*)')
      .eq('character_id', characterId)
      .order('slot', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true });

    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  private computeCarryWeight(rows: any[]): number {
    return rows.reduce(
      (sum: number, r: any) =>
        sum + parseFloat(r.item.weight) * r.quantity,
      0,
    );
  }

  /* ─── Public API ─── */

  /** List full inventory: equipment slots + backpack + weight */
  async getInventory(userId: string) {
    const character = await this.getCharacter(userId);
    const rows = await this.getInventoryRows(character.id);

    const equipment: Record<string, any> = {};
    for (const slot of EQUIPMENT_SLOTS) {
      const row = rows.find((r: any) => r.slot === slot);
      equipment[slot] = row
        ? this.formatEquippedItem(row)
        : null;
    }

    const backpack = rows
      .filter((r: any) => r.slot === null)
      .map((r: any) => this.formatBackpackItem(r));

    const carryWeight = this.computeCarryWeight(rows);
    const cap = carryCapacity(character.strength);

    return { equipment, backpack, carryWeight: +carryWeight.toFixed(1), carryCapacity: cap };
  }

  /** Add an item to the character's backpack */
  /** List items on the ground at the character's current position */
  async getGroundItemsHere(userId: string) {
    const character = await this.getCharacter(userId);
    const supabase = this.supabaseService.getClient();

    const { data: rows, error } = await supabase
      .from('ground_items')
      .select('item_id, quantity, dropped_at, item:items(id, name, type, rarity, weight)')
      .eq('pos_x', character.pos_x)
      .eq('pos_y', character.pos_y);

    if (error) throw new BadRequestException(error.message);

    return {
      position: { x: character.pos_x, y: character.pos_y },
      items: (rows ?? []).map((r: any) => ({
        id: r.item.id,
        name: r.item.name,
        type: r.item.type,
        rarity: r.item.rarity,
        weight: r.item.weight,
        quantity: r.quantity,
        droppedAt: r.dropped_at,
      })),
    };
  }

  async pickUp(userId: string, dto: PickUpItemDto) {
    const character = await this.getCharacter(userId);
    const item = await this.getItemDef(dto.itemId);
    const supabase = this.supabaseService.getClient();

    // Location check — the item must actually be on the ground at the character's position
    const { data: groundRow } = await supabase
      .from('ground_items')
      .select('*')
      .eq('pos_x', character.pos_x)
      .eq('pos_y', character.pos_y)
      .eq('item_id', dto.itemId)
      .maybeSingle();

    if (!groundRow) {
      throw new NotFoundException(
        `There is no ${item.name} on the ground here.`,
      );
    }

    if (groundRow.quantity < dto.quantity) {
      throw new BadRequestException(
        `Only ${groundRow.quantity}x ${item.name} available here, you requested ${dto.quantity}.`,
      );
    }

    // Level check
    if (character.level < item.level_required) {
      throw new BadRequestException(
        `You must be level ${item.level_required} to carry this item. You are level ${character.level}.`,
      );
    }

    // Class check
    if (item.class_restriction && item.class_restriction !== character.class_id) {
      throw new BadRequestException(
        `Only the ${item.class_restriction} class can use ${item.name}.`,
      );
    }

    // Weight check
    const rows = await this.getInventoryRows(character.id);
    const currentWeight = this.computeCarryWeight(rows);
    const addedWeight = parseFloat(item.weight) * dto.quantity;
    const cap = carryCapacity(character.strength);

    if (currentWeight + addedWeight > cap) {
      throw new BadRequestException(
        `Cannot carry ${item.name} x${dto.quantity} (${addedWeight.toFixed(1)} lbs). ` +
        `Current weight: ${currentWeight.toFixed(1)}/${cap} lbs.`,
      );
    }

    // Decrement or delete the ground pile
    const remaining = groundRow.quantity - dto.quantity;
    if (remaining <= 0) {
      await supabase.from('ground_items').delete().eq('id', groundRow.id);
    } else {
      await supabase
        .from('ground_items')
        .update({ quantity: remaining })
        .eq('id', groundRow.id);
    }

    // Add to backpack (upserts if item already exists)
    await this.addToBackpack(character.id, dto.itemId, dto.quantity);

    return {
      pickedUp: item.name,
      quantity: dto.quantity,
      message: `Added ${dto.quantity}x ${item.name} to your backpack.`,
    };
  }

  /** Drop an item from the backpack onto the ground at the character's position */
  async drop(userId: string, dto: DropItemDto) {
    const character = await this.getCharacter(userId);
    const item = await this.getItemDef(dto.itemId);

    // Cannot drop quest items
    if (item.type === 'quest') {
      throw new BadRequestException('Quest items cannot be dropped.');
    }

    const dropped = await this.removeFromBackpack(character.id, dto.itemId, dto.quantity);

    if (dropped > 0) {
      // Persist on the ground at character's position (stacking with any existing pile)
      const supabase = this.supabaseService.getClient();
      const { data: existing } = await supabase
        .from('ground_items')
        .select('id, quantity')
        .eq('pos_x', character.pos_x)
        .eq('pos_y', character.pos_y)
        .eq('item_id', dto.itemId)
        .maybeSingle();

      if (existing) {
        await supabase
          .from('ground_items')
          .update({ quantity: existing.quantity + dropped })
          .eq('id', existing.id);
      } else {
        await supabase.from('ground_items').insert({
          item_id: dto.itemId,
          quantity: dropped,
          pos_x: character.pos_x,
          pos_y: character.pos_y,
        });
      }
    }

    return {
      dropped: item.name,
      quantity: dropped,
      message: `Dropped ${dropped}x ${item.name} on the ground.`,
    };
  }

  /** Equip an item to an equipment slot */
  async equip(userId: string, dto: EquipItemDto) {
    const character = await this.getCharacter(userId);

    if (character.in_combat) {
      throw new ConflictException('Cannot change equipment while in combat.');
    }
    if (character.in_dungeon) {
      throw new ConflictException('Cannot change equipment while in a dungeon.');
    }

    const item = await this.getItemDef(dto.itemId);

    // Must be equippable
    if (!EQUIPPABLE_TYPES.includes(item.type)) {
      throw new BadRequestException(
        `${item.name} (${item.type}) cannot be equipped.`,
      );
    }

    // Level check
    if (character.level < item.level_required) {
      throw new BadRequestException(
        `You must be level ${item.level_required} to equip ${item.name}.`,
      );
    }

    // Class check
    if (item.class_restriction && item.class_restriction !== character.class_id) {
      throw new BadRequestException(
        `Only the ${item.class_restriction} class can equip ${item.name}.`,
      );
    }

    // Determine target slot
    const validSlots = ITEM_TYPE_SLOTS[item.type];
    if (!validSlots) {
      throw new BadRequestException(`${item.name} cannot be equipped.`);
    }

    const rows = await this.getInventoryRows(character.id);
    let targetSlot: EquipmentSlot;

    if (dto.slot) {
      if (!validSlots.includes(dto.slot)) {
        throw new BadRequestException(
          `${item.name} cannot be equipped in the ${dto.slot} slot.`,
        );
      }
      targetSlot = dto.slot;
    } else {
      // Auto-pick: prefer empty slot, fall back to first valid
      const emptySlot = validSlots.find(
        (s) => !rows.some((r: any) => r.slot === s),
      );
      targetSlot = emptySlot ?? validSlots[0];
    }

    // Must have the item in backpack
    const backpackRow = rows.find(
      (r: any) => r.item_id === dto.itemId && r.slot === null,
    );
    if (!backpackRow) {
      throw new BadRequestException(
        `${item.name} is not in your backpack.`,
      );
    }

    const supabase = this.supabaseService.getClient();
    let unequipped: any = null;

    // Auto-unequip whatever is in the target slot
    const occupant = rows.find((r: any) => r.slot === targetSlot);
    if (occupant) {
      unequipped = { slot: targetSlot, item: this.formatItemBrief(occupant.item) };
      // Move occupant to backpack: merge or set slot to null
      const existingBackpack = rows.find(
        (r: any) => r.item_id === occupant.item_id && r.slot === null,
      );
      if (existingBackpack) {
        await supabase
          .from('character_inventory')
          .update({ quantity: existingBackpack.quantity + occupant.quantity })
          .eq('id', existingBackpack.id);
        await supabase
          .from('character_inventory')
          .delete()
          .eq('id', occupant.id);
      } else {
        await supabase
          .from('character_inventory')
          .update({ slot: null })
          .eq('id', occupant.id);
      }
    }

    // Equip the item: split from stack if quantity > 1
    if (backpackRow.quantity > 1) {
      // Reduce backpack quantity by 1
      await supabase
        .from('character_inventory')
        .update({ quantity: backpackRow.quantity - 1 })
        .eq('id', backpackRow.id);
      // Insert new equipped row
      const { error } = await supabase
        .from('character_inventory')
        .insert({
          character_id: character.id,
          item_id: dto.itemId,
          quantity: 1,
          slot: targetSlot,
        });
      if (error) throw new BadRequestException(error.message);
    } else {
      // Just move the row to the slot
      const { error } = await supabase
        .from('character_inventory')
        .update({ slot: targetSlot })
        .eq('id', backpackRow.id);
      if (error) throw new BadRequestException(error.message);
    }

    return {
      equipped: { slot: targetSlot, item: this.formatItemBrief(item) },
      unequipped,
      message: `Equipped ${item.name} in ${targetSlot} slot.`,
    };
  }

  /** Unequip an item from a slot back to backpack */
  async unequip(userId: string, dto: UnequipItemDto) {
    const character = await this.getCharacter(userId);

    if (character.in_combat) {
      throw new ConflictException('Cannot change equipment while in combat.');
    }
    if (character.in_dungeon) {
      throw new ConflictException('Cannot change equipment while in a dungeon.');
    }

    const rows = await this.getInventoryRows(character.id);

    const equippedRow = rows.find((r: any) => r.slot === dto.slot);
    if (!equippedRow) {
      throw new BadRequestException(`Nothing equipped in ${dto.slot} slot.`);
    }

    const supabase = this.supabaseService.getClient();

    // Merge with existing backpack stack if present
    const existingBackpack = rows.find(
      (r: any) => r.item_id === equippedRow.item_id && r.slot === null,
    );

    if (existingBackpack) {
      await supabase
        .from('character_inventory')
        .update({ quantity: existingBackpack.quantity + equippedRow.quantity })
        .eq('id', existingBackpack.id);
      await supabase
        .from('character_inventory')
        .delete()
        .eq('id', equippedRow.id);
    } else {
      await supabase
        .from('character_inventory')
        .update({ slot: null })
        .eq('id', equippedRow.id);
    }

    return {
      unequipped: { slot: dto.slot, item: this.formatItemBrief(equippedRow.item) },
      message: `Unequipped ${equippedRow.item.name} from ${dto.slot} slot.`,
    };
  }

  /** Use a consumable item */
  async useItem(userId: string, dto: UseItemDto) {
    const character = await this.getCharacter(userId);
    const item = await this.getItemDef(dto.itemId);

    if (item.type !== 'consumable') {
      throw new BadRequestException(`${item.name} is not a consumable.`);
    }

    const rows = await this.getInventoryRows(character.id);
    const backpackRow = rows.find(
      (r: any) => r.item_id === dto.itemId && r.slot === null,
    );

    if (!backpackRow) {
      throw new BadRequestException(
        `You don't have any ${item.name} in your backpack.`,
      );
    }

    // Apply effect
    let effectMessage: string;
    const supabase = this.supabaseService.getClient();

    switch (item.effect_type) {
      case 'heal_hp': {
        if (character.hp >= character.max_hp) {
          throw new BadRequestException('Already at full health.');
        }
        const healed = Math.min(item.effect_value, character.max_hp - character.hp);
        const newHp = character.hp + healed;
        const { error } = await supabase
          .from('characters')
          .update({ hp: newHp })
          .eq('id', character.id);
        if (error) throw new BadRequestException(error.message);
        effectMessage = `Restored ${healed} HP. HP: ${newHp}/${character.max_hp}`;
        break;
      }
      case 'restore_mana': {
        if (character.mana >= character.max_mana) {
          throw new BadRequestException('Already at full mana.');
        }
        const restored = Math.min(item.effect_value, character.max_mana - character.mana);
        const newMana = character.mana + restored;
        const { error } = await supabase
          .from('characters')
          .update({ mana: newMana })
          .eq('id', character.id);
        if (error) throw new BadRequestException(error.message);
        effectMessage = `Restored ${restored} mana. Mana: ${newMana}/${character.max_mana}`;
        break;
      }
      case 'boost_max_hp': {
        const newMaxHp = character.max_hp + item.effect_value;
        const newHp = character.hp + item.effect_value;
        const { error } = await supabase
          .from('characters')
          .update({ max_hp: newMaxHp, hp: newHp })
          .eq('id', character.id);
        if (error) throw new BadRequestException(error.message);
        effectMessage = `Max HP permanently increased by ${item.effect_value}. HP: ${newHp}/${newMaxHp}`;
        break;
      }
      case 'boost_strength':
      case 'boost_dexterity':
      case 'boost_constitution':
      case 'boost_intelligence':
      case 'boost_wisdom':
      case 'boost_charisma': {
        const stat = item.effect_type.replace('boost_', '');
        const currentValue = character[stat];
        const newValue = currentValue + item.effect_value;
        const updateData: Record<string, number> = { [stat]: newValue };
        // Constitution boosts also increase max_hp and hp
        if (stat === 'constitution') {
          updateData.max_hp = character.max_hp + item.effect_value;
          updateData.hp = character.hp + item.effect_value;
        }
        const { error } = await supabase
          .from('characters')
          .update(updateData)
          .eq('id', character.id);
        if (error) throw new BadRequestException(error.message);
        const statName = stat.charAt(0).toUpperCase() + stat.slice(1);
        effectMessage = `${statName} permanently increased by ${item.effect_value}. ${statName}: ${newValue}`;
        if (stat === 'constitution') {
          effectMessage += `. Max HP: ${updateData.max_hp}`;
        }
        break;
      }
      case 'learn_spell': {
        // Spell ID derived from item ID: "scroll-of-fireball" → "fireball"
        const spellId = item.id.replace('scroll-of-', '');

        // Verify spell exists
        const spellResult = await supabase
          .from('spells')
          .select('*')
          .eq('id', spellId)
          .single();
        if (spellResult.error || !spellResult.data) {
          throw new BadRequestException('This scroll contains an unknown spell.');
        }
        const spell = spellResult.data;

        // Class restriction check
        if (spell.class_restriction && spell.class_restriction !== character.class_id) {
          throw new BadRequestException(
            `Only the ${spell.class_restriction} class can learn ${spell.name}.`,
          );
        }

        // Level requirement check
        if (character.level < spell.level_required) {
          throw new BadRequestException(
            `You must be level ${spell.level_required} to learn ${spell.name}. You are level ${character.level}.`,
          );
        }

        // Already known check
        const knownResult = await supabase
          .from('character_spells')
          .select('id')
          .eq('character_id', character.id)
          .eq('spell_id', spellId)
          .maybeSingle();
        if (knownResult.data) {
          throw new BadRequestException(`You already know ${spell.name}.`);
        }

        // Learn the spell
        const insertResult = await supabase
          .from('character_spells')
          .insert({ character_id: character.id, spell_id: spellId });
        if (insertResult.error) {
          throw new BadRequestException(insertResult.error.message);
        }

        effectMessage = `You read the scroll and learned ${spell.name}!`;
        break;
      }
      default:
        throw new BadRequestException(
          `Unknown effect type: ${item.effect_type}`,
        );
    }

    // Consume the item
    if (backpackRow.quantity > 1) {
      await supabase
        .from('character_inventory')
        .update({ quantity: backpackRow.quantity - 1 })
        .eq('id', backpackRow.id);
    } else {
      await supabase
        .from('character_inventory')
        .delete()
        .eq('id', backpackRow.id);
    }

    return {
      used: item.name,
      effect: { type: item.effect_type, value: item.effect_value },
      result: effectMessage,
      remaining: backpackRow.quantity - 1,
    };
  }

  /* ─── Utilities for other modules ─── */

  /** Grant starting equipment to a newly created character */
  async grantStartingEquipment(characterId: string, classId: string) {
    const loadout = STARTING_EQUIPMENT[classId];
    if (!loadout) return;

    const supabase = this.supabaseService.getClient();

    for (const entry of loadout) {
      const { error } = await supabase
        .from('character_inventory')
        .insert({
          character_id: characterId,
          item_id: entry.itemId,
          quantity: entry.quantity ?? 1,
          slot: entry.slot ?? null,
        });

      if (error) {
        // Log but don't fail character creation over starting items
        console.warn(
          `Failed to grant starting item ${entry.itemId}: ${error.message}`,
        );
      }
    }
  }

  /**
   * Add items to a character's backpack (slot = null).
   * Upserts: increments quantity if item already exists in backpack.
   * Does NOT validate level, class, or weight — caller is responsible.
   */
  async addToBackpack(characterId: string, itemId: string, quantity: number) {
    const supabase = this.supabaseService.getClient();

    // Check for existing backpack row
    const { data: existing } = await supabase
      .from('character_inventory')
      .select('id, quantity')
      .eq('character_id', characterId)
      .eq('item_id', itemId)
      .is('slot', null)
      .maybeSingle();

    if (existing) {
      const { error } = await supabase
        .from('character_inventory')
        .update({ quantity: existing.quantity + quantity })
        .eq('id', existing.id);
      if (error) throw new BadRequestException(error.message);
    } else {
      const { error } = await supabase
        .from('character_inventory')
        .insert({
          character_id: characterId,
          item_id: itemId,
          quantity,
          slot: null,
        });
      if (error) throw new BadRequestException(error.message);
    }
  }

  /**
   * Remove items from a character's backpack (slot = null).
   * If quantity >= current, deletes the row. Otherwise decrements.
   * Returns the actual quantity removed (capped at what they have).
   * Throws if item not in backpack.
   */
  async removeFromBackpack(characterId: string, itemId: string, quantity: number): Promise<number> {
    const supabase = this.supabaseService.getClient();

    const { data: row } = await supabase
      .from('character_inventory')
      .select('id, quantity')
      .eq('character_id', characterId)
      .eq('item_id', itemId)
      .is('slot', null)
      .maybeSingle();

    if (!row) {
      throw new BadRequestException('Item not in backpack.');
    }

    const removed = Math.min(quantity, row.quantity);

    if (quantity >= row.quantity) {
      const { error } = await supabase
        .from('character_inventory')
        .delete()
        .eq('id', row.id);
      if (error) throw new BadRequestException(error.message);
    } else {
      const { error } = await supabase
        .from('character_inventory')
        .update({ quantity: row.quantity - quantity })
        .eq('id', row.id);
      if (error) throw new BadRequestException(error.message);
    }

    return removed;
  }

  /** Get all inventory rows for a character (used by shop service for weight checks) */
  async getInventoryRowsForCharacter(characterId: string) {
    return this.getInventoryRows(characterId);
  }

  /** Get carry weight for existing rows */
  getCarryWeight(rows: any[]): number {
    return this.computeCarryWeight(rows);
  }

  /** Get equipped items for a character (used by travel service) */
  async getEquippedItems(characterId: string) {
    const supabase = this.supabaseService.getClient();
    const { data, error } = await supabase
      .from('character_inventory')
      .select('slot, item:items(*)')
      .eq('character_id', characterId)
      .not('slot', 'is', null);

    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  /** Compute effective stats with equipment bonuses applied */
  computeEffectiveStats(character: any, equippedItems: any[]) {
    const bonuses = {
      strength: 0,
      dexterity: 0,
      constitution: 0,
      intelligence: 0,
      wisdom: 0,
      charisma: 0,
      ac: 0,
      hp: 0,
    };

    for (const row of equippedItems) {
      const item = row.item;
      bonuses.strength += item.bonus_strength;
      bonuses.dexterity += item.bonus_dexterity;
      bonuses.constitution += item.bonus_constitution;
      bonuses.intelligence += item.bonus_intelligence;
      bonuses.wisdom += item.bonus_wisdom;
      bonuses.charisma += item.bonus_charisma;
      bonuses.ac += item.bonus_ac;
      bonuses.hp += item.bonus_hp;
    }

    return {
      strength: character.strength + bonuses.strength,
      dexterity: character.dexterity + bonuses.dexterity,
      constitution: character.constitution + bonuses.constitution,
      intelligence: character.intelligence + bonuses.intelligence,
      wisdom: character.wisdom + bonuses.wisdom,
      charisma: character.charisma + bonuses.charisma,
      ac: character.ac + bonuses.ac,
      maxHp: character.max_hp + bonuses.hp,
    };
  }

  /* ─── Formatters ─── */

  private formatEquippedItem(row: any) {
    const item = row.item;
    return {
      id: item.id,
      name: item.name,
      type: item.type,
      rarity: item.rarity,
      weight: parseFloat(item.weight),
      bonuses: this.extractBonuses(item),
      ...(item.damage_min != null && {
        damage: `${item.damage_min}-${item.damage_max}`,
      }),
    };
  }

  private formatBackpackItem(row: any) {
    const item = row.item;
    return {
      itemId: item.id,
      name: item.name,
      type: item.type,
      rarity: item.rarity,
      quantity: row.quantity,
      weight: parseFloat(item.weight),
      totalWeight: +(parseFloat(item.weight) * row.quantity).toFixed(1),
      ...(item.effect_type && {
        effect: { type: item.effect_type, value: item.effect_value },
      }),
    };
  }

  private formatItemBrief(item: any) {
    return { id: item.id, name: item.name, type: item.type, rarity: item.rarity };
  }

  private extractBonuses(item: any): Record<string, number> {
    const bonuses: Record<string, number> = {};
    if (item.bonus_strength) bonuses.strength = item.bonus_strength;
    if (item.bonus_dexterity) bonuses.dexterity = item.bonus_dexterity;
    if (item.bonus_constitution) bonuses.constitution = item.bonus_constitution;
    if (item.bonus_intelligence) bonuses.intelligence = item.bonus_intelligence;
    if (item.bonus_wisdom) bonuses.wisdom = item.bonus_wisdom;
    if (item.bonus_charisma) bonuses.charisma = item.bonus_charisma;
    if (item.bonus_ac) bonuses.ac = item.bonus_ac;
    if (item.bonus_hp) bonuses.hp = item.bonus_hp;
    return bonuses;
  }
}
