import { HardhatUserConfig, vars } from 'hardhat/config';
import '@nomicfoundation/hardhat-toolbox';
import '@openzeppelin/hardhat-upgrades';
import '@nomicfoundation/hardhat-ethers';
import 'hardhat-gas-reporter';
import 'hardhat-deploy';

import './scripts';
import './tasks';

const config: HardhatUserConfig = {
  gasReporter: {
    enabled: true,
    currency: 'USD',
    L1: 'ethereum',
    coinmarketcap: vars.get('CMC_API_KEY', ''),
    excludeContracts: ['BTCBMock', 'CCIPRouterMock', 'LBTCMock', 'WBTCMock'],
    L1Etherscan: vars.get('ETHERSCAN_API_KEY', '')
  },
  solidity: {
    compilers: [
      {
        version: '0.8.24',
        settings: {
          optimizer: {
            enabled: true,
            runs: 200
          }
        }
      }
    ]
  },
  networks: {
    // testnets
    holesky: {
      loggingEnabled: true,
      url: vars.get('HOLESKY_RPC', 'https://ethereum-holesky-rpc.publicnode.com'),
      chainId: 17_000,
      accounts: [vars.get('TESTNET_DEPLOYER_SK', '0x0000000000000000000000000000000000000000000000000000000000000001')],
      gas: 8_000_000,
      gasMultiplier: 1.5,
      timeout: 180_000
    },
    sepolia: {
      loggingEnabled: true,
      url: vars.get('SEPOLIA_RPC', 'https://ethereum-sepolia-rpc.publicnode.com'),
      chainId: 11155111,
      accounts: [vars.get('TESTNET_DEPLOYER_SK', '0x0000000000000000000000000000000000000000000000000000000000000001')],
      gas: 8_000_000,
      gasMultiplier: 1.1,
      timeout: 180_000
    },
    bscTestnet: {
      loggingEnabled: true,
      url: vars.get('BSC_TESTNET_RPC', 'https://bsc-testnet-rpc.publicnode.com'),
      chainId: 97,
      accounts: [vars.get('TESTNET_DEPLOYER_SK', '0x0000000000000000000000000000000000000000000000000000000000000001')],
      timeout: 90_000
    },
    mantle_testnet: {
      loggingEnabled: true,
      url: vars.get('MANTLE_TESTNET_RPC', 'https://rpc.sepolia.mantle.xyz'),
      chainId: 5003,
      accounts: [vars.get('TESTNET_DEPLOYER_SK', '0x0000000000000000000000000000000000000000000000000000000000000001')],
      timeout: 90_000,
      gas: 8_000_000
    },
    zircuit_testnet: {
      loggingEnabled: true,
      url: vars.get('ZIRCUIT_TESTNET_RPC', 'https://zircuit1.p2pify.com/'),
      chainId: 48899,
      accounts: [vars.get('TESTNET_DEPLOYER_SK', '0x0000000000000000000000000000000000000000000000000000000000000001')],
      timeout: 90_000,
      gas: 8_000_000
    },
    linea_testnet: {
      loggingEnabled: true,
      url: vars.get('LINEA_TESTNET_RPC', 'https://rpc.sepolia.linea.build'),
      chainId: 59141,
      accounts: [vars.get('TESTNET_DEPLOYER_SK', '0x0000000000000000000000000000000000000000000000000000000000000001')],
      timeout: 90_000,
      gas: 8_000_000
    },
    scroll_testnet: {
      loggingEnabled: true,
      url: vars.get('SCROLL_TESTNET_RPC', 'https://rpc.ankr.com/scroll_sepolia_testnet'),
      chainId: 534351,
      accounts: [vars.get('TESTNET_DEPLOYER_SK', '0x0000000000000000000000000000000000000000000000000000000000000001')],
      timeout: 90_000,
      gas: 8_000_000
    },
    okx_testnet: {
      loggingEnabled: true,
      url: vars.get('OKX_TESTNET_RPC', 'https://testrpc.xlayer.tech'),
      chainId: 195,
      accounts: [vars.get('TESTNET_DEPLOYER_SK', '0x0000000000000000000000000000000000000000000000000000000000000001')],
      timeout: 90_000,
      gas: 8_000_000
    },
    baseSepolia: {
      loggingEnabled: true,
      url: vars.get('BASE_SEPOLIA_RPC', 'https://rpc.ankr.com/base_sepolia'),
      chainId: 84532,
      accounts: [vars.get('TESTNET_DEPLOYER_SK', '0x0000000000000000000000000000000000000000000000000000000000000001')],
      timeout: 90_000,
      gas: 8_000_000
    },
    arbitrumSepolia: {
      loggingEnabled: true,
      url: vars.get('ARBITRUM_SEPOLIA_RPC', 'https://rpc.ankr.com/arbitrum_sepolia'),
      chainId: 421614,
      accounts: [vars.get('TESTNET_DEPLOYER_SK', '0x0000000000000000000000000000000000000000000000000000000000000001')],
      timeout: 90_000,
      gas: 8_000_000
    },
    beraBartio: {
      loggingEnabled: true,
      url: vars.get('BERA_BARTIO_RPC', 'https://bartio.rpc.berachain.com'),
      chainId: 80084,
      accounts: [vars.get('TESTNET_DEPLOYER_SK', '0x0000000000000000000000000000000000000000000000000000000000000001')],
      timeout: 90_000,
      gas: 8_000_000
    },
    beraCartio: {
      loggingEnabled: true,
      url: vars.get('BERA_CARTIO_RPC', 'https://rockbeard-eth-cartio.berachain.com'),
      chainId: 80000,
      accounts: [vars.get('TESTNET_DEPLOYER_SK', '0x0000000000000000000000000000000000000000000000000000000000000001')],
      timeout: 90_000,
      gas: 8_000_000
    },
    cronosTestnet: {
      loggingEnabled: true,
      url: vars.get('CRONOS_TESTNET_RPC', 'https://evm-t3.cronos.org'),
      chainId: 338,
      accounts: [vars.get('TESTNET_DEPLOYER_SK', '0x0000000000000000000000000000000000000000000000000000000000000001')],
      timeout: 90_000,
      gas: 8_000_000
    },
    swellSepolia: {
      loggingEnabled: true,
      url: vars.get('SWELL_SEPOLIA_RPC', 'https://rpc.ankr.com/swell_sepolia'),
      chainId: 1924,
      accounts: [vars.get('TESTNET_DEPLOYER_SK', '0x0000000000000000000000000000000000000000000000000000000000000001')],
      timeout: 90_000,
      gas: 8_000_000
    },
    sonicTestnet: {
      loggingEnabled: true,
      url: vars.get('SONIC_TESTNET_RPC', 'https://rpc.ankr.com/sonic_blaze_testnet'),
      chainId: 57054,
      accounts: [vars.get('TESTNET_DEPLOYER_SK', '0x0000000000000000000000000000000000000000000000000000000000000001')],
      timeout: 90_000,
      gas: 8_000_000
    },
    morphHolesky: {
      loggingEnabled: true,
      url: vars.get('MORPH_HOLESKY_RPC', 'https://rpc-quicknode-holesky.morphl2.io'),
      chainId: 2810,
      accounts: [vars.get('TESTNET_DEPLOYER_SK', '0x0000000000000000000000000000000000000000000000000000000000000001')],
      timeout: 90_000,
      gas: 8_000_000
    },
    etherlinkTestnet: {
      loggingEnabled: true,
      url: vars.get('ETHERLINK_TESTNET_RPC', 'https://node.ghostnet.etherlink.com'),
      chainId: 128123,
      accounts: [vars.get('TESTNET_DEPLOYER_SK', '0x0000000000000000000000000000000000000000000000000000000000000001')],
      timeout: 90_000,
      gas: 8_000_000
    },
    inkSepolia: {
      loggingEnabled: true,
      url: vars.get('INK_SEPOLIA_RPC', 'https://rpc-gel-sepolia.inkonchain.com'),
      chainId: 763373,
      accounts: [vars.get('TESTNET_DEPLOYER_SK', '0x0000000000000000000000000000000000000000000000000000000000000001')],
      timeout: 90_000,
      gas: 8_000_000
    },
    katanaTatara: {
      loggingEnabled: true,
      url: vars.get('KATANA_TATARA_RPC', 'https://rpc.tatara.katanarpc.com'),
      chainId: 129399,
      accounts: [vars.get('TESTNET_DEPLOYER_SK', '0x0000000000000000000000000000000000000000000000000000000000000001')],
      timeout: 90_000,
      gas: 8_000_000
    },
    tacSpb: {
      loggingEnabled: true,
      url: vars.get('TAC_SPB_RPC', 'https://spb.rpc.tac.build'),
      chainId: 2391,
      accounts: [vars.get('TESTNET_DEPLOYER_SK', '0x74877698113985f5e0c10cf6b9e0f51af79435e6430e99d98b13303e6b0a996a')],
      timeout: 90_000,
      gas: 8_000_000
    },
    // mainnets
    mainnet: {
      loggingEnabled: true,
      url: vars.get('MAINNET_RPC', 'https://ethereum-rpc.publicnode.com'),
      chainId: 1,
      accounts: [vars.get('DEPLOYER_SK', '0x0000000000000000000000000000000000000000000000000000000000000001')],
      timeout: 90_000,
      gas: 8_000_000,
      gasMultiplier: 1
    },
    mantle: {
      loggingEnabled: true,
      url: vars.get('MANTLE_TESTNET_RPC', 'https://mantle.drpc.org'),
      chainId: 5000,
      accounts: [vars.get('DEPLOYER_SK', '0x0000000000000000000000000000000000000000000000000000000000000001')],
      timeout: 90_000,
      gas: 8_000_000
    },
    linea: {
      loggingEnabled: true,
      url: vars.get('LINEA_RPC', 'https://linea.decubate.com'),
      chainId: 59144,
      accounts: [vars.get('DEPLOYER_SK', '0x0000000000000000000000000000000000000000000000000000000000000001')],
      timeout: 90_000,
      gas: 8_000_000
    },
    bsc: {
      loggingEnabled: true,
      url: vars.get('BSC_RPC', 'https://bsc-rpc.publicnode.com'),
      chainId: 56,
      accounts: [vars.get('DEPLOYER_SK', '0x0000000000000000000000000000000000000000000000000000000000000001')],
      timeout: 90_000,
      gas: 8_000_000
    },
    base: {
      loggingEnabled: true,
      url: vars.get('BASE_RPC', 'https://gateway.tenderly.co/public/base'),
      chainId: 8453,
      accounts: [vars.get('DEPLOYER_SK', '0x0000000000000000000000000000000000000000000000000000000000000001')],
      timeout: 90_000,
      gas: 8_000_000
    },
    arbitrum: {
      loggingEnabled: true,
      url: vars.get('ARBITRUM_RPC', 'https://rpc.ankr.com/base'),
      chainId: 42161,
      accounts: [vars.get('DEPLOYER_SK', '0x0000000000000000000000000000000000000000000000000000000000000001')],
      timeout: 90_000,
      gas: 8_000_000
    },
    cornMaizenet: {
      loggingEnabled: true,
      url: vars.get('CORN_MAIZENET_RPC', 'https://rpc.ankr.com/corn_maizenet'),
      chainId: 21000000,
      accounts: [vars.get('DEPLOYER_SK', '0x0000000000000000000000000000000000000000000000000000000000000001')],
      timeout: 90_000,
      gas: 8_000_000,
      gasPrice: 500000
    },
    swell: {
      loggingEnabled: true,
      url: vars.get('SWELL_RPC', 'https://rpc.ankr.com/swell'),
      chainId: 1923,
      accounts: [vars.get('DEPLOYER_SK', '0x0000000000000000000000000000000000000000000000000000000000000001')],
      timeout: 90_000,
      gas: 8_000_000
    },
    berachain: {
      loggingEnabled: true,
      url: vars.get('BERACHAIN_RPC', 'https://rpc.berachain.com'),
      chainId: 80094,
      accounts: [vars.get('DEPLOYER_SK', '0x0000000000000000000000000000000000000000000000000000000000000001')],
      timeout: 90_000,
      gas: 8_000_000
    },
    sonic: {
      loggingEnabled: true,
      url: vars.get('SONIC_RPC', 'https://rpc.soniclabs.com'),
      chainId: 146,
      accounts: [vars.get('DEPLOYER_SK', '0x0000000000000000000000000000000000000000000000000000000000000001')],
      timeout: 90_000,
      gas: 8_000_000
    },
    morph: {
      loggingEnabled: true,
      url: vars.get('MORPH_RPC', 'https://rpc-quicknode.morphl2.io'),
      chainId: 2818,
      accounts: [vars.get('DEPLOYER_SK', '0x0000000000000000000000000000000000000000000000000000000000000001')],
      timeout: 90_000,
      gas: 8_000_000
    },
    etherlink: {
      loggingEnabled: true,
      url: vars.get('ETHERLINK_RPC', 'https://node.mainnet.etherlink.com'),
      chainId: 42793,
      accounts: [vars.get('DEPLOYER_SK', '0x0000000000000000000000000000000000000000000000000000000000000001')],
      timeout: 90_000,
      gas: 8_000_000
    },
    ink: {
      loggingEnabled: true,
      url: vars.get('INK_RPC', 'https://rpc-gel.inkonchain.com'),
      chainId: 57073,
      accounts: [vars.get('DEPLOYER_SK', '0x0000000000000000000000000000000000000000000000000000000000000001')],
      timeout: 90_000,
      gas: 8_000_000
    },
    katana: {
      loggingEnabled: true,
      url: vars.get('KATANA_RPC', 'https://rpc.katanarpc.com'),
      chainId: 747474,
      accounts: [vars.get('DEPLOYER_SK', '0x0000000000000000000000000000000000000000000000000000000000000001')],
      timeout: 90_000,
      gas: 8_000_000
    },
    tac: {
      loggingEnabled: true,
      url: vars.get('TAC_RPC', 'https://rpc.ankr.com/tac'),
      chainId: 239,
      accounts: [vars.get('DEPLOYER_SK', '0x0000000000000000000000000000000000000000000000000000000000000001')],
      timeout: 90_000,
      gas: 8_000_000
    }
  },
  etherscan: {
    customChains: [
      // testnets
      {
        network: 'scroll_testnet',
        chainId: 534351,
        urls: {
          apiURL: 'https://api-sepolia.scrollscan.com/api',
          browserURL: 'https://sepolia.scrollscan.com/address'
        }
      },
      {
        network: 'linea_testnet',
        chainId: 59141,
        urls: {
          apiURL: 'https://api-sepolia.lineascan.build/api',
          browserURL: 'https://sepolia.lineascan.build/address'
        }
      },
      {
        network: 'zircuit_testnet',
        chainId: 48899,
        urls: {
          apiURL: 'https://explorer.zircuit.com/api/contractVerifyHardhat',
          browserURL: 'https://explorer.zircuit.com'
        }
      },
      {
        network: 'mantle_testnet',
        chainId: 5003,
        urls: {
          apiURL: 'https://api-sepolia.mantlescan.xyz/api',
          browserURL: 'https://sepolia.mantlescan.xyz/'
        }
      },
      {
        network: 'okx_testnet',
        chainId: 195,
        urls: {
          apiURL: 'https://www.oklink.com/api/v5/explorer/contract/verify-source-code-plugin/XLAYER_TESTNET', //or https://www.oklink.com/api/v5/explorer/contract/verify-source-code-plugin/XLAYER for mainnet
          browserURL: 'https://www.oklink.com/xlayer-test' //or https://www.oklink.com/xlayer for mainnet
        }
      },
      {
        network: 'beraBartio',
        chainId: 80084,
        urls: {
          apiURL: 'https://api.routescan.io/v2/network/testnet/evm/80084/etherscan',
          browserURL: 'https://bartio.beratrail.io/'
        }
      },
      {
        network: 'beraCartio',
        chainId: 80000,
        urls: {
          apiURL: 'https://api.routescan.io/v2/network/testnet/evm/80000/etherscan',
          browserURL: 'https://80000.testnet.routescan.io/'
        }
      },
      {
        network: 'swell_testnet',
        chainId: 1924,
        urls: {
          apiURL: 'https://swell-testnet-explorer.alt.technology/api/',
          browserURL: 'https://swell-testnet-explorer.alt.technology'
        }
      },
      {
        network: 'sonicTestnet',
        chainId: 57054,
        urls: {
          apiURL: 'https://api-testnet.sonicscan.org/api',
          browserURL: 'https://testnet.sonicscan.org'
        }
      },
      {
        network: 'morphHolesky',
        chainId: 2810,
        urls: {
          apiURL: 'https://explorer-api-holesky.morphl2.io/api/v2/',
          browserURL: 'https://explorer-holesky.morphl2.io/'
        }
      },
      {
        network: 'etherlinkTestnet',
        chainId: 128123,
        urls: {
          apiURL: 'https://testnet.explorer.etherlink.com/api',
          browserURL: 'https://testnet.explorer.etherlink.com'
        }
      },
      {
        network: 'inkSepolia',
        chainId: 763373,
        urls: {
          apiURL: 'https://api.routescan.io/v2/network/testnet/evm/763373/etherscan',
          browserURL: 'https://sepolia.inkonscan.xyz/'
        }
      },
      {
        network: 'katanaTatara',
        chainId: 129399,
        urls: {
          apiURL: 'https://explorer-tatara-s4atxtv7sq.t.conduit.xyz/api',
          browserURL: 'https://explorer-tatara-s4atxtv7sq.t.conduit.xyz:443'
        }
      },
      {
        network: 'tacSpb',
        chainId: 2391,
        urls: {
          apiURL: 'https://spb.explorer.tac.build/api',
          browserURL: 'https://spb.explorer.tac.build/'
        }
      },
      // mainnets
      {
        network: 'mantle',
        chainId: 5000,
        urls: {
          apiURL: 'https://api.mantlescan.xyz/api',
          browserURL: 'https://mantlescan.xyz/'
        }
      },
      {
        network: 'linea',
        chainId: 59144,
        urls: {
          apiURL: 'https://api.lineascan.build/api',
          browserURL: 'https://lineascan.build/'
        }
      },
      {
        network: 'scroll',
        chainId: 534352,
        urls: {
          apiURL: 'https://api.scrollscan.com/api',
          browserURL: 'https://scrollscan.com/address'
        }
      },
      {
        network: 'cornMaizenet',
        chainId: 21000000,
        urls: {
          apiURL: 'https://api.routescan.io/v2/network/mainnet/evm/21000000/etherscan',
          browserURL: 'https://cornscan.io/'
        }
      },
      {
        network: 'swell',
        chainId: 1923,
        urls: {
          apiURL: 'https://explorer.swellnetwork.io/api/',
          browserURL: 'https://explorer.swellnetwork.io/'
        }
      },
      {
        network: 'berachain',
        chainId: 80094,
        urls: {
          apiURL: 'https://api.berascan.com/api',
          browserURL: 'https://berascan.com'
        }
      },
      {
        network: 'sonic',
        chainId: 146,
        urls: {
          apiURL: 'https://api.sonicscan.org/api',
          browserURL: 'https://sonicscan.org'
        }
      },
      {
        network: 'morph',
        chainId: 2818,
        urls: {
          apiURL: 'https://morphscan.org/api/v2/network/mainnet/evm/2818/etherscan',
          browserURL: 'https://morphscan.org'
        }
      },
      {
        network: 'etherlink',
        chainId: 42793,
        urls: {
          apiURL: 'https://explorer.etherlink.com/api',
          browserURL: 'https://explorer.etherlink.com'
        }
      },
      {
        network: 'ink',
        chainId: 57073,
        urls: {
          apiURL: 'https://api.routescan.io/v2/network/mainnet/evm/57073/etherscan',
          browserURL: 'https://57073.routescan.io/'
        }
      },
      {
        network: 'katana',
        chainId: 747474,
        urls: {
          apiURL: 'https://explorer.katanarpc.com/api',
          browserURL: 'https://explorer.katanarpc.com'
        }
      },
      {
        network: 'tac',
        chainId: 239,
        urls: {
          apiURL: 'https://explorer.tac.build/api',
          browserURL: 'https://explorer.tac.build/'
        }
      }
    ],
    apiKey: {
      // testnets
      holesky: vars.get('ETHERSCAN_API_KEY', ''),
      sepolia: vars.get('ETHERSCAN_API_KEY', ''),
      bscTestnet: vars.get('BSCSCAN_API_KEY', ''),
      scroll_testnet: vars.get('SCROLLSCAN_API_KEY', ''),
      zircuit_testnet: vars.get('ZIRCUIT_API_KEY', ''),
      mantle_testnet: vars.get('MANTLE_API_KEY', ''),
      linea_testnet: vars.get('LINEA_API_KEY', ''),
      okx_testnet: vars.get('OKX_API_KEY', ''),
      baseSepolia: vars.get('BASE_API_KEY', ''),
      arbitrumSepolia: vars.get('ARBITRUM_API_KEY', ''),
      beraBartio: 'no',
      beraCartio: 'no',
      swell_testnet: 'no',
      sonicTestnet: vars.get('SONICSCAN_API_KEY', ''),
      etherlinkTestnet: 'no',
      inkSepolia: 'no',
      katanaTatara: 'no',
      tacSpb: 'no',
      // mainnets
      mainnet: vars.get('ETHERSCAN_API_KEY', ''),
      bsc: vars.get('BSCSCAN_API_KEY', ''),
      scroll: vars.get('SCROLLSCAN_API_KEY', ''),
      zircuit: vars.get('ZIRCUIT_API_KEY', ''),
      linea: vars.get('LINEA_API_KEY', ''),
      mantle: vars.get('MANTLE_API_KEY', ''),
      base: vars.get('BASE_API_KEY', ''),
      arbitrum: vars.get('ARBITRUM_API_KEY', ''),
      cornMaizenet: 'no',
      swell: 'no',
      berachain: vars.get('BERACHAIN_API_KEY', ''),
      sonic: vars.get('SONIC_API_KEY', ''),
      morph: 'no',
      etherlink: 'no',
      ink: 'no',
      katana: 'no',
      tac: 'no'
    }
  },
  sourcify: {
    enabled: false
  }
};

export default config;
