// Mirrors the IBlocklistOracle.DenialReason enum in
// contracts/strategy/interfaces/IBlocklistOracle.sol. Values must stay in sync
// with the Solidity enum ordering.
export enum DenialReason {
  Blocklist = 0,
  Sanction = 1
}
