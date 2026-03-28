import { Controller, Get } from '@nestjs/common';
import { GameDataService } from './game-data.service';
import { Public } from '../common/decorators/public.decorator';
import { ThrottleTier } from '../common/decorators/throttle-tier.decorator';

@Controller('game')
@ThrottleTier('public')
export class GameDataController {
  constructor(private gameDataService: GameDataService) {}

  @Public()
  @Get('races')
  getRaces() {
    return this.gameDataService.getRaces();
  }

  @Public()
  @Get('classes')
  getClasses() {
    return this.gameDataService.getClasses();
  }

  @Public()
  @Get('items')
  getItems() {
    return this.gameDataService.getItems();
  }

  @Public()
  @Get('spells')
  getSpells() {
    return this.gameDataService.getSpells();
  }
}
