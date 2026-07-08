import { BaseContract, ContractFactory } from 'ethers';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { deployLibrary } from './libraryDeployment';

export type LinkedLibraries = Record<string, string>;

export function parseLibrariesArg(libraries?: string): LinkedLibraries {
  if (!libraries?.trim()) {
    return {};
  }

  const parsed: LinkedLibraries = {};
  for (const entry of libraries.split(',')) {
    const trimmed = entry.trim();
    if (!trimmed) {
      continue;
    }

    const separator = trimmed.includes(':') ? ':' : trimmed.includes('=') ? '=' : null;
    if (!separator) {
      throw new Error(`Invalid library spec "${trimmed}". Expected LibraryName:address`);
    }

    const [name, address] = trimmed.split(separator);
    if (!name || !address) {
      throw new Error(`Invalid library spec "${trimmed}". Expected LibraryName:address`);
    }

    parsed[name.trim()] = address.trim();
  }

  return parsed;
}

export function getRequiredLibraryNames(hre: HardhatRuntimeEnvironment, contractName: string): string[] {
  const { linkReferences = {} } = hre.artifacts.readArtifactSync(contractName);
  const names: string[] = [];

  for (const fileReferences of Object.values(linkReferences)) {
    for (const libraryName of Object.keys(fileReferences)) {
      names.push(libraryName);
    }
  }

  return names;
}

async function resolveLibraries(
  hre: HardhatRuntimeEnvironment,
  contractName: string,
  libraries: LinkedLibraries,
  requireLibraryAddresses: boolean
): Promise<LinkedLibraries> {
  const required = getRequiredLibraryNames(hre, contractName);
  if (!required.length) {
    return {};
  }

  const resolved = { ...libraries };
  for (const libraryName of required) {
    if (resolved[libraryName]) {
      continue;
    }
    if (requireLibraryAddresses) {
      throw new Error(
        `Missing linked library "${libraryName}" for ${contractName}. ` +
          `Deploy it with: yarn hardhat deploy-library ${libraryName} --network <network>`
      );
    }
    resolved[libraryName] = await deployLibrary(hre, libraryName);
  }

  return Object.fromEntries(required.map(name => [name, resolved[name]]));
}

export async function getContractFactoryWithLibraries(
  hre: HardhatRuntimeEnvironment,
  contractName: string,
  libraries: LinkedLibraries = {},
  requireLibraryAddresses = false
): Promise<{ factory: ContractFactory; libraries: LinkedLibraries }> {
  const linkedLibraries = await resolveLibraries(hre, contractName, libraries, requireLibraryAddresses);
  if (!Object.keys(linkedLibraries).length) {
    return { factory: await hre.ethers.getContractFactory(contractName), libraries: {} };
  }

  return {
    factory: await hre.ethers.getContractFactory(contractName, { libraries: linkedLibraries }),
    libraries: linkedLibraries
  };
}

export async function deployLinkedImplementation<T extends BaseContract = BaseContract>(
  hre: HardhatRuntimeEnvironment,
  contractName: string,
  libraries: LinkedLibraries = {}
): Promise<{ impl: T; libraries: LinkedLibraries }> {
  const { factory, libraries: linkedLibraries } = await getContractFactoryWithLibraries(
    hre,
    contractName,
    libraries,
    true
  );
  const impl = await factory.deploy();
  await impl.waitForDeployment();
  return { impl: impl as T, libraries: linkedLibraries };
}

export function implementationVerifyOptions(
  hre: HardhatRuntimeEnvironment,
  contractName: string,
  libraries: LinkedLibraries = {}
) {
  if (!Object.keys(libraries).length) {
    return {};
  }

  const { sourceName } = hre.artifacts.readArtifactSync(contractName);
  return {
    contract: `${sourceName}:${contractName}`,
    libraries
  };
}
