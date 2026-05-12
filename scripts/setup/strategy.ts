import { task } from 'hardhat/config';

/**
 * Configures PPS rate limiter on a strategy.
 * Accepts a human-readable percent change over a time window and computes the
 * on-chain micro-bps / refill-rate parameters automatically.
 *
 * Example – allow 0.5 % change per day:
 *   yarn hardhat setup-strategy-pps-rate-limit <strategy> --percent 0.5 --window 86400
 *
 * Requires MANAGER_ROLE on the strategy.
 */
task(
  'setup-strategy-pps-rate-limit',
  'Configure PPS rate limiter from a human-readable percent/window pair'
)
  .addPositionalParam('strategy', 'Strategy proxy address')
  .addParam('percent', 'Allowed percent change (e.g. 0.5 for 0.5%)')
  .addParam('window', 'Time window in seconds over which the percent is allowed (e.g. 86400 for 1 day)')
  .addFlag('populate', 'Show transaction data and do not broadcast')
  .setAction(async (taskArgs, hre) => {
    const { ethers } = hre;
    const { strategy: strategyAddr, percent, window: windowStr, populate } = taskArgs;

    const pct = Number(percent);
    const windowSec = Number(windowStr);
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
      throw new Error(`percent must be in (0, 100]; got ${percent}`);
    }
    if (!Number.isFinite(windowSec) || windowSec <= 0 || !Number.isInteger(windowSec)) {
      throw new Error(`window must be a positive integer (seconds); got ${windowStr}`);
    }

    // micro-bps: 1 unit = 0.0001 %, so 1 % = 10_000 micro-bps
    const maxBucketBps = Math.round(pct * 10_000);
    if (maxBucketBps === 0 || maxBucketBps > 0xffff_ffff) {
      throw new Error(`Computed maxBucketBps=${maxBucketBps} out of uint32 range`);
    }

    // refillRate: contract uses `(elapsed * refillRate) >> 32`
    // To refill the full bucket in windowSec: refillRate = (maxBucketBps << 32) / windowSec
    const refillRate = BigInt(maxBucketBps) * (1n << 32n) / BigInt(windowSec);
    if (refillRate === 0n) {
      throw new Error('Computed refillRate is 0 – increase percent or decrease window');
    }
    if (refillRate > 0xffff_ffff_ffff_ffffn) {
      throw new Error(`Computed refillRate=${refillRate} overflows uint64`);
    }

    console.log('setPricePerShareRateLimit');
    console.log(`  strategy:     ${strategyAddr}`);
    console.log(`  percent:      ${pct}% over ${windowSec}s`);
    console.log(`  maxBucketBps: ${maxBucketBps} (micro-bps)`);
    console.log(`  refillRate:   ${refillRate}`);

    const strategy = await ethers.getContractAt('StrategyBaseUpgradeable', strategyAddr);

    if (populate) {
      const txData = await strategy.setPricePerShareRateLimit.populateTransaction(maxBucketBps, refillRate);
      console.log(`setPricePerShareRateLimit: ${JSON.stringify(txData, null, 2)}`);
    } else {
      const tx = await strategy.setPricePerShareRateLimit(maxBucketBps, refillRate);
      console.log(`tx: ${tx.hash}`);
      await tx.wait();
    }
  });

/**
 * Calls `addDepositAsset` on `MultiAssetWithAsyncRedemptionStrategy` (or any contract implementing it).
 * Requires `DEFAULT_ADMIN_ROLE` on the strategy.
 */
task(
  'setup-strategy-add-deposit-asset',
  'Register a deposit token, its IAssetConverter, and deposit fee (bps) on a multi-asset strategy'
)
  .addPositionalParam('strategy', 'Strategy proxy address (MultiAssetWithAsyncRedemptionStrategy)')
  .addParam('depositAsset', 'ERC-20 token users may deposit')
  .addParam('converter', 'IAssetConverter address pricing depositAsset into strategy base units')
  .addParam('depositFee', 'Fee on gross deposit, basis points (must be < 10_000)')
  .addFlag('populate', 'Show transaction data and do not broadcast')
  .setAction(async (taskArgs, hre) => {
    const { ethers } = hre;
    const { strategy: strategyArg, depositAsset, converter, depositFee, populate } = taskArgs;

    const feeBps = Number(depositFee);
    if (!Number.isFinite(feeBps) || feeBps < 0 || feeBps >= 10_000) {
      throw new Error(`depositFee must be in [0, 10000); got ${depositFee}`);
    }

    const strategy = await ethers.getContractAt('MultiAssetWithAsyncRedemptionStrategy', strategyArg);

    console.log(`addDepositAsset on ${strategyArg}`);
    console.log(`  depositAsset: ${depositAsset}`);
    console.log(`  converter:    ${converter}`);
    console.log(`  feeBps:       ${feeBps}`);

    if (populate) {
      const txData = await strategy.addDepositAsset.populateTransaction(depositAsset, converter, feeBps);
      console.log(`addDepositAsset: ${JSON.stringify(txData, null, 2)}`);
    } else {
      const tx = await strategy.addDepositAsset(depositAsset, converter, feeBps);
      console.log(`tx: ${tx.hash}`);
      await tx.wait();
    }
  });

/**
 * Registers one deployed Shard proxy (`registerShard`). Optionally sets deposit routing (`setDefaultShard`).
 *
 * Roles: `registerShard` uses DEFAULT_ADMIN_ROLE; `setDefaultShard` uses LIMITED_ADMIN_ROLE.
 */
task(
  'setup-strategy-register-shard',
  'Register one shard on MultiAssetWithAsyncRedemptionStrategy; optionally setDefaultShard for deposit routing'
)
  .addPositionalParam('strategy', 'Strategy proxy address (MultiAssetWithAsyncRedemptionStrategy)')
  .addParam('shard', 'Shard proxy address to register (omit if only updating default)')
  .addFlag('default', 'Optional: shard to set as default after registration')
  .addFlag('populate', 'Show transaction data and do not broadcast')
  .setAction(async (taskArgs, hre) => {
    const { ethers } = hre;
    const { strategy: strategyAddr, shard: shardArg, default: defaultArg, populate } = taskArgs;

    const strategy = await ethers.getContractAt('MultiAssetWithAsyncRedemptionStrategy', strategyAddr);

    const shard = ethers.getAddress(shardArg);
    const already = await strategy.isRegisteredShard(shard);
    if (already) {
      console.log(`skip (already registered): ${shard}`);
    } else {
      console.log(`registerShard: ${shard}`);
      if (populate) {
        const txData = await strategy.registerShard.populateTransaction(shard);
        console.log(JSON.stringify(txData, null, 2));
      } else {
        const tx = await strategy.registerShard(shard);
        console.log(`tx: ${tx.hash}`);
        await tx.wait(2);
        console.log(`shard registered: ${shard}`);
      }
    }

    if (defaultArg) {
      if (!already) {
        throw new Error(
          `shard ${shardArg} is not registered to make it default; register it first (--shard ${shardArg}) or in a prior call`
        );
      }
      console.log(`setDefaultShard: ${shardArg}`);
      if (populate) {
        const txData = await strategy.setDefaultShard.populateTransaction(shard);
        console.log(JSON.stringify(txData, null, 2));
      } else {
        const tx = await strategy.setDefaultShard(shard);
        console.log(`tx: ${tx.hash}`);
        await tx.wait(2);
      }
    }
  });
