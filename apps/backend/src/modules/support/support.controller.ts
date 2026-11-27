import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { CurrentAuth, StaffOnly } from '../auth/decorators';
import type { AuthContext } from '../auth/request-context';
import { newTicketSchema, supportListQuery, supportMessageSchema, SupportService } from './support.service';

@ApiTags('assistance')
@ApiBearerAuth()
@Controller('support/tickets')
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Get()
  @ApiOperation({ summary: 'Mes demandes d’assistance' })
  mine(@CurrentAuth() auth: AuthContext) {
    return this.support.mine(auth.userId);
  }

  @Post()
  @ApiOperation({ summary: 'Nouvelle demande : sujet, thème et premier message' })
  open(@CurrentAuth() auth: AuthContext, @Body(new ZodValidationPipe(newTicketSchema)) body: z.infer<typeof newTicketSchema>) {
    return this.support.open(auth.userId, body);
  }

  @Get(':id')
  view(@CurrentAuth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.support.view(id, { userId: auth.userId });
  }

  @Post(':id/messages')
  reply(@CurrentAuth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string,
        @Body(new ZodValidationPipe(supportMessageSchema)) body: z.infer<typeof supportMessageSchema>) {
    return this.support.reply(id, auth.userId, body.body, false);
  }
}

/** File d'assistance de l'équipe (même droit que les réclamations). */
@ApiTags('administration')
@ApiBearerAuth()
@Controller('admin/support')
export class AdminSupportController {
  constructor(private readonly support: SupportService) {}

  @StaffOnly('disputes.manage')
  @Get()
  queue(@Query(new ZodValidationPipe(supportListQuery)) q: z.infer<typeof supportListQuery>) {
    return this.support.queue(q);
  }

  @StaffOnly('disputes.manage')
  @Get(':id')
  view(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.support.view(id, { staff: true });
  }

  @StaffOnly('disputes.manage')
  @Post(':id/messages')
  reply(@CurrentAuth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string,
        @Body(new ZodValidationPipe(supportMessageSchema)) body: z.infer<typeof supportMessageSchema>) {
    return this.support.reply(id, auth.userId, body.body, true);
  }

  @StaffOnly('disputes.manage')
  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  close(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.support.close(id);
  }
}
