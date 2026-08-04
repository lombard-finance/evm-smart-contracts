## Learned User Preferences

- Keep on-contract NatSpec short, precise, and aligned with implementation (no phantom APIs or stale params); put deeper behavior and math explanations in `docs/spec/` and `README.md` (if presented)
- Prefer exact equality assertions in unit tests over loose `greaterThan` / `lessThanOrEqual` checks when precise values are knowable
- In exploit / economic sign-off tests, assert exact victim expected vs actual and attacker surplus, and note those exact amounts in comments
- Prefer existing helpers such as `scripts/helpers/proxyDeployment.ts` over the OpenZeppelin upgrades plugin for proxy deploy scripts
- Prefer CREATE3 with the same salt as related strategy deployments when matching addresses across chains
- For new undeployed contracts, prefer `AccessControlDefaultAdminRulesUpgradeable` and roles over Ownable when designing access control
- When intentional protocol behavior is accepted (e.g. rate-limit fee interaction, ≤1 wei PPS differences vs a prior formula, OR pause gating `postPricePerShare`, dust HWM free-roll when fee shares floor to zero, sub-share management-fee time discard on zero-share accrual), or a finding is only docs/spec/tooling drift, align docs and tooling rather than changing Solidity unless asked to redesign
- Prefer HTTPS-resolved git dependencies in yarn over SSH so installs work without SSH keys
- When adding or refining unit tests, leave unrelated existing tests unchanged
- When addressing review findings, verify each against current code; fix only still-valid issues; skip the rest with a brief reason; keep changes minimal

## Learned Workspace Facts

- Non-mock contracts should set `/// @custom:security-contact security@lombard.finance`
- Merkle call allowlist constraint matching requires a full 32-byte window (no pad-at-match); tree building uses OZ `StandardMerkleTree` with `sortLeaves: true`
