import { Module } from '@nestjs/common';
import { CharactersController } from './characters.controller';
import { CharactersService } from './characters.service';
import { TravelModule } from '../travel/travel.module';

@Module({
  imports: [TravelModule],
  controllers: [CharactersController],
  providers: [CharactersService],
})
export class CharactersModule {}
