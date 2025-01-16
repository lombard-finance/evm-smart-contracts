import { AddressList } from './types';

export class AdminBucket {
    private readonly multisig: string;
    private readonly timelock: string;
    private readonly deployers: string[];

    constructor(addressList: AddressList) {
        if (!addressList) {
            throw new Error(`no admins found}`);
        }
        this.multisig = addressList['Owner'];
        this.timelock = addressList['TimeLock'];
        this.deployers = addressList['Deployer'].map((v: string) =>
            v.toLowerCase()
        );
    }

    isTimelock(addr: string) {
        return this.timelock.toLowerCase() === addr.toLowerCase();
    }

    isMultisig(addr: string) {
        return this.multisig.toLowerCase() === addr.toLowerCase();
    }

    isDeployer(addr: string) {
        return this.deployers.includes(addr.toLowerCase());
    }
}
