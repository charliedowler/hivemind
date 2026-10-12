import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Card } from "@hivemind/design-system";
import { LearningDetail } from "@/components/learning-dialog";
import { getWebContext } from "@/server/auth";
import { getLearning } from "@/server/hive";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await getWebContext();
  if (!ctx) redirect("/app/login");
  const learning = await getLearning(ctx, (await params).id);
  if (!learning) notFound();
  return (
    <div className="stack cell-page">
      <Link href="/app" className="text-button">
        Back to the comb
      </Link>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Inside the cell</span>
          <h1>{learning.title}</h1>
        </div>
      </div>
      <Card>
        <LearningDetail learning={learning} />
      </Card>
    </div>
  );
}
