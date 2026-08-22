// As IAs pelo site delas. A tela de terceiro não entra na suíte — ela muda sem
// avisar e exigiria conta em onze serviços. O que entra é o contrato: como a
// resposta é achada, o que acontece sem sessão, e o que o app nunca faz.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SITES, acharSite, comMarcas, lerEntreMarcas, semMarcaDeFim, perguntarNoSite, disponivel } from '../server/ia-de-site.mjs';

/** Uma sessão CDP de mentira: a "página" é um texto que o teste controla. */
class TelaFalsa {
  constructor({ temCaixa = true, senha = false, resposta = 'a resposta', enviaComEnter = true } = {}) {
    this.temCaixa = temCaixa;
    this.senha = senha;
    this.resposta = resposta;
    this.enviaComEnter = enviaComEnter;
    this.escrito = '';
    this.enviado = false;
    this.teclas = [];
    this.cliques = [];
    this.navegou = [];
  }

  async cmd(method, params = {}) {
    if (method === 'Page.navigate') this.navegou.push(params.url);
    if (method === 'Input.dispatchKeyEvent' && params.type === 'keyDown') {
      this.teclas.push(params.key);
      if (this.enviaComEnter && params.key === 'Enter') this.enviado = true;
    }
    return {};
  }

  async avaliar(expr) {
    if (expr.includes('setAttribute')) {
      return { achou: this.temCaixa, tag: 'textarea', senha: this.senha };
    }
    if (expr.includes('dispatchEvent')) {
      const m = /const t = ("(?:[^"\\]|\\.)*")/.exec(expr);
      this.escrito = m ? JSON.parse(m[1]) : '';
      return { ok: true, tem: this.escrito.length };
    }
    if (expr.includes('alvo.click()')) {
      this.cliques.push('enviar');
      this.enviado = true;
      return { ok: true, nome: 'Enviar' };
    }
    if (expr.includes("(e.value ?? e.textContent ?? '').length")) {
      return this.enviado ? 0 : this.escrito.length;
    }
    if (expr.includes('document.body.innerText')) {
      // Antes de enviar, a tela mostra só o que foi digitado; depois, a resposta.
      return this.enviado ? `${this.escrito}\n\n${this.resposta}` : this.escrito;
    }
    throw new Error('expressão inesperada no teste: ' + expr.slice(0, 40));
  }
}

const consumir = async (gerador) => {
  const passos = [];
  let p = await gerador.next();
  while (!p.done) {
    passos.push(p.value);
    p = await gerador.next();
  }
  return { passos, valor: p.value };
};

test('a lista de sites tem os que ele pediu, sem repetir id', () => {
  const ids = SITES.map((s) => s.id);
  for (const pedido of ['chatgpt', 'claude', 'gemini', 'deepseek', 'glm', 'kimi']) {
    assert.ok(ids.includes(pedido), `faltou ${pedido}`);
  }
  assert.equal(new Set(ids).size, ids.length, 'id repetido faria dois modelos com o mesmo nome');
  for (const s of SITES) {
    assert.match(s.endereco, /^https:\/\//, `${s.id} precisa de endereço https`);
    assert.ok(s.nome && s.espera > 0, `${s.id} precisa de nome e de teto de espera`);
  }
  assert.equal(acharSite('nao-existe'), null);
});

test('a resposta é lida entre as marcas, não do desenho da página', () => {
  // O DOM é deles e muda toda semana. As marcas são escritas pelo próprio modelo.
  const pedido = comMarcas('quanto é 2+2?');
  assert.match(pedido, /quanto é 2\+2\?/);

  const tela = `${pedido}\n\n<<<NUVO_R_INICIO>>>\nquatro\n<<<NUVO_R_FIM>>>`;
  assert.equal(lerEntreMarcas(tela), 'quatro');

  // O pedido também tem as marcas e aparece na tela: vale a última ocorrência.
  assert.equal(lerEntreMarcas(comMarcas('oi')), null, 'só o pedido não é resposta');
  assert.equal(lerEntreMarcas('sem marca nenhuma'), null);
  assert.equal(lerEntreMarcas(`<<<NUVO_R_INICIO>>>\nainda escrevendo`), null, 'sem a marca de fim, ainda não terminou');
});

test('modelo que esquece a marca de fim não faz o trabalho ser jogado fora', () => {
  assert.equal(semMarcaDeFim('<<<NUVO_R_INICIO>>>\nescrevi tudo e esqueci de fechar'), 'escrevi tudo e esqueci de fechar');
  assert.equal(semMarcaDeFim('nada aqui'), null);
});

test('pergunta, envia e volta com a resposta', async () => {
  const tela = new TelaFalsa({ resposta: '<<<NUVO_R_INICIO>>>\nquatro\n<<<NUVO_R_FIM>>>' });
  const { passos, valor } = await consumir(
    perguntarNoSite({ site: 'deepseek', pergunta: 'quanto é 2+2?', sessao: tela })
  );
  assert.equal(valor.texto, 'quatro');
  assert.equal(valor.site, 'deepseek');
  assert.deepEqual(tela.navegou, ['https://chat.deepseek.com/']);
  assert.ok(tela.escrito.includes('quanto é 2+2?'), 'a pergunta foi digitada');
  assert.ok(tela.enviado, 'e enviada');
  assert.ok(passos.every((p) => p.passo), 'cada passo é dito na tela');
});

test('site que não envia com Enter cai no botão', async () => {
  const tela = new TelaFalsa({
    enviaComEnter: false,
    resposta: '<<<NUVO_R_INICIO>>>\nok\n<<<NUVO_R_FIM>>>'
  });
  const { valor } = await consumir(perguntarNoSite({ site: 'kimi', pergunta: 'oi', sessao: tela }));
  assert.equal(valor.texto, 'ok');
  assert.deepEqual(tela.cliques, ['enviar'], 'o botão foi o caminho');
});

test('sem sessão, a recusa diz o que fazer e não fala em senha nenhuma', async () => {
  const tela = new TelaFalsa({ temCaixa: false, senha: true });
  await assert.rejects(
    () => consumir(perguntarNoSite({ site: 'chatgpt', pergunta: 'oi', sessao: tela })),
    (err) => {
      assert.equal(err.status, 503);
      assert.match(err.message, /entre nele no navegador do app/);
      assert.match(err.message, /o app não digita senha/);
      return true;
    }
  );
  assert.equal(tela.escrito, '', 'nada foi digitado numa tela de login');
});

test('site desconhecido é recusado antes de abrir navegador nenhum', async () => {
  await assert.rejects(
    () => consumir(perguntarNoSite({ site: 'inventado', pergunta: 'oi' })),
    (err) => err.status === 400
  );
  await assert.rejects(
    () => consumir(perguntarNoSite({ site: 'chatgpt', pergunta: '   ' })),
    (err) => err.status === 400
  );
});

test('o teste do provedor diz a verdade sobre a sessão', async () => {
  assert.deepEqual(await disponivel({ site: 'claude', sessao: new TelaFalsa() }), { ok: true, porque: null });
  const fora = await disponivel({ site: 'claude', sessao: new TelaFalsa({ temCaixa: false, senha: true }) });
  assert.equal(fora.ok, false);
  assert.match(fora.porque, /entre nele no navegador do app/);
});

test('nenhum site da lista é um endereço de login', () => {
  // Mandar a automação direto pra tela de login seria pedir pra ela digitar
  // credencial. O endereço de cada um é o do chat.
  for (const s of SITES) {
    assert.doesNotMatch(s.endereco, /login|signin|sign-in|auth/i, `${s.id} aponta pra login`);
  }
});
