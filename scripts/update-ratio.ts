import { task } from 'hardhat/config';

const ratioPayload: string =
  'bHIsLF/+Pj0nfQ/movE+1Gg14c51sxFs6JfPC001G5dLUxJoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADeBGIAUcjykAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAaIjZSw==';
const signatures = [
  'MEUCIQDPX+jQzu6C4apqbmgp6MsTiCSqMk7wD/uJsEU/A5D20AIgMj0tSstlpA3oiWssQPbBgCiG5dbufJBJ4OylnKJY+ss=',
  'MEQCIBs8SqMpmdFkyKUXFRBwgjL4s8ya93dwlmj7pyOaQ1O0AiB4Ly79CQ8Wmq8KiKsjlQSNQntML4++N9mHeno9ItzAlA==',
  '',
  'MEUCIQDNpum8IkR8GLjRJRYSzisotFIq8U5FdTUI0Egq72JsYAIgKCUBLSsDWHao02EGvY+iSRxs+PnPuPAhyA6gE43MYvI=',
  'MEQCICh2x9POHxht8IfMVZZVBW0qLqO9VIODabn+OwUoQjosAiA81MbCD8jWN50WPPIv+xmWGNNT/90+6hRKitfP4pYNFw==',
  '',
  'MEQCIAHW+WQMA4T8zfiU8bwT+0fMKWbAV33oiDXvr4cIJW8WAiBAYlcZmBSJh8yAqqF9mPi2f0yDygZVEDZua+i7BZkMbA==',
  'MEUCIQC1FQ3N1htj8W4TJTJvu19lU8tMdXh3QW28DPK/ffK9KAIgPm4jnJKZeWdbp9w5LKTT4kXnJbd21X/QoKPgwwDWTvg=',
  'MEQCIBqg7d1gbFFEJgUbGBywTM3Sodu9MLPFcyVUa5zLdvPoAiAsJtmBezlV3Nr9YhICi9pd320N2UxU2UypPt8icwKpxg==',
  'MEQCIFor/0UHVM8mZqnzrpoP95okzVpKsPV7HqmOwW62erbcAiAZnHYKyWyZ8qD5+Yn/2dfS2hw6cj8uOf8WAXwMiy09Yg==',
  'MEUCIQChTAB4iC8taP3ALjXklPLvWgusOe2HBGSqx/FkWw4NeQIgBTmXlT5MCXuu1pdWRsF7gKhZKJ99rGiSIycnBk18zOY=',
  'MEUCIQDbmNI4vdg7xjMYfUKh6jIlClEDVRhdMQlrqR7IVxpB8wIgYtNW+vbEBhPpPM3dDtJDLzjFJszIYn+WI5zftkxhzrk=',
  'MEUCIQD1SpB9bqyeNuqoxCJCFT9V5W6ODMlJV3GAh0+hQvaF5QIgLVMk3T9budJodMylyeUdmx9wRAXiq0ELyRrmLXGi+7A=',
  'MEQCIDY0KMdq5W2UswknRQf+ZYTPXwpMqx/oCKI28MUeeCtSAiANtT2uGeP3Om1BCzVCOwqEn8JaBoZg/CiVcYvOyT7l9A==',
  'MEQCIHzYwjMJapGpoooKCTY492TykMwpLyBf84v3MYupSOahAiAkBc8W2Lw0fkCp0EeVL2MvhWs7Qrx3EXLy+T77DCBLIw==',
  'MEQCIBo9KGAlv4x6f33lKCuFkdqfLvYr9lFjm/KHq1Bg2rRYAiAUDskI1UygLbwW+iR+DlKRxRWAVYjh7xv4Lh0ia0YMeA=='
];

task('oracle-ratio-update', 'Update ratio')
  .addParam('oracle', 'the address of the oracle')
  .setAction(async (taskArgs, hre) => {
    const { oracle } = taskArgs;
    const { ethers, run, upgrades } = hre;

    const ethSigs = signatures
      .map(b64sig => {
        const d = Buffer.from(b64sig, 'base64');
        return `0x${d.toString('hex')}`;
      })
      .map(sig => {
        let rawSig = ethers.getBytes(sig);

        // Extract R and S from the serialized signature
        // The serialized format is: 0x30 <length> 0x02 <length-of-R> <R> 0x02 <length-of-S> <S>
        let rStart = 4; // Skip the first 4 bytes (0x30, total length, 0x02, R length)
        let rLength = rawSig[3];

        // skip 0x00
        if (rawSig[4] == 0) {
          rStart += 1;
          rLength -= 1;
        }
        const sStart = rStart + rLength + 2; // Skip R and 0x02
        const sLength = rawSig[rStart + rLength + 1];

        // Copy R and S into proof, padding to 32 bytes each
        const proof: Uint8Array = new Uint8Array(64);
        proof.set(rawSig.slice(rStart, rStart + rLength), 32 - rLength);
        proof.set(rawSig.slice(sStart, sStart + sLength), 64 - sLength);

        return ethers.hexlify(proof);
      });

    const proof = ethers.AbiCoder.defaultAbiCoder().encode(['bytes[]'], [ethSigs]);

    const oracleContract = await ethers.getContractAt('StakedLBTCOracle', oracle);

    const p = '0x' + Buffer.from(ratioPayload, 'base64').toString('hex');

    console.log(`payload: ${p}`);
    console.log(`proof: ${proof}`);

    const tx = await oracleContract.publishNewRatio(p, proof);
    console.log(tx);
  });
