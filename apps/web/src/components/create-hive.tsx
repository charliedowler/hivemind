"use client";
import { useRef, useState } from "react";
import { Button, Card, Sprite } from "@hivemind/design-system";
import { requestJson, errorMessage } from "@/lib/client";
export function CreateHive() {
  const key = useRef<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function create() {
    key.current ??= crypto.randomUUID();
    setPending(true);
    setError("");
    try {
      const result = await requestJson<{ teamId: string }>(
        "/api/app/create-organisation",
        { requestKey: key.current },
      );
      window.location.assign(
        `/app/create-hive?created=${encodeURIComponent(result.teamId)}`,
      );
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setPending(false);
    }
  }
  return (
    <Card className="stack">
      <Sprite name="hive-entrance" scale={4} />
      <h1>Create a hive for your team</h1>
      <p>
        Your personal hive stays yours. If Hive learns only from projects you
        listed, those are shared with the new hive. Otherwise Hive asks before
        it shares anything.
      </p>
      <Button onClick={() => void create()} loading={pending}>
        Create a hive for your team
      </Button>
      {error ? <p role="alert">{error}</p> : null}
    </Card>
  );
}
