import { randomUUID } from "node:crypto";
import { Prisma, type OrderStatus, type Fulfilment, type Order } from "./generated/prisma/client.js";
import type { Database } from "./db.js";
import type { BasketInput, OrderInput } from "./validation.js";
import { HttpError } from "./errors.js";
import { hash, trackingToken } from "./security.js";

export function canTransition(from: OrderStatus, to: OrderStatus, fulfilment: Fulfilment) {
  const next: Record<OrderStatus, OrderStatus[]> = {
    PENDING: ["CANCELLED"], ACCEPTED: ["PREPARING", "CANCELLED"],
    PREPARING: ["READY", "CANCELLED"],
    READY: fulfilment === "PICKUP" ? ["COMPLETED", "CANCELLED"] : ["OUT_FOR_DELIVERY", "CANCELLED"],
    OUT_FOR_DELIVERY: fulfilment === "DELIVERY" ? ["COMPLETED", "CANCELLED"] : ["CANCELLED"], COMPLETED: [], CANCELLED: [],
  };
  return next[from].includes(to);
}
export function normalizedRequest(input: OrderInput) {
  return { ...input, items: [...input.items].sort((a, b) => a.menuItemId.localeCompare(b.menuItemId)) };
}
export async function quote(tx: Prisma.TransactionClient, input: BasketInput) {
  const settings = await tx.restaurantSettings.findUnique({ where: { id: "restaurant" } });
  if (!settings) throw new HttpError(503, "NOT_CONFIGURED", "Restaurant setup is incomplete");
  if (!settings.acceptingOrders || (input.fulfilment === "PICKUP" ? !settings.pickupEnabled : !settings.deliveryEnabled)) {
    throw new HttpError(409, "ORDERING_UNAVAILABLE", "This fulfilment option is currently unavailable");
  }
  const menu = await tx.menuItem.findMany({ where: { id: { in: input.items.map(i => i.menuItemId) } } });
  const items = input.items.map(line => {
    const item = menu.find(m => m.id === line.menuItemId);
    if (!item?.available) throw new HttpError(409, "ITEM_UNAVAILABLE", "An item is no longer available; refresh the menu");
    return { menuItemId: item.id, name: item.name, quantity: line.quantity, unitPriceMinor: item.priceMinor, lineTotalMinor: item.priceMinor * line.quantity };
  });
  const subtotalMinor = items.reduce((total, item) => total + item.lineTotalMinor, 0);
  const deliveryFeeMinor = input.fulfilment === "DELIVERY" ? settings.deliveryFeeMinor : 0;
  const result = { currency: settings.currency, fulfilment: input.fulfilment, items, subtotalMinor, deliveryFeeMinor, totalMinor: subtotalMinor + deliveryFeeMinor };
  return { ...result, quoteFingerprint: hash(JSON.stringify({ ...result, items: [...items].sort((a, b) => a.menuItemId.localeCompare(b.menuItemId)) })) };
}
export async function serializable<T>(db: Database, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await db.$transaction(fn, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); }
    catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034" && attempt < 3) continue;
      throw error;
    }
  }
}
const publicInclude = { items: true, history: { orderBy: { createdAt: "asc" as const } } };
export function publicOrder(order: Order & { items: Array<{ menuItemId: string; name: string; quantity: number; unitPriceMinor: number; lineTotalMinor: number }>; history: Array<{ toStatus: OrderStatus; createdAt: Date; reason?: string | null }> }) {
  // Tracking deliberately omits name, phone, address, internal IDs, keys and notes.
  return {
    id: order.id, status: order.status, fulfilment: order.fulfilment, currency: order.currency,
    subtotalMinor: order.subtotalMinor, deliveryFeeMinor: order.deliveryFeeMinor, totalMinor: order.totalMinor,
    createdAt: order.createdAt, updatedAt: order.updatedAt,
    items: order.items.map(i => ({ menuItemId: i.menuItemId, name: i.name, quantity: i.quantity, unitPriceMinor: i.unitPriceMinor, lineTotalMinor: i.lineTotalMinor })),
    history: order.history.map(h => ({ status: h.toStatus, createdAt: h.createdAt, reason: h.reason ?? null })),
  };
}
export async function createOrder(db: Database, input: OrderInput, key: string, secret: string) {
  const idempotencyHash = hash(key);
  const requestHash = hash(JSON.stringify(normalizedRequest(input)));
  const replay = (order: NonNullable<Awaited<ReturnType<typeof findExisting>>>) => {
    if (order.requestHash !== requestHash) throw new HttpError(409, "IDEMPOTENCY_CONFLICT", "This submission key was already used for different details");
    return { order: publicOrder(order), trackingToken: trackingToken(key, order.id, secret), replayed: true };
  };
  const findExisting = () => db.order.findUnique({ where: { idempotencyHash }, include: publicInclude });
  const existing = await findExisting();
  if (existing) return replay(existing);
  try {
    return await serializable(db, async tx => {
      const prior = await tx.order.findUnique({ where: { idempotencyHash }, include: publicInclude });
      if (prior) return replay(prior);
      const totals = await quote(tx, input);
      if (totals.totalMinor !== input.expectedTotalMinor || totals.quoteFingerprint !== input.quoteFingerprint) throw new HttpError(409, "PRICE_CHANGED", "Menu prices or details changed; review a new quote before submitting");
      const orderId = randomUUID();
      const privateToken = trackingToken(key, orderId, secret);
      const { items, quoteFingerprint: _fingerprint, ...amounts } = totals;
      const order = await tx.order.create({
        data: {
          id: orderId, idempotencyHash, requestHash, trackingTokenHash: hash(privateToken),
          customerName: input.customerName, phone: input.phone, deliveryAddress: input.deliveryAddress,
          notes: input.notes, ...amounts, status: "ACCEPTED",
          items: { create: items }, history: { create: { toStatus: "ACCEPTED" } },
        }, include: publicInclude,
      });
      return { order: publicOrder(order), trackingToken: privateToken, replayed: false };
    });
  } catch (error) {
    // A simultaneous submission may win the unique constraint after our read.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const prior = await findExisting();
      if (prior) return replay(prior);
    }
    throw error;
  }
}
export async function trackOrder(db: Database, privateToken: string) {
  const order = await db.order.findUnique({ where: { trackingTokenHash: hash(privateToken) }, include: publicInclude });
  if (!order) throw new HttpError(404, "ORDER_NOT_FOUND", "Order not found");
  return publicOrder(order);
}
export async function changeStatus(db: Database, id: string, expectedStatus: OrderStatus, status: OrderStatus, adminId: string, reason?: string) {
  const cancellationReason = reason?.trim();
  if (status === "CANCELLED" && (!cancellationReason || cancellationReason.length > 1000)) throw new HttpError(400, "CANCELLATION_REASON_REQUIRED", "Enter a cancellation reason of 1 to 1000 characters");
  return serializable(db, async tx => {
    const order = await tx.order.findUnique({ where: { id } });
    if (!order) throw new HttpError(404, "ORDER_NOT_FOUND", "Order not found");
    if (order.status !== expectedStatus) throw new HttpError(409, "STALE_ORDER", "Order changed; refresh before trying again");
    if (!canTransition(order.status, status, order.fulfilment)) throw new HttpError(409, "INVALID_TRANSITION", "This status change is not allowed");
    const result = await tx.order.updateMany({ where: { id, status: expectedStatus }, data: { status } });
    if (result.count !== 1) throw new HttpError(409, "STALE_ORDER", "Order changed; refresh before trying again");
    await tx.orderStatusHistory.create({ data: { orderId: id, fromStatus: expectedStatus, toStatus: status, adminId, reason: status === "CANCELLED" ? cancellationReason : null } });
    return tx.order.findUniqueOrThrow({ where: { id }, include: publicInclude });
  });
}

export async function recoverOrder(db: Database, key: string, secret: string) {
  const order = await db.order.findUnique({ where: { idempotencyHash: hash(key) }, include: publicInclude });
  if (!order) throw new HttpError(404, "SUBMISSION_NOT_FOUND", "No stored order found for this submission yet");
  return { order: publicOrder(order), trackingToken: trackingToken(key, order.id, secret), replayed: true };
}
