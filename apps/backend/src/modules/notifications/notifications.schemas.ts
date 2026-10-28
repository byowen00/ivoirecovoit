import { z } from 'zod';

export const listNotificationsQuery = z.object({
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  unread: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
});
export type ListNotificationsQuery = z.infer<typeof listNotificationsQuery>;

export const markReadSchema = z.union([
  z.object({ all: z.literal(true) }),
  z.object({ ids: z.array(z.uuid()).min(1).max(100) }),
]);
export type MarkReadInput = z.infer<typeof markReadSchema>;

export const deviceSchema = z.object({
  platform: z.enum(['ANDROID', 'IOS', 'WEB']),
  token: z.string().trim().min(20).max(4096),
});
export type DeviceInput = z.infer<typeof deviceSchema>;

export const removeDeviceSchema = z.object({ token: z.string().trim().min(20).max(4096) });

export const preferencesSchema = z
  .object({ REMINDERS: z.boolean(), MESSAGES: z.boolean(), REVIEWS: z.boolean() })
  .partial()
  .strict();
export type NotificationPreferencesInput = z.infer<typeof preferencesSchema>;
