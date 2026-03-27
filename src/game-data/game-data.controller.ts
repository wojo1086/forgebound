import { Controller, Get } from '@nestjs/common';
import { GameDataService } from './game-data.service';
import { Public } from '../common/decorators/public.decorator';

@Controller('game')
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
}
