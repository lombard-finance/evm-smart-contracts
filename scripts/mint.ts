import { hexlify } from "ethers";
import { ethers, upgrades } from "hardhat";

async function main() {
  const [signer] = await ethers.getSigners();
  const signature = await signer.signMessage(
    `chainId: 17000, thresholdKey: d6594eb1-5740-4c2f-bcde-76bb15d85649`
  );
  console.log(signer.address);
  console.log(signature);
  // const lbtc = await ethers.getContractAt(
  //   "LBTC",
  //   "0xED7bfd5C1790576105Af4649817f6d35A75CD818"
  // );
  // const tx = await lbtc.mint(
  //   "0x00000000000000000000000000000000000000000000000000000000000042680000000000000000000000004d4959771a31334d85daf25dac562536332ce9320000000000000000000000000000000000000000000000000000000000000640f6b6d0e1e77df21e406bd730c32b05c3fae8296491a1d946925eff07d02d58250000000000000000000000000000000000000000000000000000000000000000",
  //   "0x12dd7b919c52e56ed35f5fb9a1ef0eb14fdc765391d6c1c29cf461e0aa5140d50d8494fba82afb51775442f8ac2dfb9254238a6df74f00901a1fc7283efe80201b"
  // );
  // console.log(tx);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
