import { ethers, upgrades, run } from 'hardhat';
import { getAddresses, verify } from './helpers';
import hardhat from 'hardhat';

async function main() {
    const addresses = getAddresses(hardhat.network.name);

    if (!addresses.Consortium) {
        throw Error(`Consortium not deployed to ${hardhat.network.name}`);
    }

    const res = await upgrades.upgradeProxy(
        addresses.Consortium,
        await ethers.getContractFactory('LombardConsortium'),
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
