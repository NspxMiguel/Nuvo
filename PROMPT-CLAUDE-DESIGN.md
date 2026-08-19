# Prompt pro Claude Design — terceira versão

A primeira versão descrevia o app e deixava o visual em aberto: saiu genérico.
A segunda fixou a referência com foto. Esta terceira acrescenta o que ainda
faltava dizer: **simplicidade em camadas, personalidade, animação, e a ideia do
LM Studio de recomendar modelo pela máquina.**

Copiar daqui pra baixo. Anexar as seis imagens de `referencias-design/` junto
(ou apontar pro repositório, que é público):
`chatgpt-inicio` · `chatgpt-lista` · `gemini-inicio` · `gemini-brilho` ·
`gemini-gaveta` · `gemini-animacao`.

---

Preciso do desenho de interface de um app chamado **IAUnifier**, e eu sei
exatamente a cara que quero: **o app do ChatGPT e o app do Gemini no iPhone.**
Não "inspirado em" — é esse o alvo. As referências estão anexas e em
https://github.com/NspxMiguel/IAUnifier/tree/main/referencias-design

## O que é o app

Um app que roda no servidor de casa e junta todas as IAs num lugar só: modelos
locais (Ollama), de API (Claude, GPT, Gemini) e de linha de comando (Claude
Code, Codex). A ideia que sustenta ele: **a memória é compartilhada entre
todas.** O que você contou pro Claude, o GPT sabe.

Uma pessoa só usa. Sem conta, sem equipe. Abre pelo navegador na rede de casa,
instalado como app: **celular e computador, os dois de verdade**. Português do
Brasil.

## A cara, ponto por ponto (olhar as fotos)

**`chatgpt-inicio.png`** — a tela vazia:
- fundo **preto de verdade** (`#000`), não cinza-escuro;
- barra de cima: botão redondo de menu à esquerda, um controle-pílula no meio,
  botão redondo à direita. Sem título, sem linha embaixo;
- a tela vazia não é vazia: sugestões em lista, ícone à esquerda e texto
  grande, sem caixa em volta;
- embaixo, **a pílula de escrever**: bem arredondada, cinza-escuro, um `+` à
  esquerda, microfone e um botão azul redondo à direita. Ela é o objeto mais
  importante da tela.

**`chatgpt-lista.png`** — a gaveta de conversas:
- lista de conversas em **texto puro, grande, uma por linha, sem borda, sem
  cartão, sem ícone**. A separação é o espaço, só isso;
- título "ChatGPT" grande no topo com uma lupa redonda ao lado;
- embaixo, **um botão-pílula azul flutuante** ("Chat") e uma engrenagem
  redonda. É a única cor da tela;
- a conversa aberta fica visível atrás, deslocada pra direita.

**`gemini-inicio.png`** — a outra referência da tela vazia:
- estrela em degradê no centro e uma saudação com o nome da pessoa
  ("Sua vez, miguel!"). Isso é a cara do app quando não tem nada;
- o seletor de modelo é **texto na barra de cima** ("Pro Estendido ⌄"), não um
  `select` de formulário;
- avatar redondo no canto.

**`gemini-brilho.png`** — o detalhe que quero:
- um **brilho colorido atrás da pílula de escrever**, subindo do rodapé. É
  atmosfera, não interface: nunca fica na frente de nada.

**`gemini-gaveta.png`** — a gaveta do Gemini:
- seções com rótulo pequeno em cinza ("Notebooks", "Recentes >"), itens com
  ícone fino à esquerda e texto grande;
- rodapé com avatar, nome, plano, e engrenagem à direita.

**`gemini-animacao.png`** — a animação que eu quero copiar, quadro a quadro:
- quando o Gemini volta pra frente, o brilho **nasce ao vivo**: uma malha de
  pontinhos (meio-tom, tipo impressão) sobe do rodapé, atrás da pílula de
  escrever;
- a cor **passa por âmbar → rosa → roxo → azul** em mais ou menos um segundo e
  meio, e assenta em azul escuro, respirando devagar;
- é o único movimento da tela, e ele acontece uma vez, na entrada. Não é fundo
  animado o tempo todo. Quando termina, vira atmosfera parada.

Quero isso — ou algo com a mesma alma — na chegada do app e quando uma resposta
começa a ser escrita. Feito em Canvas ou CSS puro, sem biblioteca, e obedecendo
`prefers-reduced-motion`.

**Resumo do que essas telas têm em comum, e é o que eu quero:**
preto de verdade · tipografia grande do sistema (SF/Roboto), sem fonte
decorativa · lista sem borda e sem cartão · pílula pra tudo que se toca ·
**uma** cor de destaque (azul), o resto é preto, branco e cinza · nada de
sombra em caixa, nada de linha separando cabeçalho · o vazio é parte do
desenho.

## Personalidade e movimento

O que eu **não** quero é o que já tentaram: um app escuro com cartões, borda
fina, cinza-azulado, ícone padrão e zero movimento. Isso é o que qualquer
gerador devolve — parece feito com IA em cinco minutos, e todo mundo percebe.

O que eu quero é **um app respeitável**: alguém abre e sente que tem gente
cuidando dele. Isso vem de três coisas:

1. **um gesto próprio.** A estrela do Gemini, o brilho, a pílula azul do ChatGPT
   — cada app tem um sinal que é só dele. O IAUnifier precisa do dele. A ideia do
   app é "várias IAs, uma memória", então o sinal pode vir daí: várias coisas
   que viram uma. Proponha, e proponha um só, não cinco;
2. **movimento com sentido.** Animação existe pra dizer o que aconteceu, não pra
   enfeitar: a resposta começando a chegar, a memória sendo gravada, um modelo
   do conselho terminando antes do outro, a pesquisa avançando de fase, o menu
   abrindo. Cada uma curta (150–400 ms), com curva de aceleração de verdade
   (nada linear), e todas com a mesma "física" — o app inteiro se move do mesmo
   jeito. Uma entrada memorável (o brilho) e o resto discreto;
3. **detalhe que só quem cuida põe.** O botão de enviar que muda de estado com o
   texto; a pílula que cresce com o que você escreve; o número que sobe em vez
   de trocar; o toque que responde na hora. Isso é o que separa respeitável de
   genérico.

## Simples pra quem não entende, confortável pra quem entende

Quem usa é uma pessoa só, mas ela pode ser leiga num dia e "entendente" no
outro. O desenho precisa servir aos dois **sem virar dois apps**:

- **a primeira camada é sempre a simples.** Abrir e falar. Um campo, um botão,
  o modelo já escolhido. Sem pedir decisão nenhuma pra começar. Termos como
  "provedor", "embedding", "temperatura", "token" **não aparecem** nessa
  camada — ou aparecem traduzidos ("qual IA responde", "quão criativa");
- **a segunda camada existe, mas escondida a um toque.** Ajustes, parâmetros,
  modelo por conversa, estatística de tokens: tudo isso está lá, mas atrás de
  um "mais" ou de um painel que desliza. Quem entende acha em um gesto; quem
  não entende nunca esbarra;
- **nada de "modo avançado".** Não é um botão que troca a interface. É a mesma
  tela, com profundidade a um toque de distância;
- **texto curto e humano** em tudo que a pessoa lê. Erro diz o que fazer.
  Estado vazio diz o próximo passo. Nada de jargão sem tradução.

## A ideia do LM Studio: recomendar o modelo pela máquina

O LM Studio faz uma coisa que eu quero copiar: ele olha a máquina da pessoa,
mostra **só os modelos que cabem nela**, e recomenda os melhores — dizendo o
que cada um faz bem e **por que escolher um e não outro**.

Isso é a tela de **Provedores** (local/Ollama) e a **primeira abertura**. O
desenho precisa de:

- **um resumo da máquina, em linguagem de gente**: "seu Mac tem 18 GB de
  memória; cabe modelo até uns 12 GB com folga pra usar o resto";
- **a lista de modelos recomendados**, cada um com: nome legível (não o id
  técnico), tamanho, se cabe (cabe / cabe apertado / não cabe), **pra que ele é
  bom em uma frase** ("melhor pra código", "melhor pra escrever em português",
  "o mais rápido"), e um botão de baixar com progresso;
- **a comparação**: por que este e não aquele. Pode ser uma linha embaixo de
  cada ("mais preciso que o X, mas duas vezes mais lento"). Não é tabela de
  benchmark — é conselho de amigo que entende;
- **o que já está baixado** aparece primeiro e marcado.

O servidor **ainda não sabe fazer isso** — é a próxima coisa que eu construo no
back-end (medir RAM/chip, catálogo curado, regra de "cabe"). O desenho pode
supor que esses dados existem: máquina (RAM, chip, sistema), lista de modelos
com tamanho em GB, nota de "cabe", descrição curta e comparação. Se precisar de
mais algum campo, diz qual.

## As 8 telas que precisam desse tratamento

1. **Conversas** — o chat: gaveta de conversas (como `chatgpt-lista.png`), a
   tela vazia (como `gemini-inicio.png`), a resposta chegando em streaming, um
   bloco de raciocínio que abre e fecha, anexos, botão de refazer com outro
   modelo, e a pílula de escrever;
2. **Conselho** — a mesma pergunta em vários modelos **ao mesmo tempo**, em
   colunas. Modos: comparar / conselho (mais uma síntese) / votação (placar
   com nota média e vencedor);
3. **Pesquisa** — pesquisa na web com andamento ao vivo (planejou → buscando →
   lendo → escrevendo) e relatório final com fontes numeradas;
4. **Projetos** — pastas com arquivos, instrução e memória próprios;
5. **Gems** — personalidades salvas (instrução + modelo + temperatura);
6. **Memória** — a lista de fatos que o app sabe sobre você, cada um com a
   origem. É a tela que explica a ideia do app;
7. **Provedores** — onde as IAs são ligadas: local (Ollama, com download e
   progresso), API (chave, custo), CLI (programa instalado). Estado de saúde e
   lista de modelos;
8. **Config** — tema, token, backup, importar conversa de outras IAs.

## Os momentos que o desenho tem que resolver (não os formulários)

- **conselho em paralelo**: 2 a 5 colunas enchendo em velocidades diferentes,
  uma falha, depois vira uma resposta final;
- **placar da votação**: nota média por modelo, quem votou o quê, o vencedor, e
  uma linha discreta pra "1 voto anulado";
- **andamento da pesquisa**: um registro que cresce sozinho por uns 40 segundos
  e depois é substituído pelo relatório;
- **resposta chegando**: streaming, com raciocínio que pode ser enorme e não
  pode roubar a cena;
- **primeira abertura**: nenhum modelo configurado. O app procura sozinho o que
  tem na máquina. Essa tela decide se a pessoa continua;
- **erro de provedor**: chave errada, Ollama desligado, cota estourada. Diz o
  que fazer, não só que falhou.

## O que não pode quebrar (o app funciona hoje)

- **sem etapa de build.** HTML, CSS e ES modules servidos direto. Nada de React,
  Tailwind, bundler. Sem CDN — o app roda sem internet. Fonte é a do sistema;
- **os `id` e `data-view` do HTML são a fiação.** Estão em `web/index.html`
  (126 linhas — ler primeiro). Pode mudar aparência, estrutura e classe à
  vontade; **`id` que some para o app**. Se precisar mexer em algum, diz qual;
- **tema claro e escuro** por variável CSS, no `:root`. Pode trocar os valores
  e propor tokens novos;
- **celular de verdade**: 375 px sem barra horizontal, alvo de toque de 44 px,
  campo de texto com 16 px (abaixo disso o iPhone dá zoom), área segura do
  notch respeitada. PWA que instala na tela inicial;
- **ícone maskable** (Android corta em círculo).

## O código

**https://github.com/NspxMiguel/IAUnifier** — público.

| arquivo | linhas | o que é |
| --- | ---: | --- |
| `web/index.html` | 126 | a casca; **os `id` e `data-view`** |
| `web/styles.css` | 772 | toda a aparência de hoje e os tokens |
| `web/views.js` | 1153 | o que cada tela desenha |
| `web/app.js` | 1201 | a conversa e o streaming |
| `web/icons.js` | 79 | ícones em SVG inline |
| `web/md.js` | 272 | markdown e bloco de código |

Os eventos de streaming que definem os estados de tela estão em
`server/chat.mjs`, `server/council.mjs` e `server/research.mjs`.

## O que eu quero de volta

O desenho das 8 telas, **em celular primeiro** e depois computador, com a cara
das fotos e os momentos acima resolvidos — e o **CSS pra valer** (e o JS das
animações), não só imagem. Junto, em uma página: o gesto próprio que você
propôs, a lista de animações com duração e curva, e os tokens de tema.

Se sair parecendo "mais um app de chat escuro com azul-acinzentado e cartões",
não é isso. É preto, é pílula, é texto grande, é o vazio bem usado, é
movimento com sentido — é um app que dá pra respeitar.

