import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { InventoryService } from '../inventory/inventory.service';
import { MapService } from '../map/map.service';
import {
  CraftingSkill,
  CRAFTING_XP_THRESHOLDS,
  MAX_CRAFTING_LEVEL,
  SKILL_STATION_TYPES,
  ALL_STATION_TYPES,
} from '../common/constants/crafting.constants';
import { CraftDto } from './dto/craft.dto';
import recipesData = require('../data/crafting-recipes.json');

/* ─── Types ─── */

interface Ingredient {
  itemId: string;
  quantity: number;
}

interface RecipeDef {
  id: string;
  name: string;
  skill: string;
  minLevel: number;
  xpReward: number;
  ingredients: Ingredient[];
  output: { itemId: string; quantity: number };
}

@Injectable()
export class CraftingService {
  private readonly logger = new Logger(CraftingService.name);
  private readonly recipes: Map<string, RecipeDef> = new Map();

  private questService: any = null;

  constructor(
    private supabaseService: SupabaseService,
    private inventoryService: InventoryService,
    private mapService: MapService,
  ) {
    for (const recipe of recipesData as RecipeDef[]) {
      this.recipes.set(recipe.id, recipe);
    }
    this.logger.log(`Loaded ${this.recipes.size} crafting recipes`);
  }

  /** Setter for circular dependency with QuestService */
  setQuestService(qs: any) {
    this.questService = qs;
  }

  /* ══════════════════════════════════════════════
     Helper: get character
     ══════════════════════════════════════════════ */

  private async getCharacter(userId: string) {
    const supabase = this.supabaseService.getClient();
    const { data, error } = await supabase
      .from('characters')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error || !data) {
      throw new NotFoundException('No character found. Create one first.');
    }
    return data;
  }

  /* ══════════════════════════════════════════════
     Helper: get or create crafting skill row
     ══════════════════════════════════════════════ */

  private async getSkillRow(characterId: string, skill: CraftingSkill) {
    const supabase = this.supabaseService.getClient();
    const { data } = await supabase
      .from('character_crafting_skills')
      .select('*')
      .eq('character_id', characterId)
      .eq('skill', skill)
      .maybeSingle();

    if (data) return data;

    // Create default row
    const { data: created, error } = await supabase
      .from('character_crafting_skills')
      .insert({ character_id: characterId, skill, level: 1, xp: 0 })
      .select()
      .single();

    if (error) throw new BadRequestException(error.message);
    return created;
  }

  /* ══════════════════════════════════════════════
     Helper: validate character state
     ══════════════════════════════════════════════ */

  private validateState(character: any) {
    if (character.in_combat) {
      throw new ConflictException('Cannot craft while in combat.');
    }
    if (character.travel_path) {
      throw new ConflictException('Cannot craft while traveling.');
    }
    if (character.rest_started_at) {
      throw new ConflictException('Cannot craft while resting.');
    }
    if (character.in_dungeon) {
      throw new ConflictException('Cannot craft while in a dungeon.');
    }
  }

  /* ══════════════════════════════════════════════
     GET /crafting/skills
     ══════════════════════════════════════════════ */

  async getSkills(userId: string) {
    const character = await this.getCharacter(userId);
    const supabase = this.supabaseService.getClient();

    const { data: rows } = await supabase
      .from('character_crafting_skills')
      .select('skill, level, xp')
      .eq('character_id', character.id);

    const skillMap: Record<string, { level: number; xp: number; xpToNext: number | null }> = {};

    for (const s of Object.values(CraftingSkill)) {
      const row = rows?.find((r: any) => r.skill === s);
      const level = row?.level ?? 1;
      const xp = row?.xp ?? 0;
      const xpToNext = level < MAX_CRAFTING_LEVEL
        ? CRAFTING_XP_THRESHOLDS[level]
        : null;
      skillMap[s] = { level, xp, xpToNext };
    }

    return { skills: skillMap };
  }

  /* ══════════════════════════════════════════════
     GET /crafting/recipes
     ══════════════════════════════════════════════ */

  async getRecipes(userId: string, skill?: string) {
    const character = await this.getCharacter(userId);
    const supabase = this.supabaseService.getClient();

    // Get all crafting skill rows for this character
    const { data: skillRows } = await supabase
      .from('character_crafting_skills')
      .select('skill, level')
      .eq('character_id', character.id);

    const skillLevels: Record<string, number> = {};
    for (const s of Object.values(CraftingSkill)) {
      const row = skillRows?.find((r: any) => r.skill === s);
      skillLevels[s] = row?.level ?? 1;
    }

    // Get inventory counts for all materials
    const { data: inventory } = await supabase
      .from('character_inventory')
      .select('item_id, quantity')
      .eq('character_id', character.id)
      .is('slot', null);

    const inventoryMap: Record<string, number> = {};
    if (inventory) {
      for (const row of inventory) {
        inventoryMap[row.item_id] = row.quantity;
      }
    }

    // Build recipe list
    let recipeList = [...this.recipes.values()];
    if (skill) {
      recipeList = recipeList.filter((r) => r.skill === skill);
    }

    const recipes = recipeList.map((recipe) => {
      const playerLevel = skillLevels[recipe.skill] ?? 1;
      const meetsLevel = playerLevel >= recipe.minLevel;

      const ingredients = recipe.ingredients.map((ing) => ({
        itemId: ing.itemId,
        quantity: ing.quantity,
        have: inventoryMap[ing.itemId] ?? 0,
      }));

      const hasIngredients = ingredients.every((ing) => ing.have >= ing.quantity);

      return {
        id: recipe.id,
        name: recipe.name,
        skill: recipe.skill,
        minLevel: recipe.minLevel,
        xpReward: recipe.xpReward,
        ingredients,
        output: recipe.output,
        meetsLevel,
        hasIngredients,
        canCraft: meetsLevel && hasIngredients,
      };
    });

    return { recipes };
  }

  /* ══════════════════════════════════════════════
     GET /crafting/stations
     ══════════════════════════════════════════════ */

  async getStations(userId: string) {
    const character = await this.getCharacter(userId);
    const supabase = this.supabaseService.getClient();

    const { data: pois } = await supabase
      .from('pois')
      .select('*')
      .eq('x', character.pos_x)
      .eq('y', character.pos_y)
      .in('type', ALL_STATION_TYPES);

    if (!pois || pois.length === 0) {
      return { position: { x: character.pos_x, y: character.pos_y }, stations: [] };
    }

    // Map station type back to skill
    const typeToSkill: Record<string, string> = {};
    for (const [skill, type] of Object.entries(SKILL_STATION_TYPES)) {
      typeToSkill[type] = skill;
    }

    const stations = pois.map((poi: any) => ({
      id: poi.id,
      name: poi.name,
      type: poi.type,
      skill: typeToSkill[poi.type] ?? null,
      description: poi.description,
    }));

    return {
      position: { x: character.pos_x, y: character.pos_y },
      stations,
    };
  }

  /* ══════════════════════════════════════════════
     POST /crafting/craft
     ══════════════════════════════════════════════ */

  async craft(userId: string, dto: CraftDto) {
    const character = await this.getCharacter(userId);
    const supabase = this.supabaseService.getClient();

    // 1. Validate state
    this.validateState(character);

    // 2. Look up recipe
    const recipe = this.recipes.get(dto.recipeId);
    if (!recipe) {
      throw new NotFoundException(`Recipe '${dto.recipeId}' not found.`);
    }

    // 3. Check character is at a matching crafting station
    const requiredStationType = SKILL_STATION_TYPES[recipe.skill as CraftingSkill];
    const { data: stationPois } = await supabase
      .from('pois')
      .select('id, name, type')
      .eq('x', character.pos_x)
      .eq('y', character.pos_y)
      .eq('type', requiredStationType)
      .maybeSingle();

    if (!stationPois) {
      throw new BadRequestException(
        `You need to be at a ${requiredStationType.replace('_', ' ')} to craft this recipe. Travel to the appropriate town first.`,
      );
    }

    // 4. Check crafting skill level
    const skill = recipe.skill as CraftingSkill;
    const skillRow = await this.getSkillRow(character.id, skill);

    if (skillRow.level < recipe.minLevel) {
      throw new ConflictException(
        `Your ${skill} level is ${skillRow.level}, but this recipe requires level ${recipe.minLevel}.`,
      );
    }

    // 5. Pre-validate ALL ingredients before removing any
    const missing: string[] = [];
    for (const ing of recipe.ingredients) {
      const { data: invRow } = await supabase
        .from('character_inventory')
        .select('quantity')
        .eq('character_id', character.id)
        .eq('item_id', ing.itemId)
        .is('slot', null)
        .maybeSingle();

      const have = invRow?.quantity ?? 0;
      if (have < ing.quantity) {
        missing.push(`${ing.itemId} (need ${ing.quantity}, have ${have})`);
      }
    }

    if (missing.length > 0) {
      throw new BadRequestException(
        `Missing ingredients: ${missing.join(', ')}`,
      );
    }

    // 6. Remove ingredients
    for (const ing of recipe.ingredients) {
      await this.inventoryService.removeFromBackpack(
        character.id,
        ing.itemId,
        ing.quantity,
      );
    }

    // 7. Add crafted output
    await this.inventoryService.addToBackpack(
      character.id,
      recipe.output.itemId,
      recipe.output.quantity,
    );

    // 8. Grant XP
    const xpResult = await this.grantXp(character.id, skill, skillRow, recipe.xpReward);

    // 9. Check fetch quest progress
    if (this.questService) {
      try {
        await this.questService.checkFetchProgress(character.id);
      } catch {
        // non-critical
      }
    }

    // 10. Get item name for response
    const itemName = await this.getItemName(recipe.output.itemId);

    const result: any = {
      crafted: itemName,
      itemId: recipe.output.itemId,
      quantity: recipe.output.quantity,
      xpGained: recipe.xpReward,
      skill,
      skillLevel: xpResult.level,
      skillXp: xpResult.xp,
    };

    if (xpResult.leveledUp) {
      result.levelUp = {
        newLevel: xpResult.level,
        skill,
      };
    }

    return result;
  }

  /* ─── XP granting ─── */

  private async grantXp(
    characterId: string,
    skill: CraftingSkill,
    skillRow: any,
    xpAmount: number,
  ): Promise<{ level: number; xp: number; leveledUp: boolean }> {
    let newXp = skillRow.xp + xpAmount;
    let newLevel = skillRow.level;
    let leveledUp = false;

    while (
      newLevel < MAX_CRAFTING_LEVEL &&
      newXp >= CRAFTING_XP_THRESHOLDS[newLevel]
    ) {
      newLevel++;
      leveledUp = true;
    }

    const supabase = this.supabaseService.getClient();
    await supabase
      .from('character_crafting_skills')
      .update({ xp: newXp, level: newLevel })
      .eq('character_id', characterId)
      .eq('skill', skill);

    if (leveledUp) {
      this.logger.log(
        `Character ${characterId} leveled up ${skill} to ${newLevel}`,
      );
    }

    return { level: newLevel, xp: newXp, leveledUp };
  }

  /* ─── Get item name helper ─── */

  private async getItemName(itemId: string): Promise<string> {
    const supabase = this.supabaseService.getClient();
    const { data } = await supabase
      .from('items')
      .select('name')
      .eq('id', itemId)
      .maybeSingle();
    return data?.name ?? itemId;
  }
}
