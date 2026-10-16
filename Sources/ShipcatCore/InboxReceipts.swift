import Foundation

public struct DiscordUnreadMessage: Equatable, Sendable {
    public let sender: String
    public let time: String

    public init(sender: String, time: String) {
        self.sender = sender
        self.time = time
    }
}

/// A privacy-safe view of unread Discord receipt metadata. Message bodies and
/// all other receipt fields are deliberately absent from this projection.
public struct DiscordUnreadSnapshot: Equatable, Sendable {
    public let messages: [DiscordUnreadMessage]

    public var count: Int { messages.count }

    public init(messages: [DiscordUnreadMessage]) {
        self.messages = messages
    }
}

public enum InboxReceiptsError: Error, Equatable {
    case tooLarge
    case malformed
}

public enum InboxReceiptsReader {
    public static let maximumBytes = 1_048_576

    /// Parse only the bounded `fm-inbox-receipts.v1` JSON surface. Any malformed
    /// or truncated input fails closed so callers can show an unknown state.
    public static func parse(_ data: Data) throws -> DiscordUnreadSnapshot {
        guard data.count <= maximumBytes else { throw InboxReceiptsError.tooLarge }
        guard let root = try? JSONSerialization.jsonObject(with: data),
              let object = root as? [String: Any],
              object["schema"] as? String == "fm-inbox-receipts.v1",
              let pending = object["pending"] as? [[String: Any]],
              let omitted = object["omitted"] as? [[String: Any]],
              omitted.isEmpty else { throw InboxReceiptsError.malformed }

        var messages: [DiscordUnreadMessage] = []
        for note in pending {
            // Other firstmate inbox notes may have no request ID. They are not
            // part of this Discord projection and need not have Discord fields.
            guard let requestID = note["request_id"] as? String,
                  requestID.hasPrefix("discord-") else { continue }
            guard let acknowledged = note["acknowledged"] as? Bool else {
                throw InboxReceiptsError.malformed
            }
            guard !acknowledged else { continue }
            guard let sender = note["source"] as? String, !sender.isEmpty,
                  let time = note["at"] as? String, !time.isEmpty else {
                throw InboxReceiptsError.malformed
            }
            messages.append(DiscordUnreadMessage(sender: String(sender.prefix(160)), time: String(time.prefix(64))))
        }
        return DiscordUnreadSnapshot(messages: messages)
    }
}
