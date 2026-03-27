import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { MapService } from '../map/map.service';
import { findPath, computeStepTimes, Coordinate } from './pathfinding';
import {
  DIRECTIONS,
  IMPASSABLE_TERRAIN,
  TERRAIN_TRAVEL_COSTS,
} from '../common/constants/travel.constants';

@Injectable()
export class TravelService {
  constructor(
    private supabaseService: SupabaseService,
    private mapService: MapService,
  ) {}

  /** Fetch the character for a user, or throw 404 */
  private async getCharacter(userId: string) {
    const supabase = this.supabaseService.getClient();
    const { data, error } = await supabase
      .from('characters')
      .select(
        '*, race:races(id, name), class:classes(id, name)',
      )
      .eq('user_id', userId)
      .single();

    if (error || !data) {
      throw new NotFoundException('No character found. Create one first.');
    }
    return data;
  }

  /**
   * Resolve travel if it has completed.
   * Returns { character, discoveries } with the updated character.
   */
  async resolveTravel(character: any) {
    const discoveries: any[] = [];

    if (!character.travel_eta) {
      return { character, discoveries };
    }

    const eta = new Date(character.travel_eta).getTime();
    const now = Date.now();

    if (now < eta) {
      // Still traveling
      return { character, discoveries };
    }

    // Travel is complete — resolve it
    const path: Coordinate[] = character.travel_path;
    const destination = path[path.length - 1];

    // Discover hidden POIs along the entire path
    for (const cell of path) {
      const disc = await this.mapService.discoverCell(
        cell.x,
        cell.y,
        character.user_id,
      );
      if (disc) discoveries.push(disc);
    }

    // Update position and clear travel state
    const supabase = this.supabaseService.getClient();
    const { data: updated, error } = await supabase
      .from('characters')
      .update({
        pos_x: destination.x,
        pos_y: destination.y,
        travel_path: null,
        travel_started_at: null,
        travel_eta: null,
        travel_step_times: null,
      })
      .eq('id', character.id)
      .select('*, race:races(id, name), class:classes(id, name)')
      .single();

    if (error) throw new BadRequestException(error.message);

    return { character: updated, discoveries };
  }

  /**
   * Compute current progress along a travel path.
   * Returns the index of the furthest completed cell.
   */
  private getProgressIndex(character: any): number {
    if (!character.travel_started_at || !character.travel_step_times) return 0;

    const startedAt = new Date(character.travel_started_at).getTime();
    const elapsed = (Date.now() - startedAt) / 1000; // seconds
    const stepTimes: number[] = character.travel_step_times;

    let idx = 0;
    for (let i = 0; i < stepTimes.length; i++) {
      if (stepTimes[i] <= elapsed) {
        idx = i;
      } else {
        break;
      }
    }
    return idx;
  }

  /** Get full character data with travel status resolved if needed */
  async getMe(userId: string) {
    let character = await this.getCharacter(userId);
    const { character: resolved, discoveries } =
      await this.resolveTravel(character);
    character = resolved;

    return {
      ...this.formatCharacter(character),
      travel: this.buildTravelStatus(character),
      discoveries: discoveries.length > 0 ? discoveries : undefined,
    };
  }

  /** Get current travel status */
  async getStatus(userId: string) {
    let character = await this.getCharacter(userId);
    const { character: resolved, discoveries } =
      await this.resolveTravel(character);
    character = resolved;

    return {
      ...this.buildTravelStatus(character),
      discoveries: discoveries.length > 0 ? discoveries : undefined,
    };
  }

  /** Step-based movement: one cell in a direction */
  async move(userId: string, direction: string) {
    let character = await this.getCharacter(userId);
    const { character: resolved } = await this.resolveTravel(character);
    character = resolved;

    // Reject if currently traveling
    if (character.travel_eta) {
      const eta = new Date(character.travel_eta);
      throw new ConflictException(
        `Already traveling. Arrives at ${eta.toISOString()}`,
      );
    }

    const dir = DIRECTIONS[direction];
    if (!dir) {
      throw new BadRequestException(`Invalid direction: ${direction}`);
    }

    const targetX = character.pos_x + dir.dx;
    const targetY = character.pos_y + dir.dy;

    // Validate target cell
    const terrain = this.mapService.getTerrainAt(targetX, targetY);
    if (terrain === null) {
      throw new BadRequestException('Cannot move out of bounds.');
    }
    if (IMPASSABLE_TERRAIN.has(terrain)) {
      throw new BadRequestException(
        `Cannot traverse ${terrain}. It is impassable.`,
      );
    }

    const cost = TERRAIN_TRAVEL_COSTS[terrain] ?? 10;
    const path: Coordinate[] = [
      { x: character.pos_x, y: character.pos_y },
      { x: targetX, y: targetY },
    ];
    const stepTimes = [0, cost];
    const now = new Date();
    const eta = new Date(now.getTime() + cost * 1000);

    // Set travel state
    const supabase = this.supabaseService.getClient();
    const { error } = await supabase
      .from('characters')
      .update({
        travel_path: path,
        travel_started_at: now.toISOString(),
        travel_eta: eta.toISOString(),
        travel_step_times: stepTimes,
      })
      .eq('id', character.id);

    if (error) throw new BadRequestException(error.message);

    return {
      direction,
      from: path[0],
      destination: path[1],
      terrain,
      travelSeconds: cost,
      startedAt: now.toISOString(),
      eta: eta.toISOString(),
    };
  }

  /** Direct travel: pathfind to a coordinate */
  async travel(userId: string, x: number, y: number) {
    let character = await this.getCharacter(userId);
    const { character: resolved } = await this.resolveTravel(character);
    character = resolved;

    // Reject if currently traveling
    if (character.travel_eta) {
      const eta = new Date(character.travel_eta);
      throw new ConflictException(
        `Already traveling. Arrives at ${eta.toISOString()}`,
      );
    }

    // Reject if already there
    if (character.pos_x === x && character.pos_y === y) {
      throw new BadRequestException('You are already at that location.');
    }

    // Pathfind
    const start: Coordinate = { x: character.pos_x, y: character.pos_y };
    const goal: Coordinate = { x, y };
    const path = findPath(
      start,
      goal,
      this.mapService.getTerrainAt.bind(this.mapService),
    );

    if (!path) {
      throw new BadRequestException(
        'No path exists to that destination. It may be blocked by ocean or out of bounds.',
      );
    }

    const stepTimes = computeStepTimes(
      path,
      this.mapService.getTerrainAt.bind(this.mapService),
    );
    const totalSeconds = stepTimes[stepTimes.length - 1];
    const now = new Date();
    const eta = new Date(now.getTime() + totalSeconds * 1000);

    // Set travel state
    const supabase = this.supabaseService.getClient();
    const { error } = await supabase
      .from('characters')
      .update({
        travel_path: path,
        travel_started_at: now.toISOString(),
        travel_eta: eta.toISOString(),
        travel_step_times: stepTimes,
      })
      .eq('id', character.id);

    if (error) throw new BadRequestException(error.message);

    return {
      from: start,
      destination: goal,
      path,
      totalCells: path.length - 1,
      travelSeconds: totalSeconds,
      startedAt: now.toISOString(),
      eta: eta.toISOString(),
    };
  }

  /** Cancel active travel — land at the furthest reached cell */
  async cancel(userId: string) {
    let character = await this.getCharacter(userId);

    // If travel already resolved, nothing to cancel
    const { character: resolved, discoveries: resolvedDisc } =
      await this.resolveTravel(character);
    character = resolved;

    if (!character.travel_eta) {
      throw new BadRequestException('Not currently traveling.');
    }

    const path: Coordinate[] = character.travel_path;
    const progressIdx = this.getProgressIndex(character);
    const landingCell = path[progressIdx];

    // Discover POIs for traversed cells
    const discoveries: any[] = [];
    for (let i = 0; i <= progressIdx; i++) {
      const disc = await this.mapService.discoverCell(
        path[i].x,
        path[i].y,
        character.user_id,
      );
      if (disc) discoveries.push(disc);
    }

    // Update position and clear travel state
    const supabase = this.supabaseService.getClient();
    const { error } = await supabase
      .from('characters')
      .update({
        pos_x: landingCell.x,
        pos_y: landingCell.y,
        travel_path: null,
        travel_started_at: null,
        travel_eta: null,
        travel_step_times: null,
      })
      .eq('id', character.id);

    if (error) throw new BadRequestException(error.message);

    return {
      cancelled: true,
      position: landingCell,
      cellsTraversed: progressIdx,
      discoveries: discoveries.length > 0 ? discoveries : undefined,
    };
  }

  /** Build travel status object from a character row */
  private buildTravelStatus(character: any) {
    if (!character.travel_eta) {
      return {
        isTraveling: false,
        position: { x: character.pos_x, y: character.pos_y },
      };
    }

    const path: Coordinate[] = character.travel_path;
    const progressIdx = this.getProgressIndex(character);
    const estimatedCurrent = path[progressIdx];
    const destination = path[path.length - 1];

    return {
      isTraveling: true,
      position: { x: character.pos_x, y: character.pos_y },
      estimatedCurrent,
      destination,
      path,
      progressIndex: progressIdx,
      totalCells: path.length - 1,
      startedAt: character.travel_started_at,
      eta: character.travel_eta,
    };
  }

  /** Format character data for API response */
  private formatCharacter(character: any) {
    return {
      id: character.id,
      name: character.name,
      race: character.race,
      class: character.class,
      level: character.level,
      xp: character.xp,
      hp: character.hp,
      maxHp: character.max_hp,
      ac: character.ac,
      strength: character.strength,
      dexterity: character.dexterity,
      constitution: character.constitution,
      intelligence: character.intelligence,
      wisdom: character.wisdom,
      charisma: character.charisma,
      position: { x: character.pos_x, y: character.pos_y },
      createdAt: character.created_at,
    };
  }
}
