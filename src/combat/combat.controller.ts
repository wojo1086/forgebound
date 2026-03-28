import { Body, Controller, Get, Post } from '@nestjs/common';
import { CombatService } from './combat.service';
import { CombatActionDto } from './dto/combat-action.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ThrottleTier } from '../common/decorators/throttle-tier.decorator';

@Controller('combat')
export class CombatController {
  constructor(private combatService: CombatService) {}

  /**
   * GET /api/combat/status
   * Returns the current combat state, or 404 if not in combat.
   */
  @Get('status')
  async getStatus(@CurrentUser() user: { id: string }) {
    const status = await this.combatService.getCombatStatus(user.id);
    if (!status) {
      return { inCombat: false };
    }
    return status;
  }

  /**
   * POST /api/combat/action
   * Perform a combat action: attack, cast, use_item, or flee.
   */
  @ThrottleTier('gameplay')
  @Post('action')
  performAction(
    @CurrentUser() user: { id: string },
    @Body() dto: CombatActionDto,
  ) {
    return this.combatService.performAction(
      user.id,
      dto.action,
      dto.spellId,
      dto.itemId,
    );
  }
}
