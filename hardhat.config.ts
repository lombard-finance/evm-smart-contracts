import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@openzeppelin/hardhat-upgrades";

import "dotenv";

const config: HardhatUserConfig = {
  solidity: "0.8.24",
  networks: {
    holesky: {
      loggingEnabled: true,
      url: process.env.HOLESKY_RPC || "https://rpc.ankr.com/eth_holesky",
      chainId: 17_000,
      accounts: [
        process.env.DEPLOYER_SK ||
          "77f0ea910db71438400c072581e7e29c579107725f0f97ae07c56aaecac39ea5",
      ],
      timeout: 90_000,
      gas: 8_000_000,
      gasMultiplier: 1.5,
    },
  },
  etherscan: {
    apiKey: {
      holesky: process.env.ETHERSCAN_API_KEY || "",
    },
  },
};

export default config;
