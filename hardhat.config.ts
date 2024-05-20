import { HardhatUserConfig, vars } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@openzeppelin/hardhat-upgrades";

const config: HardhatUserConfig = {
  solidity: "0.8.24",
  networks: {
    holesky: {
      loggingEnabled: true,
      url: vars.get("HOLESKY_RPC", "https://rpc.ankr.com/eth_holesky"),
      chainId: 17_000,
      accounts: [
        vars.get(
          "TESTNET_DEPLOYER_SK",
          "0x0000000000000000000000000000000000000000000000000000000000000001"
        ),
      ],
      timeout: 90_000,
      gas: 8_000_000,
      gasMultiplier: 1.5,
    },
    mainnet: {
      loggingEnabled: true,
      url: vars.get("MAINNET_RPC", "https://rpc.ankr.com/eth"),
      chainId: 1,
      accounts: [
        vars.get(
          "DEPLOYER_SK",
          "0x0000000000000000000000000000000000000000000000000000000000000001"
        ),
      ],
      timeout: 90_000,
      gas: 8_000_000,
      gasMultiplier: 1,
    },
  },
  etherscan: {
    apiKey: {
      holesky: vars.get(
        "ETHERSCAN_API_KEY",
        "PP5CDPZBG6AF6FBGE9CJNYGCRYXYN549M1"
      ),
      mainnet: vars.get(
        "ETHERSCAN_API_KEY",
        "PP5CDPZBG6AF6FBGE9CJNYGCRYXYN549M1"
      ),
    },
  },
};

export default config;
