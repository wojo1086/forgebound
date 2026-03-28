import {
  BadRequestException,
  ConflictException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { CombatService } from '../combat/combat.service';
import { InventoryService } from '../inventory/inventory.service';
import { LevelingService } from '../leveling/leveling.service';
import { abilityModifier } from '../common/constants/game.constants';
import {
  DUNGEON_POI_TYPES,
  ROOM_COUNT,
  ROOM_WEIGHTS,
  TRAP_DAMAGE_FRACTION,
  TRAP_AVOID_BASE,
  TRAP_DEX_BONUS,
  TRAP_MAX_AVOID,
  TRAP_MIN_AVOID,
  DUNGEON_REST_HP_FRACTION,
  DUNGEON_REST_MANA_FRACTION,
  TREASURE_ROOM_ROLLS,
  TREASURE_GOLD_MIN,
  TREASURE_GOLD_MAX,
  TREASURE_GOLD_LEVEL_SCALE,
  COMPLETION_XP_BASE,
  COMPLETION_XP_PER_LEVEL,
  COMPLETION_GOLD_BASE,
  COMPLETION_GOLD_PER_LEVEL,
  DUNGEON_RESET_COOLDOWN,
} from '../common/constants/dungeon.constants';
import {
  MAP_CENTER_X,
  MAP_CENTER_Y,
  AREA_LEVEL_BANDS,
} from '../common/constants/combat.constants';
import templates = require('../data/dungeon-templates.json');

/* ─── Types ─── */

interface DungeonTemplate {
  name: string;
  monsterTypes: string[];
  trapTypes: string[];
  bossPool: string[];
}

/* ─── Utility ─── */

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

const TRAP_DESCRIPTIONS: Record<string, string> = {
  pit: 'A hidden pit opens beneath your feet!',
  rockfall: 'Rocks cascade from the ceiling!',
  poison_dart: 'Poison darts shoot from the walls!',
  magic_rune: 'A glowing rune detonates as you step near!',
  collapsing_floor: 'The floor crumbles beneath you!',
  cave_in: 'The tunnel begins to collapse!',
  gas_leak: 'Noxious gas fills the chamber!',
  tripwire: 'You trigger a hidden tripwire!',
  arrow_trap: 'A volley of arrows flies from the wall!',
  portcullis: 'A spiked portcullis slams down!',
  alarm: 'An alarm triggers — reinforcements attack!',
  curse: 'An ancient curse strikes you!',
  web: 'Thick webs ensnare you as spiders close in!',
};

@Injectable()
export class DungeonService implements OnModuleInit {
  private readonly logger = new Logger(DungeonService.name);
  private readonly templates: Record<string, DungeonTemplate> =
    templates as any;

  constructor(
    private supabaseService: SupabaseService,
    @Inject(forwardRef(() => CombatService))
    private combatService: CombatService,
    private inventoryService: InventoryService,
    private levelingService: LevelingService,
  ) {}

  onModuleInit() {
    // Wire up the bidirectional reference to avoid circular dep issues
    this.combatService.setDungeonService(this);
  }

  /* ═══════════════════════════════════════════════
     GET STATUS
     ═══════════════════════════════════════════════ */

  async getDungeonStatus(userId: string) {
    const character = await this.getCharacter(userId);
    const supabase = this.supabaseService.getClient();

    const { data: dungeon } = await supabase
      .from('active_dungeons')
      .select('*')
      .eq('character_id', character.id)
      .maybeSingle();

    if (!dungeon) {
      return { inDungeon: false };
    }

    const { data: rooms } = await supabase
      .from('dungeon_rooms')
      .select('room_index, room_type, cleared, result_log')
      .eq('dungeon_id', dungeon.id)
      .order('room_index', { ascending: true });

    // Get POI name
    const { data: poi } = await supabase
      .from('pois')
      .select('name')
      .eq('id', dungeon.poi_id)
      .single();

    return {
      inDungeon: true,
      dungeonId: dungeon.id,
      poiId: dungeon.poi_id,
      poiName: poi?.name ?? dungeon.poi_id,
      dungeonLevel: dungeon.dungeon_level,
      currentRoom: dungeon.current_room,
      totalRooms: dungeon.total_rooms,
      completed: dungeon.completed,
      rooms: (rooms ?? []).map((r: any) => ({
        index: r.room_index,
        type: r.room_type,
        cleared: r.cleared,
        log: r.result_log,
      })),
    };
  }

  /* ═══════════════════════════════════════════════
     ENTER DUNGEON
     ═══════════════════════════════════════════════ */

  async enterDungeon(userId: string, poiId: string) {
    const character = await this.getCharacter(userId);
    const supabase = this.supabaseService.getClient();

    // Guards
    if (character.in_combat) {
      throw new ConflictException('Cannot enter a dungeon while in combat.');
    }
    if (character.travel_eta) {
      throw new ConflictException('Cannot enter a dungeon while traveling.');
    }

    // Already in a dungeon?
    if (character.in_dungeon) {
      // Check if it's the same POI — resume
      const { data: existing } = await supabase
        .from('active_dungeons')
        .select('poi_id')
        .eq('character_id', character.id)
        .maybeSingle();

      if (existing && existing.poi_id === poiId) {
        return this.getDungeonStatus(userId);
      }
      throw new ConflictException(
        'You are already in a dungeon. Leave it first.',
      );
    }

    // Validate POI
    const { data: poi, error: poiErr } = await supabase
      .from('pois')
      .select('*')
      .eq('id', poiId)
      .single();

    if (poiErr || !poi) {
      throw new NotFoundException(`POI '${poiId}' not found.`);
    }

    if (!DUNGEON_POI_TYPES.has(poi.type)) {
      throw new BadRequestException(
        `POI '${poi.name}' is not a dungeon. Type: ${poi.type}`,
      );
    }

    // Check player is at the POI location
    if (character.pos_x !== poi.x || character.pos_y !== poi.y) {
      throw new BadRequestException(
        `You must be at ${poi.name} (${poi.x},${poi.y}) to enter. You are at (${character.pos_x},${character.pos_y}).`,
      );
    }

    // Check for hidden POI discovery
    if (!poi.visible) {
      const { data: discovered } = await supabase
        .from('player_discoveries')
        .select('id')
        .eq('user_id', character.user_id)
        .eq('poi_id', poiId)
        .maybeSingle();

      if (!discovered) {
        throw new BadRequestException(
          `You haven't discovered this location yet.`,
        );
      }
    }

    // Check cooldown — was this dungeon completed recently?
    const { data: prevDungeon } = await supabase
      .from('active_dungeons')
      .select('*')
      .eq('character_id', character.id)
      .eq('poi_id', poiId)
      .maybeSingle();

    if (prevDungeon) {
      if (prevDungeon.completed && prevDungeon.completed_at) {
        const completedAt = new Date(prevDungeon.completed_at).getTime();
        const elapsed = Date.now() - completedAt;
        if (elapsed < DUNGEON_RESET_COOLDOWN) {
          const remaining = Math.ceil(
            (DUNGEON_RESET_COOLDOWN - elapsed) / 60000,
          );
          throw new ConflictException(
            `${poi.name} was recently cleared. It resets in ${remaining} minutes.`,
          );
        }
        // Cooldown passed — delete old dungeon + rooms and generate fresh
        await supabase
          .from('dungeon_rooms')
          .delete()
          .eq('dungeon_id', prevDungeon.id);
        await supabase
          .from('active_dungeons')
          .delete()
          .eq('id', prevDungeon.id);
      } else if (!prevDungeon.completed) {
        // Resume uncompleted dungeon
        await supabase
          .from('characters')
          .update({ in_dungeon: true })
          .eq('id', character.id);
        return this.getDungeonStatus(userId);
      }
    }

    // Determine dungeon level
    const dungeonLevel = this.getDungeonLevel(poi);

    // Determine room count
    const countRange =
      poi.category === 'landmark' ? ROOM_COUNT.landmark : ROOM_COUNT.hidden;
    const totalRooms = randomInt(countRange.min, countRange.max);

    // Get template
    const template = this.templates[poi.type];
    if (!template) {
      throw new BadRequestException(
        `No dungeon template for POI type '${poi.type}'.`,
      );
    }

    // Generate rooms
    const roomDefs = this.generateRooms(
      totalRooms,
      template,
      dungeonLevel,
    );

    // Insert dungeon
    const { data: dungeon, error: dungErr } = await supabase
      .from('active_dungeons')
      .insert({
        character_id: character.id,
        poi_id: poiId,
        dungeon_level: dungeonLevel,
        current_room: 0,
        total_rooms: totalRooms,
      })
      .select('id')
      .single();

    if (dungErr || !dungeon) {
      this.logger.error(`Failed to create dungeon: ${dungErr?.message}`);
      throw new ConflictException('Failed to create dungeon.');
    }

    // Insert rooms
    const roomRows = roomDefs.map((r, i) => ({
      dungeon_id: dungeon.id,
      room_index: i,
      room_type: r.type,
      room_data: r.data,
    }));

    const { error: roomErr } = await supabase
      .from('dungeon_rooms')
      .insert(roomRows);

    if (roomErr) {
      this.logger.error(`Failed to create dungeon rooms: ${roomErr.message}`);
      // Clean up dungeon row
      await supabase.from('active_dungeons').delete().eq('id', dungeon.id);
      throw new ConflictException('Failed to create dungeon rooms.');
    }

    // Set character in dungeon
    await supabase
      .from('characters')
      .update({ in_dungeon: true })
      .eq('id', character.id);

    this.logger.log(
      `Character ${character.id} entered dungeon at ${poi.name} (level ${dungeonLevel}, ${totalRooms} rooms)`,
    );

    return this.getDungeonStatus(userId);
  }

  /* ═══════════════════════════════════════════════
     ADVANCE ROOM
     ═══════════════════════════════════════════════ */

  async advanceRoom(userId: string) {
    const character = await this.getCharacter(userId);
    const supabase = this.supabaseService.getClient();

    if (!character.in_dungeon) {
      throw new ConflictException('You are not in a dungeon.');
    }

    if (character.in_combat) {
      throw new ConflictException(
        'You are in combat! Defeat the monster before advancing.',
      );
    }

    const { data: dungeon } = await supabase
      .from('active_dungeons')
      .select('*')
      .eq('character_id', character.id)
      .single();

    if (!dungeon) {
      throw new NotFoundException('No active dungeon found.');
    }

    if (dungeon.completed) {
      throw new ConflictException(
        'This dungeon is already completed. Leave to return to the map.',
      );
    }

    // Get all rooms
    const { data: rooms } = await supabase
      .from('dungeon_rooms')
      .select('*')
      .eq('dungeon_id', dungeon.id)
      .order('room_index', { ascending: true });

    if (!rooms || rooms.length === 0) {
      throw new NotFoundException('Dungeon has no rooms.');
    }

    // Current room must be cleared (unless this is the first advance, room 0)
    const currentRoom = rooms.find(
      (r: any) => r.room_index === dungeon.current_room,
    );
    if (currentRoom && !currentRoom.cleared) {
      // First room hasn't been entered yet — resolve it
      return this.resolveRoom(character, dungeon, currentRoom);
    }

    // Move to next room
    const nextIndex = dungeon.current_room + 1;
    if (nextIndex >= dungeon.total_rooms) {
      throw new ConflictException(
        'All rooms cleared. The dungeon is complete!',
      );
    }

    // Update current_room
    await supabase
      .from('active_dungeons')
      .update({ current_room: nextIndex })
      .eq('id', dungeon.id);

    const nextRoom = rooms.find((r: any) => r.room_index === nextIndex);
    if (!nextRoom) {
      throw new NotFoundException(`Room ${nextIndex} not found.`);
    }

    return this.resolveRoom(character, dungeon, nextRoom);
  }

  /* ═══════════════════════════════════════════════
     RESOLVE ROOM
     ═══════════════════════════════════════════════ */

  private async resolveRoom(character: any, dungeon: any, room: any) {
    const supabase = this.supabaseService.getClient();
    const roomData = room.room_data ?? {};
    const log: string[] = [];

    if (room.room_type === 'combat' || room.room_type === 'boss') {
      return this.resolveCombatRoom(character, dungeon, room, roomData);
    }

    if (room.room_type === 'trap') {
      return this.resolveTrapRoom(character, dungeon, room, roomData, log);
    }

    if (room.room_type === 'treasure') {
      return this.resolveTreasureRoom(
        character,
        dungeon,
        room,
        roomData,
        log,
      );
    }

    if (room.room_type === 'rest') {
      return this.resolveRestRoom(character, dungeon, room, log);
    }

    throw new BadRequestException(`Unknown room type: ${room.room_type}`);
  }

  /* ─── Combat Room ─── */

  private async resolveCombatRoom(
    character: any,
    dungeon: any,
    room: any,
    roomData: any,
  ) {
    const monsterId: string = roomData.monsterId;
    if (!monsterId) {
      throw new BadRequestException('Combat room has no monster assigned.');
    }

    const combatResult = await this.combatService.startDungeonCombat(
      character.id,
      monsterId,
      dungeon.dungeon_level,
    );

    return {
      roomIndex: room.room_index,
      roomType: room.room_type,
      status: 'combat_started',
      message:
        room.room_type === 'boss'
          ? `The final chamber! A powerful ${combatResult.monsterName} awaits!`
          : `A ${combatResult.monsterName} lurks in the shadows!`,
      monster: {
        name: combatResult.monsterName,
        level: combatResult.monsterLevel,
        hp: combatResult.monsterHp,
        maxHp: combatResult.monsterMaxHp,
        type: combatResult.monsterType,
      },
    };
  }

  /* ─── Trap Room ─── */

  private async resolveTrapRoom(
    character: any,
    dungeon: any,
    room: any,
    roomData: any,
    log: string[],
  ) {
    const supabase = this.supabaseService.getClient();
    const trapType: string = roomData.trapType ?? 'pit';
    const description =
      TRAP_DESCRIPTIONS[trapType] ?? 'You triggered a trap!';

    // Refresh character for current stats
    const equippedItems = await this.inventoryService.getEquippedItems(
      character.id,
    );
    const effective = this.inventoryService.computeEffectiveStats(
      character,
      equippedItems,
    );
    const dexMod = abilityModifier(effective.dexterity);

    // Roll avoidance
    let avoidChance = TRAP_AVOID_BASE + dexMod * TRAP_DEX_BONUS;
    avoidChance = Math.max(TRAP_MIN_AVOID, Math.min(TRAP_MAX_AVOID, avoidChance));

    const avoided = Math.random() < avoidChance;

    if (avoided) {
      log.push(description);
      log.push('You nimbly dodge the trap!');
    } else {
      const damage = Math.max(
        1,
        Math.floor(character.max_hp * TRAP_DAMAGE_FRACTION),
      );
      const newHp = Math.max(1, character.hp - damage); // can't die to traps

      log.push(description);
      log.push(`The trap deals ${damage} damage! (HP: ${newHp}/${character.max_hp})`);

      await supabase
        .from('characters')
        .update({ hp: newHp })
        .eq('id', character.id);
    }

    // Mark room cleared
    await supabase
      .from('dungeon_rooms')
      .update({ cleared: true, result_log: log })
      .eq('id', room.id);

    return {
      roomIndex: room.room_index,
      roomType: 'trap',
      status: 'cleared',
      trapType,
      avoided,
      log,
    };
  }

  /* ─── Treasure Room ─── */

  private async resolveTreasureRoom(
    character: any,
    dungeon: any,
    room: any,
    roomData: any,
    log: string[],
  ) {
    const supabase = this.supabaseService.getClient();

    // Gold reward
    const baseGold =
      randomInt(TREASURE_GOLD_MIN, TREASURE_GOLD_MAX) +
      dungeon.dungeon_level * TREASURE_GOLD_LEVEL_SCALE;
    log.push(`You find a treasure chest containing ${baseGold} gold!`);

    // Roll loot items from a pool of all items in the database
    const lootNames: string[] = [];
    const { data: lootItems } = await supabase
      .from('items')
      .select('id, name, level_required, rarity')
      .lte('level_required', dungeon.dungeon_level + 2)
      .not('type', 'eq', 'quest')
      .not('type', 'eq', 'material');

    if (lootItems && lootItems.length > 0) {
      const alreadyDropped = new Set<string>();
      for (let r = 0; r < TREASURE_ROOM_ROLLS; r++) {
        // Weight by rarity
        const weighted = lootItems.map((item: any) => {
          let weight = 10;
          if (item.rarity === 'uncommon') weight = 7;
          else if (item.rarity === 'rare') weight = 4;
          else if (item.rarity === 'epic') weight = 2;
          else if (item.rarity === 'legendary') weight = 1;
          return { ...item, weight };
        });

        const totalWeight = weighted.reduce(
          (sum: number, i: any) => sum + i.weight,
          0,
        );
        const roll = Math.random() * totalWeight;
        let cumulative = 0;
        for (const entry of weighted) {
          cumulative += entry.weight;
          if (roll <= cumulative) {
            if (!alreadyDropped.has(entry.id)) {
              await this.inventoryService.addToBackpack(
                character.id,
                entry.id,
                1,
              );
              lootNames.push(entry.name);
              alreadyDropped.add(entry.id);
            }
            break;
          }
        }
      }
    }

    if (lootNames.length > 0) {
      log.push(`Loot: ${lootNames.join(', ')}`);
    }

    // Grant gold
    await supabase
      .from('characters')
      .update({ gold: character.gold + baseGold })
      .eq('id', character.id);

    // Mark room cleared
    await supabase
      .from('dungeon_rooms')
      .update({ cleared: true, result_log: log })
      .eq('id', room.id);

    return {
      roomIndex: room.room_index,
      roomType: 'treasure',
      status: 'cleared',
      goldFound: baseGold,
      loot: lootNames,
      log,
    };
  }

  /* ─── Rest Room ─── */

  private async resolveRestRoom(
    character: any,
    dungeon: any,
    room: any,
    log: string[],
  ) {
    const supabase = this.supabaseService.getClient();

    const hpHealed = Math.floor(
      character.max_hp * DUNGEON_REST_HP_FRACTION,
    );
    const manaRestored = Math.floor(
      character.max_mana * DUNGEON_REST_MANA_FRACTION,
    );

    const newHp = Math.min(character.max_hp, character.hp + hpHealed);
    const newMana = Math.min(
      character.max_mana,
      character.mana + manaRestored,
    );

    log.push('You find a safe chamber with a flickering campfire.');
    log.push(
      `You rest and recover ${newHp - character.hp} HP and ${newMana - character.mana} mana.`,
    );

    await supabase
      .from('characters')
      .update({ hp: newHp, mana: newMana })
      .eq('id', character.id);

    // Mark room cleared
    await supabase
      .from('dungeon_rooms')
      .update({ cleared: true, result_log: log })
      .eq('id', room.id);

    return {
      roomIndex: room.room_index,
      roomType: 'rest',
      status: 'cleared',
      hpRestored: newHp - character.hp,
      manaRestored: newMana - character.mana,
      log,
    };
  }

  /* ═══════════════════════════════════════════════
     LEAVE DUNGEON
     ═══════════════════════════════════════════════ */

  async leaveDungeon(userId: string) {
    const character = await this.getCharacter(userId);
    const supabase = this.supabaseService.getClient();

    if (!character.in_dungeon) {
      throw new ConflictException('You are not in a dungeon.');
    }

    if (character.in_combat) {
      throw new ConflictException(
        'You cannot leave while in combat! Defeat the monster or flee first.',
      );
    }

    const { data: dungeon } = await supabase
      .from('active_dungeons')
      .select('poi_id, completed, current_room, total_rooms')
      .eq('character_id', character.id)
      .single();

    await supabase
      .from('characters')
      .update({ in_dungeon: false })
      .eq('id', character.id);

    const roomsCleared = dungeon?.current_room ?? 0;
    const totalRooms = dungeon?.total_rooms ?? 0;

    return {
      message: dungeon?.completed
        ? 'You leave the completed dungeon triumphantly.'
        : `You retreat from the dungeon. Progress saved (${roomsCleared}/${totalRooms} rooms).`,
      progressSaved: !dungeon?.completed,
    };
  }

  /* ═══════════════════════════════════════════════
     DUNGEON COMBAT CALLBACKS (called by CombatService)
     ═══════════════════════════════════════════════ */

  /**
   * Called by CombatService when a dungeon combat is won.
   * Marks the current room as cleared and checks for dungeon completion.
   */
  async onDungeonCombatVictory(characterId: string): Promise<{
    dungeonCompleted: boolean;
    completionBonus: { xp: number; gold: number } | null;
  }> {
    const supabase = this.supabaseService.getClient();

    const { data: dungeon } = await supabase
      .from('active_dungeons')
      .select('*')
      .eq('character_id', characterId)
      .single();

    if (!dungeon) {
      return { dungeonCompleted: false, completionBonus: null };
    }

    // Mark current room as cleared
    await supabase
      .from('dungeon_rooms')
      .update({
        cleared: true,
        result_log: ['Monster defeated!'],
      })
      .eq('dungeon_id', dungeon.id)
      .eq('room_index', dungeon.current_room);

    // Check if this was the boss room (last room)
    const isBossRoom = dungeon.current_room === dungeon.total_rooms - 1;

    if (isBossRoom) {
      return this.completeDungeon(characterId, dungeon);
    }

    return { dungeonCompleted: false, completionBonus: null };
  }

  /**
   * Called by CombatService when a dungeon combat results in defeat.
   * Sets in_dungeon = false but keeps dungeon progress.
   */
  async onDungeonCombatDefeat(characterId: string): Promise<void> {
    const supabase = this.supabaseService.getClient();

    await supabase
      .from('characters')
      .update({ in_dungeon: false })
      .eq('id', characterId);
  }

  /* ═══════════════════════════════════════════════
     DUNGEON COMPLETION
     ═══════════════════════════════════════════════ */

  private async completeDungeon(
    characterId: string,
    dungeon: any,
  ): Promise<{
    dungeonCompleted: boolean;
    completionBonus: { xp: number; gold: number };
  }> {
    const supabase = this.supabaseService.getClient();

    // Mark dungeon as completed
    await supabase
      .from('active_dungeons')
      .update({
        completed: true,
        completed_at: new Date().toISOString(),
      })
      .eq('id', dungeon.id);

    // Set character out of dungeon
    await supabase
      .from('characters')
      .update({ in_dungeon: false })
      .eq('id', characterId);

    // Grant completion bonus
    const bonusXp =
      COMPLETION_XP_BASE + dungeon.dungeon_level * COMPLETION_XP_PER_LEVEL;
    const bonusGold =
      COMPLETION_GOLD_BASE + dungeon.dungeon_level * COMPLETION_GOLD_PER_LEVEL;

    await this.levelingService.grantXp(characterId, bonusXp);

    const { data: char } = await supabase
      .from('characters')
      .select('gold')
      .eq('id', characterId)
      .single();

    await supabase
      .from('characters')
      .update({ gold: (char?.gold ?? 0) + bonusGold })
      .eq('id', characterId);

    this.logger.log(
      `Dungeon completed! Character ${characterId} earned ${bonusXp} XP and ${bonusGold} gold bonus.`,
    );

    return {
      dungeonCompleted: true,
      completionBonus: { xp: bonusXp, gold: bonusGold },
    };
  }

  /* ═══════════════════════════════════════════════
     ROOM GENERATION
     ═══════════════════════════════════════════════ */

  private generateRooms(
    totalRooms: number,
    template: DungeonTemplate,
    level: number,
  ): { type: string; data: Record<string, any> }[] {
    const rooms: { type: string; data: Record<string, any> }[] = [];

    // Generate non-boss rooms (totalRooms - 1)
    const nonBossCount = totalRooms - 1;

    // Weighted random room type selection
    const types = Object.keys(ROOM_WEIGHTS);
    const weights = types.map((t) => ROOM_WEIGHTS[t]);
    const totalWeight = weights.reduce((sum, w) => sum + w, 0);

    for (let i = 0; i < nonBossCount; i++) {
      const roll = Math.random() * totalWeight;
      let cumulative = 0;
      let selectedType = 'combat';

      for (let j = 0; j < types.length; j++) {
        cumulative += weights[j];
        if (roll <= cumulative) {
          selectedType = types[j];
          break;
        }
      }

      rooms.push(this.buildRoomData(selectedType, template, level));
    }

    // Ensure at least 1 rest room if total rooms >= 5
    if (totalRooms >= 5) {
      const hasRest = rooms.some((r) => r.type === 'rest');
      if (!hasRest) {
        // Replace a random non-first room with a rest room
        const replaceIdx = randomInt(1, rooms.length - 1);
        rooms[replaceIdx] = this.buildRoomData('rest', template, level);
      }
    }

    // Boss room is always last
    rooms.push(this.buildBossRoom(template, level));

    return rooms;
  }

  private buildRoomData(
    type: string,
    template: DungeonTemplate,
    level: number,
  ): { type: string; data: Record<string, any> } {
    switch (type) {
      case 'combat': {
        const monsterId = this.pickDungeonMonster(template, level);
        return { type: 'combat', data: { monsterId } };
      }
      case 'trap': {
        const trapTypes = template.trapTypes;
        const trapType =
          trapTypes[Math.floor(Math.random() * trapTypes.length)];
        return { type: 'trap', data: { trapType } };
      }
      case 'treasure': {
        return { type: 'treasure', data: {} };
      }
      case 'rest': {
        return { type: 'rest', data: {} };
      }
      default:
        return { type: 'combat', data: { monsterId: this.pickDungeonMonster(template, level) } };
    }
  }

  private buildBossRoom(
    template: DungeonTemplate,
    level: number,
  ): { type: string; data: Record<string, any> } {
    const bossPool = template.bossPool;
    const bossId =
      bossPool[Math.floor(Math.random() * bossPool.length)];
    return { type: 'boss', data: { monsterId: bossId } };
  }

  private pickDungeonMonster(
    template: DungeonTemplate,
    level: number,
  ): string {
    // Delegate to combat service's monster selection by type preference
    // Pick a random monster that matches the template's preferred types
    const allMonsters = this.combatService.getMonstersByTypes(
      template.monsterTypes,
      'elite', // allow up to elite in dungeon rooms
    );

    if (allMonsters.length === 0) {
      // Fallback to any non-boss monster
      const fallback = this.combatService.getMonstersByTypes([], 'elite');
      if (fallback.length === 0) return 'wolf'; // absolute fallback
      return fallback[Math.floor(Math.random() * fallback.length)].id;
    }

    return allMonsters[Math.floor(Math.random() * allMonsters.length)].id;
  }

  /* ═══════════════════════════════════════════════
     HELPERS
     ═══════════════════════════════════════════════ */

  private getDungeonLevel(poi: any): number {
    if (poi.level_min != null && poi.level_max != null) {
      return randomInt(poi.level_min, poi.level_max);
    }
    // Fall back to area level bands
    const distance = Math.sqrt(
      (poi.x - MAP_CENTER_X) ** 2 + (poi.y - MAP_CENTER_Y) ** 2,
    );
    for (const band of AREA_LEVEL_BANDS) {
      if (distance <= band.maxDistance) {
        return randomInt(band.minLevel, band.maxLevel);
      }
    }
    return randomInt(7, 10);
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
