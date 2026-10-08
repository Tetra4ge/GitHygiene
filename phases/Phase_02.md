# Phase 2: Sign In with GitHub

**Tier:** Must have

## 1. Goal
A user can sign in with their GitHub account, the server knows who is calling, and unauthenticated requests are rejected.

## 2. Setup
1. In GitHub → Settings → Developer settings, create an **OAuth App**. Set the callback URL to the one shown in Supabase → Authentication → Providers → GitHub.
2. Paste the OAuth app's client id and secret into the Supabase GitHub provider settings and enable it.
3. In Supabase → Authentication → URL Configuration, add `http://localhost:5173` (and later the deployed client URL) to the redirect allow list.

The GitHub client secret lives only in Supabase. It does not go in this repository's `.env`.

## 3. Tasks

### 3.1 Client
- `client/src/lib/supabase.js` — Supabase client created with the anon key.
- Sign-in button:

```js
await supabase.auth.signInWithOAuth({
  provider: 'github',
  options: { redirectTo: window.location.origin },
});
```

- An auth context that subscribes to `supabase.auth.onAuthStateChange` and exposes the session.
- A route guard that sends signed-out users to the landing page.
- `client/src/lib/api.js` — a small `fetch` wrapper that attaches both tokens to every call:

```js
headers: {
  Authorization: `Bearer ${session.access_token}`,
  'X-GitHub-Token': session.provider_token,
}
```

`provider_token` is only present right after sign-in and is not restored when Supabase refreshes the session. Keep it in memory (or `sessionStorage`) when the sign-in event fires, and prompt the user to sign in again if it is missing.

### 3.2 Server
`server/src/middleware/auth.js`:

```js
export async function requireAuth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Missing token' });

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return res.status(401).json({ error: 'Invalid or expired token' });

  req.user = data.user;
  req.githubToken = req.headers['x-github-token'];
  next();
}
```

- Apply `requireAuth` to every route except `/api/health`.
- `GET /api/me` returns the caller's row from `profiles`.
- Never log `req.githubToken` or the `Authorization` header.

### 3.3 UI
- Landing page with the project pitch and a "Sign in with GitHub" button.
- App shell (sidebar or top bar) showing the user's avatar, GitHub login, and a sign-out button.

## 4. Done When
- Signing in redirects back to the app and shows the user's avatar and GitHub login.
- A new row appears in `profiles` on first sign-in.
- `GET /api/me` returns `401` without a token and the profile with one.
- Signing out returns the user to the landing page and protected routes are no longer reachable.

## 5. If Short on Time
Skip the app shell polish. The avatar and a sign-out link are enough.

## 6. Implementation Status (Current Codebase)

- **Built:** GitHub OAuth through Supabase Auth; `middlewares/auth.middleware.js`
  verifies session JWTs against Supabase's published **JWKS** using `jose` (not
  the shared HMAC secret — `SUPABASE_JWT_SECRET` in `.env.example` is unused and
  documented as such); `requireRole` middleware for `admin` / `manager`;
  `GET /users/me`; protected routes and a landing page in the frontend.
- **Scope note for Phases 7–8:** Stage 2 downloads the repository tarball to
  search its code. Public repositories need no extra scope, but **private ones
  need `repo`**, requested at sign-in. If the demo uses only public
  repositories, do not request it — ask for the narrowest scope the demo needs
  and say in the README which scopes are requested and why.
- **Token lifetime:** `provider_token` (the GitHub token) is present only right
  after sign-in and is not restored when Supabase refreshes the session. A scan
  that starts after a refresh will fail to fetch code. Keep it in memory from the
  sign-in event and prompt to re-authenticate when it is missing — this is a
  likely and unglamorous demo failure.
