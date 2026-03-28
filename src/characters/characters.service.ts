import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { InventoryService } from '../inventory/inventory.service';
import { SpellsService } from '../spells/spells.service';
import { CreateCharacterDto } from './dto/create-character.dto';
import {
  ABILITIES,
  POINT_BUY_COSTS,
  POINT_BUY_BUDGET,
  abilityModifier,
  Ability,
} from '../common/constants/game.constants';
import { CLASS_MANA_BASE } from '../common/constants/spells.constants';
import { STARTING_GOLD } from '../common/constants/shop.constants';
import { LevelingService } from '../leveling/leveling.service';
import { STAT_CAP } from '../common/constants/leveling.constants';

@Injectable()
export class CharactersService {
  constructor(
    private supabaseService: SupabaseService,
    private inventoryService: InventoryService,
    private spellsService: SpellsService,
    private levelingService: LevelingService,
  ) {}

  async create(userId: string, dto: CreateCharacterDto) {
    const supabase = this.supabaseService.getClient();

    // Look up the race and its bonuses
    const { data: race, error: raceError } = await supabase
      .from('races')
      .select('*')
      .eq('id', dto.raceId)
      .single();

    if (raceError || !race) {
      throw new NotFoundException(`Race not found with id: ${dto.raceId}`);
    }

    // Look up the class
    const { data: charClass, error: classError } = await supabase
      .from('classes')
      .select('*')
      .eq('id', dto.classId)
      .single();

    if (classError || !charClass) {
      throw new NotFoundException(`Class not found with id: ${dto.classId}`);
    }

    // Validate point buy budget
    const totalCost = this.calculatePointBuyCost(dto);
    if (totalCost > POINT_BUY_BUDGET) {
      throw new BadRequestException(
        `Point buy cost is ${totalCost}, which exceeds the budget of ${POINT_BUY_BUDGET}`,
      );
    }

    // Apply racial bonuses to base scores
    const finalScores = this.applyRacialBonuses(dto, race);
    const maxHp = 10 + abilityModifier(finalScores.constitution);
    const ac = 10 + abilityModifier(finalScores.dexterity);
    const maxMana = CLASS_MANA_BASE[dto.classId] ?? 20;

    const { data, error } = await supabase
      .from('characters')
      .insert({
        user_id: userId,
        name: dto.name,
        race_id: dto.raceId,
        class_id: dto.classId,
        level: 1,
        xp: 0,
        hp: maxHp,
        max_hp: maxHp,
        ac,
        strength: finalScores.strength,
        dexterity: finalScores.dexterity,
        constitution: finalScores.constitution,
        intelligence: finalScores.intelligence,
        wisdom: finalScores.wisdom,
        charisma: finalScores.charisma,
        mana: maxMana,
        max_mana: maxMana,
        gold: STARTING_GOLD,
        pos_x: 50,
        pos_y: 50,
      })
      .select(
        `*, race:races(id, name), class:classes(id, name)`,
      )
      .single();

    if (error) {
      if (error.code === '23505') {
        throw new ConflictException('You already have a character');
      }
      throw new BadRequestException(error.message);
    }

    // Grant class-based starting equipment and spells
    await this.inventoryService.grantStartingEquipment(data.id, dto.classId);
    await this.spellsService.grantStartingSpells(data.id, dto.classId);

    return data;
  }

  async getMe(userId: string) {
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

  /** Allocate an unspent stat point to an ability score */
  async allocateStat(userId: string, stat: string) {
    const supabase = this.supabaseService.getClient();

    const { data: character, error } = await supabase
      .from('characters')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error || !character) {
      throw new NotFoundException('No character found. Create one first.');
    }

    if (character.unspent_stat_points <= 0) {
      throw new BadRequestException(
        'No unspent stat points available. Level up to earn more.',
      );
    }

    const currentValue = character[stat];
    if (currentValue >= STAT_CAP) {
      throw new BadRequestException(
        `${stat} is already at the maximum of ${STAT_CAP}.`,
      );
    }

    // Build update
    const updateData: Record<string, any> = {
      [stat]: currentValue + 1,
      unspent_stat_points: character.unspent_stat_points - 1,
    };

    // Recalculate derived stats if CON or INT changed
    if (stat === 'constitution') {
      const newMaxHp = this.levelingService.getMaxHp(
        character.level,
        character.class_id,
        currentValue + 1,
      );
      const hpDelta = newMaxHp - character.max_hp;
      updateData.max_hp = newMaxHp;
      updateData.hp = Math.min(character.hp + hpDelta, newMaxHp);
    }

    if (stat === 'intelligence') {
      const newMaxMana = this.levelingService.getMaxMana(
        character.level,
        character.class_id,
        currentValue + 1,
      );
      const manaDelta = newMaxMana - character.max_mana;
      updateData.max_mana = newMaxMana;
      updateData.mana = Math.min(character.mana + manaDelta, newMaxMana);
    }

    const { error: updateErr } = await supabase
      .from('characters')
      .update(updateData)
      .eq('id', character.id);

    if (updateErr) throw new BadRequestException(updateErr.message);

    const statName = stat.charAt(0).toUpperCase() + stat.slice(1);
    return {
      allocated: stat,
      newValue: currentValue + 1,
      unspentStatPoints: character.unspent_stat_points - 1,
      message: `${statName} increased to ${currentValue + 1}.`,
      ...(stat === 'constitution' ? {
        maxHp: updateData.max_hp,
        hp: updateData.hp,
      } : {}),
      ...(stat === 'intelligence' ? {
        maxMana: updateData.max_mana,
        mana: updateData.mana,
      } : {}),
    };
  }

  private calculatePointBuyCost(dto: CreateCharacterDto): number {
    let total = 0;
    for (const ability of ABILITIES) {
      const score = dto[ability];
      const cost = POINT_BUY_COSTS[score];
      if (cost === undefined) {
        throw new BadRequestException(
          `Invalid score ${score} for ${ability}. Must be 8-15.`,
        );
      }
      total += cost;
    }
    return total;
  }

  private applyRacialBonuses(
    dto: CreateCharacterDto,
    race: Record<string, unknown>,
  ): Record<Ability, number> {
    const scores = {} as Record<Ability, number>;
    for (const ability of ABILITIES) {
      const bonusKey = `bonus_${ability}`;
      const bonus = (race[bonusKey] as number) ?? 0;
      scores[ability] = dto[ability] + bonus;
    }
    return scores;
  }
}
