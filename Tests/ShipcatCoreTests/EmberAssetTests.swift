import CoreGraphics
import Foundation
import ImageIO
import SceneKit
import Testing

/// Guards the captain's verbatim asset direction: the committed pet sprite is the
/// established Ember render **with green pupils** ("Ember we can go with but make
/// pupils make green").
///
/// It fails if the sprite is swapped for a render whose pupils are not green (the
/// amber prototype scores zero) or if the transparent background cutout is lost,
/// so the approved asset cannot silently regress. Provenance and the exact
/// generation settings live in `App/Assets/Ember/PROVENANCE.md`.
@Suite struct EmberAssetTests {
    /// `Tests/ShipcatCoreTests/<this file>` -> `App/Assets/Ember/ember.png`.
    private static let assetURL = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .appendingPathComponent("App/Assets/Ember/ember.png")

    private static let usdAssetURL = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .appendingPathComponent("App/Assets/Ember/Ember.usdz")

    private struct Pixels {
        let width: Int
        let height: Int
        /// Straight (un-premultiplied) RGBA, row-major, 4 bytes per pixel.
        let bytes: [UInt8]
        func pixel(_ x: Int, _ y: Int) -> (r: Int, g: Int, b: Int, a: Int) {
            let o = (y * width + x) * 4
            return (Int(bytes[o]), Int(bytes[o + 1]), Int(bytes[o + 2]), Int(bytes[o + 3]))
        }
    }

    private static func decode(_ url: URL) throws -> Pixels {
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
              let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
            Issue.record("ember.png could not be decoded at \(url.path)")
            return Pixels(width: 0, height: 0, bytes: [])
        }
        let width = image.width, height = image.height
        let colorSpace = CGColorSpace(name: CGColorSpace.sRGB)!
        let context = CGContext(data: nil, width: width, height: height,
                                bitsPerComponent: 8, bytesPerRow: width * 4,
                                space: colorSpace,
                                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
        guard let raw = context.data else { return Pixels(width: 0, height: 0, bytes: []) }
        let source8 = raw.assumingMemoryBound(to: UInt8.self)
        var bytes = [UInt8](repeating: 0, count: width * height * 4)
        for i in 0..<(width * height) {
            let o = i * 4
            let a = Int(source8[o + 3])
            if a == 0 {
                bytes[o] = 0; bytes[o + 1] = 0; bytes[o + 2] = 0; bytes[o + 3] = 0
                continue
            }
            // Undo premultiplication so a partially feathered edge is judged by
            // its colour, not by its alpha.
            let scale = 255.0 / Double(a)
            for c in 0..<3 {
                bytes[o + c] = UInt8(min(255, (Double(source8[o + c]) * scale).rounded()))
            }
            bytes[o + 3] = UInt8(a)
        }
        return Pixels(width: width, height: height, bytes: bytes)
    }

    /// A pixel whose green dominates both other channels by a wide margin: a
    /// green pupil, not a warm coat or shadow pixel.
    private static func isGreen(_ p: (r: Int, g: Int, b: Int, a: Int)) -> Bool {
        p.a > 200 && p.g > p.r + 40 && p.g > p.b + 40
    }

    @Test func animatedUSDZHasExpectedRigAndAnimation() throws {
        let scene = try SCNScene(url: Self.usdAssetURL, options: nil)
        let skeleton = try #require(scene.rootNode.childNode(withName: "EmberSkeleton", recursively: true))
        #expect(skeleton.animationKeys.contains(where: { $0.contains("EmberRigAction") }))
        let rig = try #require(scene.rootNode.childNode(withName: "EmberRig", recursively: true))
        let names = Set(rig.childNodes.map(\.name).compactMap { $0 })
        let meshCount = rig.childNodes(passingTest: { node, _ in node.geometry != nil }).count
        #expect(meshCount == 25)
        #expect(names.contains("FrontNearLeg"))
        #expect(names.contains("FrontFarLeg"))
        #expect(names.contains("HindNearLeg"))
        #expect(names.contains("HindFarLeg"))
        #expect(names.contains("EarNear"))
        #expect(names.contains("EarFar"))
        #expect(names.contains("TailBaseMesh"))
        #expect(names.contains("TailTipMesh"))
    }

    @Test func emberSpriteIsTheCommittedAsset() throws {
        let pixels = try Self.decode(Self.assetURL)
        #expect(pixels.width == 512 && pixels.height == 512,
                "the sprite must stay the 512x512 committed asset, got \(pixels.width)x\(pixels.height)")
    }

    @Test func pupilsAreGreenAndSitInTheEyes() throws {
        let pixels = try Self.decode(Self.assetURL)
        let green = Self.isGreen
        // The eyes sit in the upper part of the frame; the whole vertical span
        // must stay above the midline so green cannot be found in the fur.
        let band = (0..<pixels.height).filter { $0 < pixels.height / 2 }
        var perRow = [Int: (Int, Int)]()
        var count = 0
        for y in band {
            for x in 0..<pixels.width where green(pixels.pixel(x, y)) {
                count += 1
                perRow[y, default: (0, 0)].0 += 1
                perRow[y, default: (0, 0)].1 = max(perRow[y]!.1, x)
            }
        }
        #expect(count > 100, "the green pupils must survive in the shipped sprite (found \(count) green pixels)")
        // Two eyes: green must appear on both sides of the canvas centre.
        var left = 0, right = 0
        for y in band {
            for x in 0..<pixels.width where green(pixels.pixel(x, y)) {
                if x < pixels.width / 2 { left += 1 } else { right += 1 }
            }
        }
        #expect(left > 25 && right > 25, "both eyes must be green (left \(left), right \(right))")
        // The pupils occupy a plausible eye band, not the whole upper frame.
        let rows = perRow.keys.sorted()
        if let first = rows.first, let last = rows.last {
            #expect(last - first < pixels.height / 4, "pupils must be two compact eyes, not a wide wash")
        }
    }

    @Test func backgroundIsCutOut() throws {
        let pixels = try Self.decode(Self.assetURL)
        var transparent = 0, opaque = 0
        for i in 0..<(pixels.width * pixels.height) {
            let o = i * 4
            switch pixels.bytes[o + 3] {
            case 0: transparent += 1
            case 200...: opaque += 1
            default: break
            }
        }
        let total = pixels.width * pixels.height
        #expect(Double(transparent) / Double(total) > 0.3,
                "the background cutout must leave the backdrop transparent (\(transparent)/\(total))")
        #expect(Double(opaque) / Double(total) > 0.1,
                "the fox must stay opaque (\(opaque)/\(total))")
    }

    @Test func artworkIsNotFlattenedIntoASilhouette() throws {
        // A lifecycle tint applied as a template/foregroundStyle flatten would
        // erase the green pupils; the committed asset must keep real colour.
        let pixels = try Self.decode(Self.assetURL)
        var warm = 0
        for y in 0..<pixels.height {
            for x in 0..<pixels.width {
                let p = pixels.pixel(x, y)
                if p.a > 200 && p.r > 100 && p.r > p.b + 40 { warm += 1 }
            }
        }
        #expect(warm > 5_000, "the rust-orange coat must stay a coloured render (\(warm) warm pixels)")
    }
}
