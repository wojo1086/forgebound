import { Body, Controller, Get, Post } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ThrottleTier } from '../common/decorators/throttle-tier.decorator';
import { PickUpItemDto } from './dto/pick-up-item.dto';
import { DropItemDto } from './dto/drop-item.dto';
import { EquipItemDto } from './dto/equip-item.dto';
import { UnequipItemDto } from './dto/unequip-item.dto';
import { UseItemDto } from './dto/use-item.dto';

@ThrottleTier('gameplay')
@Controller('inventory')
export class InventoryController {
  constructor(private inventoryService: InventoryService) {}

  @Get()
  getInventory(@CurrentUser() user: { id: string }) {
    return this.inventoryService.getInventory(user.id);
  }

  @Get('ground')
  getGroundItems(@CurrentUser() user: { id: string }) {
    return this.inventoryService.getGroundItemsHere(user.id);
  }

  @Post('pick-up')
  pickUp(@CurrentUser() user: { id: string }, @Body() dto: PickUpItemDto) {
    return this.inventoryService.pickUp(user.id, dto);
  }

  @Post('drop')
  drop(@CurrentUser() user: { id: string }, @Body() dto: DropItemDto) {
    return this.inventoryService.drop(user.id, dto);
  }

  @Post('equip')
  equip(@CurrentUser() user: { id: string }, @Body() dto: EquipItemDto) {
    return this.inventoryService.equip(user.id, dto);
  }

  @Post('unequip')
  unequip(@CurrentUser() user: { id: string }, @Body() dto: UnequipItemDto) {
    return this.inventoryService.unequip(user.id, dto);
  }

  @Post('use')
  useItem(@CurrentUser() user: { id: string }, @Body() dto: UseItemDto) {
    return this.inventoryService.useItem(user.id, dto);
  }
}
