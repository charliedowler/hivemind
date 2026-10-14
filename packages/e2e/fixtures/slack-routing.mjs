// Test double for the Slack routing model and Jev's decisiveness gate. The sink answers the
// Anthropic Messages API and TypeSafe's /v1/systemone with these, so e2e runs need no real keys.
// It is a keyword table chosen to drive the scenarios, not product logic.
const approve = /^(?:please\s+)?(?:approved?|yes(?:,?\s+let them in)?|go ahead|let them in)\b/i;
const decline = /^(?:please\s+)?(?:declined?|nope|no)\b/i;
const undo = /^(?:please\s+)?(?:undo(?:\s+that)?|revert|cancel that)\b/i;

function decision(text) {
  if (text.endsWith('?')) return null;
  for (const [verb, pattern] of [['approve', approve], ['decline', decline]]) {
    const match = pattern.exec(text);
    if (match) return { verb, rest: text.slice(match[0].length).replace(/^[\s,:-]+/, '').replace(/[.!]+$/, '').trim() };
  }
  return null;
}

function named(notices, rest) {
  const target = rest.toLowerCase();
  return notices.find(notice => [notice.person.email, notice.person.name, notice.requestId].some(value => value && target.includes(value.toLowerCase())));
}

export function isSlackRouting(body) {
  return Array.isArray(body.tools) && body.tools.some(tool => tool.name === 'hive_decide_join_request');
}

export function routeSlack(body) {
  const input = JSON.parse(body.messages[0].content);
  const text = String(input.message ?? '').trim();
  const notices = input.threadContext?.notices ?? [];
  const pending = notices.filter(notice => notice.status === 'pending');
  const decided = decision(text);
  if (undo.test(text) && !text.endsWith('?')) return { input, tool: 'undo_last_action', toolInput: {} };
  if (decided) {
    const target = decided.rest ? named(notices, decided.rest) : pending.find(notice => notice.noticeIsThisThread) ?? (pending.length === 1 ? pending[0] : null);
    const toolInput = { decision: decided.verb, ...(target ? { requestId: target.requestId } : decided.rest ? { person: decided.rest } : {}) };
    return { input, tool: 'hive_decide_join_request', toolInput };
  }
  return { input, tool: 'hive_ask', toolInput: { question: text } };
}

export function messagesResponse(tool, toolInput) {
  return {
    id: `msg_e2e_${Date.now()}`, type: 'message', role: 'assistant', model: 'e2e-slack-routing',
    content: [{ type: 'tool_use', id: `toolu_e2e_${Date.now()}`, name: tool, input: toolInput }],
    stop_reason: 'tool_use', stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 },
  };
}

export function declinedResponse() {
  return {
    id: `msg_e2e_${Date.now()}`, type: 'message', role: 'assistant', model: 'e2e-declined',
    content: [{ type: 'text', text: '' }],
    stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 },
  };
}

export function isDecisiveness(body) {
  return Object.keys(body.questions ?? {}).sort().join(',') === 'allowed,instruction,specific';
}

export function judgeDecisiveness(state) {
  const text = String(state.request ?? '').trim();
  const context = state.context ?? {};
  const pending = (context.notices ?? []).filter(notice => notice.status === 'pending');
  const decided = decision(text);
  const undoing = undo.test(text) && !text.endsWith('?');
  const instruction = state.action === 'undo' ? undoing : state.action === 'join_request' ? Boolean(decided) : Boolean(decided || undoing);
  const specific = state.action === 'undo' ? Boolean(context.lastReversibleAction) : state.action === 'join_request' ? Boolean(decided?.rest) || pending.length === 1 : instruction;
  return { instruction: instruction ? 1 : 0, specific: specific ? 1 : 0, allowed: state.speaker?.allowed ? 1 : 0 };
}
