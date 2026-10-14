import { describeWorkAreas } from "@hivemind/core";

export function shareQuestion(teamName: string, workAreas?: string | null) {
  const areas = describeWorkAreas(workAreas);
  return areas ? `Share your learnings about ${areas} with ${teamName}?` : `Share your learnings with ${teamName}?`;
}
export const shareExplanation = (teamName: string) =>
  `Yes shares the cells Hive captures from your repos with ${teamName}, now and in future. Your originals stay in your personal hive, and you can change this later on the Team page.`;
export const shareAllInstruction = (teamName: string) =>
  `Share everything Hive captures for me with ${teamName}, now and in future.`;
export const shareCheckboxLabel = (teamName: string) => `Share what Hive learns with ${teamName}`;
export const shareTickedExplanation = (teamName: string) =>
  `With this ticked, ${teamName} sees the cells Hive captures from your repos, now and in future. Your originals stay in your personal hive, and you can change this later on the Team page.`;
