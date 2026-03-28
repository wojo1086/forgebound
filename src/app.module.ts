import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { join } from 'path';
import { SupabaseModule } from './supabase/supabase.module';
import { AuthModule } from './auth/auth.module';
import { CharactersModule } from './characters/characters.module';
import { GameDataModule } from './game-data/game-data.module';
import { MapModule } from './map/map.module';
import { TravelModule } from './travel/travel.module';
import { InventoryModule } from './inventory/inventory.module';
import { SpellsModule } from './spells/spells.module';
import { RestModule } from './rest/rest.module';
import { DatabaseModule } from './database/database.module';
import { SupabaseAuthGuard } from './auth/auth.guard';
import { ForgeboundThrottlerGuard } from './common/guards/throttler.guard';
import { AppController } from './app.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', '..', 'public'),
      exclude: ['/api/{*path}'],
    }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 60 }]),
    DatabaseModule,
    SupabaseModule,
    AuthModule,
    CharactersModule,
    GameDataModule,
    MapModule,
    TravelModule,
    InventoryModule,
    SpellsModule,
    RestModule,
  ],
  controllers: [AppController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: SupabaseAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: ForgeboundThrottlerGuard,
    },
  ],
})
export class AppModule {}
