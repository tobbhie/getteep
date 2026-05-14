// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockAToken is ERC20 {
    address public pool;

    constructor() ERC20("Aave Arc Test USDC", "aArcUSDC") {}

    modifier onlyPool() {
        require(msg.sender == pool, "aToken: not pool");
        _;
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function setPool(address _pool) external {
        require(pool == address(0), "aToken: pool set");
        require(_pool != address(0), "aToken: zero pool");
        pool = _pool;
    }

    function mint(address to, uint256 amount) external onlyPool {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external onlyPool {
        _burn(from, amount);
    }
}
