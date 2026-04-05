# whichmodel-mcp

> A model routing advisor for autonomous agents — get cost-optimised LLM recommendations via MCP.

**whichmodel.dev** tracks pricing and capabilities across 100+ LLM models, updated every 4 hours. This MCP server exposes that data so AI agents can pick the right model at the best price for every task.

## MCP Endpoint

```
https://whichmodel.dev/mcp
```

**Transport:** Streamable HTTP (MCP spec 2025-03-26)

## Quick Start

Add to your MCP client config:

```json
{
  "mcpServers": {
    "whichmodel": {
      "url": "https://whichmodel.dev/mcp"
    }
  }
}
```

No API key required. No installation needed.

## Tools

### `recommend_model`

Get a cost-optimised model recommendation for a specific task type, complexity, and budget.

| Parameter | Type | Description |
|-----------|------|-------------|
| `task_type` | enum (required) | `chat`, `code_generation`, `code_review`, `summarisation`, `translation`, `data_extraction`, `tool_calling`, `creative_writing`, `research`, `classification`, `embedding`, `vision`, `reasoning` |
| `complexity` | `low` \| `medium` \| `high` | Task complexity (default: `medium`) |
| `estimated_input_tokens` | number | Expected input size in tokens |
| `estimated_output_tokens` | number | Expected output size in tokens |
| `budget_per_call` | number | Maximum spend in USD per call |
| `requirements` | object | Capability requirements: `tool_calling`, `json_output`, `streaming`, `context_window_min`, `providers_include`, `providers_exclude` |

Returns: recommended model, alternative, budget option, cost estimate, and reasoning.

---

### `compare_models`

Head-to-head comparison of 2–5 models with optional volume cost projections.

| Parameter | Type | Description |
|-----------|------|-------------|
| `models` | string[] (required) | Model IDs, e.g. `[anthropic/claude-sonnet-4, openai/gpt-4.1]` |
| `task_type` | enum | Context for comparison |
| `volume` | object | `calls_per_day`, `avg_input_tokens`, `avg_output_tokens` for daily/monthly cost projections |

Returns: pricing, capabilities, quality tiers, and projected costs per model.

---

### `get_pricing`

Raw pricing data lookup with filters by model, provider, price ceiling, and capabilities.

| Parameter | Type | Description |
|-----------|------|-------------|
| `model_id` | string | Specific model ID |
| `provider` | string | Filter by provider, e.g. `anthropic` |
| `max_input_price` | number | Max input price per million tokens (USD) |
| `capabilities` | string[] | Required capabilities: `tool_calling`, `json_output`, `streaming`, `vision` |
| `min_context_window` | number | Minimum context window in tokens |
| `limit` | number | Max results (1–100, default 20) |

---

### `check_price_changes`

See what model pricing has changed since a given date.

| Parameter | Type | Description |
|-----------|------|-------------|
| `since` | string (required) | ISO date, e.g. `2026-04-01` |
| `model_id` | string | Filter to a specific model |
| `provider` | string | Filter to a specific provider |

Returns: price increases, decreases, new models, and deprecations.

## Data Freshness

Pricing data is refreshed every 4 hours from OpenRouter. Each response includes a `data_freshness` timestamp so you know how current the data is.

## Links

- **Website:** [whichmodel.dev](https://whichmodel.dev)
- **MCP endpoint:** [https://whichmodel.dev/mcp](https://whichmodel.dev/mcp)
- **Discovery:** [https://whichmodel.dev/.well-known/mcp.json](https://whichmodel.dev/.well-known/mcp.json)
