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

    public init() {}

    @discardableResult
    public mutating func apply(_ event: LedgerEvent, home: String) -> Bool {
        let identity = TaskIdentity(home: home, task: event.task)
        let fingerprint = "\(home)\u{0}\(event.task)\u{0}\(event.kind.rawValue)\u{0}\(event.timestamp ?? 0)\u{0}\(event.lifecycle.rawValue)"
        guard seen.insert(fingerprint).inserted else { return false }
        if let existing = tasks[identity] {
            // A dispatch is only an initial state; it must not erase a status seen earlier.
            let lifecycle = event.kind == .dispatched ? existing.lifecycle : event.lifecycle
            tasks[identity] = TaskProjection(identity: identity, lifecycle: lifecycle)
        } else {
            tasks[identity] = TaskProjection(identity: identity, lifecycle: event.lifecycle)
        }
        return true
    }

    public func snapshot() -> [TaskProjection] {
        tasks.values.sorted { ($0.identity.home, $0.identity.task) < ($1.identity.home, $1.identity.task) }
    }
}
