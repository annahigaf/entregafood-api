const fs = require('fs');
const path = require('path');
const config = require('./config');
const { HttpError } = require('./util');

const MAX_BYTES = 5 * 1024 * 1024;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Valida e grava uma imagem enviada em base64 (PNG ou JPEG, até 5 MB). Devolve o caminho público ("/uploads/..."). */
function salvar(base64, prefixo) {
  const bruto = typeof base64 === 'string' ? base64 : '';
  const dados = bruto.replace(/^data:image\/\w+;base64,/, '');
  if (!dados) throw new HttpError(400, 'Envie a imagem em "imagem_base64".');
  const buf = Buffer.from(dados, 'base64');
  if (buf.length === 0 || buf.length > MAX_BYTES) throw new HttpError(400, 'A imagem deve ter até 5 MB.');
  let ext = null;
  if (buf.subarray(0, 8).equals(PNG)) ext = 'png';
  else if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) ext = 'jpg';
  if (!ext) throw new HttpError(400, 'Formato não suportado. Use PNG ou JPEG.');

  fs.mkdirSync(config.uploadDir, { recursive: true });
  const nome = `${prefixo}-${Date.now()}.${ext}`;
  fs.writeFileSync(path.join(config.uploadDir, nome), buf);
  return `/uploads/${nome}`;
}

/** Apaga um arquivo antigo (só se estiver em /uploads). */
function apagar(url) {
  if (url && url.startsWith('/uploads/')) fs.rm(path.join(config.uploadDir, path.basename(url)), () => {});
}

module.exports = { salvar, apagar };
