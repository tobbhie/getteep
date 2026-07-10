// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./WalletFactory.sol";

/**
 * @title XTippingRouter
 * @notice Relays user-authorized X tip commands into real USDC transfers.
 *         Users grant this router ERC-20 allowance once and configure strict
 *         on-chain limits. Approved relayers can only execute transfers that
 *         pass those user-owned limits.
 */
contract XTippingRouter is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdc;
    WalletFactory public immutable factory;

    uint256 public constant MIN_TIP = 10_000;
    uint256 public constant MAX_LIMIT = 10_000_000_000; // 10,000 USDC at 6 decimals

    struct Permission {
        bool enabled;
        uint256 maxPerTip;
        uint256 maxDaily;
        uint256 spentToday;
        uint64 day;
    }

    mapping(address => Permission) public permissions;
    mapping(address => bool) public relayers;
    mapping(bytes32 => bool) public executedCommands;

    event PermissionUpdated(address indexed user, bool enabled, uint256 maxPerTip, uint256 maxDaily);
    event RelayerUpdated(address indexed relayer, bool allowed);
    event Tipped(bytes32 indexed contentId, uint256 indexed authorId, address indexed from, address to, uint256 amount);

    constructor(address _usdc, address _factory, address _initialRelayer) Ownable(msg.sender) {
        require(_usdc != address(0), "XRouter: zero USDC");
        require(_factory != address(0), "XRouter: zero factory");
        require(_initialRelayer != address(0), "XRouter: zero relayer");
        usdc = IERC20(_usdc);
        factory = WalletFactory(_factory);
        relayers[_initialRelayer] = true;
        emit RelayerUpdated(_initialRelayer, true);
    }

    modifier onlyRelayer() {
        require(relayers[msg.sender], "XRouter: not relayer");
        _;
    }

    function setRelayer(address relayer, bool allowed) external onlyOwner {
        require(relayer != address(0), "XRouter: zero relayer");
        relayers[relayer] = allowed;
        emit RelayerUpdated(relayer, allowed);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function setPermission(bool enabled, uint256 maxPerTip, uint256 maxDaily) external {
        require(maxPerTip >= MIN_TIP, "XRouter: per-tip below minimum");
        require(maxDaily >= maxPerTip, "XRouter: daily below per-tip");
        require(maxPerTip <= MAX_LIMIT && maxDaily <= MAX_LIMIT, "XRouter: limit too high");

        Permission storage permission = permissions[msg.sender];
        uint64 today = _currentDay();
        if (permission.day != today) {
            permission.day = today;
            permission.spentToday = 0;
        }
        permission.enabled = enabled;
        permission.maxPerTip = maxPerTip;
        permission.maxDaily = maxDaily;

        emit PermissionUpdated(msg.sender, enabled, maxPerTip, maxDaily);
    }

    function revokePermission() external {
        Permission storage permission = permissions[msg.sender];
        permission.enabled = false;
        emit PermissionUpdated(msg.sender, false, permission.maxPerTip, permission.maxDaily);
    }

    function tipFromX(
        address sender,
        bytes32 commandId,
        bytes32 contentId,
        uint256 authorId,
        uint256 amount
    ) external onlyRelayer whenNotPaused nonReentrant {
        require(sender != address(0), "XRouter: zero sender");
        require(!executedCommands[commandId], "XRouter: command used");
        require(amount >= MIN_TIP, "XRouter: below minimum");

        Permission storage permission = permissions[sender];
        require(permission.enabled, "XRouter: disabled");
        require(amount <= permission.maxPerTip, "XRouter: above per-tip");

        uint64 today = _currentDay();
        if (permission.day != today) {
            permission.day = today;
            permission.spentToday = 0;
        }
        require(permission.spentToday + amount <= permission.maxDaily, "XRouter: above daily");

        executedCommands[commandId] = true;
        permission.spentToday += amount;

        address claimWallet = factory.computeClaimWallet(authorId);
        usdc.safeTransferFrom(sender, claimWallet, amount);

        emit Tipped(contentId, authorId, sender, claimWallet, amount);
    }

    function _currentDay() internal view returns (uint64) {
        return uint64(block.timestamp / 1 days);
    }
}
