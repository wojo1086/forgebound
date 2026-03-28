import { Module } from '@nestjs/common';
import { ShopsController } from './shops.controller';
import { ShopsService } from './shops.service';
import { MapModule } from '../map/map.module';
import { InventoryModule } from '../inventory/inventory.module';

@Module({
  imports: [MapModule, InventoryModule],
  controllers: [ShopsController],
  providers: [ShopsService],
  exports: [ShopsService],
})
export class ShopsModule {}
