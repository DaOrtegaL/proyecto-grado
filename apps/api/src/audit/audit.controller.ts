import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { listAuditQuerySchema } from '@msh/validation';
import { AuditService } from './audit.service';
import { RequirePermissions } from '../common/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';

@ApiTags('Auditoría')
@ApiBearerAuth()
@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequirePermissions('audit:read')
  list(@Query(new ZodValidationPipe(listAuditQuerySchema)) query: ReturnType<typeof listAuditQuerySchema.parse>) {
    return this.audit.list(query);
  }

  /** Verifica el encadenamiento criptográfico completo de la bitácora. */
  @Get('verify')
  @RequirePermissions('audit:verify')
  verify() {
    return this.audit.verify();
  }
}
