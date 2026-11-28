import { Module } from '@nestjs/common';
import { DriversModule } from '../drivers/drivers.module';
import { PaymentsModule } from '../payments/payments.module';
import { PlacesModule } from '../places/places.module';
import { RoutingModule } from '../routing/routing.module';
import { AuthModule } from '../auth/auth.module';
import { LiveLocationService } from './live-location.service';
import { AdminLiveController, LiveMapController, TrafficController } from './live-map.controller';
import { SearchService } from './search.service';
import { TripsController } from './trips.controller';
import { TripsService } from './trips.service';
import { WeatherService } from './weather.service';

@Module({
  imports: [AuthModule, DriversModule, PaymentsModule, PlacesModule, RoutingModule],
  controllers: [TripsController, LiveMapController, TrafficController, AdminLiveController],
  providers: [TripsService, SearchService, LiveLocationService, WeatherService],
  exports: [TripsService],
})
export class TripsModule {}
