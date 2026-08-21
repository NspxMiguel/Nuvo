# Briefing pro Claude Design — a tela Estudos

Isto é pra colar no Claude Design. O que está aqui é o problema e as amarras;
o desenho é com ele.

---

## O que a tela é

Um lugar onde o aluno guarda **um professor por vez** e o material dele, e onde o
Nuvo devolve o material já recortado pelo jeito daquele professor cobrar.

A ideia que sustenta tudo: **prova passada é amostra do que ele cobra; material
de aula é o universo do que ele ensina.** A diferença entre os dois é a previsão.
Nenhum concorrente faz isso — todos resumem o material inteiro.

## O que está errado hoje

A tela funciona e é feia. Especificamente:

- **é uma pilha de cartões**. Quatro abas, e dentro de cada uma uma coluna de
  caixas empilhadas do mesmo tamanho e do mesmo peso visual. Nada diz o que é
  importante;
- **não tem hierarquia**. O nome do professor, a matéria, o contador de material
  e as abas competem em cima, todos no mesmo cinza;
- **a aba "Estudar" é dez cartões iguais** com título, uma frase e um botão. Vira
  um formulário, não uma vitrine;
- **o retrato do professor**, que é a coisa boa do produto, aparece como seções
  de texto com barrinhas — parece relatório, não parece descoberta;
- **o professor não tem cara**. Um círculo com a inicial, e a foto (que já
  funciona) some no meio.

## O que eu olhei antes de escrever isto

**Gemini (gemini.google.com).** Trilha de ícones estreitíssima à esquerda, sem
rótulo. Conteúdo centralizado com muito respiro. Um brilho radial suave atrás,
sem borda nenhuma à vista. Quase nenhum painel, quase nenhuma linha.

**Gemini Notebook / NotebookLM** — é o concorrente direto, e o Miguel **já usa**:
tem notebook de Biologia, Metabolismo Celular, Equações do 2º grau, Português.
Por dentro, três colunas:

| Fontes (~26%) | Conversa (~48%) | Estúdio (~26%) |
| --- | --- | --- |
| lista de arquivos com caixa de seleção pra ligar/desligar da resposta | a conversa, com o campo embaixo | grade 2×N de **ladrilhos de gerar** |

O Estúdio é o que mais interessa: **ladrilhos compactos**, dois por linha, cada um
com ícone, rótulo curto e seta — e **cada ladrilho tem um tom de cor próprio**
(Resumo em Áudio, Apresentação, Resumo em Vídeo, Mapa mental, Relatórios, Cartões
didáticos, Teste, Infográfico, Tabela de dados). Abaixo dos ladrilhos, o que já
foi gerado aparece como linha com play e menu. Cabe muito mais coisa em muito
menos altura do que a minha pilha de cartões, e dá pra bater o olho e escolher.

Cada coluna tem cabeçalho com um botão de recolher. O topo é o título do notebook
mais pastilhas de ação.

## O que tem que caber

**Lista de professores.** Cartão por professor: foto (ou inicial numa cor),
nome, matéria, quanto material tem, e se já existe retrato.

**Dentro de um professor**, quatro coisas que hoje são abas:

1. **Material** — as avaliações de um lado; dentro da avaliação aberta, três
   caixas: *A prova*, *O conteúdo que caiu*, *Material de aula*. A separação
   entre as três é o coração do produto e precisa estar visível, não implícita;
2. **Retrato do professor** — como a prova dele é (nº de questões, formato,
   pontuação), o que ele cobra (tema × peso), o que ele pede (nível de Bloom ×
   peso), os verbos de comando, as pegadinhas, as manias, e **o que ele ensina e
   nunca cobrou**. Cada achado com o **trecho literal da prova** do lado. Mais
   uma nota de confiança que diz na cara quando ainda é palpite;
3. **Estudar** — dez geradores: simulado, guia de estudo, cartões, resumo, mapa
   mental, linha do tempo, conversa em áudio, quiz, infográfico, slides. Cada um
   precisa de uma IA escolhida e um botão. Abaixo, o que já foi gerado;
4. **Revisar** — um cartão por vez, centralizado, com quatro botões de nota que
   mostram pra quando o cartão volta ("Bom · 4 dias").

**As saídas abertas** têm formas bem diferentes: prova com questões e gabarito
dobrável, mapa mental em SVG, slides um por vez, quiz com alternativas que se
pintam, infográfico de uma página, conversa em áudio com as falas alternadas.

## Amarras que não dá pra negociar

- **Zero dependência.** Nada de biblioteca de componente, de ícone ou de gráfico.
  HTML + CSS na mão + SVG desenhado por nós;
- **o CSS já existente é o vocabulário**: `.card`, `.field`, `.grupo`, `.linha`,
  `.tag`, `.segmentado`, `.progress`, `.chat-item`, `.aviso`. Tokens
  `--bg --panel --panel-2 --text --muted --accent --danger --ok --warn`, cores
  temáticas `--indigo --teal --amber --rose --violet --sky --lime --slate`,
  raios `--radius --radius-lg`, tempos `--d1..--d4`;
- **tema claro e escuro**, os dois de verdade;
- **celular**: hoje a coluna de pastas vira faixa que rola de lado. Funciona, mas
  é o pedaço mais fraco;
- **três idiomas**: toda frase passa por `t()` e tem entrada em inglês e
  espanhol. Rótulo curto é melhor: alemão não existe aqui, mas espanhol cresce;
- **toque de 44px** de altura mínima em qualquer coisa clicável;
- o app roda numa janela sem abas e sem barra de endereço — não dá pra contar com
  botão de voltar do navegador.

## O que eu acho que resolve, e ele decide

Trocar as quatro abas por **duas colunas e uma faixa**: material à esquerda,
trabalho no meio, e o Estúdio à direita como no NotebookLM — ladrilhos compactos
e tintados em vez de cartões empilhados. O retrato deixa de ser aba e vira a
primeira coisa que se vê ao abrir o professor, porque é o que o produto tem de
diferente.

Mas isso é palpite meu. O desenho é dele.
