import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { InfraModule } from './infra/infra.module';
import { AdminModule } from './modules/admin/admin.module';
import { AuthModule } from './modules/auth/auth.module';
import { DriversModule } from './modules/drivers/drivers.module';
import { HealthModule } from './modules/health/health.module';
import { PlacesModule } from './modules/places/places.module';
import { RoutingModule } from './modules/routing/routing.module';
import { TripsModule } from './modules/trips/trips.module';
import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [
    ConfigModule, DatabaseModule, InfraModule, AuthModule, UsersModule, AdminModule, HealthModule, PlacesModule,
    RoutingModule, DriversModule, TripsModule,
  ],
})
export class AppModule {}
