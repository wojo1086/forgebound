import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import { MapService } from './map.service';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ThrottleTier } from '../common/decorators/throttle-tier.decorator';

@Controller('map')
@ThrottleTier('public')
export class MapController {
  constructor(private mapService: MapService) {}

  /**
   * GET /api/map
   * Returns the full terrain grid + all visible POIs.
   * If authenticated, also includes your discovered hidden POIs.
   */
  @Public()
  @Get()
  getWorldMap(@CurrentUser() user?: { id: string }) {
    return this.mapService.getWorldMap(user?.id);
  }

  /**
   * GET /api/map/regions
   * Returns all named regions with their boundaries.
   */
  @Public()
  @Get('regions')
  getRegions() {
    return this.mapService.getRegions();
  }

  /**
   * GET /api/map/cell/:x/:y
   * Returns details about a specific cell.
   */
  @Public()
  @Get('cell/:x/:y')
  getCellInfo(
    @Param('x', ParseIntPipe) x: number,
    @Param('y', ParseIntPipe) y: number,
    @CurrentUser() user?: { id: string },
  ) {
    return this.mapService.getCellInfo(x, y, user?.id);
  }
}
