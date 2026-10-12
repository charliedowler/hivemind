import OpenAI from "openai";
export const embeddingDimensions = 1536;

export async function embedText(text: string): Promise<number[] | null> {
  if (!process.env.OPENAI_API_KEY) return null;
  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 8000, maxRetries: 0 });
    const response = await client.embeddings.create({ model: "text-embedding-3-small", dimensions: embeddingDimensions, input: text.slice(0, 8000) });
    const vector = response.data[0]?.embedding;
    return vector?.length === embeddingDimensions && vector.every(Number.isFinite) ? vector : null;
  } catch {
    return null;
  }
}
