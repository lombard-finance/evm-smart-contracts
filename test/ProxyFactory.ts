import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';
import { ProxyFactory, LBTC, WBTCMock } from '../typechain-types';
import { ethers } from 'hardhat';
import { expect } from 'chai';
import { takeSnapshot } from '@nomicfoundation/hardhat-network-helpers';
describe('ProxyFactory', () => {
    let proxyFactory: ProxyFactory;
    let lbtcImplementation: LBTC;
    let wbtcMockImplementation: WBTCMock;
    let deployer: HardhatEthersSigner;

    before(async () => {
        [deployer] = await ethers.getSigners();

        let factory = await ethers.getContractFactory('ProxyFactory');
        let contract = (await factory.deploy()) as ProxyFactory;
        await contract.waitForDeployment();
        proxyFactory = factory.attach(
            await contract.getAddress()
        ) as ProxyFactory;

        const lbtcFactory = await ethers.getContractFactory('LBTC');
        lbtcImplementation = (await lbtcFactory.deploy()) as LBTC;
        await lbtcImplementation.waitForDeployment();

        const wbtcMockFactory = await ethers.getContractFactory('WBTCMock');
        wbtcMockImplementation = (await wbtcMockFactory.deploy()) as WBTCMock;
        await wbtcMockImplementation.waitForDeployment();
    });

    it('should create a proxy', async () => {
        const salt = ethers.keccak256('0x1234');
        let data = lbtcImplementation.interface.encodeFunctionData(
            'initialize',
            [deployer.address, 0, deployer.address]
        );

        const proxyAddress = await proxyFactory.getDeployed(salt);

        const snapshot = await takeSnapshot(); // snapshot before deployment
        await proxyFactory.createTransparentProxy(
            await lbtcImplementation.getAddress(),
            deployer.address,
            data,
            salt
        );

        const lbtc = await ethers.getContractAt('LBTC', proxyAddress);
        expect(await lbtc.name()).to.equal('Lombard Staked Bitcoin');

        await snapshot.restore();
        // let's deploy a different contract should be in the same address
        data = wbtcMockImplementation.interface.encodeFunctionData(
            'initialize',
            []
        );
        await proxyFactory.createTransparentProxy(
            await wbtcMockImplementation.getAddress(),
            deployer.address,
            data,
            salt
        );
        const wbtcMock = await ethers.getContractAt('WBTCMock', proxyAddress);
        expect(await wbtcMock.name()).to.equal('Wrapped BTC Mock');
    });
});
