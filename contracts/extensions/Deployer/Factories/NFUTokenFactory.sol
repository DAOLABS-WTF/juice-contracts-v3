// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import '@openzeppelin/contracts/proxy/Clones.sol';

import '../../NFT/NFUToken.sol';
import '../../../interfaces/IJBDirectory.sol';

/**
 * @notice Creates an instance of NFToken contract
 */
library NFUTokenFactory {
  /**
   * @notice In addition to taking the parameters requires by the NFToken contract, the `_owner` argument will be used to assign ownership after contract deployment.
   */
  function createNFUToken(
    address _source,
    address _owner,
    string memory _name,
    string memory _symbol,
    string memory _baseUri,
    string memory _contractUri,
    uint256 _jbxProjectId,
    IJBDirectory _jbxDirectory,
    uint256 _maxSupply,
    uint256 _unitPrice,
    uint256 _mintAllowance
  ) external returns (address token) {
    token = Clones.clone(_source);
    {
      NFUToken(token).initialize(
        _owner,
        _name,
        _symbol,
        _baseUri,
        _contractUri,
        _jbxProjectId,
        _jbxDirectory,
        _maxSupply,
        _unitPrice,
        _mintAllowance,
        0,
        0
      );
    }
  }
}
