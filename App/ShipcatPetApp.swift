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
    private var source = PetLifecycleSource()
    private var ledgerTimer: Timer?
    private var inboxTimer: Timer?
    private var unreadSnapshot: DiscordUnreadSnapshot?
    private var inboxPolling = false
    private let inboxCommandKey = "discordInboxReceiptsCommand"
    private var inboxStatusItem: NSMenuItem?

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
        menu.addItem(NSMenuItem(title: "Choose Discord Inbox Command…", action: #selector(chooseInboxCommand), keyEquivalent: ""))
        let inboxStatus = NSMenuItem(title: "Discord unread: Unknown", action: nil, keyEquivalent: "")
        inboxStatus.isEnabled = false
        menu.addItem(inboxStatus)
        inboxStatusItem = inboxStatus
        menu.addItem(NSMenuItem(title: "Enable Lifecycle Notifications…", action: #selector(enableNotifications), keyEquivalent: ""))
        menu.addItem(NSMenuItem(title: "Start at Login", action: #selector(toggleLoginItem), keyEquivalent: ""))
        menu.addItem(.separator())
        menu.addItem(NSMenuItem(title: "Quit Shipcat", action: #selector(quit), keyEquivalent: "q"))
        for item in menu.items { item.target = self }
        statusItem.menu = menu
        if let path = UserDefaults.standard.string(forKey: inboxCommandKey) {
            startMonitoringInbox(command: URL(fileURLWithPath: path))
        }
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
        source.reset()
        ledgerTimer?.invalidate()
        pollLedger(url: url, home: home)
        ledgerTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.pollLedger(url: url, home: home) }
        }
    }
    private func pollLedger(url: URL, home: String) {
        let poll = source.poll(url: url, home: home)
        // The displayed lifecycle is the reducer's answer for the whole snapshot,
        // never the lifecycle of the last accepted event.
        lifecycle = poll.lifecycle
        // Notify only when the pet's state actually moved, so a replayed dispatch
        // or an unmappable status never posts a spurious "changed lifecycle" alert.
        if let trigger = poll.trigger { notifier.deliver(event: trigger, home: home) }
        updateView()
    }
    @objc private func chooseInboxCommand() {
        let picker = NSOpenPanel()
        picker.allowedContentTypes = [.shellScript, .unixExecutable]
        picker.allowsOtherFileTypes = true
        picker.canChooseDirectories = false
        picker.canChooseFiles = true
        guard picker.runModal() == .OK, let url = picker.url else { return }
        UserDefaults.standard.set(url.path, forKey: inboxCommandKey)
        startMonitoringInbox(command: url)
    }
    private func startMonitoringInbox(command: URL) {
        inboxTimer?.invalidate()
        pollInbox(command: command)
        inboxTimer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.pollInbox(command: command) }
        }
    }
    private func pollInbox(command: URL) {
        guard !inboxPolling else { return }
        inboxPolling = true
        let read = Task.detached(priority: .utility) { () -> DiscordUnreadSnapshot? in
            do { return try InboxReceiptsReader.parse(InboxReceiptsCommand.read(command: command)) }
            catch { return nil }
        }
        Task { @MainActor [weak self] in
            guard let self else { return }
            self.unreadSnapshot = await read.value
            self.inboxPolling = false
            self.updateInboxIndicator()
            self.updateView()
        }
    }
    private func updateInboxIndicator() {
        guard let button = statusItem?.button else { return }
        if let snapshot = unreadSnapshot {
            button.title = snapshot.count > 0 ? "🐈 \(snapshot.count)" : "🐈"
            inboxStatusItem?.title = "Discord unread: \(snapshot.count)"
        } else {
            button.title = "🐈 ?"
            inboxStatusItem?.title = "Discord unread: Unknown"
        }
        statusItem?.menu?.items.removeAll(where: { $0.tag == 707 })
        guard let snapshot = unreadSnapshot, let menu = statusItem?.menu, snapshot.count > 0,
              let statusItem = inboxStatusItem, let index = menu.items.firstIndex(of: statusItem) else { return }
        for message in snapshot.messages {
            let row = NSMenuItem(title: "\(message.sender) · \(message.time) · Unread", action: nil, keyEquivalent: "")
            row.isEnabled = false
            row.tag = 707
            menu.insertItem(row, at: index + 1 + menu.items.filter { $0.tag == 707 }.count)
        }
    }
    @objc private func enableNotifications() { notifier.requestOptIn() }
    @objc private func toggleLoginItem() {
        do {
            if SMAppService.mainApp.status == .enabled { try SMAppService.mainApp.unregister() }
            else { try SMAppService.mainApp.register() }
        } catch { NSLog("Shipcat login-item configuration failed: %@", String(describing: type(of: error))) }
    }
    @objc private func quit() { NSApp.terminate(nil) }
    private func updateView() { panel?.contentView = NSHostingView(rootView: PetView(lifecycle: lifecycle, paused: paused, unreadCount: unreadSnapshot?.count)) }
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
        let source = "\(home)\u{0}\(event.task)\u{0}\(event.kind.rawValue)\u{0}\(event.timestamp ?? 0)\u{0}\(event.lifecycle?.rawValue ?? "none")"
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
    var unreadCount: Int? = nil
    @State private var bounce = false
    /// The pet sprite. Loaded from the app bundle's Resources so the reference
    /// survives asset-catalog resolution differences; see
    /// App/Assets/Ember/PROVENANCE.md for provenance.
    private static let sprite = PetSprite.load()
    var body: some View {
        ZStack {
            Circle().fill(.black.opacity(0.06)).frame(width: 118, height: 118).blur(radius: 5).offset(y: 7)
            Image(nsImage: Self.sprite)
                .resizable().scaledToFit()
                .opacity(paused ? 0.5 : 1)
                .frame(width: 96, height: 96).scaleEffect(bounce ? 1.03 : 0.96)
                .animation(paused ? nil : .easeInOut(duration: 0.9).repeatForever(autoreverses: true), value: bounce)
                .overlay {
                    // Lifecycle accent only: tinted by shape, never with text or
                    // props. Mixed lightly so the artwork (green pupils, coat,
                    // markings) stays legible.
                    Circle().stroke((unreadCount.map { $0 > 0 } == true ? Color.pink : color).opacity(0.9), lineWidth: 3)
                        .frame(width: 104, height: 104)
                }
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

private enum InboxReceiptsCommand {
    static func read(command: URL) throws -> Data {
        let process = Process()
        let output = Pipe()
        process.executableURL = command
        process.arguments = ["receipts", "--all-pending", "--all-handled"]
        process.environment = ["PATH": "/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin"]
        process.standardOutput = output
        process.standardError = FileHandle.nullDevice
        try process.run()

        var data = Data()
        while true {
            let chunk = try output.fileHandleForReading.read(upToCount: 64 * 1024) ?? Data()
            if chunk.isEmpty { break }
            guard data.count + chunk.count <= InboxReceiptsReader.maximumBytes else {
                process.terminate()
                process.waitUntilExit()
                throw InboxReceiptsError.tooLarge
            }
            data.append(chunk)
        }
        process.waitUntilExit()
        guard process.terminationStatus == 0 else { throw InboxReceiptsError.malformed }
        return data
    }
}

/// The Ember sprite, bundled at App/Assets/Ember/ember.png. Provenance and the
/// exact generation settings are recorded in App/Assets/Ember/PROVENANCE.md.
private enum PetSprite {
    static let sprite = load()
    static func load() -> NSImage {
        guard let url = Bundle.main.url(forResource: "ember", withExtension: "png"),
              let image = NSImage(contentsOf: url) else { return NSImage() }
        image.size = NSSize(width: 512, height: 512)
        return image
    }
}
