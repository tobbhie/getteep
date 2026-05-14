// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title ReferralRegistry
 * @notice On-chain referral and fee config. ClaimWallet uses this for withdrawWithFee.
 *         Owner can set treasury, feeBps, referrerShareBps, and the backend signer.
 *         Referrers are set via setReferrer(owner, referrer, expiresAt, nonce, signature) using EIP-712.
 */
contract ReferralRegistry is Ownable, EIP712 {
    bytes32 public constant SET_REFERRER_TYPEHASH =
        keccak256("SetReferrer(address owner,address referrer,uint256 expiresAt,bytes32 nonce)");

    address public treasury;
    uint16 public feeBps;           // e.g. 500 = 5%
    uint16 public referrerShareBps;  // share of fee to referrer, e.g. 3000 = 30%
    address public referrerSigner;   // backend key that signs setReferrer

    mapping(address => address) public referrerOf;  // owner => referrer
    mapping(bytes32 => bool) public usedNonces;

    event TreasuryUpdated(address indexed treasury);
    event FeeBpsUpdated(uint16 feeBps);
    event ReferrerShareBpsUpdated(uint16 referrerShareBps);
    event ReferrerSignerUpdated(address indexed signer);
    event ReferrerSet(address indexed owner, address indexed referrer);

    constructor(
        address _treasury,
        uint16 _feeBps,
        uint16 _referrerShareBps,
        address _referrerSigner
    ) Ownable(msg.sender) EIP712("TipcoinReferralRegistry", "1") {
        require(_treasury != address(0), "Registry: zero treasury");
        require(_feeBps <= 10000, "Registry: fee too high");
        require(_referrerShareBps <= 10000, "Registry: share too high");
        require(_referrerSigner != address(0), "Registry: zero signer");
        treasury = _treasury;
        feeBps = _feeBps;
        referrerShareBps = _referrerShareBps;
        referrerSigner = _referrerSigner;
    }

    function setTreasury(address _treasury) external onlyOwner {
        require(_treasury != address(0), "Registry: zero treasury");
        treasury = _treasury;
        emit TreasuryUpdated(_treasury);
    }

    function setFeeBps(uint16 _feeBps) external onlyOwner {
        require(_feeBps <= 10000, "Registry: fee too high");
        feeBps = _feeBps;
        emit FeeBpsUpdated(_feeBps);
    }

    function setReferrerShareBps(uint16 _referrerShareBps) external onlyOwner {
        require(_referrerShareBps <= 10000, "Registry: share too high");
        referrerShareBps = _referrerShareBps;
        emit ReferrerShareBpsUpdated(_referrerShareBps);
    }

    function setReferrerSigner(address _referrerSigner) external onlyOwner {
        require(_referrerSigner != address(0), "Registry: zero signer");
        referrerSigner = _referrerSigner;
        emit ReferrerSignerUpdated(_referrerSigner);
    }

    /**
     * @notice Set referrer for an owner. Callable by anyone with valid backend EIP-712 signature.
     * @param owner Claim wallet owner (user applying the referral code)
     * @param referrer Referrer address (email-derived Privy account)
     * @param expiresAt Expiry timestamp for the backend authorization
     * @param nonce Unique nonce (backend generates)
     * @param signature Backend EIP-712 signature over SetReferrer(owner, referrer, expiresAt, nonce)
     */
    function setReferrer(
        address owner,
        address referrer,
        uint256 expiresAt,
        bytes32 nonce,
        bytes calldata signature
    ) external {
        require(owner != address(0), "Registry: zero owner");
        require(referrer != address(0), "Registry: zero referrer");
        require(owner != referrer, "Registry: self-referral");
        require(block.timestamp <= expiresAt, "Registry: signature expired");
        require(!usedNonces[nonce], "Registry: nonce used");
        require(referrerOf[owner] == address(0), "Registry: referrer already set");

        bytes32 structHash = keccak256(abi.encode(SET_REFERRER_TYPEHASH, owner, referrer, expiresAt, nonce));
        bytes32 digest = _hashTypedDataV4(structHash);
        address recovered = ECDSA.recover(digest, signature);
        require(recovered == referrerSigner, "Registry: invalid signature");

        usedNonces[nonce] = true;
        referrerOf[owner] = referrer;
        emit ReferrerSet(owner, referrer);
    }

    function getReferrer(address owner) external view returns (address) {
        return referrerOf[owner];
    }
}
