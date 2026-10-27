import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './modules/health/health.module';
import { PlacesModule } from './modules/places/places.module';

@Module({
  imports: [ConfigModule, DatabaseModule, HealthModule, PlacesModule],
})
export class AppModule {}
