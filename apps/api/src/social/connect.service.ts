import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { SocialPlatform } from '@adelie/db';
import {
  ETSY_API,
  ETSY_WRITE_SCOPES,
  EtsyAdapter,
  AdapterError,
  HttpClient,
  InstagramAdapter,
  isAdapterError,
  META_GRAPH_API,
  PINTEREST_API,
  PinterestAdapter,
  type AccountData,
  type AdapterContext,
  type PlatformAdapter,
  type TokenSet,
} from '@adelie/platforms';
import { socialTokenAad, tokenCipherFromEnv, type TokenCipher } from '@adelie/shared/crypto';
import { config } from '../config.js';
import { PrismaService } from '../prisma.service.js';
import { pkceFor } from './oauth-state.js';

/** URL path segment → platform (ADR-0004: Pinterest, then Instagram). */
export const PLATFORMS: Record<string, SocialPlatform> = {
  pinterest: 'PINTEREST',
  instagram: 'INSTAGRAM',
  etsy: 'ETSY',
};
export const PLATFORM_SLUGS: Record<SocialPlatform, string> = {
  PINTEREST: 'pinterest',
  INSTAGRAM: 'instagram',
  TIKTOK: 'tiktok',
  ETSY: 'etsy',
};

/** Read-only or full access (ADR-0019; mirrors AccessLevel of @adelie/platforms). */
type AccessLevel = 'read' | 'write';

/** Scopes that make a connection "full access" (ADR-0019), per platform with access levels. */
const WRITE_SCOPES: Partial<Record<SocialPlatform, string[]>> = { ETSY: ETSY_WRITE_SCOPES };

/** The access a connection holds, or null for platforms without levels (always read-only). */
export function accessOf(platform: SocialPlatform, scopes: string[]): AccessLevel | null {
  const write = WRITE_SCOPES[platform];
  if (!write) return null;
  return write.every((s) => scopes.includes(s)) ? 'write' : 'read';
}

/** Validates a requested access level; `write` only where the platform offers it. */
export function parseAccess(adapter: PlatformAdapter, value: unknown): AccessLevel {
  if (value === undefined || value === null || value === 'read') return 'read';
  if (value === 'write' && adapter.capabilities.accessLevels?.includes('write')) return 'write';
  throw new BadRequestException('Unknown access level');
}

/** Roles that may connect accounts and create connect invitations (ADR-0007). */
export const CONNECT_ROLES = ['OWNER', 'ADMIN', 'MANAGER'] as const;

/** Outcome of a connect attempt, shown to the user by the web app. */
export type ConnectResult =
  'connected' | 'denied' | 'expired' | 'alreadyConnected' | 'wrongAccount' | 'error';

/** The outcome, and for `wrongAccount` who consented vs who was meant to (handles only). */
export interface ConnectOutcome {
  result: ConnectResult;
  connectionId?: string;
  connectedAs?: string;
  expected?: string;
}

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
    if (platform === 'ETSY') {
      if (!config.etsy) throw new ServiceUnavailableException('Etsy is not configured');
      return {
        platform,
        adapter: new EtsyAdapter(config.etsy),
        http: new HttpClient({ baseUrl: ETSY_API }),
      };
    }
    if (platform === 'INSTAGRAM') {
      if (!config.instagram) throw new ServiceUnavailableException('Instagram is not configured');
      return {
        platform,
        adapter: new InstagramAdapter(config.instagram),
        http: new HttpClient({ baseUrl: META_GRAPH_API }),
      };
    }
    if (!config.pinterest) throw new ServiceUnavailableException('Pinterest is not configured');
    return {
      platform,
      adapter: new PinterestAdapter(config.pinterest),
      http: new HttpClient({ baseUrl: PINTEREST_API }),
    };
  }

  /**
   * Runs `fn` with a connected account's live token (ADR-0019: writes made on a member's action).
   * Refreshes an access token that is about to expire, and once more if the platform rejects it.
   * Tokens never leave this method.
   */
  async withAccount<T>(
    accountId: string,
    fn: (adapter: PlatformAdapter, ctx: AdapterContext) => Promise<T>,
  ): Promise<T> {
    const account = await this.prisma.client.socialAccount.findUniqueOrThrow({
      where: { id: accountId },
      include: { connection: true },
    });
    const c = account.connection;
    if (c.status !== 'ACTIVE')
      throw new AdapterError('REAUTH_REQUIRED', 'Connection is not active');
    const { adapter, http } = this.adapterFor(PLATFORM_SLUGS[account.platform]);
    const aad = (field: 'access' | 'refresh') =>
      socialTokenAad(account.workspaceId, account.platform, c.externalUserId, field);
    let accessToken = this.cipher.decrypt(c.accessTokenEncrypted, aad('access'));

    const refresh = async () => {
      if (!c.refreshTokenEncrypted) throw new AdapterError('REAUTH_REQUIRED', 'No refresh token');
      const tokens = await adapter.refreshToken(
        this.cipher.decrypt(c.refreshTokenEncrypted, aad('refresh')),
        http,
        c.scopes,
      );
      accessToken = tokens.accessToken;
      await this.prisma.client.socialConnection.update({
        where: { id: c.id },
        data: {
          accessTokenEncrypted: this.cipher.encrypt(tokens.accessToken, aad('access')),
          refreshTokenEncrypted: tokens.refreshToken
            ? this.cipher.encrypt(tokens.refreshToken, aad('refresh'))
            : c.refreshTokenEncrypted,
          keyVersion: this.cipher.keyVersion,
          accessTokenExpiresAt: tokens.accessTokenExpiresAt ?? null,
          refreshTokenExpiresAt: tokens.refreshTokenExpiresAt ?? c.refreshTokenExpiresAt,
        },
      });
    };

    if (c.accessTokenExpiresAt && c.accessTokenExpiresAt.getTime() < Date.now() + 60_000) {
      await refresh();
    }
    const ctx = (): AdapterContext => ({
      accessToken,
      accountExternalId: account.externalId,
      http,
    });
    try {
      return await fn(adapter, ctx());
    } catch (error) {
      if (!isAdapterError(error, 'TOKEN_EXPIRED')) throw error;
      await refresh();
      return fn(adapter, ctx());
    }
  }

  redirectUri(slug: string): string {
    return `${config.apiUrl}/social/${slug}/callback`;
  }

  /**
   * Exchanges the OAuth code, reads the platform account(s) and stores connection + account in the
   * project. One token can grant several accounts (Instagram): each becomes its own connection.
   * Access checks are the caller's job. Returns the first connection id when connected.
   */
  async connect(input: {
    slug: string;
    code: string;
    workspaceId: string;
    projectId: string;
    connectedByUserId: string | null;
    /** The signed OAuth state: the PKCE verifier is derived from it. */
    state: string;
    access?: AccessLevel;
    /** Updating access of this connected account (ADR-0020): consent must come from it. */
    expectedAccountId?: string;
  }): Promise<ConnectOutcome> {
    const { slug, code } = input;
    const { platform, adapter, http } = this.adapterFor(slug);
    const expected = input.expectedAccountId
      ? await this.prisma.client.socialAccount.findFirst({
          where: { id: input.expectedAccountId, projectId: input.projectId, platform },
          select: { externalId: true, username: true, displayName: true },
        })
      : null;
    if (input.expectedAccountId && !expected) return { result: 'expired' };
    const tokens = await adapter.exchangeCode(code, this.redirectUri(slug), http, {
      pkce: pkceFor(input.state, config.auth.secret),
      access: input.access ?? 'read',
    });

    // Diagnostics without secrets: how many accounts the grant covers.
    console.log(
      `Connect ${slug}: scopes=${tokens.scopes.join(',')} accounts=${tokens.accountIds?.length ?? 'n/a'}`,
    );
    // Nothing selected on the consent screen (Meta lets people untick every account).
    if (tokens.accountIds && tokens.accountIds.length === 0) return { result: 'denied' };
    let targets: (string | undefined)[] = tokens.accountIds ?? [undefined];
    // Updating one account: only it may be touched (Meta can grant several — keep just that one).
    if (expected && tokens.accountIds) {
      if (tokens.accountIds.includes(expected.externalId)) targets = [expected.externalId];
      else return this.wrongAccount(adapter, tokens, http, tokens.accountIds[0], expected);
    }

    let connectionId: string | undefined;
    let elsewhere = 0;
    for (const accountExternalId of targets) {
      const account = await adapter.getAccount({
        accessToken: tokens.accessToken,
        accountExternalId,
        http,
      });
      // Consent from another account than the one being updated: nothing is stored or changed.
      if (expected && account.externalId !== expected.externalId) {
        return {
          result: 'wrongAccount',
          connectedAs: account.username ?? account.displayName ?? account.externalId,
          expected: expected.username ?? expected.displayName ?? expected.externalId,
        };
      }
      const id = await this.store({ ...input, platform, tokens, account });
      if (id) connectionId ??= id;
      else elsewhere++;
    }
    if (!connectionId) return { result: elsewhere ? 'alreadyConnected' : 'error' };
    // The worker's scheduler picks new accounts up within a minute (INITIAL sync).
    return { result: 'connected', connectionId };
  }

  private async wrongAccount(
    adapter: PlatformAdapter,
    tokens: TokenSet,
    http: HttpClient,
    accountExternalId: string | undefined,
    expected: { externalId: string; username: string | null; displayName: string | null },
  ): Promise<ConnectOutcome> {
    const other = await adapter
      .getAccount({ accessToken: tokens.accessToken, accountExternalId, http })
      .catch(() => null);
    return {
      result: 'wrongAccount',
      connectedAs: other?.username ?? other?.displayName ?? accountExternalId,
      expected: expected.username ?? expected.displayName ?? expected.externalId,
    };
  }

  /** Stores one account; null when it already belongs to another project of the workspace. */
  private async store(input: {
    workspaceId: string;
    projectId: string;
    connectedByUserId: string | null;
    platform: SocialPlatform;
    tokens: TokenSet;
    account: AccountData;
  }): Promise<string | null> {
    const { workspaceId, projectId, connectedByUserId, platform, tokens, account } = input;
    const key = { workspaceId, platform, externalUserId: account.externalId };
    const existing = await this.prisma.client.socialConnection.findUnique({
      where: { workspaceId_platform_externalUserId: key },
      select: { projectId: true },
    });
    // One platform account belongs to one project of a workspace.
    if (existing && existing.projectId !== projectId) return null;

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

    return this.prisma.client.$transaction(async (tx) => {
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
  }
}
