// Memória compartilhada: o núcleo do produto. O que precisa valer sempre é
// que o fato gravado por um modelo seja recuperável por outro, que fato
// repetido não vire linha nova, e que fixado entre sempre.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers.mjs';

const home = useTempHome();
const { addMemory, recall, listMemories, updateMemory, deleteMemory, renderForPrompt, extractHeuristic } =
  await import('../server/memory.mjs');
const { run } = await import('../server/db.mjs');

after(() => home.cleanup());

test('grava e lista', async () => {
  const row = await addMemory({ text: 'Miguel prefere respostas curtas' });
  assert.ok(row.id);
  assert.equal(row.source, 'manual');
  assert.equal(row.active, 1);
  assert.ok(listMemories().some((m) => m.id === row.id));
});

test('fato repetido não vira linha nova, nem com outra caixa', async () => {
  const antes = listMemories().length;
  const a = await addMemory({ text: 'O domínio do Miguel é nspx.dev' });
  const b = await addMemory({ text: 'o DOMÍNIO do miguel É NSPX.DEV' });
  assert.equal(a.id, b.id, 'o segundo devia ter caído no primeiro');
  assert.equal(listMemories().length, antes + 1);
});

test('texto vazio não grava', async () => {
  assert.equal(await addMemory({ text: '   ' }), null);
  assert.equal(await addMemory({ text: null }), null);
});

test('recall acha por palavra da pergunta', async () => {
  await addMemory({ text: 'Miguel toca guitarra desde os doze anos' });
  const hits = await recall('ele sabe tocar guitarra?');
  assert.ok(hits.some((m) => /guitarra/.test(m.text)), 'devia ter achado o fato da guitarra');
});

test('recall não devolve o banco inteiro pra pergunta sem relação', async () => {
  await addMemory({ text: 'A cor preferida dele é azul' });
  const hits = await recall('qual a capital da Mongólia');
  assert.ok(hits.length < listMemories().length, 'não pode injetar tudo');
});

test('fato fixado entra mesmo sem casar com a pergunta', async () => {
  const pin = await addMemory({ text: 'Responda sempre em português do Brasil', pinned: 1 });
  const hits = await recall('qualquer assunto completamente diferente disso');
  assert.ok(hits.some((m) => m.id === pin.id), 'fixado tem que entrar sempre');
});

test('recall conta o uso', async () => {
  const row = await addMemory({ text: 'Ele usa um teclado ergonômico Kinesis' });
  await recall('teclado ergonômico');
  const depois = listMemories().find((m) => m.id === row.id);
  assert.ok(depois.use_count > 0);
});

test('fato de projeto não vaza pra fora do projeto', async () => {
  run(
    'INSERT INTO projects (id, name, icon, color, instructions, workdir, created_at) VALUES (?,?,?,?,?,?,?)',
    'proj-a', 'Projeto A', 'folder', 'slate', '', null, new Date().toISOString()
  );
  run(
    'INSERT INTO projects (id, name, icon, color, instructions, workdir, created_at) VALUES (?,?,?,?,?,?,?)',
    'proj-b', 'Projeto B', 'folder', 'slate', '', null, new Date().toISOString()
  );
  await addMemory({
    text: 'O servidor de homologação do projeto responde na porta 8443',
    scope: 'project',
    projectId: 'proj-a'
  });

  const dentro = await recall('porta do servidor de homologação', { projectId: 'proj-a' });
  assert.ok(dentro.some((m) => /8443/.test(m.text)), 'no projeto certo tem que aparecer');

  const fora = await recall('porta do servidor de homologação', { projectId: 'proj-b' });
  assert.ok(!fora.some((m) => /8443/.test(m.text)), 'no outro projeto não pode aparecer');
});

test('desativar tira da lista e da recuperação', async () => {
  const row = await addMemory({ text: 'Fato que vai ser desativado sobre xilofones' });
  updateMemory(row.id, { active: false });
  assert.ok(!listMemories().some((m) => m.id === row.id));
  const hits = await recall('xilofones');
  assert.ok(!hits.some((m) => m.id === row.id));
});

test('apagar some do índice de busca também', async () => {
  const row = await addMemory({ text: 'Fato temporário sobre paraquedismo noturno' });
  deleteMemory(row.id);
  const hits = await recall('paraquedismo noturno');
  assert.ok(!hits.some((m) => m.id === row.id), 'o índice FTS tinha que ter sido limpo pelo gatilho');
});

test('bloco do prompt sai vazio sem fatos e nomeado com fatos', () => {
  assert.equal(renderForPrompt([]), '');
  const bloco = renderForPrompt([{ text: 'gosta de café' }]);
  assert.match(bloco, /O que você já sabe sobre esta pessoa/);
  assert.match(bloco, /- gosta de café/);
});

// ------------------------------------------------------------- heurística

test('heurística pega identidade e preferência em português', () => {
  const fatos = extractHeuristic('Oi, me chamo Miguel Moretti e eu gosto de café sem açúcar.');
  assert.ok(fatos.some((f) => /me chamo Miguel/i.test(f)));
  assert.ok(fatos.some((f) => /gosto de café/i.test(f)));
});

test('heurística não devolve fato contido em outro fato', () => {
  const fatos = extractHeuristic('eu gosto de cafe sem acucar e trabalho com Node');
  const contido = fatos.some((a) => fatos.some((b) => a !== b && b.toLowerCase().includes(a.toLowerCase())));
  assert.equal(contido, false, 'não pode sobrar fato que já está dentro de outro');
});

test('heurística ignora pergunta comum', () => {
  assert.deepEqual(extractHeuristic('qual é a capital da França?'), []);
  assert.deepEqual(extractHeuristic('me explica como funciona o FTS5'), []);
});

test('pergunta que casa com o padrão de fato não vira memória', () => {
  // Rodando de verdade: perguntar "qual o nome do meu gato e onde eu moro?"
  // para uma IA gravava o fato "meu gato e onde eu moro", que passava a valer
  // pra todas as outras. Ninguém tinha dito nada — só perguntado.
  assert.deepEqual(extractHeuristic('Qual o nome do meu gato e onde eu moro?'), []);
  assert.deepEqual(extractHeuristic('Você sabe qual meu projeto favorito?'), []);
  assert.deepEqual(extractHeuristic('onde eu moro fica longe do centro?'), []);
  assert.deepEqual(extractHeuristic('where do i live'), []);
  // A afirmação equivalente continua entrando.
  assert.deepEqual(extractHeuristic('meu gato se chama Farofa'), ['meu gato se chama Farofa']);
});

test('heurística pega fato nos três idiomas da interface', () => {
  // O app fala português, inglês e espanhol, e a memória sem extrator é o caso
  // comum (o extrator custa uma chamada de modelo por turno). Enquanto os
  // padrões eram quase só de português, quem usava em espanhol nunca via a
  // memória encher — a promessa da primeira tela não valia pra ele.
  const pt = extractHeuristic('Estou construindo o Nuvo, um app de IA.');
  assert.ok(pt.some((f) => /construindo o Nuvo/i.test(f)), `pt: ${JSON.stringify(pt)}`);

  const en = extractHeuristic("I'm building Nuvo, and I prefer short answers.");
  assert.ok(en.some((f) => /building Nuvo/i.test(f)), `en: ${JSON.stringify(en)}`);
  assert.ok(en.some((f) => /prefer short answers/i.test(f)), `en: ${JSON.stringify(en)}`);

  const es = extractHeuristic('Estoy construyendo Nuvo. Me gusta el café sin azúcar.');
  assert.ok(es.some((f) => /construyendo Nuvo/i.test(f)), `es: ${JSON.stringify(es)}`);
  assert.ok(es.some((f) => /gusta el caf/i.test(f)), `es: ${JSON.stringify(es)}`);
});

test('negação e pergunta valem nos três idiomas', () => {
  // O oposto do que foi dito é pior que fato nenhum: memória é permanente e
  // vale pra todas as IAs. E `no` (espanhol) não casava com o `n[ãa]o` que
  // existia — "No me gusta el café" gravava "gosto de café".
  assert.deepEqual(extractHeuristic('No me gusta el café.'), []);
  assert.deepEqual(extractHeuristic("I don't like coffee."), []);
  // "Nunca me chame de X" é instrução, não negação de fato — em espanhol
  // também. É o mesmo caso que o teste do português já trava.
  assert.deepEqual(extractHeuristic('Nunca me llames por el apellido.'), [
    'Nunca me llames por el apellido'
  ]);

  // Pergunta em espanhol abre com `¿`, que não é letra — o `\b` do fim do
  // padrão de interrogativa não casava depois dele.
  assert.deepEqual(extractHeuristic('¿Cómo se llama mi gato?'), []);
  assert.deepEqual(extractHeuristic('Cuál es mi proyecto?'), []);
  assert.deepEqual(extractHeuristic('What is my project called?'), []);
});

test('pergunta antes não engole o fato que vem depois', () => {
  const fatos = extractHeuristic('Qual a capital da França? eu moro em Curitiba');
  assert.deepEqual(fatos, ['eu moro em Curitiba']);
});

test('heurística funciona em inglês também', () => {
  const fatos = extractHeuristic('my name is Miguel and i love working late at night');
  assert.ok(fatos.length > 0);
});

test('caractere especial de consulta FTS não quebra a busca', async () => {
  await addMemory({ text: 'Ele usa aspas "duplas" no código' });
  const hits = await recall('aspas "duplas" AND OR NOT * ^ :');
  assert.ok(Array.isArray(hits), 'a busca tem que sobreviver a sintaxe de FTS na pergunta');
});

test('ponto de endereço e de número não corta o fato no meio', () => {
  const fatos = extractHeuristic('Meu nome é Miguel e meu domínio é nspx.dev. Responda só: anotado.');
  assert.ok(
    fatos.some((f) => f.includes('nspx.dev')),
    `o domínio tinha que sobreviver inteiro, veio: ${JSON.stringify(fatos)}`
  );
  assert.ok(!fatos.some((f) => /Responda só/.test(f)), 'a frase seguinte não entra no fato');
});

test('versão com decimal não vira número truncado', () => {
  const fatos = extractHeuristic('Eu prefiro o Node 22.5 pra tudo. O resto tanto faz.');
  assert.ok(fatos.some((f) => f.includes('22.5')), JSON.stringify(fatos));
  assert.ok(!fatos.some((f) => /tanto faz/.test(f)));
});

test('ponto final continua terminando a frase', () => {
  const fatos = extractHeuristic('Eu moro em Florianópolis. Eu gosto de café.');
  assert.ok(fatos.some((f) => /Florian[oó]polis$/.test(f)), JSON.stringify(fatos));
  assert.ok(fatos.some((f) => /café$/.test(f)), JSON.stringify(fatos));
});

test('negação não vira o fato do avesso', () => {
  // Os padrões começam no verbo, então "não gosto de café" casava a partir de
  // "gosto" e a memória gravava exatamente o contrário do que foi dito. Como a
  // memória é compartilhada e permanente, o erro não fica na conversa: passa a
  // valer para todo modelo, em toda conversa seguinte.
  for (const frase of [
    'eu não gosto de café',
    'não gosto de reuniões longas',
    'eu não moro em São Paulo',
    'nunca gosto de ser interrompido',
    'jamais trabalho com PHP',
    'não estou construindo nada disso',
    'i do not like long meetings'
  ]) {
    assert.deepEqual(extractHeuristic(frase), [], frase);
  }
});

test('negação distante não cala a frase inteira', () => {
  // Só o "não" colado no verbo nega. "não sei" mais adiante não pode apagar o
  // fato que veio antes dele.
  const fatos = extractHeuristic('Eu gosto de café. Não sei se isso importa.');
  assert.ok(fatos.some((f) => /café$/.test(f)), JSON.stringify(fatos));
});

test('"nunca me mande X" continua sendo instrução, não negação', () => {
  // Aqui o "nunca" é o começo do próprio padrão: é o fato, não o que o anula.
  assert.deepEqual(extractHeuristic('nunca me mande emojis'), ['nunca me mande emojis']);
});

test('projeto em andamento vira fato', () => {
  // Quem conversa com estas IAs diz o que está construindo, e isso continua
  // valendo daqui a meses — era exatamente o tipo de frase que a heurística
  // deixava passar quando não há modelo extrator configurado.
  const fatos = extractHeuristic('Estou construindo o Nuvo, um app que roda no servidor de casa.');
  assert.ok(fatos.some((f) => /Nuvo/.test(f)), JSON.stringify(fatos));
});

test('memória fixada não engole a busca', async () => {
  // Fixar quer dizer "isto sempre entra", não "só isto entra". Com o teto de 12
  // memórias injetadas e doze recados fixados, a busca sumia inteira e sem
  // aviso nenhum: um fato que casa palavra por palavra deixava de chegar ao
  // modelo, e a tela continuava dizendo que a memória estava ligada.
  await addMemory({ text: 'Meu domínio é nspx.dev e o painel fica em /admin.html', kind: 'fact' });
  for (let i = 0; i < 12; i++) {
    await addMemory({ text: `Recado fixado número ${i}, nada a ver com domínio`, kind: 'note', pinned: 1 });
  }

  const out = await recall('qual é o meu domínio');
  assert.ok(
    out.some((m) => /nspx\.dev/.test(m.text)),
    `a busca foi engolida pelos fixados: ${out.map((m) => m.text.slice(0, 20))}`
  );
  // E os fixados continuam entrando — o conserto reparte, não troca um pelo outro.
  assert.ok(out.filter((m) => m.pinned).length >= 6, 'os fixados perderam o lugar');
});

test('sem resultado de busca, o fixado ocupa o orçamento inteiro', async () => {
  // O outro lado do mesmo conserto: reservar espaço pra busca não pode virar
  // espaço desperdiçado quando não há o que buscar.
  for (let i = 0; i < 12; i++) {
    await addMemory({ text: `Lembrete fixado ${i} sobre assunto totalmente distinto`, kind: 'note', pinned: 1 });
  }
  const out = await recall('xilofone berimbau capivara');
  assert.equal(out.length, 12, `voltaram ${out.length} — sobrou orçamento sem motivo`);
});
