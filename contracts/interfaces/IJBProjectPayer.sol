// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import '@openzeppelin/contracts/utils/introspection/IERC165.sol';
import './IJBDirectory.sol';

interface IJBProjectPayer is IERC165 {
  event SetDefaultValues(
    uint256 indexed projectId,
    address indexed beneficiary,
    bool preferClaimedTokens,
    string memo,
    bytes metadata,
    bool preferAddToBalance,
    address caller
  );

  function directory() external view returns (IJBDirectory);

  function projectPayerDeployer() external view returns (address);

  function defaultProjectId() external view returns (uint256);

  function defaultBeneficiary() external view returns (address payable);

  function defaultPreferClaimedTokens() external view returns (bool);

  function defaultMemo() external view returns (string memory);

  function defaultMetadata() external view returns (bytes memory);

  function defaultPreferAddToBalance() external view returns (bool);

  function initialize(
    uint256 _defaultProjectId,
    address payable _defaultBeneficiary,
    bool _defaultPreferClaimedTokens,
    string memory _defaultMemo,
    bytes memory _defaultMetadata,
    bool _defaultPreferAddToBalance,
    address _owner
  ) external;

  function setDefaultValues(
    uint256 _projectId,
    address payable _beneficiary,
    bool _preferClaimedTokens,
    string memory _memo,
    bytes memory _metadata,
    bool _defaultPreferAddToBalance
  ) external;

  function pay(
    uint256 _projectId,
    address _token,
    uint256 _amount,
    uint256 _decimals,
    address _beneficiary,
    uint256 _minReturnedTokens,
    bool _preferClaimedTokens,
    string memory _memo,
    bytes memory _metadata
  ) external payable;

  function addToBalanceOf(
    uint256 _projectId,
    address _token,
    uint256 _amount,
    uint256 _decimals,
    string memory _memo,
    bytes memory _metadata
  ) external payable;

  receive() external payable;
}
