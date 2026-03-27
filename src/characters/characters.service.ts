import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { CreateCharacterDto } from './dto/create-character.dto';
import {
  ABILITIES,
  POINT_BUY_COSTS,
  POINT_BUY_BUDGET,
  abilityModifier,
  Ability,
} from '../common/constants/game.constants';

@Injectable()
export class CharactersService {
  constructor(private supabaseService: SupabaseService) {}

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
