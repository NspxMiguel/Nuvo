// A tela do NotebookLM não faz parte da suíte: ela muda sem avisar e exigiria
// rede e uma conta Google. Aqui uma sessão CDP de mentira prova só o contrato,
// o parsing da resposta e a falha limpa quando a tela não é a esperada.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { disponivel, gerarNoNotebookLM } from '../server/notebooklm.mjs';

const RESPOSTA = `Notebook de Biologia
<<<NUVO_PEDIDO_FIM>>>
resposta carregando
<<<NUVO_RESPOSTA_INICIO>>>
# Resumo

A célula usa ATP como moeda de energia. [1]
<<<NUVO_RESPOSTA_FIM>>>
rodapé`;

class SessaoFalsa {
  constructor({ fora = false, clique = true } = {}) {
    this.fora = fora;
    this.clique = clique;
    this.comandos = [];
    this.expressoes = [];
  }

  async cmd(method, params = {}) {
    this.comandos.push({ method, params });
    if (method === 'DOM.getDocument') return { root: { nodeId: 1 } };
    if (method === 'DOM.querySelectorAll') return { nodeIds: [17] };
    return {};
  }

  async avaliar(expressao) {
    this.expressoes.push(expressao);
    if (expressao.includes('nuvo:notebooklm:conta')) {
      return { fora: this.fora, criar: this.fora ? 0 : 1, pronta: true };
    }
    if (expressao.includes('nuvo:notebooklm:clicar')) {
      return this.clique ? { ok: true, nome: 'ação esperada' } : { ok: false, quantos: 0 };
    }
    if (expressao.includes('nuvo:notebooklm:upload')) return { arquivos: 1, botoes: 0 };
    if (expressao.includes('nuvo:notebooklm:notebook')) {
      return { fontes: true, campos: 1, fora: false };
    }
    if (expressao.includes('nuvo:notebooklm:preencher')) return true;
    if (expressao.includes('nuvo:notebooklm:corpo')) return RESPOSTA;
    throw new Error('expressão inesperada no teste');
  }
}

async function consumir(gerador) {
  const eventos = [];
  while (true) {
    const passo = await gerador.next();
    if (passo.done) return { eventos, valor: passo.value };
    eventos.push(passo.value);
  }
}

test('disponibilidade consulta notebook.google.com sem abrir login nem escrever credencial', async () => {
  const sessao = new SessaoFalsa();
  assert.deepEqual(await disponivel({ sessao }), { ok: true, porque: null });
  assert.deepEqual(sessao.comandos[0], {
    method: 'Page.navigate',
    params: { url: 'https://notebook.google.com/' }
  });
  assert.equal(sessao.expressoes.some((e) => /password.*value|type.*password.*=/.test(e)), false);
});

test('gerador faz upload pelo CDP, lê os marcadores e não vaza caminhos nas fontes', async () => {
  const sessao = new SessaoFalsa();
  const caminho = '/materiais/biologia.pdf';
  const { eventos, valor } = await consumir(
    gerarNoNotebookLM({
      arquivos: [{ id: 'anexo-1', nome: 'biologia.pdf', caminho }],
      tipo: 'resumo',
      sessao
    })
  );

  assert.ok(eventos.length >= 6);
  assert.ok(eventos.every((e) => e.type === 'passo' && e.o_que));
  assert.equal(valor.texto, '# Resumo\n\nA célula usa ATP como moeda de energia. [1]');
  assert.deepEqual(valor.fontes, [{ id: 'anexo-1', nome: 'biologia.pdf' }]);

  const upload = sessao.comandos.find((c) => c.method === 'DOM.setFileInputFiles');
  assert.deepEqual(upload.params, { files: [resolve(caminho)], nodeId: 17 });
});

test('sessão sem login falha com 503 e a mensagem que mantém o Estudos utilizável', async () => {
  const sessao = new SessaoFalsa({ fora: true });
  await assert.rejects(
    () => consumir(
      gerarNoNotebookLM({
        arquivos: [{ id: 'a', nome: 'a.pdf', caminho: '/materiais/a.pdf' }],
        tipo: 'guia',
        sessao
      })
    ),
    (err) => {
      assert.equal(err.status, 503);
      assert.equal(
        err.message,
        'o NotebookLM mudou de tela ou você não está logado — o Estudos continua funcionando sem ele'
      );
      return true;
    }
  );
  assert.equal(sessao.expressoes.some((e) => e.includes('nuvo:notebooklm:preencher')), false);
});

test('se um seletor some, não tenta adivinhar outro alvo', async () => {
  const sessao = new SessaoFalsa({ clique: false });
  await assert.rejects(
    () => consumir(
      gerarNoNotebookLM({
        arquivos: [{ id: 'a', nome: 'a.pdf', caminho: '/materiais/a.pdf' }],
        tipo: 'quiz',
        sessao
      })
    ),
    (err) => err.status === 503 && err.message.includes('o Estudos continua funcionando sem ele')
  );
  assert.equal(sessao.comandos.some((c) => c.method === 'DOM.setFileInputFiles'), false);
});
