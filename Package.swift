// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "Shipcat",
    platforms: [.macOS(.v14)],
    products: [.library(name: "ShipcatCore", targets: ["ShipcatCore"])],
    targets: [
        .target(name: "ShipcatCore"),
        .testTarget(name: "ShipcatCoreTests", dependencies: ["ShipcatCore"])
    ]
)
