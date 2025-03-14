import { buildModule } from '@nomicfoundation/hardhat-ignition/modules';

const consortiumAddress = '0x1820b9218cb2D9a3790EDe3b5F20851BEc8971B0';

const LBTCModule = buildModule('LBTCModule', m => {
  const lbtc = m.contract('LBTC', [], {});
  m.call(lbtc, 'initialize');
  return { lbtc };
});

export default LBTCModule;
