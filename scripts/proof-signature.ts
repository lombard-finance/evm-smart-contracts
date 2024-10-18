async function main() {
    let data = Buffer.from(
        'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQmgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAcDKu2IRFNQvMkl2Bpvc2XRqrZYz2jMCf3ehoRIBvh5CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAa4ARn8g1xRXAT4Tc6rAaoQWdKRX99ikJ6PFYsYm/5ooVEoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAhmtrv1ibthnYntbekTdJrNwFSoGTXboi+O+eFQOTqFGkAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==',
        'base64'
    );
    const proofSignature = Buffer.from(
        'PaJQCQJEeqwCYF66JXNv5B3x6PN5E35iL1UZcCuyLNx0v10Zm97un5sFbxGSDbvEaM4NljNYAZXaCXWEk6WkzgA=',
        'base64'
    );
    proofSignature[proofSignature.length - 1] += 27;

    console.log(proofSignature.toString('hex'));
    console.log('=====');
    console.log('data', data.toString('hex'));
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
