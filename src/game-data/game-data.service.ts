import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

@Injectable()
export class GameDataService {
  constructor(private supabaseService: SupabaseService) {}

  async getRaces() {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('races')
      .select('*')
      .order('name');

    if (error) {
      throw error;
    }

    return data;
  }

  async getClasses() {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('classes')
      .select('*')
      .order('name');

    if (error) {
      throw error;
    }

    return data;
  }

  async getItems() {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('items')
      .select('*')
      .order('type')
      .order('rarity')
      .order('name');

    if (error) {
      throw error;
    }

    return data;
  }
}
