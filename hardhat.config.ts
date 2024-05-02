import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@openzeppelin/hardhat-upgrades";

const config: HardhatUserConfig = {
  solidity: "0.8.24",
  networks: {
    holesky: {
      loggingEnabled: true,
      url: process.env.HOLESKY_RPC || "https://rpc.ankr.com/eth_holesky",
      chainId: 17_000,
      accounts: [process.env.DEPLOYER_SK || ""],
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
