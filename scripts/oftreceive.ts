import { task } from 'hardhat/config';
import { LBTC, LBTCOFTAdapter } from '../typechain-types';
import { Options } from '@layerzerolabs/lz-v2-utilities';
import { sleep } from './helpers';

task('receive-oft-bera', 'Sends LBTC from bera to mainnet').setAction(async (taskArgs, hre) => {
  const [signer] = await hre.ethers.getSigners();
  let owner = await signer.getAddress();

  const adapter = await hre.ethers.getContractAt(
    'LBTCBurnMintOFTAdapter',
    '0x630e12D53D4E041b8C5451aD035Ea841E08391d7'
  );
  const lbtc = await hre.ethers.getContractAt('LBTC', '0xecAc9C5F704e954931349Da37F60E39f515c11c1');

  const opts = Options.newOptions().addExecutorLzReceiveOption(200_000, 0);
  const amountLD = 1000;
  const args = {
    dstEid: 30101,
    to: hre.ethers.AbiCoder.defaultAbiCoder().encode(['address'], [signer.address]),
    amountLD: amountLD,
    minAmountLD: amountLD,
    extraOptions: opts.toHex(),
    composeMsg: '0x',
    oftCmd: '0x'
  };
  const msgFee = await adapter.quoteSend(args, false);
  await lbtc.connect(signer).approve(await adapter.getAddress(), amountLD);

  await sleep(12000);

  const tx = await adapter.connect(signer).send(
    args,
    {
      nativeFee: msgFee.nativeFee,
      lzTokenFee: msgFee.lzTokenFee
    },
    signer.address,
    {
      value: msgFee.nativeFee
    }
  );
});
