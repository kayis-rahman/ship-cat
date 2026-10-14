import AppKit
import SwiftUI

@main
struct ShipcatPetApp: App {
    @NSApplicationDelegateAdaptor(PetAppDelegate.self) private var appDelegate
    var body: some Scene { Settings { EmptyView() } }
}

@MainActor
final class PetAppDelegate: NSObject, NSApplicationDelegate {
    private var controller: PetController?
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        let controller = PetController()
        self.controller = controller
        controller.installMenuBar()
        controller.show()
        if CommandLine.arguments.contains("--render-test") {
            controller.verifyRender(to: URL(fileURLWithPath: "/tmp/shipcat-pet-render.png"))
            NSApp.terminate(nil)
        }
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
}

@MainActor
final class PetController: NSObject {
    private var panel: NSPanel!
    private var statusItem: NSStatusItem!
    private var paused = false
    private var lifecycle: Lifecycle = .idle

    func show() {
        if panel == nil {
            let content = PetView(lifecycle: lifecycle, paused: paused)
            let hosting = NSHostingView(rootView: content)
            panel = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 132, height: 132),
                            styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
            panel.isOpaque = false
            panel.backgroundColor = .clear
            panel.hasShadow = false
            panel.level = .floating
            panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
            panel.isMovableByWindowBackground = true
            panel.contentView = hosting
            panel.setAccessibilityLabel("Shipcat lifecycle pet")
            if let screen = NSScreen.main {
                panel.setFrameOrigin(NSPoint(x: screen.visibleFrame.maxX - 160, y: screen.visibleFrame.maxY - 160))
            }
        }
        panel.orderFrontRegardless()
    }

    func hide() { panel?.orderOut(nil) }
    func verifyRender(to url: URL) {
        guard let panel, panel.styleMask.contains(.borderless), panel.isOpaque == false,
              panel.level == .floating, panel.collectionBehavior.contains(.fullScreenAuxiliary),
              let view = panel.contentView else { fatalError("Pet window contract failed") }
        view.layoutSubtreeIfNeeded()
        guard let bitmap = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { fatalError("No render surface") }
        view.cacheDisplay(in: view.bounds, to: bitmap)
        guard let png = bitmap.representation(using: .png, properties: [:]) else { fatalError("PNG encoding failed") }
        do { try png.write(to: url) } catch { fatalError("Render write failed: \(error)") }
        guard png.count > 1000 else { fatalError("Pet render is unexpectedly empty") }
    }
    func togglePause() { paused.toggle(); updateView() }
    func installMenuBar() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        statusItem.button?.title = "🐈"
        statusItem.button?.setAccessibilityLabel("Shipcat pet controls")
        let menu = NSMenu()
        menu.addItem(NSMenuItem(title: "Show Pet", action: #selector(showPet), keyEquivalent: ""))
        menu.addItem(NSMenuItem(title: "Hide Pet", action: #selector(hidePet), keyEquivalent: ""))
        menu.addItem(NSMenuItem(title: "Pause / Resume", action: #selector(pausePet), keyEquivalent: ""))
        menu.addItem(.separator())
        menu.addItem(NSMenuItem(title: "Quit Shipcat", action: #selector(quit), keyEquivalent: "q"))
        for item in menu.items { item.target = self }
        statusItem.menu = menu
    }
    @objc private func showPet() { show() }
    @objc private func hidePet() { hide() }
    @objc private func pausePet() { togglePause() }
    @objc private func quit() { NSApp.terminate(nil) }
    private func updateView() { panel?.contentView = NSHostingView(rootView: PetView(lifecycle: lifecycle, paused: paused)) }
}

private struct PetView: View {
    let lifecycle: Lifecycle
    let paused: Bool
    @State private var bounce = false
    var body: some View {
        ZStack {
            Circle().fill(.black.opacity(0.06)).frame(width: 118, height: 118).blur(radius: 5).offset(y: 7)
            Image(systemName: paused ? "cat.fill" : "cat.fill")
                .resizable().scaledToFit().foregroundStyle(color)
                .frame(width: 96, height: 96).scaleEffect(bounce ? 1.03 : 0.96)
                .animation(paused ? nil : .easeInOut(duration: 0.9).repeatForever(autoreverses: true), value: bounce)
        }
        .frame(width: 132, height: 132)
        .background(.clear)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Shipcat pet, \(paused ? "paused" : lifecycle.rawValue)")
        .onAppear { bounce = true }
    }
    private var color: Color {
        switch lifecycle { case .working: .orange; case .attention: .pink; case .merged: .green; case .cleanedUp: .gray; default: .blue }
    }
}
