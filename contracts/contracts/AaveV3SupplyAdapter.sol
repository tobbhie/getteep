// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./StrategyRegistry.sol";
import "./interfaces/IAaveV3Pool.sol";
import "./interfaces/IStrategyAdapter.sol";

/**
 * @title AaveV3SupplyAdapter
 * @notice Non-custodial Grow Tips adapter for Aave-style lending markets.
 *         Deposits pull assets from the caller and supply to Aave with the beneficiary as position owner.
 *         Withdrawals pull the user's aToken position and redeem directly to the requested recipient.
 */
contract AaveV3SupplyAdapter is Ownable, Pausable, ReentrancyGuard, IStrategyAdapter {
    using SafeERC20 for IERC20;

    uint16 public constant AAVE_REFERRAL_CODE = 0;

    StrategyRegistry public immutable registry;
    IAaveV3Pool public immutable pool;
    bytes32 public immutable override strategyId;
    address public immutable override asset;
    address public immutable override positionToken;

    event Deposited(address indexed caller, address indexed beneficiary, address indexed asset, uint256 amount);
    event Withdrawn(address indexed caller, address indexed recipient, address indexed asset, uint256 amount);

    constructor(
        address _registry,
        address _pool,
        bytes32 _strategyId,
        address _asset,
        address _positionToken
    ) Ownable(msg.sender) {
        require(_registry != address(0), "Adapter: zero registry");
        require(_pool != address(0), "Adapter: zero pool");
        require(_strategyId != bytes32(0), "Adapter: zero strategy");
        require(_asset != address(0), "Adapter: zero asset");
        require(_positionToken != address(0), "Adapter: zero position token");

        registry = StrategyRegistry(_registry);
        pool = IAaveV3Pool(_pool);
        strategyId = _strategyId;
        asset = _asset;
        positionToken = _positionToken;
    }

    function deposit(uint256 amount, address beneficiary) external override nonReentrant whenNotPaused returns (uint256) {
        require(registry.isStrategyAvailable(strategyId), "Adapter: strategy unavailable");
        require(amount > 0, "Adapter: zero amount");
        require(beneficiary != address(0), "Adapter: zero beneficiary");

        IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);
        IERC20(asset).forceApprove(address(pool), amount);
        pool.supply(asset, amount, beneficiary, AAVE_REFERRAL_CODE);
        IERC20(asset).forceApprove(address(pool), 0);

        emit Deposited(msg.sender, beneficiary, asset, amount);
        return amount;
    }

    function withdraw(uint256 amount, address recipient) external override nonReentrant whenNotPaused returns (uint256) {
        _requireRegisteredAdapter();
        require(recipient != address(0), "Adapter: zero recipient");

        uint256 amountToTransfer = amount;
        if (amount == type(uint256).max) {
            amountToTransfer = IERC20(positionToken).balanceOf(msg.sender);
        }
        require(amountToTransfer > 0, "Adapter: zero amount");

        IERC20(positionToken).safeTransferFrom(msg.sender, address(this), amountToTransfer);
        uint256 withdrawn = pool.withdraw(asset, amount, recipient);

        emit Withdrawn(msg.sender, recipient, asset, withdrawn);
        return withdrawn;
    }

    function _requireRegisteredAdapter() private view {
        StrategyRegistry.Strategy memory strategy = registry.getStrategy(strategyId);
        require(strategy.adapter == address(this), "Adapter: strategy mismatch");
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
