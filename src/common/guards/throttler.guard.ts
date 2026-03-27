import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerRequest } from '@nestjs/throttler';
import {
  THROTTLE_TIER_KEY,
  THROTTLE_TIERS,
  DEFAULT_TIER,
  ThrottleTierConfig,
} from '../constants/throttle.constants';

@Injectable()
export class ForgeboundThrottlerGuard extends ThrottlerGuard {
  /**
   * Key rate limits by authenticated user ID when available,
   * falling back to IP address for public/unauthenticated routes.
   */
  protected async getTracker(req: Record<string, any>): Promise<string> {
    return req.user?.id ?? req.ip;
  }

  /**
   * Resolve the tier config for the current request context.
   */
  private getTierConfig(context: ExecutionContext): ThrottleTierConfig {
    const tier =
      this.reflector.getAllAndOverride<string>(THROTTLE_TIER_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? DEFAULT_TIER;

    return THROTTLE_TIERS[tier] ?? THROTTLE_TIERS[DEFAULT_TIER];
  }

  /**
   * Override handleRequest to enforce the tier-specific limit and TTL
   * without mutating shared throttler state.
   */
  protected async handleRequest(
    requestProps: ThrottlerRequest,
  ): Promise<boolean> {
    const config = this.getTierConfig(requestProps.context);

    // Override the limit and TTL for this specific request
    return super.handleRequest({
      ...requestProps,
      limit: config.limit,
      ttl: config.ttl * 1000, // seconds → ms
    });
  }
}
