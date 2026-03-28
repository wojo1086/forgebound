import { Module } from '@nestjs/common';
import { LevelingService } from './leveling.service';
import { SpellsModule } from '../spells/spells.module';

@Module({
  imports: [SpellsModule],
  providers: [LevelingService],
  exports: [LevelingService],
})
export class LevelingModule {}
