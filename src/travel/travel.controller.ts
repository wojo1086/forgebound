import { Body, Controller, Get, Post } from '@nestjs/common';
import { TravelService } from './travel.service';
import { MoveDto } from './dto/move.dto';
import { TravelDto } from './dto/travel.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ThrottleTier } from '../common/decorators/throttle-tier.decorator';

@ThrottleTier('gameplay')
@Controller('travel')
export class TravelController {
  constructor(private travelService: TravelService) {}

  /**
   * POST /api/travel/move
   * Step one cell in a cardinal direction.
   * Travel takes real-world time based on terrain.
   */
  @Post('move')
  move(
    @CurrentUser() user: { id: string },
    @Body() dto: MoveDto,
  ) {
    return this.travelService.move(user.id, dto.direction);
  }

  /**
   * POST /api/travel/go
   * Travel to a specific coordinate. Server pathfinds the route.
   * Travel takes real-world time based on terrain along the path.
   */
  @Post('go')
  travel(
    @CurrentUser() user: { id: string },
    @Body() dto: TravelDto,
  ) {
    return this.travelService.travel(user.id, dto.x, dto.y);
  }

  /**
   * GET /api/travel/status
   * Get current travel progress. Resolves travel if ETA has passed.
   */
  @Get('status')
  getStatus(@CurrentUser() user: { id: string }) {
    return this.travelService.getStatus(user.id);
  }

  /**
   * POST /api/travel/cancel
   * Cancel active travel. Player lands at the furthest cell reached so far.
   */
  @Post('cancel')
  cancel(@CurrentUser() user: { id: string }) {
    return this.travelService.cancel(user.id);
  }
}
