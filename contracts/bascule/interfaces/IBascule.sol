// SPDX-License-Identifier: MIT
// Compatible with OpenZeppelin Contracts ^5.0.0
pragma solidity 0.8.24;

/// Interface of the Bascule contract as used by on-chain contracts.
/// @custom:security-contact security@cubist.dev
interface IBascule {
  /**
   * Event emitted when a withdrawal is validated.
   * @param withdrawalAmount Amount of the withdrawal.
   * @param depositID Unique identifier for a deposit that took place on another chain and was withdrawn on this chain.
   */
  event WithdrawalValidated(bytes32 depositID, uint256 withdrawalAmount);

  /**
   * Error on attempt to withdraw an already withdrawn deposit.
   * @param depositID Unique identifier for deposit that failed validation.
   * @param withdrawalAmount Amount of the withdrawal.
   */
  error AlreadyWithdrawn(bytes32 depositID, uint256 withdrawalAmount);

  /**
   * Error when a withdrawal fails validation.
   * This means the corresponding deposit is not in the map.
   * @param depositID Unique identifier for deposit that failed validation.
   * @param withdrawalAmount Amount of the withdrawal.
   */
  error WithdrawalFailedValidation(bytes32 depositID, uint256 withdrawalAmount);

  /**
   * Validate a withdrawal (before executing it) if the amount is above
   * threshold.
   *
   * This function checks if our accounting has recorded a deposit that
   * corresponds to this withdrawal request. A deposit can only be withdrawn
   * once.
   *
   * @param depositID Unique identifier of the deposit on another chain.
   * @param withdrawalAmount Amount of the withdrawal.
   *
   * Emits {WithdrawalValidated}.
   */
  function validateWithdrawal(bytes32 depositID, uint256 withdrawalAmount) external;
}
