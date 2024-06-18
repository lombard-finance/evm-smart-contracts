import { HardhatUserConfig, vars } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@openzeppelin/hardhat-upgrades";

const config: HardhatUserConfig = {
  solidity: "0.8.24",
  networks: {
    // testnets
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
    bsc_testnet: {
      loggingEnabled: true,
      url: vars.get(
        "BSC_TESTNET_RPC",
        "https://rpc.ankr.com/bsc_testnet_chapel"
      ),
      chainId: 97,
      accounts: [
        vars.get(
          "TESTNET_DEPLOYER_SK",
          "0x0000000000000000000000000000000000000000000000000000000000000001"
        ),
      ],
      timeout: 90_000,
      gas: 8_000_000,
    },

    // mainnets
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
    bsc: {
      loggingEnabled: true,
      url: vars.get("MAINNET_RPC", "https://rpc.ankr.com/bsc"),
      chainId: 56,
      accounts: [
        vars.get(
          "DEPLOYER_SK",
          "0x0000000000000000000000000000000000000000000000000000000000000001"
        ),
      ],
      timeout: 90_000,
      gas: 8_000_000,
    },
  },
  etherscan: {
    apiKey: {
      // testnets
      holesky: vars.get(
        "ETHERSCAN_API_KEY",
        "PP5CDPZBG6AF6FBGE9CJNYGCRYXYN549M1"
      ),
      bsc_testnet: vars.get(
        "BSCSCAN_API_KEY",
        "UI7BPX1FHRXIUBSW95UPW6MYIPKM696HV6"
      ),

      // mainnets
      mainnet: vars.get(
        "ETHERSCAN_API_KEY",
        "PP5CDPZBG6AF6FBGE9CJNYGCRYXYN549M1"
      ),
      bsc: vars.get("BSCSCAN_API_KEY", "UI7BPX1FHRXIUBSW95UPW6MYIPKM696HV6"),
    },
  },
  sourcify: {
    enabled: false,
  },
};

export default config;
