import { Module, forwardRef } from '@nestjs/common';
import { DungeonController } from './dungeon.controller';
import { DungeonService } from './dungeon.service';
import { CombatModule } from '../combat/combat.module';
import { InventoryModule } from '../inventory/inventory.module';
import { LevelingModule } from '../leveling/leveling.module';

@Module({
  imports: [forwardRef(() => CombatModule), InventoryModule, LevelingModule],
  controllers: [DungeonController],
  providers: [DungeonService],
  exports: [DungeonService],
})
export class DungeonModule {}
