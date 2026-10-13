export function renderWelcome({
  name,
  claimUrl,
}: {
  name: string;
  claimUrl: string;
}) {
  const escape = (value: string) =>
    value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  const message =
    "Your agent set up your personal Hive. Open Hive to see its learnings and join your organisation.";
  return {
    subject: "Your personal Hive is ready",
    text: `${name},\n\n${message}\n\nOpen Hive: ${claimUrl}\n\nCreate a hive for your team: https://gohive.dev/app/create-hive`,
    html: `<p>${escape(name)},</p><p>${message}</p><p><a href="${escape(claimUrl)}">Open Hive</a></p><p><a href="https://gohive.dev/app/create-hive">Create a hive for your team</a></p>`,
  };
}

export function renderOrganisationCreated({
  name,
  teamName,
  joinUrl,
  invitePrompt,
  joinPaused,
}: {
  name: string;
  teamName: string;
  joinUrl: string;
  invitePrompt: string;
  joinPaused: boolean;
}) {
  const escape = (value: string) =>
    value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  const paused = joinPaused
    ? "Joining is paused. Add an allowed work domain and resume joining on the Team page."
    : "";
  return {
    subject: `${teamName} is ready on Hive`,
    text: `${name},\n\n${teamName} is ready. Invite your team:\n\n${invitePrompt}\n\nOr send them this link: ${joinUrl}${paused ? `\n\n${paused}` : ""}`,
    html: `<p>${escape(name)},</p><p>${escape(teamName)} is ready. Invite your team:</p><pre>${escape(invitePrompt)}</pre><p>Or send them this link: <a href="${escape(joinUrl)}">${escape(joinUrl)}</a></p>${paused ? `<p>${paused}</p>` : ""}`,
  };
}
