import { checkForUpdate } from './auto-update.mjs';
import { bearerToken, callTool, homeDirectory, endpoint } from './mcp.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readSignIn, updateSignIn } from './sign-in-state.mjs';
const payload = result => result.structuredContent ?? JSON.parse(result.content?.filter(c => c.type === 'text').map(c => c.text).join('\n') || '{}');
async function main() {
  const notice = await checkForUpdate();
  if (notice) console.log(notice);
  const state = readSignIn();
  if (state.phase === 'exchanging') { console.log('Finishing sign-in. Run npx gohive status again in a few seconds.'); return; }
  if (state.phase === 'waiting' && Date.now() - state.started < 600000) {
    if (state.url) console.log(`Open ${state.url}`);
    console.log("Sign in with Google in the tab that just opened; run `npx gohive status` when done."); return;
  }
  const token = await bearerToken(homeDirectory(), endpoint(), AbortSignal.timeout(2000));
  if (!token) {
    if (state.url && Date.now() - state.started < 600000 && state.phase !== 'failed') {
      console.log(`Open ${state.url}`);
      console.log("Sign in with Google in the tab that just opened; run `npx gohive status` when done."); return;
    }
    throw new Error('Sign in first');
  }
  await callTool('hive_share_projects', { revision: 0 }, { token, signal: AbortSignal.timeout(5000) });
  const phrase = process.argv[2] || state.joinPhrase;
  if (phrase && state.joinedPhrase !== phrase) {
    const joined = payload(await callTool('hive_join', { phrase }, { token, signal: AbortSignal.timeout(5000) }));
    if (joined.needs_human || joined.status === 'needs_human') { console.log(`Open ${joined.joinUrl} to join ${joined.teamName || joined.team || 'your team'}`); return; }
    if (joined.joined === false) throw new Error('Joining did not finish');
    if (state.attempt) updateSignIn({ joinedPhrase: phrase, teamName: joined.teamName });
    console.log(joined.teamName ? `You're in ${joined.teamName}.` : 'Your hive membership is ready.');
  }
  console.log(state.phase === 'native-waiting' ? 'Signed in. Finish the native MCP connection in the open tab, then run gohive status.' : state.phase === 'native-incomplete' ? 'Signed in. Run codex mcp login hive to finish the native connection.' : 'Installed. Signed in. Hive is ready.');
  let agents = state.agents;
  try { agents = JSON.parse(readFileSync(join(homeDirectory(), '.hive/install.json'), 'utf8')).agents; } catch {}
  if (state.identity === 'human' && agents?.includes('claude')) console.log('If Hive tools are not loaded in Claude Code, run /mcp to reconnect Hive.');
  if (state.phase === 'native-waiting' && state.url) console.log(`Open ${state.url}`);
  try {
    const result = payload(await callTool('hive_invite_link', {}, { token, signal: AbortSignal.timeout(2500) }));
    const links = result.invitations ?? result.links ?? (result.joinUrl ? [result] : []);
    for (const invitation of links) {
      if (!invitation.joinUrl || invitation.paused || invitation.joinPaused) continue;
      console.log(`Join ${invitation.teamName || invitation.team}: ${invitation.joinUrl}`);
      console.log(invitation.invitePrompt || invitation.prompt || `Set me up on Hive and join the ${invitation.teamName || invitation.team} hive: read https://gohive.dev/agent and follow it, then join with ${invitation.joinUrl}`);
    }
  } catch {}
}
main().catch(() => { console.error('Sign-in has expired or is incomplete. Run gohive login to reconnect.'); process.exitCode = 1; });
