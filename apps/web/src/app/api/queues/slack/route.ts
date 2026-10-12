import { handleCallback } from "@vercel/queue";
import { runSlackJob, retrySlack } from "@/server/slack/events";
export const maxDuration = 300;
export const POST = handleCallback(
  async (reference) => {
    await runSlackJob(reference as Parameters<typeof runSlackJob>[0]);
  },
  {
    visibilityTimeoutSeconds: 330,
    retry: (error, metadata) => retrySlack(error, metadata.deliveryCount),
  },
);
