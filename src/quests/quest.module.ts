import { Module, forwardRef } from '@nestjs/common';
import { QuestController } from './quest.controller';
import { QuestService } from './quest.service';
import { InventoryModule } from '../inventory/inventory.module';
import { LevelingModule } from '../leveling/leveling.module';
import { MapModule } from '../map/map.module';
import { CombatModule } from '../combat/combat.module';
import { DungeonModule } from '../dungeons/dungeon.module';
import { TravelModule } from '../travel/travel.module';
import { GatheringModule } from '../gathering/gathering.module';
import { CraftingModule } from '../crafting/crafting.module';

@Module({
  imports: [
    InventoryModule,
    LevelingModule,
    MapModule,
    forwardRef(() => CombatModule),
    forwardRef(() => DungeonModule),
    forwardRef(() => TravelModule),
    forwardRef(() => GatheringModule),
    forwardRef(() => CraftingModule),
  ],
  controllers: [QuestController],
  providers: [QuestService],
  exports: [QuestService],
})
export class QuestModule {}
