import { HardhatRuntimeEnvironment, TaskArguments } from 'hardhat/types';

export async function send(taskArgs: TaskArguments, hre: HardhatRuntimeEnvironment) {
  const { ethers, config } = hre;

  const { mailbox, toNetwork, recipient: recipientArg, destinationCaller: destinationCallerArg, body, from } = taskArgs;

  const encoder = ethers.AbiCoder.defaultAbiCoder();

  const contract = await ethers.getContractAt('Mailbox', mailbox);

  const destNetwork = config.networks[toNetwork];
  const toChain = encoder.encode(['uint256'], [destNetwork.chainId]);
  const recipient = encoder.encode(['address'], [recipientArg]);
  const destinationCaller = encoder.encode(['address'], [destinationCallerArg || ethers.ZeroAddress]);
  const [signer] = await hre.ethers.getSigners();

  const fee = await contract.getFee(from || (await signer.getAddress()), body);

  if (from) {
    const tx = await contract.send.populateTransaction(toChain, recipient, destinationCaller, body, {
      from,
      value: fee
    });
    console.log('Tx:\n', JSON.stringify(tx, null, 2));
  } else {
    const tx = await contract.send(toChain, recipient, destinationCaller, body, { value: fee });
    console.log(`Tx sent: ${tx.hash}`);
    await tx.wait(2);
  }
}
