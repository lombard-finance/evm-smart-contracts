import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@openzeppelin/hardhat-upgrades";

const config: HardhatUserConfig = {
  solidity: "0.8.24",
  networks: {
    holesky: {
      loggingEnabled: true,
      url: "https://rpc.ankr.com/eth_holesky/6e02f60591b5500824114c276484ebe66635f6530640f783a785fef89458804f",
      chainId: 17_000,
      accounts: [
        "77f0ea910db71438400c072581e7e29c579107725f0f97ae07c56aaecac39ea5",
      ],
      timeout: 90_000,
      gas: 8_000_000,
      gasMultiplier: 1.5,
    },
  },
  etherscan: {
    apiKey: {
      holesky: "PP5CDPZBG6AF6FBGE9CJNYGCRYXYN549M1",
    },
  },
};

export default config;
