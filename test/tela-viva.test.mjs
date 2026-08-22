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

/**
 * O CSS sem os blocos `@media`, contando chave por chave.
 *
 * Cortar no primeiro `@media` era mais curto e passou a mentir no dia em que um
 * `@media` entrou perto do topo: o resto do arquivo sumiu junto e regras que
 * existem apareceram como ausentes.
 */
function semMedia(css) {
  let fora = '';
  for (let i = 0; i < css.length; i += 1) {
    if (!css.startsWith('@media', i)) {
      fora += css[i];
      continue;
    }
    const abre = css.indexOf('{', i);
    if (abre < 0) break;
    let nivel = 0;
    let j = abre;
    for (; j < css.length; j += 1) {
      if (css[j] === '{') nivel += 1;
      else if (css[j] === '}' && (nivel -= 1) === 0) break;
    }
    i = j;
  }
  return fora;
}

test('o menu cede espaço antes da lista de conversas', () => {
  // Com o "Mais" aberto o menu passa de 480px numa gaveta `overflow: hidden`.
  // Sem estas duas regras a lista sobrava com 54px e não rolava em canto nenhum.
  const css = ler('web/styles.css');
  const foraDeMedia = semMedia(css);
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

test('parar fecha a bolha de espera na hora', () => {
  // O `finally` do turno só roda quando o stream termina de verdade, e um CLI
  // pode levar treze segundos pra morrer. Nesse tempo a roseta continuava
  // girando como se o "parar" não tivesse sido apertado.
  const app = ler('web/app.js');
  assert.match(app, /function pararEspera\(\)/, 'existe quem feche na hora');
  const stop = app.slice(app.indexOf("$('#btn-stop').onclick"), app.indexOf("$('#btn-stop').onclick") + 160);
  assert.match(stop, /pararEspera\(\)/, 'o botão de parar fecha antes de abortar');
  assert.match(app, /pararEspera\(\);\n    state\.streaming\.abort\(\)/, 'e o Esc também');
});

test('dá pra arquivar e desarquivar, não só ver arquivadas', () => {
  // A gaveta mostrava "ver arquivadas" e o servidor já sabia arquivar, mas não
  // havia ação em lugar nenhum: era uma lista onde nada entrava e de onde nada
  // saía.
  const app = ler('web/app.js');
  assert.match(app, /async function arquivarConversa\(/, 'existe a ação');
  assert.match(app, /label: t\('Arquivar esta conversa'\)/, 'alcançável pela paleta');
  assert.match(app, /data-act=unarchive/, 'e a volta fica na própria linha da arquivada');
});

test('a busca dos ajustes procura dentro das seções', () => {
  // Procurar "foto" não achava nada, embora "Quem lê foto" esteja em IAs
  // ligadas: a busca só olhava o nome das seções.
  const views = ler('web/views.js');
  assert.match(views, /const dentroDaSecao = new Map\(\)/, 'o conteúdo de cada seção é indexado');
  assert.match(views, /corpo\.includes\(alvo\)/, 'e entra na comparação');
  assert.match(views, /painel\.hidden = !!alvo && achou === 0/, 'sem resultado, o corpo some junto');
});

test('a animação de entrada é pra chegar na tela, não pra cada clique', () => {
  // O Estudos se redesenha a cada ação — marcar uma fonte, abrir uma pasta,
  // gerar. Com a animação ligada em toda repintura, a tela inteira piscava 400ms
  // a cada toque.
  const app = ler('web/app.js');
  assert.match(app, /const chegando = state\.view !== view;/, 'sabe se está chegando ou repintando');
  assert.match(app, /if \(!chegando\) return;/, 'e só anima ao chegar');
  const css = ler('web/styles.css');
  assert.match(css, /#messages\.sem-entrada \.msg/, 'histórico não sobe junto');
  assert.match(css, /\.view\.entra \.est-mid \{ animation: sobe/, 'Estudos chega escalonado como os painéis');
});

test('a avaliação diz se já foi, e o resumo fica onde a pessoa está olhando', () => {
  // As duas perguntas que ele não conseguia responder pela tela: "a A2 já foi?"
  // e "como recebo um resumo?".
  const v = ler('web/view-estudos.js');
  assert.match(v, /function quandoDiz\(quando\)/, 'a data vira estado');
  assert.match(v, /t\('já foi'\)/, 'e diz "já foi" com todas as letras');
  assert.match(v, /function porUrgencia\(a, b\)/, 'as que vêm primeiro aparecem primeiro');
  assert.match(v, /\.sort\(porUrgencia\)/, 'e a lista usa isso');
  assert.match(v, /class="est-fazer"/, 'o que fazer com a prova fica no meio da tela');
  assert.match(
    v,
    /\['resumo', 'simulado', 'flashcards', 'guia'\]/,
    'com o resumo em primeiro, que é o que ele procurou'
  );
});

test('todo arquivo diz se é prova, se caiu na prova, ou se é só aula', () => {
  // Os três papéis só apareciam com uma avaliação aberta. Na coluna da esquerda
  // e no estúdio, prova e caderno de aula tinham a mesma cara — e é a diferença
  // entre os dois que o app inteiro promete usar.
  const v = ler('web/view-estudos.js');
  assert.match(v, /const PAPEIS = \{/, 'os três papéis têm um vocabulário só');
  assert.match(v, /const selo = \(papel\)/, 'e viram etiqueta');
  assert.match(v, /function contagemDePapeis/, 'a pasta fechada diz quantos de cada');
  assert.match(v, /class="est-arqs"/, 'a pasta aberta lista os arquivos');
  assert.match(v, /class="est-arq"[^`]*\$\{selo\(a\.papel\)\}/, 'com o papel em cada um');
});

test('nenhum gerador do estúdio nasce trancado', () => {
  // Cinco dos dez ladrilhos ficavam `disabled` num professor novo, com o motivo
  // escondido num `title`. Metade do estúdio cinza é o que ele leu como botão
  // que não funciona.
  const v = ler('web/view-estudos.js');
  assert.doesNotMatch(v, /precisaRetrato/, 'o retrato não tranca mais nada');
  assert.doesNotMatch(v, /data-gerar="\$\{l\.id\}"[^`]*disabled/, 'nenhum ladrilho sai desabilitado');
  assert.match(v, /const ladrilho = \(l, temRetrato\)/, 'um desenho só pros dez');
  assert.match(v, /t\('sem o retrato'\)/, 'e a etiqueta diz o que falta em vez de bloquear');
});

test('a loja liga busca e ordem antes de ir buscar a lista', () => {
  // O `return` do catch pulava a fiação inteira: quando o GitHub não respondia,
  // a barra de busca e o seletor de ordem continuavam na tela sem ouvinte.
  const loja = ler('web/view-loja.js');
  const antes = loja.slice(0, loja.indexOf("await api('/loja')"));
  assert.match(antes, /ligarControles\(el, abas, ordem, q\);/, 'a fiação vem antes da rede');
});

test('a gaveta só recolhe dentro de um professor', () => {
  // A lista de professores não tem três colunas pra caber, e recolher ali tirava
  // o menu do app de quem ainda nem escolheu com quem vai estudar.
  const v = ler('web/view-estudos.js');
  const entrada = v.slice(v.indexOf('export async function renderEstudos'), v.indexOf('export function sairDeEstudos'));
  assert.match(entrada, /if \(aqui\.professorId\) \{/, 'só recolhe com professor aberto');
  assert.match(entrada, /\} else \{\n {4}sairDeEstudos\(\);/, 'e devolve a gaveta na lista');
});

test('nenhuma classe do Estudos fica sem regra de estilo', () => {
  // Trinta e nove classes do Estudos passaram a existir só no JavaScript: o
  // desenho novo cobriu a TELA e não o que sai dela, e simulado, quiz, slides e
  // infográfico apareciam com o HTML cru do navegador. Nada acusava, porque
  // classe sem regra não é erro em lugar nenhum — só fica feio.
  const js = ler('web/view-estudos.js');
  const css = ler('web/styles.css');
  const usadas = new Set();
  for (const [, lista] of js.matchAll(/class="([^"$]*)"/g)) {
    for (const nome of lista.split(/\s+/)) {
      if (/^(est|ret|mapa|quiz|info|slide|q)-/.test(nome)) usadas.add(nome);
    }
  }
  assert.ok(usadas.size > 40, `só ${usadas.size} classes encontradas — a varredura quebrou`);
  const orfas = [...usadas].filter((n) => !css.includes(`.${n}`)).sort();
  assert.deepEqual(orfas, [], 'classe do Estudos usada no JS e sem uma linha de CSS');
});

test('nenhum teste escreve no ~/.nuvo de quem roda a suíte', () => {
  // Um teste sem casa de mentira gravou cinco provedores de teste no banco real
  // desta máquina. O estrago é pequeno e o susto não: a suíte roda no mesmo
  // computador em que o app guarda conversa, memória e prova de escola.
  const DE_BANCO =
    /(from|import\()\s*'\.\.\/server\/(db|config|providers\/index|estudos|estudos-formatos|documents|chat|memory|cartoes|backup|retrato|research|council|complete)\.mjs'/;
  const soltos = readdirSync(join(RAIZ, 'test'))
    .filter((n) => n.endsWith('.test.mjs'))
    .filter((n) => {
      const s = ler(join('test', n));
      return DE_BANCO.test(s) && !s.includes('useTempHome');
    })
    .sort();
  assert.deepEqual(soltos, [], 'teste que abre banco sem useTempHome()');
});

test('um turno por vez: mandar de novo antes de terminar não cria dois', () => {
  // Sem a trava, o segundo turno sobrescrevia `state.streaming`: os dois
  // escreviam na mesma conversa, o botão de parar cancelava só o último, e o
  // servidor ainda recusava o segundo com 409.
  const app = ler('web/app.js');
  const send = app.slice(app.indexOf('async function send('), app.indexOf('async function send(') + 700);
  assert.match(send, /if \(state\.streaming\) \{/, 'send recusa enquanto há turno no ar');
  assert.match(app, /if \(state\.streaming === controller\) \{/, 'e o fim do turno só apaga o que ele pôs');
});

test('resposta de busca que chega atrasada não repinta a lista', () => {
  // Digitar rápido dispara várias buscas, e a rede não devolve na ordem: a de
  // "abc" podia chegar depois da de "abcd" e repintar com o resultado velho.
  const app = ler('web/app.js');
  assert.match(app, /let buscaAtual = 0;/, 'existe um número da busca atual');
  assert.match(app, /const minha = \+\+buscaAtual;/, 'cada busca pega o seu');
  assert.match(app, /if \(minha !== buscaAtual\) return;/, 'e a atrasada desiste');
});

test('perfil e projeto não aceitam ficar sem nome', () => {
  // Nome em branco deixa um cartão que ninguém reconhece nem consegue abrir.
  const views = ler('web/views.js');
  assert.match(views, /t\('o perfil precisa de um nome'\)/, 'a tela recusa antes de mandar');
  const api = ler('server/api.mjs');
  assert.match(api, /function nomeOuOAtual\(novo, atual\)/, 'e o servidor não grava vazio');
  assert.doesNotMatch(api, /b\.name \?\? cur\.name/, 'nenhum lugar aceita string vazia como nome');
});

test('a prova de que o app navegou volta com a conversa', () => {
  // O app promete que abriu um navegador de verdade e leu a página. Essa prova
  // — a trilha e as fontes — só existia enquanto a resposta chegava: bastava
  // recarregar pra sumir, igual ao rodapé da memória antes de ser gravado.
  const servidor = ler('server/chat.mjs');
  assert.match(servidor, /web: paginasLidas\.length \? paginasLidas : undefined/, 'as fontes ficam gravadas');
  assert.match(servidor, /agente: passosDoAgente\.length \? passosDoAgente : undefined/, 'e a trilha também');
  assert.match(servidor, /function passoDoAgente\(ev\)/, 'gravando só o que a tela precisa');

  const app = ler('web/app.js');
  assert.match(app, /if \(meta\.agente\?\.length\) notaAntesDe\(el, trilhaGuardada\(meta\.agente\)/, 'a tela redesenha a trilha');
  assert.match(app, /if \(meta\.web\?\.length\) \{/, 'e as fontes');
  assert.match(app, /function notaAntesDe\(alvo, texto/, 'no lugar certo, antes da resposta');
});

test('a linha de fechamento do turno de programar sobrevive ao recarregamento', () => {
  // "terminou · 8,8 s · 3 idas e voltas · custou US$ 0,24" só existia no stream:
  // o resto do painel voltava depois de um F5 e essa linha não.
  const servidor = ler('server/chat.mjs');
  assert.match(servidor, /if \(evento\.tipo === 'fim'\) \{/, 'o fim entra na lista gravada');
  const code = ler('web/view-code.js');
  assert.match(code, /\{ tipo: 'fim', titulo: linhaDoFim\(passo\), texto: null \}/, 'e volta como fim, não como ferramenta');
});

test('comando comprido no painel não vira parágrafo', () => {
  // Um `find /private/var/folders/2f/nt9…` em negrito ocupava três linhas do
  // painel e empurrava o resto do trabalho pra fora da tela.
  const css = ler('web/styles.css');
  assert.match(css, /\.cd-passo b \{[^}]*line-clamp: 2/, 'o título para em duas linhas');
  assert.match(css, /\.cd-cmd \{[^}]*line-clamp: 3/, 'e o comando em três');
  assert.match(css, /\.cd-passo:has\(\.cd-saida\[open\]\)/, 'aberto, mostra inteiro');
});
