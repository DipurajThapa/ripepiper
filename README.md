# Ripe Piper

This repository is being prepared for a code review of the Ripe Piper website and Cloudflare Worker platform.

## Source of truth

The existing project consists of `site/` (static frontend) and `platform/ripe-piper-platform/` (Cloudflare Worker, Supabase SQL migrations, integration services and tests). Preserve the original visual design, content, pricing, and business rules during integration.

## Release gate

**Not production-ready.** Before production: import the complete source tree, configure and deploy Supabase and Cloudflare, provide non-public secrets only through provider secret stores, verify authentication and RLS, payments and webhook idempotency, Turnstile, booking workflows, and pass automated and live E2E checks.

Do not treat this README as a deployed website or a completed audit.
