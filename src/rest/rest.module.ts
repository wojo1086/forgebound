import { Module } from '@nestjs/common';
import { RestController } from './rest.controller';
import { RestService } from './rest.service';
import { MapModule } from '../map/map.module';

@Module({
  imports: [MapModule],
  controllers: [RestController],
  providers: [RestService],
  exports: [RestService],
})
export class RestModule {}
