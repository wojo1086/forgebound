import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import * as worldMap from '../data/world-map.json';
import * as regionsData from '../data/regions.json';

@Injectable()
export class MapService {
  private terrain: string[][] = worldMap.terrain;
  private width = worldMap.width;
  private height = worldMap.height;

  constructor(private supabaseService: SupabaseService) {}

  /** Get full terrain grid + all visible POIs */
  async getWorldMap(userId?: string) {
    const supabase = this.supabaseService.getClient();

    // Get all visible POIs (towns + landmarks)
    const { data: visiblePois, error: visibleErr } = await supabase
      .from('pois')
      .select('id, name, type, category, x, y, terrain, description, level_min, level_max')
      .eq('visible', true);

    if (visibleErr) throw visibleErr;

    // If user is authenticated, also get their discovered hidden POIs
    let discoveries: any[] = [];
    if (userId) {
      const { data: discoveredPois, error: discErr } = await supabase
        .from('player_discoveries')
        .select('poi_id, discovered_at, pois(id, name, type, category, x, y, terrain, description, level_min, level_max)')
        .eq('user_id', userId);

      if (!discErr && discoveredPois) {
        discoveries = discoveredPois.map((d) => ({
          ...(d.pois as any),
          discoveredAt: d.discovered_at,
        }));
      }
    }

    return {
      width: this.width,
      height: this.height,
      terrain: this.terrain,
      pois: visiblePois || [],
      discoveries,
    };
  }

  /** Get details about a single cell */
  async getCellInfo(x: number, y: number, userId?: string) {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
      return null;
    }

    const terrain = this.terrain[y][x];
    const supabase = this.supabaseService.getClient();

    // Get visible POI at this cell
    const { data: poi } = await supabase
      .from('pois')
      .select('*')
      .eq('x', x)
      .eq('y', y)
      .eq('visible', true)
      .maybeSingle();

    // Check if user has discovered a hidden POI here
    let discovery = null;
    if (userId) {
      const { data } = await supabase
        .from('player_discoveries')
        .select('poi_id, discovered_at, pois(*)')
        .eq('user_id', userId)
        .eq('pois.x', x)
        .eq('pois.y', y)
        .maybeSingle();

      if (data) {
        discovery = { ...(data.pois as any), discoveredAt: data.discovered_at };
      }
    }

    return {
      x,
      y,
      terrain,
      poi: poi || discovery || null,
    };
  }

  /** Get all named regions */
  getRegions() {
    return regionsData.regions;
  }

  /** Get terrain at a coordinate (from static data, no DB) */
  getTerrainAt(x: number, y: number): string | null {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
      return null;
    }
    return this.terrain[y][x];
  }

  /** Get the POI at a given coordinate (any type), or null */
  async getPOIAt(x: number, y: number) {
    const supabase = this.supabaseService.getClient();
    const { data } = await supabase
      .from('pois')
      .select('*')
      .eq('x', x)
      .eq('y', y)
      .maybeSingle();
    return data;
  }

  /** Check if a hidden POI exists at a cell and discover it for the player */
  async discoverCell(x: number, y: number, userId: string) {
    const supabase = this.supabaseService.getClient();

    // Check for hidden POI at this cell
    const { data: hiddenPoi } = await supabase
      .from('pois')
      .select('*')
      .eq('x', x)
      .eq('y', y)
      .eq('visible', false)
      .maybeSingle();

    if (!hiddenPoi) return null;

    // Check if already discovered
    const { data: existing } = await supabase
      .from('player_discoveries')
      .select('id')
      .eq('user_id', userId)
      .eq('poi_id', hiddenPoi.id)
      .maybeSingle();

    if (existing) return null; // Already known

    // Record discovery
    await supabase
      .from('player_discoveries')
      .insert({ user_id: userId, poi_id: hiddenPoi.id });

    return hiddenPoi;
  }
}
