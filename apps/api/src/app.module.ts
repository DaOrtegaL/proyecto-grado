import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { AuthGuard } from './auth/auth.guard';
import { InventoryModule } from './inventory/inventory.module';
import { AlertsModule } from './alerts/alerts.module';
import { OperationsModule } from './operations.module';
import { DashboardController } from './dashboard/dashboard.controller';
import { HealthController } from './health.controller';
import { AllExceptionsFilter } from './common/http-exception.filter';
import { correlationMiddleware } from './common/correlation.middleware';
import { loadEnv } from './config/env';

@Module({
  imports: [
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: () => loadEnv().RATE_LIMIT_PER_MIN }]),
    PrismaModule,
    AuditModule,
    AuthModule,
    AlertsModule,
    InventoryModule,
    OperationsModule,
  ],
  controllers: [DashboardController, HealthController],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // Orden: primero la limitación de tasa y después autenticación/autorización.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(correlationMiddleware).forRoutes('*');
  }
}
