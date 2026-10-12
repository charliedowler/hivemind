"use client";

import { useState, type FormEvent } from "react";
import { Button, Input } from "@hivemind/design-system";
import { requestJson } from "@/lib/client";

export function WaitlistForm() {
  const [status, setStatus] = useState<"idle" | "pending" | "done" | "error">(
    "idle",
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = new FormData(event.currentTarget).get("email");
    setStatus("pending");
    try {
      await requestJson("/api/waitlist", { email });
      setStatus("done");
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className="waitlist-signup">
      {status === "done" ? (
        <div className="waitlist-success" role="status">
          <h2>You're on the list.</h2>
          <p>We'll email you when your team can join the hive.</p>
        </div>
      ) : (
        <form
          onSubmit={submit}
          aria-label="Join the waitlist"
          className="waitlist-form"
        >
          <Input
            label="Email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@yourteam.com"
            maxLength={254}
            required
          />
          {status === "error" ? (
            <p role="alert">
              We couldn't add your email. Check the address and try again.
            </p>
          ) : null}
          <Button
            type="submit"
            variant="accent"
            size="lg"
            disabled={status === "pending"}
            aria-busy={status === "pending"}
            fullWidth
          >
            {status === "pending"
              ? "Joining the waitlist"
              : "Join the waitlist"}
          </Button>
        </form>
      )}
      <p className="waitlist-note">
        We'll only use this email to send your invitation.
      </p>
    </div>
  );
}
