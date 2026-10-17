# Chat proxy

The dashboard's chat and analyst call Claude. On the hosted site they go through this small Cloudflare Worker, which holds
your Claude API key so it never reaches the browser. Usage is billed to that key.

1. Create a Claude API key at the Claude Console.
2. Install Wrangler (`npm install -g wrangler`), then from this folder run `wrangler login` and `wrangler deploy`.
3. Add the key as a secret: `wrangler secret put ANTHROPIC_API_KEY`.
4. In `wrangler.toml`, set `ALLOWED_ORIGINS` to your site's origin (for example `https://yourname.github.io`) and deploy again.
5. Put the worker's URL (for example `https://blueline-chat.yourname.workers.dev`) in `web/config.js` as `chatEndpoint`, commit, push.

To cap costs, add a KV namespace bound as `RATE` and set `DAILY_LIMIT` (requests per visitor per day).
