# TradeOS production monitoring

TradeOS uses the native Next.js server and browser instrumentation hooks. Every uncaught server error is written as a structured `tradeos-runtime-error` entry in Vercel Runtime Logs. Authenticated client errors are reported through a rate-limited same-origin endpoint. No passwords, bearer tokens, JWTs, query strings, or request headers are included.

## Enable alert delivery

Create a private incoming webhook in your chosen incident channel and add this Vercel environment variable for Production and Preview:

```text
TRADEOS_ALERT_WEBHOOK_URL=https://your-private-webhook-url
```

Do not prefix it with `NEXT_PUBLIC_`; the URL must remain server-only. Redeploy after adding it.

The webhook receives both `text` and `content` fields for common Slack/Discord-compatible receivers, plus a structured `tradeos` object. Identical errors are limited to one alert per minute per running instance. Runtime logs are still produced when the webhook is absent or unavailable.

To test alerts locally only, also set:

```text
TRADEOS_ALERTS_IN_DEVELOPMENT=true
```

Never enable the local flag in production. Alert rules and channel membership are managed by the webhook provider.
