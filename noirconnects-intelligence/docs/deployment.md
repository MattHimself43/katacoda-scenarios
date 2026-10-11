# Getting a preview link

Claude Code's cloud sessions run in a sandbox that can't accept incoming connections, so they can't give you a link that works on another device. Use one of these options instead.

## Option A: Render free plan (simplest, no computer needed)

This works entirely from an iPad browser, and you get a stable link like `https://noirconnects-intelligence.onrender.com`.

1. Sign in at <https://render.com> with your GitHub account.
2. Choose **New → Blueprint**. Pick the `katacoda-scenarios` repository and the branch that has the latest work: `claude/noirconnects-intelligence-6dgbdw`, or `main` once it's merged.
3. Render reads [`render.yaml`](../../render.yaml) and asks for three values:
   - `OWNER_EMAIL`: your sign-in email
   - `OWNER_NAME`: your display name
   - `OWNER_PASSWORD`: at least 12 characters

   These values stay in Render and are never stored in the repository.
4. Click **Apply**. The first build takes a few minutes. Then open the `onrender.com` URL and sign in.

Each push to that branch redeploys automatically, so the link stays the same.

**Free-plan limits.** These come from [Render's free-plan documentation](https://render.com/docs/free):

- **Sleeps when idle.** The service goes to sleep after 15 minutes without traffic, and the next visit takes about a minute to wake it.
- **No lasting storage.** The free plan's filesystem is **temporary**. Every redeploy, restart or sleep wipes the SQLite database. On restart, your owner account is recreated from `OWNER_EMAIL` and `OWNER_PASSWORD`, but imported brands and settings changes are lost.

That's fine for reviewing the interface. For real operations you need persistent storage, from either of these:

- **Render paid plan.** A paid Render instance with a persistent disk mounted at `noirconnects-intelligence/data`. Check Render's pricing page for current costs.
- **Option B below.** Free, with permanent data on your own computer.

To try the import flow on an iPad, open **Brand Discovery → Import research → Use example file**. It loads synthetic sample data on `.example` domains. Then choose **Validate & preview** and import it.

## Option B: your own computer and a Cloudflare tunnel (free, data kept)

Run the app on a Mac or PC as described in the README's Quick start, then share it with a tunnel:

```bash
npm run build && npm start                         # serves on http://127.0.0.1:4000
cloudflared tunnel --url http://127.0.0.1:4000     # prints an https://….trycloudflare.com link
```

- **Quick tunnel:** free, no account needed. The link changes every time you start the tunnel.
- **Stable link:** create a free Cloudflare account and a named tunnel on a domain you own (for example `app.yourdomain.com`).

Either way, the data stays on your computer and survives restarts. The link only works while the computer and the tunnel are running.

## Security notes

- Set `COOKIE_SECURE=true` whenever the app is served over HTTPS. The Render blueprint already does this.
- Use a strong owner password. Sign-in attempts are rate-limited.
- No mail credentials are needed yet. When Hostinger Mail is added in Phase 3, its credentials go in the host's secret environment variables only.
