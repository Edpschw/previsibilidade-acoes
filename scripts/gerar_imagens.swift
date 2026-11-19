// Gera as imagens da marca Real Terms: og.png (1200×630, compartilhamento em redes sociais)
// e os ícones icon-180.png (Apple) e icon-512.png (manifesto). Só AppKit/CoreGraphics, nada a instalar.
//
//   swift scripts/gerar_imagens.swift            (a partir da raiz do projeto)
//
// As cores seguem os tokens do tema escuro em style.css.
import AppKit

let fundo = NSColor(srgbRed: 0.043, green: 0.067, blue: 0.090, alpha: 1)      // #0b1117
let destaque = NSColor(srgbRed: 0.208, green: 0.788, blue: 0.678, alpha: 1)   // #35c9ad
let texto = NSColor(srgbRed: 0.898, green: 0.929, blue: 0.953, alpha: 1)      // #e5edf3
let mudo = NSColor(srgbRed: 0.545, green: 0.608, blue: 0.671, alpha: 1)       // #8b9bab
let borda = NSColor(srgbRed: 0.137, green: 0.192, blue: 0.251, alpha: 1)      // #233140

func png(_ largura: Int, _ altura: Int, _ arquivo: String, _ desenho: (CGRect) -> Void) {
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: largura, pixelsHigh: altura,
                               bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                               colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    desenho(CGRect(x: 0, y: 0, width: largura, height: altura))
    NSGraphicsContext.restoreGraphicsState()
    try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: arquivo))
    print("gerado \(arquivo)")
}

/// as três barras do logotipo, com a base em (x, y) e altura total h
func barras(_ x: CGFloat, _ y: CGFloat, _ h: CGFloat, _ cor: NSColor) {
    let w = h * 0.1875, gap = h * 0.09375
    cor.setFill()
    for (i, frac) in [0.3125, 0.53, 0.75].enumerated() {
        let r = CGRect(x: x + CGFloat(i) * (w + gap), y: y, width: w, height: h * CGFloat(frac) * 1.33)
        NSBezierPath(roundedRect: r, xRadius: w * 0.25, yRadius: w * 0.25).fill()
    }
}

func escrever(_ s: String, _ fonte: NSFont, _ cor: NSColor, _ ponto: CGPoint, kern: CGFloat = 0) {
    NSAttributedString(string: s, attributes: [.font: fonte, .foregroundColor: cor, .kern: kern]).draw(at: ponto)
}

func fonte(_ tamanho: CGFloat, _ peso: NSFont.Weight) -> NSFont { NSFont.systemFont(ofSize: tamanho, weight: peso) }

// ------------------------------------------------------------------ og.png
png(1200, 630, "og.png") { r in
    fundo.setFill(); r.fill()
    // brilho radial no alto, como na página de entrada
    let brilho = NSGradient(colors: [destaque.withAlphaComponent(0.30), destaque.withAlphaComponent(0.0)])!
    brilho.draw(fromCenter: CGPoint(x: 600, y: 640), radius: 0, toCenter: CGPoint(x: 600, y: 640), radius: 620, options: [])
    // pontos discretos lembrando o mapa 3D
    var semente: UInt64 = 7
    func aleatorio() -> CGFloat { semente = semente &* 6364136223846793005 &+ 1; return CGFloat(semente >> 33) / CGFloat(UInt32.max >> 1) }
    for _ in 0..<70 {
        let x = 760 + aleatorio() * 400, y = 90 + aleatorio() * 300, t = 2 + aleatorio() * 6
        destaque.withAlphaComponent(0.15 + aleatorio() * 0.35).setFill()
        NSBezierPath(ovalIn: CGRect(x: x, y: y, width: t, height: t)).fill()
    }
    // marca
    barras(80, 488, 56, destaque)
    escrever("Real", fonte(46, .heavy), destaque, CGPoint(x: 160, y: 486), kern: -1)
    let wReal = NSAttributedString(string: "Real ", attributes: [.font: fonte(46, .heavy), .kern: -1]).size().width
    escrever("Terms", fonte(46, .semibold), texto, CGPoint(x: 160 + wReal, y: 486), kern: -1)
    // slogan e apoio
    escrever("Brazilian stocks,", fonte(78, .bold), texto, CGPoint(x: 76, y: 318), kern: -2.5)
    escrever("in real terms.", fonte(78, .bold), texto, CGPoint(x: 76, y: 230), kern: -2.5)
    escrever("Fundamentals, valuation and a predictability score for every company", fonte(26, .regular), mudo, CGPoint(x: 80, y: 160))
    escrever("listed on B3, from official CVM filings, in reais or US dollars.", fonte(26, .regular), mudo, CGPoint(x: 80, y: 124))
    // rodapé
    borda.setFill(); CGRect(x: 80, y: 86, width: 1040, height: 1).fill()
    escrever("Data, not advice.  ·  PT | EN  ·  R$ | US$", fonte(20, .medium), mudo, CGPoint(x: 80, y: 46))
}

// ------------------------------------------------------------------ ícones
for (lado, arquivo) in [(180, "icon-180.png"), (512, "icon-512.png")] {
    png(lado, lado, arquivo) { r in
        let s = CGFloat(lado)
        fundo.setFill()
        NSBezierPath(roundedRect: r, xRadius: s * 0.22, yRadius: s * 0.22).fill()
        // grupo de barras: largura 0,75·h e altura ≈ 1,0·h; centralizado
        let h = s * 0.46
        barras((s - 0.75 * h) / 2, (s - 0.9975 * h) / 2, h, destaque)
    }
}
