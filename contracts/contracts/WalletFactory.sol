// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/Create2.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./ClaimWallet.sol";

/**
 * @title WalletFactory
 * @notice Deterministically deploys ClaimWallet instances for X authors.
 *         Addresses are computed from authorId so tips can be sent before deployment.
 *         Deployment requires a valid attestation from the trusted signer (backend).
 */
contract WalletFactory is Ownable {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    uint256 public constant ATTESTATION_MAX_AGE = 10 minutes;
    uint256 public constant ATTESTATION_FUTURE_SKEW = 2 minutes;

    /// @notice Trusted backend signer that issues attestations
    address public attestationSigner;

    /// @notice Mapping from authorId to deployed claim wallet
    mapping(uint256 => address) public claimWallets;

    /// @notice Referral/fee registry; claim wallets use it for withdrawWithFee
    address public referralRegistry;

    /// @notice Used nonces to prevent replay
    mapping(bytes32 => bool) public usedNonces;

    event ClaimWalletDeployed(
        uint256 indexed authorId,
        address indexed wallet,
        address indexed owner
    );
    event AttestationSignerUpdated(address indexed newSigner);
    event ReferralRegistryUpdated(address indexed registry);

    constructor(address _attestationSigner) Ownable(msg.sender) {
        require(_attestationSigner != address(0), "Factory: zero signer");
        attestationSigner = _attestationSigner;
        emit AttestationSignerUpdated(_attestationSigner);
    }

    /**
     * @notice Update the attestation signer address
     * @param _newSigner New signer address
     */
    function setAttestationSigner(address _newSigner) external onlyOwner {
        require(_newSigner != address(0), "Factory: zero signer");
        attestationSigner = _newSigner;
        emit AttestationSignerUpdated(_newSigner);
    }

    /**
     * @notice Set the referral registry address. New deployments get it injected; use injectRegistryToWallet for existing wallets.
     */
    function setReferralRegistry(address _registry) external onlyOwner {
        require(_registry != address(0), "Factory: zero registry");
        referralRegistry = _registry;
        emit ReferralRegistryUpdated(_registry);
    }

    /**
     * @notice Inject the current referral registry into an already-deployed claim wallet (e.g. after registry deploy).
     */
    function injectRegistryToWallet(uint256 _authorId) external onlyOwner {
        address wallet = claimWallets[_authorId];
        require(wallet != address(0), "Factory: wallet not deployed");
        require(referralRegistry != address(0), "Factory: no registry set");
        ClaimWallet(payable(wallet)).setReferralRegistry(referralRegistry);
    }

    /**
     * @notice Inject the current withdrawal signer into an already-deployed claim wallet.
     */
    function injectWithdrawalSignerToWallet(uint256 _authorId) external onlyOwner {
        address wallet = claimWallets[_authorId];
        require(wallet != address(0), "Factory: wallet not deployed");
        ClaimWallet(payable(wallet)).setWithdrawalSigner(attestationSigner);
    }

    /**
     * @notice Compute the deterministic address for a claim wallet
     * @param _authorId The X author numeric ID
     * @return The address the wallet will be deployed to
     */
    function computeClaimWallet(uint256 _authorId) public view returns (address) {
        bytes32 salt = _computeSalt(_authorId);
        bytes32 bytecodeHash = keccak256(
            abi.encodePacked(
                type(ClaimWallet).creationCode,
                abi.encode(address(this))
            )
        );
        return Create2.computeAddress(salt, bytecodeHash);
    }

    /**
     * @notice Deploy a claim wallet for an X author
     * @param _authorId The X author numeric ID
     * @param _owner The address that will own the wallet (creator's Privy signer)
     * @param _timestamp Attestation timestamp (must be recent)
     * @param _nonce Unique nonce to prevent replay
     * @param _signature Backend attestation signature
     */
    function deployClaimWallet(
        uint256 _authorId,
        address _owner,
        uint256 _timestamp,
        bytes32 _nonce,
        bytes calldata _signature
    ) external returns (address wallet) {
        require(claimWallets[_authorId] == address(0), "Factory: already deployed");
        require(_owner != address(0), "Factory: zero owner");
        require(block.timestamp <= _timestamp + ATTESTATION_MAX_AGE, "Factory: attestation expired");
        require(_timestamp <= block.timestamp + ATTESTATION_FUTURE_SKEW, "Factory: attestation from future");
        require(!usedNonces[_nonce], "Factory: nonce used");

        // Verify attestation signature
        bytes32 messageHash = keccak256(
            abi.encodePacked(_authorId, _owner, _timestamp, _nonce)
        );
        bytes32 ethSignedHash = messageHash.toEthSignedMessageHash();
        address recovered = ethSignedHash.recover(_signature);
        require(recovered == attestationSigner, "Factory: invalid attestation");

        // Mark nonce as used
        usedNonces[_nonce] = true;

        // Deploy via CREATE2
        bytes32 salt = _computeSalt(_authorId);
        bytes memory bytecode = abi.encodePacked(
            type(ClaimWallet).creationCode,
            abi.encode(address(this))
        );
        wallet = Create2.deploy(0, salt, bytecode);

        // Initialize
        ClaimWallet(payable(wallet)).initialize(_authorId, _owner);

        // Inject registry if set
        if (referralRegistry != address(0)) {
            ClaimWallet(payable(wallet)).setReferralRegistry(referralRegistry);
        }
        ClaimWallet(payable(wallet)).setWithdrawalSigner(attestationSigner);

        // Record
        claimWallets[_authorId] = wallet;

        emit ClaimWalletDeployed(_authorId, wallet, _owner);
    }

    /**
     * @notice Check if a claim wallet has been deployed for an author
     * @param _authorId The X author numeric ID
     */
    function isDeployed(uint256 _authorId) external view returns (bool) {
        return claimWallets[_authorId] != address(0);
    }

    /**
     * @dev Compute the CREATE2 salt for an author
     */
    function _computeSalt(uint256 _authorId) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("X", _authorId));
    }
}
