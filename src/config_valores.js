const db = require('./db');

/** Valores que só o ADMIN altera (tabela "configuracoes"). */
async function lerConfiguracoes(q = db) {
  const { rows } = await q.query('SELECT chave, valor FROM configuracoes');
  const m = Object.fromEntries(rows.map((r) => [r.chave, parseFloat(r.valor)]));
  return {
    valor_base_corrida: m.valor_base_corrida ?? 5,
    valor_por_km: m.valor_por_km ?? 1.5,
    comissao_plataforma: m.comissao_plataforma ?? 12,
  };
}

/** Quanto o motoboy recebe: base + (km da coleta + km da entrega) x valor por km. */
function valorCorrida(cfg, kmColeta, kmEntrega) {
  const total = (kmColeta ?? 0) + (kmEntrega ?? 0);
  return Math.round((cfg.valor_base_corrida + total * cfg.valor_por_km) * 100) / 100;
}

module.exports = { lerConfiguracoes, valorCorrida };
