import AppKit
import Darwin
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
        if CommandLine.arguments.contains("--verify-displays") {
            controller.verifyDisplays()
            NSApp.terminate(nil)
        }
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
}

@MainActor
final class PetController: NSObject {
    private var panel: NSPanel!
    private var emberView: EmberViewport!
    private var statusItem: NSStatusItem!
    private var motionTimer: Timer?
    private var direction: CGFloat = -1
    private var jumpProgress: CGFloat?
    private var turnProgress: CGFloat?
    private var idleRemaining: TimeInterval = 2
    private var interactionEnabled = false
    private var paused = false
    private var lifecycle: Lifecycle = .idle
    private let notifier = LifecycleNotifier()
    private var source = PetLifecycleSource()
    private var ledgerTimer: Timer?
    private var inboxTimer: Timer?
    private var unreadSnapshot: DiscordUnreadSnapshot?
    private var inboxPolling = false
    private var activeInboxCommand: URL?
    private let inboxCommandKey = "discordInboxReceiptsCommand"
    private var inboxStatusItem: NSMenuItem?

    func show() {
        if panel == nil {
            panel = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 160, height: 160),
                            styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
            panel.isOpaque = false
            panel.backgroundColor = .clear
            panel.hasShadow = false
            panel.level = .floating
            panel.collectionBehavior = [.canJoinAllSpaces, .stationary]
            panel.isMovableByWindowBackground = false
            emberView = EmberViewport(frame: NSRect(x: 0, y: 0, width: 160, height: 160))
            emberView.onPetClick = { [weak self] in self?.jumpProgress = 0 }
            emberView.enablePetClick()
            panel.contentView = emberView
            panel.ignoresMouseEvents = true
            panel.setAccessibilityLabel("Shipcat Ember desktop pet")
            if let screen = NSScreen.main {
                panel.setFrameOrigin(NSPoint(x: screen.visibleFrame.maxX - 160, y: screen.visibleFrame.minY))
            }
        }
        updateView()
        panel.orderFrontRegardless()
        if motionTimer == nil {
            motionTimer = Timer.scheduledTimer(withTimeInterval: 1.0 / 30.0, repeats: true) { [weak self] _ in
                Task { @MainActor in self?.advancePet() }
            }
        }
    }

    func hide() {
        panel?.orderOut(nil)
        motionTimer?.invalidate()
        motionTimer = nil
    }
    func verifyRender(to url: URL) {
        guard let panel, panel.styleMask.contains(.borderless), panel.isOpaque == false,
              panel.level == .floating, panel.ignoresMouseEvents,
              panel.collectionBehavior.contains(.canJoinAllSpaces), let emberView else {
            fatalError("Pet window contract failed: \(emberView?.loadError ?? "window configuration")")
        }
        emberView.advance(0.25, motion: .walk, direction: direction)
        guard let tiff = emberView.renderSnapshot().tiffRepresentation,
              let bitmap = NSBitmapImageRep(data: tiff),
              let png = bitmap.representation(using: .png, properties: [:]) else { fatalError("Ember USDZ did not render") }
        do { try png.write(to: url) } catch { fatalError("Render write failed: \(error)") }
        guard png.count > 1000 else { fatalError("Ember render is unexpectedly empty") }
    }
    func togglePause() { paused.toggle(); updateView() }

    func verifyDisplays() {
        let screens = NSScreen.screens
        guard let panel, let emberView, !screens.isEmpty else {
            fatalError("Display verification requires a loaded pet and an available display")
        }
        for screen in screens {
            let frame = screen.visibleFrame
            panel.setFrameOrigin(NSPoint(x: frame.minX, y: frame.minY))
            emberView.advance(0.25, motion: .walk, direction: direction)
            guard frame.intersects(panel.frame), emberView.loadError == nil,
                  emberView.renderSnapshot().tiffRepresentation != nil else {
                fatalError("Ember display verification failed on \(screen.localizedName)")
            }
        }
    }

    private func advancePet() {
        guard let panel, let emberView, !paused else { return }
        let dt = 1.0 / 30.0
        let screenFrames = NSScreen.screens.map(\.visibleFrame)
        let frameBeforeMove = panel.frame
        guard let currentScreenIndex = ScreenEdgeMotion.screenIndex(for: frameBeforeMove, in: screenFrames),
              screenFrames.indices.contains(currentScreenIndex) else { return }
        let bounds = screenFrames[currentScreenIndex]
        var frame = frameBeforeMove
        if var turn = turnProgress {
            turn += dt / 0.5
            if turn >= 1 {
                turnProgress = nil
                direction *= -1
                jumpProgress = 0
            } else {
                turnProgress = turn
            }
        } else if var progress = jumpProgress {
            progress += dt / 1.25
            if progress >= 1 {
                jumpProgress = nil
                idleRemaining = 1.5
                frame.origin.y = bounds.minY
            } else {
                jumpProgress = progress
                frame.origin.y = bounds.minY + sin(progress * .pi) * 115
            }
        } else if idleRemaining > 0 {
            idleRemaining = max(0, idleRemaining - dt)
        } else {
            guard let step = ScreenEdgeMotion.advance(
                frame: frame,
                deltaX: direction * 42 * dt,
                screens: screenFrames
            ) else { return }
            frame = step.frame
            if step.reachedOuterEdge { turnProgress = 0 }
        }
        panel.setFrame(frame, display: false)
        let motion: EmberViewport.Motion = turnProgress != nil ? .turn : (jumpProgress != nil ? .jump : (idleRemaining > 0 ? .idle : .walk))
        emberView.advance(dt, motion: motion, direction: direction, jumpProgress: jumpProgress ?? 0)
    }

    @objc private func toggleInteractionMode() {
        interactionEnabled.toggle()
        panel?.ignoresMouseEvents = !interactionEnabled
        panel?.isMovableByWindowBackground = interactionEnabled
    }
    func installMenuBar() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        statusItem.button?.title = "🐈"
        statusItem.button?.setAccessibilityLabel("Shipcat pet controls")
        let menu = NSMenu()
        menu.addItem(NSMenuItem(title: "Show Pet", action: #selector(showPet), keyEquivalent: ""))
        menu.addItem(NSMenuItem(title: "Hide Pet", action: #selector(hidePet), keyEquivalent: ""))
        menu.addItem(NSMenuItem(title: "Pause / Resume", action: #selector(pausePet), keyEquivalent: ""))
        menu.addItem(NSMenuItem(title: "Toggle Interaction Mode", action: #selector(toggleInteractionMode), keyEquivalent: ""))
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
        activeInboxCommand = command
        inboxTimer?.invalidate()
        pollInbox(command: command)
        inboxTimer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.pollInbox(command: command) }
        }
    }
    private func pollInbox(command: URL) {
        guard command == activeInboxCommand, !inboxPolling else { return }
        inboxPolling = true
        let read = Task.detached(priority: .utility) { () -> DiscordUnreadSnapshot? in
            do { return try InboxReceiptsReader.parse(InboxReceiptsCommand.read(command: command)) }
            catch { return nil }
        }
        Task { @MainActor [weak self] in
            guard let self else { return }
            let snapshot = await read.value
            self.inboxPolling = false
            if command == self.activeInboxCommand {
                self.unreadSnapshot = snapshot
                self.updateInboxIndicator()
                self.updateView()
            } else if let activeCommand = self.activeInboxCommand {
                self.pollInbox(command: activeCommand)
            }
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
    private func updateView() {
        emberView?.updateVisualState(lifecycle: lifecycle, unreadCount: unreadSnapshot?.count, paused: paused)
        panel?.setAccessibilityLabel("Shipcat Ember, \(paused ? "paused" : lifecycle.rawValue)")
    }
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

private final class InboxCommandOutput: @unchecked Sendable {
    private let lock = NSLock()
    private var data = Data()
    private var error: Error?

    func append(_ chunk: Data) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard data.count + chunk.count <= InboxReceiptsReader.maximumBytes else {
            error = InboxReceiptsError.tooLarge
            return false
        }
        data.append(chunk)
        return true
    }

    func fail(_ error: Error) {
        lock.lock()
        self.error = error
        lock.unlock()
    }

    func result() -> (Data, Error?) {
        lock.lock()
        defer { lock.unlock() }
        return (data, error)
    }
}

private extension Array where Element == String {
    func withCStringArray<Result>(_ body: (UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>) -> Result) -> Result {
        let pointers: [UnsafeMutablePointer<CChar>?] = map { strdup($0) }
        defer { pointers.forEach { if let pointer = $0 { free(pointer) } } }
        var argv = pointers
        argv.append(nil)
        return argv.withUnsafeMutableBufferPointer { body($0.baseAddress!) }
    }
}

private enum InboxReceiptsCommand {
    static func read(command: URL) throws -> Data {
        let output = Pipe()
        var actions: posix_spawn_file_actions_t?
        var attributes: posix_spawnattr_t?
        guard posix_spawn_file_actions_init(&actions) == 0,
              posix_spawnattr_init(&attributes) == 0 else { throw InboxReceiptsError.malformed }
        defer {
            posix_spawn_file_actions_destroy(&actions)
            posix_spawnattr_destroy(&attributes)
        }
        let nullDescriptor = open("/dev/null", O_WRONLY)
        guard nullDescriptor >= 0 else { throw InboxReceiptsError.malformed }
        defer { close(nullDescriptor) }
        guard posix_spawn_file_actions_adddup2(&actions, output.fileHandleForWriting.fileDescriptor, STDOUT_FILENO) == 0,
              posix_spawn_file_actions_adddup2(&actions, nullDescriptor, STDERR_FILENO) == 0,
              posix_spawn_file_actions_addclose(&actions, output.fileHandleForReading.fileDescriptor) == 0,
              posix_spawn_file_actions_addclose(&actions, output.fileHandleForWriting.fileDescriptor) == 0,
              posix_spawnattr_setflags(&attributes, Int16(POSIX_SPAWN_SETPGROUP)) == 0,
              posix_spawnattr_setpgroup(&attributes, 0) == 0 else { throw InboxReceiptsError.malformed }

        let arguments = [command.path, "receipts", "--all-pending", "--all-handled"]
        let environment = ["PATH=/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin"]
        var pid = pid_t()
        let spawnResult = arguments.withCStringArray { argv in
            environment.withCStringArray { envp in
                posix_spawn(&pid, command.path, &actions, &attributes, argv, envp)
            }
        }
        guard spawnResult == 0 else { throw InboxReceiptsError.malformed }
        let spawnedPID = pid
        try? output.fileHandleForWriting.close()

        let reader = output.fileHandleForReading
        let finished = DispatchSemaphore(value: 0)
        let capturedOutput = InboxCommandOutput()
        reader.readabilityHandler = { handle in
            do {
                let chunk = try handle.read(upToCount: 64 * 1024) ?? Data()
                if chunk.isEmpty {
                    handle.readabilityHandler = nil
                    finished.signal()
                } else {
                    if !capturedOutput.append(chunk) {
                        _ = kill(-spawnedPID, SIGKILL)
                        handle.readabilityHandler = nil
                        finished.signal()
                    }
                }
            } catch {
                capturedOutput.fail(error)
                handle.readabilityHandler = nil
                finished.signal()
            }
        }

        guard finished.wait(timeout: .now() + 15) == .success else {
            reader.readabilityHandler = nil
            try? reader.close()
            _ = kill(-spawnedPID, SIGKILL)
            _ = waitpid(spawnedPID, nil, 0)
            throw InboxReceiptsError.malformed
        }
        var status: Int32 = 0
        guard waitpid(spawnedPID, &status, 0) == spawnedPID else { throw InboxReceiptsError.malformed }
        let (data, error) = capturedOutput.result()
        if let error { throw error }
        guard status & 0x7f == 0, (status >> 8) & 0xff == 0 else { throw InboxReceiptsError.malformed }
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
