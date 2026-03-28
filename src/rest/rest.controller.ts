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
  startCamp(@CurrentUser() userId: string, @Body() dto: StartCampDto) {
    return this.restService.startCamp(userId, dto.duration);
  }

  @Post('inn')
  restAtInn(@CurrentUser() userId: string) {
    return this.restService.restAtInn(userId);
  }

  @Get('status')
  getStatus(@CurrentUser() userId: string) {
    return this.restService.getStatus(userId);
  }

  @Post('stop')
  stopRest(@CurrentUser() userId: string) {
    return this.restService.stopRest(userId);
  }
}
