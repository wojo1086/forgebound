import { Controller, Get } from '@nestjs/common';
import { Public } from './common/decorators/public.decorator';
import { ThrottleTier } from './common/decorators/throttle-tier.decorator';

@Controller()
@ThrottleTier('public')
export class AppController {
  @Public()
  @Get()
  getWelcome() {
    return {
      name: 'Forgebound API',
      version: '0.1.0',
      endpoints: {
        auth: {
          register: 'POST /api/auth/register',
          login: 'POST /api/auth/login',
          me: 'GET /api/auth/me',
        },
        gameData: {
          races: 'GET /api/game/races',
          classes: 'GET /api/game/classes',
        },
        characters: {
          create: 'POST /api/characters',
        },
      },
    };
  }
}
