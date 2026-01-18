// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import "forge-std/Script.sol";
import "../contracts/types/Intent.sol";

contract ComputeHash is Script {
    function run() public pure {
        DepositIntent memory intent = DepositIntent({
            intentId: 0x5555555555555555555555555555555555555555555555555555555555555555,
            ownerHash: 0x6666666666666666666666666666666666666666666666666666666666666666,
            asset: 0x998abeb3E57409262aE5b751f60747921B33613E,
            amount: 1_000_000,
            originalDecimals: 6,
            deadline: 1_768_509_566,
            salt: 0x7777777777777777777777777777777777777777777777777777777777777777,
            secretHash: 0x8888888888888888888888888888888888888888888888888888888888888888
        });

        bytes32 hash = IntentLib.hashDepositIntent(intent);
        console.log("Hash from Solidity IntentLib:");
        console.logBytes32(hash);

        // Also compute manually
        bytes32 manualHash = keccak256(
            abi.encode(
                intent.intentId,
                intent.ownerHash,
                intent.asset,
                intent.amount,
                intent.originalDecimals,
                intent.deadline,
                intent.salt,
                intent.secretHash
            )
        );
        console.log("Hash computed manually:");
        console.logBytes32(manualHash);

        // Show the encoded data
        bytes memory encoded = abi.encode(
            intent.intentId,
            intent.ownerHash,
            intent.asset,
            intent.amount,
            intent.originalDecimals,
            intent.deadline,
            intent.salt,
            intent.secretHash
        );
        console.log("Encoded length:", encoded.length);
    }
}
