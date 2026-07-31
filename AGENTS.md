## Learned User Preferences

- Keep on-contract NatSpec short, precise, and aligned with implementation (no phantom APIs or stale params); put deeper behavior and math explanations in `docs/spec/` and `README.md` (if presented)
- Prefer exact equality assertions in unit tests over loose `greaterThan` / `lessThanOrEqual` checks when precise values are knowable
- In exploit / economic sign-off tests, assert exact victim expected vs actual and attacker surplus, and note those exact amounts in comments
- Prefer existing helpers such as `scripts/helpers/proxyDeployment.ts` over the OpenZeppelin upgrades plugin for proxy deploy scripts
- For new undeployed contracts, prefer `AccessControlDefaultAdminRulesUpgradeable` and roles over Ownable when designing access control
- When adding or refining unit tests, leave unrelated existing tests unchanged
- When addressing review findings, verify each against current code; fix only still-valid issues; skip the rest with a brief reason; keep changes minimal
- When reducing contract bytecode size, do not lower Solidity optimizer `runs`; prefer structural cuts (dedup, `external` getters, linked libraries) instead
- Prefer PR description and review-note updates over history rewrite or force-push unless explicitly asked

## Learned Workspace Facts

- Non-mock contracts should set `/// @custom:security-contact security@lombard.finance`
