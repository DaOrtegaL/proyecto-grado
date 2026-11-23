import { Module } from '@nestjs/common';
import { AlertsModule } from './alerts/alerts.module';
import { InventoryModule } from './inventory/inventory.module';
import { SecurityModule } from './security/security.module';
import { RenewalsModule } from './renewals/renewals.module';
import { ResearchModule } from './research/research.module';
import { AdminController } from './admin/admin.controller';
import { OwnersController, OwnersService } from './owners/owners.controller';
import { MonitoringController, MonitoringService } from './monitoring/monitoring.service';
import { SimulatorController, SimulatorService } from './simulator/simulator.service';

/** Agrupa los módulos de operación posteriores al inventario (fases 3 a 5). */
@Module({
  imports: [AlertsModule, InventoryModule, SecurityModule, RenewalsModule, ResearchModule],
  controllers: [AdminController, OwnersController, MonitoringController, SimulatorController],
  providers: [OwnersService, MonitoringService, SimulatorService],
})
export class OperationsModule {}
