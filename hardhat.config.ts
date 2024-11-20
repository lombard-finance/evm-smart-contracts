import { HardhatUserConfig, vars } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@openzeppelin/hardhat-upgrades";
import "@nomicfoundation/hardhat-ethers";

import "./scripts";

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      {
        version: "0.8.24",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
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
          "0x0000000000000000000000000000000000000000000000000000000000000001",
        ),
      ],
      gas: 8_000_000,
      gasMultiplier: 1.5,
      timeout: 180_000,
    },
    bscTestnet: {
      loggingEnabled: true,
      url: vars.get(
        "BSC_TESTNET_RPC",
        "https://bsc-testnet-rpc.publicnode.com",
      ),
      chainId: 97,
      accounts: [
        vars.get(
          "TESTNET_DEPLOYER_SK",
          "0x0000000000000000000000000000000000000000000000000000000000000001",
        ),
      ],
      timeout: 90_000,
    },
    mantle_testnet: {
      loggingEnabled: true,
      url: vars.get("MANTLE_TESTNET_RPC", "https://rpc.sepolia.mantle.xyz"),
      chainId: 5003,
      accounts: [
        vars.get(
          "TESTNET_DEPLOYER_SK",
          "0x0000000000000000000000000000000000000000000000000000000000000001",
        ),
      ],
      timeout: 90_000,
      gas: 8_000_000,
    },
    zircuit_testnet: {
      loggingEnabled: true,
      url: vars.get("ZIRCUIT_TESTNET_RPC", "https://zircuit1.p2pify.com/"),
      chainId: 48899,
      accounts: [
        vars.get(
          "TESTNET_DEPLOYER_SK",
          "0x0000000000000000000000000000000000000000000000000000000000000001",
        ),
      ],
      timeout: 90_000,
      gas: 8_000_000,
    },
    linea_testnet: {
      loggingEnabled: true,
      url: vars.get("LINEA_TESTNET_RPC", "https://rpc.sepolia.linea.build"),
      chainId: 59141,
      accounts: [
        vars.get(
          "TESTNET_DEPLOYER_SK",
          "0x0000000000000000000000000000000000000000000000000000000000000001",
        ),
      ],
      timeout: 90_000,
      gas: 8_000_000,
    },
    scroll_testnet: {
      loggingEnabled: true,
      url: vars.get(
        "SCROLL_TESTNET_RPC",
        "https://rpc.ankr.com/scroll_sepolia_testnet",
      ),
      chainId: 534351,
      accounts: [
        vars.get(
          "TESTNET_DEPLOYER_SK",
          "0x0000000000000000000000000000000000000000000000000000000000000001",
        ),
      ],
      timeout: 90_000,
      gas: 8_000_000,
    },
    okx_testnet: {
      loggingEnabled: true,
      url: vars.get("OKX_TESTNET_RPC", "https://testrpc.xlayer.tech"),
      chainId: 195,
      accounts: [
        vars.get(
          "TESTNET_DEPLOYER_SK",
          "0x0000000000000000000000000000000000000000000000000000000000000001",
        ),
      ],
      timeout: 90_000,
      gas: 8_000_000,
    },
    baseSepolia: {
      loggingEnabled: true,
      url: vars.get("BASE_SEPOLIA_RPC", "https://rpc.ankr.com/base_sepolia"),
      chainId: 84532,
      accounts: [
        vars.get(
          "TESTNET_DEPLOYER_SK",
          "0x0000000000000000000000000000000000000000000000000000000000000001",
        ),
      ],
      timeout: 90_000,
      gas: 8_000_000,
    },
    arbitrumSepolia: {
      loggingEnabled: true,
      url: vars.get(
        "ARBITRUM_SEPOLIA_RPC",
        "https://rpc.ankr.com/arbitrum_sepolia",
      ),
      chainId: 421614,
      accounts: [
        vars.get(
          "TESTNET_DEPLOYER_SK",
          "0x0000000000000000000000000000000000000000000000000000000000000001",
        ),
      ],
      timeout: 90_000,
      gas: 8_000_000,
    },
    beraBartio: {
      loggingEnabled: true,
      url: vars.get("BERA_BARTIO_RPC", "https://bartio.rpc.berachain.com"),
      chainId: 80084,
      accounts: [
        vars.get(
          "TESTNET_DEPLOYER_SK",
          "0x0000000000000000000000000000000000000000000000000000000000000001",
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
          "0x0000000000000000000000000000000000000000000000000000000000000001",
        ),
      ],
      timeout: 90_000,
      gas: 8_000_000,
      gasMultiplier: 1,
    },
    mantle: {
      loggingEnabled: true,
      url: vars.get("MANTLE_TESTNET_RPC", "https://mantle.drpc.org"),
      chainId: 5000,
      accounts: [
        vars.get(
          "TESTNET_DEPLOYER_SK",
          "0x0000000000000000000000000000000000000000000000000000000000000001",
        ),
      ],
      timeout: 90_000,
      gas: 8_000_000,
    },
    linea: {
      loggingEnabled: true,
      url: vars.get("LINEA_RPC", "https://linea.decubate.com"),
      chainId: 59144,
      accounts: [
        vars.get(
          "TESTNET_DEPLOYER_SK",
          "0x0000000000000000000000000000000000000000000000000000000000000001",
        ),
      ],
      timeout: 90_000,
      gas: 8_000_000,
    },
    bsc: {
      loggingEnabled: true,
      url: vars.get("MAINNET_RPC", "https://bsc-rpc.publicnode.com"),
      chainId: 56,
      accounts: [
        vars.get(
          "DEPLOYER_SK",
          "0x0000000000000000000000000000000000000000000000000000000000000001",
        ),
      ],
      timeout: 90_000,
      gas: 8_000_000,
    },
    base: {
      loggingEnabled: true,
      url: vars.get("BASE_RPC", "https://rpc.ankr.com/base"),
      chainId: 8453,
      accounts: [
        vars.get(
          "DEPLOYER_SK",
          "0x0000000000000000000000000000000000000000000000000000000000000001",
        ),
      ],
      timeout: 90_000,
      gas: 8_000_000,
    },
    arbitrum: {
      loggingEnabled: true,
      url: vars.get("ARBITRUM_RPC", "https://rpc.ankr.com/base"),
      chainId: 42161,
      accounts: [
        vars.get(
          "DEPLOYER_SK",
          "0x0000000000000000000000000000000000000000000000000000000000000001",
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
          browserURL: "https://sepolia.lineascan.build/address",
        },
      },
      {
        network: "zircuit_testnet",
        chainId: 48899,
        urls: {
          apiURL: "https://explorer.zircuit.com/api/contractVerifyHardhat",
          browserURL: "https://explorer.zircuit.com",
        },
      },
      {
        network: "mantle_testnet",
        chainId: 5003,
        urls: {
          apiURL: "https://api-sepolia.mantlescan.xyz/api",
          browserURL: "https://sepolia.mantlescan.xyz/",
        },
      },
      {
        network: "okx_testnet",
        chainId: 195,
        urls: {
          apiURL:
            "https://www.oklink.com/api/v5/explorer/contract/verify-source-code-plugin/XLAYER_TESTNET", //or https://www.oklink.com/api/v5/explorer/contract/verify-source-code-plugin/XLAYER for mainnet
          browserURL: "https://www.oklink.com/xlayer-test", //or https://www.oklink.com/xlayer for mainnet
        },
      },
      {
        network: "beraBartio",
        chainId: 80084,
        urls: {
          apiURL:
            "https://api.routescan.io/v2/network/testnet/evm/80084/etherscan",
          browserURL: "https://lineascan.build/",
        },
      },
      // mainnets
      {
        network: "mantle",
        chainId: 5000,
        urls: {
          apiURL: "https://api.mantlescan.xyz/api",
          browserURL: "https://mantlescan.xyz/",
        },
      },
      {
        network: "linea",
        chainId: 59144,
        urls: {
          apiURL: "https://api.lineascan.build/api",
          browserURL: "https://lineascan.build/",
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
        "PP5CDPZBG6AF6FBGE9CJNYGCRYXYN549M1",
      ),
      bscTestnet: vars.get(
        "BSCSCAN_API_KEY",
        "UI7BPX1FHRXIUBSW95UPW6MYIPKM696HV6",
      ),
      scroll_testnet: vars.get(
        "SCROLLSCAN_API_KEY",
        "2CU7WCW6WCWKG5I7Y12PYYB921ETWH3PZP",
      ),
      zircuit_testnet: vars.get(
        "ZIRCUIT_API_KEY",
        "006A14771D1AF73D736D10F008030F9079",
      ),

      mantle_testnet: vars.get(
        "MANTLE_API_KEY",
        "GR8NHBNI8GJFNNA221QDU87TYVCSDMZEJX",
      ),
      linea_testnet: vars.get(
        "LINEA_API_KEY",
        "HTRRV2ZFFSR8RAPMNXJMWEV131ABPUH19A",
      ),
      okx_testnet: vars.get(
        "OKX_API_KEY",
        "f2245a5a-1f4c-47fa-b006-31d98eefc7a4",
      ),
      base: vars.get("BASE_API_KEY", ""),
      arbitrum: vars.get("ARBITRUM_API_KEY", ""),
      beraBartio: "no",
      // mainnets
      mainnet: vars.get(
        "ETHERSCAN_API_KEY",
        "PP5CDPZBG6AF6FBGE9CJNYGCRYXYN549M1",
      ),
      bsc: vars.get("BSCSCAN_API_KEY", "UI7BPX1FHRXIUBSW95UPW6MYIPKM696HV6"),
      scroll: vars.get(
        "SCROLLSCAN_API_KEY",
        "2CU7WCW6WCWKG5I7Y12PYYB921ETWH3PZP",
      ),
      zircuit: vars.get(
        "ZIRCUIT_API_KEY",
        "006A14771D1AF73D736D10F008030F9079",
      ),
      linea: vars.get("LINEA_API_KEY", "HTRRV2ZFFSR8RAPMNXJMWEV131ABPUH19A"),
      mantle: vars.get("MANTLE_API_KEY", "GR8NHBNI8GJFNNA221QDU87TYVCSDMZEJX"),
      baseSepolia: vars.get("BASE_API_KEY", ""),
      arbitrumSepolia: vars.get("ARBITRUM_API_KEY", ""),
    },
  },
  sourcify: {
    enabled: false,
  },
};

export default config;
