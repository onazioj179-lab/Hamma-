# Account page and future identity providers

The existing username/password authority continues to support registration,
sign-in, password changes and sign-out with HttpOnly server sessions.
Shared mobile page spacing and notifications now preserve bottom safe-area insets.
The account page now has compact responsive cards, accessible visibility toggles,
keyboard focus indicators, mobile-friendly 16px input text, username autocorrect
suppression and inline feedback. Password cleanup also covers visible inputs.

## Provider availability contract

`GET /api/process/account/me` returns a `providers` list populated by
`processor/identity_providers.py`. Google and Apple are explicitly unavailable.
No external SDK, tracking request, OAuth redirect or token exchange is made.
Adding a registry entry is not an authentication implementation. The UI displays
unavailable entries as information, without misleading sign-in buttons.
Future providers should use the same registry after their backend adapter exists.

The owner confirmed developer credentials and the HTTPS domain are not configured.
Real Google/Apple sign-in is still unfinished and cannot be enabled by a UI switch.
No credentials should be committed to the repository or pasted into chat.

## Integration work before enabling providers

- Register Google web OAuth credentials and the exact authorized redirect URI.
- Register Apple's Services ID, associated primary app, domain, return URL and key.
- Implement authorization-code flows with a maintained OIDC library; use one-time,
  expiring, browser-bound state, nonce and PKCE where supported. Validate signature,
  issuer, audience, expiry and nonce before creating a session.
- Persist identity mappings by issuer and subject. Do not merge accounts by email.
  Linking requires an authenticated account and fresh identity verification.
- Handle Apple's form-post callback explicitly: current SameSite=Strict cookies
  and JSON-only mutation endpoints are not a working OAuth callback design.
- Preserve upload ownership guards across navigation, rotate sessions after sign-in,
  validate return destinations, and test replay, cancellation, linking, key rotation,
  provider outages, revoked access, cross-tab changes and owner isolation.
- Supply secrets through protected deployment configuration. Activate a provider
  only after its real end-to-end flow is verified on the registered HTTPS domain.

References: [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect),
[Apple web setup](https://developer.apple.com/help/account/capabilities/configure-sign-in-with-apple-for-the-web).

## Verification

Typecheck and production build passed. Account frontend suites: 17 passed.
Backend account suite: 8 passed. Provider registry test: 1 passed.
A live disposable service returned the expected unavailable Google/Apple contract.
Visual browser inspection was attempted but the in-app browser could not attach;
physical iPhone, narrow-screen screenshots, and a full all-pages audit are unverified.
No Google/Apple login, WinRAR parity, zettabyte capacity or distributed scale claim.
