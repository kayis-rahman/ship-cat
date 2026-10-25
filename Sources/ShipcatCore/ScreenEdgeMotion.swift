import CoreGraphics
import Foundation

/// Moves a window horizontally across connected display bounds and reports only
/// actual outer desktop edges. A window straddling a display seam is not at an
/// edge while a connected display continues in its direction of travel.
public enum ScreenEdgeMotion {
    public struct Step {
        public let frame: CGRect
        public let screenIndex: Int
        public let reachedOuterEdge: Bool
    }

    public static func screenIndex(for frame: CGRect, in screens: [CGRect]) -> Int? {
        let center = CGPoint(x: frame.midX, y: frame.midY)
        return screens.firstIndex { $0.contains(center) }
    }

    public static func advance(frame: CGRect, deltaX: CGFloat, screens: [CGRect]) -> Step? {
        guard let currentIndex = screenIndex(for: frame, in: screens) else { return nil }
        guard deltaX != 0 else { return Step(frame: frame, screenIndex: currentIndex, reachedOuterEdge: false) }

        let current = screens[currentIndex]
        var proposed = frame.offsetBy(dx: deltaX, dy: 0)
        let crossedLeft = deltaX < 0 && proposed.minX < current.minX
        let crossedRight = deltaX > 0 && proposed.maxX > current.maxX
        guard crossedLeft || crossedRight else {
            return Step(frame: proposed,
                        screenIndex: screenIndex(for: proposed, in: screens) ?? currentIndex,
                        reachedOuterEdge: false)
        }

        let tolerance: CGFloat = 0.5
        let connectedNeighbor = screens.indices.first { index in
            guard index != currentIndex else { return false }
            let neighbor = screens[index]
            let sharesHorizontalEdge = deltaX < 0
                ? abs(neighbor.maxX - current.minX) <= tolerance
                : abs(neighbor.minX - current.maxX) <= tolerance
            let verticalOverlap = proposed.maxY > neighbor.minY && proposed.minY < neighbor.maxY
            return sharesHorizontalEdge && verticalOverlap
        }
        if let connectedNeighbor {
            let centerCrossedSeam = deltaX < 0 ? proposed.midX < current.minX : proposed.midX >= current.maxX
            let destinationIndex = centerCrossedSeam ? connectedNeighbor : currentIndex
            if destinationIndex != currentIndex {
                let destination = screens[destinationIndex]
                let bottomOffset = frame.minY - current.minY
                let topOffset = current.maxY - frame.maxY
                if abs(bottomOffset) <= tolerance {
                    proposed.origin.y = destination.minY + bottomOffset
                } else if abs(topOffset) <= tolerance {
                    proposed.origin.y = destination.maxY - proposed.height - topOffset
                } else {
                    proposed.origin.y = min(max(proposed.minY, destination.minY), destination.maxY - proposed.height)
                }
            }
            return Step(frame: proposed, screenIndex: destinationIndex, reachedOuterEdge: false)
        }

        proposed.origin.x = deltaX < 0 ? current.minX : current.maxX - proposed.width
        return Step(frame: proposed, screenIndex: currentIndex, reachedOuterEdge: true)
    }
}
