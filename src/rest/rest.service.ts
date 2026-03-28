import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { MapService } from '../map/map.service';
import {
  CAMP_HP_PER_SECOND,
  CAMP_MANA_PER_SECOND,
  CAMP_MIN_SECONDS,
  CAMP_MAX_SECONDS,
} from '../common/constants/rest.constants';

@Injectable()
export class RestService {
  constructor(
    private supabaseService: SupabaseService,
    private mapService: MapService,
  ) {}

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

  /**
   * Resolve rest if the timer has expired.
   * Returns the updated character.
   */
  private async resolveRest(character: any) {
    if (!character.rest_until) return character;

    const until = new Date(character.rest_until).getTime();
    const now = Date.now();

    if (now < until) return character; // still resting

    // Rest complete — calculate recovery
    const startedAt = new Date(character.rest_started_at).getTime();
    const elapsed = (until - startedAt) / 1000;

    const hpRecovered = Math.min(
      Math.floor(elapsed * CAMP_HP_PER_SECOND),
      character.max_hp - character.hp,
    );
    const manaRecovered = Math.min(
      Math.floor(elapsed * CAMP_MANA_PER_SECOND),
      character.max_mana - character.mana,
    );

    const supabase = this.supabaseService.getClient();
    const { data: updated, error } = await supabase
      .from('characters')
      .update({
        hp: character.hp + hpRecovered,
        mana: character.mana + manaRecovered,
        rest_started_at: null,
        rest_until: null,
        rest_type: null,
      })
      .eq('id', character.id)
      .select('*, race:races(id, name), class:classes(id, name)')
      .single();

    if (error) throw new BadRequestException(error.message);
    return updated;
  }

  private checkNotTraveling(character: any) {
    if (character.travel_eta) {
      const eta = new Date(character.travel_eta);
      if (eta.getTime() > Date.now()) {
        throw new ConflictException(
          `Cannot rest while traveling. Arrives at ${eta.toISOString()}`,
        );
      }
    }
  }

  private checkNotResting(character: any) {
    if (character.rest_until) {
      const until = new Date(character.rest_until);
      if (until.getTime() > Date.now()) {
        throw new ConflictException(
          `Already resting. Finishes at ${until.toISOString()}`,
        );
      }
    }
  }

  private checkNotInCombat(character: any) {
    if (character.in_combat) {
      throw new ConflictException('Cannot rest while in combat.');
    }
    if (character.in_dungeon) {
      throw new ConflictException('Cannot rest while in a dungeon.');
    }
  }

  /* ─── Public API ─── */

  /** Start camping at the current location */
  async startCamp(userId: string, durationSeconds?: number) {
    let character = await this.getCharacter(userId);
    character = await this.resolveRest(character);

    this.checkNotTraveling(character);
    this.checkNotResting(character);
    this.checkNotInCombat(character);

    // Check if already at full HP and mana
    if (
      character.hp >= character.max_hp &&
      character.mana >= character.max_mana
    ) {
      throw new BadRequestException(
        'Already at full health and mana. No need to rest.',
      );
    }

    // Calculate time needed for full recovery
    const hpNeeded = character.max_hp - character.hp;
    const manaNeeded = character.max_mana - character.mana;
    const hpTime =
      CAMP_HP_PER_SECOND > 0 ? hpNeeded / CAMP_HP_PER_SECOND : 0;
    const manaTime =
      CAMP_MANA_PER_SECOND > 0 ? manaNeeded / CAMP_MANA_PER_SECOND : 0;
    const fullRecoveryTime = Math.ceil(Math.max(hpTime, manaTime));

    // Determine actual duration
    let duration = durationSeconds ?? fullRecoveryTime;
    duration = Math.max(CAMP_MIN_SECONDS, Math.min(duration, CAMP_MAX_SECONDS));

    const now = new Date();
    const until = new Date(now.getTime() + duration * 1000);

    const supabase = this.supabaseService.getClient();
    const { error } = await supabase
      .from('characters')
      .update({
        rest_started_at: now.toISOString(),
        rest_until: until.toISOString(),
        rest_type: 'camp',
      })
      .eq('id', character.id);

    if (error) throw new BadRequestException(error.message);

    return {
      resting: true,
      type: 'camp',
      durationSeconds: duration,
      startedAt: now.toISOString(),
      until: until.toISOString(),
      position: { x: character.pos_x, y: character.pos_y },
      willRecover: {
        hp: Math.min(
          Math.floor(duration * CAMP_HP_PER_SECOND),
          hpNeeded,
        ),
        mana: Math.min(
          Math.floor(duration * CAMP_MANA_PER_SECOND),
          manaNeeded,
        ),
      },
    };
  }

  /** Rest at a town inn — instant full restore */
  async restAtInn(userId: string) {
    let character = await this.getCharacter(userId);
    character = await this.resolveRest(character);

    this.checkNotTraveling(character);
    this.checkNotResting(character);

    // Check character is at a town POI
    const poi = await this.mapService.getPOIAt(
      character.pos_x,
      character.pos_y,
    );
    if (!poi || poi.type !== 'town') {
      throw new BadRequestException(
        'You must be at a town to rest at an inn.',
      );
    }

    // Check if already at full HP and mana
    if (
      character.hp >= character.max_hp &&
      character.mana >= character.max_mana
    ) {
      throw new BadRequestException(
        'Already at full health and mana. No need to rest.',
      );
    }

    // Instant full restore
    const supabase = this.supabaseService.getClient();
    const { error } = await supabase
      .from('characters')
      .update({
        hp: character.max_hp,
        mana: character.max_mana,
        rest_started_at: null,
        rest_until: null,
        rest_type: null,
      })
      .eq('id', character.id);

    if (error) throw new BadRequestException(error.message);

    return {
      rested: true,
      type: 'inn',
      location: poi.name,
      hp: character.max_hp,
      maxHp: character.max_hp,
      mana: character.max_mana,
      maxMana: character.max_mana,
      hpRestored: character.max_hp - character.hp,
      manaRestored: character.max_mana - character.mana,
    };
  }

  /** Check rest progress */
  async getStatus(userId: string) {
    let character = await this.getCharacter(userId);
    character = await this.resolveRest(character);

    if (!character.rest_until) {
      return {
        resting: false,
        hp: character.hp,
        maxHp: character.max_hp,
        mana: character.mana,
        maxMana: character.max_mana,
      };
    }

    // Still resting — calculate current progress
    const startedAt = new Date(character.rest_started_at).getTime();
    const until = new Date(character.rest_until).getTime();
    const elapsed = (Date.now() - startedAt) / 1000;
    const totalDuration = (until - startedAt) / 1000;

    const hpNeeded = character.max_hp - character.hp;
    const manaNeeded = character.max_mana - character.mana;

    const hpSoFar = Math.min(
      Math.floor(elapsed * CAMP_HP_PER_SECOND),
      hpNeeded,
    );
    const manaSoFar = Math.min(
      Math.floor(elapsed * CAMP_MANA_PER_SECOND),
      manaNeeded,
    );

    return {
      resting: true,
      type: character.rest_type,
      startedAt: character.rest_started_at,
      until: character.rest_until,
      elapsedSeconds: Math.floor(elapsed),
      totalDurationSeconds: Math.floor(totalDuration),
      currentHp: character.hp + hpSoFar,
      currentMana: character.mana + manaSoFar,
      maxHp: character.max_hp,
      maxMana: character.max_mana,
      recovered: { hp: hpSoFar, mana: manaSoFar },
    };
  }

  /** Stop resting early — apply partial recovery */
  async stopRest(userId: string) {
    const character = await this.getCharacter(userId);

    if (!character.rest_until) {
      throw new BadRequestException('Not currently resting.');
    }

    const until = new Date(character.rest_until).getTime();
    const now = Date.now();

    // If rest already complete, just resolve it
    if (now >= until) {
      const resolved = await this.resolveRest(character);
      return {
        stopped: false,
        completed: true,
        hp: resolved.hp,
        maxHp: resolved.max_hp,
        mana: resolved.mana,
        maxMana: resolved.max_mana,
      };
    }

    // Calculate partial recovery
    const startedAt = new Date(character.rest_started_at).getTime();
    const elapsed = (now - startedAt) / 1000;

    const hpRecovered = Math.min(
      Math.floor(elapsed * CAMP_HP_PER_SECOND),
      character.max_hp - character.hp,
    );
    const manaRecovered = Math.min(
      Math.floor(elapsed * CAMP_MANA_PER_SECOND),
      character.max_mana - character.mana,
    );

    const newHp = character.hp + hpRecovered;
    const newMana = character.mana + manaRecovered;

    const supabase = this.supabaseService.getClient();
    const { error } = await supabase
      .from('characters')
      .update({
        hp: newHp,
        mana: newMana,
        rest_started_at: null,
        rest_until: null,
        rest_type: null,
      })
      .eq('id', character.id);

    if (error) throw new BadRequestException(error.message);

    return {
      stopped: true,
      completed: false,
      elapsedSeconds: Math.floor(elapsed),
      recovered: { hp: hpRecovered, mana: manaRecovered },
      hp: newHp,
      maxHp: character.max_hp,
      mana: newMana,
      maxMana: character.max_mana,
    };
  }
}
