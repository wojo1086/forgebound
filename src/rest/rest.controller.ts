import { Body, Controller, Get, Post } from '@nestjs/common';
import { RestService } from './rest.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ThrottleTier } from '../common/decorators/throttle-tier.decorator';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

class StartCampDto {
  @IsOptional()
  @IsInt()
  @Min(10)
  @Max(600)
  duration?: number;
}

@Controller('rest')
@ThrottleTier('gameplay')
export class RestController {
  constructor(private restService: RestService) {}

  @Post('camp')
  startCamp(@CurrentUser() user: { id: string }, @Body() dto: StartCampDto) {
    return this.restService.startCamp(user.id, dto.duration);
  }

  @Post('inn')
  restAtInn(@CurrentUser() user: { id: string }) {
    return this.restService.restAtInn(user.id);
  }

  @Get('status')
  getStatus(@CurrentUser() user: { id: string }) {
    return this.restService.getStatus(user.id);
  }

  @Post('stop')
  stopRest(@CurrentUser() user: { id: string }) {
    return this.restService.stopRest(user.id);
  }
}
