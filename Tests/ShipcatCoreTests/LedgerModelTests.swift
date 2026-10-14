import Foundation
import Testing
@testable import ShipcatCore

@Suite struct LedgerModelTests {
    @Test(arguments: [
        #"{"v":1,"ts":1790132857,"event":"task.dispatched","task":"fix-login","kind":"scout","project":"shipcat","harness":"pi","model":null}"#,
        #"{"v":1,"ts":1790132870,"event":"task.status","task":"fix-login","state":"working","key":null,"text":" bug reproduced"}"#
    ])
    func acceptsCanonicalRecords(json: String) {
        #expect(LedgerEvent(data: Data(json.utf8)) != nil)
    }

    @Test func recognizesAllContractEventsAndIgnoresUnknown() {
        for event in LedgerEventKind.allCases {
            let json = #"{"v":1,"event":"\#(event.rawValue)","task":"task-1","state":"working"}"#
            #expect(LedgerEvent(data: Data(json.utf8))?.kind == event)
        }
        #expect(LedgerEvent(data: Data(#"{"v":1,"event":"task.future","task":"task-1"}"#.utf8)) == nil)
    }

    @Test func statusTextNeverEntersModelOrLogs() {
        let secret = "PRIVATE-STATUS-SECRET-91a"
        let json = #"{"v":1,"event":"task.status","task":"safe-id","state":"working","key":"private-key","text":"\#(secret)"}"#
        let event = LedgerEvent(data: Data(json.utf8))!
        let projection = TaskProjection(identity: TaskIdentity(home: "demo", task: event.task), lifecycle: event.lifecycle)
        let output = String(describing: projection) + " " + String(describing: event)
        #expect(!output.contains(secret))
        #expect(!String(describing: type(of: event)).contains("text"))
    }
}
