// A janela do Nuvo, nativa.
//
// O que existia antes era o Chrome em `--app=`: janela sem aba e sem barra de
// endereço, mas ainda o Chrome. No Dock aparecia o ícone do Chrome, no Cmd+Tab
// aparecia "Google Chrome", e clicar no Nuvo na barra abria o navegador. Um app
// que abre outro app não é um app.
//
// Isto é uma WKWebView num NSWindow, e mais nada: o ícone é o do Nuvo, o menu é
// o do Nuvo, e o Chrome não entra na história. O servidor continua sendo o
// mesmo binário Node — este processo só o levanta se ninguém estiver atendendo,
// e o derruba ao fechar se foi ele quem levantou.

import AppKit
import Foundation
import WebKit

let PORTA_PADRAO = 4747

/// O servidor que atende nesta porta é um Nuvo?
///
/// A pergunta não é "a porta está ocupada": o endereço que a janela abre leva o
/// token de acesso dentro, e mandá-lo pra um programa qualquer que tenha tomado
/// a porta entregaria a chave da casa.
func ehNuvo(_ porta: Int, prazo: TimeInterval = 1.5) -> Bool {
    guard let url = URL(string: "http://127.0.0.1:\(porta)/api/ping") else { return false }
    var pedido = URLRequest(url: url)
    pedido.timeoutInterval = prazo
    var resposta = false
    let espera = DispatchSemaphore(value: 0)
    URLSession.shared.dataTask(with: pedido) { dados, _, _ in
        if let dados, let obj = try? JSONSerialization.jsonObject(with: dados) as? [String: Any] {
            resposta = (obj["app"] as? String) == "nuvo"
        }
        espera.signal()
    }.resume()
    _ = espera.wait(timeout: .now() + prazo + 0.5)
    return resposta
}

/// Onde o servidor guarda as coisas, e com que porta e token ele sobe.
func configuracao() -> (porta: Int, token: String?) {
    let casa = ProcessInfo.processInfo.environment["NUVO_HOME"]
        ?? (NSHomeDirectory() as NSString).appendingPathComponent(".nuvo")
    let arquivo = (casa as NSString).appendingPathComponent("config.json")
    guard let dados = FileManager.default.contents(atPath: arquivo),
          let obj = try? JSONSerialization.jsonObject(with: dados) as? [String: Any]
    else { return (PORTA_PADRAO, nil) }
    let porta = (obj["port"] as? Int) ?? PORTA_PADRAO
    // Token só entra na URL quando o servidor exige um.
    let exige = (obj["requireToken"] as? Bool) ?? true
    return (porta, exige ? obj["accessToken"] as? String : nil)
}

final class Janela: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate {
    var janela: NSWindow!
    var web: WKWebView!
    var servidor: Process?
    let endereco: URL

    init(endereco: URL) {
        self.endereco = endereco
        super.init()
    }

    /// A configuração da web, uma só: o `--verificar` tem que ver exatamente o
    /// que a janela vê, senão ele prova outra coisa.
    static func configuracaoDaWeb() -> WKWebViewConfiguration {
        let config = WKWebViewConfiguration()
        // A barra de título é transparente e o conteúdo sobe até o topo — é o
        // que deixa a janela com cara de app e não de navegador. Só que os três
        // botões do macOS flutuam sobre o canto superior esquerdo, e ali mora a
        // marca do Nuvo: fechar, minimizar e tela cheia apareciam em cima do
        // logo. A página não tem como adivinhar isso, então a janela avisa e o
        // CSS abre o espaço que eles ocupam.
        config.userContentController.addUserScript(
            WKUserScript(
                source: "document.documentElement.dataset.janelaNativa = '1';",
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true
            )
        )
        // O app é servido de 127.0.0.1: mídia e microfone (o ditado) não podem
        // pedir gesto do usuário a cada vez, senão a fala não começa.
        config.mediaTypesRequiringUserActionForPlayback = []
        return config
    }

    func applicationDidFinishLaunching(_ note: Notification) {
        let config = Janela.configuracaoDaWeb()
        web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = self
        web.uiDelegate = self
        // Rolar até o fim e continuar puxando mostra o fundo da janela; com a
        // mesma cor do app, o encontro não aparece.
        web.setValue(false, forKey: "drawsBackground")

        janela = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1180, height: 820),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        janela.title = "Nuvo"
        janela.titlebarAppearsTransparent = true
        janela.titleVisibility = .hidden
        janela.minSize = NSSize(width: 380, height: 520)
        janela.contentView = web
        janela.center()
        // A posição e o tamanho voltam onde a pessoa deixou.
        janela.setFrameAutosaveName("janela-nuvo")
        janela.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        web.load(URLRequest(url: endereco))
        montarMenu()
    }

    /// Sem menu, Cmd+C e Cmd+V não funcionam: quem os implementa no macOS é o
    /// item de menu, não a view.
    func montarMenu() {
        let principal = NSMenu()

        let appItem = NSMenuItem()
        principal.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "Sobre o Nuvo", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Ocultar", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(withTitle: "Sair", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu

        let editarItem = NSMenuItem()
        principal.addItem(editarItem)
        let editar = NSMenu(title: "Editar")
        editar.addItem(withTitle: "Desfazer", action: Selector(("undo:")), keyEquivalent: "z")
        editar.addItem(withTitle: "Refazer", action: Selector(("redo:")), keyEquivalent: "Z")
        editar.addItem(.separator())
        editar.addItem(withTitle: "Recortar", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editar.addItem(withTitle: "Copiar", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editar.addItem(withTitle: "Colar", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editar.addItem(withTitle: "Selecionar tudo", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editarItem.submenu = editar

        let verItem = NSMenuItem()
        principal.addItem(verItem)
        let ver = NSMenu(title: "Ver")
        ver.addItem(withTitle: "Recarregar", action: #selector(recarregar), keyEquivalent: "r")
        ver.addItem(withTitle: "Tela cheia", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
        verItem.submenu = ver

        NSApp.mainMenu = principal
    }

    @objc func recarregar() { web.reload() }

    /// Link pra fora vai pro navegador de verdade: a janela do app é do app.
    func webView(_ web: WKWebView, decidePolicyFor acao: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = acao.request.url else { return decisionHandler(.allow) }
        let interno = url.host == "127.0.0.1" || url.host == "localhost" || url.scheme == "about"
        if interno { return decisionHandler(.allow) }
        NSWorkspace.shared.open(url)
        decisionHandler(.cancel)
    }

    /// `window.open` também: sem isto o clique num link de fora não faz nada.
    func webView(_ web: WKWebView, createWebViewWith config: WKWebViewConfiguration,
                 for acao: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = acao.request.url { NSWorkspace.shared.open(url) }
        return nil
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ app: NSApplication) -> Bool { true }

    func applicationWillTerminate(_ note: Notification) {
        // Só derruba o servidor se foi este processo que o levantou: quem já
        // tinha um `nuvo` rodando no terminal não perde a sessão por fechar a
        // janela.
        servidor?.terminate()
    }
}

// ---------------------------------------------------------------- a abertura

/// O binário do servidor mora ao lado deste, dentro do mesmo `.app`.
func caminhoDoServidor() -> String? {
    let meu = URL(fileURLWithPath: CommandLine.arguments[0]).resolvingSymlinksInPath()
    let irmao = meu.deletingLastPathComponent().appendingPathComponent("nuvo-servidor")
    return FileManager.default.isExecutableFile(atPath: irmao.path) ? irmao.path : nil
}

// Quem chama isto de dentro de um terminal quer a linha de comando.
//
// `Nuvo.app/Contents/MacOS/Nuvo` era o binário do Node, e continua sendo o
// caminho que script e atalho antigos conhecem. Trocá-lo por uma janela sem
// mais nada quebraria em silêncio quem escreveu `.../MacOS/Nuvo backup` — abre
// uma janela e o backup não acontece. Com argumento, ou com terminal do outro
// lado, este processo sai da frente e entrega a vez pro servidor.
let verificando = CommandLine.arguments.contains("--verificar")
let argumentos = Array(CommandLine.arguments.dropFirst()).filter { $0 != "--verificar" }
if !verificando && (!argumentos.isEmpty || isatty(STDOUT_FILENO) == 1) {
    if let bin = caminhoDoServidor() {
        var argv: [UnsafeMutablePointer<CChar>?] = ([bin] + argumentos).map { strdup($0) }
        argv.append(nil)
        execv(bin, &argv)
    }
    FileHandle.standardError.write(Data("nuvo: não achei o servidor ao lado da janela\n".utf8))
    exit(127)
}

let cfg = configuracao()
var token = cfg.token
var levantado: Process? = nil

if !ehNuvo(cfg.porta) {
    // Ninguém atendendo: sobe o servidor e espera ele responder. Sem isto a
    // janela abriria em "não foi possível conectar" e a pessoa teria que
    // recarregar na mão.
    if let bin = caminhoDoServidor() {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: bin)
        p.arguments = ["--port", String(cfg.porta)]
        p.standardOutput = FileHandle.nullDevice
        p.standardError = FileHandle.nullDevice
        try? p.run()
        levantado = p
        // O primeiro start cria banco e índice: 20 s é folga, não expectativa.
        let limite = Date().addingTimeInterval(20)
        while Date() < limite && !ehNuvo(cfg.porta, prazo: 0.6) {
            Thread.sleep(forTimeInterval: 0.3)
        }
        // O token pode ter nascido agora, junto com o config.
        token = configuracao().token
    }
}

var endereco = "http://127.0.0.1:\(cfg.porta)/"
if let t = token, !t.isEmpty {
    endereco += "?token=\(t.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? t)"
}

// `--verificar` carrega a página, diz o que veio e sai. É como o teste confere
// que a janela nativa mostra o app de verdade sem depender de olhar a tela.
if CommandLine.arguments.contains("--verificar") {
    let w = WKWebView(frame: NSRect(x: 0, y: 0, width: 1180, height: 820),
                      configuration: Janela.configuracaoDaWeb())
    w.load(URLRequest(url: URL(string: endereco)!))
    let limite = Date().addingTimeInterval(25)
    var pronto = false
    while Date() < limite && !pronto {
        RunLoop.current.run(until: Date().addingTimeInterval(0.25))
        let espera = DispatchSemaphore(value: 0)
        w.evaluateJavaScript("""
            [document.title,
             !!document.querySelector('#app'),
             document.querySelectorAll('[data-view]').length,
             getComputedStyle(document.querySelector('.side-head')).paddingTop].join('|')
            """) { r, _ in
            if let t = r as? String, t.hasSuffix("|true|") == false, t.contains("|true|") { print(t); pronto = true }
            espera.signal()
        }
        _ = espera.wait(timeout: .now() + 3)
    }
    levantado?.terminate()
    exit(pronto ? 0 : 1)
}

let app = NSApplication.shared
app.setActivationPolicy(.regular)
let dono = Janela(endereco: URL(string: endereco)!)
dono.servidor = levantado
app.delegate = dono
app.run()
