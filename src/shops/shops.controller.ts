import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ShopsService } from './shops.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ThrottleTier } from '../common/decorators/throttle-tier.decorator';
import { BuyItemDto } from './dto/buy-item.dto';
import { SellItemDto } from './dto/sell-item.dto';

@Controller('shops')
@ThrottleTier('gameplay')
export class ShopsController {
  constructor(private shopsService: ShopsService) {}

  @Get(':townId')
  getShop(
    @CurrentUser() user: { id: string },
    @Param('townId') townId: string,
  ) {
    return this.shopsService.getShop(user.id, townId);
  }

  @Post(':townId/buy')
  buyItem(
    @CurrentUser() user: { id: string },
    @Param('townId') townId: string,
    @Body() dto: BuyItemDto,
  ) {
    return this.shopsService.buyItem(user.id, townId, dto.itemId, dto.quantity);
  }

  @Post(':townId/sell')
  sellItem(
    @CurrentUser() user: { id: string },
    @Param('townId') townId: string,
    @Body() dto: SellItemDto,
  ) {
    return this.shopsService.sellItem(user.id, townId, dto.itemId, dto.quantity);
  }
}
