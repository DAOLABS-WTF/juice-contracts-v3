// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
import '@openzeppelin/contracts/utils/introspection/ERC165.sol';

import '../abstract/JBOperatable.sol';
import '../interfaces/IJBDirectory.sol';
import '../interfaces/IJBOperatorStore.sol';
import '../interfaces/IJBProjects.sol';
import '../interfaces/IJBProjectPayer.sol';
import '../libraries/JBOperations.sol';
import '../libraries/JBTokens.sol';

/**
 * @notice This contract is compatible with the original JBETHERC20ProjectPayer and conforms to the same interface. Instead of relying on Ownable it uses the Operator mechanism of the platform. This contract requires the JBOperations.MANAGE_PAYMENTS permission for priviledged operations.
 *
 * @notice This contract is a shim between the project contributor and the Juicebox payment processing mechanism. It forwards payments to the payment terminal registered for the given project and payment token pair.
 *
 * @notice The usecase for this contract is an easy means of accounting for payments. For example, deploying an instance to receive payments for NFT mint fees or deploying an instance to collect contributions for a particular fund-raising campaign. These instances would have different default memos, this data can later be used to categorize receipts.
 *
 * @notice see also PaymentProcessor.sol
 */
contract ThinProjectPayer is ERC165, JBOperatable, IJBProjectPayer {
  using SafeERC20 for IERC20;

  //*********************************************************************//
  // -------------------------- custom errors -------------------------- //
  //*********************************************************************//

  error INCORRECT_DECIMAL_AMOUNT();
  error NO_MSG_VALUE_ALLOWED();
  error TERMINAL_NOT_FOUND();
  error INVALID_OPERATION();

  //*********************************************************************//
  // --------------------- public stored properties -------------------- //
  //*********************************************************************//

  /**
   * @notice A contract storing directories of terminals and controllers for each project.
   */
  IJBDirectory public override directory;

  address public projectPayerDeployer;

  /**
   * @notice Projects NFT, required for permissions management.
   */
  IJBProjects public projects;

  /**
   * @notice The ID of the project that should be used to forward this contract's received payments.
   */
  uint256 public override defaultProjectId;

  /**
   * @notice The beneficiary that should be used in the payment made when this contract receives payments.
   */
  address payable public override defaultBeneficiary;

  /**
   * @notice A flag indicating whether issued tokens should be automatically claimed into the beneficiary's wallet. Leaving tokens unclaimed saves gas.
   */
  bool public override defaultPreferClaimedTokens;

  /**
   * @notice A flag indicating if received payments should call the `pay` function or the `addToBalance` function of a project.
   */
  bool public override defaultPreferAddToBalance;

  /**
   * @notice The memo that should be used in the payment made when this contract receives payments.
   */
  string public override defaultMemo;

  /**
   * @notice The metadata that should be used in the payment made when this contract receives payments.
   */
  bytes public override defaultMetadata;

  //*********************************************************************//
  // -------------------------- initializer ---------------------------- //
  //*********************************************************************//

  /**
   * @notice This contract is meant to be cloned by the deployer contract. The default instance is attached to the platform project during platform deployment.
   */
  constructor(uint256 _defaultProjectId) {
    defaultProjectId = _defaultProjectId; // prevent initialization of default instance
  }

  /**
   * @notice This function is called by the deployer contract to attach a cloned instance to a particular project. This happens atomically following the clone operation.
   *
   * @dev Note that unlike JBETHERC20ProjectPayer, this contract relies on JBOperatable to authorize privileged operations.
   *
   * @param _jbxDirectory Juicebox directory contract.
   * @param _jbxOperatorStore Juicebox operator store for operation auth.
   * @param _jbxProjects Juicebox projects NFT for operation auth.
   * @param _defaultProjectId The ID of the project whose treasury should be forwarded this contract's received payments.
   * @param _defaultBeneficiary The address that'll receive the project's tokens.
   * @param _defaultPreferClaimedTokens A flag indicating whether issued tokens should be automatically claimed into the beneficiary's wallet.
   * @param _defaultPreferAddToBalance A flag indicating if received payments should call the `pay` function or the `addToBalance` function of a project.
   * @param _defaultMemo A memo to pass along to the emitted event, and passed along the the funding cycle's data source and delegate.  A data source can alter the memo before emitting in the event and forwarding to the delegate.
   * @param _defaultMetadata Bytes to send along to the project's data source and delegate, if provided.
   */
  function initialize(
    IJBDirectory _jbxDirectory,
    IJBOperatorStore _jbxOperatorStore,
    IJBProjects _jbxProjects,
    uint256 _defaultProjectId,
    address payable _defaultBeneficiary,
    bool _defaultPreferClaimedTokens,
    bool _defaultPreferAddToBalance,
    string memory _defaultMemo,
    bytes memory _defaultMetadata
  ) public {
    operatorStore = _jbxOperatorStore; // JBOperatable

    directory = _jbxDirectory;
    projects = _jbxProjects;

    if (defaultProjectId != 0) {
      // NOTE: prevent re-init
      revert INVALID_OPERATION();
    }

    defaultProjectId = _defaultProjectId;
    defaultBeneficiary = _defaultBeneficiary;
    defaultPreferClaimedTokens = _defaultPreferClaimedTokens;
    defaultPreferAddToBalance = _defaultPreferAddToBalance;
    defaultMemo = _defaultMemo;
    defaultMetadata = _defaultMetadata;
  }

  function initialize(
    uint256 _defaultProjectId,
    address payable _defaultBeneficiary,
    bool _defaultPreferClaimedTokens,
    string memory _defaultMemo,
    bytes memory _defaultMetadata,
    bool _defaultPreferAddToBalance,
    address _owner
  ) external {
    //
  }

  //*********************************************************************//
  // ------------------------- default receive ------------------------- //
  //*********************************************************************//

  /**
   * @notice Received funds are paid to the default project ID using the stored default properties.
   *
   * @dev Use the `addToBalance` function if there's a preference to do so. Otherwise use `pay`.
   *
   * @dev This function is called automatically when the contract receives an ETH payment.
   */
  receive() external payable virtual override {
    if (defaultPreferAddToBalance)
      _addToBalanceOf(
        defaultProjectId,
        JBTokens.ETH,
        address(this).balance,
        18, // balance is a fixed point number with 18 decimals.
        defaultMemo,
        defaultMetadata
      );
    else
      _pay(
        defaultProjectId,
        JBTokens.ETH,
        address(this).balance,
        18, // balance is a fixed point number with 18 decimals.
        defaultBeneficiary == address(0) ? tx.origin : defaultBeneficiary,
        0, // Can't determine expectation of returned tokens ahead of time.
        defaultPreferClaimedTokens,
        defaultMemo,
        defaultMetadata
      );
  }

  //*********************************************************************//
  // ---------------------- external transactions ---------------------- //
  //*********************************************************************//

  /**
   * @notice Sets the default values that determine how to interact with a protocol treasury when this contract receives ETH directly.
   *
   * @param _projectId The ID of the project whose treasury should be forwarded this contract's received payments.
   * @param _beneficiary The address that'll receive the project's tokens.
   * @param _preferClaimedTokens A flag indicating whether issued tokens should be automatically claimed into the beneficiary's wallet.
   * @param _memo The memo to pass to the payment terminal.
   * @param _metadata The metadata to pass to the payment terminal.
   * @param _defaultPreferAddToBalance A flag indicating if received payments should call the `pay` function or the `addToBalance` function of a project.
   */
  function setDefaultValues(
    uint256 _projectId,
    address payable _beneficiary,
    bool _preferClaimedTokens,
    string memory _memo,
    bytes memory _metadata,
    bool _defaultPreferAddToBalance
  )
    external
    virtual
    override
    requirePermissionAllowingOverride(
      projects.ownerOf(defaultProjectId),
      defaultProjectId,
      JBOperations.MANAGE_PAYMENTS,
      (msg.sender == address(directory.controllerOf(defaultProjectId)))
    )
  {
    // Set the default project ID if it has changed.
    if (_projectId != defaultProjectId) {
      defaultProjectId = _projectId;
    }

    // Set the default beneficiary if it has changed.
    if (_beneficiary != defaultBeneficiary) {
      defaultBeneficiary = _beneficiary;
    }

    // Set the default claimed token preference if it has changed.
    if (_preferClaimedTokens != defaultPreferClaimedTokens) {
      defaultPreferClaimedTokens = _preferClaimedTokens;
    }

    // Set the default memo if it has changed.
    if (keccak256(abi.encodePacked(_memo)) != keccak256(abi.encodePacked(defaultMemo))) {
      defaultMemo = _memo;
    }

    // Set the default metadata if it has changed.
    if (keccak256(abi.encodePacked(_metadata)) != keccak256(abi.encodePacked(defaultMetadata))) {
      defaultMetadata = _metadata;
    }

    // Set the add to balance preference if it has changed.
    if (_defaultPreferAddToBalance != defaultPreferAddToBalance) {
      defaultPreferAddToBalance = _defaultPreferAddToBalance;
    }

    emit SetDefaultValues(
      _projectId,
      _beneficiary,
      _preferClaimedTokens,
      _memo,
      _metadata,
      _defaultPreferAddToBalance,
      msg.sender
    );
  }

  //*********************************************************************//
  // ----------------------- public transactions ----------------------- //
  //*********************************************************************//

  /**
   * @notice Make a payment to the specified project.
   *
   * @param _projectId The ID of the project that is being paid.
   * @param _token The token being paid in.
   * @param _amount The amount of tokens being paid, as a fixed point number. If the token is ETH, this is ignored and msg.value is used in its place.
   * @param _decimals The number of decimals in the `_amount` fixed point number. If the token is ETH, this is ignored and 18 is used in its place, which corresponds to the amount of decimals expected in msg.value.
   * @param _beneficiary The address who will receive tokens from the payment.
   * @param _minReturnedTokens The minimum number of project tokens expected in return, as a fixed point number with 18 decimals.
   * @param _preferClaimedTokens A flag indicating whether the request prefers to mint project tokens into the beneficiaries wallet rather than leaving them unclaimed. This is only possible if the project has an attached token contract. Leaving them unclaimed saves gas.
   * @param _memo A memo to pass along to the emitted event, and passed along the the funding cycle's data source and delegate. A data source can alter the memo before emitting in the event and forwarding to the delegate.
   * @param _metadata Bytes to send along to the data source, delegate, and emitted event, if provided.
   */
  function pay(
    uint256 _projectId,
    address _token,
    uint256 _amount,
    uint256 _decimals,
    address _beneficiary,
    uint256 _minReturnedTokens,
    bool _preferClaimedTokens,
    string calldata _memo,
    bytes calldata _metadata
  ) public payable virtual override {
    // ETH shouldn't be sent if the token isn't ETH.
    if (address(_token) != JBTokens.ETH) {
      if (msg.value > 0) {
        revert NO_MSG_VALUE_ALLOWED();
      }

      // Get a reference to the balance before receiving tokens.
      uint256 _balanceBefore = IERC20(_token).balanceOf(address(this));

      // Transfer tokens to this contract from the msg sender.
      IERC20(_token).safeTransferFrom(msg.sender, address(this), _amount);

      // The amount should reflect the change in balance.
      _amount = IERC20(_token).balanceOf(address(this)) - _balanceBefore;
    } else {
      // If ETH is being paid, set the amount to the message value, and decimals to 18.
      _amount = msg.value;
      _decimals = 18;
    }

    _pay(
      _projectId,
      _token,
      _amount,
      _decimals,
      _beneficiary,
      _minReturnedTokens,
      _preferClaimedTokens,
      _memo,
      _metadata
    );
  }

  /**
   * @notice Add to the balance of the specified project.
   *
   * @param _projectId The ID of the project that is being paid.
   * @param _token The token being paid in.
   * @param _amount The amount of tokens being paid, as a fixed point number. If the token is ETH, this is ignored and msg.value is used in its place.
   * @param _decimals The number of decimals in the `_amount` fixed point number. If the token is ETH, this is ignored and 18 is used in its place, which corresponds to the amount of decimals expected in msg.value.
   * @param _memo A memo to pass along to the emitted event.
   * @param _metadata Extra data to pass along to the terminal.
   */
  function addToBalanceOf(
    uint256 _projectId,
    address _token,
    uint256 _amount,
    uint256 _decimals,
    string calldata _memo,
    bytes calldata _metadata
  ) public payable virtual override {
    // ETH shouldn't be sent if the token isn't ETH.
    if (address(_token) != JBTokens.ETH) {
      if (msg.value > 0) {
        revert NO_MSG_VALUE_ALLOWED();
      }

      // Get a reference to the balance before receiving tokens.
      uint256 _balanceBefore = IERC20(_token).balanceOf(address(this));

      // Transfer tokens to this contract from the msg sender.
      IERC20(_token).safeTransferFrom(msg.sender, address(this), _amount);

      // The amount should reflect the change in balance.
      _amount = IERC20(_token).balanceOf(address(this)) - _balanceBefore;
    } else {
      // If ETH is being paid, set the amount to the message value, and decimals to 18.
      _amount = msg.value;
      _decimals = 18;
    }

    _addToBalanceOf(_projectId, _token, _amount, _decimals, _memo, _metadata);
  }

  //*********************************************************************//
  // ----------------------------- IERC165 ----------------------------- //
  //*********************************************************************//

  /**
   * @notice Indicates if this contract adheres to the specified interface.
   *
   * @dev See {IERC165-supportsInterface}.
   *
   * @param _interfaceId The ID of the interface to check for adherance to.
   */
  function supportsInterface(
    bytes4 _interfaceId
  ) public view virtual override(ERC165, IERC165) returns (bool) {
    return
      _interfaceId == type(IJBProjectPayer).interfaceId || super.supportsInterface(_interfaceId);
  }

  //*********************************************************************//
  // ---------------------- internal transactions ---------------------- //
  //*********************************************************************//

  /**
   * @notice Make a payment to the specified project.
   *
   * @param _projectId The ID of the project that is being paid.
   * @param _token The token being paid in.
   * @param _amount The amount of tokens being paid, as a fixed point number.
   * @param _decimals The number of decimals in the `_amount` fixed point number.
   * @param _beneficiary The address who will receive tokens from the payment.
   * @param _minReturnedTokens The minimum number of project tokens expected in return, as a fixed point number with 18 decimals.
   * @param _preferClaimedTokens A flag indicating whether the request prefers to mint project tokens into the beneficiaries wallet rather than leaving them unclaimed. This is only possible if the project has an attached token contract. Leaving them unclaimed saves gas.
   * @param _memo A memo to pass along to the emitted event, and passed along the the funding cycle's data source and delegate.  A data source can alter the memo before emitting in the event and forwarding to the delegate.
   * @param _metadata Bytes to send along to the data source and delegate, if provided.
   */
  function _pay(
    uint256 _projectId,
    address _token,
    uint256 _amount,
    uint256 _decimals,
    address _beneficiary,
    uint256 _minReturnedTokens,
    bool _preferClaimedTokens,
    string memory _memo,
    bytes memory _metadata
  ) internal virtual {
    // Find the terminal for the specified project.
    IJBPaymentTerminal _terminal = directory.primaryTerminalOf(_projectId, _token);

    // There must be a terminal.
    if (_terminal == IJBPaymentTerminal(address(0))) {
      revert TERMINAL_NOT_FOUND();
    }

    // The amount's decimals must match the terminal's expected decimals.
    if (_terminal.decimalsForToken(_token) != _decimals) {
      revert INCORRECT_DECIMAL_AMOUNT();
    }

    // Approve the `_amount` of tokens from the destination terminal to transfer tokens from this contract.
    if (_token != JBTokens.ETH) IERC20(_token).safeApprove(address(_terminal), _amount);

    // If the token is ETH, send it in msg.value.
    uint256 _payableValue = _token == JBTokens.ETH ? _amount : 0;

    // Send funds to the terminal.
    // If the token is ETH, send it in msg.value.
    _terminal.pay{value: _payableValue}(
      _projectId,
      _amount, // ignored if the token is JBTokens.ETH.
      _token,
      _beneficiary != address(0) ? _beneficiary : defaultBeneficiary != address(0)
        ? defaultBeneficiary
        : tx.origin,
      _minReturnedTokens,
      _preferClaimedTokens,
      _memo,
      _metadata
    );
  }

  /**
   * @notice Add to the balance of the specified project.
   *
   * @param _projectId The ID of the project that is being paid.
   * @param _token The token being paid in.
   * @param _amount The amount of tokens being paid, as a fixed point number. If the token is ETH, this is ignored and msg.value is used in its place.
   * @param _decimals The number of decimals in the `_amount` fixed point number. If the token is ETH, this is ignored and 18 is used in its place, which corresponds to the amount of decimals expected in msg.value.
   * @param _memo A memo to pass along to the emitted event.
   * @param _metadata Extra data to pass along to the terminal.
   */
  function _addToBalanceOf(
    uint256 _projectId,
    address _token,
    uint256 _amount,
    uint256 _decimals,
    string memory _memo,
    bytes memory _metadata
  ) internal virtual {
    // Find the terminal for the specified project.
    IJBPaymentTerminal _terminal = directory.primaryTerminalOf(_projectId, _token);

    // There must be a terminal.
    if (_terminal == IJBPaymentTerminal(address(0))) {
      revert TERMINAL_NOT_FOUND();
    }

    // The amount's decimals must match the terminal's expected decimals.
    if (_terminal.decimalsForToken(_token) != _decimals) {
      revert INCORRECT_DECIMAL_AMOUNT();
    }

    // Approve the `_amount` of tokens from the destination terminal to transfer tokens from this contract.
    if (_token != JBTokens.ETH) IERC20(_token).safeApprove(address(_terminal), _amount);

    // If the token is ETH, send it in msg.value.
    uint256 _payableValue = _token == JBTokens.ETH ? _amount : 0;

    // Add to balance so tokens don't get issued.
    _terminal.addToBalanceOf{value: _payableValue}(_projectId, _amount, _token, _memo, _metadata);
  }
}
