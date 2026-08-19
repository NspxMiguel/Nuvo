# PEDIDOS — IAUnifier

Registro dos pedidos do Miguel, nas palavras dele. Item só sai daqui quando
estiver entregue e conferido.

---

## 16/08/2026 — pedido de criação do projeto

> "cria um app tipo o locally ai. um app mobile e pc, que roda num servidor da
> minha casa, meu pc, windows, mac, linux e etc. ele seria tipo isso, locally ai
> misturado com o projeto do pewripi, onde vc consegue usar ias locais, usa ias
> api, usar ias CLI, opcao de coding, opcao de conversa, opcao de projetos,
> customizar a ia, criar gems, tirar o filtro de ias (n sei se funciona api, mas
> local da) memoria scraping de ias e um monte de coisa. um IA UNIFIER. o melhor
> disso tudo, q as ias vao ter memorias entre si, ou seja, vc pode fala pro
> claude q vc gosta de algo, o chat gpt vai lembrar e etc"

Quebrado em itens:

- [x] 1. "um app mobile e pc, que roda num servidor da minha casa, meu pc,
      windows, mac, linux e etc" — servidor único em Node, sem dependência
      nativa; cliente é PWA (abre no celular e no PC, instalável).
- [x] 2. "vc consegue usar ias locais" — LM Studio, Ollama, llama.cpp, vLLM,
      qualquer endpoint OpenAI-compatível, com descoberta automática na rede
      local.
- [x] 3. "usa ias api" — Anthropic, OpenAI, Google Gemini, Groq, DeepSeek,
      OpenRouter, xAI, Mistral.
- [x] 4. "usar ias CLI" — `claude`, `codex`, `opencode` e qualquer comando
      configurável rodando como provedor.
- [x] 5. "opcao de coding" — modo coding com diretório de trabalho, roteamento
      pros agentes CLI e render de código/diff.
- [x] 6. "opcao de conversa" — modo conversa (chat normal).
- [x] 7. "opcao de projetos" — projetos agrupam conversas, com instrução própria
      e memória de escopo do projeto.
- [x] 8. "customizar a ia, criar gems" — Gems: nome, emoji, system prompt,
      modelo preferido, temperatura, escopo de memória (o emoji virou ícone e cor no
      pedido 14).
- [x] 9. "tirar o filtro de ias (n sei se funciona api, mas local da)" — toggle
      "sem filtro" por Gem. Em modelo local vale de verdade (o system prompt é
      nosso). Em API hospedada o provedor aplica a política dele — está escrito
      na interface, sem prometer o que não dá.
- [x] 10. "memoria scraping de ias" — importador de export do ChatGPT
      (`conversations.json`), do Claude (`conversations.json`) e de markdown
      solto, extraindo fatos pra memória compartilhada.
- [x] 11. "as ias vao ter memorias entre si ... vc pode fala pro claude q vc
      gosta de algo, o chat gpt vai lembrar" — memória compartilhada: um único
      banco de fatos, injetado no prompt de qualquer modelo, gravado por
      qualquer modelo. É o núcleo do produto.
- [x] 12. "um monte de coisa" — busca híbrida (FTS5 + embeddings), troca de
      modelo no meio da conversa, streaming, descoberta automática de IA local
      na máquina, fixar fato na memória, token de acesso pra LAN.

## 16/08/2026 — UI

> "faz uma ui simples, com funcoes e etc, dps usamos o claude desing pra fazer a
> ui pra producao"

- [x] 13. UI crua e funcional, cobrindo todas as funções. O visual de produção
      fica pra depois, com o Claude Design.

## 16/08/2026 — tirar emoji, botar ícone, e encher o app de função

> "tira os emojis pelo menos e coloca icones. deixa o app boladao, cheio de
> coisa legal, um app realmente pra producao, ai nao tem nada alem de ta feio
> kkkk. mas a feiura dps nois resolve, mas ai o app ta cru msm, ta mt simples,
> pesquisa, analiza o codigo do app do pewdipie, analiza lm studio e o locally
> ai e etc. pra tu ve, sao apps completassos, tem de tudo, deixa o app bomzao"

Quebrado em itens:

- [x] 14. "tira os emojis pelo menos e coloca icones" — nenhum emoji na
      interface; conjunto de ícones SVG próprio, inclusive em gem e projeto.
- [x] 15. "pesquisa, analiza o codigo do app do pewdipie, analiza lm studio e o
      locally ai" — pesquisado. Odysseus (pewdiepie-archdaemon/odysseus):
      chat com agentes, deep research multi-passo com relatório, comparação
      lado a lado com teste cego, memória vetorial, gerenciador de modelos
      ciente do hardware, presets, temas. LM Studio: anexo de arquivo com RAG,
      navegador/baixador de modelo, presets por modelo, servidor OpenAI.
      Locally AI: modo de voz no aparelho, system prompt customizável.
- [x] 16. "deixa o app boladao, cheio de coisa legal, um app realmente pra
      producao ... ta cru msm, ta mt simples ... deixa o app bomzao" — o que
      entra:
      - anexo de arquivo com RAG (chunk + índice + citação da fonte);
      - busca na web como ferramenta, sem chave de API;
      - deep research: várias buscas, leitura das páginas e relatório;
      - conselho de IAs: o mesmo prompt em vários modelos e uma síntese;
      - gerenciador de modelo do Ollama (baixar com progresso, remover);
      - medição por resposta (tempo até o primeiro token, tokens/s, total);
      - regenerar, editar e apagar mensagem;
      - parâmetros por conversa (system, temperatura, top_p, limite);
      - busca em todas as conversas;
      - exportar conversa em Markdown e JSON;
      - voz: ditado e leitura da resposta;
      - tema claro e escuro, paleta de comandos e atalhos de teclado;
      - Markdown de verdade, com código destacado e bloco de raciocínio.

> "mas a feiura dps nois resolve"

O visual de produção continua sendo do Claude Design; o que entra agora é
função e estrutura, não desenho.

## 16/08/2026 — apresentação para investidor

> "apresente o projeto para um investidor"

- [x] 17. Deck de apresentação do IAUnifier para investidor, em `pitch.html`.
      Só entra número que dá pra provar: o produto existe e foi testado, mas
      não há usuário, receita nem time — isso fica escrito no próprio deck em
      vez de ser preenchido com estimativa inventada. Dado de mercado sai com
      a fonte junto.

> "apresente a ideia n visualmente"

- [x] 18. A mesma apresentação em texto, na conversa, sem página. O deck
      continua no repositório pra quando ele quiser mostrar.

## 16/08/2026 — levar o app até quase produção

> "n tem investidor nenhum, so queria ouvir vc falando pra eu ver se ideia bate
> com a minha. vamo faze o app entao..... fica fazendo o app, até ele estar
> praticamente pronto pra producao, tudo funcionando e testado. pra dai eu fazer
> o desing com claude desing"

- [x] 19. Bateria de testes automatizados de verdade (`node --test`), cobrindo
      extração de arquivo, memória, chunking, rotas da API, adaptadores,
      conselho e pesquisa. — 155 testes, `npm test`, sem dependência de teste.
      Acharam quatro defeitos reais: página de PDF curta descartada, dedupe de
      memória que não enxergava acento, último resultado da busca web engolido
      pelo regex, e "regenerar" apagando a pergunta junto com a resposta.
- [x] 20. Robustez: limite de tamanho, tempo máximo, provedor que cai no meio
      da resposta, duas requisições na mesma conversa, transação onde importa.
      — corpo limitado a 64 MB; vigia que corta modelo travado (240 s até o
      primeiro pedaço, 120 s entre pedaços) e grava o que já tinha chegado;
      uma resposta por conversa, com 409 na segunda; anexo e trechos em
      transação; ping SSE a cada 15 s.
- [x] 21. Segurança de rede local: restringir CORS, proteger o token contra
      tentativa repetida, revisar caminho de arquivo. — origem aceita só a
      própria máquina e a LAN; token comparado em tempo constante, com 20
      tentativas por minuto por IP; caminho de estático e de anexo restaurado
      não escapa da pasta.
- [x] 22. Operação: subir sozinho junto com a máquina (launchd, systemd,
      agendador do Windows), backup e restauração dos dados. — `iaunifier
      instalar-servico`; backup em zip com banco, config e anexos, com cópia
      automática diária (sete guardadas) e restauração validada.
- [x] 23. Arremates de produto: renomear conversa, ver arquivadas, primeira
      abertura guiada, checar saúde do provedor, mensagem de erro que explica
      o que fazer. — todos entregues; a saúde do CLI dispara o binário de
      verdade, e o erro do provedor vira instrução ("abra o Ollama", "gere uma
      chave nova", "espere ou troque de modelo").

O desenho continua sendo dele com o Claude Design — o que entra aqui é
funcionamento e teste.

## Pendências abertas

- [x] Empacotar como app nativo (Electron no PC, Capacitor no celular) —
      resolvido de outro jeito em 16/08/2026, sem Electron nem Capacitor:
      `iaunifier instalar-app` cria o atalho com ícone (`IAUnifier.app` no
      macOS, `.desktop` no Linux, Menu Iniciar no Windows) e abre o navegador
      da máquina em modo aplicativo — janela sem abas e sem barra de endereço.
      Empacotar um Chromium custaria centenas de megabytes e a primeira
      dependência do projeto, num app cuja interface é a mesma no PC e no
      celular. A janela pertence ao navegador: é a diferença que sobra, e está
      escrita no README.
- [x] Portar a landing pra `https://www.nspx.dev/IAUnifier/` — feito em
      16/08/2026: página em `docs/`, GitHub Pages ligado no repositório
      `NspxMiguel/IAUnifier`, endereço conferido no domínio (200, sem link
      absoluto pro github.io). O app em si roda no servidor da casa, não em
      host estático.

### Conferido rodando de verdade (16/08/2026)

Não é só teste automatizado: o app foi exercido contra modelo e web reais.

- **memória compartilhada, que é a ideia do projeto** — contei ao Claude Code
  CLI que meu domínio é `nspx.dev`; numa conversa nova, com o Codex CLI (outro
  modelo, outro fornecedor), a pergunta "qual é o meu domínio?" foi respondida
  com "Seu domínio é nspx.dev";
- **conselho** — os dois CLIs responderam em paralelo à mesma pergunta;
- **pesquisa profunda** — planejou duas consultas, leu três de quatro páginas
  (a quarta devolveu 403 e apareceu como não aberta) e citou as fontes;
- **instalação limpa** — sobe, descobre os provedores da máquina, semeia as
  gems, exige token e devolve 401 sem ele;
- **interface** — todos os painéis, tema claro e escuro, gaveta do celular, sem
  erro de console.

## Pedidos de 16/08/2026 (noite)

- [x] *"me avisa quando for pra criar no claude desing"* — avisado em
      17/08/2026, com o app funcionando e testado. O que sustenta o aviso:
      264 testes automatizados; as quatro rotas de stream (conversa, refazer,
      conselho, pesquisa profunda) exercidas contra modelos de verdade nesta
      máquina; PDF anexado lido e respondido por um modelo, com acento certo;
      leitor de PDF conferido contra o `pypdf` nos arquivos reais do computador
      dele e contra 29 arquivos hostis; celular a 375x812 sem estouro em nenhum
      dos oito painéis, sem campo abaixo de 16px e sem alvo de toque pequeno.

      Fica de fora, por ser mudança de arquitetura e não conserto: HTTPS na rede
      local (sem ele o Android não oferece instalar) e ícone maskable com zona
      de segurança.
- [x] *"funcionando em mobile ja?"* — conferido em 16/08/2026 no navegador a
      375x812, com o app rodando: gaveta abre e fecha, os oito painéis abrem sem
      estouro horizontal, conversa e composição funcionam, tema claro e escuro.
      Três defeitos de celular achados e corrigidos na hora: seletor de modelo
      cortado no meio do nome, tema ignorando o do aparelho, e cor da barra do
      navegador fixa no escuro por cima da página clara.

### Auditoria de celular (16/08/2026)

Quatro frentes — layout, toque, teclado virtual e PWA — cada achado conferido
por um segundo agente antes de valer. 25 confirmados, 7 derrubados. Corrigidos:

- **toque**: nenhum alvo abaixo de 38 px em nenhum painel (eram 41 abaixo de 44,
  com botões de 26x26 e o "x" do anexo em 16x16); ações de renomear/fixar/
  arquivar/apagar conversa passam a aparecer sem hover; véu atrás da gaveta, que
  fecha ao tocar fora; `aria-label` em todo botão de ícone; apagar fato da
  memória pede confirmação, como os outros apagares já pediam;
- **teclado**: todo campo em 16px (abaixo disso o iOS amplia a página ao focar e
  não desfaz); Enter só envia onde existe Shift — no celular a tecla de retorno
  quebra linha e o envio é no botão; a altura do app segue o `visualViewport`,
  senão o campo de escrever fica atrás do teclado; o foco volta pro campo depois
  de enviar; crescer o campo não empurra mais a última mensagem pra fora;
- **layout**: chip de anexo com nome comprido não joga o "x" pra fora da tela;
  fato de memória sem espaços (chave, hash) não estoura a linha; tabela de
  markdown volta a rolar de lado em vez de se espremer; aviso deixou de cobrir o
  botão de enviar e de engolir o toque; gaveta respeita a área segura do iPhone;
- **PWA**: `start_url` do manifest leva o token (o atalho na tela inicial abria
  num pedido de senha), e o manifest passou a exigir token pra ser servido, já
  que agora tem um dentro; `id` fixo pra não duplicar a instalação; meta
  `mobile-web-app-capable`; o aviso do terminal parou de prometer instalação que
  o Android não faz em HTTP.

Ficou de fora, por ser mudança de arquitetura e não conserto: servir HTTPS na
rede local (sem ele o service worker não registra e o Chrome não oferece
instalar) e trocar o ícone maskable por um com zona de segurança.

### Auditoria de servidor (16/08/2026)

Mesma forma da de celular: achado só vale depois de reproduzido. Cada um foi
provado com um caso que falhava antes e passa depois. Corrigidos:

- **markdown** — comentário com número dentro (`// espera 30 segundos`) sumia da
  tela: a passada de destaque reescrevia o que a anterior tinha marcado. Agora
  cada trecho pronto vira um marcador que as passadas seguintes não enxergam.
  Link com parêntese no endereço deixou de gerar `<a>` aninhado com atributo
  vazando pra fora da tag;
- **prazo do stream** — a corrida entre o pedaço e o relógio deixava a promessa
  perdedora sem tratamento, e uma fonte que ignora o `abort` pendurava o pedido
  pra sempre. O corpo do stream passa a ser fechado no `finally`, em vez de o
  soquete ficar preso até o servidor do modelo desistir;
- **CLI** — prompt grande derrubava o processo com EPIPE, e matar o comando
  deixava neto vivo. Agora o filho nasce em grupo próprio e morre em grupo,
  com SIGKILL três segundos depois do SIGTERM;
- **restaurar backup** — escrever por cima do banco aberto não restaurava nada:
  a conexão devolvia as páginas antigas. O banco restaurado espera num arquivo
  à parte e a troca acontece no start seguinte, guardando o anterior;
- **índice de texto** — a checagem que decidia reconstruir o FTS5 usava
  `COUNT(*)`, que numa tabela de conteúdo externo devolve o total do conteúdo e
  não do índice. Buscas voltavam vazias com o índice vazio e a conta cheia;
- **PDF** — fonte, imagem e metadado entravam como texto do documento (até 60%
  de lixo não imprimível); **codificação** — arquivo em windows-1252 deixou de
  virar caractere trocado; **EPUB** — capítulos passam a ser lidos como XHTML e
  na ordem numérica;
### Auditoria do leitor de PDF (17/08/2026)

Nove agentes em paralelo — geradores reais da máquina, arquivos hostis e revisão
do código por lentes diferentes — sobre a correção de acento do dia anterior.
Acharam 56 problemas; a fase de verificação não chegou a rodar (a conta bateu no
limite de gasto do mês), então cada um foi conferido à mão contra o corpus de 15
casos que um dos agentes montou e validou com o pypdf.

O saldo foi uma reescrita do leitor do fluxo de conteúdo, de expressão regular
para analisador símbolo a símbolo, mais o mapa de fontes por página:

- **espaço entre palavras** — diagramador não escreve o espaço, desloca a
  próxima palavra. Sem ler esse deslocamento, "Bem vindo ao Brasil" chegava ao
  modelo como "BemvindoaoBrasil" — em qualquer PDF de revista, contrato ou
  artigo;
- **PDF do Chrome** — cada pedaço da mesma linha é posicionado em separado, e
  isso era lido como troca de linha: a página saía com 137 linhas de um
  caractere. Passou a sair com 14 linhas;
- **parêntese na frase** — "total (com desconto) aprovado" virava "com
  desconto": a leitura parava no primeiro fecha-parêntese;
- **duas páginas, o mesmo /F1** — o apelido da fonte é local da página, e era
  resolvido uma vez pro documento inteiro: página de outra origem saía com as
  letras da fonte errada;
- **página em vários fluxos** — /Contents com lista tinha só o primeiro pedaço
  lido, e a fonte escolhida nele não valia no seguinte;
- **T\*** — o operador que troca de linha nunca era reconhecido, porque a busca
  exigia fronteira de palavra depois do asterisco e ali não existe nenhuma;
- **string hexadecimal em fonte comum** — `<41424344>` virava dois ideogramas
  chineses em vez de "ABCD";
- **largura do código no /ToUnicode** — tirada do cabeçalho, que gerador
  costuma declarar errado; passou a sair das próprias entradas do mapa. Do jeito
  anterior, o texto inteiro de alguns PDFs sumia;
- **ligadura** — o glifo "ﬁ" é um caractere só, e quem procura "confirmação"
  não digita ele: o documento ficava invisível pra busca por palavra;
- **custo** — 29 arquivos hostis, todos dentro do aceitável agora: 4 MB que
  levavam 39 s levam 106 ms; 30 MB que viravam 527 MB de texto têm teto; mapa
  de caracteres com 400 faixas de 65 mil entradas tem teto; e a exceção que
  escapava do extrator (`RangeError` ao juntar os dicionários num string só)
  deixou de existir.

### Leitura de página da web (17/08/2026)

Exercida contra a internet de verdade, não só contra dublê:

- **página de blog perdia tudo menos o primeiro item** — cada notícia num
  `<article>`, e a busca casava o primeiro que aparecesse. De três posts na
  página, um chegava ao modelo. O `https://www.nspx.dev/` era um dos afetados:
  saía com zero caractere, agora sai com 1.170;
- **entidade numérica impossível derrubava a leitura** — mesma causa do EPUB,
  em outro arquivo;
- **página montada por JavaScript** saía vazia sem motivo, e modelo que recebe
  página vazia conclui que o assunto não existe. Agora a nota diz o que houve.

- **entidade quebrada em EPUB** — `&#99999999;` não é caractere nenhum, e
  converter isso responde com exceção. Num livro convertido por ferramenta, e
  eles têm, a exceção subia até o upload e derrubava o pedido inteiro. Agora a
  entidade impossível fica na tela como veio, e metade de par substituto — que
  vira losango na volta do banco — some em vez de corromper calada;
- **rede de segurança na leitura** — cada leitor desmonta formato binário
  escrito por outra pessoa. Qualquer coisa que escape vira aviso no anexo, não
  erro no pedido;
- **/Length ignorado** — o fim do fluxo era achado procurando a palavra
  `endstream`, e fluxo sem compressão pode ter esses nove bytes dentro do
  próprio texto: a página era cortada ali, calada. Agora vale o tamanho
  declarado, quando ele confere;
- **CMap incompleto** — mapa que cobre parte dos códigos fazia o resto sumir.
  O que ele não cobre cai na tabela que a fonte declarou;
- **cadeia de filtros** — `/Filter [ /ASCII85Decode /FlateDecode ]` tem o
  ASCII85 como primeiro passo, e ele não era desfeito: a tentativa de
  descomprimir a codificação falhava e a página inteira era dada como
  digitalização em imagem. É o caso dos certificados que estão no Downloads
  dele, que saíam vazios e agora saem com o nome.

Medido de duas formas. Corpus de 15 casos montados à mão: 5 certos antes, 12
depois — as 3 diferenças que sobram são escolhas minhas, não erros (ligadura
desfeita de propósito, e dois fluxos da mesma página separados por uma quebra
em vez de duas). E os 11 PDFs de verdade que existem nesta máquina, comparados
com o `pypdf` como referência externa: 6 melhoraram, nenhum piorou. Os três
piores saíam com 0%, 22% e 46% das palavras que o pypdf acha, e com mais de mil
e seiscentas palavras inventadas cada um — metadado do arquivo vazando pro
texto; passaram a sair com 94–95% e menos de dez.

- **acento em PDF** — os bytes do fluxo eram lidos como latin1 puro, ignorando o
  `/Encoding` e o `/ToUnicode` que a fonte declara. Num PDF impresso no Mac,
  onde `ó` é o byte 0x97, saía `relat—rio`; num PDF do Windows, aspa curva e
  travessão viravam controle invisível; e em fonte de subconjunto — a que sai de
  qualquer gerador moderno, com os glifos numerados a partir de 1 — não saía
  nada, porque aqueles bytes não são texto em codificação nenhuma sem o mapa.
  Um arquivo gerado aqui na máquina saía com 7,2% de lixo e 14 das 32 palavras;
  passou a sair com 0% e todas as 32;
- **resposta vazia** não é mais gravada como sucesso, e o extrator de memória
  tem prazo próprio: modelo mudo deixou de prender a conversa;
- **conversa cancelada antes de começar** — junto com o conserto do stream vazio
  entrou uma linha que tratava `req.closed` como "o navegador desistiu". Num
  POST o pedido fecha quando o corpo termina de ser lido, que é uma linha antes:
  todo turno era cancelado antes da primeira letra, em todos os provedores. Só
  apareceu ao conversar com um modelo de verdade — os 250 testes passavam,
  porque stub nenhum olhava o sinal de cancelamento. Quem avisa que a aba fechou
  é a resposta, não o pedido;
- **permissões** — backup e `config.json` nascem 600, e a pasta de dados 700:
  os dois carregam as chaves de API;
- **anexo curto** ia duplicado ao modelo, e a última linha do documento se
  perdia quando o pedaço final era curto demais;
- **trocar o modelo de embedding** apagava a busca por significado em silêncio:
  vetor gerado por um modelo não tem sentido nenhum na régua de outro, mas
  continuava sendo comparado. Cada vetor passa a carregar o carimbo de quem o
  gerou, o que ficou pra trás é ignorado na busca, e a Configuração mostra
  quantos itens estão fora do índice com um botão que recalcula em lotes.

### Extração de memória (17/08/2026)

Auditoria do item 10 (memória scraping de IAs). O importador em si passou nos
sete formatos reais de exportação que testei — ChatGPT com imagem no meio da
mensagem, ChatGPT com bloco de raciocínio (que não pode vazar pra memória),
Claude com `tool_use`, conversa vazia, lista vazia, JSON que não é exportação,
e markdown solto — mais uma importação de ponta a ponta pelo servidor rodando
(`POST /memories/import`: 2 conversas, 4 mensagens, 4 memórias antes e 6
depois). Não precisou de correção nenhuma ali.

O defeito estava no extrator heurístico, que é o que roda enquanto não há
modelo extrator configurado — ou seja, o que todo mundo pega na primeira vez:

- **negação gravava o oposto do que foi dito.** Os padrões começam no verbo,
  então "eu não gosto de café" casava a partir de "gosto" e a memória guardava
  "gosto de café". Cinco de oito frases negadas saíam invertidas: `não gosto`,
  `não moro`, `nunca gosto`, `jamais trabalho`, `nem`. Numa memória que é
  compartilhada e permanente isso não fica na conversa — o fato invertido passa
  a valer pra todo modelo, em toda conversa seguinte, e quanto mais tempo passa
  menos dá pra saber de onde veio. Agora um `não`/`nunca`/`jamais`/`nem` colado
  no verbo bloqueia a extração, sem calar o resto: "Eu gosto de café. Não sei se
  isso importa." continua virando fato, e "nunca me mande emojis" também, porque
  ali o `nunca` é o próprio fato e não o que o anula;
- **projeto em andamento não era capturado.** "Estou construindo o IAUnifier"
  não casava com padrão nenhum, e é o tipo de frase que continua verdadeira
  daqui a meses. Entrou uma lista fechada de verbos (`construindo`,
  `desenvolvendo`, `criando`, `fazendo`, `montando`, `escrevendo`) — fechada de
  propósito: em memória permanente, errar pra mais custa mais caro que deixar
  passar, e o modelo extrator cobre o caso geral quando está configurado.

Ficou de fora por decisão: `uso X` / `utilizo X`. Pega "uso Node sem dependência
nenhuma", mas pega também "uso isso pra testar", e não achei como separar os
dois sem heurística frágil.

### Conselho de IAs — votação (17/08/2026)

O rodízio que embaralha as candidatas para cada jurado está certo: montei três
modelos onde cada jurado reconhece as respostas pelo texto e dá 10, 5 e 1, e a
nota chegou no dono certo nos três. Virou teste, porque é o tipo de erro que
produz um placar plausível e trocado.

O defeito estava na apuração:

- **jurado fora da escala decidia a votação sozinho.** A nota pedida é de 0 a 10,
  mas modelo local devolvendo de 0 a 100 é comum — e nada conferia. Com três
  modelos, um jurado usando 0-100 fez vencer justamente a resposta que os outros
  dois puseram em último: média 28 contra 13,3. Cédula fora da escala agora é
  anulada inteira, não ajustada — cortar 80 em 10 manteria o voto errado com
  peso máximo, e o que não dá pra ler não vota. Depois do conserto, no mesmo
  cenário, vence quem dois dos três escolheram. A tela de notas diz quantos
  votos foram anulados, em vez de esconder.

Fica registrado como decisão, não como pendência: **cada modelo continua votando
também na própria resposta.** Tirar o voto de si mesmo parece mais justo, mas com
dois modelos sobraria um voto por candidata, e nota sem comparação não vale nada.
O anonimato das candidatas é o que segura o viés.

### Pesquisa profunda (17/08/2026)

- **metade da pesquisa planejada não era lida.** O plano quebra a pergunta em
  ângulos diferentes de propósito — definição, dado atual, comparação, crítica —
  mas a leitura pegava as páginas na ordem em que as buscas voltaram, e o teto de
  12 páginas acabava nos dois primeiros ângulos. Com 4 consultas de 6 resultados,
  o terceiro e o quarto não eram lidos nunca: medi 12 páginas lidas de 2 ângulos
  só, e o relatório saía citando 12 fontes que vinham todas das mesmas duas
  buscas. Agora a leitura vai em rodízio — o primeiro resultado de cada consulta
  antes do segundo de qualquer outra — e os quatro ângulos entram com 3 páginas
  cada. O teste falha contra a versão antiga (`só 2 ângulo(s) chegaram à
  leitura`), que é o que garante que ele mede alguma coisa.

Conferido e sem defeito: a numeração das citações bate com a lista de fontes (as
duas saem da mesma lista de páginas aproveitadas), e falha do modelo na hora de
escrever o relatório já vira evento de erro na tela — o `pump` da API cobre, não
derruba a conexão.

### Backup e restauração (17/08/2026)

Auditoria do que guarda tudo — conversas, memória, gems, projetos, chaves. Achei
três defeitos, todos no caminho de restaurar:

- **backup corrompido era aceito e virava o banco novo.** O zip guarda uma soma
  de verificação em cada entrada, e o escritor calculava certinho — só que a
  leitura nunca conferia. Medi: de 40 backups com **um único byte trocado**, 38
  passavam, e o banco que ia tomar o lugar do atual vinha malformado (o próprio
  SQLite respondia "database disk image is malformed"). Pendrive, disco velho ou
  sincronização de nuvem bastam pra produzir esse byte. Agora confere, e passam
  0 de 40, com mensagem dizendo qual arquivo não bateu;
- **banco quebrado dentro de zip íntegro passava.** A soma de verificação prova
  que o zip chegou inteiro, não que o banco lá dentro presta — backup vindo de
  outra máquina, de versão antiga ou de disco que já tinha defeito continua com
  o cabeçalho "SQLite format 3" no lugar. Entrou uma segunda camada: o arquivo é
  escrito de lado, quem responde é o próprio SQLite (`PRAGMA quick_check`), e só
  depois de passar é que ele é encostado pra troca. Recusar é perder a
  restauração; deixar passar é perder o banco que estava funcionando;
- **zip forjado vazava erro de memória.** Deslocamento apontando pra fora do
  arquivo subia `RangeError: value of "offset" is out of range... Received
  2147483658` — que é o que o usuário lia ao subir um arquivo errado. Os
  deslocamentos passaram a ser conferidos contra o tamanho do arquivo e a
  mensagem virou "o arquivo zip aponta pra fora de si mesmo".

Os três testes falham contra a versão anterior, que é o que garante que medem
alguma coisa. Nenhum deles deixa arquivo pra trás quando recusa.

Conferido e sem defeito: `basename` já cortava `../` de zip forjado, a troca do
banco continua acontecendo só no próximo start (com o anterior guardado), o
backup automático guarda 7 dias e a ordem alfabética do nome é a ordem
cronológica.

### Permissões da pasta de dados (17/08/2026)

Reparei olhando a instalação de verdade: `~/.iaunifier` estava `drwxr-xr-x` —
aberta pra qualquer usuário da máquina. Não é defeito de código: o conserto que
aperta a pasta já existe e roda na subida, e essa instalação não foi aberta
desde então. Conferi criando uma pasta 755 de propósito e subindo o servidor:
virou 700 sozinha. **Basta ele abrir o app uma vez que corrige.**

O que estava mesmo faltando, e entrou agora:

- **a pasta `uploads/` nunca era apertada** (ficava 755) e o **`data.db` nascia
  644**, junto com o `-wal`, que guarda as páginas ainda não fundidas e é tão
  legível quanto o banco. Enquanto a pasta de dados for 700 nada disso está
  exposto — mas `--home` aceita qualquer caminho, e pendrive, pasta
  sincronizada e volume de rede não guardam modo posix. Lá dentro está a
  conversa com todas as IAs e os anexos, que é o mesmo motivo que já fazia o
  `config.json` nascer 600. Agora os quatro são apertados na subida, e o teste
  falha contra a versão anterior.

### Tranca do token (17/08/2026)

Ataquei o servidor rodando de verdade, com token ligado, pelo endereço público
dele na máquina. O que resistiu, e fica registrado como conferido: travessia de
caminho no estático não passa em nenhuma das cinco formas que tentei
(`../`, `..%2f`, `%2e%2e`, `./../`, prefixo falso — todas 404); a API devolve
401 sem token e com token errado; o limite de tentativas por IP funciona, 429
depois de 20; e a contagem é pelo endereço do soquete, não por cabeçalho, então
não dá pra fingir outro IP.

O defeito estava na cobertura do limite:

- **dava pra martelar o token por outra porta.** O limite valia só em `/api/`,
  mas o `/manifest.webmanifest` confere exatamente o mesmo token — e ali eram
  tentativas infinitas: 40 erradas seguidas, 40 vezes 401, nenhum 429. Proteção
  que se contorna por outra porta não protege. As duas rotas passaram a usar a
  mesma tranca; medi de novo no servidor rodando e agora o manifest devolve 429
  na vigésima primeira, e o token bom volta a valer quando a janela de um minuto
  passa.

### Conferência no navegador de verdade (17/08/2026)

Com tudo aplicado, subi o servidor e conferi como o visitante vê. Todas as 12
rotas da API respondem (`/api/models` dá 404 de propósito: modelo é sub-rota de
provedor), os 5 arquivos da casca abrem, e a subida não escreve erro nenhum no
log. No Chrome dele: as 8 telas — Conversas, Conselho, Pesquisa, Projetos, Gems,
Memória, Provedores, Config — abrem sem um erro de console entre elas, o service
worker registra no escopo `/` e guarda os 11 arquivos da casca.

Fica anotado pra não me enganar de novo: **o painel de navegação embutido do
Claude recusa registrar service worker** mesmo em contexto seguro, com o
`/sw.js` respondendo 200. Parecia defeito meu; no Chrome de verdade registra
limpo. Verificação de PWA — instalação, cache, manifest — só vale feita no
navegador dele.

### Prompt pro Claude Design (18/08/2026)

*"prompt pro claude desing"*

Escrito em `PROMPT-CLAUDE-DESIGN.md`, na pasta do projeto. Levantei o inventário
do app antes de escrever, pra ele não sair genérico: as 8 telas conferidas no
`index.html`, os 33 tokens de tema conferidos no `styles.css`, os `id` que são a
fiação do JavaScript.

O prompt diz três coisas que eu não deixaria de fora:

- **a memória compartilhada é a ideia**, não mais um item de menu. Se o desenho
  tratar como aba comum, perdeu o ponto do app;
- **os momentos difíceis vêm nomeados** — conselho com colunas enchendo em
  velocidades diferentes, placar da votação, andamento da pesquisa que cresce
  por 40 segundos, streaming com bloco de raciocínio gigante, primeira abertura
  sem modelo nenhum, erro de provedor. É onde desenho decide alguma coisa;
  formulário qualquer um faz;
- **o que não pode quebrar**: sem etapa de build, sem CDN (o app roda sem
  internet), e os `id`/`data-view` são a fiação — pode mudar aparência,
  estrutura e classe à vontade, mas `id` que some para o app. É o aviso que mais
  facilmente ficaria de fora e o que custaria mais caro.

Falei que a paleta de hoje não é decisão de desenho, é o que saiu de escrever o
app às pressas — e que ela parece "mais um app de chat escuro com azul". Ele que
decida se troca.

### Recuperação de memória (18/08/2026)

O caminho que sustenta a ideia do app. Duas medidas primeiro, pra saber se ele
funciona do jeito que **você** escreve, sem acento:

- montei oito fatos com acento (como o extrator grava) e perguntei sem acento
  ("qual e o meu dominio", "voce lembra da minha maquina", "pq n usar
  dependencia"). **7 de 8 acharam o fato certo.** O FTS5 tira acento sozinho, e
  isso agora está conferido em vez de suposto;
- a que perdeu foi "quais projetos eu tenho" contra "Trabalho com TrainerKit,
  nspx e Cadenza": nenhuma palavra em comum. Não é defeito da busca, é o limite
  de procurar por palavra — e é exatamente o que o embedding resolve. Vale
  lembrar que **embedding vem desligado de fábrica**, então todo mundo começa
  com busca por palavra só.

O defeito estava no orçamento:

- **memória fixada engolia a busca em silêncio.** O teto é 12 memórias
  injetadas, e os fixados entravam primeiro, até 12. Com doze recados fixados —
  coisa de meses de uso — a busca parava de aparecer **inteira**: o fato do seu
  domínio, casando palavra por palavra, não chegava ao modelo, e nada na tela
  dizia que a memória tinha parado de procurar. Fixar quer dizer "isto sempre
  entra", não "só isto entra". Agora o fixado leva no máximo metade do orçamento
  enquanto houver busca pra dividir, e o resto dele entra logo depois — ninguém
  perde o lugar, só a ordem muda. Sem resultado de busca, o fixado continua
  ficando com tudo, pra não desperdiçar espaço.

### Corte de histórico (18/08/2026)

- **toda conversa passada de 40 mensagens mandava uma resposta órfã na frente.**
  O modelo recebe as últimas 40 mensagens, e o corte cai onde calhar. Como a
  pergunta da rodada atual já está gravada quando o corte acontece, a contagem
  fica ímpar — e a janela de 40 começa num `assistant`: uma resposta sem a
  pergunta que a gerou. Não é caso de canto, é o caso normal; o teste que já
  existia media 40 mensagens enviadas e passava porque conferia a quantidade,
  nunca o papel da primeira.

  O tamanho do estrago depende do provedor: a API da Anthropic recusa de saída
  (*"first message must use the user role"*) e a conversa **para de funcionar**
  até o corte andar sozinho; nos outros passa, e o modelo lê a resposta órfã
  como se fosse contexto. Agora a janela é aparada até a primeira pergunta —
  custa uma mensagem — e o aviso na tela passa a dizer quantas foram de verdade
  (39, não o teto de 40).

Achado que não virou conserto, anotado pra depois: o limite é de **quantidade de
mensagens, não de tokens**. Quarenta mensagens longas estouram a janela de um
modelo local de 4k ou 8k, e aí quem recusa é o modelo. Um teto por tamanho seria
o certo, mas mexer nisso sem medir com modelo local de verdade é troca de um
problema por outro.

**Ressalva sobre o parágrafo acima:** a recusa da API da Anthropic é o que a
documentação dela diz, não uma medição minha. Não dá pra medir nesta máquina:
você não tem provedor de API da Anthropic configurado — só os três de CLI
(Claude Code, Codex, OpenCode) e uma chave da Groq. O conserto vale igual, porque
resposta sem pergunta na frente é contexto errado em qualquer provedor; o que eu
não posso afirmar por medição é o "para de funcionar".

Isso expõe outra coisa que fica anotada: **o adaptador `anthropic.mjs` nunca foi
exercitado contra a API de verdade** nesta instalação, só contra teste com rede
encenada. O mesmo vale pro `google.mjs`. Quando você ligar uma chave dessas, o
primeiro turno merece ser olhado de perto.

### Documentos no prompt (18/08/2026)

- **projeto com vários arquivos estourava o prompt, e sempre igual.** Anexo
  "curto" (até 6 mil caracteres) entrava inteiro, o que é certo pra um arquivo
  de duas páginas. Só que curto é medida **por arquivo**, e Projetos é
  exatamente onde se junta arquivo. Medi: 1 anexo dá 5 mil caracteres, 5 dão 25
  mil, 10 dão 51 mil, **20 dão 103 mil — uns 26 mil tokens** de prompt antes de
  a conversa começar. E entravam todos, toda vez, **independentemente da
  pergunta**: anexo curto pulava a busca inteira.

  Modelo local de 8k não recebe isso, e em API é a conta subindo por causa de
  arquivo que ninguém citou. Entrou um teto pro bloco todo (24 mil caracteres).
  O teto **não descarta documento**: o que não couber inteiro volta pra busca
  por trecho, junto com os longos, e entra se a pergunta pedir. Conferi com uma
  nota escondida no meio de vinte — perguntando pelo assunto dela, ela chega por
  trecho; o bloco caiu de 103 mil pra 22 mil caracteres e passou a depender da
  pergunta. Anexo único continua entrando inteiro, que é o caso comum e não
  podia piorar.

O número 24 mil é meu, não seu: é o que sobra folga pra 40 mensagens de
histórico e 12 memórias num modelo de 8k. Se for pouco quando você usar modelo de
contexto grande, isso vira ajuste na Configuração — não mexi na tela agora pra
não colidir com o Claude Design.

### Repositório pro Claude Design (18/08/2026)

*"sobe projeto no github pro claude desing analiza codigo"*

Já estava no GitHub e já era público — `NspxMiguel/IAUnifier`, tudo sincronizado,
nada pendente. Então o trabalho foi outro: conferir que dá pra ler de fora com
segurança, e dizer ao Claude Design onde olhar.

**Auditoria do que está exposto** (o repositório é público, então isso importa
mais do que o resto): nenhuma chave, token, `.env` ou credencial no diretório de
trabalho **nem no histórico inteiro** — procurei por `sk-`, `ghp_`, `gsk_`,
`AIza`, `xox`, chave privada PEM e valor literal de `accessToken`. O
`.gitignore` cobre banco, WAL e a pasta de dados. As quatro citações suas que
estão no `PEDIDOS.md` público são inofensivas ("funcionando em mobile ja?",
"prompt pro claude desing") — fica dito porque é público, não porque é problema.

**O que entrou:** o `PROMPT-CLAUDE-DESIGN.md` agora leva o endereço do
repositório e um mapa dos seis arquivos de `web/` com linha e responsabilidade,
começando pelo `index.html` porque é onde estão os `id` que não podem sumir.
Conferi que os quatro principais abrem sem login (200 no raw do GitHub).

## 18/08/2026 — refazer o desenho da interface

*"recrie o claude desing, ficou ruim.. vo manda refs"*

O Claude Design não entregou. As referências que ele mandou são o aplicativo do
ChatGPT no iPhone (duas capturas + uma gravação de tela): preto de verdade,
lista sem borda nenhuma, texto grande, botão-pílula azul flutuante, campo de
escrever redondo. A tarefa vira minha: redesenhar o `web/` inteiro nesse
espírito, sem quebrar a fiação (`id`, `data-view`) e sem etapa de build.

*"era pra recria o prompt..."*

Entendi errado o pedido anterior e comecei a redesenhar o CSS. Parei. O que fiz
até ali ficou guardado no branch `redesenho-chatgpt-gemini` (não está na `main`)
— serve de rascunho se você quiser, e some sem custo se não quiser.

O prompt novo está em `PROMPT-CLAUDE-DESIGN.md`. A diferença pro primeiro é uma
só, e é a que faltava: **referência visual**. O primeiro descrevia o app e
deixava a cara em aberto; este diz "é o ChatGPT e o Gemini do iPhone", anexa as
cinco fotos que você mandou (recortadas do vídeo e das capturas, em
`referencias-design/`) e descreve cada uma ponto por ponto — preto de verdade,
lista sem borda, pílula, uma cor só, brilho atrás do campo de escrever. As
restrições técnicas e o mapa de arquivos continuam.

*"adiciona ao prompt deixa algo bem simplificado, minimalista, o suficiente para
ser facil para leigos, mas tbm ser confortavel para entendentes. outra coisa
legal q podemos copiar do lm studio. ele puxa os modelos q cabem na sua
maquina, e recomenda os melhores pra ela. fala oq é melhor em cada, e porque
escolher um e nao outro. aquela animação ali do gemini eu gostei viu, poderia
ter algo parecido. ainda ta bem diferente das referencias, nao ta legal nao
esse app q vc fez. parece um app generico feito com ia... nos queremos algo
bom, bonito, minimalista, facil pro usuario, e o mais importante,
personalidade, animaçÕes, um app realmente respeitavel"*

Quatro coisas separadas aqui:

1. **no prompt:** simplicidade em camadas — leigo não tropeça, quem entende
   não fica preso; minimalista;
2. **no prompt, e depois no servidor:** a ideia do LM Studio — puxar os modelos
   que cabem na máquina dela e recomendar os melhores, dizendo o que cada um
   faz bem e por que escolher um e não outro;
3. **no prompt:** a animação do Gemini (o brilho que respira atrás do campo, e
   a estrela) — quer algo parecido;
4. **veredito sobre o meu rascunho:** ficou genérico, "app feito com IA", longe
   das referências. Falta personalidade e animação. O rascunho fica no branch
   como está; o prompt é que precisa carregar isso.

**Feito** — o prompt está na terceira versão, com as quatro coisas:

- **simplicidade em camadas**, escrita como regra e não como adjetivo: a
  superfície nunca pede decisão nem usa palavra técnica ("provedor",
  "embedding", "temperatura" só aparecem traduzidas); a profundidade fica a um
  gesto; e **nada de "modo avançado"**, que seria virar dois apps;
- **personalidade e animação**, que era o buraco de verdade. O prompt agora diz
  em voz alta o que você disse — "não quero o app escuro com cartão e borda
  fina que qualquer gerador devolve" — e pede três coisas: um **gesto próprio**
  do IAUnifier (só um, proposto por ele), **movimento com sentido** (150–400 ms,
  curva de verdade, mesma física no app inteiro) e o **detalhe que só quem
  cuida põe**;
- **a animação do Gemini descrita quadro a quadro.** Recortei o terço de baixo
  do seu vídeo de 0,25 em 0,25 s pra ver o que ela faz mesmo: é uma malha de
  pontinhos que **sobe do rodapé** e a cor **passa por âmbar → rosa → roxo →
  azul** em ~1,5 s, assentando em azul escuro. E acontece **uma vez, na
  entrada** — não é fundo animado o tempo todo. Virou a sexta referência,
  `gemini-animacao.png`;
- **a curadoria do LM Studio.** Conferi antes de escrever: o servidor **não sabe
  nada da máquina hoje** — nenhuma linha lê RAM ou chip. O Node lê (aqui: 18 GB,
  Apple M3 Pro, arm64), e em Apple Silicon a memória é compartilhada, então
  "cabe" se mede pela RAM. O prompt pede a tela — resumo da máquina em
  linguagem de gente, lista só do que cabe, uma frase de "pra que serve", e a
  comparação "por que este e não aquele" — e **avisa que os dados ainda não
  existem**, pra ele não inventar campo. Construir isso no back-end é tarefa
  minha, e fica na fila.

## 18/08/2026 — o desenho voltou do Claude Design

Chegou o `design_handoff_nuvo_ui.zip`. **É bom.** Tem a personalidade que faltava
e é código de verdade, não maquete.

O que conferi antes de qualquer coisa:

- **é aplicável.** O `styles.css` dele cobre **64 das 65 classes** que o app
  emite (a folha atual cobre 54, e as faltas são as mesmas — ganchos que só o JS
  usa). A única perda é `.score`, da tabela de votação. 1516 linhas contra 772;
- **respeitou a fiação.** Nenhum `id` removido, nenhum `data-view` trocado, e
  ele lista as 10 mudanças de marcação que precisa. Apliquei duas: o
  `<canvas id="glow">` como primeiro filho do `#main`, e o compositor
  reorganizado (campo em cima, controles numa `.composer-linha` embaixo, com o
  seletor de modelo migrado da barra de cima). Sem essa segunda, os botões do
  compositor empilham — foi o único estrago visível do CSS sozinho;
- **roda.** Protótipo sem um erro de console; app real com o CSS novo sobe,
  serve, e os 289 testes continuam passando;
- **entregou o que eu pedi no prompt**: as colunas do conselho com trilho de
  progresso e estados, a curadoria estilo LM Studio ("cabe com folga", "escreve
  código melhor que a Llama 8B e roda quase na mesma velocidade"), a linguagem
  sem jargão ("IAs ligadas", "quão criativa", "palavras-token"), e a marca
  própria — uma roseta de seis lóbulos com quatro modos de animação.

**Está no branch `desenho-nuvo`, não na `main`**, porque tem decisões que são
suas:

1. **ele renomeou o app pra "Nuvo".** Isso não estava no prompt, é escolha dele.
   O repositório, o domínio e o ícone são "IAUnifier". Manter ou trocar é você
   que diz;
2. **ele corta coisas**: `#btn-export` e `#btn-palette` saem da barra (a paleta
   vira ⌘K), e renomeia Gems → Perfis, Provedores → IAs ligadas, Config →
   Ajustes;
3. **quatro telas novas que o back-end não tem**: Programar no terminal, Modo
   voz, Conversa anônima e a curadoria de modelo por máquina. Essa última eu já
   sabia que faltava — o servidor não lê RAM nem chip. As outras três são
   funcionalidade nova, não desenho.

Faltava, e foi feito na madrugada seguinte: chamar o `glow.js` de verdade e as
oito mudanças de marcação restantes. Está tudo na seção abaixo.

## 18/08/2026 (madrugada) — "continua trabalhando, vou dormir........ deixa o app completinho"

Pedido dele, com estas palavras: *"continua trabalhando, vou dormir........ deixa
o app completinho"*.

Feito no branch `desenho-nuvo`:

- **o desenho está aplicado nas oito telas.** As quatro mudanças de marcação
  que faltavam entraram (`app.js`, `views.js`, `core.js`, `index.html`), e o
  `glow.js` agora é chamado de verdade: na abertura, ao voltar pra uma conversa
  e quando a resposta começa a chegar;
- **o modo voz existe e funciona.** Ciclo completo: ouve, repete entre aspas o
  que entendeu, mostra "pensando…" (com "usando N coisas que sabe de você"
  quando a memória entra no prompt), fala a resposta em voz alta e volta a
  ouvir. Botão de mudo, Encerrar, X e `Esc` fecham. Medido ponta a ponta com o
  modelo de verdade respondendo;
- **três defeitos de layout que só apareciam medindo o DOM renderizado**: o
  `.panel-inner` travava em 382px num telefone de 390 porque `margin: 0 auto`
  cancela o `stretch` do flex; o segmentado do conselho escondia a terceira
  opção atrás da própria rolagem; e a fileira de atalhos do chat deixava o
  quarto atalho inalcançável no mouse;
- **dois defeitos de texto**: "1 palavras-token" e "0 por segundo" numa resposta
  curta de CLI;
- **a casca do service worker estava desatualizada** — nem `glow.js` nem
  `format.js` estavam nela, então faltariam justamente sem rede.

Medido: 327 testes, oito telas em 320/360/390/1024/1280/1440px sem rolagem
horizontal, sem id duplicado no DOM vivo e sem erro de console; chat ponta a
ponta pelo navegador respondendo certo.

**Continua sendo decisão sua** (nada disso eu mexi): o nome "Nuvo" que o Claude
Design deu, e a tela **Programar no terminal** (`#view-code`) — o `cli.mjs` já
aceita `workdir`, mas ligar isso significa deixar o app, que fica aberto na sua
rede, escrever arquivos na pasta que apontarem. Isso é escolha sua, não minha.

### Conferência adversarial: quatro defeitos que os meus testes não pegaram

Dois agentes conferiram o app de forma independente e acharam o mesmo defeito
grave, que a minha varredura tinha deixado passar porque eu clicava por
JavaScript — o que pula o teste de acerto do navegador:

1. **Ajustes inalcançável por toque no celular.** A pílula "Nova conversa" era
   `position: absolute` dentro de um `.side-foot` que também é absoluto, então
   ela ia parar em x=261 numa gaveta que acaba em 320 e cobria o botão de
   ajustes por inteiro. Como a paleta é ⌘K e exige teclado, não sobrava nenhum
   caminho pros Ajustes num telefone;
2. **a conversa anônima prometia o que não cumpria.** A faixa dizia "não entra
   no histórico, não aprende nada sobre você e não usa a memória", mas nada de
   anônimo chegava ao servidor: a conversa era criada, as mensagens gravadas, a
   memória lida e os fatos extraídos. Agora existe de verdade — rota própria,
   sem gravar, sem ler memória, sem extrator, e o histórico só no navegador;
3. **a tabela de atalhos documentava ⇧⌘N como "Nova conversa"**, quando ⇧⌘N é a
   conversa anônima. Quem seguisse a tela abriria uma anônima sem saber;
4. **os alternadores não mostravam estado ligado** (busca na web, anônimo,
   microfone gravando) por especificidade de CSS.

Os dois também apontaram o service worker desatualizado, que eu já tinha
consertado antes de eles terminarem.

### O site

`https://www.nspx.dev/IAUnifier/` já abria (200). O que faltava era a foto no
card da vitrine: o `PROJECT_SHOTS` do `nspx-hub` não tinha entrada pro
IAUnifier. Entraram uma captura de desktop e uma de celular, as duas na tela
"Perguntar pra várias".

**Cuidado pra próxima vez:** o `www.nspx.dev` é servido pelo projeto Vercel
chamado **`nspx`**, não pelo `nspx-hub`. Rodar `npm run deploy` num clone sem
`.vercel` faz a CLI inferir o projeto pelo nome da pasta e publicar no
`nspx-hub`, que não serve o domínio — o deploy fica READY e o site não muda.
Linkar com `vercel link --project nspx --scope nspx` antes.

Apaguei as 8 conversas de teste que eu criei nesta madrugada; o app ficou com
zero conversa, zero memória e zero anexo, como estava.

## 19/08/2026 — pedidos da manhã (ele foi pra escola)

Mensagem dele, com o print do botão do globo em anexo, mais o zip
`Formulário enviado e acesso ao código.zip`:

> *"esse aq é o modo agente, o modo agente de navegador, tipo o claude in
> chrome, ou codex in chrome e etc. fiz land com claude desing, segue ai. hj
> fico o dia inteiro na escola, entao pode trabalhar a terde inteira no projeto,
> quero ver ele testado e funcionando quando eu chegar, e release rodando no
> mac, linux e windows. landing page e tudo bonitinho. boa sorte, vou la"*

Quebrado em itens:

- [x] **o botão do globo é modo agente de navegador**, não busca na web. Tipo o
  Claude in Chrome, o Codex in Chrome. Hoje ele só liga busca na web na
  conversa — é outra coisa;
  → `server/navegador.mjs` dirige o Chrome pelo CDP e `server/agente-web.mjs`
  faz o laço passo a passo. Onde não há Chrome, o globo volta a ser a busca de
  uma vez só;
- [x] **usar a landing que ele fez no Claude Design** (`landing.html` +
  `LANDING.md` + as imagens de `lp/` dentro do zip), no lugar da atual;
- [x] **release rodando no Mac, no Linux e no Windows**;
  → v0.1.1 com os cinco pacotes. Mac conferido aqui, Linux num contêiner Debian
  limpo, Windows num runner do GitHub rodando o .zip publicado
  (`.github/workflows/prova-windows.yml`);
- [x] **"landing page e tudo bonitinho"** — acabamento;
  → a barra cabe em celular, a grade não corta mais em 320, e entrou a seção do
  modo agente com captura da trilha;
- [x] **testado e funcionando quando ele chegar.**
  → 334 testes; as 8 telas em desktop e celular; modo anônimo sem gravar nada;
  agente navegando pelo app e pelo binário; landing medida em 5 larguras no
  `nspx.dev`.

Ele volta no fim da tarde.

