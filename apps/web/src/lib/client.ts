import { formatRecency } from "@hivemind/core";
export async function requestJson<T>(
  url: string,
  body?: unknown,
  signal?: AbortSignal,
  method?: string,
): Promise<T> {
  const response = await fetch(url, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
    cache: "no-store",
  });
  if (response.status === 204) return undefined as T;
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "The request failed. Please try again.");
  return data as T;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The request failed. Please try again.";
}

export function relativeTime(date: string): string {
  return formatRecency(date);
}
