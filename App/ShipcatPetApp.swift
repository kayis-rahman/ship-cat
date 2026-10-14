import AppKit
import CryptoKit
import ServiceManagement
import SwiftUI
import UserNotifications
import UniformTypeIdentifiers

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
    private let notifier = LifecycleNotifier()
    private var tailer: LedgerTailer?
    private var reducer = LedgerReducer()
    private var ledgerTimer: Timer?

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
        menu.addItem(NSMenuItem(title: "Choose Fleet Ledger…", action: #selector(chooseLedger), keyEquivalent: ""))
        menu.addItem(NSMenuItem(title: "Enable Lifecycle Notifications…", action: #selector(enableNotifications), keyEquivalent: ""))
        menu.addItem(NSMenuItem(title: "Start at Login", action: #selector(toggleLoginItem), keyEquivalent: ""))
        menu.addItem(.separator())
        menu.addItem(NSMenuItem(title: "Quit Shipcat", action: #selector(quit), keyEquivalent: "q"))
        for item in menu.items { item.target = self }
        statusItem.menu = menu
    }
    @objc private func showPet() { show() }
    @objc private func hidePet() { hide() }
    @objc private func pausePet() { togglePause() }
    @objc private func chooseLedger() {
        let picker = NSOpenPanel()
        picker.allowedContentTypes = [.json]
        picker.allowsOtherFileTypes = true
        picker.canChooseDirectories = false
        picker.canChooseFiles = true
        guard picker.runModal() == .OK, let url = picker.url else { return }
        startMonitoring(url: url, home: url.deletingLastPathComponent().lastPathComponent)
    }
    private func startMonitoring(url: URL, home: String) {
        tailer = LedgerTailer()
        reducer = LedgerReducer()
        ledgerTimer?.invalidate()
        pollLedger(url: url, home: home)
        ledgerTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.pollLedger(url: url, home: home) }
        }
    }
    private func pollLedger(url: URL, home: String) {
        guard let tailer else { return }
        for event in tailer.read(url: url, home: home) where reducer.apply(event, home: home) {
            lifecycle = event.lifecycle
            notifier.deliver(event: event, home: home)
        }
        updateView()
    }
    @objc private func enableNotifications() { notifier.requestOptIn() }
    @objc private func toggleLoginItem() {
        do {
            if SMAppService.mainApp.status == .enabled { try SMAppService.mainApp.unregister() }
            else { try SMAppService.mainApp.register() }
        } catch { NSLog("Shipcat login-item configuration failed: %@", String(describing: type(of: error))) }
    }
    @objc private func quit() { NSApp.terminate(nil) }
    private func updateView() { panel?.contentView = NSHostingView(rootView: PetView(lifecycle: lifecycle, paused: paused)) }
}

@MainActor
private final class LifecycleNotifier {
    private let center = UNUserNotificationCenter.current()
    private let defaults = UserDefaults.standard
    private let enabledKey = "lifecycleNotificationsEnabled"
    private let seenKey = "deliveredLifecycleEventHashes"

    func requestOptIn() {
        Task {
            let allowed = (try? await center.requestAuthorization(options: [.alert, .sound])) == true
            defaults.set(allowed, forKey: enabledKey)
        }
    }

    func deliver(event: LedgerEvent, home: String) {
        guard defaults.bool(forKey: enabledKey) else { return }
        let source = "\(home)\u{0}\(event.task)\u{0}\(event.kind.rawValue)\u{0}\(event.timestamp ?? 0)"
        let hash = SHA256.hash(data: Data(source.utf8)).map { String(format: "%02x", $0) }.joined()
        var seen = Set(defaults.stringArray(forKey: seenKey) ?? [])
        guard seen.insert(hash).inserted else { return }
        defaults.set(Array(seen.suffix(500)), forKey: seenKey)
        let content = UNMutableNotificationContent()
        content.title = "Shipcat"
        content.body = "A task changed lifecycle state."
        Task { try? await center.add(UNNotificationRequest(identifier: hash, content: content, trigger: nil)) }
    }
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
