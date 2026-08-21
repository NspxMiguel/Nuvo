// Guardas do que a tela promete e o código tinha deixado sem ligar.
//
// Cada teste aqui nasceu de um clique que não fez nada: o seletor de idioma que
// não existia, a lista de conversas espremida em 54px, o botão de chave numa IA
// que não tem chave. São regras baratas de conferir e caras de descobrir na mão.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const ler = (caminho) => readFileSync(join(RAIZ, caminho), 'utf8');

test('dá pra trocar o idioma pela tela', () => {
  // `trocarIdioma` e `NOMES` ficaram exportados e sem uma única chamada: os
  // dois dicionários só apareciam se o navegador ou o lugar já casassem.
  const views = ler('web/views.js');
  assert.match(views, /trocarIdioma/, 'a tela chama trocarIdioma');
  assert.match(views, /id="s-idioma"/, 'o computador tem um seletor de idioma');
  assert.match(views, /data-mob="idioma"/, 'o celular tem a linha de idioma');
});

test('nenhuma função de idioma fica sem quem a chame', () => {
  // `trocarIdioma` passou meses exportada e sem uma chamada, e o app inteiro
  // ficou sem seletor de idioma sem que nada acusasse. `formatarData` estava no
  // mesmo estado, enquanto a lista de cópias mostrava o ISO cru.
  const i18n = ler('web/i18n.js');
  const exportadas = [...i18n.matchAll(/export (?:async )?function (\w+)/g)].map((m) => m[1]);
  const resto = readdirSync(join(RAIZ, 'web'))
    .filter((n) => n.endsWith('.js') && n !== 'i18n.js')
    .map((n) => ler(join('web', n)))
    .join('\n');
  const orfas = exportadas.filter((nome) => !new RegExp(`\\b${nome}\\b`).test(resto));
  assert.deepEqual(orfas, [], 'função de idioma exportada e nunca chamada');
});

test('o menu cede espaço antes da lista de conversas', () => {
  // Com o "Mais" aberto o menu passa de 480px numa gaveta `overflow: hidden`.
  // Sem estas duas regras a lista sobrava com 54px e não rolava em canto nenhum.
  const css = ler('web/styles.css');
  const foraDeMedia = css.split('@media')[0];
  assert.match(foraDeMedia, /#sidebar nav \{[^}]*overflow-y: auto/, 'o menu rola sozinho');
  assert.match(foraDeMedia, /#sidebar nav \{[^}]*flex: 0 3 auto/, 'e encolhe antes da lista');
  const piso = /#chat-list \{[^}]*flex: 1 1 (\d+)px/.exec(foraDeMedia);
  assert.ok(piso, 'a lista de conversas tem um piso declarado');
  assert.ok(Number(piso[1]) >= 200, `piso de ${piso[1]}px é pouco pra uma lista de conversas`);
});

test('o nome da conversa não vaza pras outras telas', () => {
  const app = ler('web/app.js');
  assert.match(
    app,
    /state\.view === 'chat' \? state\.chats\.find/,
    'o título do topo só sai da conversa quando a tela é a conversa'
  );
  assert.match(app, /renderTopbar\(\);\n  const pintado = renderView\(\)/, 'e a barra repinta ao trocar de tela');
});

test('IA de terminal não ganha botão de chave', () => {
  const views = ler('web/views.js');
  const trecho = views.slice(views.indexOf('data-act="refresh"'), views.indexOf('data-act="toggle"'));
  assert.match(trecho, /p\.kind === 'cli'/, 'o botão de chave olha o tipo da IA antes de aparecer');
});

test('a resposta pendente ocupa o lugar dela na tela', () => {
  // A tela ficava parada entre o enviar e a primeira palavra: a bolha da pessoa
  // à direita e nada embaixo. O único sinal de vida era o botão de parar.
  const app = ler('web/app.js');
  assert.match(app, /function abrirEspera\(/, 'existe a bolha de espera');
  assert.match(app, /function fecharEspera\(/, 'e ela sabe sair');
  assert.match(app, /const espera = abrirEspera\(\)/, 'o turno abre a espera ao começar');
  assert.match(
    app,
    /fecharEspera\(espera, \{ apagar: !el \}\)/,
    'turno que morre antes da primeira palavra não deixa roseta girando'
  );
  const css = ler('web/styles.css');
  assert.match(css, /\.msg\.esperando \.stats/, 'a espera não mostra números que ainda não existem');
  assert.match(css, /@keyframes respira/, 'e o texto respira em vez de ficar morto');
});

test('descer a conversa não pega carona no scroll suave do CSS', () => {
  // `#messages` tem `scroll-behavior: smooth` — bom pro `scrollIntoView` de abrir
  // uma mensagem, péssimo enquanto a resposta chega: a animação era cortada a
  // cada pedaço de texto e a conversa parava a 38px de 310 do fim, com a bolha de
  // espera nascendo abaixo da dobra. E metade de uma mensagem ganha altura depois
  // da rolagem (botões, linha de números, imagem que carregou): daí o vigia.
  const css = ler('web/styles.css');
  assert.match(css, /#messages[\s\S]{0,300}?scroll-behavior: smooth/, 'o CSS ainda é suave');
  const app = ler('web/app.js');
  const corpo = app.slice(app.indexOf('function scrollDown('), app.indexOf('function vigiarOFim('));
  assert.match(corpo, /behavior: 'instant'/, 'descer ao fim é seco');
  assert.match(app, /function vigiarOFim\(/, 'alguém segura o fim quando o conteúdo cresce depois');
  assert.match(app, /^vigiarOFim\(\);$/m, 'e o vigia é ligado no boot');
});

test('o menu sai da configuração, não do HTML cravado', () => {
  // A ordem e o agrupamento moravam em dois lugares: a marcação do index.html e
  // uma constante no app.js. Mexer num sem o outro deixava a gaveta mentindo.
  const app = ler('web/app.js');
  assert.match(app, /function aplicarMenu\(/, 'existe quem aplique a configuração na gaveta');
  assert.doesNotMatch(app, /const DENTRO_DE_MAIS = \[/, 'o agrupamento não é mais constante');
  assert.match(app, /menuAtual\(\)\.noMais\.includes\(view\)/, 'o "Mais" abre pelo que está configurado');
  // Os botões continuam no HTML: é de lá que a varredura de tradução tira as
  // frases, e é lá que eles existem antes de o JavaScript rodar.
  const html = ler('web/index.html');
  for (const tela of ['chat', 'estudos', 'code', 'loja']) {
    assert.match(html, new RegExp(`data-view="${tela}"`), `${tela} tem botão no HTML`);
  }
  const views = ler('web/views.js');
  assert.match(views, /\['menu', 'layers'/, 'a seção de ajustes existe na trilha');
});

test('esconder uma tela não pode deixar a gaveta sem saída', async () => {
  // Conversas é o caminho de volta. Se ela pudesse sumir junto com o resto, a
  // única forma de desfazer seria mexer no config.json na mão.
  const { limparMenu } = await import('../server/api.mjs');
  const fora = limparMenu({ escondidos: ['chat', 'loja', 'inventada'], ordem: ['loja'], noMais: ['gems'] });
  assert.deepEqual(fora.escondidos, ['loja'], 'Conversas não entra em escondidos, e tela inventada some');
  assert.equal(fora.ordem[0], 'loja', 'a ordem pedida vale');
  assert.ok(fora.ordem.includes('estudos'), 'tela que a tela não citou entra no fim, não some');
  assert.deepEqual(fora.noMais, ['gems']);
  assert.equal(limparMenu(null), null, 'sem configuração, vale o padrão');
});

test('conversa aberta não fica acesa fora da tela de conversa', () => {
  // Ele abriu Estudos e a conversa "teste" continuava azul na lista: duas
  // coisas selecionadas ao mesmo tempo, e nenhuma delas dizendo onde ele está.
  const app = ler('web/app.js');
  assert.match(
    app,
    /chat\.id === state\.chatId && state\.view === 'chat'/,
    'a linha só nasce acesa quando a tela é a conversa'
  );
  assert.match(
    app,
    /view === 'chat' && linha\.dataset\.id === state\.chatId/,
    'e apaga ao trocar de tela, sem precisar redesenhar a lista'
  );
});

test('"editar e reenviar" substitui em vez de duplicar', () => {
  // Antes isto só copiava o texto pro campo: mandar de novo criava um turno novo
  // e a pergunta antiga ficava na conversa, com a resposta que ela já tinha —
  // e o modelo lia a errada no histórico.
  const app = ler('web/app.js');
  const trecho = app.slice(app.indexOf("add('edit'"), app.indexOf("add('trash'"));
  assert.match(trecho, /method: 'DELETE'/, 'a fala antiga sai do banco');
  assert.match(trecho, /nextElementSibling/, 'e a resposta que veio dela também');
  assert.match(trecho, /el\.remove\(\)/, 'e as duas somem da tela');
});

test('trocar o modo do conselho apaga o resultado anterior', () => {
  // A síntese de "uma resposta só" ficava embaixo do modo "elas votam", como se
  // fosse a votação daquela pergunta.
  const views = ler('web/views.js');
  assert.match(views, /function limparResultado\(\)/, 'existe quem limpe');
  assert.match(views, /if \(mudou\) limparResultado\(\)/, 'e trocar de modo limpa');
});

test('o rodapé da memória sobrevive a recarregar a conversa', () => {
  // "usei 2 coisas que já sei sobre você" é a prova de que a memória
  // compartilhada agiu — e era a coisa mais volátil da tela: existia só enquanto
  // a resposta chegava, e recarregar apagava.
  const chat = ler('server/chat.mjs');
  assert.match(chat, /memoria: memories\.length/, 'o turno grava o que a memória entregou');
  const app = ler('web/app.js');
  assert.match(app, /meta\.memoria\?\.length/, 'e o histórico redesenha o rodapé');
});
