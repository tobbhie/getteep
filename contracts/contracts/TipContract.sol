// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./WalletFactory.sol";

/**
 * @title TipContract
 * @notice Stateless tipping contract. Forwards USDC to the deterministic
 *         claim wallet for a given X author. Emits events only — no on-chain
 *         balance storage. The indexer/backend reads events to build aggregates.
 */
contract TipContract is ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice The USDC token contract on Base
    IERC20 public immutable usdc;

    /// @notice The wallet factory for computing claim wallet addresses
    WalletFactory public immutable factory;

    /// @notice Minimum tip amount (0.01 USDC = 10_000 units at 6 decimals)
    uint256 public constant MIN_TIP = 10_000;

    event Tipped(
        bytes32 indexed contentId,
        uint256 indexed authorId,
        address indexed from,
        address to,
        uint256 amount
    );

    constructor(address _usdc, address _factory) {
        require(_usdc != address(0), "Tip: zero USDC");
        require(_factory != address(0), "Tip: zero factory");
        usdc = IERC20(_usdc);
        factory = WalletFactory(_factory);
    }

    /**
     * @notice Tip USDC to an X post author
     * @param contentId keccak256 of canonical post identifier "x.com/{authorId}/status/{tweetId}"
     * @param authorId The numeric X author ID
     * @param amount The USDC amount (6 decimals)
     *
     * @dev Caller must have approved this contract to spend `amount` USDC.
     *      Tips go to the deterministic claim wallet address, whether or not
     *      it has been deployed yet.
     */
    function tip(
        bytes32 contentId,
        uint256 authorId,
        uint256 amount
    ) external nonReentrant {
        require(amount >= MIN_TIP, "Tip: below minimum");

        // Compute the deterministic claim wallet address
        address claimWallet = factory.computeClaimWallet(authorId);

        // Transfer USDC from sender to claim wallet
        usdc.safeTransferFrom(msg.sender, claimWallet, amount);

        emit Tipped(contentId, authorId, msg.sender, claimWallet, amount);
    }

    /**
     * @notice Batch tip multiple posts in a single transaction
     * @param contentIds Array of content IDs
     * @param authorIds Array of author IDs
     * @param amounts Array of USDC amounts
     */
    function tipBatch(
        bytes32[] calldata contentIds,
        uint256[] calldata authorIds,
        uint256[] calldata amounts
    ) external nonReentrant {
        uint256 len = contentIds.length;
        require(len == authorIds.length && len == amounts.length, "Tip: length mismatch");

        for (uint256 i = 0; i < len; i++) {
            require(amounts[i] >= MIN_TIP, "Tip: below minimum");

            address claimWallet = factory.computeClaimWallet(authorIds[i]);
            usdc.safeTransferFrom(msg.sender, claimWallet, amounts[i]);

            emit Tipped(contentIds[i], authorIds[i], msg.sender, claimWallet, amounts[i]);
        }
    }
}
