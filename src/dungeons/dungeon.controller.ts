import { Body, Controller, Get, Post } from '@nestjs/common';
import { DungeonService } from './dungeon.service';
import { EnterDungeonDto } from './dto/enter-dungeon.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ThrottleTier } from '../common/decorators/throttle-tier.decorator';

@Controller('dungeons')
export class DungeonController {
  constructor(private readonly dungeonService: DungeonService) {}

  @ThrottleTier('gameplay')
  @Get('status')
  getStatus(@CurrentUser() user: { id: string }) {
    return this.dungeonService.getDungeonStatus(user.id);
  }

  @ThrottleTier('gameplay')
  @Post('enter')
  enter(
    @CurrentUser() user: { id: string },
    @Body() dto: EnterDungeonDto,
  ) {
    return this.dungeonService.enterDungeon(user.id, dto.poiId);
  }

  @ThrottleTier('gameplay')
  @Post('advance')
  advance(@CurrentUser() user: { id: string }) {
    return this.dungeonService.advanceRoom(user.id);
  }

  @ThrottleTier('gameplay')
  @Post('leave')
  leave(@CurrentUser() user: { id: string }) {
    return this.dungeonService.leaveDungeon(user.id);
  }
}
