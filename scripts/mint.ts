import { hexlify } from "ethers";
import { ethers, upgrades } from "hardhat";

async function main() {
  const lbtc = await ethers.getContractAt(
    "LBTC",
    "0xfD18D35A327bb5BA1a1A6cd1b9be6b33FC5Da3e4"
  );

  let buf = Buffer.from(
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQmgAAAAAAAAAAAAAAABi8Qzltyft94fqRXdr0FAwimEVCAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAe",
    "base64"
  );
  console.log(buf.toString("hex"));

  const myBuffer = Buffer.from(
    "dvqZ6uHmGhfMVZOkNtrUoYRhTWcV2Nl+nvpsyDTy39NK93RJHJCPl7ba7Ho1ipjiwksuH09/zEWOUpPAPCIdyQA=",
    "base64"
  );
  myBuffer[myBuffer.length - 1] += 27;
  console.log(myBuffer.toString("hex"));

  const tx = await lbtc.mint(
    `0x${buf.toString("hex")}`,
    `0x${myBuffer.toString("hex")}`
  );
  console.log(tx);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
