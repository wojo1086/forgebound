import { Body, Controller, Post } from '@nestjs/common';
import { CharactersService } from './characters.service';
import { CreateCharacterDto } from './dto/create-character.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('characters')
export class CharactersController {
  constructor(private charactersService: CharactersService) {}

  @Post()
  create(
    @CurrentUser() user: { id: string },
    @Body() dto: CreateCharacterDto,
  ) {
    return this.charactersService.create(user.id, dto);
  }
}
