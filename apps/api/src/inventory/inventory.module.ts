import { Module } from '@nestjs/common';
import { AlertsModule } from '../alerts/alerts.module';
import { SecurityModule } from '../security/security.module';
import {
  AgentGatewayController, AgentGatewayService, AgentsController,
} from '../security/security.controller';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { CertificatesService } from './certificates.service';
import { GeoService } from './geo.service';
import { EvidenceService } from './evidence.service';

@Module({
  imports: [AlertsModule, SecurityModule],
  controllers: [InventoryController, AgentGatewayController, AgentsController],
  providers: [InventoryService, CertificatesService, GeoService, EvidenceService, AgentGatewayService],
  exports: [InventoryService, AgentGatewayService],
})
export class InventoryModule {}
