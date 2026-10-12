"use client";

import { useConsent, useExplicitChoice } from "c15t/next";

export function useMeasurementConsent() {
  const permitted = useConsent("measurement");
  const choice = useExplicitChoice();
  return permitted && choice?.categories.measurement?.value === true;
}
