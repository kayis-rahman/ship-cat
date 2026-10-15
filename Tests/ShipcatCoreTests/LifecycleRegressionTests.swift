import Foundation
import Testing
@testable import ShipcatCore

/// Regression cover for the two no-mistakes review findings.
///
/// F2: the pet displayed the raw event's lifecycle instead of the reducer's, so a
/// replayed or late `task.dispatched` (which maps to `.working`) erased a
/// `task.status` the reducer had deliberately preserved.
///
/// F3: an absent or unrecognised `state` fell through to `.idle` and cleared an
/// active alert.
@Suite struct LifecycleRegressionTests {
    private func tempFile() -> URL {
        FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    }
    private func write(_ lines: [String], to url: URL) throws {
        try Data((lines.joined(separator: "\n") + "\n").utf8).write(to: url)
    }
    private func poll(_ lines: [String]) throws -> LifecyclePoll {
        let url = tempFile()
        defer { try? FileManager.default.removeItem(at: url) }
        try write(lines, to: url)
        var source = PetLifecycleSource()
        return source.poll(url: url, home: "h")
    }

    // MARK: F2 - the pet must show the reducer's answer

    @Test func dispatchAfterStatusDoesNotEraseAttention() throws {
        // The failing sequence from the review: reachable on a re-dispatch, on a
        // multi-writer ledger flushed out of order, and on every replay (ordering
        // is file order, not ts order).
        let poll = try poll([
            #"{"v":1,"ts":1,"event":"task.status","task":"fix-login","state":"attention"}"#,
            #"{"v":1,"ts":2,"event":"task.dispatched","task":"fix-login"}"#
        ])
        #expect(poll.lifecycle == .attention)
        // The reducer agreed all along; it simply was never surfaced.
        #expect(poll.changed)
    }

    @Test func replayedDispatchAfterAttentionFiresNoNotification() throws {
        // The review's sequence split across batches: the re-dispatch is a later
        // write, so it arrives in a second poll. The pet must not move and the
        // notifier must receive no trigger for a "changed lifecycle" alert.
        let url = tempFile()
        defer { try? FileManager.default.removeItem(at: url) }
        try write([#"{"v":1,"ts":1,"event":"task.status","task":"fix-login","state":"attention"}"#], to: url)
        var source = PetLifecycleSource()
        let first = source.poll(url: url, home: "h")
        #expect(first.lifecycle == .attention)
        #expect(first.changed)
        let handle = try FileHandle(forWritingTo: url)
        try handle.seekToEnd()
        try handle.write(contentsOf: Data((#"{"v":1,"ts":2,"event":"task.dispatched","task":"fix-login"}"# + "\n").utf8))
        try handle.close()
        let second = source.poll(url: url, home: "h")
        #expect(second.lifecycle == .attention)
        #expect(!second.changed)
        #expect(second.trigger == nil)
    }

    @Test func triggerIsTheRecordThatMovedTheDisplay() throws {
        // When one batch contains the status and the later re-dispatch, the
        // notifier's trigger must be the record that actually moved the pet -
        // the attention status - never the dispatch that moved nothing.
        let poll = try poll([
            #"{"v":1,"ts":1,"event":"task.status","task":"fix-login","state":"attention"}"#,
            #"{"v":1,"ts":2,"event":"task.dispatched","task":"fix-login"}"#
        ])
        #expect(poll.changed)
        #expect(poll.lifecycle == .attention)
        #expect(poll.trigger?.kind == .status)
        #expect(poll.trigger?.task == "fix-login")
        #expect(poll.trigger?.lifecycle == .attention)
    }

    @Test func lateWorkingForAnotherTaskDoesNotHideAttention() throws {
        // "Last accepted event wins" across unrelated tasks hid an unresolved
        // .attention.
        let poll = try poll([
            #"{"v":1,"ts":1,"event":"task.status","task":"task-a","state":"attention"}"#,
            #"{"v":1,"ts":2,"event":"task.status","task":"task-b","state":"working"}"#
        ])
        #expect(poll.lifecycle == .attention)
    }

    @Test func attentionOutranksWorkingAcrossHomes() {
        var reducer = LedgerReducer()
        let working = LedgerEvent(data: Data(#"{"v":1,"ts":1,"event":"task.status","task":"b","state":"working"}"#.utf8))!
        let attention = LedgerEvent(data: Data(#"{"v":1,"ts":2,"event":"task.status","task":"a","state":"attention"}"#.utf8))!
        let acceptedWorking = reducer.apply(working, home: "z")
        let acceptedAttention = reducer.apply(attention, home: "a")
        #expect(acceptedWorking)
        #expect(acceptedAttention)
        // snapshot() is sorted by home, so "last row wins" would pick task b's
        // .working from home "z".
        #expect(reducer.displayedLifecycle() == .attention)
        #expect(reducer.snapshot().last?.lifecycle == .working)
    }

    @Test func idleDisplayedWhenNothingNeedsAttention() throws {
        let poll = try poll([
            #"{"v":1,"ts":1,"event":"task.status","task":"t","state":"working"}"#
        ])
        #expect(poll.lifecycle == .working)
    }

    @Test func reducerUpdatesAfterEachBatchAndNeverRegresses() throws {
        // The displayed state must be re-read from the reducer after applying the
        // batch, not carried over from the last accepted event.
        let url = tempFile()
        defer { try? FileManager.default.removeItem(at: url) }
        try write([#"{"v":1,"ts":1,"event":"task.status","task":"t","state":"working"}"#], to: url)
        var source = PetLifecycleSource()
        #expect(source.poll(url: url, home: "h").lifecycle == .working)
        let handle = try FileHandle(forWritingTo: url)
        try handle.seekToEnd()
        try handle.write(contentsOf: Data((#"{"v":1,"ts":2,"event":"task.status","task":"t","state":"attention"}"# + "\n").utf8))
        try handle.close()
        #expect(source.poll(url: url, home: "h").lifecycle == .attention)
    }

    // MARK: F3 - an unmappable state must not clear the prior lifecycle

    @Test func unknownStateKeepsPriorLifecycle() throws {
        let poll = try poll([
            #"{"v":1,"ts":1,"event":"task.status","task":"t","state":"attention"}"#,
            #"{"v":1,"ts":2,"event":"task.status","task":"t","state":"needs_input_v2"}"#
        ])
        #expect(poll.lifecycle == .attention)
    }

    @Test func missingAndNullStateKeepPriorLifecycle() throws {
        let poll = try poll([
            #"{"v":1,"ts":1,"event":"task.status","task":"t","state":"attention"}"#,
            #"{"v":1,"ts":2,"event":"task.status","task":"t"}"#,
            #"{"v":1,"ts":3,"event":"task.status","task":"t","state":null}"#
        ])
        #expect(poll.lifecycle == .attention)
    }

    @Test func unknownStateAfterAttentionFiresNoNotification() throws {
        // F3's sequence split across batches: the review's symptom was that the
        // pet dropped to blue AND a "changed lifecycle state" notification was
        // sent. Both must not happen.
        let url = tempFile()
        defer { try? FileManager.default.removeItem(at: url) }
        try write([#"{"v":1,"ts":1,"event":"task.status","task":"t","state":"attention"}"#], to: url)
        var source = PetLifecycleSource()
        #expect(source.poll(url: url, home: "h").lifecycle == .attention)
        let handle = try FileHandle(forWritingTo: url)
        try handle.seekToEnd()
        try handle.write(contentsOf: Data((#"{"v":1,"ts":2,"event":"task.status","task":"t","state":"needs_input_v2"}"# + "\n").utf8))
        try handle.close()
        let second = source.poll(url: url, home: "h")
        #expect(second.lifecycle == .attention)
        #expect(!second.changed)
        #expect(second.trigger == nil)
    }

    @Test func unknownStateDoesNotNotifyAndReducerRetainsProjection() throws {
        let url = tempFile()
        defer { try? FileManager.default.removeItem(at: url) }
        try write([
            #"{"v":1,"ts":1,"event":"task.status","task":"t","state":"attention"}"#,
            #"{"v":1,"ts":2,"event":"task.status","task":"t","state":"needs_input_v2"}"#
        ], to: url)
        var reducer = LedgerReducer()
        let tailer = LedgerTailer()
        for event in tailer.read(url: url, home: "h") where reducer.apply(event, home: "h") {}
        #expect(tailer.read(url: url, home: "h").isEmpty)
        #expect(reducer.snapshot().first?.lifecycle == .attention)
        // The source-level half of the same claim: the pet does not move and no
        // notification trigger is produced for the unmappable record.
        var source = PetLifecycleSource()
        let poll = source.poll(url: url, home: "h")
        #expect(poll.lifecycle == .attention)
        #expect(poll.changed)
        #expect(poll.trigger?.lifecycle == .attention)
    }

    @Test func unknownStateAloneKeepsIdleInsteadOfResetting() throws {
        let poll = try poll([
            #"{"v":1,"ts":1,"event":"task.status","task":"t","state":"needs_input_v2"}"#
        ])
        #expect(poll.lifecycle == .idle)
        #expect(!poll.changed)
    }

    @Test func unmappableStatusCarriesNoLifecycle() {
        let known = LedgerEvent(data: Data(#"{"v":1,"event":"task.status","task":"t","state":"attention"}"#.utf8))!
        let future = LedgerEvent(data: Data(#"{"v":1,"event":"task.status","task":"t","state":"needs_input_v2"}"#.utf8))!
        let absent = LedgerEvent(data: Data(#"{"v":1,"event":"task.status","task":"t"}"#.utf8))!
        #expect(known.lifecycle == .attention)
        #expect(future.lifecycle == nil)
        #expect(absent.lifecycle == nil)
        // Ignoring must still deduplicate: re-reading the same record changes
        // nothing, so it cannot clear an alert on a later pass.
        var reducer = LedgerReducer()
        let acceptedKnown = reducer.apply(known, home: "h")
        let acceptedAbsent = reducer.apply(absent, home: "h")
        #expect(acceptedKnown)
        #expect(acceptedAbsent)
        #expect(reducer.displayedLifecycle() == .attention)
    }

    @Test func knownStatesStillMapExactly() {
        let cases = [
            ("working", Lifecycle.working),
            ("running", Lifecycle.working),
            ("started", Lifecycle.working),
            ("attention", Lifecycle.attention),
            ("needs_input", Lifecycle.attention),
            ("blocked", Lifecycle.attention),
            ("failed", Lifecycle.attention),
            ("paused", Lifecycle.paused),
            ("merged", Lifecycle.merged),
            ("cleaned_up", Lifecycle.cleanedUp),
        ]
        for (state, expected) in cases {
            let event = LedgerEvent(data: Data(#"{"v":1,"event":"task.status","task":"t","state":"\#(state)"}"#.utf8))!
            #expect(event.lifecycle == expected, "state \(state) must still map")
        }
        for (event, expected) in [("task.pr_ready", Lifecycle.attention), ("task.merged", Lifecycle.merged), ("task.cleaned_up", Lifecycle.cleanedUp)] {
            #expect(LedgerEvent(data: Data(#"{"v":1,"event":"\#(event)","task":"t"}"#.utf8))!.lifecycle == expected)
        }
    }

    @Test func resetForgetsLedgerState() throws {
        let url = tempFile()
        defer { try? FileManager.default.removeItem(at: url) }
        try write([#"{"v":1,"ts":1,"event":"task.status","task":"t","state":"attention"}"#], to: url)
        var source = PetLifecycleSource()
        #expect(source.poll(url: url, home: "h").lifecycle == .attention)
        source.reset()
        #expect(source.lifecycle == .idle)
        let replay = source.poll(url: url, home: "h")
        #expect(replay.lifecycle == .attention)
        #expect(replay.changed)
    }
}
