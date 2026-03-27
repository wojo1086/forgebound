import { SetMetadata } from '@nestjs/common';
import { THROTTLE_TIER_KEY } from '../constants/throttle.constants';

/**
 * Tag a controller or handler with a rate-limit tier.
 * Valid tiers: 'auth' | 'gameplay' | 'public'
 * If omitted, defaults to 'public' (60 req/min).
 */
export const ThrottleTier = (tier: string) =>
  SetMetadata(THROTTLE_TIER_KEY, tier);
