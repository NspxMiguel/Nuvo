// Medir a máquina e recomendar modelo é conselho que a pessoa vai seguir: se a
// leitura explodir, a tela "IAs ligadas" não abre; se a conta errar, ela baixa
// 20 GB pra ver o computador travar. Os dois casos são testados aqui, e a
// máquina de verdade nunca é usada como referência — só máquinas encenadas,
// senão o teste passa neste Mac e falha no notebook de 8 GB.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers.mjs';

const home = useTempHome();
const {
  readMachine,
  forgetMachine,
  recommendModels,
  classificarCabe,
  orcamento,
  folgaMaxGb,
  CATALOGO
} = await import('../server/machine.mjs');
const { run, uid, now } = await import('../server/db.mjs');
const { createProvider } = await import('../server/providers/index.mjs');

after(() => home.cleanup());

const GB = 1024 ** 3;

/** Máquina encenada: só o que a regra do "cabe" olha. */
const maquina = (ramGb, vramGb = 0) => ({ ram_total: ramGb * GB, gpu_vram: vramGb * GB });

/** Comando do sistema que morre, do jeito que o execFileSync morre. */
function explode(mensagem = 'spawn ENOENT') {
  return () => {
    throw new Error(mensagem);
  };
}

/** Cadastra um Ollama com os modelos indicados já no catálogo do banco. */
function ollamaCom(...modelos) {
  run('DELETE FROM providers');
  const provedor = createProvider({
    name: 'Ollama',
    kind: 'ollama',
    baseUrl: 'http://127.0.0.1:11434'
  });
  for (const modelo of modelos) {
    run(
      'INSERT INTO models (id, provider_id, model_id, label, kind, seen_at) VALUES (?, ?, ?, ?, ?, ?)',
      uid(),
      provedor.id,
      modelo,
      modelo,
      'chat',
      now()
    );
  }
  return provedor;
}

// ------------------------------------------------------- ler a máquina

test('a leitura não explode quando o comando de GPU falha', () => {
  const lida = readMachine({ exec: explode() });
  assert.ok(lida.ram_total > 0, 'a RAM vem do node:os, não do comando');
  assert.equal(lida.gpu_vram, 0, 'sem resposta do comando, VRAM desconhecida vale zero');
  assert.ok(lida.cores >= 1);
  assert.equal(typeof lida.chip, 'string');
  assert.ok(lida.chip.length > 0, 'sempre sobra um nome pra mostrar no cartão');
  assert.ok(lida.ram_livre >= 0 && lida.ram_livre <= lida.ram_total);
});

test('comando que estoura o prazo também não derruba a leitura', () => {
  const erro = new Error('ETIMEDOUT');
  erro.code = 'ETIMEDOUT';
  const lida = readMachine({
    exec: () => {
      throw erro;
    }
  });
  assert.ok(lida.ram_total > 0);
  assert.equal(lida.gpu_vram, 0);
});

test('comando que devolve lixo em vez de JSON não vira VRAM inventada', () => {
  const lida = readMachine({ exec: () => 'isto não é json {{{' });
  assert.equal(lida.gpu_vram, 0);
  assert.ok(lida.ram_total > 0);
});

test('arquivo de sistema ilegível não derruba a leitura', () => {
  // No Linux a leitura passa pelo /proc; container sem /proc montado existe.
  const lida = readMachine({ exec: explode(), ler: explode('EACCES') });
  assert.ok(lida.ram_total > 0);
  assert.ok(lida.cores >= 1);
});

test('a leitura devolve todos os campos que a tela pede', () => {
  const lida = readMachine();
  for (const campo of ['ram_total', 'ram_livre', 'chip', 'cores', 'plataforma', 'arch', 'gpu_vram']) {
    assert.ok(campo in lida, `faltou ${campo}`);
  }
  assert.equal(typeof lida.ram_total, 'number');
  assert.equal(typeof lida.gpu_vram, 'number');
  assert.equal(lida.plataforma, process.platform);
  assert.equal(lida.arch, process.arch);
});

test('leitura encenada não contamina a medição de verdade', () => {
  forgetMachine();
  const verdade = readMachine();
  // Uma placa inventada que só existe dentro deste teste. Se o cache guardasse
  // o que veio do exec encenado, a próxima leitura sairia mentindo.
  readMachine({
    exec: () =>
      JSON.stringify({
        SPDisplaysDataType: [{ sppci_model: 'Placa Inventada', spdisplays_vram: '48 GB' }]
      })
  });
  const depois = readMachine();
  assert.equal(depois.chip, verdade.chip);
  assert.equal(depois.cores, verdade.cores);
  assert.equal(depois.gpu_vram, verdade.gpu_vram);
  assert.notEqual(depois.gpu, 'Placa Inventada');
});

test('a memória livre é relida a cada chamada, não fica no cache', () => {
  forgetMachine();
  const primeira = readMachine();
  const segunda = readMachine();
  // O que não muda tem que sair igual...
  assert.equal(segunda.chip, primeira.chip);
  assert.equal(segunda.ram_total, primeira.ram_total);
  // ...e o que muda tem que ser um número plausível toda vez.
  assert.ok(segunda.ram_livre > 0 && segunda.ram_livre <= segunda.ram_total);
});

test('em memória compartilhada a VRAM é zero e a conta corre pela RAM', {
  skip: process.platform !== 'darwin' || process.arch !== 'arm64'
}, () => {
  const lida = readMachine();
  assert.equal(lida.memoria_compartilhada, true);
  assert.equal(lida.gpu_vram, 0, 'Apple Silicon não tem VRAM separada pra somar');
  assert.equal(orcamento(lida), orcamento({ ram_total: lida.ram_total, gpu_vram: 0 }));
});

// ------------------------------------------------------- a regra do "cabe"

test('a regra do cabe classifica certo nos três casos', () => {
  // 32 GB: reserva 6,4 → orçamento 25,6 GB; folga até 70% dele.
  const grande = maquina(32);
  assert.equal(classificarCabe(4.9, grande), 'folga', '5 GB numa máquina de 32 sobra espaço');
  assert.equal(classificarCabe(17, grande), 'aperto', 'entra, mas toma quase tudo');
  assert.equal(classificarCabe(43, grande), 'nao', 'passa do orçamento inteiro');
});

test('o mesmo modelo muda de veredito conforme a máquina', () => {
  const modelo = 8.1;
  assert.equal(classificarCabe(modelo, maquina(32)), 'folga');
  assert.equal(classificarCabe(modelo, maquina(16)), 'aperto');
  assert.equal(classificarCabe(modelo, maquina(8)), 'nao');
});

test('a fronteira entre folga e aperto é a mesma que o cartão promete', () => {
  const m = maquina(32);
  const teto = folgaMaxGb(m);
  assert.ok(teto > 0);
  assert.equal(classificarCabe(teto, m), 'folga', 'o número do cartão tem que caber com folga');
  assert.notEqual(classificarCabe(teto + 2, m), 'folga', 'e logo acima dele não');
});

test('máquina minúscula não libera nada além do embedding', () => {
  const fraca = maquina(2);
  assert.equal(classificarCabe(4.9, fraca), 'nao');
  assert.equal(orcamento(fraca), 0, 'a reserva do sistema come a máquina inteira');
  assert.equal(folgaMaxGb(fraca), 0);
});

test('placa de vídeo dedicada aumenta o orçamento', () => {
  const semPlaca = maquina(8);
  const comPlaca = maquina(8, 24);
  assert.equal(classificarCabe(9, semPlaca), 'nao');
  assert.equal(classificarCabe(9, comPlaca), 'folga', 'o modelo mora na VRAM, não na RAM');
  assert.ok(orcamento(comPlaca) > orcamento(semPlaca));
});

test('tamanho ausente ou máquina sem leitura viram "nao", nunca um chute', () => {
  assert.equal(classificarCabe(undefined, maquina(32)), 'nao');
  assert.equal(classificarCabe(0, maquina(32)), 'nao');
  assert.equal(classificarCabe(4, {}), 'nao');
  assert.equal(classificarCabe(4, null), 'nao');
});

// ------------------------------------------------------- o catálogo

test('o catálogo não tem id repetido', () => {
  const vistos = new Set();
  for (const modelo of CATALOGO) {
    assert.ok(!vistos.has(modelo.id), `id repetido: ${modelo.id}`);
    vistos.add(modelo.id);
  }
  assert.equal(vistos.size, CATALOGO.length);
});

test('todo modelo diz pra que serve e por que ele e não outro', () => {
  for (const modelo of CATALOGO) {
    assert.equal(typeof modelo.pra_que, 'string', `${modelo.id} sem pra_que`);
    assert.ok(modelo.pra_que.trim().length > 0, `${modelo.id} com pra_que vazio`);
    assert.equal(typeof modelo.compara, 'string', `${modelo.id} sem compara`);
    assert.ok(modelo.compara.trim().length > 0, `${modelo.id} com compara vazio`);
  }
});

test('todo modelo tem os campos que a tela desenha', () => {
  for (const modelo of CATALOGO) {
    assert.equal(typeof modelo.id, 'string');
    assert.ok(modelo.nome_legivel && modelo.nome_legivel !== modelo.id, `${modelo.id} sem nome de gente`);
    assert.equal(typeof modelo.gb, 'number');
    assert.ok(modelo.gb > 0, `${modelo.id} sem tamanho`);
    assert.ok(modelo.familia && typeof modelo.familia === 'string');
  }
});

test('a comparação cita outro modelo da própria lista', () => {
  for (const modelo of CATALOGO) {
    const outros = CATALOGO.filter((m) => m.id !== modelo.id);
    assert.ok(
      outros.some((outro) => modelo.compara.includes(outro.nome_legivel)),
      `o "por que este e não aquele" de ${modelo.id} não nomeia nenhum aquele`
    );
  }
});

test('o catálogo cobre de 1 GB a 40 GB e várias famílias', () => {
  assert.ok(CATALOGO.length >= 8);
  assert.ok(CATALOGO.some((m) => m.gb <= 1.5), 'falta opção pra computador fraco');
  assert.ok(CATALOGO.some((m) => m.gb >= 40), 'falta opção pra máquina grande');
  const familias = new Set(CATALOGO.map((m) => m.familia));
  assert.ok(familias.size >= 5, 'catálogo de uma família só é catálogo de um fabricante só');
});

// ------------------------------------------------------- a recomendação

test('a recomendação devolve o catálogo inteiro com veredito em cada item', () => {
  ollamaCom();
  const lista = recommendModels(maquina(16));
  assert.equal(lista.length, CATALOGO.length);
  for (const modelo of lista) {
    assert.ok(['folga', 'aperto', 'nao'].includes(modelo.cabe), `veredito estranho: ${modelo.cabe}`);
    assert.equal(typeof modelo.instalado, 'boolean');
  }
  assert.ok(lista.some((m) => m.cabe === 'folga'));
  assert.ok(lista.some((m) => m.cabe === 'nao'), 'numa máquina de 16 GB o 70B não pode caber');
});

test('modelo já baixado vem marcado como instalado', () => {
  ollamaCom('llama3.1:8b');
  const lista = recommendModels(maquina(32));
  const achado = lista.find((m) => m.id === 'llama3.1:8b');
  assert.equal(achado.instalado, true);
  assert.equal(lista.filter((m) => m.instalado).length, 1, 'só o que está no banco');
});

test('quantização e :latest contam como o mesmo modelo baixado', () => {
  ollamaCom('llama3.1:8b-instruct-q4_K_M', 'nomic-embed-text:latest');
  const lista = recommendModels(maquina(32));
  assert.equal(lista.find((m) => m.id === 'llama3.1:8b').instalado, true);
  assert.equal(lista.find((m) => m.id === 'nomic-embed-text').instalado, true);
});

test('modelo de provedor que não é Ollama não conta como baixado', () => {
  run('DELETE FROM providers');
  const provedor = createProvider({
    name: 'LM Studio',
    kind: 'openai',
    baseUrl: 'http://127.0.0.1:1234/v1'
  });
  run(
    'INSERT INTO models (id, provider_id, model_id, label, kind, seen_at) VALUES (?, ?, ?, ?, ?, ?)',
    uid(),
    provedor.id,
    'llama3.1:8b',
    'llama3.1:8b',
    'chat',
    now()
  );
  const lista = recommendModels(maquina(32));
  assert.equal(
    lista.find((m) => m.id === 'llama3.1:8b').instalado,
    false,
    'o botão de baixar é do Ollama; catálogo de outro provedor não substitui'
  );
});

test('o que já está baixado aparece primeiro, mesmo sem caber', () => {
  ollamaCom('llama3.3:70b');
  const lista = recommendModels(maquina(8));
  assert.equal(lista[0].id, 'llama3.3:70b');
  assert.equal(lista[0].instalado, true);
  assert.equal(lista[0].cabe, 'nao');
});

test('sem nada baixado, o maior que cabe com folga lidera', () => {
  ollamaCom();
  const lista = recommendModels(maquina(32));
  assert.equal(lista[0].cabe, 'folga');
  const folga = lista.filter((m) => m.cabe === 'folga');
  for (let i = 1; i < folga.length; i += 1) {
    assert.ok(folga[i - 1].gb >= folga[i].gb, 'dentro do que cabe, o maior vem antes');
  }
  const naoCabem = lista.filter((m) => m.cabe === 'nao');
  for (let i = 1; i < naoCabem.length; i += 1) {
    assert.ok(naoCabem[i - 1].gb <= naoCabem[i].gb, 'no que não cabe, quem faltou pouco vem antes');
  }
  const vereditos = lista.map((m) => m.cabe);
  assert.deepEqual(
    [...vereditos].sort((a, b) => ({ folga: 0, aperto: 1, nao: 2 })[a] - ({ folga: 0, aperto: 1, nao: 2 })[b]),
    vereditos,
    'folga, depois aperto, depois o que não cabe'
  );
});

test('a recomendação não muda o catálogo original', () => {
  ollamaCom('llama3.1:8b');
  recommendModels(maquina(32));
  for (const modelo of CATALOGO) {
    assert.ok(!('cabe' in modelo), `${modelo.id} foi contaminado com veredito`);
    assert.ok(!('instalado' in modelo), `${modelo.id} foi contaminado com instalado`);
  }
});

test('sem argumento, a recomendação mede a máquina de verdade sozinha', () => {
  ollamaCom();
  const lista = recommendModels();
  assert.equal(lista.length, CATALOGO.length);
  assert.ok(lista.every((m) => typeof m.cabe === 'string'));
});

test('a rota /machine entrega máquina e modelos juntos', async () => {
  // A tela de IAs ligadas abre com o cartão da máquina e a lista do que cabe.
  // Se a rota devolver um sem o outro, a tela monta pela metade.
  const { startServer } = await import('./helpers.mjs');
  const app = await startServer();
  try {
    const r = await app.api('/machine');
    assert.equal(r.status, 200);
    for (const campo of ['ram_total', 'chip', 'plataforma', 'modelos']) {
      assert.ok(r.data[campo] !== undefined, `faltou ${campo}`);
    }
    assert.ok(r.data.modelos.length >= 8, `só ${r.data.modelos.length} modelos`);
    for (const m of r.data.modelos) {
      assert.ok(['folga', 'aperto', 'nao'].includes(m.cabe), `cabe inválido: ${m.cabe}`);
      assert.ok(m.pra_que && m.compara, `${m.id} sem texto de conselho`);
    }
  } finally {
    await app.close?.();
  }
});
