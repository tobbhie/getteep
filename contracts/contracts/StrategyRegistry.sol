// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./interfaces/IStrategyAdapter.sol";

/**
 * @title StrategyRegistry
 * @notice Owner-managed allowlist for Grow Tips strategy adapters.
 *         The registry never holds user funds; it only gates which adapters the UI/backend should expose.
 */
contract StrategyRegistry is Ownable {
    struct Strategy {
        address adapter;
        address asset;
        address positionToken;
        bool enabled;
        bool emergencyDisabled;
        string label;
    }

    mapping(bytes32 => Strategy) private strategies;
    bytes32[] private strategyIds;

    event StrategyRegistered(
        bytes32 indexed strategyId,
        address indexed adapter,
        address indexed asset,
        address positionToken,
        string label
    );
    event StrategyEnabledUpdated(bytes32 indexed strategyId, bool enabled);
    event StrategyEmergencyDisabled(bytes32 indexed strategyId, bool emergencyDisabled);

    constructor() Ownable(msg.sender) {}

    function registerStrategy(
        bytes32 _strategyId,
        address _adapter,
        string calldata _label,
        bool _enabled
    ) external onlyOwner {
        require(_strategyId != bytes32(0), "Registry: zero strategy");
        require(_adapter != address(0), "Registry: zero adapter");
        require(strategies[_strategyId].adapter == address(0), "Registry: strategy exists");

        address adapterStrategyAsset = IStrategyAdapter(_adapter).asset();
        address adapterPositionToken = IStrategyAdapter(_adapter).positionToken();
        require(IStrategyAdapter(_adapter).strategyId() == _strategyId, "Registry: strategy mismatch");
        require(adapterStrategyAsset != address(0), "Registry: zero asset");
        require(adapterPositionToken != address(0), "Registry: zero position token");

        strategies[_strategyId] = Strategy({
            adapter: _adapter,
            asset: adapterStrategyAsset,
            positionToken: adapterPositionToken,
            enabled: _enabled,
            emergencyDisabled: false,
            label: _label
        });
        strategyIds.push(_strategyId);

        emit StrategyRegistered(_strategyId, _adapter, adapterStrategyAsset, adapterPositionToken, _label);
        emit StrategyEnabledUpdated(_strategyId, _enabled);
    }

    function setStrategyEnabled(bytes32 _strategyId, bool _enabled) external onlyOwner {
        Strategy storage strategy = _requireStrategy(_strategyId);
        strategy.enabled = _enabled;
        emit StrategyEnabledUpdated(_strategyId, _enabled);
    }

    function setStrategyEmergencyDisabled(bytes32 _strategyId, bool _emergencyDisabled) external onlyOwner {
        Strategy storage strategy = _requireStrategy(_strategyId);
        strategy.emergencyDisabled = _emergencyDisabled;
        emit StrategyEmergencyDisabled(_strategyId, _emergencyDisabled);
    }

    function isStrategyAvailable(bytes32 _strategyId) external view returns (bool) {
        Strategy storage strategy = strategies[_strategyId];
        return strategy.adapter != address(0) && strategy.enabled && !strategy.emergencyDisabled;
    }

    function getStrategy(bytes32 _strategyId) external view returns (Strategy memory) {
        require(strategies[_strategyId].adapter != address(0), "Registry: unknown strategy");
        return strategies[_strategyId];
    }

    function getStrategyIds() external view returns (bytes32[] memory) {
        return strategyIds;
    }

    function strategyCount() external view returns (uint256) {
        return strategyIds.length;
    }

    function _requireStrategy(bytes32 _strategyId) private view returns (Strategy storage strategy) {
        strategy = strategies[_strategyId];
        require(strategy.adapter != address(0), "Registry: unknown strategy");
    }
}
