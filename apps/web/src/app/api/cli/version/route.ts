import { cliVersion } from "@/lib/cli-version";

export const dynamic = "force-static";

export function GET() {
  return Response.json(cliVersion, {
    headers: { "Cache-Control": "public, max-age=300, s-maxage=3600" },
  });
}
