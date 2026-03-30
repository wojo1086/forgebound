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
  GatheringSkill,
  GATHERING_XP_THRESHOLDS,
  MAX_GATHERING_LEVEL,
  SKILL_NODE_TYPES,
} from '../common/constants/gathering.constants';
import { HarvestDto } from './dto/harvest.dto';
import nodesData = require('../data/gathering-nodes.json');

/* ─── Types ─── */

interface LootEntry {
  itemId: string;
  weight: number;
  quantity: [number, number];
}

interface GatheringNodeDef {
  id: string;
  name: string;
  skill: string;
  minLevel: number;
  xpReward: number;
  cooldownMinutes: number;
  lootTable: LootEntry[];
}

@Injectable()
export class GatheringService {
  private readonly logger = new Logger(GatheringService.name);
  private readonly nodes: Map<string, GatheringNodeDef> = new Map();

  private questService: any = null;

  constructor(
    private supabaseService: SupabaseService,
    private inventoryService: InventoryService,
    private mapService: MapService,
  ) {
    for (const node of nodesData as GatheringNodeDef[]) {
      this.nodes.set(node.id, node);
    }
    this.logger.log(`Loaded ${this.nodes.size} gathering node definitions`);
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
     Helper: get or create gathering skills row
     ══════════════════════════════════════════════ */

  private async getSkillRow(characterId: string, skill: GatheringSkill) {
    const supabase = this.supabaseService.getClient();
    const { data } = await supabase
      .from('character_gathering_skills')
      .select('*')
      .eq('character_id', characterId)
      .eq('skill', skill)
      .maybeSingle();

    if (data) return data;

    // Create default row
    const { data: created, error } = await supabase
      .from('character_gathering_skills')
      .insert({ character_id: characterId, skill, level: 1, xp: 0 })
      .select()
      .single();

    if (error) throw new BadRequestException(error.message);
    return created;
  }

  /* ══════════════════════════════════════════════
     GET /gathering/skills
     ══════════════════════════════════════════════ */

  async getSkills(userId: string) {
    const character = await this.getCharacter(userId);
    const supabase = this.supabaseService.getClient();

    const { data: rows } = await supabase
      .from('character_gathering_skills')
      .select('skill, level, xp')
      .eq('character_id', character.id);

    const skillMap: Record<string, { level: number; xp: number; xpToNext: number | null }> = {};

    for (const s of Object.values(GatheringSkill)) {
      const row = rows?.find((r: any) => r.skill === s);
      const level = row?.level ?? 1;
      const xp = row?.xp ?? 0;
      const xpToNext = level < MAX_GATHERING_LEVEL
        ? GATHERING_XP_THRESHOLDS[level] // next level threshold
        : null;
      skillMap[s] = { level, xp, xpToNext };
    }

    return { skills: skillMap };
  }

  /* ══════════════════════════════════════════════
     GET /gathering/nodes
     ══════════════════════════════════════════════ */

  async getNearbyNodes(userId: string) {
    const character = await this.getCharacter(userId);
    const supabase = this.supabaseService.getClient();

    // Find gathering POIs at the character's position
    const { data: pois } = await supabase
      .from('pois')
      .select('*')
      .eq('x', character.pos_x)
      .eq('y', character.pos_y)
      .in('type', ['mining_node', 'herb_node', 'woodcutting_node']);

    if (!pois || pois.length === 0) {
      return { position: { x: character.pos_x, y: character.pos_y }, nodes: [] };
    }

    // Get cooldowns for these nodes
    const nodePoiIds = pois.map((p: any) => p.id);
    const { data: cooldowns } = await supabase
      .from('gathering_cooldowns')
      .select('node_id, available_at')
      .eq('character_id', character.id)
      .in('node_id', nodePoiIds);

    const cooldownMap: Record<string, string> = {};
    if (cooldowns) {
      for (const cd of cooldowns) {
        cooldownMap[cd.node_id] = cd.available_at;
      }
    }

    const nodes = pois.map((poi: any) => {
      // Look up the node definition via the nodeId stored on the POI
      // The POI's description field won't have nodeId, we need to parse the POI id pattern
      // Actually we store nodeId as a column — but for now derive from the POI's type + name mapping
      const nodeDef = this.findNodeDefForPoi(poi);
      const availableAt = cooldownMap[poi.id] ?? null;
      const isReady = !availableAt || new Date(availableAt) <= new Date();

      return {
        poiId: poi.id,
        name: poi.name,
        type: poi.type,
        nodeId: nodeDef?.id ?? null,
        skill: nodeDef?.skill ?? null,
        minLevel: nodeDef?.minLevel ?? null,
        xpReward: nodeDef?.xpReward ?? null,
        cooldownMinutes: nodeDef?.cooldownMinutes ?? null,
        ready: isReady,
        availableAt: isReady ? null : availableAt,
      };
    });

    return {
      position: { x: character.pos_x, y: character.pos_y },
      nodes,
    };
  }

  /** Map a POI to its gathering node definition using the node_id stored in POI data */
  private findNodeDefForPoi(poi: any): GatheringNodeDef | null {
    // The POI id is like "copper-vein-1", and the node def id is "copper-vein"
    // Strip the trailing -N suffix
    const baseId = poi.id.replace(/-\d+$/, '');
    return this.nodes.get(baseId) ?? null;
  }

  /* ══════════════════════════════════════════════
     POST /gathering/harvest
     ══════════════════════════════════════════════ */

  async harvest(userId: string, dto: HarvestDto) {
    const character = await this.getCharacter(userId);
    const supabase = this.supabaseService.getClient();

    // 1. Can't be in combat, traveling, or resting
    if (character.in_combat) {
      throw new ConflictException('Cannot gather while in combat.');
    }
    if (character.travel_path) {
      throw new ConflictException('Cannot gather while traveling.');
    }
    if (character.rest_started_at) {
      throw new ConflictException('Cannot gather while resting.');
    }
    if (character.in_dungeon) {
      throw new ConflictException('Cannot gather while in a dungeon.');
    }

    // 2. Find the POI
    const { data: poi } = await supabase
      .from('pois')
      .select('*')
      .eq('id', dto.nodeId)
      .maybeSingle();

    if (!poi) {
      throw new NotFoundException(`Gathering node '${dto.nodeId}' not found.`);
    }

    // 3. Must be a gathering node type
    if (!['mining_node', 'herb_node', 'woodcutting_node'].includes(poi.type)) {
      throw new BadRequestException('That POI is not a gathering node.');
    }

    // 4. Character must be at the node's coordinates
    if (character.pos_x !== poi.x || character.pos_y !== poi.y) {
      throw new ConflictException(
        `You must be at (${poi.x}, ${poi.y}) to harvest this node. You are at (${character.pos_x}, ${character.pos_y}).`,
      );
    }

    // 5. Look up node definition
    const nodeDef = this.findNodeDefForPoi(poi);
    if (!nodeDef) {
      throw new BadRequestException('Unknown gathering node type.');
    }

    // 6. Determine skill type
    const skill = nodeDef.skill as GatheringSkill;
    const skillRow = await this.getSkillRow(character.id, skill);

    // 7. Check minimum skill level
    if (skillRow.level < nodeDef.minLevel) {
      throw new ConflictException(
        `Your ${skill} level is ${skillRow.level}, but this node requires level ${nodeDef.minLevel}.`,
      );
    }

    // 8. Check cooldown
    const { data: cooldown } = await supabase
      .from('gathering_cooldowns')
      .select('available_at')
      .eq('character_id', character.id)
      .eq('node_id', dto.nodeId)
      .maybeSingle();

    if (cooldown && new Date(cooldown.available_at) > new Date()) {
      const remaining = Math.ceil(
        (new Date(cooldown.available_at).getTime() - Date.now()) / 1000,
      );
      throw new ConflictException(
        `This node is on cooldown. Available in ${remaining} seconds.`,
      );
    }

    // 9. Roll loot table
    const { itemId, quantity } = this.rollLootTable(nodeDef.lootTable);

    // 10. Add to backpack
    await this.inventoryService.addToBackpack(character.id, itemId, quantity);

    // 11. Grant XP and check for level-up
    const xpResult = await this.grantXp(character.id, skill, skillRow, nodeDef.xpReward);

    // 12. Set cooldown
    const availableAt = new Date(
      Date.now() + nodeDef.cooldownMinutes * 60 * 1000,
    ).toISOString();

    if (cooldown) {
      await supabase
        .from('gathering_cooldowns')
        .update({ available_at: availableAt })
        .eq('character_id', character.id)
        .eq('node_id', dto.nodeId);
    } else {
      await supabase.from('gathering_cooldowns').insert({
        character_id: character.id,
        node_id: dto.nodeId,
        available_at: availableAt,
      });
    }

    // 13. Check fetch quest progress (material in inventory changed)
    if (this.questService) {
      try {
        await this.questService.checkFetchProgress(character.id);
      } catch {
        // non-critical
      }
    }

    // Get item name for response
    const itemDef = await this.getItemName(itemId);

    const result: any = {
      harvested: itemDef,
      itemId,
      quantity,
      xpGained: nodeDef.xpReward,
      skill,
      skillLevel: xpResult.level,
      skillXp: xpResult.xp,
      cooldownMinutes: nodeDef.cooldownMinutes,
      availableAt,
    };

    if (xpResult.leveledUp) {
      result.levelUp = {
        newLevel: xpResult.level,
        skill,
      };
    }

    return result;
  }

  /* ─── Loot table roll ─── */

  private rollLootTable(
    lootTable: LootEntry[],
  ): { itemId: string; quantity: number } {
    const totalWeight = lootTable.reduce((sum, e) => sum + e.weight, 0);
    let roll = Math.random() * totalWeight;

    for (const entry of lootTable) {
      roll -= entry.weight;
      if (roll <= 0) {
        const [min, max] = entry.quantity;
        const qty = min + Math.floor(Math.random() * (max - min + 1));
        return { itemId: entry.itemId, quantity: qty };
      }
    }

    // Fallback to first entry
    const first = lootTable[0];
    return { itemId: first.itemId, quantity: first.quantity[0] };
  }

  /* ─── XP granting ─── */

  private async grantXp(
    characterId: string,
    skill: GatheringSkill,
    skillRow: any,
    xpAmount: number,
  ): Promise<{ level: number; xp: number; leveledUp: boolean }> {
    let newXp = skillRow.xp + xpAmount;
    let newLevel = skillRow.level;
    let leveledUp = false;

    // Check for level-up(s)
    while (
      newLevel < MAX_GATHERING_LEVEL &&
      newXp >= GATHERING_XP_THRESHOLDS[newLevel]
    ) {
      newLevel++;
      leveledUp = true;
    }

    const supabase = this.supabaseService.getClient();
    await supabase
      .from('character_gathering_skills')
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
