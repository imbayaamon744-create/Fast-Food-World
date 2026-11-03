import { z } from "zod";
export const id = z.uuid();
export const slug = z.string().min(1).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const text = (max: number) => z.string().trim().min(1).max(max);
export const phone = z.string().trim().regex(/^\+?[0-9 ()-]{7,30}$/).refine(v => v.replace(/\D/g, "").length >= 7, "Enter a phone number");
export const email = z.email().trim().toLowerCase().max(254);
export const password = z.string().min(12).max(128);
export const money = z.number().int().min(0).max(1000000);
const optionalNote = (max: number) => z.string().trim().max(max).optional();
export const basketSchema = z.object({
  items: z.array(z.object({ menuItemId: id, quantity: z.number().int().min(1).max(20) }).strict()).min(1).max(50)
    .refine(items => new Set(items.map(i => i.menuItemId)).size === items.length, "Use one line per menu item"),
  fulfilment: z.enum(["PICKUP", "DELIVERY"]),
}).strict();
export const orderSchema = basketSchema.extend({
  customerName: text(100),
  phone,
  deliveryAddress: text(400).optional(),
  notes: optionalNote(1000),
  quoteFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  expectedTotalMinor: z.number().int().min(0).max(1001000000),
}).superRefine((v, ctx) => {
  if (v.fulfilment === "DELIVERY" && !v.deliveryAddress) ctx.addIssue({ code: "custom", path: ["deliveryAddress"], message: "Delivery requires an address" });
  if (v.fulfilment === "PICKUP" && v.deliveryAddress) ctx.addIssue({ code: "custom", path: ["deliveryAddress"], message: "Omit the address for pickup" });
});
export type BasketInput = z.infer<typeof basketSchema>;
export type OrderInput = z.infer<typeof orderSchema>;
export const loginSchema = z.object({ email, password: z.string().min(1).max(128) }).strict();
export const menuQuery = z.object({
  search: z.string().trim().max(100).optional(),
  category: slug.optional(),
  available: z.enum(["true", "false"]).optional(),
}).strict();
const imageReference = z.string().max(1000).refine(v => {
  // No uploads, data URLs, executable protocols, or protocol-relative URLs.
  if (/^images\/[a-zA-Z0-9_./-]+$/.test(v)) return !v.includes("..");
  try { const u = new URL(v); return u.protocol === "https:" && !u.username && !u.password; } catch { return false; }
}, "Use an HTTPS image URL or a relative images/ path").nullable();
export const menuCreateSchema = z.object({
  slug, name: text(120), description: text(600), priceMinor: money,
  available: z.boolean().default(true), imageUrl: imageReference.optional(),
  categoryId: id, sortOrder: z.number().int().min(0).max(10000).default(0),
}).strict();
export const menuUpdateSchema = menuCreateSchema.partial().refine(v => Object.keys(v).length > 0);
export const categorySchema = z.object({ slug, name: text(80), sortOrder: z.number().int().min(0).max(10000).default(0) }).strict();
export const categoryUpdateSchema = categorySchema.partial().refine(v => Object.keys(v).length > 0);
export const settingsSchema = z.object({
  name: text(120), deliveryFeeMinor: money, acceptingOrders: z.boolean(),
  pickupEnabled: z.boolean(), deliveryEnabled: z.boolean(),
  address: text(400), phone: phone.nullable(), email: email.nullable(), openingHours: text(300),
}).partial().strict().refine(v => Object.keys(v).length > 0);
export const orderStatus = z.enum(["PENDING", "ACCEPTED", "PREPARING", "READY", "OUT_FOR_DELIVERY", "COMPLETED", "CANCELLED"]);
export const statusSchema = z.object({ expectedStatus: orderStatus, status: orderStatus, reason: text(1000).optional() }).strict()
  .superRefine((v, ctx) => {
    if (v.status === "CANCELLED" && !v.reason) ctx.addIssue({ code: "custom", path: ["reason"], message: "A cancellation reason is required" });
    if (v.status !== "CANCELLED" && v.reason) ctx.addIssue({ code: "custom", path: ["reason"], message: "Only cancellation accepts a reason" });
  });
export const pageSchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});
export const orderListSchema = pageSchema.extend({ status: orderStatus.optional() }).strict();
export const cateringStatus = z.enum(["PENDING", "CONFIRMED", "DECLINED", "REQUESTED", "CONTACTED", "CLOSED"]);
export const cateringListSchema = pageSchema.extend({ status: cateringStatus.optional() }).strict();
export function nairobiDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Nairobi", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
export const cateringSchema = z.object({
  customerName: text(100), phone,
  eventDate: z.iso.date().refine(v => v >= nairobiDate(), "Choose today or a future date in Nairobi"),
  location: text(400), guestCount: z.number().int().min(1).max(10000),
  package: z.enum(["Classic", "Premium", "Deluxe"]),
  eventDetails: optionalNote(2000),
}).strict();
export const cateringUpdateSchema = z.object({
  quoteMinor: z.number().int().min(0).max(1000000000).nullable().optional(),
  expectedStatus: cateringStatus, status: cateringStatus, adminNotes: z.string().trim().max(2000).optional(),
}).strict();
export const trackingSchema = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) }).strict();


export const emptySchema = z.object({}).strict();
