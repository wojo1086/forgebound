import { Module, forwardRef } from '@nestjs/common';
import { CraftingController } from './crafting.controller';
import { CraftingService } from './crafting.service';
import { MapModule } from '../map/map.module';
import { InventoryModule } from '../inventory/inventory.module';
import { QuestModule } from '../quests/quest.module';

@Module({
  imports: [
    MapModule,
    InventoryModule,
    forwardRef(() => QuestModule),
  ],
  controllers: [CraftingController],
  providers: [CraftingService],
  exports: [CraftingService],
})
export class CraftingModule {}
