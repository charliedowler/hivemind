import { beginCall, reportedModel } from "../analytics/events";
import OpenAI from "openai";
export const embeddingDimensions = 1536;

export async function embedText(text: string): Promise<number[] | null> {
  if (!process.env.OPENAI_API_KEY) return null;
  const finish = await beginCall(
    "model",
    "embedding",
    "text-embedding-3-small",
  );
  try {
    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: 6000,
      maxRetries: 2,
    });
    const response = await client.embeddings.create({
      model: "text-embedding-3-small",
      dimensions: embeddingDimensions,
      input: text.slice(0, 8000),
    });
    const vector = response.data[0]?.embedding;
    const valid =
      vector?.length === embeddingDimensions && vector.every(Number.isFinite);
    await finish(
      valid ? "completed" : "failed",
      valid ? null : "invalid_response",
      {
        inputTokens: response.usage?.prompt_tokens,
        model: reportedModel(response.model),
      },
    );
    return valid ? vector! : null;
  } catch (error) {
    await finish("failed", "provider_failed");
    console.warn(
      `Embedding failed: ${error instanceof Error ? error.name : "UnknownError"}`,
    );
    return null;
  }
}
