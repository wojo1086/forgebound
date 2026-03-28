import { Module } from '@nestjs/common';
import { CombatController } from './combat.controller';
import { CombatService } from './combat.service';
import { MapModule } from '../map/map.module';
import { InventoryModule } from '../inventory/inventory.module';
import { LevelingModule } from '../leveling/leveling.module';

@Module({
  imports: [MapModule, InventoryModule, LevelingModule],
  controllers: [CombatController],
  providers: [CombatService],
  exports: [CombatService],
})
export class CombatModule {}
