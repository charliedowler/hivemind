import { z } from "zod";

export const hiveRegistration = z.discriminatedUnion("intent", [
  z.object({ intent: z.literal("create"), teamName: z.string().trim().min(1).max(80) }),
  z.object({ intent: z.literal("invite"), inviteCode: z.string().trim().min(4).max(200) }),
  z.object({ intent: z.literal("domain") }),
]);

export type HiveRegistration = z.infer<typeof hiveRegistration>;
