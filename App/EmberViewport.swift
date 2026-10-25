import AppKit
import SceneKit

@MainActor
final class EmberViewport: SCNView {
    enum Motion { case idle, walk, turn, jump }
    private let stage = SCNNode()
    private let stateRing = EmberStateRingView(frame: .zero)
    private var clock: TimeInterval = 0
    private(set) var loadError: String?
    var onPetClick: (() -> Void)?

    override init(frame: NSRect, options: [String: Any]? = nil) {
        super.init(frame: frame, options: options)
        backgroundColor = .clear
        stateRing.autoresizingMask = [.width, .height]
        addSubview(stateRing)
        isPlaying = false
        antialiasingMode = .multisampling4X
        guard let url = Bundle.main.url(forResource: "Ember", withExtension: "usdz"),
              let imported = try? SCNScene(url: url, options: nil) else {
            loadError = "Ember.usdz missing or could not be loaded"
            NSLog("Ember USDZ load failed: %@", loadError!)
            return
        }
        scene = SCNScene()
        stage.eulerAngles.x = -.pi / 2
        for node in imported.rootNode.childNodes { stage.addChildNode(node) }
        scene?.rootNode.addChildNode(stage)
        let camera = SCNCamera()
        camera.usesOrthographicProjection = true
        camera.orthographicScale = 2.7
        let cameraNode = SCNNode()
        cameraNode.camera = camera
        cameraNode.position = SCNVector3(0, 1.0, 6)
        cameraNode.look(at: SCNVector3(0, 1.0, 0))
        scene?.rootNode.addChildNode(cameraNode)
        let light = SCNLight()
        light.type = .omni
        light.intensity = 280
        let lightNode = SCNNode()
        lightNode.light = light
        lightNode.position = SCNVector3(2, 4, 5)
        scene?.rootNode.addChildNode(lightNode)
        let ambient = SCNLight()
        ambient.type = .ambient
        ambient.intensity = 90
        let ambientNode = SCNNode()
        ambientNode.light = ambient
        scene?.rootNode.addChildNode(ambientNode)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is unsupported") }

    func advance(_ delta: TimeInterval, motion: Motion, direction: CGFloat, jumpProgress: CGFloat = 0) {
        guard loadError == nil else { return }
        clock += delta
        switch motion {
        case .idle: sceneTime = 0.03 + (clock.truncatingRemainder(dividingBy: 0.95))
        case .walk: sceneTime = 1.01 + (clock.truncatingRemainder(dividingBy: 0.95))
        case .turn: sceneTime = 2.01 + min(0.49, clock.truncatingRemainder(dividingBy: 0.5))
        case .jump: sceneTime = 2.51 + min(1.45, Double(jumpProgress) * 1.45)
        }
        stage.eulerAngles.y = direction < 0 ? .pi : 0
    }

    func updateVisualState(lifecycle: Lifecycle, unreadCount: Int?, paused: Bool) {
        let lifecycleColor: NSColor
        switch lifecycle {
        case .working: lifecycleColor = .systemOrange
        case .attention: lifecycleColor = .systemPink
        case .merged: lifecycleColor = .systemGreen
        case .cleanedUp: lifecycleColor = .systemGray
        default: lifecycleColor = .systemBlue
        }
        stateRing.strokeColor = unreadCount.map { $0 > 0 } == true ? .systemPink : lifecycleColor
        stage.opacity = paused ? 0.5 : 1
    }

    @objc private func petClicked() { onPetClick?() }

    func enablePetClick() {
        let click = NSClickGestureRecognizer(target: self, action: #selector(petClicked))
        addGestureRecognizer(click)
    }

    func renderSnapshot() -> NSImage { snapshot() }
}

@MainActor
private final class EmberStateRingView: NSView {
    var strokeColor = NSColor.systemBlue {
        didSet { needsDisplay = true }
    }

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        let ring = NSBezierPath(ovalIn: bounds.insetBy(dx: 10, dy: 10))
        ring.lineWidth = 3
        strokeColor.withAlphaComponent(0.9).setStroke()
        ring.stroke()
    }
}
