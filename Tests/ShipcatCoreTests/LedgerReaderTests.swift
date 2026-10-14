import Foundation
import Testing
@testable import ShipcatCore

@Suite struct LedgerReaderTests {
    private func tempFile() -> URL {
        FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    }
    private func record(_ event: String, task: String = "t", state: String = "working") -> String {
        #"{"v":1,"ts":7,"event":"\#(event)","task":"\#(task)","state":"\#(state)"}"#
    }

    @Test func completeLinesPartialAndMalformed() throws {
        let url = tempFile(); defer { try? FileManager.default.removeItem(at: url) }
        try Data((record("task.dispatched") + "\n{bad}\n" + record("task.status").prefix(30)).utf8).write(to: url)
        let tailer = LedgerTailer()
        #expect(tailer.read(url: url, home: "h").map(\.kind) == [.dispatched])
        let handle = try FileHandle(forWritingTo: url); try handle.seekToEnd()
        try handle.write(contentsOf: Data((String(record("task.status").dropFirst(30)) + "\n").utf8)); try handle.close()
        #expect(tailer.read(url: url, home: "h").map(\.kind) == [.status])
    }

    @Test func replacementAndTruncationReplayFromStart() throws {
        let url = tempFile(); defer { try? FileManager.default.removeItem(at: url) }
        try Data((record("task.dispatched") + "\n").utf8).write(to: url)
        let tailer = LedgerTailer()
        #expect(tailer.read(url: url, home: "h").count == 1)
        let replacement = tempFile(); defer { try? FileManager.default.removeItem(at: replacement) }
        try Data((record("task.status", task: "a-very-long-previous-task-identifier") + "\n").utf8).write(to: replacement)
        _ = try FileManager.default.replaceItemAt(url, withItemAt: replacement)
        #expect(tailer.read(url: url, home: "h").map(\.task) == ["a-very-long-previous-task-identifier"])
        let truncation = try FileHandle(forWritingTo: url)
        try truncation.truncate(atOffset: 0)
        try truncation.write(contentsOf: Data((record("task.merged", task: "short") + "\n").utf8))
        try truncation.close()
        #expect(tailer.read(url: url, home: "h").map(\.task) == ["short"])
    }

    @Test func reducerDeduplicatesSeparatesHomesAndKeepsStatusBeforeDispatch() {
        var reducer = LedgerReducer()
        let status = LedgerEvent(data: Data(record("task.status", state: "attention").utf8))!
        let dispatch = LedgerEvent(data: Data(record("task.dispatched").utf8))!
        let first = reducer.apply(status, home: "a")
        let duplicate = reducer.apply(status, home: "a")
        let sameHomeDispatch = reducer.apply(dispatch, home: "a")
        let otherHomeDispatch = reducer.apply(dispatch, home: "b")
        #expect(first)
        #expect(!duplicate)
        #expect(sameHomeDispatch)
        #expect(otherHomeDispatch)
        let rows = reducer.snapshot()
        #expect(rows.count == 2)
        #expect(rows.first(where: { $0.identity.home == "a" })?.lifecycle == .attention)
    }

    @Test func malformedAndUnknownAreIgnored() throws {
        let url = tempFile(); defer { try? FileManager.default.removeItem(at: url) }
        try Data(("not-json\n" + #"{"v":1,"event":"task.future","task":"x"}"# + "\n").utf8).write(to: url)
        #expect(LedgerTailer().read(url: url, home: "h").isEmpty)
    }
}
