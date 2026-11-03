# Security audit

Reviewed active controls: explicit private LAN hosts, Host/Origin checking, request authorization header, owner-isolated cookie sessions, signed downloads, path/link traversal rejection, archive expansion budgets, storage quotas and scoped file deletion. Existing regression suites exercise malformed archives and cross-session access. New restart preparation is loopback-only and requires the matching live instance ID.

Limits: Python host processing is not a public authenticated multi-tenant service; transport is private-network HTTP. Temporary outputs and metadata are not encrypted at rest by the active local service. Browser output URLs are session-only and excluded from persisted state. Dependency advisories, full native unsafe/FFI review, fuzz campaigns, C++ sanitizers and software provenance verification have not been run. Do not treat unexecuted scans as passes.

Windows firewall administration was unavailable in this session; the existing scoped LAN rule was left intact. The updated helper supports local-subnet restrictions without hardcoding the developer IP for future administrator setup.
