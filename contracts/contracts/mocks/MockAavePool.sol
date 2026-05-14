// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./MockAToken.sol";

contract MockAavePool {
    using SafeERC20 for IERC20;

    IERC20 public immutable asset;
    MockAToken public immutable aToken;

    constructor(address _asset, address _aToken) {
        require(_asset != address(0), "Pool: zero asset");
        require(_aToken != address(0), "Pool: zero aToken");
        asset = IERC20(_asset);
        aToken = MockAToken(_aToken);
    }

    function supply(address _asset, uint256 amount, address onBehalfOf, uint16) external {
        require(_asset == address(asset), "Pool: unsupported asset");
        require(onBehalfOf != address(0), "Pool: zero beneficiary");
        asset.safeTransferFrom(msg.sender, address(this), amount);
        aToken.mint(onBehalfOf, amount);
    }

    function withdraw(address _asset, uint256 amount, address to) external returns (uint256) {
        require(_asset == address(asset), "Pool: unsupported asset");
        require(to != address(0), "Pool: zero recipient");
        uint256 amountToWithdraw = amount == type(uint256).max ? aToken.balanceOf(msg.sender) : amount;
        aToken.burn(msg.sender, amountToWithdraw);
        asset.safeTransfer(to, amountToWithdraw);
        return amountToWithdraw;
    }
}
