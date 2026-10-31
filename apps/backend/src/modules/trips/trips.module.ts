import { Module } from '@nestjs/common';
import { DriversModule } from '../drivers/drivers.module';
import { PaymentsModule } from '../payments/payments.module';
import { PlacesModule } from '../places/places.module';
import { RoutingModule } from '../routing/routing.module';
import { AuthModule } from '../auth/auth.module';
import { LiveLocationService } from './live-location.service';
import { SearchService } from './search.service';
import { TripsController } from './trips.controller';
import { TripsService } from './trips.service';

@Module({
  imports: [AuthModule, DriversModule, PaymentsModule, PlacesModule, RoutingModule],
  controllers: [TripsController],
  providers: [TripsService, SearchService, LiveLocationService],
  exports: [TripsService],
})
export class TripsModule {}
