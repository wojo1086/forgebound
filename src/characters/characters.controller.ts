import { Body, Controller, Get, Post } from '@nestjs/common';
import { CharactersService } from './characters.service';
import { CreateCharacterDto } from './dto/create-character.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { TravelService } from '../travel/travel.service';

@Controller('characters')
export class CharactersController {
  constructor(
    private charactersService: CharactersService,
    private travelService: TravelService,
  ) {}

  /**
   * GET /api/characters/me
   * Returns the authenticated player's character with travel status.
   */
  @Get('me')
  async getMe(@CurrentUser() user: { id: string }) {
    return this.travelService.getMe(user.id);
  }

  @Post()
  create(
    @CurrentUser() user: { id: string },
    @Body() dto: CreateCharacterDto,
  ) {
    return this.charactersService.create(user.id, dto);
  }
}
