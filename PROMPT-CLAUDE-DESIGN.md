# Prompt pro Claude Design — segunda versão

A primeira versão descrevia o app e deixava o visual em aberto. Não deu certo:
sem referência, saiu genérico. Esta diz **exatamente que cara é**, com foto.

Copiar daqui pra baixo. Anexar as cinco imagens de `docs/design-refs/` junto
(ou apontar pro repositório, que é público).

---

Preciso do desenho de interface de um app chamado **IAUnifier**, e eu sei
exatamente a cara que quero: **o app do ChatGPT e o app do Gemini no iPhone.**
Não "inspirado em" — é esse o alvo. As referências estão anexas e em
https://github.com/NspxMiguel/IAUnifier/tree/main/docs/design-refs

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

**Resumo do que essas telas têm em comum, e é o que eu quero:**
preto de verdade · tipografia grande do sistema (SF/Roboto), sem fonte
decorativa · lista sem borda e sem cartão · pílula pra tudo que se toca ·
**uma** cor de destaque (azul), o resto é preto, branco e cinza · nada de
sombra em caixa, nada de linha separando cabeçalho · o vazio é parte do
desenho.

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
das fotos e os momentos acima resolvidos — e o **CSS pra valer**, não só imagem.
Se sair parecendo "mais um app de chat escuro com azul-acinzentado e cartões",
não é isso. É preto, é pílula, é texto grande, é o vazio bem usado.

