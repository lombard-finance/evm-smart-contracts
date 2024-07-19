const eth = require("ethereumjs-util");
const rlp = require("rlp");
const Web3 = require("web3");
const abiCoder = require("web3-eth-abi");

function encodeTransactionReceipt(txReceipt) {
  const rlpLogs = txReceipt.logs.map((log) => {
    return [
      // address
      log.address,
      // topics
      log.topics,
      // data
      Buffer.from(log.data.substr(2), "hex"),
    ];
  });

  const rlpReceipt = [
    // postStateOrStatus
    Web3.utils.numberToHex(Number(txReceipt.status)),
    // cumulativeGasUsed
    Web3.utils.numberToHex(txReceipt.cumulativeGasUsed.toString()),
    // bloom
    //txReceipt.logsBloom,
    // logs
    rlpLogs,
  ];

  const encodedReceipt = rlp.encode(rlpReceipt),
    receiptHash = eth.keccak256(encodedReceipt);
  return [`0x${encodedReceipt.toString("hex")}`, `0x${receiptHash.toString("hex")}`];
}

function encodeProof(chainId, status, txHash, blockNumber, blockHash, txIndex, receiptHash, amount) {
  const proofData = Buffer.concat([
    Buffer.from(abiCoder.encodeParameters(["uint256", "uint256"], [chainId, status]).substr(2), "hex"),
    Buffer.from(txHash.substr(2), "hex"),
    Buffer.from(abiCoder.encodeParameters(["uint256"], [blockNumber]).substring(2), "hex"),
    Buffer.from(blockHash.substr(2), "hex"),
    Buffer.from(abiCoder.encodeParameters(["uint256"], [txIndex]).substring(2), "hex"),
    Buffer.from(receiptHash.substr(2), "hex"),
    Buffer.from(amount.substr(2), "hex"),
  ]);

  return [`0x${proofData.toString("hex")}`, `0x${eth.keccak256(proofData).toString("hex")}`];
}

module.exports = {
  encodeTransactionReceipt,
  encodeProof,
};
