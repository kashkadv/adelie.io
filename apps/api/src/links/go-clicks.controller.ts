import { Body, Controller, HttpCode, Post, Req, UnauthorizedException } from '@nestjs/common';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';
import type { Request } from 'express';
import { config } from '../config.js';
import { PrismaService } from '../prisma.service.js';
import { parseClick, secretMatches } from './clicks.js';

/**
 * Clicks on short links, reported by the go.adelie.space Worker (ADR-0027) with the shared secret.
 * The redirect has already happened: an answer here changes nothing for the person who clicked.
 */
@Controller('go')
@AllowAnonymous()
export class GoClicksController {
  constructor(private readonly prisma: PrismaService) {}

  @Post('clicks')
  @HttpCode(204)
  async click(@Req() req: Request, @Body() body: unknown) {
    if (!secretMatches(req.headers.authorization, config.goClickSecret)) {
      throw new UnauthorizedException();
    }
    const click = parseClick(body);
    if (!click) return;
    const link = await this.prisma.client.trackedLink.findUnique({
      where: { code: click.code },
      select: { id: true },
    });
    if (!link) return;
    await this.prisma.client.linkClick.create({
      data: {
        linkId: link.id,
        occurredAt: click.occurredAt,
        referrerHost: click.referrerHost,
        country: click.country,
        device: click.device,
        isBot: click.isBot,
      },
    });
  }
}
