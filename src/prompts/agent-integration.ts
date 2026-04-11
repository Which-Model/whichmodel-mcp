import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * Register MCP prompt templates for agent builders.
 *
 * These prompts surface ready-to-use system prompt blocks that agent builders
 * can retrieve via `prompts/get` and embed in their agent system prompts,
 * making WhichModel the default cost-aware model router.
 */
export function registerAgentPrompts(server: McpServer): void {
  // ── 1. Full agent system prompt ──────────────────────────────────────────
  server.registerPrompt(
    'cost-aware-agent',
    {
      description:
        'Complete system prompt block that instructs an agent to use WhichModel for ' +
        'cost-aware model selection before dispatching LLM subtasks. ' +
        'Drop this into any agent system prompt to make model selection automatic.',
    },
    async () => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `You have access to the WhichModel MCP server for cost-aware model selection.

**Before calling any LLM for a subtask**, use the \`recommend_model\` tool to pick the right model:

\`\`\`
recommend_model({
  task_type: "<chat|code_generation|code_review|summarisation|translation|data_extraction|tool_calling|creative_writing|research|classification|vision|reasoning>",
  complexity: "<low|medium|high>",
  estimated_input_tokens: <number>,   // optional but improves accuracy
  estimated_output_tokens: <number>,  // optional but improves accuracy
  budget_per_call: <usd>,             // optional hard cap
  requirements: {                     // optional
    tool_calling: true,               // if the subtask needs tool use
    json_output: true,                // if you need structured output
    vision: true,                     // if the subtask involves images
  }
})
\`\`\`

The response includes:
- \`recommendation\` — best model for cost/quality balance
- \`alternative\` — a higher-quality option if budget allows
- \`budget_option\` — cheapest model that still meets requirements
- \`cost_estimate\` — expected USD cost for the call
- \`reasoning\` — why this model was chosen

**Always prefer the recommended model** unless the task has hard capability requirements that only the alternative satisfies.

Pricing data is refreshed every 4 hours from live provider APIs, so recommendations reflect current market rates.`,
          },
        },
      ],
    }),
  );

  // ── 2. Task-routing snippet ───────────────────────────────────────────────
  server.registerPrompt(
    'task-router-snippet',
    {
      description:
        'Minimal system prompt snippet for adding WhichModel task routing to an existing agent. ' +
        'Use this when you only want to add model-selection behaviour without replacing the full system prompt.',
    },
    async () => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `When you need to choose a model for a subtask, call \`recommend_model\` from the WhichModel MCP server with the task type and complexity. Use the returned \`recommendation.model_id\` as your model. This keeps costs optimal without sacrificing quality.`,
          },
        },
      ],
    }),
  );

  // ── 3. Budget-constrained agent ───────────────────────────────────────────
  server.registerPrompt(
    'budget-constrained-agent',
    {
      description:
        'System prompt block for agents with a strict per-call cost budget. ' +
        'Instructs the agent to always enforce a hard cost cap via WhichModel.',
      argsSchema: {
        budget_usd: z.string().describe('Hard cost cap per LLM call in USD, e.g. "0.01"'),
      },
    },
    async ({ budget_usd }) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `You operate under a strict cost budget of $${budget_usd} per LLM call.

Before dispatching any LLM subtask, call \`recommend_model\` with \`budget_per_call: ${budget_usd}\`. Only use the returned model — do not substitute a more expensive model even if it seems better suited. If no model fits the budget, report that the task cannot be completed within the cost constraint rather than exceeding it.`,
          },
        },
      ],
    }),
  );
}
