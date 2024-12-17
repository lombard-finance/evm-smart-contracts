import { task } from 'hardhat/config';
import { LBTC, LBTCOFTAdapter } from '../typechain-types';
import { Options } from '@layerzerolabs/lz-v2-utilities';

task('send-oft-bera', 'Sends LBTC from sepolia to bera cartio').setAction(
    async (taskArgs, hre) => {
        const [signer] = await hre.ethers.getSigners();
        let owner = await signer.getAddress();

        const adapter = await hre.ethers.getContractAt(
            'LBTCOFTAdapter',
            '0x33a4663C5D5F25e5f93F95A88b0FE8A202064AFE'
        );
        const lbtc = await hre.ethers.getContractAt(
            'LBTC',
            '0xc47e4b3124597FDF8DD07843D4a7052F2eE80C30'
        );

        const opts = Options.newOptions().addExecutorLzReceiveOption(
            100_000,
            0
        );
        const amountLD = 1000;
        const args = {
            dstEid: 40346,
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
        //await lbtc
        //    .connect(signer)
        //    .approve(await adapter.getAddress(), amountLD);

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
