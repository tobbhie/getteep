// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IReferralRegistry {
    function treasury() external view returns (address);
    function feeBps() external view returns (uint16);
    function referrerShareBps() external view returns (uint16);
    function getReferrer(address owner) external view returns (address);
}
