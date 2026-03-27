import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class SupabaseService {
  private client: SupabaseClient;

  constructor(private configService: ConfigService) {
    const url = this.configService.get<string>('SUPABASE_URL');
    const anonKey = this.configService.get<string>('SUPABASE_ANON_KEY');

    if (!url || !anonKey) {
      throw new Error(
        'Missing Supabase env vars: SUPABASE_URL, SUPABASE_ANON_KEY',
      );
    }

    this.client = createClient(url, anonKey);
  }

  getClient(): SupabaseClient {
    return this.client;
  }
}
