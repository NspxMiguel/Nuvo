// Estudos: professores, as caixas de material de cada um, e o que foi gerado.
//
// A ideia que sustenta a tela inteira: prova passada é amostra do que este
// professor cobra, e material de aula é o universo do que ele ensina. A
// diferença entre os dois é a previsão — o que ele ensinou e nunca cobrou, o que
// ele cobra sempre, em que formato e em que nível. Por isso as caixas são
// separadas por tipo, e o anexo carrega o papel que exerce dentro da caixa.
//
// Nada aqui chama modelo. Isto é o armário; quem lê e conclui é o retrato.

import { mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { basename, join } from 'node:path';

import { all, one, run, tx, uid, now, parseJSON } from './db.mjs';
import { UPLOAD_DIR } from './config.mjs';
import { erroHttp } from './erro-traduzivel.mjs';
import { deleteAttachmentsOf, listAttachments } from './documents.mjs';

/** Como o material fica organizado dentro do professor. */
export const ORGANIZACOES = ['pastas', 'periodo', 'etiquetas'];

/** O que uma pasta é. Prova é avaliação; material é o que ele ensina fora dela. */
export const TIPOS_DE_PASTA = ['prova', 'material'];

/**
 * O papel de um anexo dentro da pasta.
 *
 * Dentro da pasta de uma prova entram duas coisas que não podem ser confundidas:
 * a prova em si (`prova`) e o conteúdo que ela cobrou (`conteudo`). Comparar a
 * prova com o conteúdo dela é o que revela o recorte do professor; comparar a
 * prova com material solto de outro assunto não revela nada.
 */
export const PAPEIS = ['prova', 'conteudo', 'material'];

const texto = (valor, limite = 200) => String(valor ?? '').trim().slice(0, limite);

function exigir(condicao, molde, valores) {
  if (!condicao) throw erroHttp(400, molde, valores);
}

function exigirExiste(linha, molde) {
  if (!linha) throw erroHttp(404, molde);
  return linha;
}

// ------------------------------------------------------------- professores

export function listarProfessores() {
  return all('SELECT * FROM professores ORDER BY created_at').map(publico);
}

export function acharProfessor(id) {
  return publico(exigirExiste(one('SELECT * FROM professores WHERE id = ?', id), 'professor não encontrado'));
}

/**
 * Cria o professor e as caixas com que ele nasce.
 *
 * As pastas iniciais vêm de quem chamou, já com o nome no idioma da pessoa: o
 * servidor não tem `t()`, e um nome de pasta semeado em português apareceria
 * assim pra quem lê o app em inglês. Quem não mandar nada ganha só a caixa de
 * material, que todo professor tem.
 */
export function criarProfessor(dados = {}) {
  const nome = texto(dados.nome);
  exigir(nome, 'o professor precisa de um nome');
  const organizacao = ORGANIZACOES.includes(dados.organizacao) ? dados.organizacao : 'pastas';
  const agora = now();
  const id = uid();

  return tx(() => {
    run(
      `INSERT INTO professores (id, nome, materia, escola, foto, cor, organizacao, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      nome,
      texto(dados.materia) || null,
      texto(dados.escola) || null,
      texto(dados.foto, 400) || null,
      texto(dados.cor, 20) || 'indigo',
      organizacao,
      agora,
      agora
    );
    const pedidas = Array.isArray(dados.pastas) ? dados.pastas : [];
    const semente = pedidas.length ? pedidas : [{ nome: texto(dados.pastaMaterial) || 'Material da aula', tipo: 'material' }];
    semente.forEach((pasta, i) => inserirPasta(id, pasta, i));
    return verProfessor(id);
  });
}

export function atualizarProfessor(id, campos = {}) {
  acharProfessor(id);
  const mapa = {
    nome: (v) => texto(v),
    materia: (v) => texto(v) || null,
    escola: (v) => texto(v) || null,
    foto: (v) => texto(v, 400) || null,
    cor: (v) => texto(v, 20) || 'indigo',
    organizacao: (v) => (ORGANIZACOES.includes(v) ? v : 'pastas')
  };
  const partes = [];
  const valores = [];
  for (const [campo, limpar] of Object.entries(mapa)) {
    if (!(campo in campos)) continue;
    const valor = limpar(campos[campo]);
    if (campo === 'nome') exigir(valor, 'o professor precisa de um nome');
    partes.push(`${campo} = ?`);
    valores.push(valor);
  }
  if (partes.length) {
    run(`UPDATE professores SET ${partes.join(', ')}, updated_at = ? WHERE id = ?`, ...valores, now(), id);
  }
  return verProfessor(id);
}

/**
 * Apaga o professor, as pastas, o que foi gerado e os arquivos do disco.
 *
 * O `ON DELETE CASCADE` do banco derruba as linhas, mas não a cópia crua em
 * `~/.nuvo/uploads` — quem sabe apagar arquivo é `documents.mjs`, e ele precisa
 * ser chamado pasta por pasta antes de o professor sumir.
 */
export function apagarProfessor(id) {
  acharProfessor(id);
  for (const pasta of pastasDo(id)) deleteAttachmentsOf({ pastaId: pasta.id });
  run('DELETE FROM professores WHERE id = ?', id);
  return { ok: true };
}

/**
 * A foto do professor.
 *
 * Guardada em `~/.nuvo/uploads` como qualquer anexo, e servida por uma rota que
 * recebe o id do professor — nunca o nome do arquivo. Nome de arquivo na URL é
 * como se pede `../../.ssh/id_rsa` a um servidor educado.
 *
 * O tipo é decidido pelos primeiros bytes, e não pelo `content-type` que o
 * navegador mandou nem pela extensão: os dois são escolha de quem envia.
 */
const ASSINATURAS = [
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47] },
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { mime: 'image/webp', bytes: [0x52, 0x49, 0x46, 0x46], em: 8, mais: [0x57, 0x45, 0x42, 0x50] }
];

const LIMITE_DA_FOTO = 4 * 1024 * 1024;

export function tipoDaImagem(buffer) {
  for (const a of ASSINATURAS) {
    const cabe = a.bytes.every((b, i) => buffer[i] === b);
    const resto = !a.mais || a.mais.every((b, i) => buffer[a.em + i] === b);
    if (cabe && resto) return a.mime;
  }
  return null;
}

export function guardarFoto(professorId, buffer) {
  acharProfessor(professorId);
  exigir(buffer?.length, 'chegou um arquivo vazio');
  exigir(buffer.length <= LIMITE_DA_FOTO, 'a foto passa de 4 MB');
  const mime = tipoDaImagem(buffer);
  exigir(mime, 'a foto precisa ser PNG, JPG ou WebP');

  mkdirSync(UPLOAD_DIR, { recursive: true });
  const nome = `prof-${professorId}.${mime.split('/')[1]}`;
  writeFileSync(join(UPLOAD_DIR, nome), buffer);
  const antiga = one('SELECT foto FROM professores WHERE id = ?', professorId)?.foto;
  // O banco é atualizado ANTES de a foto antiga sair do disco. Ao contrário, um
  // erro no UPDATE deixava o professor apontando pra um arquivo que já não
  // existe — foto quebrada pra sempre. Nesta ordem, o pior caso é um arquivo
  // órfão em disco, que não estraga tela nenhuma.
  run('UPDATE professores SET foto = ?, updated_at = ? WHERE id = ?', nome, now(), professorId);
  // A anterior pode ter outra extensão: sem apagar, sobra lixo no disco a cada troca.
  if (antiga && antiga !== nome) {
    try {
      unlinkSync(join(UPLOAD_DIR, antiga));
    } catch {
      /* já não estava lá */
    }
  }
  return verProfessor(professorId);
}

export function lerFoto(professorId) {
  const nome = acharProfessor(professorId).foto;
  exigirExiste(nome, 'este professor não tem foto');
  // `basename` porque o que está no banco só pode ser um nome simples — se um dia
  // virar caminho, ele para aqui em vez de sair da pasta de uploads.
  const caminho = join(UPLOAD_DIR, basename(nome));
  const buffer = readFileSync(caminho);
  return { buffer, mime: tipoDaImagem(buffer) || 'application/octet-stream' };
}

// ------------------------------------------------------------------ pastas

export function pastasDo(professorId) {
  return all(
    'SELECT * FROM estudo_pastas WHERE professor_id = ? ORDER BY ord, created_at',
    professorId
  ).map(pastaPublica);
}

/**
 * Data no formato AAAA-MM-DD, ou `null`.
 *
 * Só a data, sem hora: prova tem dia, não horário, e guardar um instante faria
 * "hoje" virar "ontem" pra quem abrir o app de manhã cedo noutro fuso.
 */
function soData(valor) {
  const texto = String(valor ?? '').trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(texto) ? texto : null;
}

function inserirPasta(professorId, pasta = {}, ord = 0) {
  const nome = texto(pasta.nome);
  exigir(nome, 'a pasta precisa de um nome');
  const tipo = TIPOS_DE_PASTA.includes(pasta.tipo) ? pasta.tipo : 'prova';
  const id = uid();
  run(
    `INSERT INTO estudo_pastas (id, professor_id, nome, tipo, etiquetas, ord, quando, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    professorId,
    nome,
    tipo,
    JSON.stringify(Array.isArray(pasta.etiquetas) ? pasta.etiquetas.map((e) => texto(e, 40)) : []),
    Number.isFinite(pasta.ord) ? pasta.ord : ord,
    soData(pasta.quando),
    now()
  );
  return id;
}

export function criarPasta(professorId, pasta = {}) {
  acharProfessor(professorId);
  const ord = (one('SELECT MAX(ord) AS m FROM estudo_pastas WHERE professor_id = ?', professorId)?.m ?? -1) + 1;
  const id = inserirPasta(professorId, pasta, ord);
  return pastaPublica(one('SELECT * FROM estudo_pastas WHERE id = ?', id));
}

export function atualizarPasta(id, campos = {}) {
  const linha = exigirExiste(one('SELECT * FROM estudo_pastas WHERE id = ?', id), 'pasta não encontrada');
  const nome = 'nome' in campos ? texto(campos.nome) : linha.nome;
  exigir(nome, 'a pasta precisa de um nome');
  const tipo = TIPOS_DE_PASTA.includes(campos.tipo) ? campos.tipo : linha.tipo;
  const etiquetas = Array.isArray(campos.etiquetas)
    ? JSON.stringify(campos.etiquetas.map((e) => texto(e, 40)))
    : linha.etiquetas;
  run(
    'UPDATE estudo_pastas SET nome = ?, tipo = ?, etiquetas = ?, quando = ? WHERE id = ?',
    nome,
    tipo,
    etiquetas,
    'quando' in campos ? soData(campos.quando) : linha.quando,
    id
  );
  return pastaPublica(one('SELECT * FROM estudo_pastas WHERE id = ?', id));
}

export function apagarPasta(id) {
  exigirExiste(one('SELECT * FROM estudo_pastas WHERE id = ?', id), 'pasta não encontrada');
  deleteAttachmentsOf({ pastaId: id });
  run('DELETE FROM estudo_pastas WHERE id = ?', id);
  return { ok: true };
}

/**
 * Nova ordem das pastas, na sequência de ids que a tela mandou.
 *
 * Id de outro professor é descartado, e pasta que a tela não mencionou vai pro
 * fim na ordem em que já estava — numerar só as citadas deixaria as outras com o
 * `ord` velho, e duas pastas empatadas em zero saem numa ordem que ninguém pediu.
 */
export function reordenarPastas(professorId, ids = []) {
  acharProfessor(professorId);
  const atuais = pastasDo(professorId);
  const minhas = new Map(atuais.map((p) => [p.id, p]));
  const pedidas = ids.filter((id) => minhas.has(id));
  const resto = atuais.map((p) => p.id).filter((id) => !pedidas.includes(id));
  tx(() => {
    [...pedidas, ...resto].forEach((id, i) => run('UPDATE estudo_pastas SET ord = ? WHERE id = ?', i, id));
  });
  return pastasDo(professorId);
}

// ------------------------------------------------------------------- visão

/** O professor com as caixas dele e o que tem dentro de cada uma. */
export function verProfessor(id) {
  const professor = acharProfessor(id);
  const pastas = pastasDo(id).map((pasta) => {
    const anexos = listAttachments({ pastaId: pasta.id });
    return {
      ...pasta,
      anexos,
      contagem: PAPEIS.reduce(
        (conta, papel) => ({ ...conta, [papel]: anexos.filter((a) => a.papel === papel).length }),
        {}
      )
    };
  });
  return {
    ...professor,
    pastas,
    // O que o retrato tem pra trabalhar. A tela usa isto pra dizer, antes de
    // gastar um modelo, que ainda é cedo: uma prova só vira palpite, não retrato.
    material: {
      provas: pastas.reduce((n, p) => n + (p.contagem.prova || 0), 0),
      conteudos: pastas.reduce((n, p) => n + (p.contagem.conteudo || 0), 0),
      materiais: pastas.reduce((n, p) => n + (p.contagem.material || 0), 0)
    }
  };
}

// ------------------------------------------------------------------ saídas

export function listarSaidas(professorId, { tipo = null } = {}) {
  const linhas = tipo
    ? all(
        'SELECT * FROM estudo_saidas WHERE professor_id = ? AND tipo = ? ORDER BY created_at DESC',
        professorId,
        tipo
      )
    : all('SELECT * FROM estudo_saidas WHERE professor_id = ? ORDER BY created_at DESC', professorId);
  return linhas.map(saidaPublica);
}

export function acharSaida(id) {
  return saidaPublica(exigirExiste(one('SELECT * FROM estudo_saidas WHERE id = ?', id), 'isto não existe mais'));
}

export function guardarSaida({ professorId, pastaId = null, tipo, titulo, json, fontes = [], modelo = null }) {
  acharProfessor(professorId);
  const id = uid();
  run(
    `INSERT INTO estudo_saidas (id, professor_id, pasta_id, tipo, titulo, json, fontes, modelo, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    professorId,
    pastaId,
    texto(tipo, 40),
    texto(titulo, 200) || texto(tipo, 40),
    JSON.stringify(json ?? {}),
    JSON.stringify(fontes ?? []),
    modelo,
    now()
  );
  return acharSaida(id);
}

export function apagarSaida(id) {
  acharSaida(id);
  run('DELETE FROM estudo_saidas WHERE id = ?', id);
  return { ok: true };
}

// ------------------------------------------------------------------ moldes

function publico(linha) {
  return {
    ...linha,
    retrato: parseJSON(linha.retrato, null)
  };
}

function pastaPublica(linha) {
  // A leitura crua não vai pra tela: é JSON de trabalho, do tamanho de uma
  // prova, e o que a tela mostra é o retrato pronto.
  const { leitura, leitura_chave: chave, ...resto } = linha;
  return { ...resto, etiquetas: parseJSON(linha.etiquetas, []) };
}

/** A leitura que o modelo fez desta prova, se ainda vale pra fonte de hoje. */
export function leituraGuardada(pastaId, chave) {
  const linha = one('SELECT leitura, leitura_chave FROM estudo_pastas WHERE id = ?', pastaId);
  if (!linha || linha.leitura_chave !== chave) return null;
  return parseJSON(linha.leitura, null);
}

/** Guarda a leitura junto com a impressão digital do que a produziu. */
export function guardarLeitura(pastaId, chave, leitura) {
  run(
    'UPDATE estudo_pastas SET leitura = ?, leitura_chave = ?, leitura_em = ? WHERE id = ?',
    JSON.stringify(leitura),
    chave,
    now(),
    pastaId
  );
}

function saidaPublica(linha) {
  return { ...linha, json: parseJSON(linha.json, {}), fontes: parseJSON(linha.fontes, []) };
}
