import { hexlify } from "ethers";
import { ethers, upgrades } from "hardhat";

async function main() {
  const lbtc = await ethers.getContractAt(
    "LBTC",
    "0xfD18D35A327bb5BA1a1A6cd1b9be6b33FC5Da3e4"
  );

  let buf = Buffer.from(
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQmgAAAAAAAAAAAAAAABNSVl3GjEzTYXa8l2sViU2MyzpMgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACcQ",
    "base64"
  );

  const myBuffer = Buffer.from(
    "yYd6EmPpOldLhg7GvPrlYynEgzvgDwb1TI7fHs0+ZYM/YCNjzmRRRk/PIC9BK/XE4Z/6e4wNqkn6aSy/9jUMlgA=",
    "base64"
  );
  myBuffer[myBuffer.length - 1] += 27;

  console.log("data", `0x${buf.toString("hex")}`);
  console.log("proofSignature", `0x${myBuffer.toString("hex")}`);

  const tx = await lbtc.mint.estimateGas(
    `0x${buf.toString("hex")}`,
    `0x${myBuffer.toString("hex")}`
  );
  console.log(tx);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
