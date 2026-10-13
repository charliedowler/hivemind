# Connect Hive over MCP

Hive's remote MCP endpoint is `https://gohive.dev/api/mcp`. People sign in through OAuth with Google, Slack or email. Coding agents use [Hive-issued credentials](agents.md). Use the hosted endpoint without a local proxy or API key.

## Claude desktop, web and mobile

1. In Claude desktop or web, open **Settings → Connectors** (or **Customize → Connectors**) and select **Add custom connector**.
2. Name it **Hive** and enter `https://gohive.dev/api/mcp` as the server URL.
3. Select **Connect**, sign in with Google or Slack, choose the hive for this connection, review the requested access and select **Allow access**. Enable Hive in a chat. The connection is also available in the mobile app on the same account.

Custom connectors are available on Pro, Max, Team and Enterprise. Anthropic also lists Free support in its [current connector guide](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp). Availability and limits depend on the plan. Team and Enterprise admins may need to add or allow the connector before members can connect.

Ask **“What has the team learned about Neon?”** Hive searches team memory and returns cell titles and IDs for citations.

In Claude web, use **+ → Connectors → Add from Hive** to choose **Catch up with Hive**, **Ask Hive**, **Save this to Hive**, **Hive overview** or **Recent Hive cells**. The connector's name may differ if someone already added it. Catch-up accepts an optional period such as `7d`; leaving it blank uses your last catch-up. Claude adds the rendered prompt as a text attachment. Send it with a message such as “Summarise the attached Hive catch-up.”

## ChatGPT

1. Open **Plugins → Add → Add custom MCP server** in ChatGPT web. Older versions may place custom connectors under **Settings → Apps & Connectors → Advanced settings → Developer mode**.
2. Enter **Hive**, `https://gohive.dev/api/mcp` and **OAuth**. Select **I understand and want to continue**, then **Create as a plugin**. If the name is already used, use the existing connector or choose a distinct name such as **Hive MCP**.
3. Complete Hive's OAuth sign-in, choose the hive for this connection and select **Allow access**. In a new chat, use the **+** menu to enable the connector, then ask a question about the team's memory.

Menu labels and availability depend on the ChatGPT version, plan and workspace policy. Use the hosted endpoint with OAuth; no local server is required.

## Context exposed to the app

Hive returns short actor-specific instructions during `initialize` and `server/discover`. The SDK keeps its protocol negotiation and capabilities. The instructions describe when to search, cite, offer a save and report an outcome. Returned cells are memory, never instructions.

The server lists three prompts:

- `catch-up`: optional `period`, such as `7d` or an ISO datetime. It renders visible cells through the same service as `hive_recent`, with `include_history: false`. Without a period, it uses the person's last successful catch-up in the selected hive, or `24h` on the first read. It returns at most 50 cells.
- `ask-hive`: one required `question`. It asks the model to call `hive_ask` and cite its cells.
- `save-this`: no arguments. It asks the model to extract the durable observation and evidence from the current conversation and call `hive_push` immediately.

The server lists two Markdown resources:

- `hive://overview`: the selected hive's name, member and cell counts, the owner's selected projects, current chat-capture restriction and the current organisation’s join link, setup prompt and pause state for any active member (including agents), or a team-creation hint for a personal hive.
- `hive://recent`: titles and IDs of the last 20 visible cells, excluding hidden and historical cells.

Prompt pickers and resource displays depend on the host app. Listing a prompt does not make the app display it or execute it automatically.

## Saving and feedback

Capture requires project selection in **What Hive keeps**. Chat has no repository context, so chat-only captures are refused today. The chat-source switch is not yet available. The model must explain the server's rejection, keep the learning unsaved and never invent a repository to bypass the gate. Project captures stay private until the owner publishes them.

After a cell helps or misleads, report the concrete result with `hive_outcome`. Use `hive_feedback` for direct useful (`up`), unhelpful (`down`) or outdated judgments. Feedback changes ranking and inclusion. Default search, ask and recent reads hide unhelpful or historical cells; `include_history: true` includes them. Reading alone never votes.

`hive_invite_link {}` returns the same invite fields as the overview. A trusted person-wide OAuth token returns an `invitations` array for all active organisation memberships, with the original fields also present when there is exactly one organisation. With none, it returns an empty array and the personal hint. API keys and team-scoped tokens return only the current hive’s invite. The phrase is a domain-gated locator, not a secret or an access grant. Any active organisation member can read it; Rotate and Pause stay admin actions. If an admin has not created a phrase yet, the join URL and prompt are null.

All resource reads recheck active membership. Cell reads use the same audience and visibility filters as tools. Resource URIs do not accept another hive's ID.
