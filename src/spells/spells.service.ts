import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import {
  CLASS_MANA_BASE,
  STARTING_SPELLS,
} from '../common/constants/spells.constants';

@Injectable()
export class SpellsService {
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

  private async getSpellDef(spellId: string) {
    const supabase = this.supabaseService.getClient();
    const { data, error } = await supabase
      .from('spells')
      .select('*')
      .eq('id', spellId)
      .single();

    if (error || !data) {
      throw new NotFoundException(`Spell '${spellId}' does not exist.`);
    }
    return data;
  }

  /* ─── Public API ─── */

  /** Get the character's spellbook: mana + learned spells */
  async getSpellbook(userId: string) {
    const character = await this.getCharacter(userId);
    const spells = await this.getLearnedSpells(character.id);

    return {
      mana: character.mana,
      maxMana: character.max_mana,
      spells: spells.map((row: any) => this.formatSpell(row.spell)),
    };
  }

  /** Learn a new spell */
  async learnSpell(userId: string, spellId: string) {
    const character = await this.getCharacter(userId);
    const spell = await this.getSpellDef(spellId);

    // Class restriction check
    if (spell.class_restriction && spell.class_restriction !== character.class_id) {
      throw new BadRequestException(
        `Only the ${spell.class_restriction} class can learn ${spell.name}.`,
      );
    }

    // Level check
    if (character.level < spell.level_required) {
      throw new BadRequestException(
        `You must be level ${spell.level_required} to learn ${spell.name}. You are level ${character.level}.`,
      );
    }

    // Already known check
    const supabase = this.supabaseService.getClient();
    const { data: existing } = await supabase
      .from('character_spells')
      .select('id')
      .eq('character_id', character.id)
      .eq('spell_id', spellId)
      .maybeSingle();

    if (existing) {
      throw new BadRequestException(`You already know ${spell.name}.`);
    }

    // Insert
    const { error } = await supabase.from('character_spells').insert({
      character_id: character.id,
      spell_id: spellId,
    });

    if (error) throw new BadRequestException(error.message);

    return {
      learned: spell.name,
      message: `You have learned ${spell.name}!`,
      spell: this.formatSpell(spell),
    };
  }

  /** Cast a spell */
  async castSpell(userId: string, spellId: string) {
    const character = await this.getCharacter(userId);
    const spell = await this.getSpellDef(spellId);

    // Must know the spell
    const supabase = this.supabaseService.getClient();
    const { data: known } = await supabase
      .from('character_spells')
      .select('id')
      .eq('character_id', character.id)
      .eq('spell_id', spellId)
      .maybeSingle();

    if (!known) {
      throw new BadRequestException(`You have not learned ${spell.name}.`);
    }

    // Mana check
    if (character.mana < spell.mana_cost) {
      throw new BadRequestException(
        `Not enough mana. ${spell.name} costs ${spell.mana_cost} mana, you have ${character.mana}.`,
      );
    }

    // Combat-only spells cannot be cast outside of battle
    if (spell.effect_type === 'damage' || spell.effect_type === null) {
      throw new BadRequestException(
        `Cannot cast ${spell.name} outside of battle.`,
      );
    }

    // Deduct mana
    const newMana = character.mana - spell.mana_cost;

    // Apply effect
    let effectMessage: string;
    const updateData: Record<string, any> = { mana: newMana };

    switch (spell.effect_type) {
      case 'heal_hp': {
        if (character.hp >= character.max_hp) {
          throw new BadRequestException('Already at full health.');
        }
        const healed = Math.min(
          spell.effect_value,
          character.max_hp - character.hp,
        );
        updateData.hp = character.hp + healed;
        effectMessage = `${spell.name} restored ${healed} HP. HP: ${updateData.hp}/${character.max_hp}. Mana: ${newMana}/${character.max_mana}`;
        break;
      }
      case 'restore_mana': {
        const restored = Math.min(
          spell.effect_value,
          character.max_mana - character.mana,
        );
        updateData.mana = character.mana - spell.mana_cost + restored;
        effectMessage = `${spell.name} restored ${restored} mana. Mana: ${updateData.mana}/${character.max_mana}`;
        break;
      }
      case 'teleport_town': {
        // Teleport to the default starting position (50, 50)
        updateData.pos_x = 50;
        updateData.pos_y = 50;
        // Clear any active travel
        updateData.travel_path = null;
        updateData.travel_started_at = null;
        updateData.travel_eta = null;
        updateData.travel_step_times = null;
        effectMessage = `${spell.name} teleported you to town! Position: (50, 50). Mana: ${newMana}/${character.max_mana}`;
        break;
      }
      case 'buff_strength':
      case 'buff_dexterity':
      case 'buff_constitution':
      case 'buff_intelligence':
      case 'buff_wisdom':
      case 'buff_charisma': {
        const stat = spell.effect_type.replace('buff_', '');
        const statName = stat.charAt(0).toUpperCase() + stat.slice(1);
        effectMessage = `${spell.name} temporarily increased ${statName} by +${spell.effect_value}. Mana: ${newMana}/${character.max_mana} (Note: buff duration tracking not yet implemented)`;
        break;
      }
      case 'buff_max_hp': {
        effectMessage = `${spell.name} temporarily increased Max HP by +${spell.effect_value}. Mana: ${newMana}/${character.max_mana} (Note: buff duration tracking not yet implemented)`;
        break;
      }
      default:
        throw new BadRequestException(
          `Cannot cast ${spell.name} — effect type '${spell.effect_type}' is not yet supported.`,
        );
    }

    // Update character
    const { error } = await supabase
      .from('characters')
      .update(updateData)
      .eq('id', character.id);

    if (error) throw new BadRequestException(error.message);

    return {
      cast: spell.name,
      manaCost: spell.mana_cost,
      effect: { type: spell.effect_type, value: spell.effect_value },
      result: effectMessage,
    };
  }

  /* ─── Utilities for other modules ─── */

  /** Grant starting spells to a newly created character */
  async grantStartingSpells(characterId: string, classId: string) {
    const spellIds = STARTING_SPELLS[classId];
    if (!spellIds || spellIds.length === 0) return;

    const supabase = this.supabaseService.getClient();

    for (const spellId of spellIds) {
      const { error } = await supabase.from('character_spells').insert({
        character_id: characterId,
        spell_id: spellId,
      });

      if (error) {
        console.warn(
          `Failed to grant starting spell ${spellId}: ${error.message}`,
        );
      }
    }
  }

  /** Get learned spells for a character (used by travel service) */
  async getLearnedSpells(characterId: string) {
    const supabase = this.supabaseService.getClient();
    const { data, error } = await supabase
      .from('character_spells')
      .select('*, spell:spells(*)')
      .eq('character_id', characterId)
      .order('learned_at', { ascending: true });

    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  /* ─── Formatters ─── */

  private formatSpell(spell: any) {
    return {
      id: spell.id,
      name: spell.name,
      description: spell.description,
      school: spell.school,
      spellLevel: spell.spell_level,
      manaCost: spell.mana_cost,
      cooldownSeconds: spell.cooldown_seconds,
      levelRequired: spell.level_required,
      classRestriction: spell.class_restriction,
      targetType: spell.target_type,
      effectType: spell.effect_type,
      effectValue: spell.effect_value,
      damageType: spell.damage_type,
    };
  }
}
