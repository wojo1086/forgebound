import { Body, Controller, Get, Post } from '@nestjs/common';
import { GatheringService } from './gathering.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ThrottleTier } from '../common/decorators/throttle-tier.decorator';
import { HarvestDto } from './dto/harvest.dto';

@ThrottleTier('gameplay')
@Controller('gathering')
export class GatheringController {
  constructor(private gatheringService: GatheringService) {}

  @Get('skills')
  getSkills(@CurrentUser() user: { id: string }) {
    return this.gatheringService.getSkills(user.id);
  }

  @Get('nodes')
  getNearbyNodes(@CurrentUser() user: { id: string }) {
    return this.gatheringService.getNearbyNodes(user.id);
  }

  @Post('harvest')
  harvest(@CurrentUser() user: { id: string }, @Body() dto: HarvestDto) {
    return this.gatheringService.harvest(user.id, dto);
  }
}
