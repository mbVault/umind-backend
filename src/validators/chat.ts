import { z } from "zod";

/** Cursor-paginated history query for psychologist–client chat. */
export const chatMessagesQuerySchema = z
  .object({
    /** Opaque cursor from a previous page (`nextCursor`). Loads older messages. */
    cursor: z.string().min(1).max(512).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

export type ChatMessagesQuery = z.infer<typeof chatMessagesQuerySchema>;
