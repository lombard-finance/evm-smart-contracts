import { task } from 'hardhat/config';

task('mailbox-enable-path', 'Call `enableMessagePath` on mailbox smart-contract')
  .addParam('target', 'The address of mailbox smart-contract')
  .addParam('remoteChainId', 'The destination chain id')
  .addParam('remoteMailbox', 'The address of destination mailbox smart-contract')
  .addParam('direction', 'The path direction (inbound, outbound, both)', 'both')
  .addFlag('populate', 'Show transaction data and do not broadcast')
  .setAction(async (taskArgs, hre, network) => {
    const { target, remoteChainId, remoteMailbox, direction, populate } = taskArgs;

    const toChainId = remoteChainId.includes('0x')
      ? remoteChainId
      : hre.ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [remoteChainId]);

    const toMailbox =
      remoteMailbox.length != 42
        ? remoteMailbox
        : hre.ethers.AbiCoder.defaultAbiCoder().encode(['address'], [remoteMailbox]);

    const mailbox = await hre.ethers.getContractAt('Mailbox', target);

    const dir = resolvePathDirection(direction);

    console.log(`Enabling path to ${toChainId}`);

    if (populate) {
      const txData = await mailbox.enableMessagePath.populateTransaction(toChainId, toMailbox, dir);
      console.log(`enableMessagePath: ${JSON.stringify(txData, null, 2)}`);
    } else {
      const tx = await mailbox.enableMessagePath(toChainId, toMailbox, dir);
      await tx.wait(2);
    }
  });

task('mailbox-set-config', 'Call `setSenderConfig` on mailbox smart-contract')
  .addParam('target', 'The address of mailbox smart-contract')
  .addParam('sender', 'The sender address')
  .addParam('maxPayloadSize', 'The maximum payload size allowed for this sender')
  .addFlag('feeDisabled', 'Show if message fee is disabled for this sender')
  .addFlag('populate', 'Show transaction data and do not broadcast')
  .setAction(async (taskArgs, hre, network) => {
    const { target, sender, maxPayloadSize, feeDisabled, populate } = taskArgs;

    const mailbox = await hre.ethers.getContractAt('Mailbox', target);

    console.log(`Setting config for ${sender}`);

    if (populate) {
      const txData = await mailbox.setSenderConfig.populateTransaction(sender, maxPayloadSize, feeDisabled);
      console.log(`setSenderConfig: ${JSON.stringify(txData, null, 2)}`);
    } else {
      const tx = await mailbox.setSenderConfig(sender, maxPayloadSize, feeDisabled);
      await tx.wait(2);
    }
  });

function resolvePathDirection(dirStr: string): number {
  switch (dirStr.toLowerCase()) {
    case 'outbound':
      return 1;
    case 'inbound':
      return 2;
    case 'both':
      return 3;
    default:
      throw Error(`unexpected direction ${dirStr}`);
  }
}
