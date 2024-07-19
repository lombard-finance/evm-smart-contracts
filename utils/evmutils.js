/** @var web3 {Web3} */
const Web3 = require("web3");

function signMessageUsingPrivateKey(privateKey, data) {
  const { ec: EC } = require("elliptic"),
    ec = new EC("secp256k1");
  let keyPair = ec.keyFromPrivate(privateKey);
  // console.log(keyPair.getPrivate());
  let res = keyPair.sign(data.substring(2));
  const N_DIV_2 = Web3.utils.toBN("7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0", 16);
  const secp256k1N = Web3.utils.toBN("fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141", 16);
  let v = res.recoveryParam;
  let s = res.s;
  if (s.cmp(N_DIV_2) > 0) {
    s = secp256k1N.sub(s);
    v = v === 0 ? 1 : 0;
  }
  return (
    "0x" + Buffer.concat([res.r.toArrayLike(Buffer, "be", 32), s.toArrayLike(Buffer, "be", 32)]).toString("hex") + (v === 0 ? "1b" : "1c")
  );
}

const expectError = async (promise, text) => {
  try {
    await promise;
  } catch (e) {
    if (text === undefined || e.message.includes(text)) {
      return;
    }
    console.error(new Error(`Unexpected error: ${e.message}`));
  }
  console.error(new Error(`Expected error: ${text}`));
  assert.fail();
};

module.exports = {
  signMessageUsingPrivateKey,
  expectError,
};
