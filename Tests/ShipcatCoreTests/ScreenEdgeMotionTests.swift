import Foundation
import Testing
@testable import ShipcatCore

@Suite struct ScreenEdgeMotionTests {
    private let displays = [
        CGRect(x: 0, y: 0, width: 2560, height: 1440),
        CGRect(x: 2560, y: 101, width: 2560, height: 1440)
    ]

    @Test func crossingConnectedDisplaySeamsDoesNotTriggerAnEdgeJump() throws {
        let frame = CGRect(x: 2500, y: 500, width: 160, height: 160)
        let movingLeft = try #require(ScreenEdgeMotion.advance(frame: frame, deltaX: -60, screens: displays))
        #expect(movingLeft.frame.origin.x == 2440)
        #expect(movingLeft.screenIndex == 0)
        #expect(!movingLeft.reachedOuterEdge)

        let movingRight = try #require(ScreenEdgeMotion.advance(frame: frame, deltaX: 60, screens: displays))
        #expect(movingRight.frame.origin.x == 2560)
        #expect(movingRight.screenIndex == 1)
        #expect(!movingRight.reachedOuterEdge)
    }

    @Test func crossingSeamKeepsPetAlignedWithEachDisplaysBottomEdge() throws {
        let onRightDisplay = CGRect(x: 2500, y: 101, width: 160, height: 160)
        let movingLeft = try #require(ScreenEdgeMotion.advance(frame: onRightDisplay, deltaX: -60, screens: displays))
        #expect(movingLeft.screenIndex == 0)
        #expect(movingLeft.frame.origin.y == 0)
        #expect(!movingLeft.reachedOuterEdge)

        let onLeftDisplay = CGRect(x: 2440, y: 0, width: 160, height: 160)
        let movingRight = try #require(ScreenEdgeMotion.advance(frame: onLeftDisplay, deltaX: 60, screens: displays))
        #expect(movingRight.screenIndex == 1)
        #expect(movingRight.frame.origin.y == 101)
        #expect(!movingRight.reachedOuterEdge)
    }

    @Test func outerEdgesClampPetInsideDisplayAndTriggerJump() throws {
        let left = try #require(ScreenEdgeMotion.advance(
            frame: CGRect(x: 2, y: 500, width: 160, height: 160),
            deltaX: -5,
            screens: displays
        ))
        #expect(left.frame.origin.x == 0)
        #expect(left.screenIndex == 0)
        #expect(left.reachedOuterEdge)

        let right = try #require(ScreenEdgeMotion.advance(
            frame: CGRect(x: 4950, y: 500, width: 160, height: 160),
            deltaX: 20,
            screens: displays
        ))
        #expect(right.frame.origin.x == 4960)
        #expect(right.screenIndex == 1)
        #expect(right.reachedOuterEdge)
    }

    @Test func aDisplayBeyondAVerticalGapIsNotTreatedAsConnected() throws {
        let separatedDisplays = [
            CGRect(x: 0, y: 0, width: 2560, height: 1440),
            CGRect(x: 2560, y: 1500, width: 2560, height: 900)
        ]
        let step = try #require(ScreenEdgeMotion.advance(
            frame: CGRect(x: 2405, y: 100, width: 160, height: 160),
            deltaX: 10,
            screens: separatedDisplays
        ))
        #expect(step.frame.origin.x == 2400)
        #expect(step.screenIndex == 0)
        #expect(step.reachedOuterEdge)
    }
}
