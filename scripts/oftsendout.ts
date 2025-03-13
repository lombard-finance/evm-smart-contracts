import { task } from 'hardhat/config';
import { LBTC, LBTCOFTAdapter } from '../typechain-types';
import { Options } from '@layerzerolabs/lz-v2-utilities';
import { sleep } from './helpers';

task('send-oft-bera', 'Sends LBTC from mainnet to bera').setAction(
    async (taskArgs, hre) => {
        const [signer] = await hre.ethers.getSigners();
        let owner = await signer.getAddress();

        const adapter = await hre.ethers.getContractAt(
            'LBTCOFTAdapter',
            '0x1290A6b480f7eF14925229fdB66f5680aD8F44AD'
        );
        const lbtc = await hre.ethers.getContractAt(
            'LBTC',
            '0x8236a87084f8B84306f72007F36F2618A5634494'
        );

        const opts = Options.newOptions().addExecutorLzReceiveOption(
            200_000,
            0
        );
        const amountLD = 1000;
        const args = {
            dstEid: 30362,
            to: hre.ethers.AbiCoder.defaultAbiCoder().encode(
                ['address'],
                [signer.address]
            ),
            amountLD: amountLD,
            minAmountLD: amountLD,
            extraOptions: opts.toHex(),
            composeMsg: '0x',
            oftCmd: '0x',
        };
        const msgFee = await adapter.quoteSend(args, false);
        await lbtc
            .connect(signer)
            .approve(await adapter.getAddress(), amountLD);

        await sleep(12000);

        const tx = await adapter.connect(signer).send(
            args,
            {
                nativeFee: msgFee.nativeFee,
                lzTokenFee: msgFee.lzTokenFee,
            },
            signer.address,
            {
                value: msgFee.nativeFee,
            }
        );
    }
);
