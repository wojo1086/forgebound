import { Module, forwardRef } from '@nestjs/common';
import { CombatController } from './combat.controller';
import { CombatService } from './combat.service';
import { MapModule } from '../map/map.module';
import { InventoryModule } from '../inventory/inventory.module';
import { LevelingModule } from '../leveling/leveling.module';
import { DungeonModule } from '../dungeons/dungeon.module';

@Module({
  imports: [
    MapModule,
    InventoryModule,
    LevelingModule,
    forwardRef(() => DungeonModule),
  ],
  controllers: [CombatController],
  providers: [CombatService],
  exports: [CombatService],
})
export class CombatModule {}
