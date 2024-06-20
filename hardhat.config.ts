import { HardhatUserConfig, vars } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@openzeppelin/hardhat-upgrades";
import "@nomicfoundation/hardhat-ethers";

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      {
        version: "0.8.24",
      },
      {
        version: "0.8.19",
      },
    ],
  },
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
      gas: 8_000_000,
      gasMultiplier: 1.5,
      timeout: 90_000,
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
    },
    mantle_testnet: {
      loggingEnabled: true,
      url: vars.get(
        "MANTLE_TESTNET_RPC",
        "https://rpc.sepolia.mantle.xyz"
      ),
      chainId: 5003,
      accounts: [
        vars.get(
          "TESTNET_DEPLOYER_SK",
          "0x0000000000000000000000000000000000000000000000000000000000000001"
        ),
      ],
      timeout: 90_000,
      gas: 8_000_000,
    },
    zircuit_testnet: {
      loggingEnabled: true,
      url: vars.get(
        "ZIRCUIT_TESTNET_RPC",
        "https://zircuit1.p2pify.com/"
      ),
      chainId: 48899,
      accounts: [
        vars.get(
          "TESTNET_DEPLOYER_SK",
          "0x0000000000000000000000000000000000000000000000000000000000000001"
        ),
      ],
      timeout: 90_000,
      gas: 8_000_000,
    },
    linea_testnet: {
      loggingEnabled: true,
      url: vars.get(
        "LINEA_TESTNET_RPC",
        "https://rpc.sepolia.linea.build"
      ),
      chainId: 59141,
      accounts: [
        vars.get(
          "TESTNET_DEPLOYER_SK",
          "0x0000000000000000000000000000000000000000000000000000000000000001"
        ),
      ],
      timeout: 90_000,
      gas: 8_000_000,
    },
    scroll_testnet: {
      loggingEnabled: true,
      url: vars.get(
        "SCROLL_TESTNET_RPC",
        "https://rpc.ankr.com/scroll_sepolia_testnet"
      ),
      chainId: 534351,
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
    mantle: {
      loggingEnabled: true,
      url: vars.get(
          "MANTLE_TESTNET_RPC",
          "https://mantle.drpc.org"
      ),
      chainId: 5000,
      accounts: [
        vars.get(
            "TESTNET_DEPLOYER_SK",
            "0x0000000000000000000000000000000000000000000000000000000000000001"
        ),
      ],
      timeout: 90_000,
      gas: 8_000_000,
    },
    linea: {
      loggingEnabled: true,
      url: vars.get(
          "LINEA_RPC",
          "https://linea.decubate.com"
      ),
      chainId: 59144,
      accounts: [
        vars.get(
            "TESTNET_DEPLOYER_SK",
            "0x0000000000000000000000000000000000000000000000000000000000000001"
        ),
      ],
      timeout: 90_000,
      gas: 8_000_000,
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
    customChains: [
      // testnets
      {
        network: "scroll_testnet",
        chainId: 534351,
        urls: {
          apiURL: "https://api-sepolia.scrollscan.com/api",
          browserURL: "https://sepolia.scrollscan.com/address",
        },
      },
      {
        network: "linea_testnet",
        chainId: 59141,
        urls: {
          apiURL: "https://api-sepolia.lineascan.build/api",
          browserURL: "https://sepolia.lineascan.build/address"
        }
      },
      {
        network: 'zircuit_testnet',
        chainId: 48899,
        urls: {
          apiURL: 'https://explorer.zircuit.com/api/contractVerifyHardhat',
          browserURL: 'https://explorer.zircuit.com',
        },
      },
      {
        network: 'mantle_testnet',
        chainId: 5003,
        urls: {
          apiURL: "https://api-sepolia.mantlescan.xyz/api",
          browserURL: "https://sepolia.mantlescan.xyz/"
        },
      },
      // mainnets
      {
        network: 'mantle',
        chainId: 5000,
        urls: {
          apiURL: "https://api.mantlescan.xyz/api",
          browserURL: "https://mantlescan.xyz/"
        },
      },
      {
        network: 'linea',
        chainId: 59144,
        urls: {
          apiURL: "https://api.lineascan.build/api",
          browserURL: "https://sepolia.lineascan.build/"
        },
      },
      {
        network: "scroll",
        chainId: 534352,
        urls: {
          apiURL: "https://api.scrollscan.com/api",
          browserURL: "https://scrollscan.com/address",
        },
      },
    ],
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
      scroll_testnet: vars.get(
        "SCROLLSCAN_API_KEY",
        "2CU7WCW6WCWKG5I7Y12PYYB921ETWH3PZP"
      ),
      zircuit_testnet: vars.get(
        "ZIRCUIT_API_KEY",
        "006A14771D1AF73D736D10F008030F9079"
      ),

      mantle_testnet: vars.get(
        "MANTLE_API_KEY",
        "GR8NHBNI8GJFNNA221QDU87TYVCSDMZEJX"
      ),
      linea_testnet: vars.get(
        "LINEA_API_KEY",
        "HTRRV2ZFFSR8RAPMNXJMWEV131ABPUH19A"
      ),
      // mainnets
      mainnet: vars.get(
        "ETHERSCAN_API_KEY",
        "PP5CDPZBG6AF6FBGE9CJNYGCRYXYN549M1"
      ),
      bsc: vars.get("BSCSCAN_API_KEY", "UI7BPX1FHRXIUBSW95UPW6MYIPKM696HV6"),
      scroll: vars.get(
        "SCROLLSCAN_API_KEY",
        "2CU7WCW6WCWKG5I7Y12PYYB921ETWH3PZP"
      ),
      zircuit: vars.get(
          "ZIRCUIT_API_KEY",
          "006A14771D1AF73D736D10F008030F9079"
      ),
      linea: vars.get(
          "LINEA_API_KEY",
          "HTRRV2ZFFSR8RAPMNXJMWEV131ABPUH19A"
      ),
      mantle: vars.get(
          "MANTLE_API_KEY",
          "GR8NHBNI8GJFNNA221QDU87TYVCSDMZEJX"
      ),
    },
  },
  sourcify: {
    enabled: false,
  },
};

export default config;
