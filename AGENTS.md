## Learned User Preferences

- Keep on-contract NatSpec short and precise; put deeper behavior and math explanations in `docs/spec/` and `README.md` (if presented).
- Prefer exact equality assertions in unit tests over loose `greaterThan` / `lessThanOrEqual` checks when precise values are knowable
- Prefer existing helpers such as `scripts/helpers/proxyDeployment.ts` over the OpenZeppelin upgrades plugin for proxy deploy scripts
- Prefer CREATE3 with the same salt as related strategy deployments when matching addresses across chains
- For new undeployed contracts, prefer `AccessControlDefaultAdminRulesUpgradeable` and roles over Ownable when designing access control
- When intentional protocol behavior is accepted (e.g. rate-limit fee interaction), document it as expected rather than changing logic unless asked to redesign
- Prefer HTTPS-resolved git dependencies in yarn over SSH so installs work without SSH keys

## Learned Workspace Facts

- Non-mock contracts should set `/// @custom:security-contact security@lombard.finance`
