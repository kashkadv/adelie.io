import {
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import type { SocialPlatform } from '@adelie/db';
import {
  HttpClient,
  PINTEREST_API,
  PinterestAdapter,
  isAdapterError,
  type PlatformAdapter,
} from '@adelie/platforms';
import { socialTokenAad, tokenCipherFromEnv, type TokenCipher } from '@adelie/shared/crypto';
import { Session, type UserSession } from '@thallesp/nestjs-better-auth';
import type { Response } from 'express';
import { config } from '../config.js';
import { PrismaService } from '../prisma.service.js';
import { visibleProjectsWhere } from '../workspaces/project-visibility.js';
import {
  WorkspaceAccessGuard,
  WorkspaceRoles,
  type WorkspaceRequestContext,
} from '../workspaces/workspace-access.guard.js';
import { createState, verifyState } from './oauth-state.js';

/** Roles that may connect accounts (ADR-0007: Owner, Admin, Manager). */
const CONNECT_ROLES = ['OWNER', 'ADMIN', 'MANAGER'] as const;

/** URL path segment → platform. Only Pinterest for now (ADR-0004). */
const PLATFORMS: Record<string, SocialPlatform> = { pinterest: 'PINTEREST' };

/** Outcome of a connect attempt, passed to the web app as ?connect=… on /accounts. */
type ConnectResult = 'connected' | 'denied' | 'expired' | 'alreadyConnected' | 'error';

let cipher: TokenCipher | undefined;
function tokenCipher(): TokenCipher {
  cipher ??= tokenCipherFromEnv();
  return cipher;
}

function adapterFor(slug: string): {
  platform: SocialPlatform;
  adapter: PlatformAdapter;
  http: HttpClient;
} {
  const platform = PLATFORMS[slug];
  if (!platform) throw new NotFoundException();
  if (!config.pinterest) throw new ServiceUnavailableException('Pinterest is not configured');
  return {
    platform,
    adapter: new PinterestAdapter(config.pinterest),
    http: new HttpClient({ baseUrl: PINTEREST_API }),
  };
}

function redirectUri(slug: string): string {
  return `${config.apiUrl}/social/${slug}/callback`;
}

/**
 * Connecting social accounts to a project (ADR-0011). Tokens are stored encrypted
 * (@adelie/shared/crypto) and never leave the API.
 */
@Controller()
export class SocialController {
  constructor(private readonly prisma: PrismaService) {}

  private async visibleProject(ctx: WorkspaceRequestContext, projectId: string) {
    const project = await this.prisma.client.project.findFirst({
      where: { id: projectId, ...visibleProjectsWhere(ctx) },
      select: { id: true },
    });
    if (!project) throw new NotFoundException();
    return project;
  }

  /** Accounts connected to a project, with their connection status. */
  @Get('workspaces/:workspaceId/projects/:projectId/accounts')
  @UseGuards(WorkspaceAccessGuard)
  async list(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Req() request: { workspace: WorkspaceRequestContext },
  ) {
    await this.visibleProject(request.workspace, projectId);
    const accounts = await this.prisma.client.socialAccount.findMany({
      where: { projectId, workspaceId: request.workspace.workspaceId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        platform: true,
        externalId: true,
        username: true,
        displayName: true,
        avatarUrl: true,
        accountType: true,
        followersCount: true,
        postsCount: true,
        collectingSince: true,
        historyAvailableFrom: true,
        lastSuccessfulSyncAt: true,
        connection: { select: { status: true } },
        syncRuns: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { status: true, kind: true, errorCode: true, finishedAt: true },
        },
      },
    });
    return accounts.map(({ connection, syncRuns, ...a }) => ({
      ...a,
      status: connection.status,
      lastSync: syncRuns[0] ?? null,
    }));
  }

  /** Starts OAuth: returns the platform consent URL to send the browser to. */
  @Post('workspaces/:workspaceId/projects/:projectId/connections/:platform')
  @UseGuards(WorkspaceAccessGuard)
  @WorkspaceRoles(...CONNECT_ROLES)
  async start(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('platform') slug: string,
    @Req() request: { workspace: WorkspaceRequestContext },
    @Session() session: UserSession,
  ) {
    const { adapter } = adapterFor(slug);
    await this.visibleProject(request.workspace, projectId);
    const state = createState(
      {
        userId: session.user.id,
        workspaceId: request.workspace.workspaceId,
        projectId,
        platform: slug,
      },
      config.auth.secret,
    );
    return { url: adapter.authorizeUrl(state, redirectUri(slug)) };
  }

  /**
   * OAuth redirect target (PRD §12: GET /social/:platform/callback). Always ends with a redirect
   * back to the web app's Accounts page with the outcome.
   */
  @Get('social/:platform/callback')
  async callback(
    @Param('platform') slug: string,
    @Query() query: Record<string, string | undefined>,
    @Session() session: UserSession,
    @Res() res: Response,
  ) {
    const back = (result: ConnectResult) =>
      res.redirect(
        `${config.webUrl}/accounts?connect=${result}&platform=${encodeURIComponent(slug)}`,
      );

    const state = query['state'] ? verifyState(query['state'], config.auth.secret) : null;
    if (!state || state.platform !== slug || state.userId !== session.user.id)
      return back('expired');
    if (query['error'] || !query['code']) return back('denied');

    try {
      const result = await this.connect(slug, query['code'], state);
      return back(result);
    } catch (error) {
      // Never log tokens; adapter errors carry no secrets.
      console.error('Connect failed', slug, isAdapterError(error) ? error.kind : error);
      return back('error');
    }
  }

  private async connect(
    slug: string,
    code: string,
    state: { userId: string; workspaceId: string; projectId: string },
  ): Promise<ConnectResult> {
    const { workspaceId, projectId, userId } = state;

    // Re-check access: membership or role may have changed since the flow started.
    const member = await this.prisma.client.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { id: true, role: true },
    });
    if (!member || !(CONNECT_ROLES as readonly string[]).includes(member.role)) {
      throw new ForbiddenException();
    }
    await this.visibleProject({ workspaceId, memberId: member.id, role: member.role }, projectId);

    const { platform, adapter, http } = adapterFor(slug);
    const tokens = await adapter.exchangeCode(code, redirectUri(slug), http);
    const account = await adapter.getAccount({ accessToken: tokens.accessToken, http });

    const key = { workspaceId, platform, externalUserId: account.externalId };
    const existing = await this.prisma.client.socialConnection.findUnique({
      where: { workspaceId_platform_externalUserId: key },
      select: { projectId: true },
    });
    // One platform account belongs to one project of a workspace.
    if (existing && existing.projectId !== projectId) return 'alreadyConnected';

    const c = tokenCipher();
    const secrets = {
      accessTokenEncrypted: c.encrypt(
        tokens.accessToken,
        socialTokenAad(workspaceId, platform, account.externalId, 'access'),
      ),
      refreshTokenEncrypted: tokens.refreshToken
        ? c.encrypt(
            tokens.refreshToken,
            socialTokenAad(workspaceId, platform, account.externalId, 'refresh'),
          )
        : null,
      keyVersion: c.keyVersion,
      accessTokenExpiresAt: tokens.accessTokenExpiresAt ?? null,
      refreshTokenExpiresAt: tokens.refreshTokenExpiresAt ?? null,
      scopes: tokens.scopes,
      status: 'ACTIVE' as const,
      connectedByUserId: userId,
    };
    const profile = {
      username: account.username ?? null,
      displayName: account.displayName ?? null,
      avatarUrl: account.avatarUrl ?? null,
      accountType: account.accountType ?? null,
      followersCount: account.followersCount,
      followingCount: account.followingCount,
      postsCount: account.postsCount,
    };

    await this.prisma.client.$transaction(async (tx) => {
      const connection = await tx.socialConnection.upsert({
        where: { workspaceId_platform_externalUserId: key },
        create: { ...key, projectId, ...secrets },
        update: secrets,
        select: { id: true },
      });
      await tx.socialAccount.upsert({
        where: {
          workspaceId_platform_externalId: {
            workspaceId,
            platform,
            externalId: account.externalId,
          },
        },
        create: {
          workspaceId,
          projectId,
          connectionId: connection.id,
          platform,
          externalId: account.externalId,
          ...profile,
          // Adelie's own daily history starts today (PRD §6.4).
          collectingSince: new Date(new Date().toISOString().slice(0, 10)),
        },
        update: { connectionId: connection.id, ...profile },
      });
    });
    // Next step (worker): enqueue the INITIAL sync (90 days of history) for this account.
    return 'connected';
  }
}
