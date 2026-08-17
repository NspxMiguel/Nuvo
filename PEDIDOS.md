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

- [ ] *"me avisa quando for pra criar no claude desing"* — avisar quando o app
      estiver no ponto de entregar a UI pro Claude Design. Só marcar como feito
      depois de eu ter avisado com o app funcionando e testado, que é a condição
      que ele deu antes: *"fica fazendo o app, até ele estar praticamente pronto
      pra producao, tudo funcionando e testado. pra dai eu fazer o desing com
      claude desing"*.
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
