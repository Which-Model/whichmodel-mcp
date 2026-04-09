/**
 * Self-contained HTML dashboard for WhichModel MCP usage metrics.
 * Fetches data from /observability/dashboard-data and renders charts inline.
 * No external dependencies — works in any browser.
 */

export function renderDashboardHTML(baseUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>WhichModel MCP — Usage Dashboard</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f1117; color: #e1e4e8; padding: 24px; }
  h1 { font-size: 1.5rem; font-weight: 600; margin-bottom: 4px; }
  .subtitle { color: #8b949e; font-size: 0.875rem; margin-bottom: 24px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 24px; }
  .card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 16px; }
  .card-label { font-size: 0.75rem; color: #8b949e; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px; }
  .card-value { font-size: 1.75rem; font-weight: 700; }
  .card-detail { font-size: 0.75rem; color: #8b949e; margin-top: 4px; }
  .status-ok { color: #3fb950; }
  .status-degraded { color: #d29922; }
  .status-down { color: #f85149; }
  .section { margin-bottom: 24px; }
  .section-title { font-size: 1rem; font-weight: 600; margin-bottom: 12px; border-bottom: 1px solid #30363d; padding-bottom: 8px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid #21262d; font-size: 0.875rem; }
  th { color: #8b949e; font-weight: 500; font-size: 0.75rem; text-transform: uppercase; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  th.num { text-align: right; }
  .bar-bg { background: #21262d; border-radius: 4px; height: 20px; position: relative; overflow: hidden; }
  .bar-fill { height: 100%; border-radius: 4px; transition: width 0.3s; }
  .bar-fill.calls { background: #58a6ff; }
  .bar-fill.errors { background: #f85149; }
  .bar-fill.cache { background: #3fb950; }
  .chart-row { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
  .chart-label { width: 180px; font-size: 0.8rem; color: #c9d1d9; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .chart-bar { flex: 1; }
  .chart-val { width: 50px; text-align: right; font-size: 0.8rem; font-variant-numeric: tabular-nums; }
  .trend { display: flex; align-items: flex-end; gap: 3px; height: 48px; }
  .trend-bar { flex: 1; background: #58a6ff; border-radius: 2px 2px 0 0; min-height: 2px; transition: height 0.3s; }
  .trend-labels { display: flex; justify-content: space-between; font-size: 0.65rem; color: #8b949e; margin-top: 4px; }
  .loading { color: #8b949e; font-style: italic; }
  .error-msg { color: #f85149; }
  .refresh-btn { background: #21262d; color: #c9d1d9; border: 1px solid #30363d; border-radius: 6px; padding: 6px 12px; cursor: pointer; font-size: 0.8rem; }
  .refresh-btn:hover { background: #30363d; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; }
</style>
</head>
<body>
<div class="header">
  <div>
    <h1>WhichModel MCP</h1>
    <div class="subtitle">Usage Dashboard</div>
  </div>
  <button class="refresh-btn" onclick="loadDashboard()">Refresh</button>
</div>

<div id="health" class="grid"><div class="card"><span class="loading">Loading...</span></div></div>

<div class="section">
  <div class="section-title">7-Day Trend</div>
  <div id="trend"><span class="loading">Loading...</span></div>
</div>

<div class="section">
  <div class="section-title">Tool Usage (Today)</div>
  <div id="tools"><span class="loading">Loading...</span></div>
</div>

<div class="section">
  <div class="section-title">Daily Breakdown (Last 7 Days)</div>
  <div id="daily-table"><span class="loading">Loading...</span></div>
</div>

<script>
const BASE = '';

async function loadDashboard() {
  try {
    const [healthRes, dashRes] = await Promise.all([
      fetch(BASE + '/health'),
      fetch(BASE + '/observability/dashboard-data?days=7'),
    ]);
    const health = await healthRes.json();
    const dash = await dashRes.json();
    renderHealth(health, dash);
    renderTrend(dash.days);
    renderTools(dash.days[0]);
    renderDailyTable(dash.days);
  } catch (e) {
    document.getElementById('health').innerHTML = '<div class="card"><span class="error-msg">Failed to load dashboard: ' + e.message + '</span></div>';
  }
}

function renderHealth(health, dash) {
  const today = dash.days[0] || {};
  const statusClass = health.status === 'ok' ? 'status-ok' : health.status === 'degraded' ? 'status-degraded' : 'status-down';
  const freshness = health.data_freshness ? timeAgo(health.data_freshness) : 'unknown';

  document.getElementById('health').innerHTML = [
    card('Status', '<span class="' + statusClass + '">' + (health.status || 'unknown').toUpperCase() + '</span>', 'Data freshness: ' + freshness),
    card('Today\\'s Calls', today.total_calls || 0, today.total_errors ? today.total_errors + ' errors' : 'No errors'),
    card('Unique Callers', today.unique_callers || 0, (today.anonymous_calls || 0) + ' anonymous calls'),
    card('Avg Latency', (today.avg_latency_ms || 0) + 'ms', ''),
    card('Active Models', dash.active_models || 0, (dash.deprecated_models || 0) + ' deprecated'),
  ].join('');
}

function card(label, value, detail) {
  return '<div class="card"><div class="card-label">' + label + '</div><div class="card-value">' + value + '</div>' + (detail ? '<div class="card-detail">' + detail + '</div>' : '') + '</div>';
}

function renderTrend(days) {
  const reversed = [...days].reverse();
  const maxCalls = Math.max(...reversed.map(d => d.total_calls), 1);
  let html = '<div class="trend">';
  for (const d of reversed) {
    const h = Math.max(2, (d.total_calls / maxCalls) * 48);
    html += '<div class="trend-bar" style="height:' + h + 'px" title="' + d.date + ': ' + d.total_calls + ' calls"></div>';
  }
  html += '</div><div class="trend-labels"><span>' + reversed[0].date + '</span><span>' + reversed[reversed.length - 1].date + '</span></div>';
  document.getElementById('trend').innerHTML = html;
}

function renderTools(today) {
  if (!today || !today.tool_usage) {
    document.getElementById('tools').innerHTML = '<span class="loading">No data for today</span>';
    return;
  }
  const tools = today.tool_usage;
  const maxCalls = Math.max(...Object.values(tools).map(t => t.calls), 1);

  let html = '';
  const sorted = Object.entries(tools).sort((a, b) => b[1].calls - a[1].calls);
  for (const [name, m] of sorted) {
    const pct = (m.calls / maxCalls) * 100;
    const avgMs = m.calls > 0 ? Math.round(m.total_latency_ms / m.calls) : 0;
    html += '<div class="chart-row">' +
      '<div class="chart-label">' + name + '</div>' +
      '<div class="chart-bar"><div class="bar-bg"><div class="bar-fill calls" style="width:' + pct + '%"></div></div></div>' +
      '<div class="chart-val">' + m.calls + '</div>' +
      '</div>';
  }
  document.getElementById('tools').innerHTML = html;
}

function renderDailyTable(days) {
  let html = '<table><thead><tr><th>Date</th><th class="num">Calls</th><th class="num">Errors</th><th class="num">Cache Hits</th><th class="num">Unique Callers</th><th class="num">Avg Latency</th></tr></thead><tbody>';
  for (const d of days) {
    const totalCacheHits = Object.values(d.tool_usage).reduce((s, t) => s + t.cache_hits, 0);
    html += '<tr><td>' + d.date + '</td><td class="num">' + d.total_calls + '</td><td class="num">' + d.total_errors + '</td><td class="num">' + totalCacheHits + '</td><td class="num">' + d.unique_callers + '</td><td class="num">' + d.avg_latency_ms + 'ms</td></tr>';
  }
  html += '</tbody></table>';
  document.getElementById('daily-table').innerHTML = html;
}

function timeAgo(isoDate) {
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  return Math.floor(hrs / 24) + 'd ago';
}

loadDashboard();
</script>
</body>
</html>`;
}
