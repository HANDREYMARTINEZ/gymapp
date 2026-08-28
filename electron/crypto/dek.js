const crypto = require('crypto');

function generarDEK() {
  return crypto.randomBytes(32);
}

function generarSalt() {
  return crypto.randomBytes(16).toString('hex');
}

function derivarKEK(passphrase, saltHex) {
  const salt = Buffer.from(saltHex, 'hex');
  return crypto.scryptSync(passphrase, salt, 32);
}

function envolverDEK(dek, kek) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', kek, iv);
  const cifrado = Buffer.concat([cipher.update(dek), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, cifrado]).toString('hex');
}

function desenvolverDEK(wrappedHex, kek) {
  const wrapped = Buffer.from(wrappedHex, 'hex');
  const iv = wrapped.subarray(0, 12);
  const tag = wrapped.subarray(12, 28);
  const cifrado = wrapped.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', kek, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(cifrado), decipher.final()]);
}

// --- Escrow con clave pública del desarrollador (X25519 + AES-256-GCM) ---

function envolverDEKConClavePublica(dek, publicKeyPem) {
  const recipientPublicKey = crypto.createPublicKey(publicKeyPem);
  const efimero = crypto.generateKeyPairSync('x25519');

  const secretoCompartido = crypto.diffieHellman({
    privateKey: efimero.privateKey,
    publicKey: recipientPublicKey,
  });
  const kek = crypto.createHash('sha256').update(secretoCompartido).digest();

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', kek, iv);
  const cifrado = Buffer.concat([cipher.update(dek), cipher.final()]);
  const tag = cipher.getAuthTag();

  const efimeroPubDer = efimero.publicKey.export({ type: 'spki', format: 'der' });
  const lenBuf = Buffer.alloc(2);
  lenBuf.writeUInt16BE(efimeroPubDer.length);

  return Buffer.concat([lenBuf, efimeroPubDer, iv, tag, cifrado]).toString('hex');
}

function desenvolverDEKConClavePrivada(wrappedHex, privateKeyPem) {
  const wrapped = Buffer.from(wrappedHex, 'hex');
  const len = wrapped.readUInt16BE(0);
  let offset = 2;
  const efimeroPubDer = wrapped.subarray(offset, offset + len); offset += len;
  const iv = wrapped.subarray(offset, offset + 12); offset += 12;
  const tag = wrapped.subarray(offset, offset + 16); offset += 16;
  const cifrado = wrapped.subarray(offset);

  const efimeroPublicKey = crypto.createPublicKey({ key: efimeroPubDer, format: 'der', type: 'spki' });
  const privateKey = crypto.createPrivateKey(privateKeyPem);
  const secretoCompartido = crypto.diffieHellman({ privateKey, publicKey: efimeroPublicKey });
  const kek = crypto.createHash('sha256').update(secretoCompartido).digest();

  const decipher = crypto.createDecipheriv('aes-256-gcm', kek, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(cifrado), decipher.final()]);
}

module.exports = {
  generarDEK, generarSalt, derivarKEK, envolverDEK, desenvolverDEK,
  envolverDEKConClavePublica, desenvolverDEKConClavePrivada,
};

let dekEnMemoria = null;

function guardarDekEnMemoria(dek) {
  dekEnMemoria = dek;
}

function obtenerDekEnMemoria() {
  return dekEnMemoria;
}

module.exports.guardarDekEnMemoria = guardarDekEnMemoria;
module.exports.obtenerDekEnMemoria = obtenerDekEnMemoria;