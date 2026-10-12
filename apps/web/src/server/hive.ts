import type {
  AskResult,
  EarlyAccessInput,
  FeedbackResult,
  HiveAskInput,
  HiveContext,
  HiveFeedbackInput,
  HivePushInput,
  HiveRecentInput,
  HiveSearchInput,
  LearningView,
  MemberView,
  PushResult,
  SearchHit,
  TeamOverview,
} from "@hivemind/core";

const notImplemented = (name: string): never => {
  throw new Error(`${name} is not implemented yet`);
};

export async function pushLearning(ctx: HiveContext, input: HivePushInput): Promise<PushResult> {
  return notImplemented("pushLearning");
}

export async function searchLearnings(ctx: HiveContext, input: HiveSearchInput): Promise<SearchHit[]> {
  return notImplemented("searchLearnings");
}

export async function askHive(ctx: HiveContext, input: HiveAskInput): Promise<AskResult> {
  return notImplemented("askHive");
}

export async function recentLearnings(ctx: HiveContext, input: HiveRecentInput): Promise<LearningView[]> {
  return notImplemented("recentLearnings");
}

export async function recordFeedback(ctx: HiveContext, input: HiveFeedbackInput): Promise<FeedbackResult> {
  return notImplemented("recordFeedback");
}

export async function getLearning(ctx: HiveContext, id: string): Promise<LearningView | null> {
  return notImplemented("getLearning");
}

export async function listMembers(ctx: HiveContext): Promise<MemberView[]> {
  return notImplemented("listMembers");
}

export async function teamOverview(ctx: HiveContext): Promise<TeamOverview> {
  return notImplemented("teamOverview");
}

export async function submitEarlyAccess(input: EarlyAccessInput): Promise<{ id: string }> {
  return notImplemented("submitEarlyAccess");
}
