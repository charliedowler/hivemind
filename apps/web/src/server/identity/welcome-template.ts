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
