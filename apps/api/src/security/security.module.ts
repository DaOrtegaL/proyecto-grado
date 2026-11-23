import { Module } from '@nestjs/common';
import { AnomalyService } from './anomaly.service';
import { SecurityController } from './security.controller';

@Module({
  controllers: [SecurityController],
  providers: [AnomalyService],
  exports: [AnomalyService],
})
export class SecurityModule {}
