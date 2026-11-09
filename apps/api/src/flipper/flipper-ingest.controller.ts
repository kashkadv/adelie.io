import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Controller, Get, Options, Post, Req, Res } from '@nestjs/common';
import type { Prisma } from '@adelie/db';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';
import type { Request, Response } from 'express';
import { config } from '../config.js';
import { PrismaService } from '../prisma.service.js';
import {
  dailyId,
  deviceOf,
  isBot,
  MAX_BODY_BYTES,
  parseBatch,
  RateLimiter,
  visitOf,
} from './ingest.js';

const bare = (host: string) => host.replace(/^www\./, '').toLowerCase();

const hostOfHeader = (value: unknown): string | null => {
  try {
    return typeof value === 'string' && value ? bare(new URL(value).hostname) : null;
  } catch {
    return null;
  }
};

/** The body of a request, or null when it is larger than `limit` bytes. */
function readBody(req: Request, limit: number): Promise<string | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        resolve(null);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => resolve(null));
  });
}

/** The visitor's address, as Cloudflare passes it on. Used for the limits and the daily hash only. */
const clientIp = (req: Request): string =>
  String(req.headers['cf-connecting-ip'] ?? '').trim() ||
  String(req.headers['x-forwarded-for'] ?? '')
    .split(',')[0]!
    .trim() ||
  req.socket.remoteAddress ||
  '';

/**
 * Flipper's public face (ADR-0022): the script and the Events API. Nothing here has a session — the
 * site id in the install snippet only names the site. What stands between the open address and
 * the database: a strict parser, limits, the site's allowed hosts, and a daily hash instead of
 * any stored address. Unknown sites and foreign hosts get no answer that tells them so.
 */
@Controller()
@AllowAnonymous()
export class FlipperIngestController {
  private script: { body: string; etag: string } | undefined;
  /** What each site id means, kept for a minute: the address is hit by every page view. */
  private readonly sites = new Map<
    string,
    { id: string; hosts: string[]; mode: string; until: number } | null
  >();
  private readonly perVisitor = new RateLimiter(120, 60_000);
  private readonly perSite = new RateLimiter(6_000, 60_000);
  private readonly secret = createHash('sha256')
    .update(`flipper:${config.auth.secret}`)
    .digest('hex');

  constructor(private readonly prisma: PrismaService) {}

  private loadScript() {
    if (!this.script) {
      const path = createRequire(import.meta.url).resolve('@adelie/tracker');
      const body = readFileSync(path, 'utf8');
      this.script = {
        body,
        etag: `"${createHash('sha1').update(body).digest('hex').slice(0, 16)}"`,
      };
    }
    return this.script;
  }

  /** The tracker script. Cached for a few minutes at the edge: a new version reaches sites soon. */
  @Get('flipper.js')
  async serve(@Req() req: Request, @Res() res: Response) {
    const loaded = this.loadScript();
    // With ?site=… the script carries that site's settings (today: the consent mode). Anything
    // else, an unknown id included, gets the plain script: the page's own attributes decide.
    const id = typeof req.query.site === 'string' ? req.query.site : '';
    const site = /^fl_[A-Za-z0-9]{6,40}$/.test(id) ? await this.siteOf(id) : null;
    const prefix = site?.mode === 'granted' ? 'window.__flipperConfig={consent:"granted"};' : '';
    const body = prefix + loaded.body;
    const etag = prefix
      ? `"${createHash('sha1').update(body).digest('hex').slice(0, 16)}"`
      : loaded.etag;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600');
    res.setHeader('ETag', etag);
    if (req.headers['if-none-match'] === etag) return res.status(304).end();
    res.type('application/javascript; charset=utf-8');
    return res.status(200).send(body);
  }

  @Options('collect')
  preflight(@Res() res: Response) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
    res.setHeader('Access-Control-Max-Age', '86400');
    return res.status(204).end();
  }

  private async siteOf(publicId: string) {
    const now = Date.now();
    const known = this.sites.get(publicId);
    if (known !== undefined && (known === null || known.until > now)) return known;
    const row = await this.prisma.client.trackedSite.findUnique({
      where: { publicId },
      select: { id: true, allowedHosts: true, consentMode: true },
    });
    const site = row
      ? {
          id: row.id,
          hosts: row.allowedHosts.map(bare),
          mode: row.consentMode,
          until: now + 60_000,
        }
      : null;
    // An unknown id is remembered for a minute too, so guessing ids does not reach the database.
    this.sites.set(publicId, site);
    if (this.sites.size > 5_000) this.sites.clear();
    return site;
  }

  @Post('collect')
  async collect(@Req() req: Request, @Res() res: Response) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-store');
    const body = await readBody(req, MAX_BODY_BYTES);
    if (body === null) return res.status(413).end();
    const batch = parseBatch(body);
    if (!batch) return res.status(400).end();

    const site = await this.siteOf(batch.siteId);
    // Unknown site, or a page of another host: accepted and forgotten, no hint either way.
    if (!site) return res.status(204).end();
    const from = hostOfHeader(req.headers.origin) ?? hostOfHeader(req.headers.referer);
    if (from && !site.hosts.includes(from)) return res.status(204).end();
    const events = batch.events.filter((e) => site.hosts.includes(e.host));
    if (!events.length) return res.status(204).end();

    const ip = clientIp(req);
    const userAgent = String(req.headers['user-agent'] ?? '');
    const key = `${site.id}|${createHash('sha1').update(ip).digest('hex').slice(0, 12)}`;
    if (!this.perSite.allow(site.id) || !this.perVisitor.allow(key)) return res.status(429).end();

    const day = new Date().toISOString().slice(0, 10);
    const daily = batch.consent ? null : dailyId(this.secret, day, site.id, ip, userAgent);
    const bot = isBot(userAgent);
    const device = deviceOf(userAgent);
    await this.prisma.client.websiteEvent.createMany({
      data: events.map((e) => {
        const visit = visitOf(batch, e);
        return {
          siteId: site.id,
          eventId: e.eventId,
          name: e.name,
          occurredAt: e.occurredAt,
          consent: batch.consent,
          visitorId: batch.visitorId,
          sessionId: batch.sessionId,
          dailyId: daily,
          url: e.url,
          title: e.title,
          referrerHost: visit?.referrerHost ?? null,
          source: visit?.source ?? null,
          medium: visit?.medium ?? null,
          campaign: visit?.campaign ?? null,
          content: visit?.content ?? null,
          term: visit?.term ?? null,
          clickIdType: visit?.clickIdType ?? null,
          channel: visit?.channel ?? null,
          device,
          isBot: bot,
          ...(e.properties ? { properties: e.properties as unknown as Prisma.InputJsonValue } : {}),
        };
      }),
      skipDuplicates: true,
    });
    return res.status(204).end();
  }
}
