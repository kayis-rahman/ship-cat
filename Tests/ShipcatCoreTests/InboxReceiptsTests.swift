import Foundation
import Testing
@testable import ShipcatCore

@Suite struct InboxReceiptsTests {
    private func receipts(pending: String, handled: String = "[]", omitted: String = "[]") -> Data {
        Data(#"{"schema":"fm-inbox-receipts.v1","pending":[\#(pending)],"handled":[\#(handled)],"omitted":\#(omitted)}"#.utf8)
    }

    @Test func projectsOnlyUnreadDiscordSenderAndTime() throws {
        let marker = "PRIVATE-MESSAGE-BODY-742"
        let data = receipts(pending: #"{"request_id":"discord-123","acknowledged":false,"source":"captain","at":"2025-04-03T12:30:00Z","body":"\#(marker)"}"#)
        let snapshot = try InboxReceiptsReader.parse(data)
        #expect(snapshot.count == 1)
        #expect(snapshot.messages == [DiscordUnreadMessage(sender: "captain", time: "2025-04-03T12:30:00Z")])
        #expect(!String(describing: snapshot).contains(marker))
    }

    @Test func excludesHandledAndNonDiscordReceipts() throws {
        let data = receipts(pending: #"{"request_id":"discord-read","acknowledged":true,"source":"captain","at":"now"},{"request_id":"other-1","acknowledged":false,"source":"operator","at":"now"},{"source":"operator","at":"now"}"#)
        #expect(try InboxReceiptsReader.parse(data).count == 0)
    }

    @Test func handledArrayDoesNotContributeToUnreadCount() throws {
        let data = receipts(
            pending: #"{"request_id":"discord-unread","acknowledged":false,"source":"captain","at":"now"}"#,
            handled: #"{"request_id":"discord-handled","acknowledged":true,"source":"captain","at":"earlier"}"#
        )
        let snapshot = try InboxReceiptsReader.parse(data)
        #expect(snapshot.count == 1)
        #expect(snapshot.messages == [DiscordUnreadMessage(sender: "captain", time: "now")])
    }

    @Test func validEmptyReceiptsAreKnownZero() throws {
        #expect(try InboxReceiptsReader.parse(receipts(pending: "")).count == 0)
    }

    @Test(arguments: [
        Data("".utf8),
        Data(#"{"schema":"wrong","pending":[],"omitted":[]}"#.utf8),
        Data(#"{"schema":"fm-inbox-receipts.v1","pending":[{"request_id":"discord-1"}],"omitted":[]}"#.utf8),
        Data(#"{"schema":"fm-inbox-receipts.v1","pending":[],"omitted":[{"surface":"truncated"}]}"#.utf8)
    ])
    func malformedOrIncompleteReceiptsFailClosed(data: Data) {
        #expect(throws: InboxReceiptsError.self) { try InboxReceiptsReader.parse(data) }
    }

    @Test func rejectsOversizedInput() {
        let data = Data(repeating: 0x20, count: InboxReceiptsReader.maximumBytes + 1)
        #expect(throws: InboxReceiptsError.tooLarge) { try InboxReceiptsReader.parse(data) }
    }

    @Test func handlesLargeUnreadCounts() throws {
        let rows = (0..<2_000).map { #"{"request_id":"discord-\#($0)","acknowledged":false,"source":"sender","at":"2025-04-03T12:30:00Z"}"# }.joined(separator: ",")
        let snapshot = try InboxReceiptsReader.parse(receipts(pending: rows))
        #expect(snapshot.count == 2_000)
    }
}
