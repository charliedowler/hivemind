import { clientBeacon } from "@/server/analytics/beacons";
export const runtime = "nodejs";
export const POST = (request: Request) => clientBeacon(request, "hook");
