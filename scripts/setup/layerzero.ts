import { task } from 'hardhat/config';
import { Options } from '@layerzerolabs/lz-v2-utilities';

task('setup-endpoint-config', 'Configure LayerZero endpoint')
    .addParam(
        'lzEndpoint',
        'The address of LayerZero endpointV2 smart-contract'
    )
    .addParam('remoteEid', 'Eid of remote chain')
    .addParam('oappAddress', 'The address of OFTAdapter')
    // uln configs
    .addParam('ulnLibAddress', 'The address of ULN lib')
    .addParam(
        'ulnConfirmations',
        'The minimum number of block confirmations the DVNs must have waited for their verification to be considered valid',
        '64'
    )
    .addParam(
        'ulnRequiredDvnCount',
        "The quantity of required DVNs that must verify before receiving the OApp's message",
        '2'
    )
    .addParam(
        'ulnOptionalDvnCount',
        "The quantity of optional DVNs that must verify before receiving the OApp's message",
        '0'
    )
    .addParam(
        'ulnOptionalDvnThreshold',
        'The minimum number of verifications needed from optional DVNs. A message is deemed Verifiable if it receives verifications from at least the number of optional DVNs specified by the optionalDVNsThreshold, plus the required DVNs',
        '0'
    )
    .addParam(
        'ulnRequiredDvns',
        'An array of addresses for all required DVNs to receive verifications from'
    )
    .addOptionalParam(
        'ulnOptionalDvns',
        'An array of addresses for all optional DVNs to receive verifications from.'
    )
    .addFlag('ulnReceive')
    // executor configs
    .addParam(
        'executorMaxMessageSize',
        'The maximum size of a message that can be sent cross-chain (number of bytes)',
        '0'
    )
    .addParam(
        'executorAddress',
        'The executor implementation to pay fees to for calling the lzReceive function on the destination chain',
        '0x0000000000000000000000000000000000000000'
    )
    .setAction(async (taskArgs, { ethers }, network) => {
        const {
            lzEndpoint,
            remoteEid,
            oappAddress,
            ulnLibAddress,
            ulnReceive,
        } = taskArgs;

        const endpointContract = await ethers.getContractAt(
            'ILayerZeroEndpointV2',
            lzEndpoint
        );

        const ulnConfig = {
            confirmations: taskArgs.ulnConfirmations,
            requiredDVNCount: taskArgs.ulnRequiredDvnCount,
            optionalDVNCount: taskArgs.ulnOptionalDvnCount,
            optionalDVNThreshold: taskArgs.ulnOptionalDvnThreshold,
            requiredDVNs: taskArgs.ulnRequiredDvns.split(','),
            optionalDVNs: taskArgs.ulnOptionalDvns
                ? taskArgs.ulnOptionalDvns.split(',')
                : [],
        };

        const executorConfig = {
            maxMessageSize: taskArgs.executorMaxMessageSize,
            executorAddress: taskArgs.executorAddress,
        };

        // Encode UlnConfig using defaultAbiCoder
        const configTypeUlnStruct =
            'tuple(uint64 confirmations, uint8 requiredDVNCount, uint8 optionalDVNCount, uint8 optionalDVNThreshold, address[] requiredDVNs, address[] optionalDVNs)';
        const encodedUlnConfig = ethers.AbiCoder.defaultAbiCoder().encode(
            [configTypeUlnStruct],
            [ulnConfig]
        );

        // Encode ExecutorConfig using defaultAbiCoder
        const configTypeExecutorStruct =
            'tuple(uint32 maxMessageSize, address executorAddress)';
        const encodedExecutorConfig = ethers.AbiCoder.defaultAbiCoder().encode(
            [configTypeExecutorStruct],
            [executorConfig]
        );

        // Define the SetConfigParam structs
        const setConfigParamUln = {
            eid: remoteEid,
            configType: 2, // ULN_CONFIG_TYPE
            config: encodedUlnConfig,
        };

        const setConfigParamExecutor = {
            eid: remoteEid,
            configType: 1, // EXECUTOR_CONFIG_TYPE
            config: encodedExecutorConfig,
        };

        // Send the transaction
        const tx = await endpointContract.setConfig(
            oappAddress,
            ulnLibAddress,
            ulnReceive
                ? [setConfigParamUln]
                : [setConfigParamUln, setConfigParamExecutor]
        );

        console.log('Transaction sent:', tx.hash);
        await tx.wait();
    });

task(
    'setup-oft-rate-limits',
    'Configure EfficientRateLimitedOFTAdapter rate limits'
)
    .addParam('eids', 'Eids of remote chains')
    .addParam('limit', 'TBD')
    .addParam('window', 'TBD')
    .addParam('oappAddress', 'The address of OFTAdapter')
    .addFlag('inbound', '')
    .addFlag('outbound', '')
    .setAction(async (taskArgs, { ethers }, network) => {
        const { oappAddress, inbound, outbound, eids, limit, window } =
            taskArgs;

        let direction = -1n;
        if (!!inbound && !outbound) {
            direction = 0n;
        } else if (!inbound && !!outbound) {
            direction = 1n;
        } else {
            throw Error('should be selected only one direction');
        }

        const endpointContract = await ethers.getContractAt(
            'EfficientRateLimitedOFTAdapter',
            oappAddress
        );

        const limits = eids.split(',').map((eid: string) => {
            const e = BigInt(eid);
            return { eid: e, limit, window };
        });

        // Send the transaction
        const tx = await endpointContract.setRateLimits(limits, direction);

        console.log('Transaction sent:', tx.hash);
        await tx.wait();
    });

task('debug-quote-send', 'Call quote send')
    .addParam('oftAdapter', 'The address of LZAdapter smart-contract')
    .setAction(async (taskArgs, hre, network) => {
        const { ethers } = hre;

        const { oftAdapter } = taskArgs;

        const adapter = await ethers.getContractAt(
            'LBTCOFTAdapter',
            oftAdapter
        );

        const opts = Options.newOptions().addExecutorLzReceiveOption(
            150_000,
            0
        );

        console.log(opts.toHex());

        console.log(
            ethers.AbiCoder.defaultAbiCoder().encode(
                ['address'],
                ['0x62F10cE5b727edf787ea45776bD050308A611508']
            )
        );

        const obj = await adapter.quoteSend(
            {
                dstEid: 40291,
                to: ethers.AbiCoder.defaultAbiCoder().encode(
                    ['address'],
                    ['0x62F10cE5b727edf787ea45776bD050308A611508']
                ),
                amountLD: '1000',
                minAmountLD: '1000',
                extraOptions: opts.toHex(),
                composeMsg: '0x',
                oftCmd: '0x',
            },
            false
        );
        console.log(obj);
    });