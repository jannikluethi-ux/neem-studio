# Neem Studio

Private export of the Neem Studio control plane for outside review. This is not a rights clearance and not a published episode.

## What is not in this repository

- `node_modules`, build output, and sandbox caches
- API keys and `.env` files. Text and image calls read `XAI_API_KEY` from the environment only. Default `npm test` does not call the provider.
- Durable object storage. Character-image bytes under `src/lib/studio/generated/` are local copies. Storage durability in the studio records is `BLOCKED`.

## Run

```bash
npm install
npm test
npm run dev
```

The dev server listens on port 8080. Meethi is `/characters/chr_q`. Candidate images are served at `/studio-image/1` and `/studio-image/2`.

## Review status

Meethi image asset `ast_3j` versions 1 and 2 are `in_review`. Neither version is approved, neither is canonical, and commercial rights stay `UNKNOWN`. Publishing stays disabled.
