import { Body, Controller, Get, Post } from '@nestjs/common';
import { SpellsService } from './spells.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ThrottleTier } from '../common/decorators/throttle-tier.decorator';
import { LearnSpellDto } from './dto/learn-spell.dto';
import { CastSpellDto } from './dto/cast-spell.dto';

@Controller('spells')
@ThrottleTier('gameplay')
export class SpellsController {
  constructor(private spellsService: SpellsService) {}

  @Get()
  getSpellbook(@CurrentUser() user: { id: string }) {
    return this.spellsService.getSpellbook(user.id);
  }

  @Post('learn')
  learnSpell(@CurrentUser() user: { id: string }, @Body() dto: LearnSpellDto) {
    return this.spellsService.learnSpell(user.id, dto.spellId);
  }

  @Post('cast')
  castSpell(@CurrentUser() user: { id: string }, @Body() dto: CastSpellDto) {
    return this.spellsService.castSpell(user.id, dto.spellId);
  }
}
