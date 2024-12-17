import { task } from 'hardhat/config';
import { LBTC, LBTCOFTAdapter } from '../typechain-types';
import { Options } from '@layerzerolabs/lz-v2-utilities';

task('receive-oft-bera', 'Sends LBTC from bera cartio to sepolia').setAction(
    async (taskArgs, hre) => {
        const [signer] = await hre.ethers.getSigners();
        let owner = await signer.getAddress();

        const adapter = await hre.ethers.getContractAt(
            'LBTCBurnMintOFTAdapter',
            '0xED7bfd5C1790576105Af4649817f6d35A75CD818'
        );
        const lbtc = await hre.ethers.getContractAt(
            'LBTC',
            '0x73a58b73018c1a417534232529b57b99132b13D2'
        );

        const opts = Options.newOptions().addExecutorLzReceiveOption(
            100_000,
            0
        );
        const amountLD = 1000;
        const args = {
            dstEid: 40161,
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
