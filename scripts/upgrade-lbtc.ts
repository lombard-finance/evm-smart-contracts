import { ethers, upgrades, run } from 'hardhat';
import { getAddresses, verify } from './helpers';
import hardhat from 'hardhat';
import { vars } from 'hardhat/config';

const testEnv = vars.get('LOMBARD_TEST_ENV', 'disabled') === 'enabled';

async function main() {
    const addresses = getAddresses(hardhat.network.name);

    if (!addresses.LBTC) {
        throw Error(`LBTC not deployed to ${hardhat.network.name}`);
    }

    const res = await upgrades.upgradeProxy(
        addresses.LBTC,
        await ethers.getContractFactory(testEnv ? 'LBTCMock' : 'LBTC'),
        {
            redeployImplementation: 'always',
        }
    );
    await res.waitForDeployment();

    console.log(`Deployment address is ${await res.getAddress()}`);

    await verify(run, await res.getAddress());
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
