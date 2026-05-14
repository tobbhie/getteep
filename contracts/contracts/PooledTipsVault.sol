// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IStrategyAdapter.sol";

/**
 * @title PooledTipsVault
 * @notice Optional future pooled Grow Tips vault.
 *         Unlike the beta adapter path, this contract custodies pooled assets and strategy positions.
 *         Keep disabled from beta UX until custody, audits, risk limits, and admin controls are production-ready.
 */
contract PooledTipsVault is ERC4626, Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint16 public constant BPS_DENOMINATOR = 10_000;

    address public allocator;
    IStrategyAdapter public strategyAdapter;
    address public positionToken;
    uint16 public strategyCapBps;

    event AllocatorUpdated(address indexed allocator);
    event StrategyUpdated(address indexed adapter, address indexed positionToken);
    event StrategyCapUpdated(uint16 strategyCapBps);
    event AllocatedToStrategy(address indexed adapter, uint256 amount);
    event RecalledFromStrategy(address indexed adapter, uint256 requestedAmount, uint256 receivedAmount);

    modifier onlyAllocatorOrOwner() {
        require(msg.sender == allocator || msg.sender == owner(), "Vault: not allocator");
        _;
    }

    constructor(
        IERC20 _asset,
        string memory _name,
        string memory _symbol,
        address _owner
    ) ERC20(_name, _symbol) ERC4626(_asset) Ownable(_owner) {
        require(address(_asset) != address(0), "Vault: zero asset");
        require(_owner != address(0), "Vault: zero owner");
        strategyCapBps = 8_000;
    }

    function decimals() public view override(ERC4626) returns (uint8) {
        try IERC20Metadata(asset()).decimals() returns (uint8 assetDecimals) {
            return assetDecimals;
        } catch {
            return super.decimals();
        }
    }

    function totalAssets() public view override returns (uint256) {
        uint256 idleAssets = IERC20(asset()).balanceOf(address(this));
        if (positionToken == address(0)) {
            return idleAssets;
        }
        return idleAssets + IERC20(positionToken).balanceOf(address(this));
    }

    function setAllocator(address _allocator) external onlyOwner {
        allocator = _allocator;
        emit AllocatorUpdated(_allocator);
    }

    function setStrategy(address _adapter) external onlyOwner {
        require(_adapter != address(0), "Vault: zero adapter");
        IStrategyAdapter adapter = IStrategyAdapter(_adapter);
        require(adapter.asset() == asset(), "Vault: asset mismatch");
        address adapterPositionToken = adapter.positionToken();
        require(adapterPositionToken != address(0), "Vault: zero position token");

        strategyAdapter = adapter;
        positionToken = adapterPositionToken;
        emit StrategyUpdated(_adapter, adapterPositionToken);
    }

    function setStrategyCapBps(uint16 _strategyCapBps) external onlyOwner {
        require(_strategyCapBps <= BPS_DENOMINATOR, "Vault: cap too high");
        strategyCapBps = _strategyCapBps;
        emit StrategyCapUpdated(_strategyCapBps);
    }

    function allocateToStrategy(uint256 amount) external onlyAllocatorOrOwner nonReentrant whenNotPaused returns (uint256) {
        require(address(strategyAdapter) != address(0), "Vault: no strategy");
        require(amount > 0, "Vault: zero amount");
        require(amount <= IERC20(asset()).balanceOf(address(this)), "Vault: insufficient idle assets");

        uint256 maxStrategyAssets = (totalAssets() * strategyCapBps) / BPS_DENOMINATOR;
        uint256 currentStrategyAssets = IERC20(positionToken).balanceOf(address(this));
        require(currentStrategyAssets + amount <= maxStrategyAssets, "Vault: strategy cap exceeded");

        IERC20(asset()).forceApprove(address(strategyAdapter), amount);
        uint256 deposited = strategyAdapter.deposit(amount, address(this));
        IERC20(asset()).forceApprove(address(strategyAdapter), 0);

        emit AllocatedToStrategy(address(strategyAdapter), deposited);
        return deposited;
    }

    function recallFromStrategy(uint256 amount) external onlyAllocatorOrOwner nonReentrant returns (uint256) {
        require(address(strategyAdapter) != address(0), "Vault: no strategy");
        require(amount > 0, "Vault: zero amount");

        uint256 positionBalance = IERC20(positionToken).balanceOf(address(this));
        uint256 amountToApprove = amount == type(uint256).max ? positionBalance : amount;
        require(amountToApprove > 0, "Vault: zero position");

        IERC20(positionToken).forceApprove(address(strategyAdapter), amountToApprove);
        uint256 withdrawn = strategyAdapter.withdraw(amount, address(this));
        IERC20(positionToken).forceApprove(address(strategyAdapter), 0);

        emit RecalledFromStrategy(address(strategyAdapter), amount, withdrawn);
        return withdrawn;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function _update(address from, address to, uint256 value) internal override whenNotPaused {
        super._update(from, to, value);
    }
}
