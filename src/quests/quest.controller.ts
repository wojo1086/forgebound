import { Controller, Get, Post, Body } from '@nestjs/common';
import { QuestService } from './quest.service';
import { AcceptQuestDto } from './dto/accept-quest.dto';
import { TurnInQuestDto } from './dto/turn-in-quest.dto';
import { AbandonQuestDto } from './dto/abandon-quest.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ThrottleTier } from '../common/decorators/throttle-tier.decorator';

@Controller('quests')
export class QuestController {
  constructor(private readonly questService: QuestService) {}

  @ThrottleTier('gameplay')
  @Get('available')
  getAvailable(@CurrentUser() user: { id: string }) {
    return this.questService.getAvailableQuests(user.id);
  }

  @ThrottleTier('gameplay')
  @Get('active')
  getActive(@CurrentUser() user: { id: string }) {
    return this.questService.getActiveQuests(user.id);
  }

  @ThrottleTier('gameplay')
  @Post('accept')
  accept(
    @CurrentUser() user: { id: string },
    @Body() dto: AcceptQuestDto,
  ) {
    return this.questService.acceptQuest(user.id, dto.questId);
  }

  @ThrottleTier('gameplay')
  @Post('turn-in')
  turnIn(
    @CurrentUser() user: { id: string },
    @Body() dto: TurnInQuestDto,
  ) {
    return this.questService.turnInQuest(user.id, dto.questId);
  }

  @ThrottleTier('gameplay')
  @Post('abandon')
  abandon(
    @CurrentUser() user: { id: string },
    @Body() dto: AbandonQuestDto,
  ) {
    return this.questService.abandonQuest(user.id, dto.questId);
  }
}
