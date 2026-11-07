// Sync orchestrator (ADR-0011): runs one account's synchronization through its platform adapter and
// persists the result. Adapters know nothing about the database; everything stateful happens here.
import { randomUUID } from 'node:crypto';
import type { PrismaClient, Prisma } from '@adelie/db';
import {
  AdapterError,
  HttpClient,
  isAdapterError,
  type AdapterContext,
  type MetricPoint,
  type PlatformAdapter,
  type RecordedResponse,
  type TokenSet,
} from '@adelie/platforms';
import type { SyncKind } from '@adelie/shared';
import { socialTokenAad, type TokenCipher } from '@adelie/shared/crypto';
import { dailyFetchWindow, dimensionKey, latestRow, snapshotChanged } from './metrics.js';
import { analyticsRange } from './schedule.js';

export interface SyncDeps {
  prisma: PrismaClient;
  cipher: TokenCipher;
  /** Adapter + API base URL for a platform; null if the platform is not configured. */
  adapterFor: (platform: string) => { adapter: PlatformAdapter; baseUrl: string } | null;
  now?: () => Date;
  log?: (message: string) => void;
}

/** Refresh the access token when it expires within this window. */
const REFRESH_ACCESS_BEFORE_MS = 7 * 24 * 3600 * 1000;
/**
 * Refresh-token lifetime is 60 days, renewable indefinitely: refresh early enough that an account
 * synced daily never lets it lapse (docs/integrations/pinterest.md).
 */
const REFRESH_REFRESH_BEFORE_MS = 30 * 24 * 3600 * 1000;
/** Recorded with every value (ADR-0008 provenance). */
const API_VERSION: Record<string, string> = { PINTEREST: 'v5', INSTAGRAM: 'v27.0' };

const day = (d: Date) => d.toISOString().slice(0, 10);
const asDate = (yyyyMmDd: string) => new Date(`${yyyyMmDd}T00:00:00Z`);

type StepOutcome = 'ok' | 'skipped';

/** Runs one sync. Never throws for expected platform conditions; the SyncRun records the outcome. */
export async function runSync(
  deps: SyncDeps,
  job: { workspaceId: string; accountId: string; kind: SyncKind },
): Promise<{ status: string; stats: Record<string, number> }> {
  const { prisma, cipher } = deps;
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? (() => undefined);

  const account = await prisma.socialAccount.findFirst({
    where: { id: job.accountId, workspaceId: job.workspaceId },
    include: { connection: true },
  });
  if (!account) return { status: 'SKIPPED', stats: {} };
  const { connection } = account;
  if (connection.status !== 'ACTIVE') return { status: 'SKIPPED', stats: {} };

  const platform = deps.adapterFor(account.platform);
  if (!platform) return { status: 'SKIPPED', stats: {} };
  const { adapter } = platform;

  const run = await prisma.syncRun.create({
    data: {
      workspaceId: account.workspaceId,
      projectId: account.projectId,
      connectionId: connection.id,
      accountId: account.id,
      kind: job.kind,
      status: 'RUNNING',
      correlationId: randomUUID(),
      startedAt: now(),
    },
    select: { id: true, correlationId: true },
  });
  log(
    `sync ${run.correlationId} ${account.platform}/${account.username ?? account.externalId} ${job.kind}`,
  );

  const stats: Record<string, number> = { requests: 0 };
  const count = (key: string, n = 1) => {
    stats[key] = (stats[key] ?? 0) + n;
  };
  const skipped: string[] = [];

  // Raw responses → SyncPayload (body only; request headers never reach this callback).
  const http = new HttpClient({
    baseUrl: platform.baseUrl,
    record: async (r: RecordedResponse) => {
      count('requests');
      await prisma.syncPayload.create({
        data: {
          workspaceId: account.workspaceId,
          syncRunId: run.id,
          endpoint: r.endpoint,
          params: r.params,
          httpStatus: r.httpStatus,
          body: (r.body ?? null) as Prisma.InputJsonValue,
          fetchedAt: r.fetchedAt,
        },
      });
    },
  });

  // ---------- Tokens ----------
  const aad = (field: 'access' | 'refresh') =>
    socialTokenAad(account.workspaceId, account.platform, connection.externalUserId, field);
  let accessToken = cipher.decrypt(connection.accessTokenEncrypted, aad('access'));
  const refreshToken = connection.refreshTokenEncrypted
    ? cipher.decrypt(connection.refreshTokenEncrypted, aad('refresh'))
    : undefined;

  async function storeTokens(tokens: TokenSet) {
    accessToken = tokens.accessToken;
    await prisma.socialConnection.update({
      where: { id: connection.id },
      data: {
        accessTokenEncrypted: cipher.encrypt(tokens.accessToken, aad('access')),
        refreshTokenEncrypted: tokens.refreshToken
          ? cipher.encrypt(tokens.refreshToken, aad('refresh'))
          : connection.refreshTokenEncrypted,
        keyVersion: cipher.keyVersion,
        accessTokenExpiresAt: tokens.accessTokenExpiresAt ?? null,
        refreshTokenExpiresAt: tokens.refreshTokenExpiresAt ?? connection.refreshTokenExpiresAt,
        ...(tokens.scopes.length ? { scopes: tokens.scopes } : {}),
      },
    });
    count('tokenRefreshes');
  }

  async function refresh() {
    if (!refreshToken) throw new AdapterError('REAUTH_REQUIRED', 'No refresh token');
    // Token requests are not recorded (they carry secrets) — use a separate, non-recording client.
    const tokens = await adapter.refreshToken(
      refreshToken,
      new HttpClient({ baseUrl: platform!.baseUrl }),
    );
    await storeTokens(tokens);
  }

  const ctx = (): AdapterContext => ({
    accessToken,
    accountExternalId: account.externalId,
    http,
    today: day(now()),
  });

  /** Runs a step; on an expired token refreshes once and retries; NOT_AVAILABLE skips the step. */
  async function step(name: string, fn: () => Promise<void>): Promise<StepOutcome> {
    try {
      await fn();
      return 'ok';
    } catch (error) {
      if (isAdapterError(error, 'TOKEN_EXPIRED')) {
        await refresh();
        try {
          await fn();
          return 'ok';
        } catch (retryError) {
          if (!isAdapterError(retryError, 'NOT_AVAILABLE')) throw retryError;
        }
      } else if (!isAdapterError(error, 'NOT_AVAILABLE')) {
        throw error;
      }
      skipped.push(name);
      log(`  ${name}: not available — skipped`);
      return 'skipped';
    }
  }

  // ---------- Metric catalogue ----------
  const definitions = await prisma.metricDefinition.findMany({
    where: { platform: account.platform },
    select: { id: true, scope: true, key: true, providerKey: true },
  });
  const metricId = new Map(definitions.map((d) => [`${d.scope}:${d.providerKey}`, d]));
  const resolve = (p: MetricPoint) => metricId.get(`${p.scope}:${p.providerKey}`);

  async function saveAccountPoints(points: MetricPoint[], source: string) {
    for (const p of points) {
      const def = resolve(p);
      if (!def) {
        count('unknownMetrics');
        continue;
      }
      const key = {
        accountId: account!.id,
        metricId: def.id,
        date: asDate(p.date),
        dimensionKey: dimensionKey(p.dimensions),
      };
      const values = {
        value: p.value,
        dataStatus: p.dataStatus,
        providerStatus: p.providerStatus ?? null,
        source,
        apiVersion: API_VERSION[account!.platform] ?? '',
        fetchedAt: now(),
      };
      await prisma.accountMetricValue.upsert({
        where: { accountId_metricId_date_dimensionKey: key },
        create: { workspaceId: account!.workspaceId, ...key, ...values },
        update: values,
      });
      count('accountValues');
    }
  }

  async function syncPostDaily(changedPosts: Set<string>) {
    const today = day(now());
    const posts = await prisma.socialPost.findMany({
      where: { accountId: account!.id, isOwn: true },
      select: { id: true, externalId: true, publishedAt: true, dailyFrom: true, dailyTo: true },
    });
    const since = new Date(asDate(today).getTime() - 7 * 86_400_000);
    const pending = new Set(
      (
        await prisma.postMetricDaily.findMany({
          where: { accountId: account!.id, date: { gte: since }, dataStatus: { not: 'READY' } },
          distinct: ['postId'],
          select: { postId: true },
        })
      ).map((r) => r.postId),
    );
    for (const post of posts) {
      const window = dailyFetchWindow(
        {
          publishedAt: post.publishedAt ? day(post.publishedAt) : null,
          dailyTo: post.dailyTo ? day(post.dailyTo) : null,
        },
        {
          today,
          historyDays: adapter.capabilities.historyDays,
          changed: changedPosts.has(post.id),
          pending: pending.has(post.id),
        },
      );
      if (!window) {
        // No new activity: the covered range simply reaches today (missing days = 0).
        if (post.dailyTo) {
          await prisma.socialPost.update({
            where: { id: post.id },
            data: { dailyTo: asDate(today) },
          });
        }
        count('postDailyUnchanged');
        continue;
      }
      let points: MetricPoint[];
      try {
        points = await withTokenRetry(() =>
          adapter.getPostMetrics!(ctx(), { postExternalId: post.externalId, ...window }),
        );
      } catch (error) {
        // One pin without analytics (e.g. removed meanwhile) must not stop the others.
        if (isAdapterError(error, 'NOT_AVAILABLE') || isAdapterError(error, 'INVALID')) {
          count('postDailyUnavailable');
          continue;
        }
        throw error;
      }
      const rows = points.flatMap((p) => {
        const def = resolve(p);
        // Sparse: a final zero day needs no row (ADR-0013).
        if (!def || (p.dataStatus === 'READY' && !p.value)) return [];
        return [
          {
            postId: post.id,
            workspaceId: account!.workspaceId,
            accountId: account!.id,
            metricId: def.id,
            date: asDate(p.date),
            value: p.value,
            dataStatus: p.dataStatus,
            fetchedAt: now(),
          },
        ];
      });
      await prisma.$transaction([
        prisma.postMetricDaily.deleteMany({
          where: { postId: post.id, date: { gte: asDate(window.from), lte: asDate(window.to) } },
        }),
        prisma.postMetricDaily.createMany({ data: rows }),
        prisma.socialPost.update({
          where: { id: post.id },
          data: {
            dailyFrom: post.dailyFrom ?? asDate(window.from),
            dailyTo: asDate(window.to),
          },
        }),
      ]);
      count('postDailyFetched');
      count('postDailyValues', rows.length);
    }
  }

  /** Refreshes the access token once on TOKEN_EXPIRED and retries. */
  async function withTokenRetry<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (!isAdapterError(error, 'TOKEN_EXPIRED')) throw error;
      await refresh();
      return fn();
    }
  }

  let status: 'SUCCESS' | 'PARTIAL' | 'FAILED' | 'REAUTHORIZATION_REQUIRED' = 'SUCCESS';
  let errorCode: string | null = null;
  let errorMessage: string | null = null;
  let historyFrom: string | null = null;

  try {
    // Refresh tokens ahead of expiry (refresh tokens renew on every refresh).
    const t = now().getTime();
    if (
      refreshToken &&
      ((connection.accessTokenExpiresAt &&
        connection.accessTokenExpiresAt.getTime() - t < REFRESH_ACCESS_BEFORE_MS) ||
        (connection.refreshTokenExpiresAt &&
          connection.refreshTokenExpiresAt.getTime() - t < REFRESH_REFRESH_BEFORE_MS))
    ) {
      await refresh();
    }

    // 1. Profile + profile snapshot metrics.
    await step('profile', async () => {
      const a = await adapter.getAccount(ctx());
      await prisma.socialAccount.update({
        where: { id: account.id },
        data: {
          username: a.username ?? null,
          displayName: a.displayName ?? null,
          avatarUrl: a.avatarUrl ?? null,
          accountType: a.accountType ?? null,
          followersCount: a.followersCount,
          followingCount: a.followingCount,
          postsCount: a.postsCount,
        },
      });
      await saveAccountPoints(a.metrics, 'user_account');
    });

    // 2. Boards.
    const boardIds = new Map<string, string>();
    for (const b of await prisma.socialBoard.findMany({
      where: { accountId: account.id },
      select: { id: true, externalId: true },
    })) {
      boardIds.set(b.externalId, b.id);
    }
    if (adapter.listBoards && adapter.capabilities.hasBoards) {
      await step('boards', async () => {
        for await (const page of adapter.listBoards!(ctx())) {
          for (const b of page) {
            const data = {
              name: b.name,
              description: b.description ?? null,
              privacy: b.privacy ?? null,
              pinCount: b.pinCount ?? null,
              coverUrl: b.coverUrl ?? null,
            };
            const board = await prisma.socialBoard.upsert({
              where: { accountId_externalId: { accountId: account.id, externalId: b.externalId } },
              create: {
                workspaceId: account.workspaceId,
                projectId: account.projectId,
                accountId: account.id,
                externalId: b.externalId,
                ...data,
              },
              update: data,
              select: { id: true },
            });
            boardIds.set(b.externalId, board.id);
            count('boards');
          }
        }
      });
    }

    // 3. Posts + post metric snapshots (written only on change).
    const previous = new Map<
      string,
      { value: number | null; dataStatus: MetricPoint['dataStatus'] }
    >();
    for (const v of await prisma.postMetricValue.findMany({
      where: { accountId: account.id, dimensionKey: '' },
      distinct: ['postId', 'metricId'],
      orderBy: [{ postId: 'asc' }, { metricId: 'asc' }, { date: 'desc' }],
      select: { postId: true, metricId: true, value: true, dataStatus: true },
    })) {
      previous.set(`${v.postId}:${v.metricId}`, { value: v.value, dataStatus: v.dataStatus });
    }
    const changedPosts = new Set<string>();
    await step('posts', async () => {
      for await (const page of adapter.listPosts(ctx())) {
        const postIds = new Map<string, string>();
        for (const p of page.posts) {
          const data = {
            boardId: p.boardExternalId ? (boardIds.get(p.boardExternalId) ?? null) : null,
            url: p.url ?? null,
            contentType: p.contentType,
            isOwn: p.isOwn ?? true,
            title: p.title ?? null,
            description: p.description ?? null,
            thumbnailUrl: p.thumbnailUrl ?? null,
            publishedAt: p.publishedAt ?? null,
          };
          const post = await prisma.socialPost.upsert({
            where: { accountId_externalId: { accountId: account.id, externalId: p.externalId } },
            create: {
              workspaceId: account.workspaceId,
              projectId: account.projectId,
              accountId: account.id,
              externalId: p.externalId,
              ...data,
            },
            update: data,
            select: { id: true },
          });
          postIds.set(p.externalId, post.id);
          count('posts');
        }
        for (const m of page.metrics) {
          const def = resolve(m);
          const postId = m.postExternalId ? postIds.get(m.postExternalId) : undefined;
          if (!def || !postId) {
            count('unknownMetrics');
            continue;
          }
          const prevKey = `${postId}:${def.id}`;
          if (!snapshotChanged(previous.get(prevKey), m)) {
            count('postValuesUnchanged');
            continue;
          }
          const key = { postId, metricId: def.id, date: asDate(m.date), dimensionKey: '' };
          const values = {
            value: m.value,
            dataStatus: m.dataStatus,
            providerStatus: m.providerStatus ?? null,
            source: 'posts',
            apiVersion: API_VERSION[account!.platform] ?? '',
            fetchedAt: now(),
          };
          await prisma.postMetricValue.upsert({
            where: { postId_metricId_date_dimensionKey: key },
            create: { workspaceId: account.workspaceId, accountId: account.id, ...key, ...values },
            update: values,
          });
          previous.set(prevKey, { value: m.value, dataStatus: m.dataStatus });
          changedPosts.add(postId);
          count('postValues');
        }
      }
    });

    // 3b. Daily metrics per own post (ADR-0013): only posts with new activity or unsettled days.
    if (adapter.getPostMetrics) {
      await step('postDaily', () => syncPostDaily(changedPosts));
    }

    // 4. Account analytics: totals, then each supported breakdown.
    const range = analyticsRange(job.kind, now(), adapter.capabilities.historyDays);
    await step('analytics', async () => {
      await saveAccountPoints(
        await adapter.getAccountMetrics(ctx(), range),
        'user_account/analytics',
      );
      if (job.kind === 'INITIAL') historyFrom = range.from;
    });
    for (const dimension of adapter.capabilities.accountDimensions) {
      await step(`analytics:${dimension}`, async () => {
        try {
          await saveAccountPoints(
            await adapter.getAccountMetrics(ctx(), { ...range, dimension }),
            `user_account/analytics?split=${dimension}`,
          );
        } catch (error) {
          // The breakdown format is not yet confirmed on real data (PoC 2): never fail the sync on it.
          if (isAdapterError(error, 'INVALID')) {
            throw new AdapterError('NOT_AVAILABLE', error.message, error.details);
          }
          throw error;
        }
      });
    }

    // 5. Derived wide rows for sorting and top lists.
    await recomputeLatest(prisma, account);

    if (skipped.length) {
      status = 'PARTIAL';
      errorCode = 'NOT_AVAILABLE';
      errorMessage = `Skipped: ${skipped.join(', ')}`;
    }
  } catch (error) {
    if (isAdapterError(error, 'REAUTH_REQUIRED')) {
      status = 'REAUTHORIZATION_REQUIRED';
      await prisma.socialConnection.update({
        where: { id: connection.id },
        data: { status: 'REAUTHORIZATION_REQUIRED' },
      });
    } else {
      status = 'FAILED';
    }
    errorCode = isAdapterError(error) ? error.kind : 'INTERNAL';
    errorMessage = (error as Error).message.slice(0, 500);
    log(`  failed: ${errorCode} ${errorMessage}`);
  }

  const finished = now();
  const succeeded = status === 'SUCCESS' || status === 'PARTIAL';
  await prisma.syncRun.update({
    where: { id: run.id },
    data: {
      status,
      finishedAt: finished,
      requestCount: stats['requests'] ?? 0,
      stats,
      errorCode,
      errorMessage,
    },
  });
  await prisma.socialAccount.update({
    where: { id: account.id },
    data: {
      lastSyncedAt: finished,
      ...(succeeded ? { lastSuccessfulSyncAt: finished } : {}),
      ...(historyFrom && !account.historyAvailableFrom
        ? { historyAvailableFrom: asDate(historyFrom) }
        : {}),
    },
  });
  log(`  ${status} ${JSON.stringify(stats)}`);
  return { status, stats };
}

/** Rebuilds PostMetricsLatest for an account from the latest snapshot of each post metric. */
async function recomputeLatest(
  prisma: PrismaClient,
  account: { id: string; workspaceId: string; projectId: string },
): Promise<void> {
  const values = await prisma.postMetricValue.findMany({
    where: { accountId: account.id, dimensionKey: '' },
    distinct: ['postId', 'metricId'],
    orderBy: [{ postId: 'asc' }, { metricId: 'asc' }, { date: 'desc' }],
    select: {
      postId: true,
      value: true,
      dataStatus: true,
      date: true,
      metric: { select: { key: true } },
      post: { select: { boardId: true } },
    },
  });
  const byPost = new Map<string, typeof values>();
  for (const v of values) byPost.set(v.postId, [...(byPost.get(v.postId) ?? []), v]);

  for (const [postId, list] of byPost) {
    const row = latestRow(
      list.map((v) => ({
        key: v.metric.key,
        value: v.value,
        dataStatus: v.dataStatus,
        date: day(v.date),
      })),
    );
    if (!row) continue;
    const data = { ...row, asOfDate: asDate(row.asOfDate), boardId: list[0]!.post.boardId };
    await prisma.postMetricsLatest.upsert({
      where: { postId },
      create: {
        postId,
        workspaceId: account.workspaceId,
        projectId: account.projectId,
        accountId: account.id,
        ...data,
      },
      update: data,
    });
  }
}

/** Deletes raw API responses older than the retention window (ADR-0008: 90 days). */
export async function purgeOldPayloads(prisma: PrismaClient, now = new Date()): Promise<number> {
  const before = new Date(now.getTime() - 90 * 24 * 3600 * 1000);
  const { count } = await prisma.syncPayload.deleteMany({ where: { fetchedAt: { lt: before } } });
  return count;
}
