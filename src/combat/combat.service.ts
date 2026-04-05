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
import { InventoryService } from '../inventory/inventory.service';
import { MapService } from '../map/map.service';
import { LevelingService } from '../leveling/leveling.service';
import { abilityModifier } from '../common/constants/game.constants';
import { XP_THRESHOLDS } from '../common/constants/leveling.constants';
import {
  ENCOUNTER_RATES,
  GUARANTEED_COMBAT_POIS,
  HP_SCALE_FACTOR,
  DMG_SCALE_FACTOR,
  AC_SCALE_DIVISOR,
  GOLD_SCALE_FACTOR,
  GOLD_VARIANCE,
  MAP_CENTER_X,
  MAP_CENTER_Y,
  AREA_LEVEL_BANDS,
  CRIT_ROLL,
  FUMBLE_ROLL,
  CRIT_DAMAGE_MULTIPLIER,
  UNARMED_DAMAGE_MIN,
  UNARMED_DAMAGE_MAX,
  FLEE_BASE_CHANCE,
  FLEE_DEX_BONUS,
  FLEE_MAX_CHANCE,
  FLEE_MIN_CHANCE,
  LOOT_ROLLS,
  DEATH_GOLD_PENALTY,
  DEATH_XP_PENALTY,
  RESPAWN_HP_FRACTION,
  RESPAWN_MANA_FRACTION,
} from '../common/constants/combat.constants';
import {
  StatusEffect,
  StatusEffectType,
  STATUS_EFFECT_DEFAULTS,
  DOT_EFFECTS,
  INCAPACITATING_EFFECTS,
  BUFF_EFFECTS,
  DOT_FLAVOR,
  EFFECT_APPLY_FLAVOR,
} from '../common/constants/status-effects.constants';
import { CombatAction } from './dto/combat-action.dto';
import type { DungeonService } from '../dungeons/dungeon.service';
import monstersData = require('../data/monsters.json');

/* ─── Types ─── */

interface MonsterAbility {
  name: string;
  damageMultiplier: number;
  damageType: string;
  chance: number;
  minLevel: number;
  description: string;
  statusEffect?: {
    type: string;
    duration?: number;
    value?: number;
    chance?: number;   // probability to apply (0-1), default 1.0
    target?: 'self' | 'opponent'; // default: 'opponent'
  };
}

interface LootEntry {
  itemId: string;
  weight: number;
  minQuantity: number;
  maxQuantity: number;
  minLevel: number;
}

interface MonsterDef {
  id: string;
  name: string;
  type: string;
  tier: string;
  baseHp: number;
  baseDamageMin: number;
  baseDamageMax: number;
  baseAc: number;
  baseXp: number;
  baseGold: number;
  damageType: string;
  abilities: MonsterAbility[];
  lootTable: LootEntry[];
  preferredTerrains: string[];
  description: string;
}

interface ScaledMonster {
  id: string;
  name: string;
  type: string;
  tier: string;
  level: number;
  hp: number;
  maxHp: number;
  damageMin: number;
  damageMax: number;
  ac: number;
  damageType: string;
  xpReward: number;
  goldReward: number;
  abilities: MonsterAbility[];
  lootTable: LootEntry[];
  description: string;
}

export interface CombatStartResult {
  monsterId: string;
  monsterName: string;
  monsterLevel: number;
  monsterHp: number;
  monsterMaxHp: number;
  monsterType: string;
  source: string;
}

/* ─── Utility ─── */

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function d20(): number {
  return randomInt(1, 20);
}

@Injectable()
export class CombatService implements OnModuleInit {
  private readonly logger = new Logger(CombatService.name);
  private monstersById = new Map<string, MonsterDef>();
  private monstersList: MonsterDef[] = [];

  private dungeonService: DungeonService | null = null;
  private questService: any = null;

  constructor(
    private supabaseService: SupabaseService,
    private inventoryService: InventoryService,
    private mapService: MapService,
    private levelingService: LevelingService,
  ) {}

  /** Called by DungeonModule to set the dungeon service (avoids circular dep) */
  setDungeonService(ds: DungeonService) {
    this.dungeonService = ds;
  }

  /** Called by QuestModule to set the quest service (avoids circular dep) */
  setQuestService(qs: any) {
    this.questService = qs;
  }

  onModuleInit() {
    for (const m of monstersData as MonsterDef[]) {
      this.monstersById.set(m.id, m);
      this.monstersList.push(m);
    }
    this.logger.log(`Loaded ${this.monstersList.length} monster definitions`);
  }

  /* ═══════════════════════════════════════════════
     GET STATUS
     ═══════════════════════════════════════════════ */

  async getCombatStatus(userId: string) {
    const supabase = this.supabaseService.getClient();
    const character = await this.getCharacter(userId);

    const { data: combat } = await supabase
      .from('active_combats')
      .select('*')
      .eq('character_id', character.id)
      .maybeSingle();

    if (!combat) return null;

    const equippedItems = await this.inventoryService.getEquippedItems(character.id);
    const effective = this.inventoryService.computeEffectiveStats(character, equippedItems);

    return {
      inCombat: true,
      turn: combat.turn_count,
      source: combat.source,
      monster: {
        id: combat.monster_id,
        name: combat.monster_name,
        level: combat.monster_level,
        hp: combat.monster_hp,
        maxHp: combat.monster_max_hp,
        ac: combat.monster_ac,
        type: combat.monster_type,
        effects: (combat.monster_effects ?? []).map((e: StatusEffect) => ({
          type: e.type, duration: e.duration, value: e.value,
        })),
      },
      player: {
        hp: character.hp,
        maxHp: effective.maxHp,
        mana: character.mana,
        maxMana: character.max_mana,
        ac: effective.ac,
        effects: (combat.player_effects ?? []).map((e: StatusEffect) => ({
          type: e.type, duration: e.duration, value: e.value,
        })),
      },
      log: combat.combat_log,
    };
  }

  /* ═══════════════════════════════════════════════
     PERFORM ACTION
     ═══════════════════════════════════════════════ */

  async performAction(
    userId: string,
    action: CombatAction,
    spellId?: string,
    itemId?: string,
  ) {
    const supabase = this.supabaseService.getClient();
    const character = await this.getCharacter(userId);

    const { data: combat, error: combatErr } = await supabase
      .from('active_combats')
      .select('*')
      .eq('character_id', character.id)
      .single();

    if (combatErr || !combat) {
      throw new NotFoundException('You are not in combat.');
    }

    const equippedItems = await this.inventoryService.getEquippedItems(character.id);
    const effective = this.inventoryService.computeEffectiveStats(character, equippedItems);

    // Find equipped weapon
    const weaponRow = equippedItems.find((r: any) => r.slot === 'weapon');
    const weapon: any = weaponRow?.item ?? null;

    const log: string[] = [];
    let monsterHp = combat.monster_hp;
    let playerHp = character.hp;
    let playerMana = character.mana;
    let playerEffects: StatusEffect[] = [...(combat.player_effects ?? [])];
    let monsterEffects: StatusEffect[] = [...(combat.monster_effects ?? [])];

    // ─── Start-of-Turn: Process Status Effects ───
    const playerTick = this.processEffects(
      playerEffects, 'You', playerHp, effective.maxHp, log,
    );
    playerHp = playerTick.hp;
    playerEffects = playerTick.effects;

    const monsterTick = this.processEffects(
      monsterEffects, `The ${combat.monster_name}`, monsterHp, combat.monster_max_hp, log,
    );
    monsterHp = monsterTick.hp;
    monsterEffects = monsterTick.effects;

    // Check DoT kills
    if (playerHp <= 0) {
      playerHp = 0;
      log.push(`You have been defeated by the ${combat.monster_name}!`);
      const defeatResult = await this.resolveDefeat(character, combat, log);
      return { outcome: 'defeat', turn: combat.turn_count + 1, log, ...defeatResult };
    }
    if (monsterHp <= 0) {
      monsterHp = 0;
      log.push(`The ${combat.monster_name} has been defeated!`);
      const victoryResult = await this.resolveVictory(character, combat, playerHp, playerMana, log);
      return { outcome: 'victory', turn: combat.turn_count + 1, log, ...victoryResult };
    }

    // ─── Player Turn ───
    let playerActed = true;
    if (playerTick.isIncapacitated) {
      // Player is stunned/frozen — skip their action
      playerActed = false;
    } else if (playerTick.isSilenced && action === CombatAction.CAST) {
      log.push('You are silenced and cannot cast spells this turn!');
      playerActed = false;
    } else {
      switch (action) {
        case CombatAction.ATTACK: {
          // Blind check
          const blindMiss = this.getBlindMissChance(playerEffects);
          if (blindMiss > 0 && Math.random() < blindMiss) {
            log.push(`Your vision is impaired — your attack goes wide! (blinded)`);
            break;
          }

          const roll = d20();
          const curseMod = this.getCurseModifier(playerEffects);
          const strMod = abilityModifier(effective.strength) + curseMod;
          const attackTotal = roll + strMod;

          if (roll === FUMBLE_ROLL) {
            log.push(`You swing and miss completely! (rolled ${roll})`);
          } else if (roll === CRIT_ROLL || attackTotal >= combat.monster_ac) {
            const dmgMin = weapon ? weapon.damage_min : UNARMED_DAMAGE_MIN;
            const dmgMax = weapon ? weapon.damage_max : UNARMED_DAMAGE_MAX;
            let damage = randomInt(dmgMin, dmgMax) + Math.max(0, strMod);
            if (damage < 1) damage = 1;
            if (roll === CRIT_ROLL) damage *= CRIT_DAMAGE_MULTIPLIER;
            damage = this.applyDamageModifiers(damage, playerEffects, monsterEffects, monsterTick.vulnerabilityMultiplier);
            monsterHp -= damage;

            const critText = roll === CRIT_ROLL ? 'CRITICAL HIT! ' : '';
            log.push(
              `${critText}You strike the ${combat.monster_name} for ${damage} damage.${roll !== CRIT_ROLL ? ` (rolled ${roll} + ${strMod} = ${attackTotal} vs AC ${combat.monster_ac})` : ` (rolled ${roll})`}`,
            );

            // Weapon proc check
            if (weapon?.status_effect && weapon?.status_chance) {
              if (Math.random() < weapon.status_chance) {
                const se = weapon.status_effect;
                monsterEffects = this.applyEffect(
                  monsterEffects,
                  se.type as StatusEffectType,
                  weapon.name,
                  log,
                  `The ${combat.monster_name}`,
                  se.duration,
                  se.value,
                );
              }
            }
          } else {
            log.push(
              `Your attack misses the ${combat.monster_name}. (rolled ${roll} + ${strMod} = ${attackTotal} vs AC ${combat.monster_ac})`,
            );
          }
          break;
        }

        case CombatAction.CAST: {
          if (!spellId) {
            throw new BadRequestException('spellId is required for cast action.');
          }
          const spellResult = await this.resolveCast(
            character, effective, spellId, combat,
            monsterHp, playerHp, playerMana,
            log, playerEffects, monsterEffects,
            monsterTick.vulnerabilityMultiplier,
          );
          monsterHp = spellResult.monsterHp;
          playerHp = spellResult.playerHp;
          playerMana = spellResult.playerMana;
          playerEffects = spellResult.playerEffects;
          monsterEffects = spellResult.monsterEffects;
          break;
        }

        case CombatAction.USE_ITEM: {
          if (!itemId) {
            throw new BadRequestException('itemId is required for use_item action.');
          }
          const itemResult = await this.resolveUseItem(
            character.id, itemId, playerHp, effective.maxHp,
            playerMana, character.max_mana, log,
          );
          playerHp = itemResult.playerHp;
          playerMana = itemResult.playerMana;
          break;
        }

        case CombatAction.FLEE: {
          if (combat.monster_type === 'boss' || combat.monster_type === 'dragon' || combat.monster_type === 'demon') {
            const monsterDef = this.monstersById.get(combat.monster_id);
            if (monsterDef?.tier === 'boss') {
              throw new BadRequestException('You cannot flee from a boss!');
            }
          }

          const dexMod = abilityModifier(effective.dexterity);
          const fleeChance = Math.max(
            FLEE_MIN_CHANCE,
            Math.min(FLEE_MAX_CHANCE, FLEE_BASE_CHANCE + dexMod * FLEE_DEX_BONUS),
          );

          if (Math.random() < fleeChance) {
            log.push(`You successfully flee from the ${combat.monster_name}!`);
            await supabase.from('active_combats').delete().eq('id', combat.id);
            await supabase
              .from('characters')
              .update({ hp: playerHp, mana: playerMana, in_combat: false })
              .eq('id', character.id);
            return { outcome: 'fled', log, player: { hp: playerHp, mana: playerMana } };
          } else {
            log.push(`You fail to escape from the ${combat.monster_name}!`);
          }
          break;
        }
      }
    }

    // ─── Check Monster Death ───
    if (monsterHp <= 0) {
      monsterHp = 0;
      log.push(`The ${combat.monster_name} has been defeated!`);
      const victoryResult = await this.resolveVictory(character, combat, playerHp, playerMana, log);
      return { outcome: 'victory', turn: combat.turn_count + 1, log, ...victoryResult };
    }

    // ─── Monster Turn ───
    if (monsterTick.isIncapacitated) {
      // Monster is stunned/frozen — skip its turn (already logged above)
    } else {
      const monsterResult = this.resolveMonsterTurn(
        combat, effective, playerHp, monsterHp, log,
        playerEffects, monsterEffects, playerTick.vulnerabilityMultiplier,
      );
      playerHp = monsterResult.playerHp;
      playerEffects = monsterResult.playerEffects;
      monsterEffects = monsterResult.monsterEffects;
      monsterHp = monsterResult.monsterHp;
    }

    // ─── Check Player Death ───
    if (playerHp <= 0) {
      playerHp = 0;
      log.push(`You have been defeated by the ${combat.monster_name}!`);
      const defeatResult = await this.resolveDefeat(character, combat, log);
      return { outcome: 'defeat', turn: combat.turn_count + 1, log, ...defeatResult };
    }

    // ─── Update State ───
    const updatedLog = [...(combat.combat_log as string[]), ...log];
    await supabase
      .from('active_combats')
      .update({
        monster_hp: monsterHp,
        turn_count: combat.turn_count + 1,
        combat_log: updatedLog,
        player_effects: playerEffects,
        monster_effects: monsterEffects,
      })
      .eq('id', combat.id);

    await supabase
      .from('characters')
      .update({ hp: playerHp, mana: playerMana })
      .eq('id', character.id);

    return {
      outcome: 'ongoing',
      turn: combat.turn_count + 1,
      log,
      monster: {
        name: combat.monster_name,
        hp: monsterHp,
        maxHp: combat.monster_max_hp,
        effects: monsterEffects.map((e) => ({ type: e.type, duration: e.duration, value: e.value })),
      },
      player: {
        hp: playerHp,
        maxHp: effective.maxHp,
        mana: playerMana,
        maxMana: character.max_mana,
        effects: playerEffects.map((e) => ({ type: e.type, duration: e.duration, value: e.value })),
      },
    };
  }

  /* ═══════════════════════════════════════════════
     SPELL RESOLUTION
     ═══════════════════════════════════════════════ */

  private async resolveCast(
    character: any,
    effective: any,
    spellId: string,
    combat: any,
    monsterHp: number,
    playerHp: number,
    playerMana: number,
    log: string[],
    playerEffects: StatusEffect[],
    monsterEffects: StatusEffect[],
    monsterVulnerability: number,
  ) {
    const supabase = this.supabaseService.getClient();

    // Check spell is learned
    const { data: known } = await supabase
      .from('character_spells')
      .select('spell_id')
      .eq('character_id', character.id)
      .eq('spell_id', spellId)
      .maybeSingle();

    if (!known) {
      throw new BadRequestException(`You haven't learned that spell.`);
    }

    // Get spell definition
    const { data: spell } = await supabase
      .from('spells')
      .select('*')
      .eq('id', spellId)
      .single();

    if (!spell) {
      throw new NotFoundException(`Spell '${spellId}' does not exist.`);
    }

    if (playerMana < spell.mana_cost) {
      throw new BadRequestException(
        `Not enough mana. Need ${spell.mana_cost}, have ${playerMana}.`,
      );
    }

    playerMana -= spell.mana_cost;

    // Determine casting modifier (INT for mage, WIS for cleric, INT otherwise)
    const curseMod = this.getCurseModifier(playerEffects);
    const castMod =
      (character.class_id === 'cleric'
        ? abilityModifier(effective.wisdom)
        : abilityModifier(effective.intelligence)) + curseMod;

    let spellHit = false;

    if (spell.effect_type === 'damage') {
      // Blind check
      const blindMiss = this.getBlindMissChance(playerEffects);
      if (blindMiss > 0 && Math.random() < blindMiss) {
        log.push(`Your ${spell.name} goes astray — you can't see! (blinded, ${spell.mana_cost} mana)`);
      } else {
        const roll = d20();
        const attackTotal = roll + castMod;

        if (roll === FUMBLE_ROLL) {
          log.push(`Your ${spell.name} fizzles! (rolled ${roll})`);
        } else if (roll === CRIT_ROLL || attackTotal >= combat.monster_ac) {
          spellHit = true;
          let damage = (spell.effect_value ?? 0) + Math.max(0, castMod);
          if (damage < 1) damage = 1;
          if (roll === CRIT_ROLL) damage *= CRIT_DAMAGE_MULTIPLIER;
          damage = this.applyDamageModifiers(damage, playerEffects, monsterEffects, monsterVulnerability);
          monsterHp -= damage;

          const critText = roll === CRIT_ROLL ? 'CRITICAL! ' : '';
          log.push(
            `${critText}Your ${spell.name} hits the ${combat.monster_name} for ${damage} ${spell.damage_type ?? ''} damage. (${spell.mana_cost} mana)`,
          );
        } else {
          log.push(
            `Your ${spell.name} misses! (rolled ${roll} + ${castMod} = ${attackTotal} vs AC ${combat.monster_ac}, ${spell.mana_cost} mana)`,
          );
        }
      }
    } else if (spell.effect_type === 'heal_hp') {
      const healAmount = Math.min(spell.effect_value ?? 0, effective.maxHp - playerHp);
      playerHp += healAmount;
      log.push(`You cast ${spell.name}, healing yourself for ${healAmount} HP. (${spell.mana_cost} mana)`);
      spellHit = true; // Self-target always "hits"
    } else if (spell.effect_type === 'restore_mana') {
      const restoreAmount = Math.min(spell.effect_value ?? 0, character.max_mana - playerMana);
      playerMana += restoreAmount;
      log.push(`You cast ${spell.name}, restoring ${restoreAmount} mana. (${spell.mana_cost} mana)`);
      spellHit = true;
    } else if (spell.effect_type === 'teleport_town') {
      throw new BadRequestException('Cannot use teleport spells during combat. Try fleeing instead.');
    } else {
      // Buff/utility spells with no direct effect
      log.push(`You cast ${spell.name}. (${spell.mana_cost} mana)`);
      spellHit = true; // Self-target always "hits"
    }

    // Apply spell's status effect
    const spellSE = spell.status_effect;
    if (spellSE && spellHit) {
      const seType = spellSE.type as string;

      if (seType === 'cleanse') {
        // Remove all negative effects from player
        const before = playerEffects.length;
        playerEffects = playerEffects.filter((e) => BUFF_EFFECTS.has(e.type as StatusEffectType));
        const removed = before - playerEffects.length;
        if (removed > 0) {
          log.push(`${spell.name} purges ${removed} negative effect${removed > 1 ? 's' : ''}!`);
        } else {
          log.push(`${spell.name} finds no negative effects to purge.`);
        }
      } else {
        const seChance = spellSE.chance ?? 1.0;
        if (Math.random() < seChance) {
          const target = spellSE.target ?? (spell.target_type === 'self' ? 'self' : 'opponent');
          if (target === 'self') {
            playerEffects = this.applyEffect(
              playerEffects, seType as StatusEffectType, spell.name,
              log, 'You', spellSE.duration, spellSE.value,
            );
          } else {
            monsterEffects = this.applyEffect(
              monsterEffects, seType as StatusEffectType, spell.name,
              log, `The ${combat.monster_name}`, spellSE.duration, spellSE.value,
            );
          }
        }
      }
    }

    return { monsterHp, playerHp, playerMana, playerEffects, monsterEffects };
  }

  /* ═══════════════════════════════════════════════
     ITEM USE RESOLUTION
     ═══════════════════════════════════════════════ */

  private async resolveUseItem(
    characterId: string,
    itemId: string,
    playerHp: number,
    maxHp: number,
    playerMana: number,
    maxMana: number,
    log: string[],
  ) {
    const supabase = this.supabaseService.getClient();

    // Check the item exists and is consumable
    const { data: item } = await supabase
      .from('items')
      .select('*')
      .eq('id', itemId)
      .single();

    if (!item) {
      throw new NotFoundException(`Item '${itemId}' does not exist.`);
    }
    if (item.type !== 'consumable') {
      throw new BadRequestException('Only consumable items can be used in combat.');
    }

    // Check it's in the backpack
    const removed = await this.inventoryService.removeFromBackpack(characterId, itemId, 1);
    if (removed === 0) {
      throw new BadRequestException(`You don't have any ${item.name} in your backpack.`);
    }

    if (item.effect_type === 'heal_hp') {
      const healAmount = Math.min(item.effect_value ?? 0, maxHp - playerHp);
      playerHp += healAmount;
      log.push(`You use ${item.name}, restoring ${healAmount} HP.`);
    } else if (item.effect_type === 'restore_mana') {
      const restoreAmount = Math.min(item.effect_value ?? 0, maxMana - playerMana);
      playerMana += restoreAmount;
      log.push(`You use ${item.name}, restoring ${restoreAmount} mana.`);
    } else {
      log.push(`You use ${item.name}.`);
    }

    return { playerHp, playerMana };
  }

  /* ═══════════════════════════════════════════════
     MONSTER TURN
     ═══════════════════════════════════════════════ */

  private resolveMonsterTurn(
    combat: any,
    effective: any,
    playerHp: number,
    monsterHp: number,
    log: string[],
    playerEffects: StatusEffect[],
    monsterEffects: StatusEffect[],
    playerVulnerability: number,
  ) {
    const abilities = (combat.monster_abilities as MonsterAbility[]) ?? [];
    const monsterMod = Math.floor(combat.monster_level / 3) + this.getCurseModifier(monsterEffects);

    // Check for ability use
    let usedAbility: MonsterAbility | null = null;
    for (const ability of abilities) {
      if (Math.random() < ability.chance) {
        usedAbility = ability;
        break;
      }
    }

    // Blind check for monster
    const monsterBlindMiss = this.getBlindMissChance(monsterEffects);

    if (usedAbility && usedAbility.damageMultiplier > 0) {
      // Ability attack
      if (monsterBlindMiss > 0 && Math.random() < monsterBlindMiss) {
        log.push(`The ${combat.monster_name} tries ${usedAbility.name} but can't see! (blinded)`);
      } else {
        const roll = d20();
        const attackTotal = roll + monsterMod;

        if (roll === FUMBLE_ROLL) {
          log.push(`The ${combat.monster_name} tries ${usedAbility.name} but misses! (rolled ${roll})`);
        } else if (roll === CRIT_ROLL || attackTotal >= effective.ac) {
          const baseDmg = randomInt(combat.monster_damage_min, combat.monster_damage_max);
          let damage = Math.round(baseDmg * usedAbility.damageMultiplier);
          if (roll === CRIT_ROLL) damage *= CRIT_DAMAGE_MULTIPLIER;
          damage = this.applyDamageModifiers(damage, monsterEffects, playerEffects, playerVulnerability);
          playerHp -= damage;

          const critText = roll === CRIT_ROLL ? 'CRITICAL! ' : '';
          log.push(`${critText}The ${combat.monster_name} uses ${usedAbility.name} for ${damage} ${usedAbility.damageType} damage!`);

          // Apply ability status effect on hit
          if (usedAbility.statusEffect) {
            const se = usedAbility.statusEffect;
            const seChance = se.chance ?? 1.0;
            if (Math.random() < seChance) {
              const target = se.target ?? 'opponent';
              if (target === 'self') {
                monsterEffects = this.applyEffect(
                  monsterEffects, se.type as StatusEffectType, usedAbility.name,
                  log, `The ${combat.monster_name}`, se.duration, se.value,
                );
              } else {
                playerEffects = this.applyEffect(
                  playerEffects, se.type as StatusEffectType, usedAbility.name,
                  log, 'You', se.duration, se.value,
                );
              }
            }
          }
        } else {
          log.push(`The ${combat.monster_name} uses ${usedAbility.name} but misses! (${attackTotal} vs AC ${effective.ac})`);
        }
      }
    } else if (usedAbility && usedAbility.damageMultiplier === 0) {
      // Non-damage ability (self-buff / self-heal)
      log.push(`The ${combat.monster_name} uses ${usedAbility.name}!`);
      // Apply status effect (typically self-targeting like Regen, Enrage)
      if (usedAbility.statusEffect) {
        const se = usedAbility.statusEffect;
        const seChance = se.chance ?? 1.0;
        if (Math.random() < seChance) {
          const target = se.target ?? 'self'; // 0-damage abilities default to self
          if (target === 'self') {
            monsterEffects = this.applyEffect(
              monsterEffects, se.type as StatusEffectType, usedAbility.name,
              log, `The ${combat.monster_name}`, se.duration, se.value,
            );
          } else {
            playerEffects = this.applyEffect(
              playerEffects, se.type as StatusEffectType, usedAbility.name,
              log, 'You', se.duration, se.value,
            );
          }
        }
      }
    } else {
      // Basic attack
      if (monsterBlindMiss > 0 && Math.random() < monsterBlindMiss) {
        log.push(`The ${combat.monster_name} attacks but can't see! (blinded)`);
      } else {
        const roll = d20();
        const attackTotal = roll + monsterMod;

        if (roll === FUMBLE_ROLL) {
          log.push(`The ${combat.monster_name} attacks but misses! (rolled ${roll})`);
        } else if (roll === CRIT_ROLL || attackTotal >= effective.ac) {
          let damage = randomInt(combat.monster_damage_min, combat.monster_damage_max);
          if (roll === CRIT_ROLL) damage *= CRIT_DAMAGE_MULTIPLIER;
          damage = this.applyDamageModifiers(damage, monsterEffects, playerEffects, playerVulnerability);
          playerHp -= damage;

          const critText = roll === CRIT_ROLL ? 'CRITICAL! ' : '';
          if (critText) {
            log.push(`${critText}The ${combat.monster_name} strikes you for ${damage} damage!`);
          } else {
            log.push(`The ${combat.monster_name} attacks you for ${damage} damage. (rolled ${roll} + ${monsterMod} = ${attackTotal} vs AC ${effective.ac})`);
          }
        } else {
          log.push(`The ${combat.monster_name}'s attack misses. (rolled ${roll} + ${monsterMod} = ${attackTotal} vs AC ${effective.ac})`);
        }
      }
    }

    return { playerHp, playerEffects, monsterEffects, monsterHp };
  }

  /* ═══════════════════════════════════════════════
     VICTORY
     ═══════════════════════════════════════════════ */

  private async resolveVictory(
    character: any,
    combat: any,
    playerHp: number,
    playerMana: number,
    log: string[],
  ) {
    const supabase = this.supabaseService.getClient();

    // Grant XP
    const xpResult = await this.levelingService.grantXp(
      character.id,
      combat.monster_xp_reward,
    );

    log.push(`You gain ${combat.monster_xp_reward} XP.`);
    if (xpResult.leveledUp) {
      log.push(
        `LEVEL UP! You are now level ${xpResult.newLevel}! (+${xpResult.hpGained} HP, +${xpResult.manaGained} mana)`,
      );
      for (const spell of xpResult.newSpells) {
        log.push(`You learned a new spell: ${spell.name}!`);
      }
    }

    // Grant gold
    log.push(`You find ${combat.monster_gold_reward} gold.`);

    // Roll loot — number of rolls based on monster tier
    const lootTable = combat.monster_loot_table as LootEntry[];
    const drops: { itemId: string; quantity: number }[] = [];

    if (lootTable.length > 0) {
      const monsterDef = this.monstersById.get(combat.monster_id);
      const tier = monsterDef?.tier ?? 'normal';
      const numRolls = LOOT_ROLLS[tier] ?? 1;
      const totalWeight = lootTable.reduce((sum, l) => sum + l.weight, 0);

      const alreadyDropped = new Set<string>();
      for (let r = 0; r < numRolls; r++) {
        const roll = Math.random() * totalWeight;
        let cumulative = 0;
        for (const entry of lootTable) {
          cumulative += entry.weight;
          if (roll <= cumulative) {
            if (!alreadyDropped.has(entry.itemId)) {
              const qty = randomInt(entry.minQuantity, entry.maxQuantity);
              drops.push({ itemId: entry.itemId, quantity: qty });
              alreadyDropped.add(entry.itemId);
            }
            break;
          }
        }
      }
    }

    // Add loot to backpack
    const lootNames: string[] = [];
    for (const drop of drops) {
      await this.inventoryService.addToBackpack(
        character.id,
        drop.itemId,
        drop.quantity,
      );
      // Get item name
      const { data: itemDef } = await supabase
        .from('items')
        .select('name')
        .eq('id', drop.itemId)
        .single();
      const name = itemDef?.name ?? drop.itemId;
      lootNames.push(drop.quantity > 1 ? `${drop.quantity}x ${name}` : name);
    }

    if (lootNames.length > 0) {
      log.push(`Loot: ${lootNames.join(', ')}`);
    }

    // Update character: gold, clear combat
    const goldUpdate = character.gold + combat.monster_gold_reward;

    // If leveled up, re-read character for updated HP/mana
    if (xpResult.leveledUp) {
      const { data: refreshed } = await supabase
        .from('characters')
        .select('hp, mana, max_hp, max_mana')
        .eq('id', character.id)
        .single();
      if (refreshed) {
        playerHp = refreshed.hp;
        playerMana = refreshed.mana;
      }
    }

    await supabase
      .from('characters')
      .update({
        hp: playerHp,
        mana: playerMana,
        gold: goldUpdate,
        in_combat: false,
      })
      .eq('id', character.id);

    // Delete combat row
    await supabase.from('active_combats').delete().eq('id', combat.id);

    // Dungeon integration: mark room cleared, check completion
    let dungeonResult: any = null;
    if (combat.source === 'dungeon' && this.dungeonService) {
      dungeonResult =
        await this.dungeonService.onDungeonCombatVictory(character.id);

      if (dungeonResult.dungeonCompleted) {
        log.push(
          `Dungeon complete! Bonus: ${dungeonResult.completionBonus.xp} XP, ${dungeonResult.completionBonus.gold} gold.`,
        );
      }
    }

    // Quest integration: track kill progress
    if (this.questService) {
      try {
        await this.questService.onMonsterKill(character.id, combat.monster_id);
      } catch (e) {
        this.logger.warn(`Quest kill tracking failed: ${(e as Error).message}`);
      }
    }

    return {
      xpGained: combat.monster_xp_reward,
      goldGained: combat.monster_gold_reward,
      loot: lootNames,
      levelUp: xpResult.leveledUp
        ? {
            newLevel: xpResult.newLevel,
            hpGained: xpResult.hpGained,
            manaGained: xpResult.manaGained,
            newSpells: xpResult.newSpells,
          }
        : null,
      dungeon: dungeonResult,
      player: {
        hp: playerHp,
        mana: playerMana,
        gold: goldUpdate,
      },
    };
  }

  /* ═══════════════════════════════════════════════
     DEFEAT
     ═══════════════════════════════════════════════ */

  private async resolveDefeat(character: any, combat: any, log: string[]) {
    const supabase = this.supabaseService.getClient();

    // Gold penalty
    const goldLost = Math.floor(character.gold * DEATH_GOLD_PENALTY);
    const newGold = character.gold - goldLost;

    // XP penalty (can't drop below current level threshold)
    const currentLevelXp = XP_THRESHOLDS[character.level] ?? 0;
    const xpIntoLevel = character.xp - currentLevelXp;
    const xpLost = Math.floor(xpIntoLevel * DEATH_XP_PENALTY);
    const newXp = character.xp - xpLost;

    // Find nearest town
    const { data: towns } = await supabase
      .from('pois')
      .select('id, name, x, y')
      .eq('type', 'town');

    let nearestTown = { id: 'thornhaven', name: 'Thornhaven', x: 50, y: 50 };
    let minDist = Infinity;

    for (const town of towns ?? []) {
      const dist = Math.sqrt(
        (town.x - character.pos_x) ** 2 + (town.y - character.pos_y) ** 2,
      );
      if (dist < minDist) {
        minDist = dist;
        nearestTown = town;
      }
    }

    // Respawn
    const respawnHp = Math.max(1, Math.floor(character.max_hp * RESPAWN_HP_FRACTION));
    const respawnMana = Math.floor(character.max_mana * RESPAWN_MANA_FRACTION);

    log.push(
      `You lost ${goldLost} gold and ${xpLost} XP. You awake at ${nearestTown.name}.`,
    );

    // If in dungeon, also clear dungeon state (progress saved for return)
    const isDungeon = combat.source === 'dungeon';

    await supabase
      .from('characters')
      .update({
        hp: respawnHp,
        mana: respawnMana,
        gold: newGold,
        xp: newXp,
        pos_x: nearestTown.x,
        pos_y: nearestTown.y,
        travel_path: null,
        travel_started_at: null,
        travel_eta: null,
        travel_step_times: null,
        in_combat: false,
        in_dungeon: false,
      })
      .eq('id', character.id);

    // Delete combat row
    await supabase.from('active_combats').delete().eq('id', combat.id);

    // Notify dungeon service of defeat (keeps dungeon progress for return)
    if (isDungeon && this.dungeonService) {
      await this.dungeonService.onDungeonCombatDefeat(character.id);
    }

    return {
      goldLost,
      xpLost,
      respawnTown: nearestTown.name,
      dungeonProgress: isDungeon
        ? 'Dungeon progress saved. You can return after respawning.'
        : undefined,
      player: {
        hp: respawnHp,
        mana: respawnMana,
        gold: newGold,
        xp: newXp,
        posX: nearestTown.x,
        posY: nearestTown.y,
      },
    };
  }

  /* ═══════════════════════════════════════════════
     ENCOUNTER TRIGGERS (called by TravelService)
     ═══════════════════════════════════════════════ */

  /**
   * Roll for a random encounter at the given cell.
   * Returns combat start info if an encounter triggers, null otherwise.
   */
  async rollEncounter(
    characterId: string,
    terrain: string,
    x: number,
    y: number,
  ): Promise<CombatStartResult | null> {
    const rate = ENCOUNTER_RATES[terrain] ?? 0;
    if (Math.random() >= rate) return null;

    const { minLevel, maxLevel } = this.getAreaLevel(x, y);
    const level = randomInt(minLevel, maxLevel);

    const monster = this.pickMonster(terrain, 'normal');
    if (!monster) return null;

    return this.startCombat(characterId, monster.id, level, 'random');
  }

  /**
   * Start a guaranteed combat encounter at a POI.
   */
  async startPOICombat(
    characterId: string,
    poiType: string,
    x: number,
    y: number,
  ): Promise<CombatStartResult | null> {
    if (!GUARANTEED_COMBAT_POIS.has(poiType)) return null;

    const terrain = this.mapService.getTerrainAt(x, y) ?? 'plains';
    const { minLevel, maxLevel } = this.getAreaLevel(x, y);
    const level = randomInt(minLevel, maxLevel);

    // Pick thematic monster based on POI type
    let monster: MonsterDef | null = null;
    if (poiType === 'ambush_site') {
      monster = this.pickMonster(terrain, 'normal', ['humanoid', 'beast']);
    } else if (poiType === 'smuggler_den') {
      monster = this.pickMonster(terrain, 'normal', ['humanoid']);
    }

    if (!monster) {
      monster = this.pickMonster(terrain, 'normal');
    }

    if (!monster) return null;

    return this.startCombat(characterId, monster.id, level, 'poi');
  }

  /* ═══════════════════════════════════════════════
     START COMBAT
     ═══════════════════════════════════════════════ */

  async startCombat(
    characterId: string,
    monsterId: string,
    level: number,
    source: string,
  ): Promise<CombatStartResult> {
    const supabase = this.supabaseService.getClient();
    const base = this.monstersById.get(monsterId);
    if (!base) throw new Error(`Monster '${monsterId}' not found`);

    const scaled = this.scaleMonster(base, level);

    const { error } = await supabase.from('active_combats').insert({
      character_id: characterId,
      monster_id: scaled.id,
      monster_name: scaled.name,
      monster_level: scaled.level,
      monster_hp: scaled.hp,
      monster_max_hp: scaled.maxHp,
      monster_ac: scaled.ac,
      monster_damage_min: scaled.damageMin,
      monster_damage_max: scaled.damageMax,
      monster_xp_reward: scaled.xpReward,
      monster_gold_reward: scaled.goldReward,
      monster_loot_table: scaled.lootTable,
      monster_abilities: scaled.abilities,
      monster_type: scaled.type,
      combat_log: [],
      source,
    });

    if (error) {
      this.logger.error(`Failed to start combat: ${error.message}`);
      throw new ConflictException('Failed to initiate combat.');
    }

    await supabase
      .from('characters')
      .update({ in_combat: true })
      .eq('id', characterId);

    return {
      monsterId: scaled.id,
      monsterName: scaled.name,
      monsterLevel: scaled.level,
      monsterHp: scaled.hp,
      monsterMaxHp: scaled.maxHp,
      monsterType: scaled.type,
      source,
    };
  }

  /**
   * Start a combat from within a dungeon room.
   */
  async startDungeonCombat(
    characterId: string,
    monsterId: string,
    level: number,
  ): Promise<CombatStartResult> {
    return this.startCombat(characterId, monsterId, level, 'dungeon');
  }

  /**
   * Get monster definitions filtered by types and max tier.
   * Used by DungeonService for room generation.
   */
  getMonstersByTypes(
    types: string[],
    maxTier: string = 'normal',
  ): MonsterDef[] {
    const tierOrder = ['normal', 'elite', 'boss'];
    const maxTierIdx = tierOrder.indexOf(maxTier);

    let pool = this.monstersList.filter((m) => {
      const tierIdx = tierOrder.indexOf(m.tier);
      return tierIdx >= 0 && tierIdx <= maxTierIdx;
    });

    if (types.length > 0) {
      const typed = pool.filter((m) => types.includes(m.type));
      if (typed.length > 0) pool = typed;
    }

    return pool;
  }

  /* ═══════════════════════════════════════════════
     STATUS EFFECT ENGINE
     ═══════════════════════════════════════════════ */

  /**
   * Process start-of-turn effects for a target.
   * Applies DoTs, Regen, checks for incapacitation/silence.
   * Decrements durations and removes expired effects.
   */
  private processEffects(
    effects: StatusEffect[],
    targetName: string,
    hp: number,
    maxHp: number,
    log: string[],
  ): {
    hp: number;
    effects: StatusEffect[];
    isIncapacitated: boolean;
    isSilenced: boolean;
    vulnerabilityMultiplier: number;
  } {
    let isIncapacitated = false;
    let isSilenced = false;
    let vulnerabilityMultiplier = 1.0;

    for (const eff of effects) {
      const type = eff.type as StatusEffectType;

      // DoT damage
      if (DOT_EFFECTS.has(type)) {
        hp -= eff.value;
        const flavor = DOT_FLAVOR[type] ?? 'takes damage';
        log.push(`${targetName} ${flavor} for ${eff.value} damage! (${type}, ${eff.duration} turns left)`);
      }

      // Regen
      if (type === StatusEffectType.REGEN) {
        const healAmt = Math.min(eff.value, maxHp - hp);
        if (healAmt > 0) {
          hp += healAmt;
          log.push(`${targetName} regenerates ${healAmt} HP. (${eff.duration} turns left)`);
        }
      }

      // Incapacitation
      if (INCAPACITATING_EFFECTS.has(type)) {
        isIncapacitated = true;
        if (type === StatusEffectType.STUN) {
          log.push(`${targetName} is stunned and cannot act!`);
        } else if (type === StatusEffectType.FREEZE) {
          log.push(`${targetName} is frozen solid and cannot act!`);
          vulnerabilityMultiplier = 1 + eff.value / 100;
        }
      }

      // Silence
      if (type === StatusEffectType.SILENCE) {
        isSilenced = true;
      }

      // Freeze vulnerability (even if not incapacitated on this check)
      if (type === StatusEffectType.FREEZE && !isIncapacitated) {
        vulnerabilityMultiplier = 1 + eff.value / 100;
      }
    }

    // Decrement durations and remove expired
    const remaining: StatusEffect[] = [];
    for (const eff of effects) {
      const newDur = eff.duration - 1;
      if (newDur <= 0) {
        const flavor = EFFECT_APPLY_FLAVOR[eff.type as StatusEffectType] ?? eff.type;
        log.push(`${targetName} is no longer ${flavor.replace(/^(is |becomes |gains |begins )/, '')}.`);
      } else {
        remaining.push({ ...eff, duration: newDur });
      }
    }

    return { hp, effects: remaining, isIncapacitated, isSilenced, vulnerabilityMultiplier };
  }

  /**
   * Apply a status effect to a target's effects array.
   * If the same type already exists, refreshes duration (no stacking).
   */
  private applyEffect(
    effects: StatusEffect[],
    type: StatusEffectType,
    source: string,
    log: string[],
    targetName: string,
    durationOverride?: number,
    valueOverride?: number,
  ): StatusEffect[] {
    const defaults = STATUS_EFFECT_DEFAULTS[type];
    const duration = durationOverride ?? defaults.duration;
    const value = valueOverride ?? defaults.value;

    const existing = effects.find((e) => e.type === type);
    if (existing) {
      existing.duration = Math.max(existing.duration, duration);
      existing.value = value;
      existing.source = source;
    } else {
      effects.push({ type, duration, value, source });
    }

    const flavor = EFFECT_APPLY_FLAVOR[type] ?? `is affected by ${type}`;
    log.push(`${targetName} ${flavor}! (${source}, ${duration} turns)`);
    return effects;
  }

  /** Get outgoing damage multiplier: Weakness reduces, Enrage increases */
  private getOutgoingDmgMult(effects: StatusEffect[]): number {
    let mult = 1.0;
    for (const eff of effects) {
      if (eff.type === StatusEffectType.WEAKNESS) mult *= 1 - eff.value / 100;
      if (eff.type === StatusEffectType.ENRAGE) mult *= 1 + eff.value / 100;
    }
    return mult;
  }

  /** Get Shield flat damage absorption */
  private getShieldAbsorb(effects: StatusEffect[]): number {
    for (const eff of effects) {
      if (eff.type === StatusEffectType.SHIELD) return eff.value;
    }
    return 0;
  }

  /** Get Blind miss chance (0-1) */
  private getBlindMissChance(effects: StatusEffect[]): number {
    for (const eff of effects) {
      if (eff.type === StatusEffectType.BLIND) return eff.value / 100;
    }
    return 0;
  }

  /** Get Curse modifier (negative) */
  private getCurseModifier(effects: StatusEffect[]): number {
    for (const eff of effects) {
      if (eff.type === StatusEffectType.CURSE) return -eff.value;
    }
    return 0;
  }

  /** Apply damage modifiers: outgoing mult, vulnerability, shield. Returns final damage. */
  private applyDamageModifiers(
    rawDamage: number,
    attackerEffects: StatusEffect[],
    defenderEffects: StatusEffect[],
    defenderVulnerability: number,
  ): number {
    let dmg = rawDamage;
    dmg = Math.round(dmg * this.getOutgoingDmgMult(attackerEffects));
    dmg = Math.round(dmg * defenderVulnerability);
    dmg -= this.getShieldAbsorb(defenderEffects);
    return Math.max(1, dmg);
  }

  /* ═══════════════════════════════════════════════
     SCALING & SELECTION
     ═══════════════════════════════════════════════ */

  private scaleMonster(base: MonsterDef, level: number): ScaledMonster {
    const hp = Math.round(base.baseHp * (1 + HP_SCALE_FACTOR * (level - 1)));
    const damageMin = Math.max(1, Math.round(base.baseDamageMin * (1 + DMG_SCALE_FACTOR * (level - 1))));
    const damageMax = Math.max(damageMin, Math.round(base.baseDamageMax * (1 + DMG_SCALE_FACTOR * (level - 1))));
    const ac = base.baseAc + Math.floor(level / AC_SCALE_DIVISOR);
    const xpReward = base.baseXp * level;

    const goldBase = Math.round(base.baseGold * (1 + GOLD_SCALE_FACTOR * (level - 1)));
    const goldReward = Math.max(
      1,
      randomInt(
        Math.round(goldBase * (1 - GOLD_VARIANCE)),
        Math.round(goldBase * (1 + GOLD_VARIANCE)),
      ),
    );

    // Name prefix
    let name = base.name;
    if (level >= 8) name = `Elder ${base.name}`;
    else if (level >= 5) name = `Greater ${base.name}`;
    else if (level >= 3) name = `Strong ${base.name}`;

    // Filter abilities and loot by minLevel
    const abilities = base.abilities.filter((a) => a.minLevel <= level);
    const lootTable = base.lootTable.filter((l) => l.minLevel <= level);

    return {
      id: base.id,
      name,
      type: base.type,
      tier: base.tier,
      level,
      hp,
      maxHp: hp,
      damageMin,
      damageMax,
      ac,
      damageType: base.damageType,
      xpReward,
      goldReward,
      abilities,
      lootTable,
      description: base.description,
    };
  }

  private pickMonster(
    terrain: string,
    maxTier: string = 'normal',
    preferredTypes?: string[],
  ): MonsterDef | null {
    const tierOrder = ['normal', 'elite', 'boss'];
    const maxTierIdx = tierOrder.indexOf(maxTier);

    let pool = this.monstersList.filter((m) => {
      const tierIdx = tierOrder.indexOf(m.tier);
      return (
        tierIdx <= maxTierIdx &&
        m.preferredTerrains.includes(terrain)
      );
    });

    // Filter by preferred types if specified
    if (preferredTypes && preferredTypes.length > 0) {
      const typed = pool.filter((m) => preferredTypes.includes(m.type));
      if (typed.length > 0) pool = typed;
    }

    // Fallback: any non-boss monster
    if (pool.length === 0) {
      pool = this.monstersList.filter(
        (m) => tierOrder.indexOf(m.tier) <= maxTierIdx,
      );
    }

    if (pool.length === 0) return null;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  private getAreaLevel(
    x: number,
    y: number,
  ): { minLevel: number; maxLevel: number } {
    const distance = Math.sqrt(
      (x - MAP_CENTER_X) ** 2 + (y - MAP_CENTER_Y) ** 2,
    );
    for (const band of AREA_LEVEL_BANDS) {
      if (distance <= band.maxDistance) {
        return { minLevel: band.minLevel, maxLevel: band.maxLevel };
      }
    }
    return { minLevel: 7, maxLevel: 10 };
  }

  /* ─── Helper ─── */

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
