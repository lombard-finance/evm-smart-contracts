import { ContractMethodArgs, StateMutability, TypedContractMethod } from '../../typechain-types/common';

export async function populateTx<A extends Array<any> = Array<any>, R = any, S extends StateMutability = 'payable'>(
  contractMethod: TypedContractMethod<A, R, S>,
  args: ContractMethodArgs<A, S>
) {
  const txData = await contractMethod.populateTransaction(...args);
  console.log(`${contractMethod.name}: ${JSON.stringify(txData, null, 2)}`);
}
