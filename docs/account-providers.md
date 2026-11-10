# Google and Apple account sign-in

## Implemented flow

The account page can use official Google Identity Services and Sign in with Apple
JS popup flows. Provider scripts load only after the user chooses that method.
All completion requests use the existing same-origin JSON API, custom request
header, Origin/Fetch Metadata checks and Secure/HttpOnly/SameSite=Strict cookies.
There is no cross-site callback exception and no public reverse-proxy trust added.

Google's signed identity credential is verified server-side. Apple authorization
codes are exchanged server-side using a short-lived ES256 client secret; Apple
identity tokens are then verified. RS256 identity signatures, issuer, audience,
expiry, issued-at, subject, authorized party and one-time nonce are checked with
PyJWT/cryptography and fixed provider JWKS URLs. State is browser-bound, hashed
in SQLite, single-use and valid for ten minutes. Token/key HTTP responses and
pending states are bounded. Provider redirects are not followed during exchanges.
Access/refresh tokens are discarded and are not saved to the account database.

Accounts map by verified issuer + subject, never by email. Provider and username
accounts are separate; linking/migration is not implemented. Provider-only accounts
cannot use local password changes. Normal sign-out revokes the application session;
it does not sign the user out of Google/Apple globally. Guest files remain attached
to their original guest session. All current processing ownership guards remain.

## Configuration required for live use

The owner has not configured provider registrations or an HTTPS domain. The app
therefore keeps both providers unavailable. The local configuration checker confirms
this; no live Google or Apple account sign-in has been performed.

From the repository root, use the optional isolated Python runtime:

```powershell
python -m venv .venv-oauth
./.venv-oauth/Scripts/python.exe -m pip install -r processor/requirements-oauth.txt
```

Set these values in the server process environment, not in client source or Git:

- `SHANTE_OAUTH_BASE_URL`: exact HTTPS origin, without a path, e.g. your registered
  domain and listener port. This must match the browser address and TLS certificate.
- `SHANTE_GOOGLE_CLIENT_ID`: a registered Google web client ID. Register the exact
  origin in Authorized JavaScript origins. This Google credential flow does not
  require a Google client secret.
- `SHANTE_APPLE_CLIENT_ID`: Apple Services ID associated with a primary App ID that
  has Sign in with Apple enabled.
- `SHANTE_APPLE_TEAM_ID`, `SHANTE_APPLE_KEY_ID`: the corresponding ten-character IDs.
- `SHANTE_APPLE_PRIVATE_KEY_FILE`: absolute path to the protected Apple `.p8` key.
  Do not paste the private key into chat or commit it. Restrict its file permissions.
- Register the Apple domain and Return URL equal to `SHANTE_OAUTH_BASE_URL` plus `/`.
  Apple is unavailable on IP addresses and localhost.

Check configuration without sending credentials or making provider requests:

```powershell
./.venv-oauth/Scripts/python.exe -m processor.oauth_check
```

Exit 0 means at least one provider is configured; exit 2 means none is configured.
The report checks configuration only and cannot certify a live provider sign-in.
Configuration, dependency or secure-origin failures leave provider buttons unavailable.
Restart the service after changing its configuration.

Serve the built UI from the same HTTPS listener, using your valid certificate/key:

```powershell
npm run build
./.venv-oauth/Scripts/python.exe -m processor.server --host 127.0.0.1 --port 5010 --tls-cert "C:/certificates/fullchain.pem" --tls-key "C:/certificates/private-key.pem"
```

Replace the certificate paths and port with your actual values.
Use the registered domain in the browser, not a different localhost/IP alias. Its
DNS must reach the listener. Existing private-network bind/peer restrictions still
apply. Existing HTTP one-click launchers do not enable provider sign-in. Public SaaS
hosting, third-party TLS proxies and cross-device synchronization are not added.
The default Docker image does not install the optional dependencies. The separate
Rust standalone executable is not wired to this Python adapter. Use the documented
Python runtime for this implementation.

## Verification and remaining live checks

Tests use locally generated signing keys and mocked Google/Apple token/JWKS
responses. The HTTPS route tests run a real local TLS listener with explicit test
CA trust and verify cookies, guest-session preservation, account creation and
unchanged CSRF/Origin/Host/browser-state protections. They also cover invalid
signature/algorithm/issuer/audience/nonce/expiry, replay, denial and provider outage.
A CI job installs the optional dependencies and runs the cryptographic tests;
its remote result is not yet verified. Frontend tests use provider SDK fixtures; no production secrets or live identity
were used. Current build and regression results are recorded in the PR.

After registration, verify the actual provider SDK popup, consent, cancellation,
sign-in, repeat sign-in and sign-out on the registered origin, including Safari and
mobile Chrome. No live-account or physical-device compatibility claim is made.

Primary references:
[Google JS API](https://developers.google.com/identity/gsi/web/reference/js-reference),
[Google web setup](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid),
[Apple webpage setup](https://developer.apple.com/documentation/signinwithapple/configuring-your-webpage-for-sign-in-with-apple),
[Apple developer registration](https://developer.apple.com/help/account/capabilities/configure-sign-in-with-apple-for-the-web),
[PyJWT validation API](https://pyjwt.readthedocs.io/en/latest/api.html).

Executed locally: production build/typecheck passed; full frontend suite 469 passed
and 23 skipped; full processor suite in the OAuth runtime 113 passed. Final targeted
authentication rerun passed 9 tests, and the final account/provider UI rerun passed
14 tests after the documented Google button/sign-out contract adjustments.
