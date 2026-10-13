import { getSql } from "../src/server/db/client";
import { oauthCutoverReport, revokeLegacyOAuth } from "../src/server/identity/oauth-cutover";

async function main() {
try {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--dry-run") {
    const report = await oauthCutoverReport();
    console.log(JSON.stringify(report,null,2));
    console.log(`Apply only after owner approval: pnpm --filter web exec tsx scripts/revoke-legacy-oauth.ts --apply --expected-digest ${report.digest}`);
  } else if (args.length === 3 && args[0] === "--apply" && args[1] === "--expected-digest" && /^[a-f0-9]{64}$/.test(args[2])) {
    console.log(JSON.stringify(await revokeLegacyOAuth(args[2]),null,2));
  } else {
    throw new Error("Use --dry-run or --apply --expected-digest <approved digest>.");
  }
} catch (error) {
  console.error(error instanceof Error && !('code' in error) ? error.message : "OAuth cutover failed. No connection values displayed.");
  process.exitCode=1;
} finally {
  await getSql().end();
}

}

void main();
