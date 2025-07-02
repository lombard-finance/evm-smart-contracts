import { HardhatRuntimeEnvironment, TaskArguments } from 'hardhat/types';

export async function stakeFBTC(taskArgs: TaskArguments, hre: HardhatRuntimeEnvironment) {
  const { ethers } = hre;

  const { owner, target, amount, populate } = taskArgs;

  const contract = await ethers.getContractAt('FBTCPartnerVault', target);

  if (populate) {
    const tx = await contract.mint.populateTransaction(amount);
    console.log('Raw transaction:\n', JSON.stringify(tx, null, 2));
  } else {
    // Send the transaction
    const tx = await contract.mint(amount);

    console.log('Transaction sent:', tx.hash);
    await tx.wait();
    console.log(`tx hash: ${tx.hash}`);
  }
}

export async function startRedeemFBTC(taskArgs: TaskArguments, hre: HardhatRuntimeEnvironment) {
  const { ethers } = hre;

  const { owner, target, recipient, amount, txid, index, populate } = taskArgs;

  const contract = await ethers.getContractAt('FBTCPartnerVault', target);

  if (populate) {
    const tx = await contract.initializeBurn.populateTransaction(recipient, amount, txid, index);
    console.log('Raw transaction:\n', JSON.stringify(tx, null, 2));
  } else {
    // Send the transaction
    const tx = await contract.initializeBurn(recipient, amount, txid, index);

    console.log('Transaction sent:', tx.hash);
    await tx.wait();
    console.log(`tx hash: ${tx.hash}`);
  }
}

export async function finalizeRedeemFBTC(taskArgs: TaskArguments, hre: HardhatRuntimeEnvironment) {
  const { ethers } = hre;

  const { owner, target, recipient, amount, txid, index, populate } = taskArgs;

  const contract = await ethers.getContractAt('FBTCPartnerVault', target);

  if (populate) {
    const tx = await contract.finalizeBurn.populateTransaction(recipient, amount, txid, index);
    console.log('Raw transaction:\n', JSON.stringify(tx, null, 2));
  } else {
    // Send the transaction
    const tx = await contract.finalizeBurn(recipient, amount, txid, index);

    console.log('Transaction sent:', tx.hash);
    await tx.wait();
    console.log(`tx hash: ${tx.hash}`);
  }
}
