// Os idiomas da página de apresentação.
//
// A chave é o próprio texto em português, igual ao app: sem tradução, a frase
// cai no português — que já é uma frase pronta — em vez de cair num
// identificador. O arquivo é um script comum, não um módulo nem um JSON
// buscado por `fetch`: assim o dicionário já está na memória quando o HTML
// termina de ser lido, e a tradução acontece antes da primeira pintura. Com
// `fetch`, quem abre a página em inglês veria a tela em português por um
// quadro antes da troca.
//
// `@nomes` é a única chave que não é uma frase: é a lista de nomes que passa
// na saudação da primeira tela. Nome próprio também é idioma.
window.IDIOMAS = {
  en: {
    '@nomes': ['Alex', 'Maya', 'Chris', 'Priya', 'Jordan', 'Amara', 'Noah', 'YOUR NAME'],

    // A captura é a do app na língua de quem está lendo: a landing em inglês
    // com a tela do app em português mostra um produto que não existe.
    'lp/tela-conversa.jpg': 'lp/tela-conversa-en.jpg',
    'lp/tela-varias.jpg': 'lp/tela-varias-en.jpg',
    'lp/tela-maquina.jpg': 'lp/tela-maquina-en.jpg',
    'lp/tela-cli.jpg': 'lp/tela-cli-en.jpg',
    'lp/tela-programar.jpg': 'lp/tela-programar-en.jpg',
    'lp/tela-agente.jpg': 'lp/tela-agente-en.jpg',

    'Modo programar': 'Coding mode',
    Programar: 'Code',
    'Você vê a IA trabalhar, arquivo por arquivo': 'Watch the AI work, file by file',
    'Aponte uma pasta e peça a mudança. Do lado da conversa abre um painel com a árvore do projeto, cada arquivo que ela leu ou escreveu, cada comando que rodou — com a saída inteira e se deu certo — e o que mudou desde o último commit.':
      'Point at a folder and ask for the change. Next to the conversation a panel opens with the project tree, every file it read or wrote, every command it ran — with the full output and whether it worked — and what has changed since the last commit.',
    'O passo a passo vem do próprio Claude Code, Codex ou opencode, não de um palpite: o app lê o relato que eles publicam enquanto trabalham. A IA só ganha permissão de escrever depois que você escolhe a pasta, e só dentro dela.':
      'The step-by-step comes from Claude Code, Codex or opencode themselves, not from a guess: the app reads the account they publish while they work. The AI only gets permission to write after you pick the folder, and only inside it.',
    'A tela Programar: a conversa de um lado e, do outro, o painel com cada arquivo que a IA leu e editou, o comando que rodou e quanto custou o turno':
      'The Code screen: the conversation on one side and, on the other, the panel with every file the AI read and edited, the command it ran and what the turn cost',

    'IAUnifier — todas as suas IAs, uma memória só': 'IAUnifier — all your AIs, one memory',
    'Programa que roda na sua máquina e junta os modelos locais, as IAs pagas por uso e os programas de terminal numa conversa só, com a mesma memória para todas.':
      'A program that runs on your own machine and puts local models, pay-as-you-go AIs and terminal programs in a single conversation, with the same memory for all of them.',

    Memória: 'Memory',
    'IAs locais': 'Local AIs',
    Agente: 'Agent',
    Privacidade: 'Privacy',
    Baixar: 'Download',
    Idioma: 'Language',

    'Pode falar,': 'Go ahead,',
    'É assim que o app abre. Sem tela de login, sem escolher plano — a conversa já está ali.':
      'This is how the app opens. No login screen, no plan to pick — the conversation is already there.',
    'Você conta uma vez.': 'You say it once.',
    'E todas elas lembram.': 'And every one of them remembers.',
    'IAUnifier aberto numa conversa nova: a marca, a saudação, os atalhos e o campo de escrever, com a IA escolhida ao lado do botão de enviar':
      'IAUnifier open on a new conversation: the logo, the greeting, the shortcuts and the message box, with the chosen AI next to the send button',
    'Todas as suas IAs,': 'All your AIs,',
    'uma memória só': 'one memory',
    'Os modelos que rodam no seu computador, as IAs pagas por uso e os programas de terminal, numa conversa só. O que você conta pra uma, todas sabem.':
      'The models running on your own computer, the pay-as-you-go AIs and the terminal programs, in one conversation. What you tell one of them, all of them know.',
    'Ver o código': 'See the code',
    role: 'scroll',

    'Uma memória, não cinco conversas': 'One memory, not five separate chats',
    'Cada IA que você usa hoje começa do zero. IAUnifier guarda o que importa uma vez — como você gosta de resposta, o que tem no seu projeto, o que já ficou decidido — e entrega pra qualquer uma delas na hora de responder.':
      'Every AI you use today starts from scratch. IAUnifier stores what matters once — how you like your answers, what is in your project, what has already been decided — and hands it to any of them at answer time.',
    'Você vê a origem': 'You see where it came from',
    'Cada coisa guardada mostra de qual conversa veio.':
      'Every stored fact shows which conversation it came from.',
    'Você manda': 'You are in charge',
    'Mudar, esquecer ou desligar a memória só nesta resposta.':
      'Edit it, forget it, or turn memory off for this one answer.',
    'Fica em casa': 'It stays home',
    'A memória é um arquivo na sua máquina, não uma conta em servidor de ninguém.':
      'Memory is a file on your machine, not an account on somebody else’s server.',

    'Perguntar pra várias': 'Ask several',
    'Pergunte pra cinco ao mesmo tempo': 'Ask five of them at once',
    'A mesma pergunta em várias IAs, todas lendo a mesma memória. Compare lado a lado, deixe que elas votem ou receba as respostas costuradas numa só. Quem responde em três segundos não fica esperando quem leva quarenta.':
      'The same question across several AIs, all reading the same memory. Compare them side by side, let them vote, or get the answers stitched into one. The one that answers in three seconds does not wait for the one that takes forty.',
    'Tela Perguntar pra várias: a pergunta, a barra de progresso e três IAs respondendo lado a lado, cada uma com o tempo que levou':
      'The Ask several screen: the question, the progress bar and three AIs answering side by side, each with how long it took',

    'Só as IAs que cabem na sua máquina': 'Only the AIs that fit your machine',
    'IAUnifier olha a memória RAM e o processador da sua máquina e diz, em português, o que dá pra rodar: o que cabe com folga, o que cabe apertado e o que não cabe. Cada modelo vem com uma frase sobre para que ele é bom e por que escolhê-lo em vez do outro.':
      'IAUnifier looks at your RAM and your processor and tells you, in plain English, what you can run: what fits comfortably, what fits tightly and what does not fit at all. Each model comes with a line about what it is good for and why to pick it over the next one.',
    'Tela IAs ligadas: a memória RAM e o processador da máquina descritos em português, e os modelos recomendados pra ela':
      'The Connected AIs screen: the machine’s RAM and processor described in plain English, and the models recommended for it',

    'Programas de terminal': 'Terminal programs',
    'Claude Code, Codex, Gemini e opencode dentro do app':
      'Claude Code, Codex, Gemini and opencode inside the app',
    'Os mesmos programas que você já usa no terminal respondem dentro da conversa, sem chave de API e sem cobrança por uso — eles usam a assinatura que você já tem. Leem a mesma memória das outras e trabalham na pasta que o projeto apontar.':
      'The same programs you already use in the terminal answer inside the conversation, with no API key and no per-use billing — they use the subscription you already pay for. They read the same memory as the others and work in whatever folder the project points to.',
    'Uma conversa com o Codex respondendo sobre algo que foi contado ao Claude Code, com o rodapé mostrando os dois fatos que ele usou da memória':
      'A conversation where Codex answers about something that was told to Claude Code, with the footer showing the two facts it used from memory',

    'Modo agente': 'Agent mode',
    'Ela abre o navegador e vai atrás': 'It opens a browser and goes looking',
    'Um clique no globo e a IA passa a dirigir um navegador de verdade: busca, entra no site, clica, lê e volta com a resposta e o endereço de onde tirou. Não é o resumo de um resultado de busca — é a página aberta, inclusive a que só existe depois que o JavaScript roda. Você acompanha cada passo e o porquê dele.':
      'One click on the globe and the AI starts driving a real browser: it searches, opens the site, clicks, reads and comes back with the answer and the address it came from. This is not a summary of a search result — it is the page itself, including the page that only exists after the JavaScript runs. You follow every step and the reason for it.',
    'Funciona com qualquer IA da lista, inclusive as que rodam na sua máquina, desde que você tenha Chrome, Chromium, Edge ou Brave instalado. O navegador abre num perfil separado, longe da sua sessão do dia a dia, e não preenche campo de senha.':
      'It works with any AI on the list, including the ones running on your own machine, as long as you have Chrome, Chromium, Edge or Brave installed. The browser opens in a separate profile, away from your everyday session, and it does not fill in password fields.',
    'Uma conversa em modo agente: a trilha mostra a busca, a página aberta e o motivo de cada passo, e a resposta cita a fonte':
      'A conversation in agent mode: the trail shows the search, the page it opened and the reason for each step, and the answer cites its source',

    'Roda na sua máquina': 'It runs on your machine',
    'IAUnifier é um programa que você instala e roda na sua máquina, não um serviço na nuvem. Os modelos locais respondem sem internet. As IAs pagas por uso recebem só o que você mandar, com a sua chave. Memória, arquivos e histórico ficam numa pasta sua — dá pra abrir, copiar e apagar na mão.':
      'IAUnifier is a program you install and run on your own machine, not a service in the cloud. Local models answer with no internet at all. Pay-as-you-go AIs receive only what you send, with your own key. Memory, files and history live in a folder of yours — you can open it, copy it and delete it by hand.',
    'Conversa anônima': 'Private chat',
    'Um toque e a conversa não entra no histórico, não usa a memória e não aprende nada. Some quando você fechar.':
      'One tap and the conversation stays out of the history, does not use memory and learns nothing. It disappears when you close it.',

    'Baixar o IAUnifier': 'Download IAUnifier',
    Versão: 'Version',
    'Grátis e de código aberto. Os modelos locais não custam nada; as IAs pagas por uso usam a sua chave.':
      'Free and open source. Local models cost nothing; pay-as-you-go AIs use your own key.',
    '.exe num .zip': '.exe in a .zip',
    'Windows 10 ou mais novo': 'Windows 10 or newer',
    'precisa da libatomic': 'needs libatomic',
    'macOS 13 ou mais novo': 'macOS 13 or newer',
    'Máquina mais antiga?': 'Older machine?',
    'Mac com Intel': 'Intel Mac',
    'todos os arquivos': 'all the files',
    'No Linux, instale a libatomic antes:': 'On Linux, install libatomic first:',
    'no Debian e Ubuntu,': 'on Debian and Ubuntu,',
    'no Fedora. Sem ela o programa nem abre.':
      'on Fedora. Without it the program will not even start.',
    'O app roda em qualquer máquina — quem pede memória RAM são os modelos locais, e a tela de IAs ligadas diz o que cabe na sua. Ou':
      'The app runs on any machine — it is the local models that ask for RAM, and the Connected AIs screen tells you what fits yours. Or',
    'compile a partir do código': 'build it from source',

    'código aberto': 'open source',
    Código: 'Code',
    Versões: 'Releases',
    'Voltar ao topo': 'Back to top'
  },

  es: {
    '@nomes': ['Miguel', 'Lucía', 'Mateo', 'Sofía', 'Diego', 'Valentina', 'Camila', 'TU NOMBRE'],

    // A captura é a do app na língua de quem está lendo.
    'lp/tela-conversa.jpg': 'lp/tela-conversa-es.jpg',
    'lp/tela-varias.jpg': 'lp/tela-varias-es.jpg',
    'lp/tela-maquina.jpg': 'lp/tela-maquina-es.jpg',
    'lp/tela-cli.jpg': 'lp/tela-cli-es.jpg',
    'lp/tela-programar.jpg': 'lp/tela-programar-es.jpg',
    'lp/tela-agente.jpg': 'lp/tela-agente-es.jpg',

    'Modo programar': 'Modo programar',
    Programar: 'Programar',
    'Você vê a IA trabalhar, arquivo por arquivo': 'Ves a la IA trabajar, archivo por archivo',
    'Aponte uma pasta e peça a mudança. Do lado da conversa abre um painel com a árvore do projeto, cada arquivo que ela leu ou escreveu, cada comando que rodou — com a saída inteira e se deu certo — e o que mudou desde o último commit.':
      'Señala una carpeta y pide el cambio. Al lado de la conversación se abre un panel con el árbol del proyecto, cada archivo que leyó o escribió, cada comando que ejecutó —con la salida entera y si funcionó— y qué cambió desde el último commit.',
    'O passo a passo vem do próprio Claude Code, Codex ou opencode, não de um palpite: o app lê o relato que eles publicam enquanto trabalham. A IA só ganha permissão de escrever depois que você escolhe a pasta, e só dentro dela.':
      'El paso a paso viene del propio Claude Code, Codex u opencode, no de una suposición: la app lee el relato que ellos publican mientras trabajan. La IA solo obtiene permiso de escritura después de que eliges la carpeta, y solo dentro de ella.',
    'A tela Programar: a conversa de um lado e, do outro, o painel com cada arquivo que a IA leu e editou, o comando que rodou e quanto custou o turno':
      'La pantalla Programar: la conversación de un lado y, del otro, el panel con cada archivo que la IA leyó y editó, el comando que ejecutó y cuánto costó el turno',

    'IAUnifier — todas as suas IAs, uma memória só': 'IAUnifier — todas tus IAs, una sola memoria',
    'Programa que roda na sua máquina e junta os modelos locais, as IAs pagas por uso e os programas de terminal numa conversa só, com a mesma memória para todas.':
      'Un programa que se ejecuta en tu máquina y reúne los modelos locales, las IAs de pago por uso y los programas de terminal en una sola conversación, con la misma memoria para todas.',

    Memória: 'Memoria',
    'IAs locais': 'IAs locales',
    Agente: 'Agente',
    Privacidade: 'Privacidad',
    Baixar: 'Descargar',
    Idioma: 'Idioma',

    'Pode falar,': 'Puedes hablar,',
    'É assim que o app abre. Sem tela de login, sem escolher plano — a conversa já está ali.':
      'Así se abre la app. Sin pantalla de inicio de sesión, sin elegir plan: la conversación ya está ahí.',
    'Você conta uma vez.': 'Lo cuentas una vez.',
    'E todas elas lembram.': 'Y todas lo recuerdan.',
    'IAUnifier aberto numa conversa nova: a marca, a saudação, os atalhos e o campo de escrever, com a IA escolhida ao lado do botão de enviar':
      'IAUnifier abierto en una conversación nueva: la marca, el saludo, los atajos y el campo de escritura, con la IA elegida junto al botón de enviar',
    'Todas as suas IAs,': 'Todas tus IAs,',
    'uma memória só': 'una sola memoria',
    'Os modelos que rodam no seu computador, as IAs pagas por uso e os programas de terminal, numa conversa só. O que você conta pra uma, todas sabem.':
      'Los modelos que se ejecutan en tu ordenador, las IAs de pago por uso y los programas de terminal, en una sola conversación. Lo que le cuentas a una, lo saben todas.',
    'Ver o código': 'Ver el código',
    role: 'desliza',

    'Uma memória, não cinco conversas': 'Una memoria, no cinco conversaciones',
    'Cada IA que você usa hoje começa do zero. IAUnifier guarda o que importa uma vez — como você gosta de resposta, o que tem no seu projeto, o que já ficou decidido — e entrega pra qualquer uma delas na hora de responder.':
      'Cada IA que usas hoy empieza de cero. IAUnifier guarda lo que importa una vez —cómo te gustan las respuestas, qué hay en tu proyecto, qué ya quedó decidido— y se lo entrega a cualquiera de ellas a la hora de responder.',
    'Você vê a origem': 'Ves de dónde salió',
    'Cada coisa guardada mostra de qual conversa veio.':
      'Cada cosa guardada muestra de qué conversación vino.',
    'Você manda': 'Tú mandas',
    'Mudar, esquecer ou desligar a memória só nesta resposta.':
      'Cambiarla, olvidarla o apagar la memoria solo en esta respuesta.',
    'Fica em casa': 'Se queda en casa',
    'A memória é um arquivo na sua máquina, não uma conta em servidor de ninguém.':
      'La memoria es un archivo en tu máquina, no una cuenta en el servidor de nadie.',

    'Perguntar pra várias': 'Preguntar a varias',
    'Pergunte pra cinco ao mesmo tempo': 'Pregunta a cinco a la vez',
    'A mesma pergunta em várias IAs, todas lendo a mesma memória. Compare lado a lado, deixe que elas votem ou receba as respostas costuradas numa só. Quem responde em três segundos não fica esperando quem leva quarenta.':
      'La misma pregunta en varias IAs, todas leyendo la misma memoria. Compara lado a lado, deja que voten o recibe las respuestas cosidas en una sola. La que responde en tres segundos no espera a la que tarda cuarenta.',
    'Tela Perguntar pra várias: a pergunta, a barra de progresso e três IAs respondendo lado a lado, cada uma com o tempo que levou':
      'Pantalla Preguntar a varias: la pregunta, la barra de progreso y tres IAs respondiendo lado a lado, cada una con el tiempo que tardó',

    'Só as IAs que cabem na sua máquina': 'Solo las IAs que caben en tu máquina',
    'IAUnifier olha a memória RAM e o processador da sua máquina e diz, em português, o que dá pra rodar: o que cabe com folga, o que cabe apertado e o que não cabe. Cada modelo vem com uma frase sobre para que ele é bom e por que escolhê-lo em vez do outro.':
      'IAUnifier mira la memoria RAM y el procesador de tu máquina y te dice, en español claro, qué puedes ejecutar: qué cabe holgado, qué cabe justo y qué no cabe. Cada modelo viene con una frase sobre para qué es bueno y por qué elegirlo en vez del otro.',
    'Tela IAs ligadas: a memória RAM e o processador da máquina descritos em português, e os modelos recomendados pra ela':
      'Pantalla IAs conectadas: la memoria RAM y el procesador de la máquina descritos en español, y los modelos recomendados para ella',

    'Programas de terminal': 'Programas de terminal',
    'Claude Code, Codex, Gemini e opencode dentro do app':
      'Claude Code, Codex, Gemini y opencode dentro de la app',
    'Os mesmos programas que você já usa no terminal respondem dentro da conversa, sem chave de API e sem cobrança por uso — eles usam a assinatura que você já tem. Leem a mesma memória das outras e trabalham na pasta que o projeto apontar.':
      'Los mismos programas que ya usas en la terminal responden dentro de la conversación, sin clave de API y sin cobro por uso: usan la suscripción que ya tienes. Leen la misma memoria que las demás y trabajan en la carpeta que indique el proyecto.',
    'Uma conversa com o Codex respondendo sobre algo que foi contado ao Claude Code, com o rodapé mostrando os dois fatos que ele usou da memória':
      'Una conversación con Codex respondiendo sobre algo que se le contó a Claude Code, con el pie mostrando los dos datos que usó de la memoria',

    'Modo agente': 'Modo agente',
    'Ela abre o navegador e vai atrás': 'Abre el navegador y va a buscar',
    'Um clique no globo e a IA passa a dirigir um navegador de verdade: busca, entra no site, clica, lê e volta com a resposta e o endereço de onde tirou. Não é o resumo de um resultado de busca — é a página aberta, inclusive a que só existe depois que o JavaScript roda. Você acompanha cada passo e o porquê dele.':
      'Un clic en el globo y la IA pasa a manejar un navegador de verdad: busca, entra en el sitio, hace clic, lee y vuelve con la respuesta y la dirección de donde la sacó. No es el resumen de un resultado de búsqueda: es la página abierta, incluida la que solo existe después de que el JavaScript se ejecuta. Sigues cada paso y su porqué.',
    'Funciona com qualquer IA da lista, inclusive as que rodam na sua máquina, desde que você tenha Chrome, Chromium, Edge ou Brave instalado. O navegador abre num perfil separado, longe da sua sessão do dia a dia, e não preenche campo de senha.':
      'Funciona con cualquier IA de la lista, incluidas las que se ejecutan en tu máquina, siempre que tengas Chrome, Chromium, Edge o Brave instalado. El navegador abre en un perfil aparte, lejos de tu sesión del día a día, y no rellena campos de contraseña.',
    'Uma conversa em modo agente: a trilha mostra a busca, a página aberta e o motivo de cada passo, e a resposta cita a fonte':
      'Una conversación en modo agente: el rastro muestra la búsqueda, la página abierta y el motivo de cada paso, y la respuesta cita la fuente',

    'Roda na sua máquina': 'Se ejecuta en tu máquina',
    'IAUnifier é um programa que você instala e roda na sua máquina, não um serviço na nuvem. Os modelos locais respondem sem internet. As IAs pagas por uso recebem só o que você mandar, com a sua chave. Memória, arquivos e histórico ficam numa pasta sua — dá pra abrir, copiar e apagar na mão.':
      'IAUnifier es un programa que instalas y ejecutas en tu máquina, no un servicio en la nube. Los modelos locales responden sin internet. Las IAs de pago por uso reciben solo lo que tú envíes, con tu propia clave. La memoria, los archivos y el historial viven en una carpeta tuya: puedes abrirla, copiarla y borrarla a mano.',
    'Conversa anônima': 'Conversación anónima',
    'Um toque e a conversa não entra no histórico, não usa a memória e não aprende nada. Some quando você fechar.':
      'Un toque y la conversación no entra en el historial, no usa la memoria y no aprende nada. Desaparece cuando la cierras.',

    'Baixar o IAUnifier': 'Descargar IAUnifier',
    Versão: 'Versión',
    'Grátis e de código aberto. Os modelos locais não custam nada; as IAs pagas por uso usam a sua chave.':
      'Gratis y de código abierto. Los modelos locales no cuestan nada; las IAs de pago por uso usan tu propia clave.',
    '.exe num .zip': '.exe en un .zip',
    'Windows 10 ou mais novo': 'Windows 10 o más nuevo',
    'precisa da libatomic': 'necesita libatomic',
    'macOS 13 ou mais novo': 'macOS 13 o más nuevo',
    'Máquina mais antiga?': '¿Máquina más antigua?',
    'Mac com Intel': 'Mac con Intel',
    'todos os arquivos': 'todos los archivos',
    'No Linux, instale a libatomic antes:': 'En Linux, instala libatomic antes:',
    'no Debian e Ubuntu,': 'en Debian y Ubuntu,',
    'no Fedora. Sem ela o programa nem abre.':
      'en Fedora. Sin ella el programa ni siquiera abre.',
    'O app roda em qualquer máquina — quem pede memória RAM são os modelos locais, e a tela de IAs ligadas diz o que cabe na sua. Ou':
      'La app funciona en cualquier máquina: los que piden memoria RAM son los modelos locales, y la pantalla de IAs conectadas dice qué cabe en la tuya. O',
    'compile a partir do código': 'compílala desde el código',

    'código aberto': 'código abierto',
    Código: 'Código',
    Versões: 'Versiones',
    'Voltar ao topo': 'Volver arriba'
  }
};
