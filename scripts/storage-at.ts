import { ethers } from 'hardhat';

async function main() {
  const BRIDGE_CONTRACT = '0xA869817b48b25EeE986bdF4bE04062e6fd2C418B';

  const defaultAbiCoder = ethers.AbiCoder.defaultAbiCoder();
  console.log();

  // Step 1: keccak256 hash of the string
  const typeHash = ethers.keccak256(ethers.toUtf8Bytes('lombardfinance.storage.Bridge'));

  // Step 2: Convert hash to BigNumber and subtract 1
  const slotIndex = ethers.toBigInt(typeHash) - 1n;

  // Step 3: abi.encode(uint256) — here, we just use ethers' default zero-padded hex
  const encoded = defaultAbiCoder.encode(['uint256'], [slotIndex]);

  // Step 4: keccak256 of encoded data
  const storageSlot = ethers.keccak256(encoded);

  // Step 5: AND with ~bytes32(uint256(0xff)) = mask out last byte (set it to 0)
  const mask = ethers.toBigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff00');
  const slotOffset = ethers.toBigInt(storageSlot) & mask;

  const encodedMap = defaultAbiCoder.encode(
    ['bytes32', 'uint256'],
    ['0x0000000000000000000000000000000000000000000000000000000000000001', BigInt(slotOffset) + 6n]
  );
  const slot = ethers.toBigInt(ethers.keccak256(encodedMap));

  console.log(await ethers.provider.getStorage(BRIDGE_CONTRACT, slot));
  console.log(await ethers.provider.getStorage(BRIDGE_CONTRACT, slot + 1n));
  console.log(await ethers.provider.getStorage(BRIDGE_CONTRACT, slot + 2n));
  console.log(await ethers.provider.getStorage(BRIDGE_CONTRACT, slot + 3n));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
