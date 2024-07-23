// SPDX-License-Identifier: MIT
// Compatible with OpenZeppelin Contracts ^5.0.0
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import "../interfaces/IBascule.sol";

/// Bascule contract for preventing bridge hacks from hitting the chain.
/// This is the on-chain component of an off-chain/on-chain system.
/// The off-chain component watches all relevant chains and reports
/// deposits to a deployment of this contract on *at most* one chain
/// (to prevent replay attacks). Then, this contract records the relevant
/// deposit transactions. Finally, when a bridge wants to withdraw funds,
/// it can validate that a corresponding deposit took place using the
/// validateWithdrawal function.
///
/// @custom:security-contact security@cubist.dev
contract Bascule is IBascule, Pausable, AccessControlDefaultAdminRules {
  // Role that can pause withdrawal and deposit reporting
  bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
  // Role that can report deposit transactions to the history
  bytes32 public constant DEPOSIT_REPORTER_ROLE = keccak256("DEPOSIT_REPORTER_ROLE");
  // Role that can validate withdrawals (and thus remove deposits from the history)
  bytes32 public constant WITHDRAWAL_VALIDATOR_ROLE = keccak256("WITHDRAWAL_VALIDATOR_ROLE");
  // Role that can be used to change the validation threshold
  bytes32 public constant VALIDATION_GUARDIAN_ROLE = keccak256("VALIDATION_GUARDIAN_ROLE");

  // The bascule validates all withdrawals whose amounts are greater than or
  // equal to this threshold. The bascule allows all withdrawals below this
  // threshold. The contract will still produce events that off-chain code can
  // use to monitor smaller withdrawals. This threshold can only be changed by
  // the guardian.
  //
  // When the threshold is zero (the default), the bascule validates all
  // withdrawals.
  //
  // NOTE: Raising this threshold should be done with extreme caution.  In
  // particular, you MUST make sure that validateWithdrawal is called with a
  // correct withdrawal amount.
  uint256 private _validateThreshold;

  // Maximum number of batch deposits it's possible to make at once
  uint256 private _mMaxDeposits;

  // Mapping that tracks deposits on a different chain that can be used to
  // withdraw the corresponding funds on this chain.
  //
  // NOTE: The deposit identifier should be a hash with enough information to
  // uniquely identify the deposit transaction on the source chain and the
  // recipient, amount, and chain-id on this chain.
  // See README for more.
  mapping(bytes32 depositID => bool reported) public depositHistory;

  /**
   * Event emitted when the validation threshold is updated.
   * @param oldThreshold The old threshold.
   * @param newThreshold The new threshold.
   */
  event UpdateValidateThreshold(uint256 oldThreshold, uint256 newThreshold);

  /**
   * Event emitted when the maximum number of deposits once is changed.
   * @param numDeposits New maximum number of deposits.
   */
  event MaxDepositsUpdated(uint256 numDeposits);

  /**
   * Event emitted when a batch of deposits is reported.
   * @param numDeposits The number of deposits reported.
   */
  event DepositsReported(uint256 numDeposits);

  /**
   * Event emitted when a withdrawal is allowed on this chain without validation.
   * @param depositID Unique identifier for a deposit that took place on another chain and was withdrawn on this chain.
   * @param withdrawalAmount Amount of the withdrawal.
   */
  event WithdrawalNotValidated(bytes32 depositID, uint256 withdrawalAmount);

  /**
   * Error when trying to change the validation threshold to the same value.
   */
  error SameValidationThreshold();

  /**
   * Error when a deposit for a given depositID has already been reported.
   * @param depositID Unique identifier already stored in the depositHistory.
   */
  error AlreadyReported(bytes32 depositID);

  /**
   * Error when batch deposit arguments are non-conforming.
   */
  error BadDepositReport();

  /**
   * Create a new Bascule.
   * @param defaultAdmin Address of the admin.
   * @param pauser Address of the account that may pause.
   * @param depositReporter Address of the account that may report deposits on the source chain.
   * @param withdrawalValidator Address of the account that may validate withdrawals.
   * @param aMaxDeposits Maximum number of deposits that can be reported at once.
   */
  constructor(
    address defaultAdmin,
    address pauser,
    address depositReporter,
    address withdrawalValidator,
    uint256 aMaxDeposits
  ) AccessControlDefaultAdminRules(3 days, defaultAdmin) {
    _grantRole(PAUSER_ROLE, pauser);
    _grantRole(DEPOSIT_REPORTER_ROLE, depositReporter);
    _grantRole(WITHDRAWAL_VALIDATOR_ROLE, withdrawalValidator);
    _mMaxDeposits = aMaxDeposits;
    // By default, the bascule validates all withdrawals and does not grant
    // anyone the guardian role. This means that increasing the threshold (or
    // turning off validation) requires two steps: (1) grant role and (2) change
    // threshold.  To preserve this invariant, we renounce the validation
    // guardian role when the threshold is raised.
    _validateThreshold = 0; // validate all
  }

  /**
   * Pause deposit reporting and withdrawal validation.
   */
  function pause() public onlyRole(PAUSER_ROLE) {
    _pause();
  }

  /**
   * Unpause deposit reporting and withdrawal validation.
   */
  function unpause() public onlyRole(PAUSER_ROLE) {
    _unpause();
  }

  /**
   * Returns the minimum threshold for validating withdrawals.
   */
  function validateThreshold() public view returns (uint256) {
    return _validateThreshold;
  }

  /**
   * Update the validate threshold.
   * @param newThreshold New threshold.
   *
   * Emits {UpdateValidateThreshold}.
   */
  function _updateValidateThreshold(uint256 newThreshold) internal {
    emit UpdateValidateThreshold(_validateThreshold, newThreshold);
    _validateThreshold = newThreshold;
  }

  /**
   * Update the threshold for checking validation withdrawals.
   * Lowering the threshold means we validate more deposits; it only requires
   * the default admin role. Increasing the threshold means we validate fewer
   * deposits; it requires the validation guardian role (which the admin must
   * first grant), which is immediately renounced after the threshold is raised.
   *
   * NOTE: Raising this threshold should be done with extreme caution.  In
   * particular, you MUST make sure that validateWithdrawal is called with a
   * correct withdrawal amount (i.e., the amount of the actual withdraw).
   *
   * Emits {UpdateValidateThreshold}.
   */
  function updateValidateThreshold(uint256 newThreshold) public whenNotPaused {
    if (newThreshold == validateThreshold()) {
      revert SameValidationThreshold();
    }
    if (newThreshold < validateThreshold()) {
      if (!hasRole(DEFAULT_ADMIN_ROLE, _msgSender())) {
        revert AccessControlUnauthorizedAccount(_msgSender(), DEFAULT_ADMIN_ROLE);
      }
    } else {
      if (!hasRole(VALIDATION_GUARDIAN_ROLE, _msgSender())) {
        revert AccessControlUnauthorizedAccount(_msgSender(), VALIDATION_GUARDIAN_ROLE);
      }
      // Renounce the validation guardian role. This ensures the caller doesn't
      // have peristent privileges to effectively disable validation.
      renounceRole(VALIDATION_GUARDIAN_ROLE, _msgSender());
    }
    // Actually update the threshold
    _updateValidateThreshold(newThreshold);
  }

  /**
   * Get maximum number of deposits that can be reported at once.
   */
  function maxDeposits() public view returns (uint256) {
    return _mMaxDeposits;
  }

  /**
   * Set the maximum number of deposits that can be reported at once.
   * May only be invoked by the contract admin.
   *
   * @param aMaxDeposits New maximum number of deposits that can be reported at once.
   */
  function setMaxDeposits(uint256 aMaxDeposits) public whenNotPaused onlyRole(DEFAULT_ADMIN_ROLE) {
    _mMaxDeposits = aMaxDeposits;
    emit MaxDepositsUpdated(aMaxDeposits);
  }

  /**
   * Report that a series of deposit has happened.
   * May only be invoked by the deposit reporter.
   *
   * @param depositIDs Unique identifiers of the deposits on another chain.
   *
   * Emits {DepositsReported}.
   */
  function reportDeposits(
    bytes32[] calldata depositIDs
  ) public whenNotPaused onlyRole(DEPOSIT_REPORTER_ROLE) {
    // Make sure that the input arrays conform to length requirements
    uint256 numDeposits = depositIDs.length;
    if (numDeposits > maxDeposits()) {
      revert BadDepositReport();
    }

    // Vet each set of depositID and withdrawalAddr and add to history
    for (uint256 i = 0; i < numDeposits; i++) {
      bytes32 depositID = depositIDs[i];
      if (depositHistory[depositID]) {
        revert AlreadyReported(depositID);
      }
      depositHistory[depositID] = true;
    }
    emit DepositsReported(numDeposits);
  }

  /**
   * Validate a withdrawal (before executing it) if the amount is above
   * threshold.
   *
   * This function checks if our accounting has recorded a deposit that
   * corresponds to this withdrawal request. It clears the deposit history
   * at the relevant depositID, so should be called as the final step
   * before executing the withdrawal.
   *
   * @param depositID Unique identifier of the deposit on another chain.
   * @param withdrawalAmount Amount of the withdrawal.
   *
   * Emits {WithdrawalValidated}.
   */
  function validateWithdrawal(
    bytes32 depositID,
    uint256 withdrawalAmount
  ) public whenNotPaused onlyRole(WITHDRAWAL_VALIDATOR_ROLE) {
    if (depositHistory[depositID]) {
      // Clear the deposit history to prevent replay
      delete depositHistory[depositID];
      emit WithdrawalValidated(depositID, withdrawalAmount);
      return;
    }
    if (withdrawalAmount >= validateThreshold()) {
      // We disallow a withdrawal if it's not in the depositHistory and
      // the value is above the threshold.
      revert WithdrawalFailedValidation(depositID, withdrawalAmount);
    }
    // We don't have the depositID in the depositHistory, and the value of the
    // withdrawal is below the threshold, so we allow the withdrawal without
    // additional on-chain validation.
    emit WithdrawalNotValidated(depositID, withdrawalAmount);
  }
}
