# GH Notifs

[Open Pulse](https://gh-notifs-miskibins-projects.vercel.app)

A small, private GitHub activity inbox you can install on Android. Built for following work across many repositories: grouped pushes, pull request updates and failed checks.

## On your phone

1. Open the deployed app in **Chrome on Android**.
2. Connect with a GitHub personal access token belonging to the configured owner.
3. In **Settings**, install the app and enable notifications. Send a test notification.
4. Open **Repositories** to inspect coverage and mute noisy projects.

The app runs standalone from your home screen. Background notifications use the browser's Web Push service, so the app does not need to stay open. Delivery still depends on Android/browser notification permissions, connectivity, and battery restrictions. No app can guarantee delivery while the phone is offline or notifications are disabled.

## What is tracked

- One event per push, with individual commits available in its details.
- Pull requests opened, updated, reopened, closed and merged.
- Failed workflow runs, check runs and commit statuses. Successful CI is quiet.
- Public and private repositories visible to the backend token, including organization memberships.
- Per-repository notification mute, filters, search and local unread state.

**Coverage is visible, not assumed.** The backend registers signed repository webhooks where the token has administrative permission. Organization policies and SSO may prevent installation. Those repositories are labeled as delayed or unavailable; fallback synchronization is not equivalent to an immediate webhook. GitHub's Events API can lag significantly and only retains a limited history. A repository the token cannot see cannot be monitored.

New repositories are discovered by synchronization. Existing history is imported without sending a burst of old notifications.

## Architecture

- Next.js application and server routes on Vercel.
- Private Vercel Blob storage for immutable events, repository state and pending deliveries.
- GitHub HMAC-signed webhooks, duplicate-delivery handling and persistent push retries.
- Standards-based Web Push/VAPID; no Firebase account required.
- Protected owner session in an HttpOnly cookie. API responses are never cached by the service worker.

This is a personal inbox, not a multi-tenant monitoring platform. There is no VM or continuously running process to maintain. Vercel plan limits and usage charges still apply. GitHub Actions requests recovery approximately every five minutes (schedules can be delayed). A daily Vercel cron is a backup and re-enables only GitHub workflows disabled automatically for repository inactivity; a manually disabled workflow stays disabled. Live webhook delivery does not wait for either schedule. Set the repository Actions secret `GH_NOTIFS_CRON_SECRET` to the same value as backend `CRON_SECRET`.

## Development

```sh
npm ci
cp .env.example .env.local
# Set your own server configuration; never commit this file.
npm run dev
npm test
npm run build
```

Create a **private** Vercel Blob store and link it to the project. The integration supplies `BLOB_READ_WRITE_TOKEN`. Generate independent random secrets for sessions, webhooks and cron authentication. Generate VAPID keys with `web-push` and keep the private key server-side. Set `APP_URL` to the canonical HTTPS production origin before registering hooks.

The GitHub token must be able to read the intended repositories and administer repository webhooks for immediate coverage. A classic `repo` token covers private repository access; organization SSO or policy approval may still be necessary. Use a dedicated token and revoke it if exposed.

All environment variable names are listed in `.env.example`. Nothing secret belongs in `NEXT_PUBLIC_*`, the manifest, service worker, source code, screenshots or an app package.

## Verification

`npm test` checks backend behavior; `npm run build` checks the full application. Actual phone push delivery must be verified with the in-app test after Android grants notification permission. A server accepting a push request does not prove the phone displayed it.
