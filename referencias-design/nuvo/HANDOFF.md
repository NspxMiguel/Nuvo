# Handoff: Nuvo — interface completa (celular + computador)

## Visão geral

Nuvo é um app que roda na máquina do usuário e conversa com várias IAs (locais, pagas por
uso e programas de terminal) usando **uma memória compartilhada**: o que você conta pra uma,
todas sabem. Este pacote traz o desenho pronto de todas as telas, nos dois tamanhos, no tema
escuro (padrão) e claro.

O repositório de origem é `NspxMiguel/IAUnifier` (branch `main`, pasta `web/`). O app já existe
e funciona; o que está aqui é a **camada visual nova**, feita pra entrar no lugar de
`web/styles.css` sem quebrar a fiação existente.

## Sobre os arquivos deste pacote

Os arquivos aqui são **referência de design em HTML/CSS/JS** — um protótipo que mostra
aparência e comportamento pretendidos. Não são código de produção pra copiar cru.

A exceção importante: **`styles.css` é pra usar de verdade**. Ele foi escrito contra os mesmos
`id` e classes que o app já emite, então dá pra trocar `web/styles.css` por ele e a interface
muda inteira. `demo.js` é só o protótipo (dados falsos, streaming simulado por timer) e
**não deve ir pro app** — o app continua com `app.js`/`views.js`. `glow.js` é código real e
deve ser copiado: ele desenha a marca e o brilho do rodapé.

A tarefa, então, é: (1) aplicar `styles.css`, (2) copiar `glow.js` e chamá-lo nos três momentos
descritos abaixo, (3) fazer os pequenos acréscimos de marcação listados em "Fiação", e
(4) implementar as telas novas (Programar no terminal, Modo voz, Conversa anônima, Ajustes
de computador) seguindo esta documentação.

## Fidelidade

**Alta fidelidade.** Cores, tipografia, espaçamento, raios, durações e curvas de animação
são finais e estão todos em variáveis CSS no topo de `styles.css`. Recrie fielmente. Onde o
protótipo usa dados inventados (nomes de modelo, conversas, fatos de memória), troque pelos
dados reais do app — o texto de interface (rótulos, avisos, microcópia) deve ser mantido
literal, porque foi escrito pra ser simples pra leigo.

## Tokens

Tudo vive em `:root` (escuro, padrão) e `:root[data-theme='light']`.

### Cor — escuro
| token | valor | uso |
| --- | --- | --- |
| `--bg` | `#000` | fundo do app |
| `--panel` | `#101013` | superfície tocável, pílula, gaveta |
| `--panel-2` | `#1a1a1e` | estado de toque, segundo nível |
| `--panel-3` | `#26262b` | trilho de barra, interruptor desligado |
| `--line` | `#1e1e22` | divisória forte (usada pouco) |
| `--line-soft` | `#16161a` | divisória entre linhas de lista |
| `--text` | `#fff` | texto principal |
| `--text-2` | `#d7d7dc` | texto secundário, corpo de resposta |
| `--muted` | `#8e8e96` | rótulo, explicação, ícone inativo |
| `--accent` | `#3d7dff` | único destaque: botão principal, item ativo |
| `--accent-soft` | `#3d7dff26` | fundo do item ativo |
| `--accent-line` | `#3d7dff66` | contorno de foco |
| `--on-accent` | `#fff` | texto sobre o destaque |
| `--danger` | `#ff6b5e` | erro, apagar |
| `--ok` | `#4ed07f` | sucesso, concluído |
| `--warn` | `#ffc44d` | atenção |

Cores de rótulo (projetos, perfis, onda de voz): `--indigo #6b8cff`, `--teal #3fd6c0`,
`--amber #ffb84d`, `--rose #ff6f9d`, `--violet #a97cff`, `--sky #4fb8ff`, `--lime #a8e05f`,
`--slate #9a9aa4`.

### Cor — claro (`data-theme='light'`)
`--bg #fff`, `--panel #f2f2f5`, `--panel-2 #e7e7ec`, `--panel-3 #dcdce3`, `--line #e6e6eb`,
`--line-soft #efeff3`, `--text #000`, `--text-2 #303036`, `--muted #71717a`,
`--accent #0a5cff`, `--accent-soft #0a5cff1a`, `--accent-line #0a5cff55`, `--on-accent #fff`,
`--danger #d8342a`, `--ok #12864f`, `--warn #8a6100`.

### Vidro
| token | valor |
| --- | --- |
| `--glass` | `rgba(20,20,24,.58)` (claro: `rgba(255,255,255,.66)`) |
| `--glass-2` | `rgba(30,30,36,.66)` (claro: `rgba(255,255,255,.78)`) |
| `--glass-line` | `rgba(255,255,255,.08)` (claro: `rgba(0,0,0,.07)`) |
| `--glass-luz` | `inset 0 1px 0 rgba(255,255,255,.07)` |
| `--blur` | `saturate(180%) blur(24px)` |

Vidro **só** em: pílula de escrever, botões redondos da barra de cima, gaveta, folha de
ajustes, colunas do conselho, pílulas de sugestão, lista de atalhos, torradas, grupos de
ajustes e o cartão da máquina. O resto é opaco — vidro em tudo vira névoa.

### Forma e tipo
- `--radius: 16px`, `--radius-lg: 22px`, `--pill: 999px`, `--toque: 44px`.
- Fonte: a do sistema (`-apple-system, 'SF Pro Text', 'Segoe UI', Roboto, system-ui`).
  Monoespaçada (`ui-monospace, SFMono-Regular, Menlo`) só em caminho de arquivo, senha e código.
- Corpo do app: 17px/1.55 no celular, 16px no computador. Resposta da IA: 17.5px/1.62.
  Título de painel: 30px, peso 650, `letter-spacing -.03em`. Nome do app: 25px/650/-.04em.
- Nada abaixo de 13px. Campo de texto sempre 16px no celular (senão o iPhone dá zoom).

### Movimento
`--d1 150ms` (toque, troca de estado) · `--d2 220ms` (item entrando) · `--d3 320ms` (folha,
gaveta) · `--d4 400ms` (troca de tela).
`--ease cubic-bezier(.2,.8,.2,1)` · `--ease-io cubic-bezier(.6,0,.35,1)` ·
`--mola cubic-bezier(.34,1.42,.64,1)`.
Nada linear, nada acima de 400ms fora a marca (700ms) e o brilho (1,5s).
`prefers-reduced-motion` zera tudo e o brilho pinta direto o estado final.

## A marca

Roseta de **seis lóbulos** (círculos de r=5.2 a 4.6 do centro, em grade de 24) fundidos com um
núcleo de r=6.8, preenchidos com gradiente linear `#7aa8ff → #3d5cff` e um brilho radial
branco (35–45% no topo, `mix-blend-mode: screen`). Simetria nos dois eixos — foi o que
resolveu a sensação de "torto" das versões de cinco lóbulos.

`glow.js` exporta `roseta(tamanho, modo)`; `modo` é:
- `'fixa'` — logo parado (gaveta 26px, resposta costurada 20px);
- `'bloom'` — lóbulos abrindo do centro, 700ms na `--mola` (tela vazia 54px, primeira abertura 58px);
- `'pensa'` — cada lóbulo respirando 1,5s em `--ease-io` com escada de 80ms (indicador de "pensando", 18px);
- `'grande'` — a roseta inteira girando 14s linear (modo voz, 78px).

Ícone do app: `icon-192.png` e `icon-512.png`, mesma geometria sobre preto, centrada pro
corte em círculo do Android. O código que os gera está descrito em "Assets".

## O brilho do rodapé

`<canvas id="glow">` é o primeiro filho de `#main`, 46% da altura, colado embaixo, atrás da
pílula (`z-index: 0`; conteúdo em 1, pílula e barra em 2). `ligarBrilho(canvas)` devolve
`{ pulsar, assentar, apagar }`:
- **pulsar()** — a malha de pontinhos nasce: matiz percorre âmbar 42° → rosa 348° → roxo 288° →
  azul 232° → 226° em 1,5s, intensidade sobe rápido, recua 42% e **para**. Chamar ao abrir o
  app, ao voltar pra uma conversa e quando uma resposta começa a chegar.
- **assentar()** — pinta direto o estado final (troca de tema, redimensionamento, movimento reduzido).
- **apagar()** — fora do chat.

A malha é feita de círculos de 0,45–2,9px em fileiras alternadas de 10px, alfa máximo 0,62,
foco 6% abaixo da borda de baixo. Não é fundo animado: depois de 1,5s fica parado.

## Telas

Todas usam `data-view` no menu e `#view-<nome>` na seção, como o app já faz.

### 1. Conversas (`chat`) — vazia
Roseta 54px em `bloom` + "Pode falar, Miguel." (27px/600) centralizados verticalmente
(`margin:auto`). Logo acima da pílula, uma **fileira de pílulas que desliza pro lado**
(`overflow-x:auto`, `scroll-snap-type: x proximity`, gap 10px, altura 46px, vidro): Perguntar
pra várias · Pesquisar na web · Ler um arquivo · Programar no terminal · O que você sabe de mim.
Cada pílula entra com `sobe` em escada de 60ms a partir de 360ms.

### 2. Conversas — com resposta
- Sua fala: bolha à direita, `--panel`, raio 22px, padding 12/18, máx 84% da largura.
- Resposta: **texto largo sem caixa**, medida de 720px, 17.5px/1.62.
- Antes da resposta, uma linha discreta de raciocínio: `<details class="reasoning">` com a
  roseta `pensa` 18px + "pensando…"; ao terminar troca pro texto "como pensou · 2,1 s" com
  chevron. Aberto, o texto tem teto de 190px, rola por dentro e desbota no fim
  (`mask-image: linear-gradient(#000 calc(100% - 34px), transparent)`).
- Depois da resposta: `<details class="mem-foot">` — "usei **3 coisas** que já sei sobre você".
  Aberto, lista cada fato com a origem à direita ("de 'Trocar o disco'") e dois botões:
  "Abrir memória" e "Não usar aqui".
- Quando o app aprende algo novo, entra na conversa uma `.note.new`: ícone de memória +
  "Guardei: **…**. Todas as IAs vão saber disso. mudar · esquecer". Sem torrada em cima — o
  aviso é um só.
- Rodapé da resposta (`.stats`, 14px, `--muted`): "12,4 s · 1.284 palavras-token · 104 por segundo".
  A palavra "token" nunca aparece sozinha na interface.

### 3. Pílula de escrever (`#composer`)
Vidro, raio 26px, máx 720px, centrada, com `env(safe-area-inset-bottom)`. Duas fileiras:
o `<textarea id="input">` em cima (min 44px, cresce até 190px e para) e a `.composer-linha`
embaixo: **+** (anexar) · microfone (ditar) · espaço · `<select id="sel-model">` (a IA
escolhida, texto de 15px/600 com contorno leve) · botão redondo branco de **modo voz** (ícone
de onda, 44px) · **enviar** (44px redondo; cinza `--panel-2` quando vazio, `--accent` quando
tem texto, encolhe 10% no toque). `#sel-gem` e `#sel-project` existem no DOM mas ficam
escondidos — perfil e projeto moram na folha de ajustes.

### 4. Barra de cima (`#topbar`)
Transparente, 56px. Celular: menu (redondo, vidro) · nome da conversa · web · anônimo.
Computador: nome da conversa · web · anônimo — e, **quando a barra lateral está recolhida**,
aparecem à esquerda o botão de menu (traz de volta) e um de nova conversa.

### 5. Gaveta / barra lateral (`#sidebar`)
Celular: fixa, 88vw (máx 310px), vidro, desliza com `transform` em `--d3`, fundo escurecido
`#scrim`. Computador: coluna estática de 300px; o X recolhe (`#app.recolhido` →
`margin-left:-300px` + `opacity:0`).

Conteúdo: logo + nome; busca em pílula; menu de **quatro** itens (Conversas · Perguntar pra
várias · Pesquisar na web · Programar no terminal) e um `<details id="nav-mais">` chamado
"Mais" com Memória (contador 248) · Projetos · Perfis · IAs ligadas — abre sozinho quando a
tela ativa está dentro dele. Lista de conversas em **texto puro** com rótulos de grupo
(Fixadas · Hoje · Ontem), sem ícone e sem cartão. Rodapé: **Nova conversa** (pílula
`--accent`, 48px, ocupa a largura) + ícone de ajustes 48px. No celular o Nova conversa é
pílula flutuante no canto de baixo.

### 6. Perguntar pra várias (`council`)
Pergunta em 20px/500; abaixo, uma linha com o **trilho** (um tracinho de 28×4px por IA:
correndo com `corre` 1,5s, verde quando termina, vermelho quando falha), o contador
"3 de 5 prontas · 12 s" e o botão de repetir. Modo num **segmentado** de vidro com três
palavras: Uma resposta só · Lado a lado · Elas votam.

Colunas: grade de rolagem horizontal, 88% de largura no celular com `scroll-snap`, altura
fixa (58dvh no celular, 400px no computador) e rolagem interna — **quem termina em 3s não
empurra quem termina em 40s**. Estados: `.run` (contorno de destaque + ponto pulsando no fim
do texto), `.done`, `.fail` (corpo trocado por aviso com a saída do erro e o botão que
resolve), `.win`.

Ao costurar: as colunas **recolhem** numa tira de pastilhas e a resposta final assume a
página (`.final`, 17.5px/1.62, com a roseta e "as cinco respostas viraram uma · costurada
pelo Claude Sonnet 4"). No modo votação entra o `.placar`: linha por IA com nota grande
(22px, tabular), barra proporcional, vencedor marcado, e duas linhas de rodapé dizendo o que
o número não diz (voto anulado por sair da escala; quem falhou e não votou).

### 7. Pesquisar na web (`research`)
Quatro contadores em cima (segundos, buscas, páginas lidas, fontes guardadas) — 30px/600
tabular, subindo por interpolação, não trocando de valor. Abaixo, o registro passo a passo:
cada passo entra com `sobe`, tem hora (00:02), título e sublinha; o atual tem o ponto
pulsando, os anteriores ficam verdes. Terminado, o registro **colapsa numa linha** ("o passo
a passo · 9 passos · 41 s · 7 fontes guardadas, 2 descartadas") e o relatório entra: 26px de
título, 17.5px de corpo, marcas de fonte em `<sup>` clicáveis e a lista numerada de fontes.

### 8. Programar no terminal (`code`) — nova
Uma `.sessao` por programa (Claude Code, Codex, opencode): nome 18px, caminho da pasta em
monoespaçada, etiqueta de estado (trabalhando/parado), e a saída real em monoespaçada 13.5px
com teto de 190px, rolagem e desbote no fim — comando em `--accent`, linha adicionada em
`--ok`, removida em `--danger`. Ações: Parar / Ver o diff, ou Retomar.

### 9. Memória (`memory`)
Três contadores (coisas guardadas · usadas por resposta · aprendidas hoje). Lista de fatos:
texto 17px, e embaixo a origem — escopo ("vale pra tudo" / "só no projeto Casa", este com a
cor do projeto), "de <conversa>" e "usada 14 vezes" — com botões de mudar e esquecer.

### 10. IAs ligadas (`providers`)
Primeiro **a máquina em linguagem de gente**: "Seu servidor tem **32 GB de memória** e um
**Ryzen 5 5600**, sem placa de vídeo dedicada. Cabe modelo de até uns **15 GB** com folga",
com a memória repartida numa barra (baixados / sistema / livre) e legenda.

Depois a lista de modelos recomendados **pra aquela máquina**, cada um com: nome legível +
id + tamanho, uma frase de "pra que é bom", uma frase de "por que este e não aquele", e o
veredito de encaixe — `cabe.folga` (verde), `cabe.aperto` (amarelo), `cabe.nao` (vermelho,
botão de baixar desativado). O que já está baixado vem marcado. Baixar mostra barra de
progresso na própria linha e vira "Usar agora" ao terminar.

Campos que o back-end precisa devolver: `ram_total`, `ram_livre`, `chip`, `gpu_vram` (0 quando
não tem) e, por modelo, `nome_legivel`, `id`, `gb`, `cabe` (`folga|aperto|nao`), `pra_que`
(uma frase), `compara` (uma frase citando outro modelo da lista), `instalado` (booleano).

Abaixo, as pagas por uso (com gasto do mês e estado da chave) e os programas de terminal.
Todo erro traz **causa + o que fazer + o botão que faz** — ex.: "O programa existe no seu
terminal, mas não para o app. Eles rodam com caminhos diferentes. Aponte o caminho completo —
aqui provavelmente `/usr/local/bin/claude`." + botão "Apontar caminho".

### 11. Ajustes (`settings`) — dois desenhos, um arquivo
**Computador:** janela de duas colunas dentro da própria tela. Esquerda (252px, borda
`--line-soft`): busca em pílula e a trilha em dois grupos — "Ajustes" (Geral · Memória · IAs
ligadas · Acesso · Seus dados) e "Personalizar" (Perfis · Programas do terminal · Atalhos de
teclado); item ativo com `--panel-2` e peso 600. Direita: rola sozinha, título 21px, e
`.cfg-lin` por ajuste — rótulo 16px com explicação 14px `--muted` de um lado, controle do
outro (campo, seletor, interruptor ou botão). Abaixo de 1120px a linha empilha. Canto de
baixo à direita: os dois botões de tema (escuro/claro).

**Celular:** lista agrupada — rótulo pequeno acima, grupo de vidro arredondado, linha com
ícone + nome + valor + chevron, divisórias entre linhas, interruptor de verdade (46×28,
pastilha branca de 22px que desliza 18px na `--mola`), linha vermelha de apagar e a versão
no pé ("Nuvo 0.9.4 · roda em 192.168.0.14"). Tema abre a folha de baixo com escuro / claro /
como o sistema.

Os dois saem do mesmo `#view-settings`: `.cfg` só aparece a partir de 761px, `.cfg-mob` só
abaixo disso.

### 12. Modo voz (`#voice`) — nova
Camada cheia de vidro (`blur(40px)`) por cima de tudo. X no topo à esquerda. No meio: roseta
78px girando, **doze barras** que respiram em ritmos e cores diferentes (0,86–1,32s, cores
`--accent`, `--violet`, `--sky`, `--teal`), o estado em 22px e quem está falando em 15px.
Rodapé: mudo (58px, pausa as barras) e Encerrar.

Ciclo do estado: "ouvindo…" → a fala transcrita entre aspas → "pensando…" (com "usando 2
coisas que sabe de você") → a resposta, com `#voice.falando` acelerando as barras pra 0,6s.

### 13. Conversa anônima — nova
Botão de máscara na barra de cima (`#btn-anon`, `aria-pressed`). Ligado, `#app.anon`:
o destaque vira cinza (`--accent: #b9bec9`) e o brilho cai pra 28% com saturação 15% — dá pra
ver de longe em que modo você está. Uma faixa entra no topo da conversa: "**Conversa anônima.**
Não entra no histórico, não aprende nada sobre você e não usa a memória. Some quando você
fechar ou trocar de conversa." Nesse modo a resposta **não** mostra o rodapé de memória e
**não** aparece aviso de fato aprendido. Trocar de tela desliga o modo.

### 14. Primeira abertura
Roseta 58px, "Nada ligado ainda. Deixa eu ver o que tem aqui." e três passos numerados em
blocos. O primeiro procura sozinho (Ollama, LM Studio, programas de terminal, chaves no
sistema) e os achados entram um a um com etiqueta achei/talvez/não, terminando em
"**Duas IAs prontas pra usar, sem custo.** A Llama 3.1 8B é a mais rápida e cabe com folga
nos seus 32 GB. Começo com ela?".

### 15. Lista de atalhos (`#palette`)
Folha que sobe de baixo (no computador, caixa centrada), campo de busca e itens com ícone +
nome + tecla: Nova conversa ⌘N · Conversa anônima ⇧⌘N · Ajustes desta conversa ⌘, ·
Perguntar pra várias ⇧⌘A · Pesquisar na web ⌘P · Ver memória ⌘M. Abre com ⌘K, fecha com Esc.

## Interações e comportamento

- **Troca de tela**: a que entra sobe 10px e revela em `--d4`; dentro do painel, título em
  40ms, explicação em 90ms, conteúdo em 130ms.
- **Gaveta**: `transform` em `--d3`; no computador recolhe por `margin-left`.
- **Folha de ajustes** (`#tune`): sobe de baixo (`translateY(101%)` → 0) no celular; no
  computador é faixa no topo com `abre`. Fecha no Esc e no "Pronto".
- **Enviar**: cinza quando o campo está vazio, destaque quando tem texto; troca por "parar"
  enquanto a resposta chega.
- **Números**: sempre sobem por interpolação (400–900ms, `1-(1-t)³`), nunca trocam de valor.
- **Toque**: todo alvo encolhe 3% (`scale(.97)`); ícones 10%.
- **Hitbox**: mínimo 44px; a linha inteira é clicável, não só o texto; ícones pequenos ganham
  6px invisíveis em volta (`::after` com `inset:-6px`); `-webkit-tap-highlight-color: transparent`
  e `touch-action: manipulation` em tudo que é tocável.
- **Áreas seguras**: `env(safe-area-inset-*)` na gaveta, barra de cima, pílula, folhas e torradas.

## Estado

`tema` (`data-theme` no `<html>`, padrão escuro) · `viewAtiva` · `gavetaAberta` /
`gavetaRecolhida` (`#app.recolhido`) · `anonimo` (`#app.anon`) · `vozAberta` · `webLigada`
(`#btn-web.on`) · `modeloEscolhido`, `perfil`, `projeto` · `respondendo` (mostra parar,
esconde enviar) · `secaoAjustes` (qual item da trilha) · por conversa: mensagens, raciocínio,
fatos usados, anexos.

## Fiação — o que precisa mudar na marcação

Nenhum `id` foi removido ou renomeado, e nenhum `data-view` mudou. Mudanças reais:

1. `<canvas id="glow">` como primeiro filho de `#main` (sem ele, nada quebra — só perde o brilho).
2. `#tune` é filho de `#main`, logo abaixo de `#topbar` (pra poder deslizar por cima no celular).
3. `#sel-model`, `#sel-gem` e `#sel-project` mudaram de lugar: agora vivem dentro de
   `#composer`, numa `<div class="composer-linha">`. Ids iguais.
4. `#btn-new-chat` está no rodapé da gaveta (`.side-foot`); no computador entra também um
   `#btn-new-chat-top` na barra de cima, visível só com a lateral recolhida.
5. Saíram: `#btn-export` e `#btn-palette` da barra (a lista de atalhos virou ⌘K). Entrou
   `#btn-anon`.
6. `#nav` ganhou o `<details id="nav-mais">` em volta dos quatro itens secundários.
7. Novos: `#view-code` (`data-view="code"`) e `#voice` (camada do modo voz).
8. Rótulos: Gems → **Perfis**, Provedores → **IAs ligadas**, Config → **Ajustes**,
   Código → **Programar no terminal**. Só o texto; os `data-view` seguem `gems`,
   `providers`, `settings`, `code`.
9. Para o conselho: cada coluna precisa de `<header>` com `<h4>` + `.col-state` e a classe de
   estado (`run`/`done`/`fail`/`win`). Sem isso o CSS cai num modo de reserva que já existe.
10. Para o rodapé de memória: emitir `<details class="mem-foot">` dentro de `.msg .body` com os
    fatos que já vão no prompt.

## Linguagem da interface

Palavra difícil não aparece na superfície: "provedor" → **IAs ligadas**; "temperatura" →
**quão criativa**; "modelo" → **qual IA responde**; "token" → **palavras-token**, e só no
rodapé da resposta; "embedding/índice" → **o jeito de indexar**. Mantenha esses termos.

## Assets

- `icon-192.png` e `icon-512.png` — a roseta sobre preto. Gerados por código: seis círculos de
  r=5.2 (grade de 24) a 4.6 do centro + núcleo r=6.8, gradiente linear `#7aa8ff → #3d5cff` de
  canto a canto, e um brilho radial branco (45% no centro-topo, raio 60% do lado) aplicado com
  `source-atop`.
- `icons.js` — o conjunto de ícones que o app já usa (veio do próprio repositório).
- Nada mais: sem fonte baixada, sem CDN, sem biblioteca. O app roda offline.

## Arquivos

| arquivo | o que é |
| --- | --- |
| `styles.css` | **usar de verdade** — substitui `web/styles.css` |
| `glow.js` | **usar de verdade** — a marca (`roseta`) e o brilho (`ligarBrilho`) |
| `index.html` | referência da estrutura: ids, ordem, atributos de acessibilidade |
| `demo.js` | **só protótipo** — dados falsos e simulações; não vai pro app |
| `icons.js` | ícones (já existiam no repositório) |
| `icon-192.png`, `icon-512.png` | ícone do app |

Para ver o protótipo: abra `index.html` num navegador. Ele começa na conversa vazia; o menu
leva a todas as telas, e os momentos ao vivo (streaming, conselho, pesquisa, download de
modelo, voz) rodam sozinhos.
