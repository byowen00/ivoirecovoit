import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { latitude, longitude } from '../../common/geo';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { RateLimitService } from '../../infra/rate-limit.service';
import { CurrentAuth } from '../auth/decorators';
import type { AuthContext } from '../auth/request-context';
import { RoutingService } from './routing.service';

const estimateSchema = z.object({
  points: z.array(z.tuple([latitude, longitude])).min(2, 'Au moins deux points.').max(7, 'Sept points au maximum.'),
  kind: z.enum(['URBAN', 'INTERCITY']).default('INTERCITY'),
});
type EstimateInput = z.infer<typeof estimateSchema>;

@ApiTags('routage')
@ApiBearerAuth()
@Controller('routing')
export class RoutingController {
  constructor(
    private readonly routing: RoutingService,
    private readonly rateLimit: RateLimitService,
  ) {}

  @Post('estimate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Distance et durée ESTIMÉES d’un itinéraire (OSRM, ou repli à vol d’oiseau)' })
  async estimate(@CurrentAuth() auth: AuthContext, @Body(new ZodValidationPipe(estimateSchema)) body: EstimateInput) {
    await this.rateLimit.consumeOrThrow([{ key: `routing:${auth.userId}`, limit: 120, windowS: 3600 }]);
    return this.routing.estimate(body.points.map(([lat, lng]) => ({ lat, lng })), body.kind);
  }
}
