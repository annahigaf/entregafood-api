class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Repassa erros de funções async para o tratador de erros do Express. */
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);
function uuid(v, nome = 'identificador') {
  if (!isUuid(v)) throw new HttpError(400, `Valor inválido para ${nome}.`);
  return v;
}

function texto(v, nome, { min = 1, max = 200, obrigatorio = true } = {}) {
  if (v === undefined || v === null || v === '') {
    if (obrigatorio) throw new HttpError(400, `Informe: ${nome}.`);
    return null;
  }
  if (typeof v !== 'string') throw new HttpError(400, `Valor inválido para ${nome}.`);
  const t = v.trim();
  if (t.length < min || t.length > max) throw new HttpError(400, `${nome}: use de ${min} a ${max} caracteres.`);
  return t;
}

function numero(v, nome, { min = 0, max = 1e7, obrigatorio = true } = {}) {
  if (v === undefined || v === null || v === '') {
    if (obrigatorio) throw new HttpError(400, `Informe: ${nome}.`);
    return null;
  }
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new HttpError(400, `Valor inválido para ${nome}.`);
  return n;
}

/** Aceita "AAAA-MM-DD" ou nada (o SQL usa o padrão dos últimos 30 dias). */
function dataOpcional(v, nome) {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) {
    throw new HttpError(400, `${nome}: use o formato AAAA-MM-DD.`);
  }
  return v;
}

const arred2 = (n) => Math.round(n * 100) / 100;

function haversineKm(lat1, lon1, lat2, lon2) {
  const rad = (x) => (x * Math.PI) / 180;
  const a =
    Math.sin(rad(lat2 - lat1) / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

/**
 * Distância ESTIMADA: linha reta x 1,3 (fator de ruas).
 * Para a distância real por ruas, troque por uma chamada à Google Routes API aqui.
 */
function distanciaRuaKm(lat1, lon1, lat2, lon2) {
  if ([lat1, lon1, lat2, lon2].some((v) => v === null || v === undefined || Number.isNaN(Number(v)))) return null;
  return arred2(haversineKm(Number(lat1), Number(lon1), Number(lat2), Number(lon2)) * 1.3);
}

module.exports = { HttpError, wrap, isUuid, uuid, texto, numero, dataOpcional, arred2, distanciaRuaKm };
