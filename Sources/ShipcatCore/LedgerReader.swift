import Foundation

/// Reads a JSONL file without modifying it. Incomplete final lines are retained until completed.
public final class LedgerTailer {
    private var fileID: UInt64?
    private var offset: UInt64 = 0
    private var pending = Data()

    public init() {}

    public func read(url: URL, home: String) -> [LedgerEvent] {
        guard let values = try? FileManager.default.attributesOfItem(atPath: url.path),
              let size = (values[.size] as? NSNumber)?.uint64Value,
              let id = (values[.systemFileNumber] as? NSNumber)?.uint64Value,
              let handle = try? FileHandle(forReadingFrom: url) else { return [] }
        defer { try? handle.close() }
        if fileID != id || size < offset {
            fileID = id
            offset = 0
            pending.removeAll(keepingCapacity: true)
        }
        guard (try? handle.seek(toOffset: offset)) != nil,
              let chunk = try? handle.readToEnd() else { return [] }
        offset += UInt64(chunk.count)
        pending.append(chunk)
        var events: [LedgerEvent] = []
        while let newline = pending.firstIndex(of: 0x0A) {
            let line = pending[..<newline]
            if !line.isEmpty, let event = LedgerEvent(data: Data(line)) { events.append(event) }
            pending.removeSubrange(...newline)
        }
        return events
    }
}

public struct LedgerReducer: Sendable {
    private var tasks: [TaskIdentity: TaskProjection] = [:]
    private var seen: Set<String> = []

    /// Rank the pet's displayed state by urgency so an unresolved alert can never
    /// be hidden by a later or unrelated task. NOT "last accepted event wins".
    private static let displayOrder: [Lifecycle] = [.attention, .working, .paused, .idle, .merged, .cleanedUp]

    public init() {}

    /// The lifecycle the pet displays: the reducer's answer for the whole snapshot,
    /// never the lifecycle of the last accepted event.
    public func displayedLifecycle() -> Lifecycle {
        let lives = snapshot().map(\.lifecycle)
        return Self.displayOrder.first { lives.contains($0) } ?? .idle
    }

    @discardableResult
    public mutating func apply(_ event: LedgerEvent, home: String) -> Bool {
        let identity = TaskIdentity(home: home, task: event.task)
        let fingerprint = "\(home)\u{0}\(event.task)\u{0}\(event.kind.rawValue)\u{0}\(event.timestamp ?? 0)\u{0}\(event.lifecycle?.rawValue ?? "none")"
        guard seen.insert(fingerprint).inserted else { return false }
        // A record with no mappable lifecycle (absent or unrecognised state) is
        // ignored: it must not erase a status seen earlier. The retired Node
        // adapter did the same by mapping an unknown lifecycle to null.
        guard let lifecycle = event.lifecycle else { return true }
        if let existing = tasks[identity] {
            // A dispatch is only an initial state; it must not erase a status seen earlier.
            let resolved = event.kind == .dispatched ? existing.lifecycle : lifecycle
            tasks[identity] = TaskProjection(identity: identity, lifecycle: resolved)
        } else {
            tasks[identity] = TaskProjection(identity: identity, lifecycle: lifecycle)
        }
        return true
    }

    public func snapshot() -> [TaskProjection] {
        tasks.values.sorted { ($0.identity.home, $0.identity.task) < ($1.identity.home, $1.identity.task) }
    }
}

/// The outcome of polling one ledger batch.
public struct LifecyclePoll: Equatable, Sendable {
    /// The lifecycle the pet displays after this batch: the reducer's answer.
    public let lifecycle: Lifecycle
    /// True when this batch moved the pet's displayed lifecycle.
    public let changed: Bool
    /// The accepted event responsible for the move, so the notifier's dedup key
    /// still keys one real record. Nil when nothing moved.
    public let trigger: LedgerEvent?

    public init(lifecycle: Lifecycle, changed: Bool, trigger: LedgerEvent?) {
        self.lifecycle = lifecycle
        self.changed = changed
        self.trigger = trigger
    }
}

/// The pet's whole lifecycle pipeline in one boundary: tail the ledger read-only,
/// reduce it, and decide what the pet shows.
///
/// The displayed lifecycle is always re-read from the reducer snapshot after the
/// batch, never taken from the last accepted event. A replayed `task.dispatched`
/// therefore cannot erase a status seen earlier, a late `.working` for one task
/// cannot hide an unresolved `.attention` on another, and a record whose state
/// cannot be mapped cannot reset anything.
public struct PetLifecycleSource {
    private var tailer = LedgerTailer()
    private var reducer = LedgerReducer()
    private var displayed: Lifecycle = .idle

    public init() {}

    /// The lifecycle the pet currently displays.
    public var lifecycle: Lifecycle { displayed }

    /// Forget all state so a newly chosen ledger starts from scratch.
    public mutating func reset() {
        tailer = LedgerTailer()
        reducer = LedgerReducer()
        displayed = .idle
    }

    @discardableResult
    public mutating func poll(url: URL, home: String) -> LifecyclePoll {
        var trigger: LedgerEvent?
        for event in tailer.read(url: url, home: home) {
            guard reducer.apply(event, home: home) else { continue }
            let resolved = reducer.displayedLifecycle()
            guard resolved != displayed else { continue }
            displayed = resolved
            if trigger == nil { trigger = event }
        }
        return LifecyclePoll(lifecycle: displayed, changed: trigger != nil, trigger: trigger)
    }
}
