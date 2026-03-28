import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import {
  LEVEL_CAP,
  STAT_POINTS_PER_LEVEL,
  levelForXp,
  calculateMaxHp,
  calculateMaxMana,
} from '../common/constants/leveling.constants';
import { AUTO_LEARN_MAX_LEVEL } from '../common/constants/spells.constants';

export interface LevelUpResult {
  leveledUp: boolean;
  oldLevel: number;
  newLevel: number;
  hpGained: number;
  manaGained: number;
  statPointsGained: number;
  newSpells: { id: string; name: string }[];
}

export interface XpGrantResult extends LevelUpResult {
  xpGained: number;
  totalXp: number;
  unspentStatPoints: number;
}

@Injectable()
export class LevelingService {
  private readonly logger = new Logger(LevelingService.name);

  constructor(private supabaseService: SupabaseService) {}

  /**
   * Grant XP to a character and process any level-ups.
   * Returns full result including XP, level changes, new spells, and stat points.
   */
  async grantXp(
    characterId: string,
    amount: number,
  ): Promise<XpGrantResult> {
    const supabase = this.supabaseService.getClient();

    // Fetch current state
    const { data: character, error } = await supabase
      .from('characters')
      .select('id, xp, level, class_id, constitution, intelligence, max_hp, max_mana, unspent_stat_points')
      .eq('id', characterId)
      .single();

    if (error || !character) {
      throw new Error(`Character ${characterId} not found`);
    }

    const oldLevel = character.level;
    const newXp = character.xp + amount;
    const newLevel = Math.min(levelForXp(newXp), LEVEL_CAP);

    const result: XpGrantResult = {
      xpGained: amount,
      totalXp: newXp,
      leveledUp: newLevel > oldLevel,
      oldLevel,
      newLevel,
      hpGained: 0,
      manaGained: 0,
      statPointsGained: 0,
      newSpells: [],
      unspentStatPoints: character.unspent_stat_points,
    };

    const updateData: Record<string, any> = { xp: newXp };

    if (newLevel > oldLevel) {
      // Process level-up
      const levelsGained = newLevel - oldLevel;
      const statPointsGained = levelsGained * STAT_POINTS_PER_LEVEL;

      const newMaxHp = calculateMaxHp(newLevel, character.class_id, character.constitution);
      const newMaxMana = calculateMaxMana(newLevel, character.class_id, character.intelligence);

      result.hpGained = newMaxHp - character.max_hp;
      result.manaGained = newMaxMana - character.max_mana;
      result.statPointsGained = statPointsGained;
      result.unspentStatPoints = character.unspent_stat_points + statPointsGained;

      updateData.level = newLevel;
      updateData.max_hp = newMaxHp;
      updateData.hp = newMaxHp; // Full heal on level-up
      updateData.max_mana = newMaxMana;
      updateData.mana = newMaxMana; // Full mana restore on level-up
      updateData.unspent_stat_points = result.unspentStatPoints;

      // Auto-learn eligible spells
      result.newSpells = await this.autoLearnSpells(
        characterId,
        character.class_id,
        newLevel,
      );

      this.logger.log(
        `Character ${characterId} leveled up: ${oldLevel} → ${newLevel} (+${result.hpGained} HP, +${result.manaGained} mana, ${result.newSpells.length} spells)`,
      );
    }

    // Update character
    const { error: updateErr } = await supabase
      .from('characters')
      .update(updateData)
      .eq('id', characterId);

    if (updateErr) {
      this.logger.error(`Failed to update character XP: ${updateErr.message}`);
    }

    return result;
  }

  /**
   * Auto-learn spells the character is newly eligible for.
   * Only auto-learns spells with spell_level <= AUTO_LEARN_MAX_LEVEL (3).
   */
  private async autoLearnSpells(
    characterId: string,
    classId: string,
    newLevel: number,
  ): Promise<{ id: string; name: string }[]> {
    const supabase = this.supabaseService.getClient();

    // Find eligible spells: level_required <= newLevel, spell_level <= 3,
    // class matches or unrestricted, not already known
    const { data: eligibleSpells, error: spellErr } = await supabase
      .from('spells')
      .select('id, name')
      .lte('level_required', newLevel)
      .lte('spell_level', AUTO_LEARN_MAX_LEVEL)
      .or(`class_restriction.eq.${classId},class_restriction.is.null`);

    if (spellErr || !eligibleSpells) return [];

    // Get already known spells
    const { data: knownSpells } = await supabase
      .from('character_spells')
      .select('spell_id')
      .eq('character_id', characterId);

    const knownSet = new Set(
      (knownSpells ?? []).map((row: any) => row.spell_id),
    );

    // Learn new spells
    const newSpells: { id: string; name: string }[] = [];

    for (const spell of eligibleSpells) {
      if (knownSet.has(spell.id)) continue;

      const { error: insertErr } = await supabase
        .from('character_spells')
        .insert({
          character_id: characterId,
          spell_id: spell.id,
        });

      if (!insertErr) {
        newSpells.push({ id: spell.id, name: spell.name });
      }
    }

    return newSpells;
  }

  /** Public access to calculateMaxHp for stat allocation */
  getMaxHp(level: number, classId: string, constitution: number): number {
    return calculateMaxHp(level, classId, constitution);
  }

  /** Public access to calculateMaxMana for stat allocation */
  getMaxMana(level: number, classId: string, intelligence: number): number {
    return calculateMaxMana(level, classId, intelligence);
  }
}
