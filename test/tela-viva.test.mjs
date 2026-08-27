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
  assert.match(css, /\.view\.entra \.nlm-meio \{ animation: sobe/, 'Estudos chega escalonado como os painéis');
});

test('a avaliação diz se já foi, e o resumo fica onde a pessoa está olhando', () => {
  // As duas perguntas que ele não conseguia responder pela tela: "a A2 já foi?"
  // e "como recebo um resumo?".
  const v = ler('web/view-estudos.js');
  assert.match(v, /function quandoDiz\(quando\)/, 'a data vira estado');
  assert.match(v, /t\('já foi'\)/, 'e diz "já foi" com todas as letras');
  assert.match(v, /function porUrgencia\(a, b\)/, 'as que vêm primeiro aparecem primeiro');
  assert.match(v, /\.sort\(porUrgencia\)/, 'e a lista usa isso');
  // Os geradores moram no Estúdio e em lugar nenhum mais. Uma fileira com quatro
  // deles ficava no meio da tela, com o mesmo nome, a mesma cor e a mesma
  // etiqueta dos ladrilhos da direita: quem abria a pasta via o Resumo duas
  // vezes na mesma janela e perguntava qual dos dois era o de verdade.
  assert.doesNotMatch(v, /class="est-fazer"/, 'sem a fileira repetida no meio');
  assert.equal(
    (v.match(/class="nlm-lads"/g) || []).length,
    1,
    'os dez geradores são desenhados num lugar só'
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
  assert.match(v, /class="nlm-arqs"/, 'a pasta aberta lista os arquivos');
  assert.match(v, /class="nlm-arq\$\{[^`]*\$\{selo\(a\.papel\)\}/, 'com o papel em cada um');
  // E clicar nele abre a fonte, como no NotebookLM: era um <div> morto, e o
  // arquivo que entrava no app não podia mais ser lido em lugar nenhum dele.
  assert.match(v, /data-arquivo="\$\{escapeHtml\(a\.id\)\}"/, 'e dá pra abrir o arquivo');
  assert.match(v, /function desenharArquivo\(a\)/, 'que abre no meio, com o texto lido');
  // Fechada, a fonte diz a mesma coisa em palavra na segunda linha: sem isso a
  // cópia do NotebookLM teria apagado a única informação que o app tem e eles não.
  assert.match(v, /papeis\.map\(\(\[papel, k\]\)/, 'e a fechada conta por papel');
});

test('nenhum gerador do estúdio nasce trancado', () => {
  // Cinco dos dez ladrilhos ficavam `disabled` num professor novo, com o motivo
  // escondido num `title`. Metade do estúdio cinza é o que ele leu como botão
  // que não funciona.
  const v = ler('web/view-estudos.js');
  assert.doesNotMatch(v, /precisaRetrato/, 'ler as provas não tranca mais nada');
  assert.doesNotMatch(v, /data-gerar="\$\{l\.id\}"[^`]*disabled/, 'nenhum ladrilho sai desabilitado');
  assert.match(v, /const ladrilho = \(l, temRetrato, foco = null\)/, 'um desenho só pros dez');
  assert.match(v, /t\('sem ler as provas'\)/, 'e a etiqueta diz o que falta em vez de bloquear');
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

test('o simulado é uma prova pra fazer, não um relatório sobre o professor', () => {
  // Ele pediu um simulado e recebeu análise: cada questão com a etiqueta do
  // peso, o tema, o nível, e a resposta a um clique de distância. Prova é
  // outra coisa — tem onde responder, esconde o gabarito até você entregar, e
  // sai no papel com espaço pra escrever.
  const v = ler('web/view-estudos.js');
  const folha = v.slice(v.indexOf('function desenharSimulado('), v.indexOf('function ligarSimulado('));
  assert.match(folha, /data-act="entregar"/, 'dá pra entregar a prova');
  assert.match(folha, /type="radio"/, 'e assinalar as objetivas');
  assert.match(folha, /class="prova-pautado"/, 'a discursiva tem linha pra escrever no papel');
  assert.doesNotMatch(folha, /est-gabarito/, 'a resposta não fica a um clique de distância');
  // O que o retrato descobriu só reaparece no gabarito: numa prova pra fazer,
  // dizer "esta cai com 30%" é entregar metade da resposta.
  assert.match(folha, /class="prova-so-gabarito"/, 'a probabilidade fica guardada no gabarito');
  const css = ler('web/styles.css');
  assert.match(css, /\.prova\[data-modo='gabarito'\] \.prova-so-gabarito \{ display: inline-flex/);
  assert.match(css, /\.imprimindo-prova \.prova-folha \{/, 'a folha tem CSS de impressão próprio');
  assert.match(css, /\.imprimindo-prova \.prova-pautado \{ display: block/, 'e as linhas só saem no papel');
});

test('a prova que vem tem onde clicar', () => {
  // "N dá pra saber onde peço o resumo pra prova q vem agora": a avaliação com
  // data era uma linha na coluna da esquerda e os geradores moravam na da
  // direita, sem vínculo nenhum entre as duas.
  const v = ler('web/view-estudos.js');
  assert.match(v, /function proximaProva\(/, 'alguém sabe qual é a próxima');
  assert.match(v, /function faixaDaProxima\(/, 'e ela abre a coluna do meio');
  assert.match(v, /data-gerar="\$\{id\}" data-foco="\$\{pasta\.id\}"/, 'gerando para aquela prova');
  // O foco viaja até o servidor: sem ele a saída sairia solta do professor em
  // vez de arquivada na avaliação, e o modelo não saberia pra qual prova é.
  assert.match(v, /\{ tipo, model: ref, pastas, foco \}/, 'o pedido leva o foco');
  const api = ler('server/api.mjs');
  assert.match(api, /foco: typeof b\.foco === 'string'/, 'a rota aceita o foco');
});

test('prova de ano anterior não vira compromisso na agenda', () => {
  // O professor repete a forma de um ano pro outro, e prova velha é a melhor
  // amostra do jeito dele — mas ela não é uma prova marcada, e misturar as
  // duas faria a tela anunciar oito avaliações onde há duas.
  const v = ler('web/view-estudos.js');
  assert.match(v, /id="est-prova-antiga"/, 'existe o botão de adicionar');
  assert.match(v, /p\.tipo === 'prova' && p\.anterior/, 'e elas ficam num grupo à parte');
  assert.match(v, /!p\.anterior && p\.quando/, 'a próxima prova nunca é uma de ano passado');
  // E gerar "para" uma prova de 2025 produziria um simulado da avaliação que já
  // passou, com o nome dela no título: ela é fonte, não alvo.
  assert.match(v, /pasta\?\.tipo === 'prova' && !pasta\.anterior \? pasta : null/, 'nem alvo de geração');
  const db = ler('server/db.mjs');
  assert.match(db, /addColumn\('estudo_pastas', 'anterior'/, 'a marca é coluna, não adivinhação por data');
});

test('os botões do menu se escolhem por lugar, e o "Mais" aparece', () => {
  // Duas caixas de marcar por linha ("aparece" e "no Mais") não diziam o
  // resultado: era preciso combinar as duas de cabeça. E o "Mais" — o botão
  // que guarda os outros — não aparecia em canto nenhum da tela, então não
  // dava pra saber onde ele ficava. "cade botao mais?"
  const views = ler('web/views.js');
  assert.doesNotMatch(views, /data-campo="ver"/, 'sem a caixa de "aparece"');
  assert.doesNotMatch(views, /data-campo="mais"/, 'sem a caixa de "no Mais"');
  assert.match(views, /data-onde="\$\{k\}"/, 'um controle só, e ele diz o destino');
  assert.match(views, /class="menu-previa"/, 'a gaveta aparece desenhada como vai ficar');
  assert.match(views, /class="menu-previa-item mais"/, 'com o "Mais" no lugar dele');
  assert.match(views, /class="menu-previa-dentro"/, 'e o que fica dentro dele');
});

test('o tema não flutua no rodapé de toda seção de ajustes', () => {
  // Dois botões redondos sem rótulo, no canto de baixo à direita de qualquer
  // seção: numa seção curta eles apareciam sozinhos no meio do vazio, sem
  // pertencer a nada do que estava na tela.
  const views = ler('web/views.js');
  assert.doesNotMatch(views, /class="cfg-pe"/, 'o rodapé flutuante saiu');
  assert.match(views, /cfgLin\(t\('Aparência'\)/, 'e o tema virou linha de ajuste, com nome');
  assert.doesNotMatch(ler('web/styles.css'), /\.cfg-pe/, 'e o CSS dele foi junto');
});

test('a marca tem um miolo, e não é uma bolha lisa', () => {
  // Os seis lóbulos encostavam no miolo e os três raios se somavam num disco
  // só: no ícone de 512px saía uma bolha azul sem um traço dentro. O furo é de
  // máscara, e não um círculo preto por cima, porque a marca também aparece
  // sobre o painel claro — um "buraco" pintado de preto ali seria uma mancha.
  const glow = ler('web/glow.js');
  assert.match(glow, /<mask id="m\$\{id\}">/, 'o furo é máscara');
  assert.match(glow, /mask="url\(#m\$\{id\}\)"/, 'e a coroa é desenhada através dela');
  const lobo = /Math\.cos\(a\) \* ([\d.]+)/.exec(glow);
  const raio = /r="\$\{cx\}"|r="([\d.]+)" style="animation-delay/.exec(glow);
  const miolo = /<circle cx="12" cy="12" r="([\d.]+)"\/><\/g>\n\s*<circle cx="12" cy="12" r="([\d.]+)" fill="#000"/s.exec(glow);
  assert.ok(lobo && raio?.[1] && miolo, 'os números da marca continuam legíveis daqui');
  // A borda interna do lóbulo tem que passar do furo, senão a coroa se fecha
  // sobre o miolo de novo e volta a bolha.
  assert.ok(
    Number(lobo[1]) - Number(raio[1]) < Number(miolo[2]),
    'o lóbulo alcança o furo, então a coroa é contínua'
  );
  assert.ok(Number(miolo[2]) > 0, 'e existe um furo');
});

test('saída sem estrutura vira texto, e não uma folha de prova vazia', () => {
  // O NotebookLM sozinho devolve texto corrido: o servidor guarda `{ texto }`
  // e o comentário dele promete que "a tela desenha texto quando não há
  // estrutura". A tela não desenhava — um simulado vindo só dele abria a folha
  // com cabeçalho, zero questões e um botão de entregar sem nada pra corrigir.
  const v = ler('web/view-estudos.js');
  const saida = v.slice(v.indexOf('function desenharSaida('), v.indexOf('const desenhar = {'));
  assert.match(saida, /typeof j\.texto === 'string' && j\.texto\.trim\(\)/, 'o texto tem caminho próprio');
  assert.match(saida, /renderMarkdown\(j\.texto\)/, 'e é desenhado como markdown');
  assert.match(v, /if \(!prova \|\| !questoes\.length\) return;/, 'a folha vazia não é fiada');
});

test('a configuração do menu mexe na tela que acabou de chegar', () => {
  // A lista desenhada completava com a tela que a configuração salva não
  // citava — versão nova sempre traz tela nova —, mas a lista que se GRAVA
  // não completava. `ordem.indexOf(id)` dava -1 na recém-chegada, e as setas
  // de subir e descer não faziam nada, sem dizer por quê.
  const views = ler('web/views.js');
  const fio = views.slice(views.indexOf('const listaDoMenu ='), views.indexOf('const selVisao'));
  assert.match(
    fio,
    /for \(const \[id\] of TELAS_DA_GAVETA\) if \(!cfg\.ordem\.includes\(id\)\) cfg\.ordem\.push\(id\);/,
    'a ordem gravada também completa'
  );
});

test('zero digitado é zero, e não o padrão', () => {
  // `Number(campo.value) || padrao`: zero é falso, então quem punha 0 em "nota
  // mínima" recebia 0,12 de volta — um número que ela não escolheu, sem aviso.
  const views = ler('web/views.js');
  assert.match(views, /function numeroOuPadrao\(/, 'existe quem saiba a diferença');
  assert.doesNotMatch(views, /Number\(q\('#s-min'\)\.value\) \|\| 0\.12/, 'e o atalho errado saiu');
  assert.doesNotMatch(views, /Number\(q\('#s-max'\)\.value\) \|\| 12/);
});

test('escolher o mesmo arquivo duas vezes importa duas vezes', () => {
  // `change` não dispara quando o valor do campo não muda: a segunda
  // importação do mesmo arquivo simplesmente não acontecia, sem erro nenhum.
  const views = ler('web/views.js');
  const trecho = views.slice(views.indexOf("querySelector('#m-file').onchange"), views.indexOf('#import-status'));
  assert.match(trecho, /ev\.target\.value = '';/, 'o campo é limpo antes de usar o arquivo');
});

test('a tela de Estudos é a do NotebookLM, com os números dela', () => {
  // Ele olhou a tela de três colunas que existia aqui e disse "bagunçado pra
  // porra", e pediu a cópia declarada: "copia na cara dura a interface do
  // notebook lm, tudo tudo tudo, mas ao invez de notebooks, professores".
  // Estes são os valores medidos no navegador dele em notebook.google.com, a
  // 1122px de largura — se algum mudar aqui, deixou de ser cópia.
  const css = ler('web/styles.css');
  const bloco = css.slice(css.indexOf('.nlm {'), css.indexOf('.nlm-casa {'));
  assert.match(bloco, /--nlm-fundo: #1a1d22/, 'o fundo da tela é o deles');
  assert.match(bloco, /--nlm-painel: #22262b/, 'e o do painel também');
  assert.match(bloco, /--nlm-campo: #2e3135/, 'e o do campo de escrever');
  assert.match(bloco, /--nlm-fio: #37383b/, 'e o do fio dos botões de contorno');
  assert.match(bloco, /grid-template-columns: 270px minmax\(0, 1fr\) 270px/, '270 | resto | 270');
  assert.match(bloco, /\.nlm-topo \{[^}]*height: 64px/, 'a barra de cima tem 64px');
  assert.match(bloco, /\.nlm-painel \{[^}]*border-radius: 16px/, 'o painel tem raio 16');
  assert.match(bloco, /\.nlm-fonte \{[^}]*min-height: 48px/, 'a linha de fonte tem 48px');
  assert.match(bloco, /\.nlm-lad \{[^}]*height: 56px/, 'o ladrilho tem 56px');
  assert.match(bloco, /\.nlm-lad \{[^}]*border-radius: 12px/, 'e raio 12');
  assert.match(bloco, /\.nlm-add \{[^}]*border-radius: 96px/, 'o botão de contorno é pílula de 96');
  assert.match(bloco, /\.nlm-escrever \{[^}]*height: 48px/, 'o campo de escrever tem 48px');
  // Uma barra de cima só: a do app sai enquanto o professor está aberto.
  assert.match(css, /#app\[data-nlm\] #topbar \{ display: none; \}/);
});

test('a coluna do meio conversa com o material do professor', () => {
  // Era o buraco da tela: três colunas e nenhuma delas respondia pergunta. No
  // NotebookLM a do meio é a conversa, e é ela que dá sentido às outras duas —
  // fonte à esquerda, resposta no meio, o que gerar à direita.
  const v = ler('web/view-estudos.js');
  assert.match(v, /function desenharConversa\(prof, proxima\)/, 'a conversa é desenhada');
  assert.match(v, /`\/chats\/\$\{aqui\.conversaId\}\/stream`/, 'e fala com o servidor');
  assert.match(v, /\/professores\/\$\{prof\.id\}\/conversas/, 'presa àquele professor');
  const chat = ler('server/chat.mjs');
  assert.match(chat, /pastaIds: chat\.professor_id \? pastasDo\(chat\.professor_id\)/, 'as fontes são as pastas dele');
  const db = ler('server/db.mjs');
  assert.match(db, /addColumn\('chats', 'professor_id', 'TEXT'\)/, 'e a conversa sabe de quem é');
});

test('a foto do professor leva o token, senão ela nunca aparece', () => {
  // `<img src>` não passa pelos nossos cabeçalhos: o navegador busca a imagem
  // sozinho, sem o `x-nuvo-token` que o `api()` põe. A rota devolvia 401 e o
  // círculo ficava vazio — quem trocasse a foto via o envio dar certo e nada
  // mudar na tela, sem erro nenhum. É o mesmo caminho do manifest.
  const v = ler('web/view-estudos.js');
  const foto = v.slice(v.indexOf('function fotoDo('), v.indexOf('// ------', v.indexOf('function fotoDo(')));
  assert.match(foto, /token=\$\{encodeURIComponent\(TOKEN\)\}/, 'o token vai na URL da foto');
  // A lista de imports muda quando a tela ganha ajudante novo; o que importa é
  // o TOKEN vir do core, não a posição dele na linha.
  const imports = v.slice(v.indexOf('import {'), v.indexOf("} from './core.js';"));
  assert.match(imports, /\bTOKEN\b/, 'e vem do core');
});

test('foto que sumiu do disco responde 404, não 500', async () => {
  // Banco apontando pra arquivo que não existe mais — pasta de uploads
  // restaurada de um backup mais velho que o banco — estourava no
  // `readFileSync` e virava erro de servidor por uma foto que só sumiu.
  const estudos = ler('server/estudos.mjs');
  assert.match(estudos, /if \(!existsSync\(caminho\)\) throw erroHttp\(404,/, 'diz 404 com todas as letras');
});

test('a busca de professor filtra sem repintar, e por isso não perde o cursor', () => {
  // Repintar a cada letra recriava o campo e o cursor ia junto: dava pra
  // digitar UMA letra e o foco sumia. Devolver o foco depois não resolve — a
  // repintura é assíncrona e acontece depois. E filtrar nos dois lugares punha
  // dois filtros na mesma lista: o desenho tirava a linha do DOM e a busca não
  // tinha mais o que devolver ao apagar o que estava escrito.
  const v = ler('web/view-estudos.js');
  const fio = v.slice(v.indexOf("const campoBusca ="), v.indexOf("const ordem ="));
  assert.match(fio, /linha\.hidden = !bate;/, 'esconde linha em vez de redesenhar');
  assert.doesNotMatch(fio, /switchView/, 'e não repinta a tela a cada letra');
  // Um filtro só: a lista vem inteira do servidor e quem tira linha é a busca.
  const lista = v.slice(v.indexOf('async function telaDaLista'), v.indexOf('const campoBusca ='));
  assert.doesNotMatch(lista, /\.filter\(\(p\) => !busca/, 'o desenho não filtra também');
});

test('a rodada de revisão é congelada, senão ela acaba na metade', () => {
  // A fila encolhe a cada resposta — o cartão respondido sai de "vence hoje".
  // Comparar o contador que sobe com o tamanho da fila que desce fazia as duas
  // se cruzarem no meio: com 6 cartões a revisão terminava sozinha depois de 3,
  // e o professor voltava pra tela dizendo "Revisar 3" sem ninguém entender.
  const v = ler('web/view-estudos.js');
  const laco = v.slice(v.indexOf('const responder = async (nota)'), v.indexOf("q('[data-sair-rev]')"));
  assert.match(laco, /aqui\.cartao >= aqui\.rodada\.length/, 'o fim é o tamanho da rodada');
  assert.doesNotMatch(laco, /fila\.cartoes\.length/, 'e nunca o tamanho da fila viva');
  // Errado volta nesta mesma rodada: é o que o rótulo "volta hoje" promete.
  assert.match(laco, /if \(nota <= 2\)[\s\S]{0,120}aqui\.rodada\.push/, 'errado volta pro fim da rodada');
  // E a rodada nasce de uma cópia, não da referência que o próximo fetch troca.
  assert.match(v, /aqui\.rodada = cartoes\.cartoes\.slice\(\)/, 'a rodada é uma cópia congelada');
});

test('a cor que enche botão é outra da que vira texto', () => {
  // `--accent` faz dois trabalhos que puxam pra lados opostos: como texto sobre
  // o preto ela quer ser clara, como fundo de botão com letra branca em cima
  // ela quer ser escura. Com uma cor só, o botão mais clicado do app ficava em
  // 3.77:1 — abaixo do mínimo. Quem enche superfície é `--accent-cheio`.
  const css = ler('web/styles.css');
  const cheios = css.match(/background: var\(--accent\);[\s\S]{0,80}?color: var\(--on-accent\)/g) || [];
  assert.equal(cheios.length, 0, 'nenhum preenchimento usa --accent com --on-accent em cima');
  assert.match(css, /--accent-cheio: #2f6ae6/, 'o tema escuro tem a cor de preenchimento própria');
});

test('a letra em cima de uma tinta acompanha o tema', () => {
  // As tintas invertem entre os temas: claras no escuro, escuras no claro. Uma
  // letra preta fixa passava no escuro e dava 3.71:1 no claro — a inicial do
  // professor sumia dentro do círculo.
  const css = ler('web/styles.css');
  assert.match(css, /--sobre-tinta: #000;/, 'preta no tema escuro');
  assert.match(css, /--sobre-tinta: #fff;/, 'branca no tema claro');
  const foto = css.slice(css.indexOf('.est-foto {'), css.indexOf('.est-foto {') + 400);
  assert.match(foto, /color: var\(--sobre-tinta\)/, 'e a inicial do professor usa o par');
});

test('informação não é apagada com opacidade', () => {
  // Opacidade não muda `color`, então o contraste calculado no papel continua
  // ótimo enquanto o texto some na tela. Quatro lugares diziam coisa que a
  // pessoa precisa ler — "nenhuma marcada", "ainda não", o contador da aba da
  // loja e o do estúdio — e estavam entre 2.4:1 e 3.8:1 por causa disso. Quem
  // separa informação secundária aqui é a cor e o tamanho, não o desbotado.
  const css = ler('web/styles.css');
  assert.match(css, /\.nlm-tab \.fraco \{ color: var\(--nlm-txt2\); \}/, 'a coluna fraca usa cor');
  assert.doesNotMatch(css, /\.loja-aba small \{[^}]*opacity: 0\.7/, 'o contador da loja não é apagado');
  assert.doesNotMatch(css, /\.nlm-rot \.n \{ opacity/, 'nem o contador do estúdio');
  // E a alternativa já respondida continua legível: ela está travada, não fora.
  assert.match(css, /\.quiz-alt:disabled \{ opacity: 1;/, 'a questão respondida não desbota');
});

test('as abas do estreito cumprem o que o role promete', () => {
  // `role="tab"` faz o leitor de tela anunciar "aba 1 de 3" e a pessoa apertar
  // a seta. Sem `aria-controls`, sem painel com `role="tabpanel"` e sem as
  // setas ligadas, o anúncio era mentira: as setas não faziam nada e nenhuma
  // aba dizia qual painel ela comanda.
  const v = ler('web/view-estudos.js');
  assert.match(v, /aria-controls="nlm-painel-\$\{k\}"/, 'a aba aponta pro painel');
  assert.match(v, /role="tabpanel" aria-labelledby="nlm-aba-material"/, 'e o painel se declara');
  assert.match(v, /tabindex="\$\{aqui\.regiao === k \? '0' : '-1'\}"/, 'tabindex móvel: só a escolhida no Tab');
  const teclas = v.slice(v.indexOf('b.onkeydown = (ev) => {'), v.indexOf('alvo.click();'));
  assert.match(teclas, /ArrowRight/, 'seta anda entre as abas');
  assert.match(teclas, /'Home'/, 'Home e End vão pras pontas');
  // Trocar de aba redesenha tudo: sem devolver o foco depois, o teclado se
  // perde no body — é o mesmo defeito que a busca de professor teve.
  assert.match(v, /if \(aqui\.focarAba\)/, 'o foco volta pra aba depois da repintura');
});

test('a prova impressa é branca com tinta preta, marcado ou não o fundo', () => {
  // Quem imprime pode ter "gráficos de plano de fundo" marcado. Com o tema
  // escuro na tela, isso levava o preto do app pro papel — e a folha saía preta
  // com a letra #000 que este bloco já define: uma prova ilegível. O papel não
  // tem tema, então a impressão declara o branco e o `color-scheme` claro em
  // vez de contar com o padrão da caixa de impressão.
  const css = ler('web/styles.css');
  const bloco = css.slice(css.indexOf('@media print {\n  @page { margin: 16mm 15mm; }'));
  assert.match(bloco, /html, body \{ background: #fff !important; \}/, 'papel branco');
  assert.match(bloco, /:root \{ color-scheme: light !important; \}/, 'e sem tema escuro no papel');
  assert.match(bloco, /\.imprimindo-prova \* \{ background: none !important;/, 'nenhum fundo chapado sobra');
  // O gabarito é o que se imprime pra LER: o texto dele não pode sair cinza
  // claro, que é o que `--text-2` vale no tema escuro.
  assert.match(bloco, /\.imprimindo-prova \.prova-conf p \} ?|\.imprimindo-prova \.prova-conf,\n  \.imprimindo-prova \.prova-conf p \{ color: #000; \}/,
    'a resposta esperada sai em preto');
});

test('botão que cria coisa dispara uma vez e exige nome', () => {
  // Dois defeitos que andavam juntos. O primeiro: `name: campo.value.trim() ||
  // t('Novo perfil')` fazia um clique sem querer — e o formulário fica sempre
  // aberto logo acima do botão — nascer um perfil chamado "Novo perfil", sem
  // dizer nada. O mesmo no projeto. A memória, duas telas adiante, já recusava
  // e explicava; agora as três fazem igual.
  //
  // O segundo: os `onclick = async () => …` não desligavam o botão enquanto o
  // POST estava no ar, então três cliques depressa criavam três.
  const core = ler('web/core.js');
  assert.match(core, /export function umDeCada\(botao, acao\)/, 'o guarda mora no core');
  assert.match(core, /botao\.disabled = true;[\s\S]{0,120}finally \{\s*botao\.disabled = false;/,
    'e devolve o botão mesmo se der erro');

  const v = ler('web/views.js');
  for (const id of ['#btn-add-gem', '#btn-add-proj', '#btn-add-mem']) {
    assert.match(v, new RegExp(`umDeCada\\(inner\\.querySelector\\('${id}'\\)`), `${id} passa pelo guarda`);
  }
  assert.doesNotMatch(v, /value\.trim\(\) \|\| t\('Novo perfil'\)/, 'perfil sem nome não nasce');
  assert.doesNotMatch(v, /value\.trim\(\) \|\| t\('Novo projeto'\)/, 'projeto sem nome não nasce');
  assert.match(v, /dê um nome ao perfil/, 'e o perfil diz o que falta');
  assert.match(v, /dê um nome ao projeto/, 'e o projeto também');

  const e = ler('web/view-estudos.js');
  assert.match(e, /umDeCada\(host\.querySelector\('#pf-criar'\)/, 'o professor também');
});

test('os perfis prontos nascem no idioma da máquina, e não mandam responder em português', () => {
  // Eles são dado do usuário — dá pra renomear e reescrever —, então não passam
  // pelo dicionário do cliente: traduzi-los ao desenhar desfaria o que a pessoa
  // mudasse. Num app aberto em inglês apareciam quatro perfis em português, e o
  // "Assistente" carregava "Responde em português do Brasil" na instrução: a IA
  // obedecia e respondia em português a quem tinha escrito em inglês.
  const db = ler('server/db.mjs');
  assert.match(db, /const SEMENTES = \{/, 'as sementes existem em três idiomas');
  for (const nome of ['Assistant', 'Asistente', 'Assistente']) {
    assert.ok(db.includes(`'${nome}'`), `${nome} está entre as sementes`);
  }
  assert.doesNotMatch(db, /Responde em português do Brasil/, 'a instrução não prende o idioma');
  assert.match(db, /idiomaDaMaquina\(\)/, 'e a escolha é a da máquina');

  // `NUVO_LANG` força a tela inteira: é como se confere a tradução sem mexer no
  // idioma da máquina de quem está usando.
  const api = ler('server/api.mjs');
  assert.match(api, /idiomaForcado: process\.env\.NUVO_LANG \? idiomaDaMaquina\(\) : null/, 'o /state entrega o forçado');
  const i18n = ler('web/i18n.js');
  assert.match(i18n, /const candidatos = \[forcado, escolhido,/, 'e ele ganha até da escolha guardada');
});

test('o retrato mostra a evidência de cada tema e dá pra discordar dele', () => {
  // A promessa que separa este retrato do que os concorrentes vendem: eles
  // adivinham numa caixa preta. Aqui faltavam as duas metades.
  //
  // A evidência: o modelo devolve, por tema, em que provas ele apareceu e um
  // trecho literal — e a legenda mostrava só "osmose 13%", um número sem
  // origem que não dá pra conferir.
  const v = ler('web/view-estudos.js');
  assert.match(v, /onde: c\.apareceu_em,\s*\n\s*citacao: c\.citacao/, 'a evidência chega na legenda');
  const leg = v.slice(v.indexOf('const legenda = (itens) =>'), v.indexOf('function fatiar'));
  assert.match(leg, /caiu em \{provas\}/, 'e a faixa diz em que prova caiu');
  assert.match(leg, /ret-cita/, 'com a citação do lado');

  // A correção: o campo existia no arquivo, a rota aceitava e nada escrevia
  // nem lia. Uma promessa dentro do código, cumprida por ninguém.
  assert.match(v, /function correcoesEmHtml\(r\)/, 'a seção de correções existe');
  assert.match(v, /id="est-corrigir"/, 'com o botão de discordar');
  assert.match(v, /professores\/\$\{prof\.id\}\/retrato`, \{ method: 'PATCH', body: \{ correcoes/,
    'e ela grava na rota certa, com as correções no topo do corpo');

  const r = ler('server/retrato.mjs');
  assert.match(r, /O que quem tem aula com ele já corrigiu/, 'e a correção entra no pedido da regeração');
  assert.match(r, /valem MAIS que a sua leitura das provas/, 'como regra que o modelo obedece');
});
