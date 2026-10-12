import { httpError } from "@/lib/http";
import { downloadKnowledge } from "@/server/knowledge-tree";
export const maxDuration = 60;
export async function GET(request: Request) {
  try {
    const archive = await downloadKnowledge(
      new URL(request.url).searchParams.get("token") ?? "",
    );
    return new Response(new Uint8Array(archive), {
      headers: {
        "Content-Type": "application/gzip",
        "Content-Disposition": 'attachment; filename="hive-snapshot.tar.gz"',
        "Cache-Control": "private, no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch (error) {
    return httpError(error);
  }
}
