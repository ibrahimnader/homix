import { logger } from "../../shared/logger/logger";
import {
  dropActorAndDuplicates,
  publishNotificationsSafely,
  resolveAdminUserIds,
  resolveOrderVendorUserIds,
} from "../notification/notification.publisher";
import type { NotificationRow } from "../notification/notification.publisher";
import { TICKET_STATUS_ARABIC } from "./ticket.constants";

/**
 * Ticket notifications (entityType "ticket", entityId = the ticket id; the bell shows them in the
 * "التذاكر" tab and opens /tickets/:id). Participants come from the ticket model:
 * creator (createdByUserId), assignee (assignedToUserId) and - for replies - the vendor users that own the
 * ticket's order (vendors can open the ticket, so they are participants too).
 *
 * Events and recipients (the actor is NEVER notified, nobody gets two notifications for one event):
 *  - created        -> the assignee; when the ticket has no assignee yet, the admins (nobody owns it, admins triage).
 *  - assigned       -> the NEW assignee only.
 *  - status changed -> creator + assignee. If the same update also assigned the ticket, the new assignee
 *                      gets just the assignment notification (assignment wins, see buildUpdateRows).
 *  - new reply/note -> creator, assignee and the order's vendor users (minus the author).
 *  - deleted        -> intentionally NOT notified: the link of such a notification would open a 404.
 *
 * Every function is failure-safe (never throws) and is called only after the business operation succeeded.
 */

export const TICKET_CREATED_PREFIX = "تم إنشاء تذكرة جديدة";
export const TICKET_ASSIGNED_PREFIX = "تم إسناد التذكرة";
export const TICKET_STATUS_PREFIX = "تم تغيير حالة التذكرة";
export const TICKET_REPLY_PREFIX = "تم إضافة رد جديد على التذكرة";

type MaybeId = number | string | null | undefined;

const ticketRef = (ticketId: number): string => `رقم #${ticketId}`;
const forOrder = (orderNumber?: string | null): string => (orderNumber ? ` للطلب ${orderNumber}` : "");

export const buildTicketCreatedText = (ticketId: number, orderNumber?: string | null): string =>
  `${TICKET_CREATED_PREFIX} ${ticketRef(ticketId)}${forOrder(orderNumber)}`;
export const buildTicketAssignedText = (ticketId: number, orderNumber?: string | null): string =>
  `${TICKET_ASSIGNED_PREFIX} ${ticketRef(ticketId)}${forOrder(orderNumber)} إليك`;
export const buildTicketStatusText = (ticketId: number, status: number): string =>
  `${TICKET_STATUS_PREFIX} ${ticketRef(ticketId)} إلى ${TICKET_STATUS_ARABIC[status as keyof typeof TICKET_STATUS_ARABIC] ?? status}`;
export const buildTicketReplyText = (ticketId: number, orderNumber?: string | null): string =>
  `${TICKET_REPLY_PREFIX} ${ticketRef(ticketId)}${forOrder(orderNumber)}`;

const toRows = (userIds: ReadonlyArray<MaybeId>, ticketId: number, text: string): NotificationRow[] =>
  userIds
    .map((userId) => Number(userId))
    .filter((userId) => Number.isInteger(userId) && userId > 0)
    .map((userId) => ({ entityId: ticketId, entityType: "ticket", text, userId }));

export const notifyTicketCreated = async (
  ticket: { assignedToUserId?: MaybeId; id: number; orderNumber?: string | null },
  actorId: MaybeId,
): Promise<void> => {
  try {
    const assignee = Number(ticket.assignedToUserId);
    const recipients = Number.isInteger(assignee) && assignee > 0 ? [assignee] : await resolveAdminUserIds();
    await publishNotificationsSafely(
      dropActorAndDuplicates(toRows(recipients, ticket.id, buildTicketCreatedText(ticket.id, ticket.orderNumber)), actorId),
      "ticket-created",
    );
  } catch (error) {
    logger.error({ err: error }, "Failed to build ticket-created notifications");
  }
};

export const buildUpdateRows = (input: {
  after: { assignedToUserId?: MaybeId; status?: MaybeId };
  before: { assignedToUserId?: MaybeId; createdByUserId?: MaybeId; status?: MaybeId };
  orderNumber?: string | null;
  ticketId: number;
}): NotificationRow[] => {
  const { after, before, orderNumber, ticketId } = input;
  const rows: NotificationRow[] = [];

  const newAssignee = Number(after.assignedToUserId);
  const assigneeChanged = Number.isInteger(newAssignee) && newAssignee > 0
    && newAssignee !== Number(before.assignedToUserId ?? 0);
  /* Assignment first: dropActorAndDuplicates keeps the first row per user, so the new assignee never also
     receives the status notification of the same update. */
  if (assigneeChanged) {
    rows.push(...toRows([newAssignee], ticketId, buildTicketAssignedText(ticketId, orderNumber)));
  }

  const nextStatus = Number(after.status);
  if (Number.isInteger(nextStatus) && nextStatus > 0 && nextStatus !== Number(before.status ?? 0)) {
    rows.push(...toRows(
      [before.createdByUserId, after.assignedToUserId],
      ticketId,
      buildTicketStatusText(ticketId, nextStatus),
    ));
  }
  return rows;
};

export const notifyTicketUpdated = async (
  input: Parameters<typeof buildUpdateRows>[0],
  actorId: MaybeId,
): Promise<void> => {
  try {
    await publishNotificationsSafely(dropActorAndDuplicates(buildUpdateRows(input), actorId), "ticket-updated");
  } catch (error) {
    logger.error({ err: error }, "Failed to build ticket-update notifications");
  }
};

export const notifyTicketReply = async (
  ticket: {
    assignedToUserId?: MaybeId;
    createdByUserId?: MaybeId;
    id: number;
    orderId?: MaybeId;
    orderNumber?: string | null;
  },
  actorId: MaybeId,
): Promise<void> => {
  try {
    const orderId = Number(ticket.orderId);
    const vendorUserIds = Number.isInteger(orderId) && orderId > 0 ? await resolveOrderVendorUserIds(orderId) : [];
    const rows = toRows(
      [ticket.createdByUserId, ticket.assignedToUserId, ...vendorUserIds],
      ticket.id,
      buildTicketReplyText(ticket.id, ticket.orderNumber),
    );
    await publishNotificationsSafely(dropActorAndDuplicates(rows, actorId), "ticket-reply");
  } catch (error) {
    logger.error({ err: error }, "Failed to build ticket-reply notifications");
  }
};
