import { ethers } from 'hardhat';

async function calcCcipRateLimits(
    chainSelector: bigint,
    requestTokens: bigint
): Promise<boolean> {
    const tokenPool = await ethers.getContractAt(
        'LombardTokenPool',
        '0x84166eAf4530994C565E6aCC774a6950Ce8c88aA'
    );

    let [tokens, lastUpdated, isEnabled, capacity, rate] =
        await tokenPool.getCurrentOutboundRateLimiterState(chainSelector);

    if (!isEnabled) {
        return true;
    }

    const timeNow = BigInt(Date.now());

    const timeDiff = timeNow - lastUpdated;

    if (timeDiff != 0n) {
        if (tokens > capacity) return false;

        const refillAm = tokens + timeDiff * rate;
        tokens = capacity < refillAm ? capacity : refillAm;
    }

    if (tokens < requestTokens) {
        return false;
    }

    return true;
}

async function main() {
    const belowLimit = await calcCcipRateLimits(
        5009297550715157269n,
        50000000n
    );
    console.log(`belowLimit: ${belowLimit}`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
