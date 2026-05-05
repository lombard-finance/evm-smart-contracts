import { task } from 'hardhat/config';

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
        throw new Error(`shard ${shardArg} is not registered to make it default; register it first (--shard ${shardArg}) or in a prior call`);
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
