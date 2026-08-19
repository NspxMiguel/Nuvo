// O agente de navegador: leitura da ação, trava de endereço e, onde há Chrome,
// o navegador de verdade abrindo uma página servida aqui do lado.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { useTempHome } from './helpers.mjs';

const home = useTempHome();
const { lerAcao } = await import('../server/agente-web.mjs');
const { acharNavegador, abrirNavegador, lerPagina, executar } = await import('../server/navegador.mjs');

after(() => home.cleanup());

test('a ação é lida mesmo enfeitada pelo modelo', () => {
  assert.deepEqual(lerAcao('ACAO: buscar preço do dólar'), { acao: 'buscar', alvo: 'preço do dólar' });
  assert.deepEqual(lerAcao('**AÇÃO:** clicar 12'), { acao: 'clicar', alvo: '12' });
  assert.deepEqual(lerAcao('1. ACAO: rolar baixo'), { acao: 'rolar', alvo: 'baixo' });
  // "abrir" e "pesquisar" são o que o modelo escreve quando esquece a palavra
  // exata; recusar isso gastaria um passo inteiro só pra ele se corrigir.
  assert.deepEqual(lerAcao('ACAO: abrir nodejs.org'), { acao: 'navegar', alvo: 'nodejs.org' });
  assert.deepEqual(lerAcao('AÇÃO: pesquisar node sea'), { acao: 'buscar', alvo: 'node sea' });
});

test('escrever separa o campo do texto e tira as aspas', () => {
  assert.deepEqual(lerAcao('ACAO: escrever 3 node sea'), { acao: 'escrever', alvo: '3', texto: 'node sea' });
  assert.deepEqual(lerAcao('ACAO: escrever 3 "com aspas"'), {
    acao: 'escrever', alvo: '3', texto: 'com aspas'
  });
});

test('vale a última ação, e texto sem ação nenhuma não vira passo', () => {
  // O modelo às vezes explica o formato antes de usá-lo. Pegar a primeira faria
  // ele executar o exemplo em vez da decisão.
  assert.deepEqual(lerAcao('exemplo: ACAO: clicar 1\nna real:\nACAO: voltar'), {
    acao: 'voltar', alvo: ''
  });
  assert.equal(lerAcao('não sei o que fazer'), null);
  assert.equal(lerAcao(''), null);
});

test('pronto encerra, com qualquer um dos nomes', () => {
  for (const t of ['ACAO: pronto', 'ACAO: responder', 'AÇÃO: terminar']) {
    assert.deepEqual(lerAcao(t), { acao: 'pronto' });
  }
});

// Daqui pra baixo precisa de navegador instalado. Em contêiner sem Chrome o
// bloco inteiro é pulado — é justamente a máquina onde o globo cai na busca
// simples, então não há o que testar.
const temChrome = Boolean(acharNavegador());

/** Serve as páginas dadas e devolve o endereço base. `data:` não serve aqui:
 *  `navegar` prefixa https:// no que não é http, de propósito — o modelo escreve
 *  "nodejs.org" e tem que funcionar. */
async function servir(paginas) {
  const servidor = createServer((req, res) => {
    const corpo = paginas[req.url.split('?')[0]];
    res.writeHead(corpo ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' });
    res.end(corpo || 'nada');
  });
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  return { base: `http://127.0.0.1:${servidor.address().port}`, fechar: () => servidor.close() };
}

test('o navegador lê a página e clica no que existe', { skip: !temChrome }, async () => {
  const paginas = {
    '/': `<title>Início</title><body><h1>Catálogo</h1>
          <a href="/preco">ver o preço</a>
          <input id="q" placeholder="buscar"><button>ir</button></body>`,
    '/preco': '<title>Preço</title><body><p>A unidade sai por R$ 42,00.</p></body>'
  };
  const { base, fechar } = await servir(paginas);

  const { sessao, encerrar } = await abrirNavegador();
  try {
    await executar(sessao, { acao: 'navegar', alvo: base });
    const p = await lerPagina(sessao);
    assert.equal(p.titulo, 'Início');
    assert.match(p.texto, /Catálogo/);

    const link = p.elementos.find((e) => e.rotulo.includes('preço'));
    assert.ok(link, 'o link tinha que estar na lista numerada');
    assert.equal(link.tag, 'a');

    const campo = p.elementos.find((e) => e.escrevivel);
    assert.ok(campo, 'o campo de texto tinha que ser marcado como preenchível');

    await executar(sessao, { acao: 'clicar', alvo: link.n });
    assert.match((await lerPagina(sessao)).texto, /R\$ 42,00/);

    await executar(sessao, { acao: 'voltar' });
    assert.equal((await lerPagina(sessao)).titulo, 'Início');
  } finally {
    encerrar();
    fechar();
  }
});

test('o agente sobe mesmo com a janela do app aberta', { skip: !temChrome }, async () => {
  // Os dois usavam `~/.iaunifier/navegador`, e o Chrome recusa dois processos no
  // mesmo perfil: com o ícone do app aberto, o agente esperava 20s e desistia.
  const { DATA_DIR } = await import('../server/config.mjs');
  const { join } = await import('node:path');
  const { spawn } = await import('node:child_process');
  const janela = spawn(acharNavegador(), [
    '--headless=new',
    '--app=data:text/html,<title>app</title>',
    `--user-data-dir=${join(DATA_DIR, 'navegador')}`
  ], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 2500));
  try {
    const { sessao, encerrar } = await abrirNavegador();
    assert.ok(sessao, 'o agente tinha que subir com a janela do app aberta');
    encerrar();
  } finally {
    janela.kill();
  }
});

test('clicar num número que não existe é erro, não silêncio', { skip: !temChrome }, async () => {
  const { base, fechar } = await servir({ '/': '<title>Vazio</title><body><p>vazio</p></body>' });
  const { sessao, encerrar } = await abrirNavegador();
  try {
    await executar(sessao, { acao: 'navegar', alvo: base });
    await assert.rejects(() => executar(sessao, { acao: 'clicar', alvo: 99 }), /não existe elemento 99/);
  } finally {
    encerrar();
    fechar();
  }
});

test('o agente não digita em campo de senha', { skip: !temChrome }, async () => {
  const { base, fechar } = await servir({
    '/': '<title>Entrar</title><body><input type="password"><input type="text"></body>'
  });
  const { sessao, encerrar } = await abrirNavegador();
  try {
    await executar(sessao, { acao: 'navegar', alvo: base });
    const p = await lerPagina(sessao);
    const senha = p.elementos[0];
    await assert.rejects(
      () => executar(sessao, { acao: 'escrever', alvo: senha.n, texto: 'segredo' }),
      /senha/
    );
    // e o campo comum ao lado continua aceitando
    assert.match(
      await executar(sessao, { acao: 'escrever', alvo: p.elementos[1].n, texto: 'oi', enter: false }),
      /escrevi "oi"/
    );
  } finally {
    encerrar();
    fechar();
  }
});
