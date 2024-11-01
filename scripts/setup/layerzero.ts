import { task } from 'hardhat/config';
import { ethers } from 'hardhat';

task('setup-lzadapter', 'Configure LZAdapter smart-contract')
    .addParam('lzAdapter', 'The address of LZAdapter smart-contract')
    .addOptionalParam('eid', 'Eid of destination chain')
    .addOptionalParam('chain', 'Chain id of EID')
    .addOptionalParam('peer', 'The address of LZAdapter on destination chain')
    .setAction(async (taskArgs, hre, network) => {
        const { ethers } = hre;

        const { lzAdapter, eid, chain, peer } = taskArgs;

        const adapter = await ethers.getContractAt('LZAdapter', lzAdapter);

        if (chain && eid) {
            const toChainId = chain.includes('0x')
                ? chain
                : hre.ethers.AbiCoder.defaultAbiCoder().encode(
                      ['uint256'],
                      [chain]
                  );
            const r = await adapter.setEid(toChainId, eid);
            await r.wait(2);
            console.log(`Chain ${chain} set for eid ${eid}`);
        }

        if (peer && eid) {
            const toPeer =
                peer.length != 42
                    ? peer
                    : hre.ethers.AbiCoder.defaultAbiCoder().encode(
                          ['address'],
                          [peer]
                      );
            const r = await adapter.setPeer(eid, toPeer);
            await r.wait(2);
            console.log(`Peer ${peer} set for eid ${eid}`);
        }

        console.log('DONE');
    });
