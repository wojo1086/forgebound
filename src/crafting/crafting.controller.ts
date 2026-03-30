import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { CraftingService } from './crafting.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ThrottleTier } from '../common/decorators/throttle-tier.decorator';
import { CraftDto } from './dto/craft.dto';

@ThrottleTier('gameplay')
@Controller('crafting')
export class CraftingController {
  constructor(private craftingService: CraftingService) {}

  @Get('skills')
  getSkills(@CurrentUser() user: { id: string }) {
    return this.craftingService.getSkills(user.id);
  }

  @Get('recipes')
  getRecipes(
    @CurrentUser() user: { id: string },
    @Query('skill') skill?: string,
  ) {
    return this.craftingService.getRecipes(user.id, skill);
  }

  @Get('stations')
  getStations(@CurrentUser() user: { id: string }) {
    return this.craftingService.getStations(user.id);
  }

  @Post('craft')
  craft(@CurrentUser() user: { id: string }, @Body() dto: CraftDto) {
    return this.craftingService.craft(user.id, dto);
  }
}
