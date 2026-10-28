import { Module } from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { DriversController } from './drivers.controller';
import { DriversService } from './drivers.service';
import { VehiclesController } from './vehicles.controller';
import { VehiclesService } from './vehicles.service';

@Module({
  controllers: [DriversController, VehiclesController],
  providers: [DriversService, VehiclesService, DocumentsService],
  exports: [DriversService, VehiclesService, DocumentsService],
})
export class DriversModule {}
