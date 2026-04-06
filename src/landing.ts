/**
 * WhichModel landing page — served at whichmodel.dev root.
 *
 * Self-contained HTML/CSS/JS template literal.
 * The sign-up form posts to POST /auth/signup and displays
 * the returned API key inline (no redirect needed).
 */
export const LANDING_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>WhichModel — Route smarter. Spend less.</title>
  <meta name="description" content="MCP server that helps AI agents pick the right LLM for any task. Stop overpaying for GPT-4 on jobs that Haiku handles perfectly." />
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg: #0c0c0f;
      --surface: #13131a;
      --border: #222230;
      --text: #e8e8f0;
      --muted: #8888a8;
      --accent: #7c6ff7;
      --accent-dim: #5148c2;
      --green: #34d399;
      --yellow: #fbbf24;
      --radius: 10px;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
      min-height: 100vh;
    }

    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }

    /* ── Layout ── */
    .container { max-width: 960px; margin: 0 auto; padding: 0 24px; }

    /* ── Nav ── */
    nav {
      border-bottom: 1px solid var(--border);
      padding: 16px 0;
    }
    nav .container {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .logo {
      font-size: 1.15rem;
      font-weight: 700;
      color: var(--text);
      letter-spacing: -0.02em;
    }
    .logo span { color: var(--accent); }
    nav a.nav-link {
      color: var(--muted);
      font-size: 0.9rem;
      margin-left: 24px;
    }
    nav a.nav-link:hover { color: var(--text); text-decoration: none; }

    /* ── Hero ── */
    .hero {
      padding: 80px 0 64px;
      text-align: center;
    }
    .badge {
      display: inline-block;
      background: rgba(124,111,247,0.15);
      color: var(--accent);
      border: 1px solid rgba(124,111,247,0.3);
      border-radius: 20px;
      font-size: 0.78rem;
      font-weight: 600;
      padding: 4px 14px;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      margin-bottom: 24px;
    }
    h1 {
      font-size: clamp(2.2rem, 5vw, 3.4rem);
      font-weight: 800;
      letter-spacing: -0.03em;
      line-height: 1.1;
      margin-bottom: 20px;
    }
    h1 em { font-style: normal; color: var(--accent); }
    .hero-sub {
      font-size: 1.15rem;
      color: var(--muted);
      max-width: 600px;
      margin: 0 auto 40px;
    }
    .hero-code {
      display: inline-block;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 14px 24px;
      font-family: "SF Mono", "Fira Code", monospace;
      font-size: 0.9rem;
      color: var(--green);
      margin-bottom: 16px;
    }
    .hero-code span { color: var(--muted); }

    /* ── Section headings ── */
    section { padding: 64px 0; }
    section + section { border-top: 1px solid var(--border); }
    .section-label {
      font-size: 0.75rem;
      font-weight: 700;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--accent);
      margin-bottom: 12px;
    }
    h2 {
      font-size: clamp(1.6rem, 3vw, 2.1rem);
      font-weight: 700;
      letter-spacing: -0.02em;
      margin-bottom: 12px;
    }
    .section-sub {
      color: var(--muted);
      font-size: 1rem;
      margin-bottom: 40px;
    }

    /* ── Tools grid ── */
    .tools-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
    }
    .tool-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 20px;
    }
    .tool-card .tool-name {
      font-family: "SF Mono", "Fira Code", monospace;
      font-size: 0.82rem;
      color: var(--accent);
      margin-bottom: 8px;
    }
    .tool-card p { font-size: 0.88rem; color: var(--muted); }

    /* ── Pricing table ── */
    .pricing-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
      gap: 16px;
      align-items: start;
    }
    .plan-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 24px;
      position: relative;
    }
    .plan-card.featured {
      border-color: var(--accent);
      background: rgba(124,111,247,0.07);
    }
    .plan-badge {
      position: absolute;
      top: -11px;
      left: 50%;
      transform: translateX(-50%);
      background: var(--accent);
      color: #fff;
      font-size: 0.7rem;
      font-weight: 700;
      letter-spacing: 0.07em;
      text-transform: uppercase;
      padding: 3px 10px;
      border-radius: 10px;
    }
    .plan-name {
      font-size: 0.85rem;
      font-weight: 600;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.06em;
      margin-bottom: 8px;
    }
    .plan-price {
      font-size: 2.2rem;
      font-weight: 800;
      letter-spacing: -0.03em;
      color: var(--text);
      line-height: 1;
      margin-bottom: 4px;
    }
    .plan-price sup { font-size: 1rem; vertical-align: super; font-weight: 600; }
    .plan-price sub { font-size: 0.85rem; font-weight: 400; color: var(--muted); }
    .plan-requests {
      font-size: 0.82rem;
      color: var(--muted);
      margin-bottom: 20px;
    }
    .plan-features {
      list-style: none;
      font-size: 0.88rem;
      color: var(--muted);
    }
    .plan-features li {
      padding: 5px 0;
      border-top: 1px solid var(--border);
      display: flex;
      align-items: flex-start;
      gap: 8px;
    }
    .plan-features li::before {
      content: "✓";
      color: var(--green);
      font-weight: 700;
      flex-shrink: 0;
    }
    .plan-features li.muted::before { content: "—"; color: var(--border); }

    /* ── Sign-up section ── */
    .signup-section { text-align: center; }
    .signup-box {
      max-width: 480px;
      margin: 0 auto;
    }
    .signup-form {
      display: flex;
      gap: 10px;
      margin-top: 32px;
    }
    .signup-form input[type="email"] {
      flex: 1;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 12px 16px;
      color: var(--text);
      font-size: 0.95rem;
      outline: none;
      transition: border-color 0.2s;
    }
    .signup-form input[type="email"]:focus { border-color: var(--accent); }
    .signup-form input[type="email"]::placeholder { color: var(--muted); }
    .btn {
      background: var(--accent);
      color: #fff;
      border: none;
      border-radius: var(--radius);
      padding: 12px 24px;
      font-size: 0.95rem;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s, opacity 0.2s;
      white-space: nowrap;
    }
    .btn:hover { background: var(--accent-dim); }
    .btn:disabled { opacity: 0.6; cursor: not-allowed; }
    .signup-note {
      font-size: 0.8rem;
      color: var(--muted);
      margin-top: 10px;
    }
    #signup-result {
      margin-top: 20px;
      font-size: 0.9rem;
      min-height: 24px;
    }
    #signup-result.success {
      background: rgba(52,211,153,0.1);
      border: 1px solid rgba(52,211,153,0.3);
      border-radius: var(--radius);
      padding: 16px;
      color: var(--green);
    }
    #signup-result.error {
      background: rgba(248,113,113,0.1);
      border: 1px solid rgba(248,113,113,0.3);
      border-radius: var(--radius);
      padding: 16px;
      color: #f87171;
    }
    .api-key-display {
      margin-top: 10px;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 10px 14px;
      font-family: "SF Mono", "Fira Code", monospace;
      font-size: 0.82rem;
      color: var(--text);
      word-break: break-all;
      cursor: pointer;
      user-select: all;
    }
    .api-key-display:hover { border-color: var(--accent); }

    /* ── FAQ ── */
    .faq-list { list-style: none; }
    .faq-list li {
      padding: 16px 0;
      border-top: 1px solid var(--border);
    }
    .faq-list li:last-child { border-bottom: 1px solid var(--border); }
    .faq-q {
      font-weight: 600;
      margin-bottom: 4px;
      font-size: 0.95rem;
    }
    .faq-a { color: var(--muted); font-size: 0.88rem; }

    /* ── Footer ── */
    footer {
      border-top: 1px solid var(--border);
      padding: 32px 0;
      color: var(--muted);
      font-size: 0.82rem;
    }
    footer .container {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      flex-wrap: wrap;
    }
    footer a { color: var(--muted); }
    footer a:hover { color: var(--text); }

    @media (max-width: 600px) {
      .signup-form { flex-direction: column; }
      .pricing-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>

<nav>
  <div class="container">
    <span class="logo">Which<span>Model</span></span>
    <div>
      <a href="#pricing" class="nav-link">Pricing</a>
      <a href="#get-key" class="nav-link">Get API Key</a>
      <a href="https://github.com/Which-Model/whichmodel-mcp" class="nav-link">GitHub</a>
    </div>
  </div>
</nav>

<!-- ── Hero ── -->
<section class="hero">
  <div class="container">
    <div class="badge">MCP Server</div>
    <h1>Route smarter.<br><em>Spend less.</em></h1>
    <p class="hero-sub">
      WhichModel is an MCP server your agents call to pick the right AI model for any task.
      Stop overpaying for GPT-4 on jobs that Haiku handles perfectly.
    </p>
    <div>
      <div class="hero-code">
        <span>// Add to your agent config</span><br>
        <span>"mcpServers":</span> { "whichmodel": { "url": "https://whichmodel.dev/mcp" } }
      </div>
    </div>
  </div>
</section>

<!-- ── Tools ── -->
<section id="tools">
  <div class="container">
    <div class="section-label">Tools</div>
    <h2>Four tools. Zero guesswork.</h2>
    <p class="section-sub">Add WhichModel to your agent once — it calls the right tool automatically.</p>
    <div class="tools-grid">
      <div class="tool-card">
        <div class="tool-name">recommend_model</div>
        <p>Get a cost-optimised model recommendation for a task type, complexity level, and budget ceiling.</p>
      </div>
      <div class="tool-card">
        <div class="tool-name">compare_models</div>
        <p>Head-to-head comparison of 2–5 models with optional volume cost projections.</p>
      </div>
      <div class="tool-card">
        <div class="tool-name">get_pricing</div>
        <p>Raw pricing data lookup with filters by model, provider, price, and capabilities.</p>
      </div>
      <div class="tool-card">
        <div class="tool-name">check_price_changes</div>
        <p>See what model pricing has changed since a given date. Keep your cost estimates fresh.</p>
      </div>
    </div>
  </div>
</section>

<!-- ── Pricing ── -->
<section id="pricing">
  <div class="container">
    <div class="section-label">Pricing</div>
    <h2>Simple, developer-friendly pricing</h2>
    <p class="section-sub">One saved routing decision pays for weeks of the Developer plan.</p>
    <div class="pricing-grid">
      <div class="plan-card">
        <div class="plan-name">Free</div>
        <div class="plan-price"><sup>$</sup>0</div>
        <div class="plan-requests">1,000 requests / month</div>
        <ul class="plan-features">
          <li>All 4 routing tools</li>
          <li>IP-based rate limiting</li>
          <li>No credit card required</li>
          <li>Community support</li>
        </ul>
      </div>
      <div class="plan-card featured">
        <div class="plan-badge">Most popular</div>
        <div class="plan-name">Developer</div>
        <div class="plan-price"><sup>$</sup>9<sub>/mo</sub></div>
        <div class="plan-requests">50,000 requests / month</div>
        <ul class="plan-features">
          <li>All 4 routing tools</li>
          <li>API key (no IP restrictions)</li>
          <li>Usage dashboard</li>
          <li>Email support</li>
        </ul>
      </div>
      <div class="plan-card">
        <div class="plan-name">Team</div>
        <div class="plan-price"><sup>$</sup>29<sub>/mo</sub></div>
        <div class="plan-requests">250,000 requests / month</div>
        <ul class="plan-features">
          <li>All 4 routing tools</li>
          <li>Multiple API keys</li>
          <li>Priority support</li>
          <li>Webhook price-change alerts</li>
        </ul>
      </div>
      <div class="plan-card">
        <div class="plan-name">Enterprise</div>
        <div class="plan-price" style="font-size:1.4rem; margin-top:8px;">Contact us</div>
        <div class="plan-requests">Unlimited requests</div>
        <ul class="plan-features">
          <li>Everything in Team</li>
          <li>Dedicated API keys</li>
          <li>SLA</li>
          <li>Custom integration support</li>
        </ul>
      </div>
    </div>
  </div>
</section>

<!-- ── Sign up ── -->
<section id="get-key" class="signup-section">
  <div class="container">
    <div class="section-label">Get started</div>
    <h2>Free API key — instant</h2>
    <p class="section-sub">No credit card. No waitlist. Start routing in under a minute.</p>
    <div class="signup-box">
      <form class="signup-form" id="signup-form">
        <input
          type="email"
          id="signup-email"
          placeholder="you@example.com"
          required
          autocomplete="email"
        />
        <button type="submit" class="btn" id="signup-btn">Get free key</button>
      </form>
      <p class="signup-note">We'll email you your key and a quick-start snippet. No spam.</p>
      <div id="signup-result"></div>
    </div>
  </div>
</section>

<!-- ── FAQ ── -->
<section id="faq">
  <div class="container">
    <div class="section-label">FAQ</div>
    <h2>Common questions</h2>
    <ul class="faq-list">
      <li>
        <div class="faq-q">What counts as a request?</div>
        <div class="faq-a">Each MCP tool call counts as one request — recommend_model, compare_models, get_pricing, or check_price_changes.</div>
      </li>
      <li>
        <div class="faq-q">Do I need an API key to start?</div>
        <div class="faq-a">No. The free tier works immediately via IP-based rate limiting — just point your agent at https://whichmodel.dev/mcp. An API key removes IP restrictions and unlocks the usage dashboard.</div>
      </li>
      <li>
        <div class="faq-q">What happens when I hit my monthly limit?</div>
        <div class="faq-a">You'll receive a 429 response with a Retry-After header. Upgrade anytime to continue without interruption.</div>
      </li>
      <li>
        <div class="faq-q">Can my agent buy a plan autonomously?</div>
        <div class="faq-a">Not yet — plans are managed by the developer or operator. Credits-based billing for autonomous agents is on the roadmap.</div>
      </li>
      <li>
        <div class="faq-q">Which AI providers are covered?</div>
        <div class="faq-a">Anthropic, OpenAI, Google, Meta, Mistral, Cohere, and more. The model database is updated whenever major providers publish pricing changes.</div>
      </li>
    </ul>
  </div>
</section>

<!-- ── Footer ── -->
<footer>
  <div class="container">
    <span>© 2025 WhichModel</span>
    <span>
      <a href="https://github.com/Which-Model/whichmodel-mcp">GitHub</a> ·
      <a href="mailto:hello@whichmodel.dev">Contact</a>
    </span>
  </div>
</footer>

<script>
  const form = document.getElementById('signup-form');
  const emailInput = document.getElementById('signup-email');
  const btn = document.getElementById('signup-btn');
  const result = document.getElementById('signup-result');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    btn.disabled = true;
    btn.textContent = 'Sending…';
    result.className = '';
    result.innerHTML = '';

    try {
      const res = await fetch('/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailInput.value }),
      });
      const data = await res.json();

      if (res.ok && data.api_key) {
        result.className = 'success';
        result.innerHTML =
          '<strong>Your free API key:</strong>' +
          '<div class="api-key-display" title="Click to select">' + data.api_key + '</div>' +
          '<p style="margin-top:10px; font-size:0.82rem;">Add it to your agent: <code style="color:#7c6ff7">Authorization: Bearer &lt;key&gt;</code><br>Check your email for the quick-start guide.</p>';
        emailInput.value = '';
      } else {
        result.className = 'error';
        result.textContent = data.error || 'Something went wrong. Please try again.';
      }
    } catch {
      result.className = 'error';
      result.textContent = 'Network error — please try again.';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Get free key';
    }
  });
</script>
</body>
</html>
`;
