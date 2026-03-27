export const THROTTLE_TIER_KEY = 'throttle-tier';

export interface ThrottleTierConfig {
  ttl: number; // seconds
  limit: number;
}

export const THROTTLE_TIERS: Record<string, ThrottleTierConfig> = {
  auth: { ttl: 60, limit: 5 },
  gameplay: { ttl: 60, limit: 30 },
  public: { ttl: 60, limit: 60 },
};

export const DEFAULT_TIER = 'public';
