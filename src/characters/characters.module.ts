import { Module } from '@nestjs/common';
import { CharactersController } from './characters.controller';
import { CharactersService } from './characters.service';
import { TravelModule } from '../travel/travel.module';
import { InventoryModule } from '../inventory/inventory.module';

@Module({
  imports: [TravelModule, InventoryModule],
  controllers: [CharactersController],
  providers: [CharactersService],
})
export class CharactersModule {}
