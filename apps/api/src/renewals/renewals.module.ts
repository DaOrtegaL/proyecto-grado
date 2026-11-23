import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { RenewalsService } from './renewals.service';
import { DeploymentsService } from './deployments.service';
import { ApprovalsController, DeploymentsController, RenewalsController } from './renewals.controller';

@Module({
  imports: [InventoryModule],
  controllers: [RenewalsController, ApprovalsController, DeploymentsController],
  providers: [RenewalsService, DeploymentsService],
  exports: [RenewalsService, DeploymentsService],
})
export class RenewalsModule {}
