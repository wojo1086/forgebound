import { Module } from '@nestjs/common';
import { TravelController } from './travel.controller';
import { TravelService } from './travel.service';
import { MapModule } from '../map/map.module';
import { InventoryModule } from '../inventory/inventory.module';

@Module({
  imports: [MapModule, InventoryModule],
  controllers: [TravelController],
  providers: [TravelService],
  exports: [TravelService],
})
export class TravelModule {}
