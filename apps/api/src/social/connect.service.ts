import { Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { SocialPlatform } from '@adelie/db';
import {
  HttpClient,
  PINTEREST_API,
  PinterestAdapter,
  type PlatformAdapter,
} from '@adelie/platforms';
import { socialTokenAad, tokenCipherFromEnv, type TokenCipher } from '@adelie/shared/crypto';
import { config } from '../config.js';
import { PrismaService } from '../prisma.service.js';

/** URL path segment → platform. Only Pinterest for now (ADR-0004). */
export const PLATFORMS: Record<string, SocialPlatform> = { pinterest: 'PINTEREST' };
export const PLATFORM_SLUGS: Record<SocialPlatform, string> = {
  PINTEREST: 'pinterest',
  INSTAGRAM: 'instagram',
  TIKTOK: 'tiktok',
};

/** Roles that may connect accounts and create connect invitations (ADR-0007). */
export const CONNECT_ROLES = ['OWNER', 'ADMIN', 'MANAGER'] as const;

/** Outcome of a connect attempt, shown to the user by the web app. */
export type ConnectResult = 'connected' | 'denied' | 'expired' | 'alreadyConnected' | 'error';

/**
 * Connecting a platform account to a project (ADR-0011, ADR-0012): shared by the signed-in flow
 * and connect invitations. Tokens are stored encrypted and never leave the API.
 */
@Injectable()
export class ConnectService {
  private cipherInstance: TokenCipher | undefined;

  constructor(private readonly prisma: PrismaService) {}

  get cipher(): TokenCipher {
    this.cipherInstance ??= tokenCipherFromEnv();
    return this.cipherInstance;
  }

  adapterFor(slug: string): {
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

  redirectUri(slug: string): string {
    return `${config.apiUrl}/social/${slug}/callback`;
  }

  /**
   * Exchanges the OAuth code, reads the platform account and stores connection + account in the
   * project. Access checks are the caller's job. Returns the connection id when connected.
   */
  async connect(input: {
    slug: string;
    code: string;
    workspaceId: string;
    projectId: string;
    connectedByUserId: string | null;
  }): Promise<{ result: ConnectResult; connectionId?: string }> {
    const { slug, code, workspaceId, projectId, connectedByUserId } = input;
    const { platform, adapter, http } = this.adapterFor(slug);
    const tokens = await adapter.exchangeCode(code, this.redirectUri(slug), http);
    const account = await adapter.getAccount({ accessToken: tokens.accessToken, http });

    const key = { workspaceId, platform, externalUserId: account.externalId };
    const existing = await this.prisma.client.socialConnection.findUnique({
      where: { workspaceId_platform_externalUserId: key },
      select: { projectId: true },
    });
    // One platform account belongs to one project of a workspace.
    if (existing && existing.projectId !== projectId) return { result: 'alreadyConnected' };

    const c = this.cipher;
    const aad = (field: 'access' | 'refresh') =>
      socialTokenAad(workspaceId, platform, account.externalId, field);
    const secrets = {
      accessTokenEncrypted: c.encrypt(tokens.accessToken, aad('access')),
      refreshTokenEncrypted: tokens.refreshToken
        ? c.encrypt(tokens.refreshToken, aad('refresh'))
        : null,
      keyVersion: c.keyVersion,
      accessTokenExpiresAt: tokens.accessTokenExpiresAt ?? null,
      refreshTokenExpiresAt: tokens.refreshTokenExpiresAt ?? null,
      scopes: tokens.scopes,
      status: 'ACTIVE' as const,
      connectedByUserId,
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

    const connectionId = await this.prisma.client.$transaction(async (tx) => {
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
      return connection.id;
    });
    // The worker's scheduler picks the new account up within a minute (INITIAL sync).
    return { result: 'connected', connectionId };
  }
}
