import type { MemberView } from "@hivemind/core";
type Member = MemberView & {
  actorType?: string;
  ownerId?: string | null;
  ownerName?: string | null;
};
export function memberGroups(members: Member[]) {
  const humans = members.filter((member) => member.actorType !== "agent");
  const agents = members.filter((member) => member.actorType === "agent");
  const byOwner = new Map<string, Member[]>();
  const humanIds = new Set(humans.map((human) => human.id));
  const ownerless: Member[] = [];
  for (const agent of agents) {
    if (!agent.ownerId || !humanIds.has(agent.ownerId)) {
      ownerless.push(agent);
      continue;
    }
    const group = byOwner.get(agent.ownerId) ?? [];
    group.push(agent);
    byOwner.set(agent.ownerId, group);
  }
  return {
    owners: humans.map((human) => ({
      human,
      agents: byOwner.get(human.id) ?? [],
    })),
    ownerless,
  };
}
