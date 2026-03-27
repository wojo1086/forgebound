import { Module } from '@nestjs/common';
import { DatabaseBootstrap } from './database.bootstrap';

@Module({
  providers: [DatabaseBootstrap],
})
export class DatabaseModule {}
