import { ethers } from 'hardhat';

async function main() {
    const lbtc = await ethers.getContractAt(
        'LBTC',
        '0xD27cdA6E1eD6C807280670Ea0E06D1342f778B3E'
    );

    let data = Buffer.from(
        'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQmgAAAAAAAAAAAAAAADnWqHbC2ruhb+FLX1GIMQEDI2q0AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPowSHQTQoeIaaktL6/SBHHq4CunZtpedjPPVtVlYG/NOIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQ==',
        'base64'
    );

    const proofSignature = Buffer.from(
        'z77KwYlTn9NKtrrESYmUxxjdsDUTyocWQ7HLCAHOpBsTVq8RuZUA37hgaRlsoDx3v9SNHmfqwOiCKPlx5W3regA=',
        'base64'
    );
    proofSignature[proofSignature.length - 1] += 27;

    const tx = await lbtc.mint(
        `0x${data.toString('hex')}`,
        `0x${proofSignature.toString('hex')}`
    );
    console.log(tx);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
