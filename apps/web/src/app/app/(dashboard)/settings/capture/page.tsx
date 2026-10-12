import { redirect } from "next/navigation";
import { CaptureRules } from "@/components/capture-rules";
import { getWebContext } from "@/server/auth";
import {
  listCaptureRules,
  listCaptureRuleApplications,
} from "@/server/capture-rules";
import { requireAdmin } from "@/server/identity/access";

export default async function Page() {
  const ctx = await getWebContext();
  if (!ctx) redirect("/app/login");
  const [rules, applications, isAdmin] = await Promise.all([
    listCaptureRules(ctx),
    listCaptureRuleApplications(ctx),
    requireAdmin(ctx)
      .then(() => true)
      .catch(() => false),
  ]);
  return <CaptureRules initial={{ rules, applications, isAdmin }} />;
}
