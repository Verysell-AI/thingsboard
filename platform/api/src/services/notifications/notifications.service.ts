import { and, count, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import type { Role } from '@platform/shared/roles';
import type { Notification, NotificationAction, NotificationsResponse } from '@platform/shared/dto';
import type { Db } from '../../db/index.js';
import { notifications, users, type NotificationRow } from '../../db/schema/index.js';
import { withTenant } from '../../db/tenant.js';
import { notFound } from '../../lib/errors.js';
import type { AuditService } from '../audit/audit.service.js';
import type { ReplayService } from '../live/replay.service.js';

export interface CreateNotificationInput {
  tenantId: string;
  tenantKey: string;
  /** Either explicit users or every user holding one of the roles. */
  userIds?: string[];
  roles?: Role[];
  kind: string;
  title: string;
  body?: string | null;
  /** Related entity code; unread rows with the same kind + subject are not duplicated. */
  subject?: string | null;
  actions?: NotificationAction[];
}

/** Handler for a notification action key (registered by later features such as the sweep). */
export type NotificationActionHandler = (ctx: {
  tenant: { id: string; key: string };
  userId: string;
  notification: NotificationRow;
  key: string;
}) => Promise<void>;

export const NOTIFICATION_DEDUPE_MS = 10 * 60_000;

export function toNotificationDto(row: NotificationRow): Notification {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    subject: row.subject,
    actions: row.actions,
    readAt: row.readAt?.toISOString() ?? null,
    actedAt: row.actedAt?.toISOString() ?? null,
    actedKey: row.actedKey,
    createdAt: row.createdAt.toISOString(),
  };
}

/** In-app notifications: one row per recipient, pushed live, deduplicated per subject. */
export class NotificationsService {
  private readonly handlers = new Map<string, NotificationActionHandler>();

  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly replay: ReplayService,
    private readonly now: () => number = Date.now,
  ) {}

  /** Registers what happens when a user taps an action (`<kind>:<key>` or `*:<key>`). */
  registerAction(kind: string, key: string, handler: NotificationActionHandler): void {
    this.handlers.set(`${kind}:${key}`, handler);
  }

  async create(input: CreateNotificationInput): Promise<NotificationRow[]> {
    const created = await withTenant(this.db, input.tenantId, async (tx) => {
      let targets = input.userIds ?? [];
      if (input.roles?.length) {
        const rows = await tx
          .select({ id: users.id })
          .from(users)
          .where(inArray(users.role, input.roles));
        targets = [...new Set([...targets, ...rows.map((r) => r.id)])];
      }
      if (targets.length === 0) return [];
      const since = new Date(this.now() - NOTIFICATION_DEDUPE_MS);
      const recent = input.subject
        ? await tx
            .select({ userId: notifications.userId })
            .from(notifications)
            .where(
              and(
                eq(notifications.kind, input.kind),
                eq(notifications.subject, input.subject),
                isNull(notifications.readAt),
                gt(notifications.createdAt, since),
                inArray(notifications.userId, targets),
              ),
            )
        : [];
      const skip = new Set(recent.map((r) => r.userId));
      const fresh = targets.filter((u) => !skip.has(u));
      if (fresh.length === 0) return [];
      const rows = await tx
        .insert(notifications)
        .values(
          fresh.map((userId) => ({
            tenantId: input.tenantId,
            userId,
            kind: input.kind,
            title: input.title,
            body: input.body ?? null,
            subject: input.subject ?? null,
            actions: input.actions ?? [],
            createdAt: new Date(this.now()),
          })),
        )
        .returning();
      await this.audit.record(tx, {
        tenantId: input.tenantId,
        action: 'notification.create',
        entityType: 'notification',
        entityId: input.subject ?? null,
        after: { kind: input.kind, title: input.title, recipients: rows.length },
      });
      return rows;
    });
    for (const row of created) {
      await this.replay.append(input.tenantKey, {
        kind: 'notification',
        tenantKey: input.tenantKey,
        ts: this.now(),
        userId: row.userId!,
        notificationId: row.id,
        title: row.title,
        body: row.body ?? undefined,
      });
    }
    return created;
  }

  async list(
    tenantId: string,
    userId: string,
    query: { page: number; pageSize: number; unread?: boolean },
  ): Promise<NotificationsResponse> {
    return withTenant(this.db, tenantId, async (tx) => {
      const mine = eq(notifications.userId, userId);
      const where = query.unread ? and(mine, isNull(notifications.readAt)) : mine;
      const items = await tx
        .select()
        .from(notifications)
        .where(where)
        .orderBy(desc(notifications.createdAt))
        .limit(query.pageSize)
        .offset(query.page * query.pageSize);
      const totals = await tx.select({ total: count() }).from(notifications).where(where);
      const unreadRows = await tx
        .select({ unread: count() })
        .from(notifications)
        .where(and(mine, isNull(notifications.readAt)));
      return {
        items: items.map(toNotificationDto),
        total: Number(totals[0]?.total ?? 0),
        page: query.page,
        pageSize: query.pageSize,
        unread: Number(unreadRows[0]?.unread ?? 0),
      };
    });
  }

  async markRead(tenantId: string, userId: string, id: string): Promise<Notification> {
    return withTenant(this.db, tenantId, async (tx) => {
      const [row] = await tx
        .update(notifications)
        .set({ readAt: sql`coalesce(${notifications.readAt}, now())` })
        .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
        .returning();
      if (!row) throw notFound('Notification not found');
      return toNotificationDto(row);
    });
  }

  async markAllRead(tenantId: string, userId: string): Promise<number> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx
        .update(notifications)
        .set({ readAt: new Date(this.now()) })
        .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
        .returning({ id: notifications.id });
      return rows.length;
    });
  }

  async act(
    tenant: { id: string; key: string },
    userId: string,
    id: string,
    key: string,
  ): Promise<Notification> {
    const row = await withTenant(this.db, tenant.id, async (tx) => {
      const rows = await tx
        .select()
        .from(notifications)
        .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
        .limit(1);
      const found = rows[0];
      if (!found) throw notFound('Notification not found');
      if (!found.actions.some((a) => a.key === key)) throw notFound('Unknown action');
      return found;
    });
    const handler = this.handlers.get(`${row.kind}:${key}`) ?? this.handlers.get(`*:${key}`);
    if (handler) await handler({ tenant, userId, notification: row, key });
    return withTenant(this.db, tenant.id, async (tx) => {
      const [updated] = await tx
        .update(notifications)
        .set({ actedAt: new Date(this.now()), actedKey: key, readAt: new Date(this.now()) })
        .where(eq(notifications.id, id))
        .returning();
      await this.audit.record(tx, {
        tenantId: tenant.id,
        action: 'notification.act',
        entityType: 'notification',
        entityId: id,
        after: { kind: row.kind, key, subject: row.subject },
      });
      return toNotificationDto(updated!);
    });
  }
}
