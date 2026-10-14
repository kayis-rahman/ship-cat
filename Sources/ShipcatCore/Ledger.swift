import Foundation

public enum LedgerEventKind: String, Sendable, CaseIterable {
    case dispatched = "task.dispatched"
    case status = "task.status"
    case prReady = "task.pr_ready"
    case merged = "task.merged"
    case cleanedUp = "task.cleaned_up"
}

public enum Lifecycle: String, Sendable {
    case idle, working, attention, merged, cleanedUp, paused
}

/// A privacy-safe projection of a canonical Firstmate v1 record.
/// Deliberately has no property capable of holding task text or status text.
public struct LedgerEvent: Equatable, Sendable {
    public let kind: LedgerEventKind
    public let task: String
    public let lifecycle: Lifecycle
    public let timestamp: Int64?

    public init?(data: Data) {
        guard let object = try? JSONSerialization.jsonObject(with: data),
              let record = object as? [String: Any],
              (record["v"] as? Int) == 1,
              let eventName = record["event"] as? String,
              let kind = LedgerEventKind(rawValue: eventName),
              let task = record["task"] as? String, !task.isEmpty else { return nil }
        let lifecycle: Lifecycle
        switch kind {
        case .dispatched: lifecycle = .working
        case .status:
            let state = (record["state"] as? String ?? "").lowercased()
            switch state {
            case "working", "running", "started": lifecycle = .working
            case "attention", "needs-input", "needs_input", "blocked", "failed": lifecycle = .attention
            case "paused": lifecycle = .paused
            case "merged": lifecycle = .merged
            case "cleaned_up", "cleaned-up": lifecycle = .cleanedUp
            default: lifecycle = .idle
            }
        case .prReady: lifecycle = .attention
        case .merged: lifecycle = .merged
        case .cleanedUp: lifecycle = .cleanedUp
        }
        self.kind = kind
        self.task = task
        self.lifecycle = lifecycle
        self.timestamp = (record["ts"] as? NSNumber)?.int64Value
    }
}

public struct TaskIdentity: Hashable, Sendable {
    public let home: String
    public let task: String
    public init(home: String, task: String) { self.home = home; self.task = task }
}

public struct TaskProjection: Equatable, Sendable {
    public let identity: TaskIdentity
    public fileprivate(set) var lifecycle: Lifecycle
    public init(identity: TaskIdentity, lifecycle: Lifecycle) {
        self.identity = identity
        self.lifecycle = lifecycle
    }
}
