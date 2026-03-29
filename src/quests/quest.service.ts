import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
  Logger,
  Inject,
  forwardRef,
  OnModuleInit,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { InventoryService } from '../inventory/inventory.service';
import { LevelingService } from '../leveling/leveling.service';
import { MapService } from '../map/map.service';
import { CombatService } from '../combat/combat.service';
import { DungeonService } from '../dungeons/dungeon.service';
import { TravelService } from '../travel/travel.service';
import { MAX_ACTIVE_QUESTS } from '../common/constants/quest.constants';
import questsData = require('../data/quests.json');

/* ─── Types ─── */

export interface QuestObjective {
  type: 'kill' | 'fetch' | 'explore';
  target: string;
  quantity: number;
  description: string;
}

export interface QuestRewardItem {
  itemId: string;
  quantity: number;
}

export interface QuestRewards {
  xp: number;
  gold: number;
  items: QuestRewardItem[];
}

interface QuestDef {
  id: string;
  name: string;
  description: string;
  giverTown: string;
  levelMin: number;
  levelMax: number;
  objectives: QuestObjective[];
  rewards: QuestRewards;
  prerequisiteQuestId: string | null;
}

interface ProgressEntry {
  current: number;
  required: number;
}

@Injectable()
export class QuestService implements OnModuleInit {
  private readonly logger = new Logger(QuestService.name);
  private readonly questsById = new Map<string, QuestDef>();
  private readonly questsByTown = new Map<string, QuestDef[]>();

  constructor(
    private supabaseService: SupabaseService,
    private inventoryService: InventoryService,
    private levelingService: LevelingService,
    private mapService: MapService,
    @Inject(forwardRef(() => CombatService))
    private combatService: CombatService,
    @Inject(forwardRef(() => DungeonService))
    private dungeonService: DungeonService,
    @Inject(forwardRef(() => TravelService))
    private travelService: TravelService,
  ) {
    // Index quest definitions
    for (const q of questsData as QuestDef[]) {
      this.questsById.set(q.id, q);
      const list = this.questsByTown.get(q.giverTown) ?? [];
      list.push(q);
      this.questsByTown.set(q.giverTown, list);
    }
    this.logger.log(
      `Loaded ${this.questsById.size} quest definitions across ${this.questsByTown.size} towns`,
    );
  }

  onModuleInit() {
    // Wire bidirectional references to avoid circular dep issues
    this.combatService.setQuestService(this);
    this.dungeonService.setQuestService(this);
    this.travelService.setQuestService(this);
  }

  /* ═══════════════════════════════════════════════════════
     GET /quests/available — quests available at current town
     ═══════════════════════════════════════════════════════ */
  async getAvailableQuests(userId: string) {
    const character = await this.getCharacter(userId);

    // Must be at a town
    const poi = await this.mapService.getPOIAt(character.pos_x, character.pos_y);
    if (!poi || poi.type !== 'town') {
      throw new BadRequestException(
        'You must be at a town to view available quests.',
      );
    }

    const townQuests = this.questsByTown.get(poi.id) ?? [];
    if (townQuests.length === 0) {
      return { town: poi.name, quests: [] };
    }

    // Fetch player's quest rows for filtering
    const supabase = this.supabaseService.getClient();
    const { data: playerQuests } = await supabase
      .from('character_quests')
      .select('quest_id, status')
      .eq('character_id', character.id);

    const questStatusMap = new Map<string, string>();
    for (const pq of playerQuests ?? []) {
      questStatusMap.set(pq.quest_id, pq.status);
    }

    const available = townQuests.filter((q) => {
      // Level range check
      if (character.level < q.levelMin || character.level > q.levelMax) return false;
      // Already active, completed, or turned in
      const status = questStatusMap.get(q.id);
      if (status) return false;
      // Prerequisite check
      if (q.prerequisiteQuestId) {
        const preStatus = questStatusMap.get(q.prerequisiteQuestId);
        if (preStatus !== 'turned_in') return false;
      }
      return true;
    });

    return {
      town: poi.name,
      quests: available.map((q) => ({
        id: q.id,
        name: q.name,
        description: q.description,
        levelMin: q.levelMin,
        levelMax: q.levelMax,
        objectives: q.objectives,
        rewards: q.rewards,
      })),
    };
  }

  /* ═══════════════════════════════════════════════════════
     GET /quests/active — player's active + completed quests
     ═══════════════════════════════════════════════════════ */
  async getActiveQuests(userId: string) {
    const character = await this.getCharacter(userId);
    const supabase = this.supabaseService.getClient();

    const { data: rows, error } = await supabase
      .from('character_quests')
      .select('*')
      .eq('character_id', character.id)
      .in('status', ['active', 'completed'])
      .order('accepted_at', { ascending: true });

    if (error) throw new BadRequestException(error.message);

    return {
      activeCount: (rows ?? []).length,
      maxActive: MAX_ACTIVE_QUESTS,
      quests: (rows ?? []).map((row) => {
        const def = this.questsById.get(row.quest_id);
        return {
          id: row.quest_id,
          name: def?.name ?? row.quest_id,
          description: def?.description,
          giverTown: def?.giverTown,
          status: row.status,
          objectives: (def?.objectives ?? []).map((obj, i) => ({
            ...obj,
            current: (row.progress as ProgressEntry[])[i]?.current ?? 0,
            required: (row.progress as ProgressEntry[])[i]?.required ?? obj.quantity,
          })),
          rewards: def?.rewards,
          acceptedAt: row.accepted_at,
          completedAt: row.completed_at,
        };
      }),
    };
  }

  /* ═══════════════════════════════════════════════════════
     POST /quests/accept — accept a quest
     ═══════════════════════════════════════════════════════ */
  async acceptQuest(userId: string, questId: string) {
    const character = await this.getCharacter(userId);
    const def = this.questsById.get(questId);
    if (!def) throw new NotFoundException('Quest not found.');

    // Must be at the giver town
    const poi = await this.mapService.getPOIAt(character.pos_x, character.pos_y);
    if (!poi || poi.id !== def.giverTown) {
      throw new BadRequestException(
        `You must be at ${def.giverTown} to accept this quest.`,
      );
    }

    // Level check
    if (character.level < def.levelMin || character.level > def.levelMax) {
      throw new BadRequestException(
        `This quest requires level ${def.levelMin}-${def.levelMax}. You are level ${character.level}.`,
      );
    }

    const supabase = this.supabaseService.getClient();

    // Check active count
    const { data: activeRows } = await supabase
      .from('character_quests')
      .select('quest_id, status')
      .eq('character_id', character.id);

    const activeCount = (activeRows ?? []).filter(
      (r) => r.status === 'active' || r.status === 'completed',
    ).length;

    if (activeCount >= MAX_ACTIVE_QUESTS) {
      throw new ConflictException(
        `You already have ${MAX_ACTIVE_QUESTS} active quests. Abandon or turn in a quest first.`,
      );
    }

    // Already accepted?
    const existing = (activeRows ?? []).find((r) => r.quest_id === questId);
    if (existing) {
      throw new ConflictException('Quest already accepted or completed.');
    }

    // Prerequisite check
    if (def.prerequisiteQuestId) {
      const preReq = (activeRows ?? []).find(
        (r) => r.quest_id === def.prerequisiteQuestId,
      );
      if (!preReq || preReq.status !== 'turned_in') {
        const preQuestDef = this.questsById.get(def.prerequisiteQuestId);
        throw new BadRequestException(
          `You must complete "${preQuestDef?.name ?? def.prerequisiteQuestId}" first.`,
        );
      }
    }

    // Build initial progress — pre-fill fetch objectives by checking inventory
    const progress: ProgressEntry[] = [];
    for (const obj of def.objectives) {
      if (obj.type === 'fetch') {
        const count = await this.getBackpackItemCount(
          character.id,
          obj.target,
        );
        progress.push({ current: Math.min(count, obj.quantity), required: obj.quantity });
      } else {
        progress.push({ current: 0, required: obj.quantity });
      }
    }

    // Insert
    const { error } = await supabase.from('character_quests').insert({
      character_id: character.id,
      quest_id: questId,
      status: 'active',
      progress,
    });

    if (error) throw new BadRequestException(error.message);

    // Check if already complete (e.g. fetch quests where player already has items)
    const allComplete = progress.every((p) => p.current >= p.required);
    if (allComplete) {
      await supabase
        .from('character_quests')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('character_id', character.id)
        .eq('quest_id', questId);
    }

    return {
      message: allComplete
        ? `Quest "${def.name}" accepted and already completed! Return to ${def.giverTown} to turn it in.`
        : `Quest "${def.name}" accepted.`,
      quest: {
        id: def.id,
        name: def.name,
        description: def.description,
        status: allComplete ? 'completed' : 'active',
        objectives: def.objectives.map((obj, i) => ({
          ...obj,
          current: progress[i].current,
          required: progress[i].required,
        })),
        rewards: def.rewards,
      },
    };
  }

  /* ═══════════════════════════════════════════════════════
     POST /quests/turn-in — turn in a completed quest
     ═══════════════════════════════════════════════════════ */
  async turnInQuest(userId: string, questId: string) {
    const character = await this.getCharacter(userId);
    const def = this.questsById.get(questId);
    if (!def) throw new NotFoundException('Quest not found.');

    // Must be at the giver town
    const poi = await this.mapService.getPOIAt(character.pos_x, character.pos_y);
    if (!poi || poi.id !== def.giverTown) {
      throw new BadRequestException(
        `You must return to ${def.giverTown} to turn in this quest.`,
      );
    }

    const supabase = this.supabaseService.getClient();

    const { data: questRow, error } = await supabase
      .from('character_quests')
      .select('*')
      .eq('character_id', character.id)
      .eq('quest_id', questId)
      .maybeSingle();

    if (error) throw new BadRequestException(error.message);
    if (!questRow) throw new NotFoundException('Quest not in your quest log.');
    if (questRow.status === 'turned_in') {
      throw new ConflictException('Quest already turned in.');
    }
    if (questRow.status !== 'completed') {
      throw new BadRequestException(
        'Quest objectives are not yet complete.',
      );
    }

    // Consume fetch items
    for (const obj of def.objectives) {
      if (obj.type === 'fetch') {
        await this.inventoryService.removeFromBackpack(
          character.id,
          obj.target,
          obj.quantity,
        );
      }
    }

    // Grant rewards
    const rewardSummary: string[] = [];

    // XP
    const xpResult = await this.levelingService.grantXp(
      character.id,
      def.rewards.xp,
    );
    rewardSummary.push(`${def.rewards.xp} XP`);

    // Gold
    if (def.rewards.gold > 0) {
      await supabase
        .from('characters')
        .update({ gold: character.gold + def.rewards.gold })
        .eq('id', character.id);
      rewardSummary.push(`${def.rewards.gold} gold`);
    }

    // Items
    const itemRewards: { itemId: string; quantity: number; name?: string }[] = [];
    for (const item of def.rewards.items) {
      await this.inventoryService.addToBackpack(
        character.id,
        item.itemId,
        item.quantity,
      );
      itemRewards.push(item);
      rewardSummary.push(`${item.quantity}x ${item.itemId}`);
    }

    // Mark turned in
    await supabase
      .from('character_quests')
      .update({ status: 'turned_in' })
      .eq('character_id', character.id)
      .eq('quest_id', questId);

    return {
      message: `Quest "${def.name}" turned in! Rewards: ${rewardSummary.join(', ')}.`,
      rewards: {
        xp: def.rewards.xp,
        gold: def.rewards.gold,
        items: itemRewards,
        leveledUp: xpResult.leveledUp,
        newLevel: xpResult.newLevel,
        newSpells: xpResult.newSpells,
      },
    };
  }

  /* ═══════════════════════════════════════════════════════
     POST /quests/abandon — abandon an active quest
     ═══════════════════════════════════════════════════════ */
  async abandonQuest(userId: string, questId: string) {
    const character = await this.getCharacter(userId);
    const def = this.questsById.get(questId);
    if (!def) throw new NotFoundException('Quest not found.');

    const supabase = this.supabaseService.getClient();

    const { data: row } = await supabase
      .from('character_quests')
      .select('id, status')
      .eq('character_id', character.id)
      .eq('quest_id', questId)
      .maybeSingle();

    if (!row) throw new NotFoundException('Quest not in your quest log.');
    if (row.status === 'turned_in') {
      throw new ConflictException('Cannot abandon a turned-in quest.');
    }

    await supabase.from('character_quests').delete().eq('id', row.id);

    return {
      message: `Quest "${def.name}" abandoned. You can accept it again later.`,
    };
  }

  /* ═══════════════════════════════════════════════════════
     Callback: onMonsterKill — called by CombatService
     ═══════════════════════════════════════════════════════ */
  async onMonsterKill(characterId: string, monsterId: string) {
    const supabase = this.supabaseService.getClient();

    const { data: activeQuests } = await supabase
      .from('character_quests')
      .select('*')
      .eq('character_id', characterId)
      .eq('status', 'active');

    if (!activeQuests?.length) return;

    for (const row of activeQuests) {
      const def = this.questsById.get(row.quest_id);
      if (!def) continue;

      let updated = false;
      const progress = row.progress as ProgressEntry[];

      for (let i = 0; i < def.objectives.length; i++) {
        const obj = def.objectives[i];
        if (obj.type === 'kill' && obj.target === monsterId) {
          if (progress[i].current < progress[i].required) {
            progress[i].current++;
            updated = true;
          }
        }
      }

      if (updated) {
        const allComplete = progress.every((p) => p.current >= p.required);
        const updateData: Record<string, any> = { progress };
        if (allComplete) {
          updateData.status = 'completed';
          updateData.completed_at = new Date().toISOString();
          this.logger.log(
            `Quest "${def.name}" completed for character ${characterId}`,
          );
        }
        await supabase
          .from('character_quests')
          .update(updateData)
          .eq('id', row.id);
      }
    }
  }

  /* ═══════════════════════════════════════════════════════
     Callback: onPOIVisit — called by TravelService
     ═══════════════════════════════════════════════════════ */
  async onPOIVisit(characterId: string, poiId: string) {
    await this.resolveExploreObjective(characterId, poiId);
  }

  /* ═══════════════════════════════════════════════════════
     Callback: onDungeonComplete — called by DungeonService
     ═══════════════════════════════════════════════════════ */
  async onDungeonComplete(characterId: string, poiId: string) {
    await this.resolveExploreObjective(characterId, poiId);
  }

  /* ═══════════════════════════════════════════════════════
     Callback: checkFetchProgress — called when inventory changes
     ═══════════════════════════════════════════════════════ */
  async checkFetchProgress(characterId: string) {
    const supabase = this.supabaseService.getClient();

    const { data: activeQuests } = await supabase
      .from('character_quests')
      .select('*')
      .eq('character_id', characterId)
      .eq('status', 'active');

    if (!activeQuests?.length) return;

    for (const row of activeQuests) {
      const def = this.questsById.get(row.quest_id);
      if (!def) continue;

      const hasFetch = def.objectives.some((o) => o.type === 'fetch');
      if (!hasFetch) continue;

      let updated = false;
      const progress = row.progress as ProgressEntry[];

      for (let i = 0; i < def.objectives.length; i++) {
        const obj = def.objectives[i];
        if (obj.type === 'fetch') {
          const count = await this.getBackpackItemCount(characterId, obj.target);
          const newCurrent = Math.min(count, obj.quantity);
          if (newCurrent !== progress[i].current) {
            progress[i].current = newCurrent;
            updated = true;
          }
        }
      }

      if (updated) {
        const allComplete = progress.every((p) => p.current >= p.required);
        const updateData: Record<string, any> = { progress };
        if (allComplete) {
          updateData.status = 'completed';
          updateData.completed_at = new Date().toISOString();
          this.logger.log(
            `Quest "${def.name}" completed for character ${characterId} (fetch)`,
          );
        }
        await supabase
          .from('character_quests')
          .update(updateData)
          .eq('id', row.id);
      }
    }
  }

  /* ─── Private helpers ─── */

  private async resolveExploreObjective(characterId: string, poiId: string) {
    const supabase = this.supabaseService.getClient();

    const { data: activeQuests } = await supabase
      .from('character_quests')
      .select('*')
      .eq('character_id', characterId)
      .eq('status', 'active');

    if (!activeQuests?.length) return;

    for (const row of activeQuests) {
      const def = this.questsById.get(row.quest_id);
      if (!def) continue;

      let updated = false;
      const progress = row.progress as ProgressEntry[];

      for (let i = 0; i < def.objectives.length; i++) {
        const obj = def.objectives[i];
        if (obj.type === 'explore' && obj.target === poiId) {
          if (progress[i].current < progress[i].required) {
            progress[i].current = progress[i].required;
            updated = true;
          }
        }
      }

      if (updated) {
        const allComplete = progress.every((p) => p.current >= p.required);
        const updateData: Record<string, any> = { progress };
        if (allComplete) {
          updateData.status = 'completed';
          updateData.completed_at = new Date().toISOString();
          this.logger.log(
            `Quest "${def.name}" completed for character ${characterId} (explore)`,
          );
        }
        await supabase
          .from('character_quests')
          .update(updateData)
          .eq('id', row.id);
      }
    }
  }

  private async getBackpackItemCount(
    characterId: string,
    itemId: string,
  ): Promise<number> {
    const supabase = this.supabaseService.getClient();
    const { data } = await supabase
      .from('character_inventory')
      .select('quantity')
      .eq('character_id', characterId)
      .eq('item_id', itemId)
      .is('slot', null)
      .maybeSingle();
    return data?.quantity ?? 0;
  }

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
}
