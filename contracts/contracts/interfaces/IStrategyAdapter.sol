// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IStrategyAdapter {
    function strategyId() external view returns (bytes32);

    function asset() external view returns (address);

    function positionToken() external view returns (address);

    function deposit(uint256 amount, address beneficiary) external returns (uint256);

    function withdraw(uint256 amount, address recipient) external returns (uint256);
}
