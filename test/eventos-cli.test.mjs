// A tradução do JSONL das três IAs de linha de comando.
//
// As amostras em test/amostras/ são saída de verdade: as três receberam o mesmo
// pedido ("leia soma.mjs e diga o nome da função") na mesma pasta, então as três
// têm que contar a mesma história — leu o arquivo, e a resposta é "soma". É esse
// paralelo que o teste cobra; formato inventado passaria num teste escrito à
// mão, não passa aqui.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ARGS_ESTRUTURADO, traduzirLinha, cortar, nomeDoComando } from '../server/eventos-cli.mjs';

/** A pasta em que as três amostras foram gravadas, e que vira a raiz relativa. */
const RAIZ =
  '/private/tmp/claude-501/-Users-miguel-Documents-Claude/98fe00c8-47b8-4477-8949-ce629baf2d07/scratchpad/ide-teste';

function amostra(comando, arquivo, raiz = RAIZ) {
  const caminho = fileURLToPath(new URL(`./amostras/${arquivo}`, import.meta.url));
  const pecas = [];
  for (const linha of readFileSync(caminho, 'utf8').split('\n')) {
    if (!linha.trim()) continue;
    pecas.push(...traduzirLinha(comando, linha, raiz));
  }
  return pecas;
}

const eventos = (pecas, tipo) => pecas.filter((p) => p.evento?.tipo === tipo).map((p) => p.evento);
const texto = (pecas) => pecas.filter((p) => typeof p.delta === 'string').map((p) => p.delta).join('');
const raciocinio = (pecas) =>
  pecas.filter((p) => typeof p.reasoning === 'string').map((p) => p.reasoning).join('');

const doClaude = amostra('claude', 'claude.jsonl');
const doClaudeParcial = amostra('claude', 'claude-parcial.jsonl');
const doCodex = amostra('codex', 'codex.jsonl');
const doOpencode = amostra('opencode', 'opencode.jsonl');

test('o claude conta que leu o arquivo, com o caminho relativo ao projeto', () => {
  const ferramentas = eventos(doClaude, 'ferramenta');
  assert.equal(ferramentas.length, 1);
  assert.equal(ferramentas[0].acao, 'ler');
  assert.equal(ferramentas[0].arquivo, 'soma.mjs');
  assert.equal(ferramentas[0].titulo, 'leu soma.mjs');
  assert.match(ferramentas[0].id, /^toolu_/);
  // Ler não roda nada; comando aqui seria campo mentindo sobre o que houve.
  assert.equal(ferramentas[0].comando, undefined);
});

test('o codex lê com sed, e isso conta como leitura e não como comando solto', () => {
  const ferramentas = eventos(doCodex, 'ferramenta');
  assert.equal(ferramentas.length, 1);
  assert.equal(ferramentas[0].acao, 'ler');
  assert.equal(ferramentas[0].arquivo, 'soma.mjs');
  assert.equal(ferramentas[0].titulo, 'leu soma.mjs');
  assert.equal(ferramentas[0].id, 'item_1');
});

test('o opencode manda a ferramenta e a saída na mesma linha', () => {
  const ferramentas = eventos(doOpencode, 'ferramenta');
  assert.equal(ferramentas.length, 1);
  assert.equal(ferramentas[0].acao, 'ler');
  assert.equal(ferramentas[0].arquivo, 'soma.mjs');
  assert.equal(ferramentas[0].titulo, 'leu soma.mjs');
  assert.match(ferramentas[0].id, /^call_/);
});

test('a saída casa com a ferramenta pelo id, nas três', () => {
  for (const [nome, pecas] of [
    ['claude', doClaude],
    ['codex', doCodex],
    ['opencode', doOpencode]
  ]) {
    const abertas = new Set(eventos(pecas, 'ferramenta').map((e) => e.id));
    const saidas = eventos(pecas, 'saida');
    assert.equal(saidas.length, 1, `${nome}: uma ferramenta, uma saída`);
    assert.ok(abertas.has(saidas[0].id), `${nome}: saída ${saidas[0].id} sem ferramenta`);
    assert.equal(saidas[0].ok, true);
    // As três leram o mesmo arquivo, então as três saídas trazem o mesmo miolo.
    assert.match(saidas[0].texto, /export const soma = \(a,b\) => a\+b;/);
  }
});

test('o texto da resposta final chega como delta', () => {
  // O codex responde em parágrafos inteiros; o "soma" é o último deles.
  assert.match(texto(doCodex), /Vou ler o arquivo\.\n\nsoma/);
  assert.equal(texto(doOpencode), 'soma');
  // O `claude` do app roda com --include-partial-messages, e é essa amostra que
  // representa o que ele manda de verdade.
  assert.equal(texto(doClaudeParcial), 'ok');
});

test('com o texto em pedaço, a resposta não sai duas vezes', () => {
  // A amostra tem o delta "ok" e, na linha seguinte, a mensagem 'assistant'
  // completa com o mesmo "ok". Emitir as duas escreveria a resposta em dobro na
  // tela; o delta ganha, porque é ele que faz a tela andar enquanto o modelo
  // ainda está escrevendo.
  const deltas = doClaudeParcial.filter((p) => typeof p.delta === 'string');
  assert.equal(deltas.length, 1);
  assert.equal(deltas[0].delta, 'ok');
});

test('o fim do turno traz tempo, custo e turnos quando o CLI conta', () => {
  const [fim] = eventos(doClaude, 'fim');
  assert.deepEqual(fim, { tipo: 'fim', ms: 6717, custo: 0.1506165, turnos: 2 });

  // O 'turn.completed' do codex só traz uso de tokens: o evento existe pra
  // marcar o fim, e os números que ele não informa vão nulos em vez de zerados,
  // que a tela leria como "custou nada".
  assert.deepEqual(eventos(doCodex, 'fim'), [{ tipo: 'fim', ms: null, custo: null, turnos: null }]);
});

test('linha de controle das três não vira evento nenhum', () => {
  // 'system', 'rate_limit_event', 'thread.started', 'step_start'... nada disso
  // conta o que a IA fez, e cada uma viraria uma linha muda no painel.
  assert.equal(traduzirLinha('claude', '{"type":"system","subtype":"init","cwd":"/x"}').length, 0);
  assert.equal(traduzirLinha('claude', '{"type":"rate_limit_event","rate_limit_info":{}}').length, 0);
  assert.equal(traduzirLinha('codex', '{"type":"thread.started","thread_id":"1"}').length, 0);
  assert.equal(traduzirLinha('codex', '{"type":"turn.started"}').length, 0);
  assert.equal(traduzirLinha('opencode', '{"type":"step_start","part":{"type":"step-start"}}').length, 0);
});

test('linha torta devolve lista vazia e não levanta', () => {
  const tortas = [
    '{',
    '',
    '   ',
    'nao json',
    'null',
    '[1,2]',
    '{"type":"assistant"}',
    '{"type":"assistant","message":{"content":"texto em vez de blocos"}}',
    '{"type":"user","message":{"content":[{"type":"tool_result"}]}}',
    '{"type":"item.completed"}',
    '{"type":"tool_use","part":{"type":"tool"}}',
    undefined,
    null
  ];
  for (const comando of ['claude', 'codex', 'opencode']) {
    for (const linha of tortas) {
      const pecas = traduzirLinha(comando, linha);
      assert.ok(Array.isArray(pecas), `${comando} devolveu algo que não é lista`);
      // Duas exceções propositais: o tool_result sem conteúdo e o item.completed
      // vazio ainda são eventos, só que sem texto. O que não pode é estourar.
      for (const peca of pecas) assert.equal(typeof peca, 'object');
    }
  }
});

test('comando desconhecido volta pro texto puro', () => {
  const linha = readFileSync(
    fileURLToPath(new URL('./amostras/claude.jsonl', import.meta.url)),
    'utf8'
  ).split('\n')[3];
  assert.deepEqual(traduzirLinha('gemini', linha), []);
  assert.deepEqual(traduzirLinha('', linha), []);
});

test('o nome do comando ignora caminho e extensão do Windows', () => {
  assert.equal(nomeDoComando('/usr/local/bin/claude'), 'claude');
  assert.equal(nomeDoComando('C:\\Program Files\\claude.exe'), 'claude');
  assert.equal(nomeDoComando(' Codex '), 'codex');
  // Caminho completo tem que achar a mesma tabela que o nome cru.
  const linha = '{"type":"turn.completed","usage":{}}';
  assert.equal(traduzirLinha('/opt/homebrew/bin/codex', linha).length, 1);
});

// Linhas montadas no formato das amostras, pra cobrir a ferramenta que o pedido
// de teste não fez: escrever, editar, rodar e buscar.
const doAssistente = (nome, entrada) =>
  JSON.stringify({
    type: 'assistant',
    message: { content: [{ type: 'tool_use', id: 'toolu_1', name: nome, input: entrada }] }
  });

test('cada ferramenta vira a ação certa, com título em português', () => {
  const acao = (nome, entrada) => traduzirLinha('claude', doAssistente(nome, entrada), RAIZ)[0].evento;

  assert.deepEqual(acao('Write', { file_path: `${RAIZ}/web/app.js` }), {
    tipo: 'ferramenta',
    id: 'toolu_1',
    acao: 'escrever',
    titulo: 'escreveu web/app.js',
    arquivo: 'web/app.js'
  });
  assert.equal(acao('Edit', { file_path: `${RAIZ}/web/app.js` }).acao, 'editar');
  assert.equal(acao('Grep', { pattern: 'soma' }).titulo, 'buscou soma');
  assert.equal(acao('Glob', { pattern: '**/*.mjs' }).acao, 'buscar');
  assert.equal(acao('WebFetch', { url: 'https://exemplo' }).titulo, 'usou WebFetch');

  const rodou = acao('Bash', { command: 'npm test' });
  assert.equal(rodou.acao, 'rodar');
  assert.equal(rodou.titulo, 'rodou npm test');
  assert.equal(rodou.comando, 'npm test');
});

test('o que a linha de shell faz vale mais que o nome da ferramenta', () => {
  const acao = (comando) => traduzirLinha('claude', doAssistente('Bash', { command: comando }), RAIZ)[0].evento;

  // O mesmo `sed -n` do codex, agora vindo pelo Bash do claude.
  assert.equal(acao("sed -n '1,200p' soma.mjs").acao, 'ler');
  assert.equal(acao('cat web/app.js').titulo, 'leu web/app.js');
  assert.equal(acao('grep -rn "soma" .').titulo, 'buscou soma');
  // Aqui o `cat` escreve: encadeamento e redirecionamento voltam pra 'rodar'.
  assert.equal(acao('cat a.txt > b.txt').acao, 'rodar');
  assert.equal(acao('cat a.txt && rm b.txt').acao, 'rodar');
  // `sed -i` altera o arquivo; só o `-n` é leitura.
  assert.equal(acao("sed -i 's/a/b/' soma.mjs").acao, 'rodar');
});

test('o envoltório de shell do codex sai do título', () => {
  const [peca] = traduzirLinha(
    'codex',
    JSON.stringify({
      type: 'item.started',
      item: { id: 'item_9', type: 'command_execution', command: '/bin/zsh -lc "npm test"', status: 'in_progress' }
    })
  );
  assert.equal(peca.evento.titulo, 'rodou npm test');
  // O campo `comando` guarda a linha inteira: é ela que a pessoa repetiria no
  // terminal pra ver o mesmo resultado.
  assert.equal(peca.evento.comando, '/bin/zsh -lc "npm test"');
});

test('comando que falhou marca a saída como não ok', () => {
  const [peca] = traduzirLinha(
    'codex',
    JSON.stringify({
      type: 'item.completed',
      item: {
        id: 'item_9',
        type: 'command_execution',
        command: 'npm test',
        aggregated_output: '1 falhou',
        exit_code: 1,
        status: 'completed'
      }
    })
  );
  assert.deepEqual(peca.evento, { tipo: 'saida', id: 'item_9', texto: '1 falhou', ok: false });
});

test('o pensamento do modelo chega separado da resposta', () => {
  const pensando = JSON.stringify({
    type: 'stream_event',
    event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'deixa eu ver' } }
  });
  assert.deepEqual(traduzirLinha('claude', pensando), [{ reasoning: 'deixa eu ver' }]);
  assert.equal(raciocinio(doClaudeParcial), '');
});

test('a entrada da ferramenta chegando picada não vira evento', () => {
  // O 'input_json_delta' vem quebrado no meio de uma chave (`{"file_pa`): ler
  // linha a linha daria caminho pela metade. O bloco inteiro vem depois.
  const picado = JSON.stringify({
    type: 'stream_event',
    event: { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"file_pa' } }
  });
  assert.deepEqual(traduzirLinha('claude', picado), []);
});

test('saída comprida é cortada no meio, guardando começo e fim', () => {
  const gigante = `${'a'.repeat(5000)}FIM`;
  const [peca] = traduzirLinha(
    'claude',
    JSON.stringify({
      type: 'user',
      message: { content: [{ tool_use_id: 'toolu_1', type: 'tool_result', content: gigante }] }
    })
  );
  assert.equal(peca.evento.texto.length, 4000);
  assert.ok(peca.evento.texto.startsWith('aaa'));
  assert.ok(peca.evento.texto.endsWith('FIM'));
  assert.ok(peca.evento.texto.includes('\n[...]\n'));
});

test('cortar preserva o começo e o fim, e não mexe no que cabe', () => {
  assert.equal(cortar('curto'), 'curto');
  assert.equal(cortar(''), '');
  assert.equal(cortar(null), '');
  assert.equal(cortar('a'.repeat(4000)).length, 4000);

  const texto = `INICIO${'x'.repeat(200)}FINAL`;
  const cortado = cortar(texto, 40);
  assert.equal(cortado.length, 40);
  assert.ok(cortado.startsWith('INICIO'));
  assert.ok(cortado.endsWith('FINAL'));
  const meio = cortado.indexOf('\n[...]\n');
  assert.ok(meio > 0 && meio < cortado.length - 7, 'a marca fica no meio, não na ponta');
  // O limite absurdo não pode devolver texto maior que ele.
  assert.ok(cortar(texto, 3).length <= 3);
});

test('a tabela de argumentos liga o JSONL das três, e só delas', () => {
  assert.deepEqual(Object.keys(ARGS_ESTRUTURADO).sort(), ['claude', 'codex', 'opencode']);
  for (const nome of Object.keys(ARGS_ESTRUTURADO)) {
    assert.equal(ARGS_ESTRUTURADO[nome].stdin, true, `${nome} manda o pedido pelo stdin`);
    assert.ok(ARGS_ESTRUTURADO[nome].args.length > 0);
  }
  assert.equal(ARGS_ESTRUTURADO.gemini, undefined);

  const claude = ARGS_ESTRUTURADO.claude.args;
  assert.ok(claude.includes('stream-json'));
  // Sem --verbose o claude recusa o stream-json e sai sem escrever nada.
  assert.ok(claude.includes('--verbose'));
  // Sem estas duas o modo code não funciona: a resposta só aparece no fim, e a
  // primeira edição de arquivo trava esperando permissão que ninguém dá.
  assert.ok(claude.includes('--include-partial-messages'));
  assert.equal(claude[claude.indexOf('--permission-mode') + 1], 'acceptEdits');

  assert.ok(ARGS_ESTRUTURADO.codex.args.includes('--json'));
  assert.deepEqual(ARGS_ESTRUTURADO.opencode.args, ['run', '--format', 'json']);
});

test('sem a pasta do projeto o caminho absoluto passa inteiro, e a tela mostra o nome', () => {
  const [peca] = traduzirLinha('claude', doAssistente('Read', { file_path: `${RAIZ}/soma.mjs` }));
  assert.equal(peca.evento.arquivo, `${RAIZ}/soma.mjs`);
  assert.equal(peca.evento.titulo, 'leu soma.mjs');
});

test('arquivo de fora do projeto não vira caminho relativo mentiroso', () => {
  const [peca] = traduzirLinha('claude', doAssistente('Read', { file_path: '/etc/hosts' }), RAIZ);
  assert.equal(peca.evento.arquivo, '/etc/hosts');
  assert.equal(peca.evento.titulo, 'leu hosts');
});
