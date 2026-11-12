// Sync orchestrator (ADR-0011): runs one account's synchronization through its platform adapter and
// persists the result. Adapters know nothing about the database; everything stateful happens here.
import { randomUUID } from 'node:crypto';
import type { PrismaClient, Prisma } from '@adelie/db';
import {
  AdapterError,
  HttpClient,
  articlesOf,
  hasFeature,
  isAdapterError,
  postLinks,
  resolveShortLinks,
  shortLinkCode,
  type AdapterContext,
  type MetricPoint,
  type PlatformAdapter,
  type RecordedResponse,
  type TokenSet,
} from '@adelie/platforms';
import type { SyncKind } from '@adelie/shared';
import { socialTokenAad, type TokenCipher } from '@adelie/shared/crypto';
import {
  dailyFetchWindow,
  deltaDay,
  dimensionKey,
  latestRow,
  snapshotChanged,
  snapshotDelta,
} from './metrics.js';
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
const API_VERSION: Record<string, string> = {
  PINTEREST: 'v5',
  INSTAGRAM: 'v27.0',
  TIKTOK: 'v2',
  ETSY: 'v3',
  WEBSITE: 'merchant-feed',
};

const day = (d: Date) => d.toISOString().slice(0, 10);
const asDate = (yyyyMmDd: string) => new Date(`${yyyyMmDd}T00:00:00Z`);

type StepOutcome = 'ok' | 'skipped';

/** Orders re-read on every sync after the first: status and shipping change after the sale. */
const ORDER_REFRESH_DAYS = 30;
/** Ledger entries re-read on every sync after the first (refunds and fee corrections come late). */
const LEDGER_REFRESH_DAYS = 62;

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
      connection.scopes,
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
          // A name the member gave the account stays.
          ...(account.displayNameCustom ? {} : { displayName: a.displayName ?? null }),
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
    /** Per post: the day of its latest snapshot, or of the covered range's end (ADR-0017). */
    const floorDay = new Map<string, string>();
    const later = (a: string | undefined, b: string) => (a && a > b ? a : b);
    for (const v of await prisma.postMetricValue.findMany({
      where: { accountId: account.id, dimensionKey: '' },
      distinct: ['postId', 'metricId'],
      orderBy: [{ postId: 'asc' }, { metricId: 'asc' }, { date: 'desc' }],
      select: { postId: true, metricId: true, value: true, dataStatus: true, date: true },
    })) {
      previous.set(`${v.postId}:${v.metricId}`, { value: v.value, dataStatus: v.dataStatus });
      floorDay.set(v.postId, later(floorDay.get(v.postId), day(v.date)));
    }
    const changedPosts = new Set<string>();

    // Daily post values from the change of lifetime totals (ADR-0017): posts with a baseline, and
    // posts published since the previous successful sync (all their activity is new).
    const fromSnapshots = !!adapter.capabilities.postDailyFromSnapshots;
    const today = day(now());
    const baselined = new Set(floorDay.keys());
    if (fromSnapshots) {
      for (const p of await prisma.socialPost.findMany({
        where: { accountId: account.id, dailyTo: { not: null } },
        select: { id: true, dailyTo: true },
      })) {
        floorDay.set(p.id, later(floorDay.get(p.id), day(p.dailyTo!)));
      }
    }
    const lastSync = account.lastSuccessfulSyncAt;
    const newPosts = new Set<string>();
    /** Posts whose covered range moves to the given day. */
    const coverDay = new Map<string, string>();
    await step('posts', async () => {
      for await (const page of adapter.listPosts(ctx())) {
        const postIds = new Map<string, string>();
        /** Short link code → its destination (null: not a link of this project). */
        const shortLinks = new Map<string, string | null>();
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
            link: p.link ?? null,
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
          // Links of the post: its own and those in its text (ADR-0018), replaced as a whole. A short
          // link of Link Builder (ADR-0027) counts as a link to where it leads.
          const found = postLinks(p);
          const codes = found.map((l) => shortLinkCode(l.url)).filter((c): c is string => !!c);
          const unknown = codes.filter((c) => !shortLinks.has(c));
          if (unknown.length) {
            const rows = await prisma.trackedLink.findMany({
              where: { projectId: account.projectId, code: { in: unknown } },
              select: { code: true, destination: true },
            });
            for (const c of unknown) {
              shortLinks.set(c, rows.find((r) => r.code === c)?.destination ?? null);
            }
          }
          const links = codes.length ? resolveShortLinks(found, (c) => shortLinks.get(c)) : found;
          await prisma.$transaction([
            prisma.socialPostLink.deleteMany({ where: { postId: post.id } }),
            prisma.socialPostLink.createMany({
              data: links.map((l) => ({
                postId: post.id,
                workspaceId: account.workspaceId,
                projectId: account.projectId,
                ...l,
              })),
            }),
          ]);
          count('postLinks', links.length);
          if (fromSnapshots) {
            const isNew =
              !baselined.has(post.id) && !!lastSync && !!p.publishedAt && p.publishedAt >= lastSync;
            if (isNew) {
              newPosts.add(post.id);
              floorDay.set(post.id, day(p.publishedAt!));
            }
            if (isNew || baselined.has(post.id)) {
              coverDay.set(post.id, deltaDay(today, floorDay.get(post.id) ?? null));
            }
          }
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
          const delta = fromSnapshots
            ? snapshotDelta(previous.get(prevKey)?.value, m.value, newPosts.has(postId))
            : null;
          const deltaDate = coverDay.get(postId);
          if (delta && deltaDate) {
            // Several syncs on one day add up.
            const dailyKey = { postId, metricId: def.id, date: asDate(deltaDate) };
            await prisma.postMetricDaily.upsert({
              where: { postId_metricId_date: dailyKey },
              create: {
                ...dailyKey,
                workspaceId: account.workspaceId,
                accountId: account.id,
                value: delta,
                dataStatus: 'READY',
                fetchedAt: now(),
              },
              update: { value: { increment: delta }, fetchedAt: now() },
            });
            count('postDailyValues');
          }
          previous.set(prevKey, { value: m.value, dataStatus: m.dataStatus });
          changedPosts.add(postId);
          count('postValues');
        }
      }
    });

    // 3a. Covered ranges of snapshot-derived daily values: a covered day without a row had no
    // activity (ADR-0013), so the range grows even for posts that did not change.
    if (fromSnapshots && coverDay.size) {
      const byDay = new Map<string, string[]>();
      for (const [postId, d] of coverDay) byDay.set(d, [...(byDay.get(d) ?? []), postId]);
      for (const [d, ids] of byDay) {
        await prisma.socialPost.updateMany({
          where: { id: { in: ids }, dailyFrom: null },
          data: { dailyFrom: asDate(d), dailyTo: asDate(d) },
        });
        await prisma.socialPost.updateMany({
          where: { id: { in: ids }, dailyFrom: { not: null } },
          data: { dailyTo: asDate(d) },
        });
      }
      count('postDailyCovered', coverDay.size);
    }

    // 3b. Daily metrics per own post (ADR-0013): only posts with new activity or unsettled days.
    if (adapter.getPostMetrics) {
      await step('postDaily', () => syncPostDaily(changedPosts));
    }

    // 3c. Points of sale (ADR-0018): products, then orders with their lines.
    if (adapter.listProducts) {
      await step('products', async () => {
        const seen = new Set<string>();
        for await (const page of adapter.listProducts!(ctx())) {
          for (const p of page) {
            seen.add(p.externalId);
            const data = {
              title: p.title,
              url: p.url ?? null,
              imageUrl: p.imageUrl ?? null,
              state: p.state,
              price: p.price?.amount ?? null,
              currency: p.price?.currency ?? null,
              quantity: p.quantity,
              views: p.views,
              favorers: p.favorers,
              tags: p.tags,
              // Unset = the inventory could not be read this time: keep what is stored.
              ...(p.skus ? { skus: p.skus, articles: articlesOf(p.skus) } : {}),
              ...(p.variationCount !== undefined ? { variationCount: p.variationCount } : {}),
              ...(p.skuBy ? { skuBy: p.skuBy } : {}),
              ...(p.variationOptions ? { variationOptions: p.variationOptions } : {}),
              ...(p.details ? { details: p.details } : {}),
              ...(p.category !== undefined ? { category: p.category } : {}),
              ...(p.skuGroups !== undefined ? { skuGroups: p.skuGroups } : {}),
              listedAt: p.listedAt ?? null,
            };
            await prisma.shopProduct.upsert({
              where: { accountId_externalId: { accountId: account.id, externalId: p.externalId } },
              create: {
                workspaceId: account.workspaceId,
                projectId: account.projectId,
                accountId: account.id,
                externalId: p.externalId,
                ...data,
              },
              update: data,
            });
            count('products');
          }
        }
        // A site's feed lists what is on sale now: a product that left it is "removed" (its history
        // stays). Etsy's listing states come from Etsy itself.
        if (account.platform === 'WEBSITE' && seen.size) {
          const gone = await prisma.shopProduct.updateMany({
            where: {
              accountId: account.id,
              externalId: { notIn: [...seen] },
              state: { not: 'removed' },
            },
            data: { state: 'removed' },
          });
          count('removedProducts', gone.count);
        }
      });
    }
    if (adapter.listOrders) {
      await step('orders', async () => {
        // First sync: the whole history; then the last 30 days, so status changes (shipped,
        // refunded) are picked up too.
        const since =
          job.kind === 'INITIAL' || !account.lastSuccessfulSyncAt
            ? undefined
            : new Date(account.lastSuccessfulSyncAt.getTime() - ORDER_REFRESH_DAYS * 86_400_000);
        const products = new Map(
          (
            await prisma.shopProduct.findMany({
              where: { accountId: account.id },
              select: { id: true, externalId: true },
            })
          ).map((p) => [p.externalId, p.id]),
        );
        for await (const page of adapter.listOrders!(ctx(), { since })) {
          // Products sold earlier but no longer listed (removed on the platform) are kept as
          // "removed", so their sales and the posts leading to them are not lost.
          for (const item of page.flatMap((o) => o.items)) {
            const ext = item.productExternalId;
            if (!ext || products.has(ext)) continue;
            const removed = await prisma.shopProduct.upsert({
              where: { accountId_externalId: { accountId: account.id, externalId: ext } },
              create: {
                workspaceId: account.workspaceId,
                projectId: account.projectId,
                accountId: account.id,
                externalId: ext,
                title: item.title ?? ext,
                state: 'removed',
                price: item.price?.amount ?? null,
                currency: item.price?.currency ?? null,
              },
              update: {},
              select: { id: true },
            });
            products.set(ext, removed.id);
            count('removedProducts');
          }
          for (const o of page) {
            const data = {
              orderedAt: o.orderedAt,
              status: o.status ?? null,
              isPaid: o.isPaid ?? null,
              isShipped: o.isShipped ?? null,
              currency: o.currency,
              total: o.total,
              subtotal: o.subtotal,
              shipping: o.shipping,
              tax: o.tax,
              discount: o.discount,
              country: o.country ?? null,
            };
            await prisma.$transaction(async (tx) => {
              const order = await tx.shopOrder.upsert({
                where: {
                  accountId_externalId: { accountId: account.id, externalId: o.externalId },
                },
                create: {
                  workspaceId: account.workspaceId,
                  projectId: account.projectId,
                  accountId: account.id,
                  externalId: o.externalId,
                  ...data,
                },
                update: data,
                select: { id: true },
              });
              // Lines are replaced as a whole: the platform's receipt is the truth.
              await tx.shopOrderItem.deleteMany({ where: { orderId: order.id } });
              await tx.shopOrderItem.createMany({
                data: o.items.map((i) => ({
                  orderId: order.id,
                  productId: i.productExternalId
                    ? (products.get(i.productExternalId) ?? null)
                    : null,
                  externalId: i.externalId,
                  productExternalId: i.productExternalId ?? null,
                  title: i.title ?? null,
                  quantity: i.quantity,
                  price: i.price?.amount ?? null,
                })),
              });
            });
            count('orders');
          }
        }
      });
    }

    if (adapter.listLedger) {
      await step('ledger', async () => {
        // First sync: from the first order (whole history); then the last two months, which
        // covers late entries (refunds, fee corrections).
        const first = await prisma.shopOrder.findFirst({
          where: { accountId: account.id },
          orderBy: { orderedAt: 'asc' },
          select: { orderedAt: true },
        });
        const since =
          job.kind === 'INITIAL' || !account.lastSuccessfulSyncAt
            ? (first?.orderedAt ?? new Date(now().getTime() - 365 * 86_400_000))
            : new Date(now().getTime() - LEDGER_REFRESH_DAYS * 86_400_000);
        for await (const page of adapter.listLedger!(ctx(), { since })) {
          for (const e of page) {
            const data = {
              occurredAt: e.occurredAt,
              type: e.type,
              category: e.category,
              referenceType: e.referenceType ?? null,
              referenceId: e.referenceId ?? null,
              amount: e.amount,
              currency: e.currency,
            };
            await prisma.shopLedgerEntry.upsert({
              where: { accountId_externalId: { accountId: account.id, externalId: e.externalId } },
              create: {
                workspaceId: account.workspaceId,
                projectId: account.projectId,
                accountId: account.id,
                externalId: e.externalId,
                ...data,
              },
              update: data,
            });
            count('ledgerEntries');
          }
        }
      });
    }

    // 3d. Audience (demographics, interests): only when the connection has the permission —
    // a missing one is shown as "update access", not as a failing sync.
    if (adapter.getAudience && hasFeature(adapter.platform, connection.scopes, 'audience')) {
      await step('audience', async () => {
        for (const a of await adapter.getAudience!(ctx())) {
          const key = { accountId: account.id, type: a.type, date: asDate(day(now())) };
          const data = {
            size: a.size,
            sizeIsUpperBound: a.sizeIsUpperBound,
            groups: a.groups as unknown as Prisma.InputJsonValue,
            fetchedAt: now(),
          };
          await prisma.accountAudience.upsert({
            where: { accountId_type_date: key },
            create: { workspaceId: account.workspaceId, ...key, ...data },
            update: data,
          });
          count('audiences');
        }
      });
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
