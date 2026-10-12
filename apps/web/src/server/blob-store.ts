import { get, put } from "@vercel/blob";
import { HiveUnavailableError } from "./errors";

function requireStorage() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw new HiveUnavailableError("Private storage is unavailable. Connect a private Blob store to publish the hive tree.");
}
export async function putPrivateObject(key: string, content: Buffer, contentType: string) {
  requireStorage();
  await put(key, content, { access: "private", addRandomSuffix: false, allowOverwrite: true, contentType, cacheControlMaxAge: 31536000 });
}
export async function readPrivateObject(key: string): Promise<Buffer> {
  requireStorage();
  const result = await get(key, { access: "private", useCache: false });
  if (!result || result.statusCode !== 200) throw new HiveUnavailableError("The hive file is not available in private storage. Rebuild the tree and try again.");
  return Buffer.from(await new Response(result.stream).arrayBuffer());
}
