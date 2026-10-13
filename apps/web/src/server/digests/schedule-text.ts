import { digestCadence, type DigestScheduleInput } from "@hivemind/core";

export function restateSchedule(schedule: DigestScheduleInput) {
  return digestCadence(schedule);
}
